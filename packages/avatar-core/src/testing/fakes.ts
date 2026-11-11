// In-memory stand-ins for the platform ports, for tests (here and in the renderer packages).
import type { AudioPlayback, AudioPort, MonotonicClock } from '@squat-overflow/avatar-types';

/** Repeatable random numbers: the same seed gives the same blinks, glances and drift. */
export { SeededRandom } from '../random.ts';

/** A clock that only moves when told to. */
export class FakeClock implements MonotonicClock {
  #now = 0;

  now(): number {
    return this.#now;
  }

  advance(ms: number): void {
    this.#now += ms;
  }
}

/** One playback; the test decides when it ends, fails, or what position it reports. */
export class FakePlayback implements AudioPlayback {
  readonly url: string;
  readonly finished: Promise<'ended' | 'stopped'>;
  position = 0;
  stopCalls = 0;
  #resolve: (how: 'ended' | 'stopped') => void = () => undefined;
  #reject: (error: unknown) => void = () => undefined;

  constructor(url: string) {
    this.url = url;
    this.finished = new Promise((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;
    });
  }

  positionMs(): number {
    return this.position;
  }

  stop(): void {
    this.stopCalls++;
    this.#resolve('stopped');
  }

  /** The audio played to its end. */
  end(): void {
    this.#resolve('ended');
  }

  /** The audio couldn't be loaded or played. */
  fail(error: unknown): void {
    this.#reject(error);
  }
}

export class FakeAudio implements AudioPort {
  readonly played: FakePlayback[] = [];
  /** Set to make the next play() throw straight away. */
  throwOnPlay: Error | undefined = undefined;

  play(url: string): FakePlayback {
    if (this.throwOnPlay !== undefined) throw this.throwOnPlay;
    const playback = new FakePlayback(url);
    this.played.push(playback);
    return playback;
  }

  /** The most recent playback. */
  get last(): FakePlayback {
    const playback = this.played.at(-1);
    if (!playback) throw new Error('nothing was played');
    return playback;
  }
}

/** Lets promise callbacks (audio settling, command outcomes) run. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
