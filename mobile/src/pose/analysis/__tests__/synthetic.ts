/**
 * Synthetic MediaPipe-style landmark lists with exact joint angles (port of
 * server/tests/synthetic.py plus the `upper` / `side_head` builders from
 * server/tests/test_office.py), for the ported unit tests.
 *
 * Coordinates are built in a 1000x1000 pixel space and normalised, so tests
 * can reason about geometry without a camera.
 */

import { JOINTS, type Joint, type Side } from '../../../../../extension/lib/pose/geometry.js';

export const SIZE = 1000;

type P = readonly number[];
type Points = Partial<Record<Joint, P>>;

const add = (a: P, b: P): number[] => [a[0] + b[0], a[1] + b[1]];
const scale = (a: P, k: number): number[] => [a[0] * k, a[1] * k];
const rad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Point at `length` from `center` such that angle(ref, center, point) == deg.
 * Two points satisfy that; `prefer` picks one: "up", "down", "fwd" (+x), "back" (-x).
 */
export function bend(center: P, ref: P, deg: number, length: number, prefer: 'up' | 'down' | 'fwd' | 'back'): number[] {
  const d = [ref[0] - center[0], ref[1] - center[1]];
  const n = Math.hypot(d[0], d[1]);
  const u = [d[0] / n, d[1] / n];
  const r = rad(deg);
  const cands = [1, -1].map((s) => {
    const c = Math.cos(s * r);
    const sn = Math.sin(s * r);
    return add(center, scale([c * u[0] - sn * u[1], sn * u[0] + c * u[1]], length));
  });
  const key = { up: (p: P) => p[1], down: (p: P) => -p[1], fwd: (p: P) => -p[0], back: (p: P) => p[0] }[prefer];
  return key(cands[1]) < key(cands[0]) ? cands[1] : cands[0];
}

/** points: {left, right}; a side not given mirrors left at low visibility. */
export function landmarks(points: { left: Points; right?: Points }, otherVis = 0.2): number[][] {
  const lms: number[][] = Array.from({ length: 33 }, () => [0.5, 0.5, 0.9]);
  for (const side of ['left', 'right'] as Side[]) {
    const given = points[side];
    const [src, vis] = given ? [given, 0.95] : [points.left, otherVis];
    for (const [joint, idx] of Object.entries(JOINTS[side]) as [Joint, number][]) {
      const p = src[joint];
      if (p) lms[idx] = [p[0] / SIZE, p[1] / SIZE, vis];
    }
  }
  return lms;
}

export function squat(kneeDeg: number, leanDeg = 10, kneeShift = 0): number[][] {
  const ankle = [500, 900];
  const knee = [500 + kneeShift, 700];
  const hip = bend(knee, ankle, kneeDeg, 200, 'back');
  const lean = rad(leanDeg);
  const shoulder = add(hip, scale([Math.sin(lean), -Math.cos(lean)], 250));
  return landmarks({
    left: {
      ankle, knee, hip, shoulder, heel: [480, 915], toe: [560, 915],
      elbow: add(shoulder, [0, 120]), wrist: add(shoulder, [0, 240]),
    },
  });
}

export function pushup(elbowDeg: number, hipOffset = 0, vertical = false): number[][] {
  const [shoulder, hip, ankle] = vertical
    ? [[500, 300], [500, 550], [500, 900]]
    : [[300, 500], [550, 520 + hipOffset], [800, 540]];
  const elbow = add(shoulder, [0, 110]);
  const wrist = bend(elbow, shoulder, elbowDeg, 110, 'back');
  return landmarks({
    left: {
      shoulder, elbow, wrist, hip, ankle,
      knee: scale(add(hip, ankle), 0.5), heel: add(ankle, [10, 0]), toe: add(ankle, [10, 20]),
    },
  });
}

export function curl(elbowDeg: number, driftDeg = 5, leanDeg = 0): number[][] {
  const hip = [500, 600];
  const lean = rad(leanDeg);
  const shoulder = add(hip, scale([Math.sin(lean), -Math.cos(lean)], 280));
  const elbow = bend(shoulder, hip, driftDeg, 150, 'fwd');
  const wrist = bend(elbow, shoulder, elbowDeg, 140, 'fwd');
  return landmarks({
    left: {
      shoulder, elbow, wrist, hip,
      knee: add(hip, [0, 200]), ankle: add(hip, [0, 400]), heel: add(hip, [-10, 410]), toe: add(hip, [40, 410]),
    },
  });
}

export function press(elbowDeg: number, armsDown = false, rightOffset = 0): number[][] {
  const sides: { left: Points; right?: Points } = { left: {} };
  for (const [side, sx, out] of [['left', 600, 1], ['right', 400, -1]] as const) {
    const shoulder = [sx, 300];
    const elbow = add(shoulder, [out * 110, 0]);
    let wrist = bend(elbow, shoulder, elbowDeg, 110, armsDown ? 'down' : 'up');
    if (side === 'right') wrist = add(wrist, [0, rightOffset]);
    sides[side] = {
      shoulder, elbow, wrist,
      hip: add(shoulder, [0, 260]), knee: add(shoulder, [0, 450]), ankle: add(shoulder, [0, 640]),
    };
  }
  return landmarks(sides);
}

/** start -> end -> start following a cosine (natural acceleration). */
export function trajectory(start: number, end: number, frames: number): number[] {
  return Array.from({ length: frames + 1 }, (_, i) => start + ((end - start) * (1 - Math.cos((2 * Math.PI * i) / frames))) / 2);
}

/**
 * Side-view landmarks -> the same pose filmed from the front. The side view's
 * x (forward/back) becomes depth, so in the image every joint of a leg sits on
 * one vertical line and 2D angles flatten to ~180 degrees.
 */
export function turnToCamera(lms: number[][], halfWidth = 0.06): [number[][], number[][]] {
  const image: number[][] = [];
  const world: number[][] = [];
  lms.forEach(([x, y], i) => {
    const offset = i < 11 ? 0.0 : i % 2 ? halfWidth : -halfWidth; // odd = left side
    image.push([0.5 + offset, y, 0.95]);
    world.push([offset, y, x - 0.5]);
  });
  return [image, world];
}

export interface UpperOptions {
  leftElev?: number;
  rightElev?: number;
  tilt?: number;
  turn?: number;
  shoulderDrop?: number;
  chinDrop?: number | null;
  shrug?: number;
}

/**
 * Seated, facing the camera. Arm elevation in degrees (0 = hanging, 180 =
 * overhead, negative = across the chest). `chinDrop` puts the nose that many
 * degrees below the ears; `shrug` lifts both shoulders by that many pixels.
 */
export function upper({
  leftElev = 20, rightElev = 20, tilt = 0, turn = 0, shoulderDrop = 0, chinDrop = null, shrug = 0,
}: UpperOptions = {}): number[][] {
  const sides: { left: Points; right?: Points } = { left: {} };
  const noseY = chinDrop === null ? 300 : 280 + 60 * Math.tan(rad(chinDrop));
  for (const [side, sx, out] of [['left', 600, 1], ['right', 400, -1]] as const) {
    const shoulder = [sx, 400 - shrug + (side === 'left' ? shoulderDrop : 0)];
    const e = rad(side === 'left' ? leftElev : rightElev);
    const wrist = add(shoulder, scale([out * Math.sin(e), Math.cos(e)], 250));
    const t = rad(tilt);
    const ear = add([500, 280], scale([Math.cos(t), Math.sin(t)], out * 60));
    const nose = [500 + 60 * Math.sin(rad(turn)), noseY];
    sides[side] = {
      nose, ear, shoulder, elbow: scale(add(shoulder, wrist), 0.5), wrist,
      hip: add(shoulder, [0, 300]), knee: add(shoulder, [0, 450]), ankle: add(shoulder, [0, 640]),
    };
  }
  return landmarks(sides);
}

/** Side view: the ear sits 150 px from the shoulder, `forwardDeg` in front of straight up. */
export function sideHead(forwardDeg: number): number[][] {
  const shoulder = [500, 400];
  const a = rad(forwardDeg);
  const ear = add(shoulder, scale([Math.sin(a), -Math.cos(a)], 150));
  return landmarks({ left: { shoulder, ear, nose: add(ear, [40, 10]) } });
}

/** Small deterministic PRNG (mulberry32) for noise in tests. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
