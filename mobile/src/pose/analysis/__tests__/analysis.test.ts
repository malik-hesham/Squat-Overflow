/**
 * Rep counting, workout form rules, 3D angles and calibration (port of
 * server/tests/test_analysis.py and server/tests/test_calibration_3d.py).
 */

import { Calibrator, validate } from '../../../../../extension/lib/pose/calibration.js';
import { EXERCISES } from '../../../../../extension/lib/pose/exercises.js';
import { Pose, angle, angleFromHorizontal, angleFromVertical } from '../../../../../extension/lib/pose/geometry.js';
import { type FrameResult, type RepEvent, Session } from '../../../../../extension/lib/pose/session.js';
import * as syn from './synthetic';

type Frame = number[][];

function feed(session: Session, frames: Frame[], fps: number, startT = 0): FrameResult[] {
  return frames.map((lm, i) => session.process(lm, syn.SIZE, syn.SIZE, startT + i / fps));
}

function repsOf(build: (a: number) => Frame, rest: number, target: number, n = 3, seconds = 2.0, fps = 30): Frame[] {
  return Array.from({ length: n }, () => syn.trajectory(rest, target, Math.trunc(seconds * fps)).map((a) => build(a))).flat();
}

const events = (results: FrameResult[]): RepEvent[] => results.flatMap((r) => (r.rep_event ? [r.rep_event] : []));
const last = (results: FrameResult[]): FrameResult => results[results.length - 1];

describe('geometry', () => {
  it('angle basics', () => {
    expect(angle([1, 0], [0, 0], [0, 1])).toBeCloseTo(90);
    expect(angle([-1, 0], [0, 0], [1, 0])).toBeCloseTo(180);
    expect(angleFromVertical([0, 0], [0, -5])).toBeCloseTo(0);
    expect(angle([1, 1], [1, 1], [2, 2])).toBe(180); // zero-length arm
  });

  it('helpers work in 3D', () => {
    const o = [0, 0, 0];
    expect(angleFromVertical(o, [0, -1, 0])).toBeCloseTo(0);
    expect(angleFromVertical(o, [0, 0, 1])).toBeCloseTo(90); // towards the camera
    // A line going away from the camera is horizontal, even though it's vertical-free in x.
    expect(angleFromHorizontal(o, [0, 0, 1])).toBeCloseTo(0);
    expect(angleFromHorizontal(o, [1, -1, 0])).toBeCloseTo(45);
    expect(angleFromHorizontal([0, 0], [1, 1])).toBeCloseTo(45); // 2D unchanged
  });

  it('visibility defaults to 1 when a landmark has none', () => {
    const p = new Pose(Array.from({ length: 33 }, () => [0.5, 0.5]), 100, 100);
    expect(p.vis('left', 'knee')).toBe(1);
  });

  it.each([60, 95, 140, 175])('the synthetic squat builder is exact (%p)', (deg) => {
    expect(new Session('squat').process(syn.squat(deg), syn.SIZE, syn.SIZE, 0).angle).toBeCloseTo(deg, 0);
  });
});

describe('squat', () => {
  it('counts clean reps', () => {
    const results = feed(new Session('squat'), repsOf(syn.squat, 172, 80), 30);
    const ev = events(results);
    expect(ev.map((e) => e.index)).toEqual([1, 2, 3]);
    expect(ev.every((e) => e.issues.length === 0 && e.score === 100)).toBe(true);
    const s = last(results).summary;
    expect([s.reps, s.good_reps, s.partial_reps]).toEqual([3, 3, 0]);
    expect(Math.abs((s.avg_rom ?? 0) - 92)).toBeLessThanOrEqual(3);
  });

  it('flags a partial rep without counting it', () => {
    const results = feed(new Session('squat'), repsOf(syn.squat, 172, 125, 1), 30);
    const ev = events(results);
    expect(ev).toHaveLength(1);
    expect(ev[0].partial).toBe(true);
    expect(ev[0].issues[0]).toBe('not_deep_enough');
    expect(ev[0].issue_text[0]).toBe('Go through the full range of motion');
    expect([last(results).summary.reps, last(results).summary.partial_reps]).toEqual([0, 1]);
  });

  it('ignores a small wobble', () => {
    expect(events(feed(new Session('squat'), repsOf(syn.squat, 172, 150, 2), 30))).toEqual([]);
  });

  it('attributes forward lean and knees past toes to the rep', () => {
    const [lean] = events(feed(new Session('squat'), repsOf((a) => syn.squat(a, 60), 172, 80, 1), 30));
    expect(lean.issues).toContain('chest_up');
    expect(lean.score).toBeLessThan(100);
    const [knees] = events(feed(new Session('squat'), repsOf((a) => syn.squat(a, 10, 200), 172, 80, 1), 30));
    expect(knees.issues).toContain('knees_past_toes');
  });

  it('flags a rushed rep as too fast', () => {
    const [ev] = events(feed(new Session('squat'), repsOf(syn.squat, 172, 80, 1, 0.5), 30));
    expect(ev.issues).toContain('too_fast');
  });

  it('does not double count jitter at the rest threshold', () => {
    const rand = syn.rng(1);
    const frames = [...repsOf(syn.squat, 172, 80, 2), ...Array.from({ length: 60 }, () => syn.squat(160 + rand() * 8 - 4))];
    expect(last(feed(new Session('squat'), frames, 30)).summary.reps).toBe(2);
  });

  it('asks the user to step back when nobody (or only a faint body) is in view', () => {
    const missing = new Session('squat').process(null, 640, 480, 0);
    expect(missing.feedback[0].code).toBe('not_visible');
    expect(missing.angle).toBeNull();
    const faint = syn.squat(170).map(([x, y]) => [x, y, 0.1]);
    expect(new Session('squat').process(faint, syn.SIZE, syn.SIZE, 0).feedback[0].code).toBe('not_visible');
  });
});

describe('push-up, curl and press', () => {
  it('push-up counts, and detects sagging and piking hips', () => {
    expect(last(feed(new Session('pushup'), repsOf(syn.pushup, 170, 80, 2), 30)).summary.good_reps).toBe(2);
    const [sag] = events(feed(new Session('pushup'), repsOf((a) => syn.pushup(a, 80), 170, 80, 1), 30));
    expect(sag.issues).toContain('hips_sag');
    const [pike] = events(feed(new Session('pushup'), repsOf((a) => syn.pushup(a, -120), 170, 80, 1), 30));
    expect(pike.issues).toContain('hips_pike');
  });

  it('push-up is not counted when standing', () => {
    const results = feed(new Session('pushup'), repsOf((a) => syn.pushup(a, 0, true), 170, 80, 2), 30);
    expect(last(results).summary.reps).toBe(0);
    expect(last(results).feedback[0].code).toBe('not_plank');
  });

  it('curl counts, and detects elbow drift and swinging', () => {
    expect(last(feed(new Session('curl'), repsOf(syn.curl, 165, 40), 30)).summary.good_reps).toBe(3);
    const [drift] = events(feed(new Session('curl'), repsOf((a) => syn.curl(a, 50), 165, 40, 1), 30));
    expect(drift.issues).toContain('elbow_drift');
    const [swing] = events(feed(new Session('curl'), repsOf((a) => syn.curl(a, 5, 22), 165, 40, 1), 30));
    expect(swing.issues).toContain('swinging');
  });

  it('press counts with an inverted direction, ignores hanging arms, flags uneven arms', () => {
    expect(last(feed(new Session('press'), repsOf(syn.press, 90, 172), 30)).summary.good_reps).toBe(3);
    expect(last(feed(new Session('press'), repsOf((a) => syn.press(a, true), 90, 172, 2), 30)).summary.reps).toBe(0);
    const [uneven] = events(feed(new Session('press'), repsOf((a) => syn.press(a, false, 90), 90, 172, 1), 30));
    expect(uneven.issues).toContain('uneven_press');
  });

  it('summarises the most common issues, ties in first-seen order', () => {
    const frames = [...repsOf((a) => syn.squat(a, 60), 172, 80, 2), ...repsOf((a) => syn.squat(a, 10, 200), 172, 80, 1)];
    const top = last(feed(new Session('squat'), frames, 30)).summary.top_issues;
    expect(top.map((t) => [t.code, t.count])).toEqual([
      ['chest_up', 2],
      ['knees_past_toes', 1],
    ]);
  });
});

describe('session controls', () => {
  it('reset and switch exercise; unknown keys throw', () => {
    const s = new Session('squat');
    feed(s, repsOf(syn.squat, 172, 80, 2), 30);
    s.setExercise('curl');
    const out = s.process(syn.curl(165), syn.SIZE, syn.SIZE, 100);
    expect(out.exercise).toBe('curl');
    expect(out.summary.reps).toBe(0);
    expect(() => s.setExercise('burpee')).toThrow(/unknown exercise/);
    expect(() => new Session('burpee')).toThrow(/unknown exercise/);
  });

  it('defaults to the squat, like the Python Session', () => {
    expect(new Session().exercise.key).toBe('squat');
  });
});

// --- 3D world landmarks -----------------------------------------------------------------

const FPS_3D = 15;

function frontSquatFrames(low: number, reps = 3, frames = 30): [Frame, Frame][] {
  return Array.from({ length: reps }, () => syn.trajectory(170, low, frames).map((d) => syn.turnToCamera(syn.squat(d)))).flat();
}

function run3d(session: Session, frames: [Frame, Frame][], startT = 0): FrameResult[] {
  return frames.map(([img, world], i) => session.process(img, syn.SIZE, syn.SIZE, startT + i / FPS_3D, world));
}

describe('3D angles', () => {
  it('counts a squat filmed from the front, where 2D cannot', () => {
    const frames = frontSquatFrames(95);
    const flat = run3d(new Session('sit_to_stand'), frames);
    expect(last(flat).summary.reps).toBe(0); // 2D sees a straight leg the whole time
    expect(Math.min(...flat.map((r) => r.angle as number))).toBeGreaterThan(170);
    expect(flat[0].angle_mode).toBe('2d');

    const deep = run3d(new Session('sit_to_stand', true), frames);
    expect(last(deep).summary.reps).toBe(3);
    expect(deep[0].angle_mode).toBe('3d');
    expect(Math.min(...deep.map((r) => r.angle as number))).toBeLessThan(110);
    // The other mode's reading travels along for the UI's comparison line.
    expect(Math.min(...deep.map((r) => r.angle_alt as number))).toBeGreaterThan(170);
  });

  it('falls back to 2D without world landmarks', () => {
    const out = new Session('sit_to_stand', true).process(syn.squat(100), syn.SIZE, syn.SIZE, 0);
    expect(out.angle_mode).toBe('2d');
    expect(out.angle_alt).toBeNull();
    expect(Math.abs((out.angle as number) - 100)).toBeLessThanOrEqual(1);
  });

  it('switching the angle mode drops calibration', () => {
    const s = new Session('sit_to_stand');
    s.setExercise('sit_to_stand', { rest: 150, target: 125 });
    s.setAngleMode(true);
    expect(s.useWorld).toBe(true);
    expect(s.thresholds).toBeNull();
    expect(s.exercise.rest).toBe(155);
  });
});

// --- calibration ---------------------------------------------------------------------------

function sideSquats(low: number, high = 170, reps = 3, frames = 30): Frame[] {
  return Array.from({ length: reps }, () => syn.trajectory(high, low, frames).map((d) => syn.squat(d))).flat();
}

describe('calibration', () => {
  it('learns a shallow range that then counts', () => {
    // Sit-to-stand needs the knee to reach 110 by default; this person only gets to 130.
    const shallow = sideSquats(130);
    expect(last(feed(new Session('sit_to_stand'), shallow, FPS_3D)).summary.reps).toBe(0);

    const s = new Session('sit_to_stand');
    s.startCalibration();
    const out = feed(s, shallow, FPS_3D);
    const statuses = out.flatMap((r) => (r.calibration ? [r.calibration] : []));
    expect(statuses[0]).toEqual({ status: 'recording', reps: 0, needed: 3 });
    const done = statuses[statuses.length - 1];
    if (done.status !== 'done') throw new Error(`calibration ${done.status}`);
    expect(done.reps).toBe(3);
    // restRef ~170, depth ~40 -> rest ~160, target ~140
    expect(Math.abs(done.rest - 160)).toBeLessThanOrEqual(2);
    expect(Math.abs(done.target - 140)).toBeLessThanOrEqual(2);
    expect(last(out).summary.reps).toBe(0); // calibration reps are not counted
    expect(last(out).thresholds.calibrated).toBe(true);
    expect(s.calibrator).toBeNull();

    expect(last(feed(s, shallow, FPS_3D, 100)).summary.reps).toBe(3);
  });

  it('works for exercises whose angle grows', () => {
    const cal = new Calibrator(EXERCISES.overhead_reach); // rest 60 -> target 135
    for (let k = 0; k < 3; k++) for (const v of syn.trajectory(30, 110, 30)) cal.update(v);
    const th = cal.result();
    expect(th).not.toBeNull();
    expect(Math.abs(th!.rest - (30 + 0.25 * 80))).toBeLessThanOrEqual(1);
    expect(Math.abs(th!.target - (30 + 0.75 * 80))).toBeLessThanOrEqual(1);
  });

  it('ignores jitter and tracks the real rest position', () => {
    const cal = new Calibrator(EXERCISES.sit_to_stand);
    for (const v of [150, 152, 168, 170, 169, 171, 170]) cal.update(v); // starts mid-way, settles at ~170
    expect(cal.reps).toBe(0);
    for (let i = 0; i < 50; i++) cal.update(170 + 2 * Math.sin(i)); // +-2 degrees of noise
    expect(cal.reps).toBe(0);
    for (const v of syn.trajectory(171, 120, 30)) cal.update(v);
    expect(cal.reps).toBe(1);
    expect(Math.abs(cal.depths[0] - 51)).toBeLessThanOrEqual(1);
  });

  it.each([
    [150, 120, true],
    [120, 150, false],
    [150, 149, false],
    [200, 120, false],
    ['150', 120, false],
    [true, 120, false],
    [null, 120, false],
    [NaN, 120, false],
    [Infinity, 120, false],
  ])('validate(%p, %p) accepted: %p', (rest, target, ok) => {
    expect(validate(EXERCISES.sit_to_stand, rest, target) !== null).toBe(ok);
  });
});
