// What avatar-core needs from the platform. Core has no DOM, Node or React Native globals (no
// performance.now, setTimeout, Math.random-by-default, Audio), so each client passes these in.
// That is also what makes core deterministic under test.

/** Milliseconds from an arbitrary start; never goes backwards (performance.now() on the web). */
export interface MonotonicClock {
  now(): number;
}

/** Uniform random numbers in [0, 1). Seeded in tests. */
export interface RandomSource {
  next(): number;
}

/** Plays the avatar's speech audio (Web Audio on the web, expo-audio on mobile). */
export interface AudioPort {
  /** Starts loading and playing `url` straight away. */
  play(url: string): AudioPlayback;
}

export interface AudioPlayback {
  /**
   * Where the audio the user hears is now, in ms from its start, output latency included. Lip sync
   * reads this every frame, so the mouth follows stalls, pauses and seeks of the real audio.
   */
  positionMs(): number;
  /**
   * Settles once: 'ended' when the audio played to its end, 'stopped' after stop(). Rejects when the
   * audio can't be loaded or played.
   */
  readonly finished: Promise<'ended' | 'stopped'>;
  /** Stops playback. `finished` then settles with 'stopped'. Safe to call more than once. */
  stop(): void;
}
