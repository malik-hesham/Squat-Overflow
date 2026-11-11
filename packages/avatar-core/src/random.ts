// Random numbers inside core. Clients pass one RandomSource (Math.random, or a seeded one in tests);
// each layer forks its own stream from it, so blinks don't shift when, say, the gaze draws one more
// number, and the same seed gives the same avatar at any frame rate.
import type { RandomSource } from '@squat-overflow/avatar-types';

/** Repeatable random numbers (mulberry32). */
export class SeededRandom implements RandomSource {
  #state: number;

  constructor(seed: number) {
    this.#state = seed >>> 0;
  }

  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

/** A stream of its own, seeded from `random`. */
export function fork(random: RandomSource): RandomSource {
  return new SeededRandom(Math.floor(random.next() * 4294967296));
}
