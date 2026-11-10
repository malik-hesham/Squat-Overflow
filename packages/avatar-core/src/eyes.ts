// EyeController: blinking and gaze. Blinks come at random intervals, sometimes twice, and wait while
// the eyes are wide (surprised). The eyes jump to what they look at (saccades); the head follows
// slowly for big shifts and the eyes turn back as it comes round, so the gaze stays on target, also
// while the procedural layer moves the head.
import type {
  AvatarState,
  EyeCentres,
  EyeRotation,
  HeadRotation,
  RandomSource,
  Vec3,
} from '@squat-overflow/avatar-types';
import { fork } from './random.ts';
import { approach, between, clamp, deg, smoothstep } from './smoothing.ts';

/** Time from the start of one blink to the next, in ms (uniformly random in this range). */
export const BLINK_INTERVAL_MS = [2000, 6000] as const;
/** Lids close quickly and open more slowly. */
export const BLINK_CLOSE_MS = 70;
export const BLINK_OPEN_MS = 150;
export const BLINK_MS = BLINK_CLOSE_MS + BLINK_OPEN_MS;
/** Chance that a blink is followed straight away by a second one. */
export const DOUBLE_BLINK_CHANCE = 0.15;
/** Gap between the two blinks of a double blink. */
export const DOUBLE_BLINK_GAP_MS = 50;
/** No blink starts while the face's eyeWide weight is at least this (surprised). */
export const BLINK_HOLD_WIDE = 0.4;

/** How far the eyes turn from the head's direction (about a human eye's comfortable range). */
export const EYE_RANGE = { yaw: deg(30), pitch: deg(25) } as const;
/** Shifts the eyes make on their own; the head takes whatever is beyond this. */
export const EYES_ALONE = { yaw: deg(12), pitch: deg(8) } as const;
/** How far the gaze turns the head (on top of the procedural head). */
export const HEAD_TURN_RANGE = { yaw: deg(35), pitch: deg(20) } as const;
/** Time constant of an eye jump: a saccade is 95% done in about 60 ms. */
export const SACCADE_MS = 20;
/** Time constant of the head following the gaze. */
export const HEAD_FOLLOW_MS = 250;
/** The eyes can't focus nearer than this; a closer target is looked at from this far. */
export const NEAREST_FOCUS_M = 0.1;

/**
 * Where the user is: 1 m straight in front of the avatar's eyes (renderers put the camera at eye
 * height). Eye contact moves between the user's eyes (64 mm apart) and their mouth (70 mm lower),
 * the way people look at a face.
 */
export const VIEWER_DISTANCE_M = 1;
const VIEWER_FACE: readonly (readonly [x: number, y: number, chance: number])[] = [
  [0.032, 0, 0.4],
  [-0.032, 0, 0.4],
  [0, -0.07, 0.2],
];

/**
 * How each state looks around when no target is set: each look ("fixation") is at the user with
 * the chance `contact`, otherwise somewhere in the yaw and pitch ranges (degrees, at the user's
 * distance), and lasts `holdMs`. Thinking looks up and to one side, the same side all through.
 */
export interface GazeStyle {
  readonly contact: number;
  readonly yaw: readonly [number, number];
  readonly pitch: readonly [number, number];
  readonly holdMs: readonly [number, number];
  /** Looks away keep to one side, picked at random each time the state starts. */
  readonly oneSide: boolean;
}

export const GAZE_STYLES: Readonly<Record<AvatarState, GazeStyle>> = {
  idle: { contact: 0.3, yaw: [-20, 20], pitch: [-10, 6], holdMs: [1000, 3500], oneSide: false },
  listening: { contact: 1, yaw: [0, 0], pitch: [0, 0], holdMs: [600, 2000], oneSide: false },
  thinking: { contact: 0, yaw: [10, 20], pitch: [8, 15], holdMs: [1500, 3000], oneSide: true },
  speaking: { contact: 0.7, yaw: [-15, 15], pitch: [-8, 4], holdMs: [800, 2500], oneSide: false },
  reacting: { contact: 1, yaw: [0, 0], pitch: [0, 0], holdMs: [600, 2000], oneSide: false },
};

export interface EyeInput {
  /** The state the avatar shows; each has its own way of looking. */
  readonly mode: AvatarState;
  /** A point to look at (setGaze), or null for the mode's own gaze. */
  readonly target: Vec3 | null;
  /** How the procedural layer turns the head (neck and head added), before the gaze's share. */
  readonly head: HeadRotation;
  /** The face's eyeWide weight now, 0 to 1. */
  readonly eyeWide: number;
}

export interface EyeOutput {
  /** Eye turns relative to the head. */
  readonly left: EyeRotation;
  readonly right: EyeRotation;
  /** The part of the gaze the head takes (added to the procedural head). */
  readonly headTurn: HeadRotation;
  /** 0 open, 1 closed; both eyes blink together. */
  readonly blink: number;
}

interface Direction {
  yaw: number;
  pitch: number;
}

export class EyeController {
  readonly #blinks: Blinks;
  readonly #random: RandomSource;
  readonly #eyes: EyeCentres;
  readonly #middle: Vec3;
  /** Where each eye points now, in avatar space (head included). */
  readonly #left: Direction = { yaw: 0, pitch: 0 };
  readonly #right: Direction = { yaw: 0, pitch: 0 };
  /** The head's share of the gaze now. */
  readonly #follow: Direction = { yaw: 0, pitch: 0 };
  #now = 0;
  /** The state's own look now; null until the first update. */
  #look: { readonly mode: AvatarState; readonly point: Vec3; readonly until: number } | null = null;
  /** Thinking looks to this side: 1 the avatar's left, -1 its right. */
  #side = 1;

  constructor(random: RandomSource, eyes: EyeCentres) {
    this.#blinks = new Blinks(fork(random));
    this.#random = fork(random);
    this.#eyes = eyes;
    this.#middle = [
      (eyes.left[0] + eyes.right[0]) / 2,
      (eyes.left[1] + eyes.right[1]) / 2,
      (eyes.left[2] + eyes.right[2]) / 2,
    ];
  }

  update(dtMs: number, input: EyeInput): EyeOutput {
    const blink = this.#blinks.update(dtMs, input.eyeWide < BLINK_HOLD_WIDE);
    this.#now += dtMs;
    const point = input.target === null ? this.#own(input.mode, dtMs) : this.#focus(input.target);

    const both = direction(this.#middle, point);
    approachDirection(this.#left, direction(this.#eyes.left, point), dtMs, SACCADE_MS);
    approachDirection(this.#right, direction(this.#eyes.right, point), dtMs, SACCADE_MS);
    approachDirection(this.#follow, headShare(both), dtMs, HEAD_FOLLOW_MS);

    // The eyes make up the difference between the gaze and where the head points.
    const headYaw = input.head.yaw + this.#follow.yaw;
    const headPitch = input.head.pitch + this.#follow.pitch;
    const relative = (d: Direction): EyeRotation => ({
      yaw: clamp(d.yaw - headYaw, -EYE_RANGE.yaw, EYE_RANGE.yaw),
      pitch: clamp(d.pitch - headPitch, -EYE_RANGE.pitch, EYE_RANGE.pitch),
    });
    return {
      left: relative(this.#left),
      right: relative(this.#right),
      headTurn: { yaw: this.#follow.yaw, pitch: this.#follow.pitch, roll: 0 },
      blink,
    };
  }

  /** The state's own look: a new one when the state changes or the last one has lasted its time. */
  #own(mode: AvatarState, dtMs: number): Vec3 {
    const look = this.#look;
    if (look && look.mode === mode && this.#now < look.until) return look.point;
    const style = GAZE_STYLES[mode];
    if (style.oneSide && look?.mode !== mode) this.#side = this.#random.next() < 0.5 ? 1 : -1;
    // Back to back when the last look ended during this frame, so looks keep time at any frame
    // rate; from now after a new state or a set target (missed looks are skipped, not replayed).
    const due = look?.mode === mode && look.until >= this.#now - dtMs;
    const start = due ? look.until : this.#now;
    const point = this.#random.next() < style.contact ? this.#atViewer() : this.#away(style);
    this.#look = { mode, point, until: start + between(this.#random, ...style.holdMs) };
    return point;
  }

  /** A point on the user's face. */
  #atViewer(): Vec3 {
    const [x, y, z] = this.#middle;
    let pick = this.#random.next();
    for (const [dx, dy, chance] of VIEWER_FACE) {
      pick -= chance;
      if (pick < 0) return [x + dx, y + dy, z + VIEWER_DISTANCE_M];
    }
    return [x, y, z + VIEWER_DISTANCE_M];
  }

  /** A point away from the user, in the style's range, at the user's distance. */
  #away(style: GazeStyle): Vec3 {
    const side = style.oneSide ? this.#side : 1;
    const yaw = deg(between(this.#random, ...style.yaw)) * side;
    const pitch = deg(between(this.#random, ...style.pitch));
    const [x, y, z] = this.#middle;
    const r = VIEWER_DISTANCE_M;
    return [
      x + r * Math.sin(yaw) * Math.cos(pitch),
      y + r * Math.sin(pitch),
      z + r * Math.cos(yaw) * Math.cos(pitch),
    ];
  }

  /** The target, moved out to the nearest focus distance when it's closer than that. */
  #focus(target: Vec3): Vec3 {
    const [mx, my, mz] = this.#middle;
    const d = [target[0] - mx, target[1] - my, target[2] - mz] as const;
    const length = Math.hypot(...d);
    if (length >= NEAREST_FOCUS_M) return target;
    if (length === 0) return [mx, my, mz + NEAREST_FOCUS_M];
    const k = NEAREST_FOCUS_M / length;
    return [mx + d[0] * k, my + d[1] * k, mz + d[2] * k];
  }
}

/** The direction from `from` to `to` (yaw to the avatar's left, pitch up). */
function direction(from: Vec3, to: Vec3): Direction {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  return { yaw: Math.atan2(dx, dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

function approachDirection(current: Direction, goal: Direction, dtMs: number, tauMs: number) {
  current.yaw = approach(current.yaw, goal.yaw, dtMs, tauMs);
  current.pitch = approach(current.pitch, goal.pitch, dtMs, tauMs);
}

/** The head's share of a gaze: what is beyond EYES_ALONE, up to HEAD_TURN_RANGE. */
function headShare(gaze: Direction): Direction {
  const share = (angle: number, alone: number, range: number) =>
    clamp(angle - clamp(angle, -alone, alone), -range, range);
  return {
    yaw: share(gaze.yaw, EYES_ALONE.yaw, HEAD_TURN_RANGE.yaw),
    pitch: share(gaze.pitch, EYES_ALONE.pitch, HEAD_TURN_RANGE.pitch),
  };
}

class Blinks {
  readonly #random: RandomSource;
  #now = 0;
  #nextAt: number;
  /** When the blink showing now started, or null. */
  #startedAt: number | null = null;
  /** The blink showing now is the second of a double blink. */
  #second = false;

  constructor(random: RandomSource) {
    this.#random = random;
    this.#nextAt = between(random, ...BLINK_INTERVAL_MS);
  }

  update(dtMs: number, allowed: boolean): number {
    const before = this.#now;
    this.#now += dtMs;
    if (this.#startedAt !== null && this.#now - this.#startedAt >= BLINK_MS) {
      const started = this.#startedAt;
      this.#startedAt = null;
      const double = !this.#second && this.#random.next() < DOUBLE_BLINK_CHANCE;
      this.#second = double;
      this.#nextAt = double
        ? started + BLINK_MS + DOUBLE_BLINK_GAP_MS
        : started + between(this.#random, ...BLINK_INTERVAL_MS);
    }
    if (this.#startedAt === null && this.#now >= this.#nextAt && allowed) {
      // On time when it was due during this frame; now, when it had to wait for the eyes to relax.
      this.#startedAt = Math.max(this.#nextAt, before);
    }
    if (this.#startedAt === null) return 0;
    const t = this.#now - this.#startedAt;
    return t < BLINK_CLOSE_MS
      ? smoothstep(t / BLINK_CLOSE_MS)
      : 1 - smoothstep((t - BLINK_CLOSE_MS) / BLINK_OPEN_MS);
  }
}
