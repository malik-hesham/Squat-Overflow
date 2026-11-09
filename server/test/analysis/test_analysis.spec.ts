// Port of server/tests/test_analysis.py.
import type { Landmark } from '../../src/analysis/geometry';
import { angle, angleFromVertical } from '../../src/analysis/geometry';
import { type FrameResult, type RepEvent, Session, UnknownExerciseError } from '../../src/analysis/session';
import { expectApprox } from './approx';
import * as syn from './synthetic';

const FPS = 30;

/** Feed landmark frames at FPS; return list of frame results. */
function run(session: Session, frames: Landmark[][], startT = 0.0): FrameResult[] {
  return frames.map((lm, i) => session.process(lm, syn.SIZE, syn.SIZE, startT + i / FPS));
}

function repsOf(poseFn: (a: number) => Landmark[], rest: number, target: number, n = 3, seconds = 2.0): Landmark[][] {
  const frames: Landmark[][] = [];
  for (let k = 0; k < n; k++) {
    frames.push(...syn.trajectory(rest, target, Math.trunc(seconds * FPS)).map((a) => poseFn(a)));
  }
  return frames;
}

const events = (results: FrameResult[]): RepEvent[] =>
  results.map((r) => r.rep_event).filter((e): e is RepEvent => e !== null);

/** Python's `(ev,) = [...]`: exactly one event. */
function single(results: FrameResult[]): RepEvent {
  const evs = events(results);
  expect(evs).toHaveLength(1);
  return evs[0];
}

const last = (results: FrameResult[]): FrameResult => results[results.length - 1];

// --- geometry -------------------------------------------------------------

test('angle basics', () => {
  expectApprox(angle([1, 0], [0, 0], [0, 1]), 90);
  expectApprox(angle([-1, 0], [0, 0], [1, 0]), 180);
  expectApprox(angleFromVertical([0, 0], [0, -5]), 0);
});

test.each([60, 95, 140, 175])('synthetic builder is exact (%p)', (deg) => {
  const s = new Session('squat');
  const out = s.process(syn.squat(deg), syn.SIZE, syn.SIZE, 0);
  expectApprox(out.angle, deg, { abs: 0.2 });
});

// --- squat ----------------------------------------------------------------

test('squat counts clean reps', () => {
  const s = new Session('squat');
  const results = run(s, repsOf((a) => syn.squat(a), 172, 80, 3));
  const evs = events(results);
  expect(evs.map((e) => e.index)).toEqual([1, 2, 3]);
  expect(evs.every((e) => e.issues.length === 0 && e.score === 100)).toBe(true);
  const summary = last(results).summary;
  expect(summary.reps).toBe(3);
  expect(summary.good_reps).toBe(3);
  expect(summary.partial_reps).toBe(0);
  expectApprox(summary.avg_rom, 92, { abs: 3 });
});

test('squat partial rep is flagged, not counted', () => {
  const s = new Session('squat');
  const results = run(s, repsOf((a) => syn.squat(a), 172, 125, 1));
  const ev = events(results);
  expect(ev).toHaveLength(1);
  expect(ev[0].partial).toBe(true);
  expect(ev[0].issues[0]).toBe('not_deep_enough');
  expect(last(results).summary.reps).toBe(0);
  expect(last(results).summary.partial_reps).toBe(1);
});

test('small wobble is ignored', () => {
  const s = new Session('squat');
  const results = run(s, repsOf((a) => syn.squat(a), 172, 150, 2));
  expect(results.some((r) => r.rep_event)).toBe(false);
});

test('squat forward lean is attributed to rep', () => {
  const s = new Session('squat');
  const ev = single(run(s, repsOf((a) => syn.squat(a, 60), 172, 80, 1)));
  expect(ev.issues).toContain('chest_up');
  expect(ev.score).toBeLessThan(100);
});

test('squat knees past toes', () => {
  const s = new Session('squat');
  const ev = single(run(s, repsOf((a) => syn.squat(a, 10.0, 200), 172, 80, 1)));
  expect(ev.issues).toContain('knees_past_toes');
});

test('rushed rep is too fast', () => {
  const s = new Session('squat');
  const ev = single(run(s, repsOf((a) => syn.squat(a), 172, 80, 1, 0.5)));
  expect(ev.issues).toContain('too_fast');
});

test('jitter at threshold does not double count', () => {
  const rng = new syn.PyRandom(1); // random.seed(1)
  const s = new Session('squat');
  const frames = repsOf((a) => syn.squat(a), 172, 80, 2);
  // hover around the rest threshold (160) with landmark noise
  for (let i = 0; i < 60; i++) frames.push(syn.squat(160 + rng.uniform(-4, 4)));
  const results = run(s, frames);
  expect(last(results).summary.reps).toBe(2);
});

test('missing pose gives visibility feedback', () => {
  const s = new Session('squat');
  const out = s.process(null, 640, 480, 0);
  expect(out.feedback[0].code).toBe('not_visible');
  expect(out.angle).toBeNull();
});

test('low visibility side is not used', () => {
  const s = new Session('squat');
  const lms = syn.squat(170).map(([x, y]) => [x, y, 0.1]);
  const out = s.process(lms, syn.SIZE, syn.SIZE, 0);
  expect(out.feedback[0].code).toBe('not_visible');
});

// --- push-up --------------------------------------------------------------

test('push-up counts and detects sag and pike', () => {
  const s = new Session('pushup');
  const results = run(s, repsOf((a) => syn.pushup(a), 170, 80, 2));
  expect(last(results).summary.good_reps).toBe(2);

  const sag = new Session('pushup');
  expect(single(run(sag, repsOf((a) => syn.pushup(a, 80), 170, 80, 1))).issues).toContain('hips_sag');

  const pike = new Session('pushup');
  expect(single(run(pike, repsOf((a) => syn.pushup(a, -120), 170, 80, 1))).issues).toContain('hips_pike');
});

test('push-up not counted when standing', () => {
  const s = new Session('pushup');
  const results = run(s, repsOf((a) => syn.pushup(a, 0.0, true), 170, 80, 2));
  expect(last(results).summary.reps).toBe(0);
  expect(last(results).feedback[0].code).toBe('not_plank');
});

// --- curl -----------------------------------------------------------------

test('curl counts and detects elbow drift', () => {
  const s = new Session('curl');
  const results = run(s, repsOf((a) => syn.curl(a), 165, 40, 3));
  expect(last(results).summary.good_reps).toBe(3);

  const drift = new Session('curl');
  expect(single(run(drift, repsOf((a) => syn.curl(a, 50), 165, 40, 1))).issues).toContain('elbow_drift');
});

test('curl swinging', () => {
  const s = new Session('curl');
  expect(single(run(s, repsOf((a) => syn.curl(a, 5.0, 22), 165, 40, 1))).issues).toContain('swinging');
});

// --- shoulder press (rest angle is LOW) -----------------------------------

test('press counts reps with inverted direction', () => {
  const s = new Session('press');
  const results = run(s, repsOf((a) => syn.press(a), 90, 172, 3));
  expect(last(results).summary.good_reps).toBe(3);
});

test('press ignores arms hanging down', () => {
  const s = new Session('press');
  const results = run(s, repsOf((a) => syn.press(a, true), 90, 172, 2));
  expect(last(results).summary.reps).toBe(0);
});

test('press uneven', () => {
  const s = new Session('press');
  expect(single(run(s, repsOf((a) => syn.press(a, false, 90), 90, 172, 1))).issues).toContain('uneven_press');
});

// --- session controls -----------------------------------------------------

test('reset and switch exercise', () => {
  const s = new Session('squat');
  run(s, repsOf((a) => syn.squat(a), 172, 80, 2));
  s.setExercise('curl');
  const out = s.process(syn.curl(165), syn.SIZE, syn.SIZE, 100);
  expect(out.exercise).toBe('curl');
  expect(out.summary.reps).toBe(0);
  expect(() => s.setExercise('burpee')).toThrow(UnknownExerciseError);
});
