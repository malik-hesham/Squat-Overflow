/**
 * Pose geometry helpers (port of server/analysis/geometry.py).
 *
 * BlazePose returns landmarks normalised to [0, 1] on each axis. Angles must be
 * computed in pixel space, otherwise a non-square frame skews every angle, so
 * `Pose` scales x by width and y by height before any maths happens.
 *
 * It also returns *world* landmarks: 3D points in meters, origin between the
 * hips, axes aligned with the image (x right, y down, z away from the camera).
 * With `useWorld = true`, `Pose.pt` returns those 3D points instead, so every
 * angle helper below measures the real joint angle rather than its projection
 * on the image. All helpers accept 2D or 3D points.
 *
 * Also home to the small Python-compatibility helpers (`pyRound`, `pySum`, ...)
 * the analysis layer uses so its numbers match the Python server exactly.
 */

export type Side = 'left' | 'right';
export type Joint =
  | 'nose'
  | 'ear'
  | 'shoulder'
  | 'elbow'
  | 'wrist'
  | 'index'
  | 'hip'
  | 'knee'
  | 'ankle'
  | 'heel'
  | 'toe';

/** A point in pixels (2D) or meters (3D). */
export type Vec = number[];
/** [x, y, visibility], x and y normalised to 0..1. */
export type Landmark = readonly number[];
/** [x, y, z] in meters, origin between the hips, y grows downward. */
export type WorldLandmark = readonly number[];

// BlazePose landmark indices (33-point topology). Key order matches the Python dicts.
export const JOINTS: Readonly<Record<Side, Readonly<Record<Joint, number>>>> = {
  left: { nose: 0, ear: 7, shoulder: 11, elbow: 13, wrist: 15, index: 19, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31 },
  right: { nose: 0, ear: 8, shoulder: 12, elbow: 14, wrist: 16, index: 20, hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32 },
};

// Skeleton edges, for clients that want to draw the pose.
export const CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];

// --- Python compatibility -------------------------------------------------

/**
 * Python's `round(x, ndigits)`: the exact binary value rounded to `ndigits`
 * decimals, exact ties going to the even digit (JS `Math.round` rounds half up
 * and `toFixed` rounds ties away from zero).
 */
export function pyRound(x: number, ndigits = 0): number {
  if (!Number.isInteger(ndigits) || ndigits < 0 || ndigits > 20) {
    throw new RangeError(`pyRound: unsupported ndigits ${ndigits}`);
  }
  if (!Number.isFinite(x)) return x;
  const ax = Math.abs(x);
  if (ax >= 2 ** 52) return x; // already an integer
  // toFixed works on the exact binary value. 100 digits hold the full expansion
  // of any double >= 2^-48; anything smaller cannot be an exact tie at <= 20 digits.
  const exact = ax.toFixed(100);
  const dot = exact.indexOf('.');
  const cut = ndigits === 0 ? dot : dot + 1 + ndigits;
  const tail = exact.slice(dot + 1 + ndigits);
  let r: number;
  if (/^50*$/.test(tail)) {
    const kept = exact.slice(0, cut);
    const last = Number(kept[kept.length - 1]);
    r = last % 2 === 0 ? Number(kept) : Number(ax.toFixed(ndigits));
  } else {
    r = Number(ax.toFixed(ndigits));
  }
  const signed = x < 0 ? -r : r;
  return ndigits === 0 ? signed + 0 : signed; // round(x) is an int in Python: no -0
}

/** Python 3.12+ `sum()` of floats (Neumaier compensated summation). */
export function pySum(xs: Iterable<number>): number {
  let total = 0;
  let c = 0;
  for (const x of xs) {
    const t = total + x;
    if (Math.abs(total) >= Math.abs(x)) c += total - t + x;
    else c += x - t + total;
    total = t;
  }
  if (c !== 0 && Number.isFinite(c)) total += c;
  return total;
}

/** `math.degrees` (CPython multiplies by 180/pi). */
export function degrees(rad: number): number {
  return rad * (180.0 / Math.PI);
}

/** `math.radians` (CPython multiplies by pi/180). */
export function radians(deg: number): number {
  return deg * (Math.PI / 180.0);
}

// --- vectors --------------------------------------------------------------

export function sub(a: readonly number[], b: readonly number[]): Vec {
  return a.map((v, i) => v - b[i]);
}

export function add(a: readonly number[], b: readonly number[]): Vec {
  return a.map((v, i) => v + b[i]);
}

export function dot(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** `np.linalg.norm` of a vector. */
export function norm(a: readonly number[]): number {
  return Math.sqrt(dot(a, a));
}

// --- pose -----------------------------------------------------------------

export class Pose {
  constructor(
    readonly landmarks: ReadonlyArray<Landmark>,
    readonly width: number,
    readonly height: number,
    readonly world: ReadonlyArray<WorldLandmark> | null = null,
    /** true (and world given): pt() returns 3D points in meters */
    readonly useWorld = false,
  ) {}

  get is3d(): boolean {
    return this.useWorld && this.world !== null;
  }

  pt(side: Side, joint: Joint): Vec {
    if (this.useWorld && this.world !== null) {
      return this.world[JOINTS[side][joint]].slice(0, 3);
    }
    return this.pt2d(side, joint);
  }

  /** Always the image-space point in pixels. */
  pt2d(side: Side, joint: Joint): Vec {
    const lm = this.landmarks[JOINTS[side][joint]];
    return [lm[0] * this.width, lm[1] * this.height];
  }

  vis(side: Side, joint: Joint): number {
    const lm = this.landmarks[JOINTS[side][joint]];
    return lm.length > 2 ? lm[2] : 1.0;
  }
}

/** Interior angle ABC in degrees (0..180). */
export function angle(a: readonly number[], b: readonly number[], c: readonly number[]): number {
  const ba = sub(a, b);
  const bc = sub(c, b);
  const denom = norm(ba) * norm(bc);
  if (denom < 1e-9) return 180.0;
  const cos = Math.min(1.0, Math.max(-1.0, dot(ba, bc) / denom));
  return degrees(Math.acos(cos));
}

/**
 * Angle (0..180) between the vector start->end and straight up.
 * Image and world y both grow downwards, so "up" is -y in 2D and 3D.
 */
export function angleFromVertical(start: readonly number[], end: readonly number[]): number {
  const up = start.map(() => 0);
  up[1] = -1.0;
  return angle(add(start, up), start, end);
}

/** Angle (0..90) between the line start-end and the horizontal (the x-z plane in 3D). */
export function angleFromHorizontal(start: readonly number[], end: readonly number[]): number {
  const d = sub(end, start).map(Math.abs);
  const flat = d.length > 2 ? Math.hypot(d[0], d[2]) : d[0];
  return degrees(Math.atan2(d[1], flat));
}

/** Exponential moving average used to de-jitter joint angles. */
export class Ema {
  value: number | null = null;

  constructor(readonly alpha = 0.5) {}

  /** Python's `ema(x)`. */
  update(x: number): number {
    this.value = this.value === null ? x : this.alpha * x + (1 - this.alpha) * this.value;
    return this.value;
  }

  reset(): void {
    this.value = null;
  }
}
