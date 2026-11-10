// ProceduralAnimation: what a living body does without being told. Breathing (its pace depends on
// the state and varies from breath to breath), a slow head drift that never repeats, the posture of
// each state and reaction (listening leans in, thinking tilts the head, sad looks down), and the
// odd acknowledging nod while listening.
import type { HeadRotation, RandomSource, Reaction } from '@squat-overflow/avatar-types';
import { fork } from './random.ts';
import { approach, between, deg } from './smoothing.ts';
import type { Activity } from './state-machine.ts';

/** How long one breath takes in each state, in ms (about 14 a minute at rest). */
export const BREATH_MS: Readonly<Record<Activity, number>> = {
  idle: 4300,
  listening: 4000,
  thinking: 5000,
  speaking: 3600,
};
/** Each breath is up to this much shorter or longer than its state's time. */
export const BREATH_VARIATION = 0.1;
/** The share of a breath spent breathing in. */
export const BREATH_IN = 0.4;

/** The head's drift at its widest (neck and head together). */
export const DRIFT = { yaw: deg(2.5), pitch: deg(1.5), roll: deg(1.2) } as const;
/** How much of the drift each state shows: still while listening or thinking. */
export const DRIFT_SCALE: Readonly<Record<Activity, number>> = {
  idle: 1,
  listening: 0.6,
  thinking: 0.4,
  speaking: 1,
};
/** The neck's share of the drift and nods; the head turns the rest. */
export const NECK_SHARE = 0.4;

export interface Posture {
  readonly neck: HeadRotation;
  readonly head: HeadRotation;
}

const ROTATION = (yaw: number, pitch: number, roll: number): HeadRotation => ({
  yaw: deg(yaw),
  pitch: deg(pitch),
  roll: deg(roll),
});
const NONE = ROTATION(0, 0, 0);

/** Each activity's posture: listening leans in (neck forward, face level) with the head tilted. */
export const POSTURES: Readonly<Record<Activity, Posture>> = {
  idle: { neck: NONE, head: NONE },
  listening: { neck: ROTATION(0, -4, 0), head: ROTATION(0, 2, 3) },
  thinking: { neck: NONE, head: ROTATION(0, 2, 5) },
  speaking: { neck: NONE, head: NONE },
};

/** A reaction's posture, on top of any activity; neutral keeps the activity's. */
export const REACTION_POSTURES: Readonly<Record<Reaction, Posture | null>> = {
  neutral: null,
  happy: { neck: NONE, head: ROTATION(0, 3, 2) },
  sad: { neck: ROTATION(0, -4, 0), head: ROTATION(0, -5, 0) },
  surprised: { neck: ROTATION(0, 1, 0), head: ROTATION(0, 5, 0) },
  confused: { neck: NONE, head: ROTATION(4, 0, -7) },
};
/** Time constant of a change of posture. */
export const POSTURE_SMOOTHING_MS = 300;
/** Time constant of the drift fading in at the start and between states. */
export const DRIFT_SMOOTHING_MS = 500;

/** While listening, a nod starts every so often (ms, start to start). */
export const NOD_INTERVAL_MS = [4000, 9000] as const;
export const NOD_MS = 600;
/** How far the head dips in a nod. */
export const NOD_PITCH = deg(6);
/** Chance that a nod is followed straight away by a second. */
export const DOUBLE_NOD_CHANCE = 0.3;

export interface BodyInput {
  readonly activity: Activity;
  readonly reaction: Reaction | null;
  /** The reaction's intensity, 0 to 1. */
  readonly intensity: number;
}

export interface BodyOutput {
  /** 0 breathed out, 1 breathed in. */
  readonly breath: number;
  readonly neck: HeadRotation;
  readonly head: HeadRotation;
}

/** Drift frequencies in Hz: two slow waves per axis that never line up, so it never repeats. */
const WAVES = { yaw: [0.05, 0.11], pitch: [0.07, 0.13], roll: [0.04, 0.09] } as const;

type Axis = keyof typeof WAVES;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export class ProceduralAnimation {
  readonly #breathRandom: RandomSource;
  readonly #nodRandom: RandomSource;
  readonly #phases: Readonly<Record<Axis, readonly [number, number]>>;
  #now = 0;
  /** Position in the breath now, 0 to 1, and how long this breath takes. */
  #breathPhase = 0;
  #breathMs: number | null = null;
  #drift = 0;
  readonly #neck: Mutable<HeadRotation> = { yaw: 0, pitch: 0, roll: 0 };
  readonly #head: Mutable<HeadRotation> = { yaw: 0, pitch: 0, roll: 0 };
  #nextNodAt: number | null = null;
  #nodStartedAt: number | null = null;
  #secondNod = false;

  constructor(random: RandomSource) {
    this.#breathRandom = fork(random);
    this.#nodRandom = fork(random);
    const phases = fork(random);
    const phase = () => phases.next() * 2 * Math.PI;
    this.#phases = {
      yaw: [phase(), phase()],
      pitch: [phase(), phase()],
      roll: [phase(), phase()],
    };
  }

  update(dtMs: number, { activity, reaction, intensity }: BodyInput): BodyOutput {
    this.#now += dtMs;
    const breath = this.#breathe(dtMs, activity);

    this.#drift = approach(this.#drift, DRIFT_SCALE[activity], dtMs, DRIFT_SMOOTHING_MS);
    const posture = postureFor(activity, reaction, intensity);
    for (const axis of ['yaw', 'pitch', 'roll'] as const) {
      this.#neck[axis] = approach(this.#neck[axis], posture.neck[axis], dtMs, POSTURE_SMOOTHING_MS);
      this.#head[axis] = approach(this.#head[axis], posture.head[axis], dtMs, POSTURE_SMOOTHING_MS);
    }
    const nod = this.#nod(activity === 'listening' && reaction === null);

    const moving = (axis: Axis) => this.#drift * this.#wave(axis) + (axis === 'pitch' ? nod : 0);
    const neck = { yaw: 0, pitch: 0, roll: 0 };
    const head = { yaw: 0, pitch: 0, roll: 0 };
    for (const axis of ['yaw', 'pitch', 'roll'] as const) {
      neck[axis] = this.#neck[axis] + NECK_SHARE * moving(axis);
      head[axis] = this.#head[axis] + (1 - NECK_SHARE) * moving(axis);
    }
    return { breath, neck, head };
  }

  /** One breath: in for BREATH_IN of its time, then out, smooth at both turns. */
  #breathe(dtMs: number, activity: Activity): number {
    this.#breathMs ??= this.#breathLength(activity);
    this.#breathPhase += dtMs / this.#breathMs;
    while (this.#breathPhase >= 1) {
      // The next breath takes the pace of the state it starts in.
      const length = this.#breathLength(activity);
      this.#breathPhase = ((this.#breathPhase - 1) * this.#breathMs) / length;
      this.#breathMs = length;
    }
    const p = this.#breathPhase;
    return p < BREATH_IN
      ? (1 - Math.cos((Math.PI * p) / BREATH_IN)) / 2
      : (1 + Math.cos((Math.PI * (p - BREATH_IN)) / (1 - BREATH_IN))) / 2;
  }

  #breathLength(activity: Activity): number {
    const v = BREATH_VARIATION;
    return BREATH_MS[activity] * between(this.#breathRandom, 1 - v, 1 + v);
  }

  /** -1 to 1: the sum of the axis's two waves. */
  #wave(axis: Axis): number {
    const [f1, f2] = WAVES[axis];
    const [p1, p2] = this.#phases[axis];
    const s = this.#now / 1000;
    return (
      (0.6 * Math.sin(2 * Math.PI * f1 * s + p1) + 0.4 * Math.sin(2 * Math.PI * f2 * s + p2)) *
      DRIFT[axis]
    );
  }

  /** The nod's pitch now (0 or below). A nod under way finishes even if listening stops. */
  #nod(listening: boolean): number {
    if (this.#nodStartedAt !== null && this.#now - this.#nodStartedAt >= NOD_MS) {
      const started = this.#nodStartedAt;
      this.#nodStartedAt = null;
      const twice = !this.#secondNod && this.#nodRandom.next() < DOUBLE_NOD_CHANCE;
      this.#secondNod = twice;
      this.#nextNodAt = twice
        ? started + NOD_MS
        : started + between(this.#nodRandom, ...NOD_INTERVAL_MS);
    }
    if (!listening) {
      this.#nextNodAt = null;
      this.#secondNod = false;
    } else {
      this.#nextNodAt ??= this.#now + between(this.#nodRandom, ...NOD_INTERVAL_MS);
      if (this.#nodStartedAt === null && this.#now >= this.#nextNodAt)
        this.#nodStartedAt = this.#nextNodAt;
    }
    if (this.#nodStartedAt === null) return 0;
    const u = (this.#now - this.#nodStartedAt) / NOD_MS;
    return (-NOD_PITCH * (1 - Math.cos(2 * Math.PI * u))) / 2;
  }
}

/** The posture to move towards: the reaction's, blended over the activity's by its intensity. */
function postureFor(activity: Activity, reaction: Reaction | null, intensity: number): Posture {
  const base = POSTURES[activity];
  const over = reaction === null ? null : REACTION_POSTURES[reaction];
  if (!over) return base;
  const mix = (a: HeadRotation, b: HeadRotation): HeadRotation => ({
    yaw: a.yaw + (b.yaw - a.yaw) * intensity,
    pitch: a.pitch + (b.pitch - a.pitch) * intensity,
    roll: a.roll + (b.roll - a.roll) * intensity,
  });
  return { neck: mix(base.neck, over.neck), head: mix(base.head, over.head) };
}
