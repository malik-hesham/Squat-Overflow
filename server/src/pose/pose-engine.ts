/**
 * Pose inference with TF.js BlazePose (lite), the Node replacement for MediaPipe's
 * Python PoseLandmarker. Same 33-landmark topology, plus 3D world landmarks and a
 * person segmentation mask.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import * as poseDetection from '@tensorflow-models/pose-detection';
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-cpu';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import sharp from 'sharp';

/** server-nest/models/blazepose, from both src/pose (ts-jest) and dist/pose (build). */
export const MODEL_DIR = join(__dirname, '..', '..', 'models', 'blazepose');

/** 33 x [x, y, visibility], normalised to 0..1. */
export type Landmarks = [number, number, number][];
/** 33 x [x, y, z] in meters, origin between the hips, y growing downwards. */
export type WorldLandmarks = [number, number, number][];

/** Person mask, row-major, values 0..1. */
export interface Mask {
  data: Float32Array;
  width: number;
  height: number;
}

export interface RgbImage {
  data: Uint8Array; // HxWx3
  width: number;
  height: number;
}

export interface Detection {
  landmarks: Landmarks | null;
  world: WorldLandmarks | null;
  mask: Mask | null;
}

const MAX_INPUT_PIXELS = 4096 * 4096;

/** JPEG/PNG bytes -> RGB pixels, or null if undecodable. */
export async function decodeImage(data: Uint8Array): Promise<RgbImage | null> {
  try {
    const { data: raw, info } = await sharp(data, { limitInputPixels: MAX_INPUT_PIXELS })
      .toColourspace('srgb')
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels !== 3) return null;
    return { data: raw, width: info.width, height: info.height };
  } catch {
    return null;
  }
}

/**
 * Make world y grow downwards like image y, so "up" is -y in both spaces.
 * The angle helpers depend on that, so check it: if world y runs opposite to
 * image y across the body, flip it.
 */
export function alignWorldY(landmarks: Landmarks, world: WorldLandmarks): WorldLandmarks {
  const corr = correlation(
    landmarks.map((l) => l[1]),
    world.map((p) => p[1]),
  );
  if (corr === null || corr >= 0) return world;
  return world.map(([x, y, z]) => [x, -y, z]);
}

function correlation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n === 0) return null;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  if (Math.sqrt(va / n) < 1e-9 || Math.sqrt(vb / n) < 1e-9) return null;
  return cov / Math.sqrt(va * vb);
}

let backendReady: Promise<string> | null = null;

/**
 * Pick the TF.js backend once per process. WASM (SIMD) is the default; set
 * FORMCOACH_TF_BACKEND=cpu to fall back to the pure-JS kernels.
 */
export function initBackend(): Promise<string> {
  backendReady ??= (async () => {
    const wanted = process.env.FORMCOACH_TF_BACKEND ?? 'wasm';
    if (wanted === 'wasm') {
      // The wasm backend loads its .wasm binaries from disk next to its own dist/ files.
      setWasmPaths(dirname(require.resolve('@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm')) + '/');
    }
    if (!(await tf.setBackend(wanted))) throw new Error(`TF.js backend ${wanted!} failed to initialise`);
    await tf.ready();
    return tf.getBackend();
  })();
  return backendReady;
}

const artifactCache = new Map<string, Promise<tf.io.ModelArtifacts>>();

/** Graph model artifacts read from disk once, then shared by every engine. */
function localModel(name: string): tf.io.IOHandler {
  return {
    load: () => {
      let artifacts = artifactCache.get(name);
      if (!artifacts) {
        artifacts = (async () => {
          const dir = join(MODEL_DIR, name);
          const json = JSON.parse(await readFile(join(dir, 'model.json'), 'utf8')) as tf.io.ModelJSON;
          return tf.io.getModelArtifactsForJSON(json, async (manifest) => {
            const specs = manifest.flatMap((g) => g.weights);
            const shards = await Promise.all(manifest.flatMap((g) => g.paths).map((p) => readFile(join(dir, p))));
            const joined = Buffer.concat(shards);
            const data = joined.buffer.slice(joined.byteOffset, joined.byteOffset + joined.byteLength) as ArrayBuffer;
            return [specs, data];
          });
        })();
        artifactCache.set(name, artifacts);
      }
      return artifacts;
    },
  };
}

/** Initialise the backend and read both models from disk, so the first client doesn't wait. */
export async function warmUp(): Promise<string> {
  const backend = await initBackend();
  await Promise.all(['detector', 'landmark-lite'].map((name) => localModel(name).load!()));
  return backend;
}

/** One instance per client stream: the detector tracks and smooths the person across frames. */
export class PoseEngine {
  private lastTs = -1;

  private constructor(private readonly detector: poseDetection.PoseDetector) {}

  static async create(): Promise<PoseEngine> {
    await initBackend();
    const detector = await poseDetection.createDetector(poseDetection.SupportedModels.BlazePose, {
      runtime: 'tfjs',
      modelType: 'lite',
      enableSmoothing: true,
      enableSegmentation: true, // used by the client's privacy blur
      smoothSegmentation: true,
      detectorModelUrl: localModel('detector'),
      landmarkModelUrl: localModel('landmark-lite'),
    });
    return new PoseEngine(detector);
  }

  /** Image landmarks, 3D world landmarks and person mask (all null if nobody is found). */
  async detect(image: RgbImage, timestampMs: number): Promise<Detection> {
    // Smoothing needs strictly increasing timestamps.
    const ts = Math.max(Math.trunc(timestampMs), this.lastTs + 1);
    this.lastTs = ts;
    const input = tf.tensor3d(image.data, [image.height, image.width, 3], 'int32');
    let poses: poseDetection.Pose[];
    try {
      poses = await this.detector.estimatePoses(input, { flipHorizontal: false }, ts);
    } finally {
      input.dispose();
    }
    const pose = poses[0];
    if (!pose || pose.keypoints.length === 0) return { landmarks: null, world: null, mask: null };

    const landmarks: Landmarks = pose.keypoints.map((k) => [k.x / image.width, k.y / image.height, k.score ?? 1]);
    const world = pose.keypoints3D?.length
      ? alignWorldY(landmarks, pose.keypoints3D.map((k) => [k.x, k.y, k.z ?? 0]))
      : null;
    return { landmarks, world, mask: pose.segmentation ? await maskFrom(pose.segmentation) : null };
  }

  close(): void {
    this.detector.dispose();
  }
}

/** The segmentation's RGBA mask tensor carries the person probability in alpha, as 0..1 floats. */
async function maskFrom(segmentation: NonNullable<poseDetection.Pose['segmentation']>): Promise<Mask> {
  const rgba = (await segmentation.mask.toTensor()) as tf.Tensor3D;
  try {
    const [height, width] = rgba.shape;
    const pixels = await rgba.data();
    const data = new Float32Array(width * height);
    for (let i = 0; i < data.length; i++) data[i] = Math.min(1, Math.max(0, pixels[i * 4 + 3]));
    return { data, width, height };
  } finally {
    rgba.dispose();
  }
}
