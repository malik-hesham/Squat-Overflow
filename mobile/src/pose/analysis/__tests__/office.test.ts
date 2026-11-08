/**
 * Office / desk exercise set (port of server/tests/test_office.py): catalog
 * sanity, geometry helpers, forgiving rep counting and the form score formula.
 */

import {
  AREAS,
  CATALOG,
  DEFAULT_EXERCISE,
  EXERCISES,
  type Gentle,
  OFFICE_EXERCISES,
  armElevation,
  earHeight,
  headDrop,
  headForward,
  headTilt,
  headTurn,
  officeRepScore,
  shoulderTilt,
} from '../exercises';
import { Pose } from '../geometry';
import { RepCounter, type Rep, Session, type Summary, type RepEvent } from '../session';
import * as syn from './synthetic';

const FPS = 30;
const pose = (lms: number[][]) => new Pose(lms, syn.SIZE, syn.SIZE);

function run(key: string, frames: number[][][]): [RepEvent[], Summary] {
  const s = new Session(key);
  const results = frames.map((lm, i) => s.process(lm, syn.SIZE, syn.SIZE, i / FPS));
  return [results.flatMap((r) => (r.rep_event ? [r.rep_event] : [])), results[results.length - 1].summary];
}

function counterRun(ex: Gentle, values: number[], fps = FPS): Rep[] {
  const rc = new RepCounter(ex);
  return values.flatMap((v, i) => rc.update(v, [], i / fps) ?? []);
}

const repeat = <T>(n: number, f: () => T[]): T[] => Array.from({ length: n }, f).flat();

// --- catalog ------------------------------------------------------------------

describe('catalog', () => {
  it('has forty office exercises with unique keys', () => {
    const keys = OFFICE_EXERCISES.map((e) => e.key);
    expect(keys).toHaveLength(40);
    expect(new Set(keys).size).toBe(40);
    keys.forEach((k, i) => expect(EXERCISES[k]).toBe(OFFICE_EXERCISES[i]));
  });

  it('offers only the office set', () => {
    expect(Object.values(CATALOG)).toEqual([...OFFICE_EXERCISES]);
    expect(DEFAULT_EXERCISE).toBe(OFFICE_EXERCISES[0].key);
    expect(Object.values(CATALOG).every((e) => e.category !== 'Workout')).toBe(true);
  });

  it.each(OFFICE_EXERCISES.map((e) => [e.key, e] as const))('%s is well formed', (_k, ex) => {
    expect(Math.min(ex.rest, ex.target)).toBeGreaterThanOrEqual(0); // fits the 0..180 chart
    expect(Math.max(ex.rest, ex.target)).toBeLessThanOrEqual(180);
    expect(Math.abs(ex.rest - ex.target)).toBeGreaterThanOrEqual(7); // enough hysteresis that jitter can't count a rep
    expect(ex.restIsHigh).toBe(ex.rest > ex.target);
    expect(['front', 'side']).toContain(ex.camera);
    expect(ex.bilateral).toBe(ex.camera === 'front');
    expect(ex.howTo).not.toBe('');
    expect(AREAS).toContain(ex.category);
    expect(['seated', 'standing']).toContain(ex.stance);
    expect(ex.minRepSeconds).toBeLessThanOrEqual(0.5);
  });

  it('puts every office exercise in its pain area', () => {
    const areaMap: Record<string, string[]> = {
      'Neck tension': ['neck_tilt', 'head_turn', 'chin_to_chest', 'shoulder_shrug', 'chin_tuck'],
      'Rounded shoulders': ['cross_swing', 'wy_raise', 'shoulder_roll', 'thoracic_extension', 'clasp_opener'],
      'Upper back': ['seated_row', 't_raise', 'desk_punch', 'rhomboid_stretch', 'desk_row'],
      'Shoulder & rotator cuff': ['scaption', 'front_raise', 'overhead_reach', 'external_rotation', 'cross_body_stretch'],
      'Lower back': ['seated_side_bend', 'knee_to_chest', 'hip_hinge', 'standing_side_bend', 'back_extension'],
      'Wrist & hand': ['wrist_flex', 'extensor_stretch', 'flexor_stretch', 'prayer_stretch', 'nerve_glide'],
      Knees: ['seated_knee_ext', 'heel_slide', 'sit_to_stand', 'mini_squat', 'hamstring_curl'],
      Eyes: ['palming', 'temple_massage', 'look_far', 'near_far_focus', 'eye_track_vertical'],
    };
    expect([...AREAS]).toEqual(Object.keys(areaMap));
    for (const [area, keys] of Object.entries(areaMap)) {
      expect(OFFICE_EXERCISES.filter((e) => e.category === area).map((e) => e.key).sort()).toEqual([...keys].sort());
    }
  });
});

// --- geometry helpers -------------------------------------------------------------

describe('angle helpers', () => {
  it.each([0, 45, 90, 135, 180])('arm elevation %p', (deg) => {
    expect(armElevation(pose(syn.upper({ leftElev: deg })), 'left')).toBeCloseTo(deg, 1);
  });

  it.each([0, 10, 25])('head tilt and turn %p', (deg) => {
    expect(headTilt(pose(syn.upper({ tilt: deg })))).toBeCloseTo(deg, 1);
    expect(headTilt(pose(syn.upper({ tilt: -deg })))).toBeCloseTo(deg, 1);
    expect(headTurn(pose(syn.upper({ turn: deg })))).toBeCloseTo(deg, 1);
  });

  it('shoulder tilt', () => {
    expect(shoulderTilt(pose(syn.upper({ shoulderDrop: 200 * Math.tan((12 * Math.PI) / 180) })))).toBeCloseTo(12, 1);
  });

  it.each([0, 20, 45])('head drop %p', (deg) => {
    expect(headDrop(pose(syn.upper({ chinDrop: deg })))).toBeCloseTo(deg, 1);
    expect(headDrop(pose(syn.upper({ chinDrop: -20 })))).toBe(0); // looking up reads as level
  });

  it('ear height shrinks as the shoulders rise', () => {
    // Ears sit 40 px inside each shoulder and 120 px above it.
    expect(earHeight(pose(syn.upper()))).toBeCloseTo((Math.atan2(120, 40) * 180) / Math.PI, 1);
    expect(earHeight(pose(syn.upper({ shrug: 80 })))).toBeCloseTo(45, 1);
  });

  it.each([0, 8, 20])('head forward %p', (deg) => {
    expect(headForward(pose(syn.sideHead(deg)), 'left')).toBeCloseTo(deg, 1);
  });
});

// --- end-to-end counting ----------------------------------------------------------

describe('counting', () => {
  it('neck tilt counts each side', () => {
    const frames = [
      ...syn.trajectory(0, 25, 45).map((a) => syn.upper({ tilt: a })),
      ...syn.trajectory(0, -25, 45).map((a) => syn.upper({ tilt: a })),
    ];
    const [events, summary] = run('neck_tilt', frames);
    expect(summary.reps).toBe(2);
    expect(events.every((e) => e.issues.length === 0)).toBe(true);
  });

  it('overhead reach counts both arms together', () => {
    const frames = repeat(3, () => syn.trajectory(20, 160, 45).map((a) => syn.upper({ leftElev: a, rightElev: a })));
    const [, summary] = run('overhead_reach', frames);
    expect([summary.reps, summary.good_reps]).toEqual([3, 3]);
  });

  it('cross-body stretch counts each arm', () => {
    const frames = [
      ...syn.trajectory(0, -80, 45).map((a) => syn.upper({ leftElev: a, rightElev: 0 })),
      ...syn.trajectory(0, -80, 45).map((a) => syn.upper({ leftElev: 0, rightElev: a })),
    ];
    expect(run('cross_body_stretch', frames)[1].reps).toBe(2);
  });

  it('chin to chest counts each nod', () => {
    const frames = repeat(2, () => syn.trajectory(15, 50, 45).map((a) => syn.upper({ chinDrop: a })));
    const [, summary] = run('chin_to_chest', frames);
    expect([summary.reps, summary.good_reps]).toEqual([2, 2]);
  });

  it('shrugs and shoulder rolls count each lift', () => {
    const frames = repeat(3, () => syn.trajectory(0, 100, 45).map((s) => syn.upper({ shrug: s })));
    expect(run('shoulder_shrug', frames)[1].reps).toBe(3);
    expect(run('shoulder_roll', frames)[1].reps).toBe(3);
  });

  it('chin tuck counts each pull back', () => {
    const frames = repeat(2, () => syn.trajectory(22, 3, 45).map((a) => syn.sideHead(a)));
    expect(run('chin_tuck', frames)[1].reps).toBe(2);
  });

  it('sit to stand uses the knee angle', () => {
    const frames = repeat(2, () => syn.trajectory(172, 95, 60).map((a) => syn.squat(a)));
    const [, summary] = run('sit_to_stand', frames);
    expect([summary.reps, summary.good_reps]).toEqual([2, 2]);
  });
});

// --- forgiving by design -----------------------------------------------------------

describe.each(OFFICE_EXERCISES.map((e) => [e.key, e] as const))('%s is forgiving', (_k, ex) => {
  const step = ex.target > ex.rest ? 1 : -1;
  const relaxed = ex.rest - 5 * step;

  it('a relaxed rep that just reaches the target scores well but not full', () => {
    const reps = counterRun(ex, syn.trajectory(relaxed, ex.target + 2 * step, 2 * FPS));
    expect(reps).toHaveLength(1);
    const [rep] = reps;
    expect(rep.partial).toBe(false);
    expect(rep.issues).toEqual([]);
    expect(rep.score).toBeGreaterThanOrEqual(70);
    expect(rep.score).toBeLessThan(100);
  });

  it('fidgeting at rest is not a rep', () => {
    const rand = syn.rng(0);
    const values = Array.from({ length: 10 * FPS }, () => relaxed + (rand() * 6 - 3));
    expect(counterRun(ex, values)).toEqual([]);
  });

  it('a partial rep scores below a full one', () => {
    const halfway = relaxed + (ex.target - relaxed) * 0.7;
    const reps = counterRun(ex, syn.trajectory(relaxed, halfway, 2 * FPS));
    expect(reps).toHaveLength(1);
    expect(reps[0].partial).toBe(true);
    expect(reps[0].score).toBeLessThan(70);
  });
});

// --- form score formula (§8.1) -----------------------------------------------------

describe('office rep score', () => {
  it.each([
    [50, 50, 1.5, 70], // target reached at a controlled pace
    [65, 50, 1.5, 100], // full controlled range (30% past the target)
    [20, 50, 1.5, 0], // under 40% of the range: nothing
    [35, 50, 1.5, 35], // partway: depth scales linearly
    [65, 50, 0.4, 70], // rushed (< 0.5 s): -30
    [65, 50, 0.8, 85], // hurried (< 1 s): -15
    [200, 50, 1.5, 100], // capped at 100
    [5, 50, 0.2, 0], // never negative
    [10, 0, 1.5, 0], // no range to measure against
  ])('rom %p of %p in %p s -> %p', (rom, needed, duration, expected) => {
    expect(officeRepScore(rom, needed, duration)).toBe(expected);
  });

  it('a rushed rep is flagged and penalised in a session', () => {
    const ex = CATALOG.overhead_reach;
    const [rep] = counterRun(ex, syn.trajectory(40, 160, 8)); // same peak, out of rest for ~0.17 s
    expect(rep.issues).toEqual(['too_fast']);
    const [slow] = counterRun(ex, syn.trajectory(40, 160, 2 * FPS));
    expect(slow.score - rep.score).toBe(30);
  });
});
