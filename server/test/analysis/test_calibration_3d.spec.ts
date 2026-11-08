// Port of server/tests/test_calibration_3d.py: 3D world-landmark angles and per-user calibration.
// test_world_y_is_aligned_with_image_y belongs to the pose engine (pose_engine.align_world_y)
// and is not part of the analysis layer.
import * as calibration from '../../src/analysis/calibration';
import { Calibrator, Thresholds } from '../../src/analysis/calibration';
import { EXERCISES, type Exercise } from '../../src/analysis/exercises';
import { type Landmark, type WorldLandmark, angleFromHorizontal, angleFromVertical } from '../../src/analysis/geometry';
import { type FrameResult, Session } from '../../src/analysis/session';
import { expectApprox } from './approx';
import * as syn from './synthetic';

const FPS = 15;

const ex = (key: string): Exercise => {
  const e = EXERCISES.get(key);
  if (e === undefined) throw new Error(`no exercise ${key}`);
  return e;
};

const last = (results: FrameResult[]): FrameResult => results[results.length - 1];

test('geometry helpers work in 3D', () => {
  const o = [0, 0, 0];
  expectApprox(angleFromVertical(o, [0.0, -1.0, 0.0]), 0);
  expectApprox(angleFromVertical(o, [0.0, 0.0, 1.0]), 90); // towards the camera
  // A line going away from the camera is horizontal, even though it's vertical-free in x.
  expectApprox(angleFromHorizontal(o, [0.0, 0.0, 1.0]), 0);
  expectApprox(angleFromHorizontal(o, [1.0, -1.0, 0.0]), 45);
  expectApprox(angleFromHorizontal([0, 0], [1.0, 1.0]), 45); // 2D unchanged
});

type Frame3d = [Landmark[], WorldLandmark[]];

function frontSquatFrames(low: number, reps = 3, frames = 30): Frame3d[] {
  const out: Frame3d[] = [];
  for (let k = 0; k < reps; k++) {
    out.push(...syn.trajectory(170, low, frames).map((d) => syn.turnToCamera(syn.squat(d))));
  }
  return out;
}

function run(session: Session, frames: Frame3d[], startT = 0.0): FrameResult[] {
  return frames.map(([img, world], i) => session.process(img, syn.SIZE, syn.SIZE, startT + i / FPS, world));
}

const angles = (results: FrameResult[], key: 'angle' | 'angle_alt'): number[] =>
  results.map((r) => {
    const v = r[key];
    if (v === null) throw new Error(`${key} is null`);
    return v;
  });

test('3D counts a squat filmed from the front where 2D cannot', () => {
  const frames = frontSquatFrames(95);

  const flat = run(new Session('sit_to_stand'), frames);
  expect(last(flat).summary.reps).toBe(0); // 2D sees a straight leg the whole time
  expect(Math.min(...angles(flat, 'angle'))).toBeGreaterThan(170);
  expect(flat[0].angle_mode).toBe('2d');

  const deep = run(new Session('sit_to_stand', true), frames);
  expect(last(deep).summary.reps).toBe(3);
  expect(deep[0].angle_mode).toBe('3d');
  expect(Math.min(...angles(deep, 'angle'))).toBeLessThan(110);
  // The other mode's reading travels along for the UI's comparison line.
  expect(Math.min(...angles(deep, 'angle_alt'))).toBeGreaterThan(170);
});

test('without world landmarks 3D mode falls back to 2D', () => {
  const s = new Session('sit_to_stand', true);
  const out = s.process(syn.squat(100), syn.SIZE, syn.SIZE, 0);
  expect(out.angle_mode).toBe('2d');
  expect(out.angle_alt).toBeNull();
  expectApprox(out.angle, 100, { abs: 1 });
});

test('switching angle mode drops calibration', () => {
  const s = new Session('sit_to_stand');
  s.setExercise('sit_to_stand', new Thresholds(150, 125));
  s.setAngleMode(true);
  expect(s.useWorld).toBe(true);
  expect(s.thresholds).toBeNull();
  expect(s.exercise.rest).toBe(155);
});

// --- calibration ---------------------------------------------------------------

function sideSquats(low: number, high = 170, reps = 3, frames = 30): Landmark[][] {
  const out: Landmark[][] = [];
  for (let k = 0; k < reps; k++) out.push(...syn.trajectory(high, low, frames).map((d) => syn.squat(d)));
  return out;
}

function feed(s: Session, frames: Landmark[][], startT = 0.0): FrameResult[] {
  return frames.map((lm, i) => s.process(lm, syn.SIZE, syn.SIZE, startT + i / FPS));
}

test('calibration learns a shallow range that then counts', () => {
  // Sit-to-stand needs the knee to reach 110 by default; this person only gets to 130.
  const shallow = sideSquats(130);
  expect(last(feed(new Session('sit_to_stand'), shallow)).summary.reps).toBe(0);

  const s = new Session('sit_to_stand');
  s.startCalibration();
  const out = feed(s, shallow);
  const statuses = out.filter((r) => 'calibration' in r).map((r) => r.calibration);
  expect(statuses[0]).toEqual({ status: 'recording', reps: 0, needed: 3 });
  const done = statuses[statuses.length - 1];
  if (done === undefined || done.status !== 'done') throw new Error(`calibration not done: ${JSON.stringify(done)}`);
  expect(done.reps).toBe(3);
  // rest_ref ~170, depth ~40 -> rest ~160, target ~140
  expectApprox(done.rest, 160, { abs: 2 });
  expectApprox(done.target, 140, { abs: 2 });
  expect(last(out).summary.reps).toBe(0); // calibration reps are not counted
  expect(last(out).thresholds.calibrated).toBe(true);
  expect(s.calibrator).toBeNull();

  const after = feed(s, shallow, 100);
  expect(last(after).summary.reps).toBe(3);
});

test('calibration works for exercises whose angle grows', () => {
  const e = ex('overhead_reach'); // rest 60 -> target 135, restIsHigh false
  const cal = new Calibrator(e);
  for (let k = 0; k < 3; k++) {
    for (const v of syn.trajectory(30, 110, 30)) cal.update(v);
  }
  const th = cal.result();
  expect(th).not.toBeNull();
  expectApprox(th?.rest, 30 + 0.25 * 80, { abs: 1 });
  expectApprox(th?.target, 30 + 0.75 * 80, { abs: 1 });
});

test('calibration ignores jitter and tracks the real rest position', () => {
  const cal = new Calibrator(ex('sit_to_stand'));
  for (const v of [150, 152, 168, 170, 169, 171, 170]) cal.update(v); // starts mid-way, settles at ~170
  expect(cal.reps).toBe(0);
  for (let i = 0; i < 50; i++) cal.update(170 + 2 * Math.sin(i)); // +-2 degrees of noise
  expect(cal.reps).toBe(0);
  for (const v of syn.trajectory(171, 120, 30)) cal.update(v);
  expect(cal.reps).toBe(1);
  expectApprox(cal.depths[0], 51, { abs: 1 });
});

test.each<[unknown, unknown, boolean]>([
  [150, 120, true],
  [120, 150, false],
  [150, 149, false],
  [200, 120, false],
  ['150', 120, false],
  [true, 120, false],
  [null, 120, false],
])('validate thresholds (%p, %p) -> %p', (rest, target, ok) => {
  expect(calibration.validate(ex('sit_to_stand'), rest, target) !== null).toBe(ok);
});
