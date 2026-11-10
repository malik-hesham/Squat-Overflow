import { describe, expect, it } from 'vitest';
import { SeededRandom } from './fakes.ts';

describe('SeededRandom', () => {
  it('gives the same sequence for the same seed, in [0, 1)', () => {
    const a = new SeededRandom(42);
    const b = new SeededRandom(42);
    const first = Array.from({ length: 1000 }, () => a.next());

    expect(Array.from({ length: 1000 }, () => b.next())).toEqual(first);
    expect(first.every((n) => n >= 0 && n < 1)).toBe(true);
    expect(new Set(first).size).toBeGreaterThan(990);
  });

  it('gives another sequence for another seed', () => {
    expect(new SeededRandom(1).next()).not.toBe(new SeededRandom(2).next());
  });
});
