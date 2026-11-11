/**
 * Pose geometry helpers (port of server/analysis/geometry.py).
 *
 * MediaPipe returns landmarks normalised to [0, 1] on each axis. Angles must be
 * computed in pixel space, otherwise a non-square frame skews every angle, so
 * `Pose` scales x by width and y by height before any maths happens.
 *
 * It also returns *world* landmarks: 3D points in meters, origin between the
 * hips, axes aligned with the image (x right, y down, z away from the camera).
 * With `useWorld = true`, `Pose.pt` returns those 3D points instead, so every
 * angle helper below measures the real joint angle rather than its projection
 * on the image. A knee bending towards the camera then still reads correctly.
 * All helpers accept 2D or 3D points.
 */
import { degrees, pyHypot } from "./pymath.js";

/** @typedef {"left" | "right"} Side */

/** @typedef {"nose" | "ear" | "shoulder" | "elbow" | "wrist" | "index" | "hip" | "knee" | "ankle" | "heel" | "toe"} Joint */

/** A 2D (pixels) or 3D (meters) point. @typedef {readonly number[]} Vec */

/** One image landmark: [x, y, visibility], x and y normalised to [0, 1]. Visibility defaults to 1. @typedef {readonly number[]} Landmark */

/** One world landmark: [x, y, z] in meters, origin between the hips, y down (see `alignWorldY`). @typedef {readonly number[]} WorldLandmark */

/**
 * MediaPipe Pose landmark indices (33-point BlazePose topology).
 * @type {Readonly<Record<Side, Readonly<Record<Joint, number>>>>}
 */
export const JOINTS = {
  left: {
    nose: 0,
    ear: 7,
    shoulder: 11,
    elbow: 13,
    wrist: 15,
    index: 19,
    hip: 23,
    knee: 25,
    ankle: 27,
    heel: 29,
    toe: 31,
  },
  right: {
    nose: 0,
    ear: 8,
    shoulder: 12,
    elbow: 14,
    wrist: 16,
    index: 20,
    hip: 24,
    knee: 26,
    ankle: 28,
    heel: 30,
    toe: 32,
  },
};

/**
 * Skeleton edges, for clients that want to draw the pose.
 * @type {readonly (readonly [number, number])[]}
 */
export const CONNECTIONS = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [27, 29],
  [29, 31],
  [27, 31],
  [24, 26],
  [26, 28],
  [28, 30],
  [30, 32],
  [28, 32],
];

export class Pose {
  /**
   * @param {readonly Landmark[]} landmarks
   * @param {number} width
   * @param {number} height
   * @param {readonly WorldLandmark[] | null} [world]
   * @param {boolean} [useWorld] true (and world given): pt() returns 3D points in meters
   */
  constructor(landmarks, width, height, world = null, useWorld = false) {
    this.landmarks = landmarks;
    this.width = width;
    this.height = height;
    this.world = world;
    /** True (and world given): pt() returns 3D points in meters. */
    this.useWorld = useWorld;
  }

  get is3d() {
    return this.useWorld && this.world != null;
  }

  /**
   * @param {Side} side
   * @param {Joint} joint
   * @returns {number[]}
   */
  pt(side, joint) {
    if (this.useWorld && this.world != null) {
      return this.world[JOINTS[side][joint]].slice(0, 3).map(Number);
    }
    return this.pt2d(side, joint);
  }

  /**
   * Any landmark by its MediaPipe index (the thumb, the pinky...), 2D or 3D like `pt`.
   * @param {number} index
   * @returns {number[]}
   */
  ptAt(index) {
    if (this.useWorld && this.world != null) return this.world[index].slice(0, 3).map(Number);
    const lm = this.landmarks[index];
    return [lm[0] * this.width, lm[1] * this.height];
  }

  /**
   * Always the image-space point in pixels.
   * @param {Side} side
   * @param {Joint} joint
   * @returns {number[]}
   */
  pt2d(side, joint) {
    const lm = this.landmarks[JOINTS[side][joint]];
    return [lm[0] * this.width, lm[1] * this.height];
  }

  /**
   * @param {Side} side
   * @param {Joint} joint
   */
  vis(side, joint) {
    const lm = this.landmarks[JOINTS[side][joint]];
    return lm.length > 2 ? Number(lm[2]) : 1.0;
  }
}

// --- small vector maths (numpy equivalents, same evaluation order) ----------

/**
 * @param {Vec} a
 * @param {Vec} b
 * @returns {number[]}
 */
export function sub(a, b) {
  return a.map((v, i) => v - b[i]);
}

/**
 * @param {Vec} a
 * @param {Vec} b
 * @returns {number[]}
 */
export function add(a, b) {
  return a.map((v, i) => v + b[i]);
}

/** `np.dot` of two 1-D vectors: summed left to right (matches numpy bit for bit for 2-3 items). */

/**
 * @param {Vec} a
 * @param {Vec} b
 */
export function dot(a, b) {
  let s = a[0] * b[0];
  for (let i = 1; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** `np.linalg.norm` of a 1-D vector: sqrt(x . x). */

/** @param {Vec} a */
export function norm(a) {
  return Math.sqrt(dot(a, a));
}

/** Interior angle ABC in degrees (0..180). */

/**
 * @param {Vec} a
 * @param {Vec} b
 * @param {Vec} c
 */
export function angle(a, b, c) {
  const ba = sub(a, b);
  const bc = sub(c, b);
  const denom = norm(ba) * norm(bc);
  if (denom < 1e-9) return 180.0;
  const cos = Math.min(Math.max(dot(ba, bc) / denom, -1.0), 1.0);
  return degrees(Math.acos(cos));
}

/**
 * Angle (0..180) between the vector start->end and straight up.
 *
 * Image and world y both grow downwards, so "up" is -y in 2D and 3D.
 */

/**
 * @param {Vec} start
 * @param {Vec} end
 */
export function angleFromVertical(start, end) {
  const up = start.map(() => 0.0);
  up[1] = -1.0;
  // Kept as (start + up) - start, like the Python, so rounding matches exactly.
  return angle(add(start, up), start, end);
}

/** Angle (0..90) between the line start-end and the horizontal (the x-z plane in 3D). */

/**
 * @param {Vec} start
 * @param {Vec} end
 */
export function angleFromHorizontal(start, end) {
  const d = end.map((v, i) => Math.abs(v - start[i]));
  const flat = d.length > 2 ? pyHypot(d[0], d[2]) : d[0];
  return degrees(Math.atan2(d[1], flat));
}

/** Exponential moving average used to de-jitter joint angles. */
export class Ema {
  constructor(alpha = 0.5) {
    /** @type {number | null} */
    this.value = null;
    this.alpha = alpha;
  }

  /** @param {number} x */
  update(x) {
    this.value = this.value === null ? x : this.alpha * x + (1 - this.alpha) * this.value;
    return this.value;
  }

  reset() {
    this.value = null;
  }
}
