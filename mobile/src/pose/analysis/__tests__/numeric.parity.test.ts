/**
 * Parity of the low-level numerics with CPython / numpy, from fixtures/numeric.json:
 * round(), sum(), math.hypot, trig, statistics.median, the office rep score,
 * the angle helpers, calibration.validate and the Calibrator.
 */

import { Calibrator, validate } from '../calibration';
import { EXERCISES, officeRepScore } from '../exercises';
import { angle, angleFromHorizontal, angleFromVertical } from '../geometry';
import { degrees, median, pyHypot, pyRound, pySum } from '../pymath';
import { type Scenario, diff, loadFixture, replay } from './helpers';

interface NumericFixture {
  round: [number, number, number, number][];
  sum: [number[], number, number][];
  hypot: [number, number, number][];
  trig: {
    acos: [number, number][];
    asin: [number, number][];
    atan2: [number, number, number][];
    degrees: [number, number][];
  };
  office_rep_score: [number, number, number, number][];
  angles: [number[], number[], number[], number, number, number][];
  median: [number[], number][];
  validate: [string, unknown, unknown, { rest: number; target: number } | null][];
  calibrator: {
    exercise: string;
    values: number[];
    finished: boolean[];
    reps: number;
    depths: number[];
    rest_samples: number[];
    result: { rest: number; target: number } | null;
  }[];
}

const fx = loadFixture<NumericFixture>('numeric.json');

/** Relative closeness for libm functions, which may differ from macOS libm in the last bit. */
function nearlyEqual(a: number, b: number, ulps = 4): boolean {
  if (a === b) return true;
  return Math.abs(a - b) <= ulps * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b), 1e-300);
}

describe('pyRound matches Python round()', () => {
  it.each([
    [0.25, 1, 0.2],
    [0.35, 1, 0.3],
    [0.45, 1, 0.5],
    [-0.25, 1, -0.2],
    [2.675, 2, 2.67],
    [0.125, 2, 0.12],
    [8.345, 2, 8.35],
    [150.25, 1, 150.2],
    [2.5, 0, 2],
    [3.5, 0, 4],
    [-2.5, 0, -2],
  ])('round(%p, %p) == %p', (x, d, expected) => {
    expect(pyRound(x, d)).toBe(expected);
  });

  it(`on ${fx.round.length} recorded values, bit for bit`, () => {
    const bad = fx.round.filter(([x, r1, r2, r0]) => pyRound(x, 1) !== r1 || pyRound(x, 2) !== r2 || pyRound(x) !== r0);
    expect(bad).toEqual([]);
  });
});

describe('pySum matches Python 3.12 sum()', () => {
  it('is compensated, like CPython', () => {
    expect(pySum(Array(10).fill(0.1))).toBe(1.0);
    expect(pySum([])).toBe(0);
  });

  it(`on ${fx.sum.length} recorded lists, bit for bit (and the summary average)`, () => {
    const bad = fx.sum.filter(([xs, total, avg]) => pySum(xs) !== total || pyRound(pySum(xs) / xs.length, 1) !== avg);
    expect(bad).toEqual([]);
  });
});

it(`pyHypot matches math.hypot bit for bit on ${fx.hypot.length} pairs`, () => {
  const bad = fx.hypot.filter(([x, y, h]) => pyHypot(x, y) !== h);
  expect(bad).toEqual([]);
});

describe('libm functions agree with CPython to the last bits', () => {
  it('acos, asin, atan2', () => {
    expect(fx.trig.acos.filter(([x, r]) => !nearlyEqual(Math.acos(x), r))).toEqual([]);
    expect(fx.trig.asin.filter(([x, r]) => !nearlyEqual(Math.asin(x), r))).toEqual([]);
    expect(fx.trig.atan2.filter(([y, x, r]) => !nearlyEqual(Math.atan2(y, x), r))).toEqual([]);
  });

  it('degrees() is bit for bit', () => {
    expect(fx.trig.degrees.filter(([x, r]) => degrees(x) !== r)).toEqual([]);
  });
});

it(`officeRepScore matches office_rep_score on ${fx.office_rep_score.length} cases`, () => {
  const bad = fx.office_rep_score.filter(([rom, needed, duration, score]) => officeRepScore(rom, needed, duration) !== score);
  expect(bad).toEqual([]);
});

it(`angle helpers match on ${fx.angles.length} random 2D/3D points`, () => {
  const bad = fx.angles.filter(
    ([a, b, c, ang, vert, horiz]) =>
      diff([angle(a, b, c), angleFromVertical(b, c), angleFromHorizontal(b, c)], [ang, vert, horiz], 1e-9).length > 0,
  );
  expect(bad).toEqual([]);
});

it('median matches statistics.median', () => {
  expect(fx.median.filter(([xs, m]) => median(xs) !== m)).toEqual([]);
});

it(`validateCalibration matches calibration.validate on ${fx.validate.length} cases`, () => {
  const bad = fx.validate.filter(([key, rest, target, expected]) => {
    const got = validate(EXERCISES[key], rest, target);
    return diff(got, expected, 0).length > 0;
  });
  expect(bad).toEqual([]);
  // The key form gives the same answer.
  expect(validate('sit_to_stand', 150, 120)).toEqual(validate(EXERCISES.sit_to_stand, 150, 120));
});

it(`Calibrator matches on ${fx.calibrator.length} random walks`, () => {
  for (const c of fx.calibrator) {
    const cal = new Calibrator(EXERCISES[c.exercise]);
    const finished = c.values.map((v) => cal.update(v));
    expect(diff(finished, c.finished)).toEqual([]);
    expect(diff(
      { reps: cal.reps, depths: cal.depths, rest_samples: cal.restSamples, result: cal.result() },
      { reps: c.reps, depths: c.depths, rest_samples: c.rest_samples, result: c.result },
    )).toEqual([]);
  }
});

describe('the comparison itself', () => {
  it('flags differences beyond 1e-6, wrong types and extra or missing keys', () => {
    expect(diff({ a: 1.0000001, b: [1, 'x'] }, { a: 1, b: [1, 'x'] })).toEqual([]);
    expect(diff({ a: 1.00001 }, { a: 1 })).toHaveLength(1);
    expect(diff({ a: null }, { a: 0 })).toHaveLength(1);
    expect(diff({ a: 1, b: 2 }, { a: 1 })).toHaveLength(1);
    expect(diff({}, { a: 1 })).toHaveLength(1);
    expect(diff([1, 2], [1, 2, 3])).toHaveLength(1);
  });

  it('replay reports a frame whose Python output was tampered with', () => {
    const scenario = loadFixture<{ scenarios: Scenario[] }>('session_neck_tilt.json').scenarios[0];
    expect(replay(scenario).mismatches).toEqual([]);
    const steps = scenario.steps.map((s) => ('op' in s ? s : { ...s, out: { ...s.out } }));
    const frame = steps.find((s, i) => i > 30 && !('op' in s) && typeof s.out.angle === 'number');
    if (!frame || 'op' in frame) throw new Error('no frame with an angle');
    frame.out.angle = (frame.out.angle as number) + 0.1;
    expect(replay({ ...scenario, steps }).mismatches).not.toEqual([]);
  });
});
