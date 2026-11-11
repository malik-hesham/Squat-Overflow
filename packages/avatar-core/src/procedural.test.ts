import type { HeadRotation } from '@squat-overflow/avatar-types';
import { describe, expect, it } from 'vitest';
import {
  BREATH_MS,
  BREATH_VARIATION,
  DRIFT,
  NOD_INTERVAL_MS,
  POSTURES,
  REACTION_POSTURES,
  ProceduralAnimation,
  type BodyInput,
  type BodyOutput,
} from './procedural.ts';
import { SeededRandom } from './testing/fakes.ts';

const FRAME = 1000 / 60;
const DEG = Math.PI / 180;

function input(over: Partial<BodyInput> = {}): BodyInput {
  return { activity: 'idle', reaction: null, intensity: 1, ...over };
}

/** Frames for `ms`; `each(t, out)` after every frame. */
function run(
  body: ProceduralAnimation,
  ms: number,
  over: Partial<BodyInput> | ((t: number) => Partial<BodyInput>) = {},
  each: (t: number, out: BodyOutput) => void = () => undefined,
  start = 0
): BodyOutput {
  const at = (t: number) => input(typeof over === 'function' ? over(t) : over);
  let out = body.update(0, at(start));
  for (let t = start + FRAME; t <= start + ms + 1e-9; t += FRAME) {
    out = body.update(FRAME, at(t));
    each(t, out);
  }
  return out;
}

/** Neck and head together. */
const total = (o: BodyOutput): HeadRotation => ({
  yaw: o.neck.yaw + o.head.yaw,
  pitch: o.neck.pitch + o.head.pitch,
  roll: o.neck.roll + o.head.roll,
});

/** Times at which each breath starts (the breath turns from out to in). */
function breathStarts(body: ProceduralAnimation, ms: number, over: Partial<BodyInput> = {}) {
  const starts: number[] = [];
  let last = -1;
  let falling = true;
  run(body, ms, over, (t, out) => {
    if (falling && out.breath > last && last >= 0) starts.push(t);
    falling = out.breath < last || (falling && out.breath === last);
    last = out.breath;
  });
  return starts;
}

describe('ProceduralAnimation: breathing', () => {
  it('starts breathed out and breathes between 0 and 1, about 14 times a minute at rest', () => {
    const body = new ProceduralAnimation(new SeededRandom(1));
    expect(body.update(0, input()).breath).toBe(0);
    const values: number[] = [];
    run(body, 60_000, {}, (_t, out) => values.push(out.breath));

    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThanOrEqual(1);
    expect(Math.max(...values)).toBeGreaterThan(0.99);
    const breaths = breathStarts(new ProceduralAnimation(new SeededRandom(1)), 60_000).length + 1;
    expect(breaths).toBeGreaterThanOrEqual(12);
    expect(breaths).toBeLessThanOrEqual(16);
  });

  it('breathes in faster than out', () => {
    const body = new ProceduralAnimation(new SeededRandom(2));
    const [next = 0] = breathStarts(
      new ProceduralAnimation(new SeededRandom(2)),
      BREATH_MS.idle * 1.5
    );
    let peakAt = 0;
    let peak = 0;
    run(body, next, {}, (t, out) => {
      if (out.breath > peak) [peak, peakAt] = [out.breath, t];
    });
    // In until the peak, out from there to the next breath.
    expect(peakAt).toBeGreaterThan(0);
    expect(peakAt).toBeLessThan(next - peakAt);
  });

  it('takes each breath in its state’s time, give or take BREATH_VARIATION', () => {
    for (const activity of ['idle', 'listening', 'thinking', 'speaking'] as const) {
      const starts = breathStarts(new ProceduralAnimation(new SeededRandom(3)), 120_000, {
        activity,
      });
      const lengths = starts.slice(1).map((t, i) => t - (starts[i] ?? 0));
      const base = BREATH_MS[activity];
      for (const length of lengths) {
        expect(length).toBeGreaterThanOrEqual(base * (1 - BREATH_VARIATION) - 2 * FRAME);
        expect(length).toBeLessThanOrEqual(base * (1 + BREATH_VARIATION) + 2 * FRAME);
      }
      expect(new Set(lengths.map(Math.round)).size).toBeGreaterThan(lengths.length / 2);
    }
    expect(BREATH_MS.thinking).toBeGreaterThan(BREATH_MS.idle);
    expect(BREATH_MS.speaking).toBeLessThan(BREATH_MS.idle);
  });

  it('keeps breathing smoothly when the state changes', () => {
    const activities = ['idle', 'speaking', 'thinking', 'listening'] as const;
    const most =
      (Math.PI / (2 * 0.4 * Math.min(...Object.values(BREATH_MS)) * (1 - BREATH_VARIATION))) *
      FRAME;
    let last = 0;
    run(
      new ProceduralAnimation(new SeededRandom(4)),
      30_000,
      (t) => ({
        activity: activities[Math.floor(t / 700) % 4] ?? 'idle',
      }),
      (_t, out) => {
        expect(Math.abs(out.breath - last)).toBeLessThanOrEqual(most + 1e-9);
        last = out.breath;
      }
    );
  });
});

describe('ProceduralAnimation: head', () => {
  it('starts from the rest pose and comes alive smoothly', () => {
    const body = new ProceduralAnimation(new SeededRandom(5));
    const first = body.update(0, input());
    expect(first.neck).toEqual({ yaw: 0, pitch: 0, roll: 0 });
    expect(first.head).toEqual({ yaw: 0, pitch: 0, roll: 0 });

    let last = total(first);
    let moved = 0;
    run(body, 10_000, {}, (_t, out) => {
      const now = total(out);
      const step = Math.hypot(now.yaw - last.yaw, now.pitch - last.pitch, now.roll - last.roll);
      // No faster than 6° a second: a slow sway, never a jump.
      expect(step).toBeLessThan(0.1 * DEG);
      moved = Math.max(moved, Math.abs(now.yaw));
      last = now;
    });
    expect(moved).toBeGreaterThan(0.3 * DEG);
  });

  it('drifts within DRIFT at rest, never the same twice', () => {
    // The widest the head goes on each axis, checked once at the end: an expect() on each of the
    // 36,000 frames made this test time out on a busy CI runner.
    const widest = { yaw: 0, pitch: 0, roll: 0 };
    const yaws: number[] = [];
    run(new ProceduralAnimation(new SeededRandom(6)), 600_000, {}, (_t, out) => {
      const now = total(out);
      widest.yaw = Math.max(widest.yaw, Math.abs(now.yaw));
      widest.pitch = Math.max(widest.pitch, Math.abs(now.pitch));
      widest.roll = Math.max(widest.roll, Math.abs(now.roll));
      yaws.push(now.yaw);
    });
    expect(widest.yaw).toBeLessThanOrEqual(DRIFT.yaw + 1e-9);
    expect(widest.pitch).toBeLessThanOrEqual(DRIFT.pitch + 1e-9);
    expect(widest.roll).toBeLessThanOrEqual(DRIFT.roll + 1e-9);
    // Two minutes apart, the head is somewhere else.
    const at = (ms: number) => yaws[Math.round(ms / FRAME)] ?? 0;
    expect(Math.abs(at(130_000) - at(10_000))).toBeGreaterThan(0.01 * DEG);
  });

  it('drifts differently for another seed', () => {
    const a = run(new ProceduralAnimation(new SeededRandom(1)), 5000);
    const b = run(new ProceduralAnimation(new SeededRandom(2)), 5000);
    expect(total(a).yaw).not.toBeCloseTo(total(b).yaw, 4);
  });

  it('listening: leans in with the head tilted, nodding every 4 to 9 s', () => {
    const body = new ProceduralAnimation(new SeededRandom(7));
    const nods: number[] = [];
    let down = false;
    const settled = run(body, 2000, { activity: 'listening' });
    expect(settled.neck.pitch).toBeCloseTo(POSTURES.listening.neck.pitch, 1);
    expect(settled.head.roll).toBeCloseTo(POSTURES.listening.head.roll, 1);

    run(
      body,
      180_000,
      { activity: 'listening' },
      (t, out) => {
        const dipped = out.head.pitch < POSTURES.listening.head.pitch - 3 * DEG;
        if (dipped && !down) nods.push(t);
        down = dipped;
      },
      2000
    );
    const gaps = nods.slice(1).map((t, i) => t - (nods[i] ?? 0));
    const apart = gaps.filter((g) => g > 1500);
    expect(apart.length).toBeGreaterThan(180_000 / NOD_INTERVAL_MS[1] - 2);
    for (const gap of apart) {
      expect(gap).toBeGreaterThanOrEqual(NOD_INTERVAL_MS[0] - FRAME);
      expect(gap).toBeLessThanOrEqual(NOD_INTERVAL_MS[1] + FRAME);
    }
    // Some nods come twice in a row.
    expect(gaps.some((g) => g <= 1500)).toBe(true);
  });

  it("doesn't nod in the other states", () => {
    for (const activity of ['idle', 'thinking', 'speaking'] as const) {
      run(new ProceduralAnimation(new SeededRandom(8)), 60_000, { activity }, (_t, out) => {
        expect(out.head.pitch).toBeGreaterThan(POSTURES[activity].head.pitch - 2 * DEG);
      });
    }
  });

  it('thinking: tilts the head', () => {
    const out = run(new ProceduralAnimation(new SeededRandom(9)), 3000, { activity: 'thinking' });
    expect(total(out).roll).toBeCloseTo(POSTURES.thinking.head.roll, 1);
    expect(POSTURES.thinking.head.roll).toBeGreaterThan(3 * DEG);
  });

  it('reactions: sad lowers the head, surprised raises it, scaled by intensity', () => {
    const settle = (over: Partial<BodyInput>) =>
      total(run(new ProceduralAnimation(new SeededRandom(10)), 3000, over)).pitch;

    expect(settle({ reaction: 'sad' })).toBeLessThan(-5 * DEG);
    expect(settle({ reaction: 'surprised' })).toBeGreaterThan(3 * DEG);
    // Same seed, same drift: what's left is the reaction's posture.
    const rest = settle({});
    expect(settle({ reaction: 'sad', intensity: 0.5 }) - rest).toBeCloseTo(
      (settle({ reaction: 'sad' }) - rest) / 2,
      3
    );
  });

  it('a neutral reaction keeps the posture of the activity underneath', () => {
    expect(REACTION_POSTURES.neutral).toBeNull();
    const out = run(new ProceduralAnimation(new SeededRandom(11)), 3000, {
      activity: 'listening',
      reaction: 'neutral',
    });
    expect(out.neck.pitch).toBeCloseTo(POSTURES.listening.neck.pitch, 1);
  });
});
