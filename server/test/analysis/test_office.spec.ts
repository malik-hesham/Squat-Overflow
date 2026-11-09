// Port of server/tests/test_office.py: office / desk exercise set, geometry helpers,
// catalog sanity, forgiving rep counting.
import {
  AREAS,
  CATALOG,
  DEFAULT_EXERCISE,
  EXERCISES,
  type Exercise,
  OFFICE_EXERCISES,
  armElevation,
  earHeight,
  headDrop,
  headForward,
  headTilt,
  headTurn,
  officeRepScore,
  shoulderTilt,
} from '../../src/analysis/exercises';
import { type Landmark, Pose, type Vec, add, degrees, radians } from '../../src/analysis/geometry';
import { type FrameResult, type Rep, RepCounter, type RepEvent, Session, type Summary } from '../../src/analysis/session';
import { expectApprox } from './approx';
import * as syn from './synthetic';

const FPS = 30;

interface UpperOpts {
  leftElev?: number;
  rightElev?: number;
  tilt?: number;
  turn?: number;
  shoulderDrop?: number;
  chinDrop?: number | null;
  shrug?: number;
}

/**
 * Seated, facing the camera. Arm elevation in degrees (0 = hanging, 180 = overhead,
 * negative = across the chest). `chinDrop` puts the nose that many degrees below the ears;
 * `shrug` lifts both shoulders by that many pixels.
 */
function upper({
  leftElev = 20.0,
  rightElev = 20.0,
  tilt = 0.0,
  turn = 0.0,
  shoulderDrop = 0.0,
  chinDrop = null,
  shrug = 0.0,
}: UpperOpts = {}): Landmark[] {
  const sides: syn.Points = {};
  const noseY = chinDrop === null ? 300.0 : 280.0 + 60 * Math.tan(radians(chinDrop));
  for (const [side, sx, out] of [['left', 600.0, 1], ['right', 400.0, -1]] as const) {
    const shoulder = [sx, 400.0 - shrug + (side === 'left' ? shoulderDrop : 0.0)];
    const e = radians(side === 'left' ? leftElev : rightElev);
    const wrist = add(shoulder, [250 * (out * Math.sin(e)), 250 * Math.cos(e)]);
    const t = radians(tilt);
    const ear = add([500.0, 280.0], [out * 60 * Math.cos(t), out * 60 * Math.sin(t)]);
    const nose = [500.0 + 60 * Math.sin(radians(turn)), noseY];
    sides[side] = {
      nose, ear, shoulder, elbow: add(shoulder, wrist).map((v) => v / 2),
      wrist, hip: add(shoulder, [0, 300]), knee: add(shoulder, [0, 450]), ankle: add(shoulder, [0, 640]),
    };
  }
  return syn.landmarks(sides);
}

const pose = (lms: Landmark[]): Pose => new Pose(lms, syn.SIZE, syn.SIZE);

function run(key: string, frames: Landmark[][]): [RepEvent[], Summary] {
  const s = new Session(key);
  const results: FrameResult[] = frames.map((lm, i) => s.process(lm, syn.SIZE, syn.SIZE, i / FPS));
  const events = results.map((r) => r.rep_event).filter((e): e is RepEvent => e !== null);
  return [events, results[results.length - 1].summary];
}

const byKey = (e: Exercise): string => e.key;

// --- catalog --------------------------------------------------------------

test('forty office exercises with unique keys', () => {
  const keys = OFFICE_EXERCISES.map(byKey);
  expect(keys).toHaveLength(40);
  expect(new Set(keys).size).toBe(40);
  keys.forEach((k, i) => expect(EXERCISES.get(k)).toBe(OFFICE_EXERCISES[i]));
});

test('catalog offers only the office set', () => {
  expect([...CATALOG.values()]).toEqual([...OFFICE_EXERCISES]);
  [...CATALOG.values()].forEach((e, i) => expect(e).toBe(OFFICE_EXERCISES[i]));
  expect(DEFAULT_EXERCISE).toBe(OFFICE_EXERCISES[0].key);
  expect([...CATALOG.values()].every((e) => e.category !== 'Workout')).toBe(true);
});

const officeCases = OFFICE_EXERCISES.map((e) => [e.key, e] as const);

test.each(officeCases)('office exercise is well formed: %s', (_key, ex) => {
  expect(Math.min(ex.rest, ex.target)).toBeGreaterThanOrEqual(0); // fits the 0..180 chart
  expect(Math.max(ex.rest, ex.target)).toBeLessThanOrEqual(180);
  expect(Math.abs(ex.rest - ex.target)).toBeGreaterThanOrEqual(7); // enough hysteresis that jitter can't count a rep
  expect(ex.restIsHigh).toBe(ex.rest > ex.target);
  expect(['front', 'side']).toContain(ex.camera);
  expect(ex.bilateral).toBe(ex.camera === 'front');
  expect(ex.howTo).toBeTruthy();
  expect(AREAS).toContain(ex.category);
  expect(['seated', 'standing']).toContain(ex.stance);
  expect(ex.minRepSeconds).toBeLessThanOrEqual(0.5);
});

// --- geometry helpers -----------------------------------------------------

test.each([0, 45, 90, 135, 180])('arm elevation %p', (deg) => {
  const p = pose(upper({ leftElev: deg }));
  expectApprox(armElevation(p, 'left'), deg, { abs: 0.1 });
});

test.each([0, 10, 25])('head tilt and turn %p', (deg) => {
  expectApprox(headTilt(pose(upper({ tilt: deg }))), deg, { abs: 0.1 });
  expectApprox(headTilt(pose(upper({ tilt: -deg }))), deg, { abs: 0.1 });
  expectApprox(headTurn(pose(upper({ turn: deg }))), deg, { abs: 0.1 });
});

test('shoulder tilt', () => {
  expectApprox(shoulderTilt(pose(upper({ shoulderDrop: 200 * Math.tan(radians(12)) }))), 12, { abs: 0.1 });
});

test.each([0, 20, 45])('head drop %p', (deg) => {
  expectApprox(headDrop(pose(upper({ chinDrop: deg }))), deg, { abs: 0.1 });
  expect(headDrop(pose(upper({ chinDrop: -20 })))).toBe(0); // looking up reads as level
});

test('ear height shrinks as the shoulders rise', () => {
  // Ears sit 40 px inside each shoulder and 120 px above it.
  expectApprox(earHeight(pose(upper())), degrees(Math.atan2(120, 40)), { abs: 0.1 });
  expectApprox(earHeight(pose(upper({ shrug: 80 }))), 45, { abs: 0.1 });
});

/** Side view: the ear sits 150 px from the shoulder, `forwardDeg` in front of straight up. */
function sideHead(forwardDeg: number): Landmark[] {
  const shoulder: Vec = [500.0, 400.0];
  const a = radians(forwardDeg);
  const ear = add(shoulder, [150 * Math.sin(a), 150 * -Math.cos(a)]);
  return syn.landmarks({ left: { shoulder, ear, nose: add(ear, [40, 10]) } });
}

test.each([0, 8, 20])('head forward %p', (deg) => {
  expectApprox(headForward(pose(sideHead(deg)), 'left'), deg, { abs: 0.1 });
});

// --- end-to-end counting --------------------------------------------------

test('neck tilt counts each side', () => {
  const frames = [
    ...syn.trajectory(0, 25, 45).map((a) => upper({ tilt: a })),
    ...syn.trajectory(0, -25, 45).map((a) => upper({ tilt: a })),
  ];
  const [events, summary] = run('neck_tilt', frames);
  expect(summary.reps).toBe(2);
  expect(events.every((e) => e.issues.length === 0)).toBe(true);
});

test('overhead reach counts both arms together', () => {
  const frames: Landmark[][] = [];
  for (let k = 0; k < 3; k++) frames.push(...syn.trajectory(20, 160, 45).map((a) => upper({ leftElev: a, rightElev: a })));
  const [, summary] = run('overhead_reach', frames);
  expect(summary.reps).toBe(3);
  expect(summary.good_reps).toBe(3);
});

test('cross-body stretch counts each arm', () => {
  const frames = [
    ...syn.trajectory(0, -80, 45).map((a) => upper({ leftElev: a, rightElev: 0 })),
    ...syn.trajectory(0, -80, 45).map((a) => upper({ leftElev: 0, rightElev: a })),
  ];
  const [, summary] = run('cross_body_stretch', frames);
  expect(summary.reps).toBe(2);
});

test('chin to chest counts each nod', () => {
  const frames: Landmark[][] = [];
  for (let k = 0; k < 2; k++) frames.push(...syn.trajectory(15, 50, 45).map((a) => upper({ chinDrop: a })));
  const [, summary] = run('chin_to_chest', frames);
  expect(summary.reps).toBe(2);
  expect(summary.good_reps).toBe(2);
});

test('shrugs and shoulder rolls count each lift', () => {
  const frames: Landmark[][] = [];
  for (let k = 0; k < 3; k++) frames.push(...syn.trajectory(0, 100, 45).map((s) => upper({ shrug: s })));
  for (const key of ['shoulder_shrug', 'shoulder_roll']) {
    const [, summary] = run(key, frames);
    expect({ key, reps: summary.reps }).toEqual({ key, reps: 3 });
  }
});

test('chin tuck counts each pull back', () => {
  const frames: Landmark[][] = [];
  for (let k = 0; k < 2; k++) frames.push(...syn.trajectory(22, 3, 45).map((a) => sideHead(a)));
  const [, summary] = run('chin_tuck', frames);
  expect(summary.reps).toBe(2);
});

test('sit to stand uses knee angle', () => {
  const frames: Landmark[][] = [];
  for (let k = 0; k < 2; k++) frames.push(...syn.trajectory(172, 95, 60).map((a) => syn.squat(a)));
  const [, summary] = run('sit_to_stand', frames);
  expect(summary.reps).toBe(2);
  expect(summary.good_reps).toBe(2);
});

// --- forgiving by design --------------------------------------------------

function counterRun(ex: Exercise, values: readonly number[], fps = FPS): Rep[] {
  const rc = new RepCounter(ex);
  const reps: Rep[] = [];
  values.forEach((v, i) => {
    const r = rc.update(v, [], i / fps);
    if (r !== null) reps.push(r);
  });
  return reps;
}

test.each(officeCases)('relaxed rep that just reaches target scores well but not full: %s', (_key, ex) => {
  const step = ex.target > ex.rest ? 1 : -1;
  const relaxed = ex.rest - 5 * step;
  const justPast = ex.target + 2 * step;
  const reps = counterRun(ex, syn.trajectory(relaxed, justPast, 2 * FPS));
  expect(reps).toHaveLength(1);
  const rep = reps[0];
  expect(rep.partial).toBe(false);
  expect(rep.issues).toEqual([]);
  expect(rep.score).toBeGreaterThanOrEqual(70);
  expect(rep.score).toBeLessThan(100);
});

test.each(officeCases)('fidgeting at rest is not a rep: %s', (_key, ex) => {
  const step = ex.target > ex.rest ? 1 : -1;
  const relaxed = ex.rest - 5 * step;
  // Python draws this noise from numpy.random.default_rng(0); any +-3 degree noise will do.
  const rng = new syn.PyRandom(0);
  const values = Array.from({ length: 10 * FPS }, () => relaxed + rng.uniform(-3, 3));
  expect(counterRun(ex, values)).toEqual([]);
});

const AREA_MAP: Record<string, string[]> = {
  'Neck tension': ['neck_tilt', 'head_turn', 'chin_to_chest', 'shoulder_shrug', 'chin_tuck'],
  'Rounded shoulders': ['cross_swing', 'wy_raise', 'shoulder_roll', 'thoracic_extension', 'clasp_opener'],
  'Upper back': ['seated_row', 't_raise', 'desk_punch', 'rhomboid_stretch', 'desk_row'],
  'Shoulder & rotator cuff': ['scaption', 'front_raise', 'overhead_reach', 'external_rotation', 'cross_body_stretch'],
  'Lower back': ['seated_side_bend', 'knee_to_chest', 'hip_hinge', 'standing_side_bend', 'back_extension'],
  'Wrist & hand': ['wrist_flex', 'extensor_stretch', 'flexor_stretch', 'prayer_stretch', 'nerve_glide'],
  Knees: ['seated_knee_ext', 'heel_slide', 'sit_to_stand', 'mini_squat', 'hamstring_curl'],
  Eyes: ['palming', 'temple_massage', 'look_far', 'near_far_focus', 'eye_track_vertical'],
};

test('every office exercise sits in its pain area', () => {
  expect([...AREAS]).toEqual(Object.keys(AREA_MAP));
  for (const [area, keys] of Object.entries(AREA_MAP)) {
    expect(new Set(OFFICE_EXERCISES.filter((e) => e.category === area).map(byKey))).toEqual(new Set(keys));
  }
});

test.each([
  [50, 50, 1.5, 70],
  [65, 50, 1.5, 100],
  [20, 50, 1.5, 0],
  [35, 50, 1.5, 35],
  [65, 50, 0.4, 70],
  [65, 50, 0.8, 85],
  [200, 50, 1.5, 100],
  [5, 50, 0.2, 0],
])('office rep score(%p, %p, %p) = %p', (rom, needed, duration, expected) => {
  expect(officeRepScore(rom, needed, duration)).toBe(expected);
});

test.each(officeCases)('partial office rep scores below a full one: %s', (_key, ex) => {
  const step = ex.target > ex.rest ? 1 : -1;
  const relaxed = ex.rest - 5 * step;
  const halfway = relaxed + (ex.target - relaxed) * 0.7;
  const reps = counterRun(ex, syn.trajectory(relaxed, halfway, 2 * FPS));
  expect(reps).toHaveLength(1);
  expect(reps[0].partial).toBe(true);
  expect(reps[0].score).toBeLessThan(70);
});

