import type { AvatarState, EyeCentres, HeadRotation, Vec3 } from '@squat-overflow/avatar-types';
import { describe, expect, it } from 'vitest';
import {
  EYES_ALONE,
  EYE_RANGE,
  HEAD_TURN_RANGE,
  BLINK_CLOSE_MS,
  BLINK_INTERVAL_MS,
  BLINK_MS,
  BLINK_HOLD_WIDE,
  DOUBLE_BLINK_CHANCE,
  EyeController,
  type EyeInput,
  type EyeOutput,
} from './eyes.ts';
import { SeededRandom } from './testing/fakes.ts';

const FRAME = 1000 / 60;
const EYES: EyeCentres = { left: [0.03, 1.69, 0.137], right: [-0.03, 1.69, 0.137] };
const STILL: HeadRotation = { yaw: 0, pitch: 0, roll: 0 };

function input(over: Partial<EyeInput> = {}): EyeInput {
  return { mode: 'idle', target: null, head: STILL, eyeWide: 0, ...over };
}

/** Runs `ms` of frames and calls `each(t, out)` after every frame (t = time after that frame). */
function run(
  eyes: EyeController,
  ms: number,
  over: Partial<EyeInput> | ((t: number) => Partial<EyeInput>) = {},
  each: (t: number, out: EyeOutput) => void = () => undefined,
  stepMs = FRAME,
  start = 0
): EyeOutput {
  let out = eyes.update(0, input(typeof over === 'function' ? over(start) : over));
  for (let t = start + stepMs; t <= start + ms + 1e-9; t += stepMs) {
    out = eyes.update(stepMs, input(typeof over === 'function' ? over(t) : over));
    each(t, out);
  }
  return out;
}

/** Times (ms) at which a blink is first seen, frame by frame. */
function blinkStarts(eyes: EyeController, ms: number, over: Partial<EyeInput> = {}): number[] {
  const starts: number[] = [];
  let closed = false;
  run(eyes, ms, over, (t, out) => {
    if (out.blink > 0 && !closed) starts.push(t);
    closed = out.blink > 0;
  });
  return starts;
}

describe('EyeController: blinks', () => {
  it('starts with the eyes open and blinks first between 2 and 6 s in', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const eyes = new EyeController(new SeededRandom(seed), EYES);
      expect(eyes.update(0, input()).blink).toBe(0);
      const [first] = blinkStarts(eyes, 7000);
      expect(first).toBeGreaterThanOrEqual(BLINK_INTERVAL_MS[0]);
      expect(first).toBeLessThanOrEqual(BLINK_INTERVAL_MS[1] + FRAME);
    }
  });

  it('closes fully and opens again within BLINK_MS, closing faster than it opens', () => {
    const eyes = new EyeController(new SeededRandom(7), EYES);
    const [first = 0] = blinkStarts(eyes, 7000);
    const fresh = new EyeController(new SeededRandom(7), EYES);
    const samples: [number, number][] = [];
    run(
      fresh,
      first + BLINK_MS + 100,
      {},
      (t, out) => {
        if (t >= first - FRAME) samples.push([t, out.blink]);
      },
      1
    );

    const peak = samples.reduce((a, b) => (b[1] > a[1] ? b : a));
    expect(peak[1]).toBeCloseTo(1, 2);
    const shut = samples.filter(([, w]) => w > 0);
    const opened = shut.at(-1)?.[0] ?? 0;
    expect(opened - (shut[0]?.[0] ?? 0)).toBeLessThanOrEqual(BLINK_MS);
    expect(peak[0] - (shut[0]?.[0] ?? 0)).toBeLessThan(opened - peak[0]);
    expect(peak[0] - (shut[0]?.[0] ?? 0)).toBeLessThanOrEqual(BLINK_CLOSE_MS);
  });

  it('blinks every 2 to 6 s over an hour, sometimes twice in a row', () => {
    const starts = blinkStarts(new EyeController(new SeededRandom(11), EYES), 3_600_000);
    const gaps = starts.slice(1).map((t, i) => t - (starts[i] ?? 0));
    const doubles = gaps.filter((g) => g < 1000);
    const singles = gaps.filter((g) => g >= 1000);

    for (const gap of singles) {
      expect(gap).toBeGreaterThanOrEqual(BLINK_INTERVAL_MS[0] - FRAME);
      expect(gap).toBeLessThanOrEqual(BLINK_INTERVAL_MS[1] + FRAME);
    }
    for (const gap of doubles) expect(gap).toBeLessThanOrEqual(BLINK_MS + 100);
    // About DOUBLE_BLINK_CHANCE of the blinks get a second one.
    expect(doubles.length / singles.length).toBeGreaterThan(DOUBLE_BLINK_CHANCE * 0.7);
    expect(doubles.length / singles.length).toBeLessThan(DOUBLE_BLINK_CHANCE * 1.3);
    // About 15 a minute (4 s apart on average, plus the doubles).
    expect(starts.length / 60).toBeGreaterThan(14);
    expect(starts.length / 60).toBeLessThan(19);
  });

  it("doesn't blink while the eyes are wide, and blinks soon after they relax", () => {
    const eyes = new EyeController(new SeededRandom(3), EYES);
    const wide: number[] = [];
    run(eyes, 10_000, { eyeWide: BLINK_HOLD_WIDE }, (_t, out) => wide.push(out.blink));
    expect(Math.max(...wide)).toBe(0);

    const starts = blinkStarts(eyes, 1000, { eyeWide: BLINK_HOLD_WIDE / 2 });
    expect(starts[0]).toBeLessThanOrEqual(FRAME);
  });
});

const DEG = Math.PI / 180;

/** Where an eye at `from` must point to look at `to`, in avatar space. */
function aim(from: Vec3, to: Vec3) {
  const [dx, dy, dz] = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  return { yaw: Math.atan2(dx, dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

/** Where an eye points in avatar space: its own turn plus the head's. */
function looking(out: EyeOutput, side: 'left' | 'right', head: HeadRotation = STILL) {
  return {
    yaw: out[side].yaw + out.headTurn.yaw + head.yaw,
    pitch: out[side].pitch + out.headTurn.pitch + head.pitch,
  };
}

describe('EyeController: looking at a point', () => {
  const eyes = () => new EyeController(new SeededRandom(5), EYES);

  it('points each eye at the target once it has turned there', () => {
    const target: Vec3 = [0.3, 1.5, 1.2];
    const out = run(eyes(), 2000, { target });

    for (const side of ['left', 'right'] as const) {
      const want = aim(EYES[side], target);
      const got = looking(out, side);
      expect(got.yaw).toBeCloseTo(want.yaw, 3);
      expect(got.pitch).toBeCloseTo(want.pitch, 3);
    }
  });

  it('converges on a near point: the left eye turns right and the right eye left', () => {
    const out = run(eyes(), 1000, { target: [0, 1.69, 0.35] });

    expect(out.left.yaw).toBeLessThan(-4 * DEG);
    expect(out.right.yaw).toBeGreaterThan(4 * DEG);
    expect(out.left.yaw).toBeCloseTo(-out.right.yaw, 6);
  });

  it("doesn't go cross-eyed for a point at or inside the eyes", () => {
    for (const target of [
      [0, 1.69, 0.137],
      [0, 1.69, 0.14],
      [0.01, 1.7, 0.137],
    ] as Vec3[]) {
      const out = run(eyes(), 500, { target });
      for (const side of ['left', 'right'] as const) {
        expect(Number.isFinite(out[side].yaw) && Number.isFinite(out[side].pitch)).toBe(true);
        expect(Math.abs(out[side].yaw)).toBeLessThanOrEqual(EYE_RANGE.yaw);
      }
    }
  });

  it('moves only the eyes for a small shift', () => {
    const turns: number[] = [];
    // 10° to the left and 6° up of straight ahead, 1 m away.
    const target: Vec3 = [Math.tan(10 * DEG), 1.69 + Math.tan(6 * DEG), 1.137];
    run(eyes(), 2000, { target }, (_t, out) => turns.push(out.headTurn.yaw, out.headTurn.pitch));

    expect(Math.max(...turns.map(Math.abs))).toBe(0);
  });

  it('leads with the eyes on a big shift; the head follows and the eyes turn back as it comes round', () => {
    const e = eyes();
    const target: Vec3 = [Math.sin(40 * DEG), 1.69, 0.137 + Math.cos(40 * DEG)];
    const early = run(e, 60, { target });
    expect(early.left.yaw).toBeGreaterThan(25 * DEG);
    expect(early.headTurn.yaw).toBeLessThan(10 * DEG);

    const late = run(e, 2000, { target }, () => undefined, FRAME, 60);
    expect(late.headTurn.yaw).toBeCloseTo(aim(EYES.left, target).yaw - EYES_ALONE.yaw, 1);
    expect(late.left.yaw).toBeLessThan(early.left.yaw);
    expect(looking(late, 'left').yaw).toBeCloseTo(aim(EYES.left, target).yaw, 3);
  });

  it('keeps the eyes and head within their range, wherever the target is', () => {
    const e = eyes();
    for (let yaw = -180; yaw < 180; yaw += 30) {
      for (const pitch of [-80, -40, 0, 40, 80]) {
        const d = [
          Math.sin(yaw * DEG) * Math.cos(pitch * DEG),
          Math.sin(pitch * DEG),
          Math.cos(yaw * DEG) * Math.cos(pitch * DEG),
        ];
        const target: Vec3 = [d[0] ?? 0, 1.69 + (d[1] ?? 0), 0.137 + (d[2] ?? 0)];
        run(e, 600, { target }, (_t, out) => {
          for (const side of ['left', 'right'] as const) {
            expect(Math.abs(out[side].yaw)).toBeLessThanOrEqual(EYE_RANGE.yaw + 1e-9);
            expect(Math.abs(out[side].pitch)).toBeLessThanOrEqual(EYE_RANGE.pitch + 1e-9);
          }
          expect(Math.abs(out.headTurn.yaw)).toBeLessThanOrEqual(HEAD_TURN_RANGE.yaw + 1e-9);
          expect(Math.abs(out.headTurn.pitch)).toBeLessThanOrEqual(HEAD_TURN_RANGE.pitch + 1e-9);
          expect(out.headTurn.roll).toBe(0);
        });
      }
    }
  });

  it('keeps looking at the target while the head nods and drifts', () => {
    const e = eyes();
    const target: Vec3 = [0.1, 1.6, 1.1];
    const head = (t: number): HeadRotation => ({
      yaw: 3 * DEG * Math.sin(t / 700),
      pitch: -6 * DEG * Math.sin(t / 150),
      roll: 0,
    });
    run(e, 1000, { target });
    run(
      e,
      3000,
      (t) => ({ target, head: head(t) }),
      (t, out) => {
        const got = looking(out, 'left', head(t));
        expect(got.yaw).toBeCloseTo(aim(EYES.left, target).yaw, 3);
        expect(got.pitch).toBeCloseTo(aim(EYES.left, target).pitch, 3);
      },
      FRAME,
      1000
    );
  });
});

describe('EyeController: the gaze of each state', () => {
  /** Where the eyes point (both eyes' average, head included), frame by frame. */
  function gaze(eyes: EyeController, ms: number, over: Partial<EyeInput>, start = 0) {
    const seen: { t: number; yaw: number; pitch: number }[] = [];
    run(
      eyes,
      ms,
      over,
      (t, out) => {
        const l = looking(out, 'left');
        const r = looking(out, 'right');
        seen.push({ t, yaw: (l.yaw + r.yaw) / 2, pitch: (l.pitch + r.pitch) / 2 });
      },
      FRAME,
      start
    );
    return seen;
  }
  /** On the viewer's face, 1 m in front: their eyes 32 mm either side, their mouth 70 mm lower. */
  const contact = (d: { yaw: number; pitch: number }) =>
    Math.abs(d.yaw) <= 2.5 * DEG && d.pitch >= -4.5 * DEG && d.pitch <= 0.5 * DEG;
  /** Moments the gaze jumps somewhere new. */
  const jumps = (seen: { yaw: number; pitch: number }[]) =>
    seen.filter((d, i) => {
      const a = seen[i - 1];
      const b = seen[i - 2];
      if (!a || !b) return false;
      const move = Math.hypot(d.yaw - a.yaw, d.pitch - a.pitch);
      const before = Math.hypot(a.yaw - b.yaw, a.pitch - b.pitch);
      return move > 0.2 * DEG && before < 0.05 * DEG;
    }).length;

  it.each(['listening', 'reacting'] as const)(
    '%s: keeps eye contact, moving between the viewer’s eyes and mouth',
    (mode: AvatarState) => {
      const seen = gaze(new EyeController(new SeededRandom(9), EYES), 20_000, { mode });

      expect(seen.filter((d) => d.t > 150).every(contact)).toBe(true);
      // A new point on the face every 0.6 to 2 s.
      expect(jumps(seen)).toBeGreaterThanOrEqual(20_000 / 2000 - 1);
      expect(jumps(seen)).toBeLessThanOrEqual(20_000 / 600);
    }
  );

  it('thinking: looks up and to one side, the same side all the way through', () => {
    const sides = new Set<number>();
    for (let seed = 1; seed <= 20; seed++) {
      const seen = gaze(new EyeController(new SeededRandom(seed), EYES), 10_000, {
        mode: 'thinking',
      }).filter((d) => d.t > 500);
      expect(seen.every((d) => d.pitch >= 6 * DEG && Math.abs(d.yaw) >= 6 * DEG)).toBe(true);
      const side = new Set(seen.map((d) => Math.sign(d.yaw)));
      expect(side.size).toBe(1);
      sides.add([...side][0] ?? 0);
    }
    expect([...sides].sort()).toEqual([-1, 1]);
  });

  it('idle: looks around, within range, and back at the viewer now and then', () => {
    const seen = gaze(new EyeController(new SeededRandom(21), EYES), 120_000, { mode: 'idle' });
    const met = seen.filter(contact).length / seen.length;

    for (const d of seen) {
      expect(Math.abs(d.yaw)).toBeLessThanOrEqual(20.5 * DEG);
      expect(d.pitch).toBeGreaterThanOrEqual(-10.5 * DEG);
      expect(d.pitch).toBeLessThanOrEqual(6.5 * DEG);
    }
    expect(met).toBeGreaterThan(0.1);
    expect(met).toBeLessThan(0.6);
    // Each look lasts 1 to 3.5 s.
    expect(jumps(seen)).toBeGreaterThanOrEqual(120_000 / 3500 - 2);
    expect(jumps(seen)).toBeLessThanOrEqual(120_000 / 1000);
  });

  it('speaking: mostly eye contact, with glances away', () => {
    const seen = gaze(new EyeController(new SeededRandom(4), EYES), 120_000, { mode: 'speaking' });
    const met = seen.filter(contact).length / seen.length;

    expect(met).toBeGreaterThan(0.5);
    expect(met).toBeLessThan(0.9);
  });

  it('looks the new way straight away when the state changes', () => {
    const eyes = new EyeController(new SeededRandom(2), EYES);
    let t = 0;
    let away = false;
    for (; !away && t < 60_000; t += 1000) {
      away = !contact(gaze(eyes, 1000, { mode: 'idle' }, t).at(-1) ?? { yaw: 0, pitch: 0 });
    }
    expect(away).toBe(true);

    const after = gaze(eyes, 300, { mode: 'listening' }, t);
    expect(after.filter((d) => d.t - t > 150).every(contact)).toBe(true);
  });

  it("goes back to the state's own gaze when the target is cleared", () => {
    const eyes = new EyeController(new SeededRandom(2), EYES);
    gaze(eyes, 1000, { mode: 'listening', target: [0.6, 1.69, 0.6] });

    const after = gaze(eyes, 300, { mode: 'listening', target: null }, 1000);
    expect(after.filter((d) => d.t - 1000 > 150).every(contact)).toBe(true);
  });

  it("doesn't flick through looks it missed while a target was set", () => {
    const eyes = new EyeController(new SeededRandom(2), EYES);
    gaze(eyes, 1000, { mode: 'listening' });
    gaze(eyes, 59_000, { mode: 'listening', target: [0.6, 1.69, 0.6] }, 1000);

    const after = gaze(eyes, 1000, { mode: 'listening', target: null }, 60_000);
    // Back on the viewer and holding still: a look lasts at least 600 ms.
    const held = after.filter((d) => d.t - 60_000 > 200 && d.t - 60_000 < 550);
    for (const [i, d] of held.entries()) {
      const a = held[i - 1];
      if (a) expect(Math.hypot(d.yaw - a.yaw, d.pitch - a.pitch)).toBeLessThan(0.01 * DEG);
    }
  });
});
