/**
 * Build synthetic BlazePose-style landmark lists with exact joint angles
 * (port of server/tests/synthetic.py).
 *
 * Coordinates are built in a 1000x1000 pixel space and normalised, so tests can
 * reason about geometry without a camera.
 */

import { JOINTS, type Joint, type Landmark, type Side, type Vec, type WorldLandmark, add, norm, radians, sub } from '../../src/analysis/geometry';

export const SIZE = 1000;

export type Points = Partial<Record<Side, Partial<Record<Joint, Vec>>>>;

const scale = (k: number, v: readonly number[]): Vec => v.map((x) => k * x);

/**
 * Point at `length` from `center` such that angle(ref, center, point) == deg.
 * Two points satisfy that; `prefer` picks one: "up", "down", "fwd" (+x), "back" (-x).
 */
export function bend(center: Vec, ref: Vec, deg: number, length: number, prefer: 'up' | 'down' | 'fwd' | 'back'): Vec {
  const d = sub(ref, center);
  const n = norm(d);
  const u = d.map((v) => v / n);
  const r = radians(deg);
  const cands = [1, -1].map((s) => {
    const c = Math.cos(s * r);
    const sn = Math.sin(s * r);
    return add(center, scale(length, [c * u[0] - sn * u[1], sn * u[0] + c * u[1]]));
  });
  const key = { up: (p: Vec) => p[1], down: (p: Vec) => -p[1], fwd: (p: Vec) => -p[0], back: (p: Vec) => p[0] }[prefer];
  return key(cands[1]) < key(cands[0]) ? cands[1] : cands[0]; // min() keeps the first on ties
}

/** points: {left: {...}, right: {...}}; a side not given mirrors left at low visibility. */
export function landmarks(points: Points, otherVis = 0.2): Landmark[] {
  const lms: Landmark[] = Array.from({ length: 33 }, () => [0.5, 0.5, 0.9]);
  for (const side of ['left', 'right'] as const) {
    const given = points[side];
    const src = given ?? points.left ?? {};
    const vis = given ? 0.95 : otherVis;
    for (const [joint, idx] of Object.entries(JOINTS[side]) as [Joint, number][]) {
      const p = src[joint];
      if (p !== undefined) lms[idx] = [p[0] / SIZE, p[1] / SIZE, vis];
    }
  }
  return lms;
}

export function squat(kneeDeg: number, leanDeg = 10.0, kneeShift = 0.0): Landmark[] {
  const ankle = [500.0, 900.0];
  const knee = [500.0 + kneeShift, 700.0];
  const hip = bend(knee, ankle, kneeDeg, 200, 'back');
  const lean = radians(leanDeg);
  const shoulder = add(hip, scale(250, [Math.sin(lean), -Math.cos(lean)]));
  const pts = {
    ankle, knee, hip, shoulder,
    heel: [480.0, 915.0], toe: [560.0, 915.0],
    elbow: add(shoulder, [0, 120]), wrist: add(shoulder, [0, 240]),
  };
  return landmarks({ left: pts });
}

export function pushup(elbowDeg: number, hipOffset = 0.0, vertical = false): Landmark[] {
  let shoulder: Vec, hip: Vec, ankle: Vec;
  if (vertical) {
    // standing upright: not a plank
    [shoulder, hip, ankle] = [[500.0, 300], [500.0, 550], [500.0, 900]];
  } else {
    [shoulder, hip, ankle] = [[300.0, 500], [550.0, 520 + hipOffset], [800.0, 540]];
  }
  const elbow = add(shoulder, [0, 110]);
  const wrist = bend(elbow, shoulder, elbowDeg, 110, 'back');
  const pts = {
    shoulder, elbow, wrist, hip, ankle,
    knee: add(hip, ankle).map((v) => v / 2), heel: add(ankle, [10, 0]), toe: add(ankle, [10, 20]),
  };
  return landmarks({ left: pts });
}

export function curl(elbowDeg: number, driftDeg = 5.0, leanDeg = 0.0): Landmark[] {
  const hip = [500.0, 600];
  const lean = radians(leanDeg);
  const shoulder = add(hip, scale(280, [Math.sin(lean), -Math.cos(lean)]));
  const elbow = bend(shoulder, hip, driftDeg, 150, 'fwd');
  const wrist = bend(elbow, shoulder, elbowDeg, 140, 'fwd');
  const pts = {
    shoulder, elbow, wrist, hip,
    knee: add(hip, [0, 200]), ankle: add(hip, [0, 400]), heel: add(hip, [-10, 410]), toe: add(hip, [40, 410]),
  };
  return landmarks({ left: pts });
}

export function press(elbowDeg: number, armsDown = false, rightOffset = 0.0): Landmark[] {
  const sides: Points = {};
  for (const [side, sx, out] of [['left', 600.0, 1], ['right', 400.0, -1]] as const) {
    const shoulder = [sx, 300.0];
    const elbow = add(shoulder, [out * 110, 0]);
    let wrist = bend(elbow, shoulder, elbowDeg, 110, armsDown ? 'down' : 'up');
    if (side === 'right') wrist = add(wrist, [0, rightOffset]);
    sides[side] = {
      shoulder, elbow, wrist, hip: add(shoulder, [0, 260]),
      knee: add(shoulder, [0, 450]), ankle: add(shoulder, [0, 640]),
    };
  }
  return landmarks(sides);
}

/** start -> end -> start following a cosine (natural acceleration). */
export function trajectory(start: number, end: number, frames: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= frames; i++) {
    out.push(start + ((end - start) * (1 - Math.cos((2 * Math.PI * i) / frames))) / 2);
  }
  return out;
}

/**
 * Side-view landmarks -> the same pose filmed from the front.
 *
 * The side view's x (forward/back) becomes depth, so in the image every joint
 * of a leg sits on one vertical line and 2D angles flatten to ~180 degrees.
 * Returns [image landmarks, world landmarks]; world is in the side view's
 * units (angles don't care about scale), centred on x = 0.5.
 */
export function turnToCamera(lms: readonly Landmark[], halfWidth = 0.06): [Landmark[], WorldLandmark[]] {
  const image: Landmark[] = [];
  const world: WorldLandmark[] = [];
  lms.forEach(([x, y], i) => {
    const offset = i < 11 ? 0.0 : i % 2 ? halfWidth : -halfWidth; // odd = left side
    image.push([0.5 + offset, y, 0.95]);
    world.push([offset, y, x - 0.5]);
  });
  return [image, world];
}

/**
 * CPython's `random.Random` (MT19937, `seed(int)` and `uniform`), so noisy test
 * inputs are the very numbers the Python suite used.
 */
export class PyRandom {
  private readonly mt = new Uint32Array(624);
  private mti = 625;

  constructor(seed: number) {
    this.seed(seed);
  }

  seed(seed: number): void {
    // random.seed(n) for a small non-negative int: init_by_array([n])
    const key = [Math.abs(seed) >>> 0];
    this.initGenrand(19650218);
    const mt = this.mt;
    let i = 1;
    let j = 0;
    for (let k = Math.max(624, key.length); k; k--) {
      mt[i] = ((mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1664525)) >>> 0) + key[j] + j;
      i++;
      j++;
      if (i >= 624) {
        mt[0] = mt[623];
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (let k = 623; k; k--) {
      mt[i] = ((mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1566083941)) >>> 0) - i;
      i++;
      if (i >= 624) {
        mt[0] = mt[623];
        i = 1;
      }
    }
    mt[0] = 0x80000000;
  }

  private initGenrand(s: number): void {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < 624; i++) mt[i] = Math.imul(1812433253, mt[i - 1] ^ (mt[i - 1] >>> 30)) + i;
    this.mti = 624;
  }

  private genrandInt32(): number {
    const mt = this.mt;
    if (this.mti >= 624) {
      for (let kk = 0; kk < 624; kk++) {
        const y = (mt[kk] & 0x80000000) | (mt[(kk + 1) % 624] & 0x7fffffff);
        mt[kk] = mt[(kk + 397) % 624] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      this.mti = 0;
    }
    let y = mt[this.mti++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** random.random(): 53-bit float in [0, 1). */
  random(): number {
    const a = this.genrandInt32() >>> 5;
    const b = this.genrandInt32() >>> 6;
    return (a * 67108864.0 + b) * (1.0 / 9007199254740992.0);
  }

  uniform(a: number, b: number): number {
    return a + (b - a) * this.random();
  }
}
