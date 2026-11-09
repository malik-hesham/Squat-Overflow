/**
 * The pose model on this device: MediaPipe's PoseLandmarker with the same pose_landmarker_lite.task
 * as the phone (mobile/modules/squat-pose), loaded from lib/vendor/mediapipe/. Nothing leaves the
 * device: the runtime, the WASM and the model are all files of the extension.
 *
 * Browser-only (it needs WebGL or WASM). A frame is a video element (the extension's pages) or any
 * other image source with a width and height, such as an ImageBitmap (the Mac app's PoseBridge,
 * macos/SquatOverflowBar/PoseWeb). `detect` returns what lib/pose/gateway.js expects.
 */
import { FilesetResolver, PoseLandmarker } from "../vendor/mediapipe/vision_bundle.mjs";

const VENDOR = new URL("../vendor/mediapipe/", import.meta.url).href;

/**
 * @param {"GPU" | "CPU"} delegate
 * @returns {import("../vendor/mediapipe/vision_bundle.mjs").PoseLandmarkerOptions}
 */
const options = (delegate) => ({
  baseOptions: { modelAssetPath: `${VENDOR}pose_landmarker_lite.task`, delegate },
  runningMode: "VIDEO",
  numPoses: 1,
  outputSegmentationMasks: false,
});

/** @returns {Promise<import("./local-socket.js").Detector>} */
export async function createDetector() {
  const fileset = await FilesetResolver.forVisionTasks(VENDOR);
  let landmarker;
  try {
    landmarker = await PoseLandmarker.createFromOptions(fileset, options("GPU"));
  } catch {
    landmarker = await PoseLandmarker.createFromOptions(fileset, options("CPU")); // no WebGL2
  }
  let masks = false;
  let lastMs = -1;

  return {
    /**
     * @param {HTMLVideoElement | ImageBitmap} frame
     * @param {number} ms
     * @param {{ mask: boolean }} opts
     */
    async detect(frame, ms, { mask }) {
      const width = "videoWidth" in frame ? frame.videoWidth : frame.width;
      const height = "videoHeight" in frame ? frame.videoHeight : frame.height;
      if (!width || !height) throw new Error("no video frame yet");
      if (mask !== masks) {
        await landmarker.setOptions({ outputSegmentationMasks: mask });
        masks = mask;
      }
      const t = Math.max(ms, lastMs + 1); // MediaPipe needs strictly increasing timestamps
      lastMs = t;
      /** @type {import("./gateway.js").Detection} */
      let found = { width, height, landmarks: null, world: null, mask: null };
      // The result, and the mask's pixels, are only valid inside the callback: copy them out.
      landmarker.detectForVideo(frame, t, (res) => {
        const lms = res.landmarks[0];
        const world = res.worldLandmarks[0];
        const m = res.segmentationMasks?.[0];
        found = {
          width,
          height,
          landmarks: lms ? lms.map((p) => [p.x, p.y, p.visibility ?? 1]) : null,
          world: world ? world.map((p) => [p.x, p.y, p.z]) : null,
          mask: m ? { data: m.getAsFloat32Array().slice(), width: m.width, height: m.height } : null,
        };
      });
      return found;
    },
    close() {
      landmarker.close();
    },
  };
}
