// AnimationManager: which body clips play, at what weight and time. Core keeps clip time and weights
// so every renderer shows the same pose; renderers only apply them (e.g. to three's AnimationMixer).
import type { AnimationRef, AnimationSlot, ClipWeight } from '@squat-overflow/avatar-types';

export type ClipInfo = Pick<AnimationRef, 'durationMs' | 'loop'>;

/** The clips a model has, from its manifest. `idle` is required. */
export type AvatarClips = Readonly<Partial<Record<AnimationSlot, ClipInfo>>>;

/** How long a change of clip takes to blend in. */
export const CLIP_FADE_MS = 300;

/** A fade this close to full counts as done. */
const FADE_DONE = 1e-9;

interface Playing {
  readonly slot: AnimationSlot;
  readonly info: ClipInfo;
  weight: number;
  timeMs: number;
}

export class AnimationManager {
  readonly #clips: AvatarClips;
  #playing: Playing[];
  #target: Playing;

  constructor(clips: AvatarClips) {
    const idle = clips.idle;
    if (!idle) throw new Error('clips: the model must have an idle clip');
    this.#clips = clips;
    this.#target = { slot: 'idle', info: idle, weight: 1, timeMs: 0 };
    this.#playing = [this.#target];
  }

  /** Blends towards `slot`'s clip, or idle when the model doesn't have that clip. */
  play(slot: AnimationSlot): void {
    const info = this.#clips[slot];
    if (!info) {
      this.play('idle');
      return;
    }
    if (slot === this.#target.slot) return;
    const playing = this.#playing.find((p) => p.slot === slot);
    this.#target = playing ?? { slot, info, weight: 0, timeMs: 0 };
    if (!playing) this.#playing.push(this.#target);
  }

  advance(dtMs: number): void {
    for (const p of this.#playing) {
      const { durationMs, loop } = p.info;
      p.timeMs = loop ? (p.timeMs + dtMs) % durationMs : Math.min(p.timeMs + dtMs, durationMs);
    }
    const target = this.#target;
    target.weight = Math.min(1, target.weight + dtMs / CLIP_FADE_MS);
    // Many small steps add up to a hair under 1 (30 × 10/300 = 0.999…); finish the fade on time.
    if (1 - target.weight < FADE_DONE) target.weight = 1;
    // The clips fading out share what's left, keeping their proportions, so weights always sum to 1.
    const others = this.#playing.filter((p) => p !== target);
    const othersTotal = others.reduce((sum, p) => sum + p.weight, 0);
    if (othersTotal === 0) target.weight = 1;
    for (const p of others)
      p.weight = othersTotal > 0 ? (p.weight / othersTotal) * (1 - target.weight) : 0;
    this.#playing = this.#playing.filter((p) => p === target || p.weight > 0);
  }

  /** The clips playing now, with their weights (summing to 1) and positions. */
  clips(): ClipWeight[] {
    return this.#playing.map(({ slot, weight, timeMs }) => ({ slot, weight, timeMs }));
  }
}
