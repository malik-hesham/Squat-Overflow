import type { AnimationSlot } from '@squat-overflow/avatar-types';
import { describe, expect, it } from 'vitest';
import { AnimationManager, CLIP_FADE_MS, type AvatarClips } from './animation.ts';

const CLIPS: AvatarClips = {
  idle: { durationMs: 1000, loop: true },
  listening: { durationMs: 2000, loop: true },
  thinking: { durationMs: 1500, loop: true },
  'react.happy': { durationMs: 800, loop: false },
};

/** slot → weight (rounded) and slot → time, for the clips playing now. */
function weights(animation: AnimationManager): Partial<Record<AnimationSlot, number>> {
  return Object.fromEntries(
    animation.clips().map((c) => [c.slot, Math.round(c.weight * 1000) / 1000])
  );
}
function times(animation: AnimationManager): Partial<Record<AnimationSlot, number>> {
  return Object.fromEntries(animation.clips().map((c) => [c.slot, c.timeMs]));
}

describe('AnimationManager', () => {
  it('fades between clips over 300 ms', () => {
    expect(CLIP_FADE_MS).toBe(300);
  });

  it('plays idle at full weight from the start, and a looping clip wraps around', () => {
    const animation = new AnimationManager(CLIPS);
    expect(weights(animation)).toEqual({ idle: 1 });

    animation.advance(1250);

    expect(times(animation)).toEqual({ idle: 250 });
  });

  it('holds a clip that does not loop on its last pose', () => {
    const animation = new AnimationManager(CLIPS);
    animation.play('react.happy');

    animation.advance(2000);

    expect(animation.clips()).toEqual([{ slot: 'react.happy', weight: 1, timeMs: 800 }]);
  });

  it('crossfades to a new clip over 300 ms, starting it from the beginning', () => {
    const animation = new AnimationManager(CLIPS);
    animation.advance(400);
    animation.play('listening');

    animation.advance(150);
    expect(weights(animation)).toEqual({ idle: 0.5, listening: 0.5 });
    expect(times(animation)).toEqual({ idle: 550, listening: 150 });

    animation.advance(150);
    expect(weights(animation)).toEqual({ listening: 1 });
  });

  it('finishes a fade on time when it runs in many small frames (no floating-point leftovers)', () => {
    const animation = new AnimationManager(CLIPS);
    animation.play('listening');

    for (let i = 0; i < 30; i++) animation.advance(10);

    expect(animation.clips()).toEqual([{ slot: 'listening', weight: 1, timeMs: 300 }]);
  });

  it('plays idle for a clip the model does not have', () => {
    const animation = new AnimationManager(CLIPS);
    animation.play('listening');
    animation.advance(CLIP_FADE_MS);

    animation.play('talking');
    animation.advance(CLIP_FADE_MS);

    expect(weights(animation)).toEqual({ idle: 1 });
  });

  it('changing clip mid-fade never jumps: weights sum to 1 and the new clip only grows', () => {
    const animation = new AnimationManager(CLIPS);
    animation.play('listening');
    animation.advance(100);
    animation.play('thinking');

    let previous = 0;
    for (let step = 0; step < 8; step++) {
      animation.advance(50);
      const w = weights(animation);
      const total = Object.values(w).reduce((sum, x) => sum + x, 0);
      expect(total).toBeCloseTo(1, 2);
      expect(w.thinking).toBeGreaterThanOrEqual(previous);
      previous = w.thinking ?? 0;
    }
    expect(weights(animation)).toEqual({ thinking: 1 });
  });

  it('keeps the time of a clip that comes back while it is still fading out', () => {
    const animation = new AnimationManager(CLIPS);
    animation.advance(600);
    animation.play('listening');
    animation.advance(100);

    // idle is still at 2/3 weight, so it's back to full after 100 ms more; look halfway.
    animation.play('idle');
    animation.advance(50);

    expect(times(animation)).toEqual({ idle: 750, listening: 150 });
    expect(weights(animation)).toEqual({ idle: 0.833, listening: 0.167 });
  });

  it('needs an idle clip', () => {
    expect(() => new AnimationManager({ listening: { durationMs: 1000, loop: true } })).toThrow(
      'clips: the model must have an idle clip'
    );
  });
});
