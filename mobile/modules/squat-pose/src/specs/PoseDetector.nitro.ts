import type { HybridObject } from 'react-native-nitro-modules';
import type { Frame } from 'react-native-vision-camera';

/**
 * One person's pose, as MediaPipe Pose Landmarker returns it.
 * Landmarks are for the frame as handed to `detect` (the app configures the
 * frame output so that is upright and not mirrored).
 */
export interface PoseResult {
  /** 33 × [x, y, visibility], x and y normalised to 0..1 of the frame. */
  landmarks: number[];
  /** 33 × [x, y, z] world landmarks in meters, origin between the hips (raw MediaPipe axes). */
  world: number[];
  /** Size of the analysed image in pixels. */
  width: number;
  height: number;
  /** Inference time in milliseconds. */
  inferenceMs: number;
}

export interface PoseDetector extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  /** Runs the pose model on a frame (VIDEO mode, so it tracks across calls). Undefined when nobody is found. */
  detect(frame: Frame): PoseResult | undefined;
  /** Runs the model once on an image file (IMAGE mode), for diagnostics. */
  detectImageFile(path: string): PoseResult | undefined;
  /** Frees the model; the next detect() loads it again. */
  close(): void;
}
