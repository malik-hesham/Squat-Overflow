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
  armSwing,
  elbowBack,
  headTurnDrop,
  legsOut,
  officeRepScore,
  palmTurn,
  shoulderTilt,
  trunkTwist,
} from '../../../../../extension/lib/pose/exercises.js';
import { Pose } from '../../../../../extension/lib/pose/geometry.js';
import { RepCounter, type Rep, Session, type Summary, type RepEvent } from '../../../../../extension/lib/pose/session.js';
import * as syn from './synthetic';

const FPS = 30;
const pose = (lms: number[][]) => new Pose(lms, syn.SIZE, syn.SIZE);

function run(key: string, frames: number[][][]): [RepEvent[], Summary] {
  const s = new Session(key);
  const results = frames.map((lm, i) => s.process(lm, syn.SIZE, syn.SIZE, i / FPS));
  return [results.flatMap((r) => (r.rep_event ? [r.rep_event] : [])), results[results.length - 1].summary];
}

function counterRun(ex: Gentle, values: number[], fps = FPS, assist: (v: number) => number | null = () => null): Rep[] {
  const rc = new RepCounter(ex);
  return values.flatMap((v, i) => rc.update(v, [], i / fps, assist(v)) ?? []);
}

/** One rep from `from` to `to` and back over 2 s, staying at `to` for `hold` seconds in the middle. */
function heldRep(from: number, to: number, hold: number): number[] {
  const path = syn.trajectory(from, to, 2 * FPS); // peaks halfway, at frame FPS
  return [...path.slice(0, FPS + 1), ...Array.from({ length: Math.round(hold * FPS) }, () => path[FPS]), ...path.slice(FPS + 1)];
}

const repeat = <T>(n: number, f: () => T[]): T[] => Array.from({ length: n }, f).flat();

// --- catalog ------------------------------------------------------------------

describe('catalog', () => {
  it('has forty-eight office exercises with unique keys', () => {
    const keys = OFFICE_EXERCISES.map((e) => e.key);
    expect(keys).toHaveLength(48);
    expect(new Set(keys).size).toBe(48);
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
      'Neck tension': ['neck_tilt', 'head_turn', 'chin_to_chest', 'shoulder_shrug', 'chin_tuck', 'levator_stretch'],
      'Rounded shoulders': ['cross_swing', 'wy_raise', 'shoulder_roll', 'thoracic_extension', 'clasp_opener', 'shoulder_blade_squeeze'],
      'Upper back': ['seated_row', 't_raise', 'desk_punch', 'rhomboid_stretch', 'desk_row', 'trunk_rotation'],
      'Shoulder & rotator cuff': ['scaption', 'front_raise', 'overhead_reach', 'external_rotation', 'cross_body_stretch', 'seated_jacks'],
      'Lower back': ['seated_side_bend', 'knee_to_chest', 'hip_hinge', 'standing_side_bend', 'back_extension', 'seated_hip_hinge'],
      'Wrist & hand': ['wrist_flex', 'extensor_stretch', 'flexor_stretch', 'prayer_stretch', 'nerve_glide', 'palm_flip'],
      Knees: ['seated_knee_ext', 'heel_slide', 'sit_to_stand', 'mini_squat', 'hamstring_curl', 'seated_march'],
      Eyes: ['palming', 'temple_massage', 'look_far', 'near_far_focus', 'eye_track_vertical', 'eye_track_horizontal'],
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
    // A held stretch stays at the target a little past its hold.
    const reps = counterRun(ex, heldRep(relaxed, ex.target + 2 * step, ex.hold ? ex.hold + 0.2 : 0));
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

// --- moves from the Arthritis Foundation's desk workout, and the ones that even out the areas ---

const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Side view of a seated torso, 500 px from mid-hip to mid-shoulder, with a typical adult's 380 px
 * shoulders and 200 px hips: the hips turned `sit` degrees from side-on, the shoulders `twist` more.
 */
function sideTwist(twist: number, sit = 0): number[][] {
  const at = (half: number, deg: number, y: number, s: number) => [500 + s * half * Math.sin(rad(deg)), y];
  const side = (s: number) => ({ shoulder: at(190, twist + sit, 200, s), hip: at(100, sit, 700, s) });
  return syn.landmarks({ left: side(1), right: side(-1) });
}

/**
 * Side view, seated upright: each thigh `deg` from straight up (90 = level, smaller = knee lifted);
 * the left upper arm swings `swing` degrees forward and the right one as far back.
 */
function sideMarch(leftHip: number, rightHip = 90, swing = 0): number[][] {
  const hip = [500, 600];
  const shoulder = [500, 100];
  const side = (deg: number, arm: number) => {
    const knee = [hip[0] + 220 * Math.sin(rad(deg)), hip[1] - 220 * Math.cos(rad(deg))];
    return { shoulder, elbow: [500 + 150 * Math.sin(rad(arm)), 100 + 150 * Math.cos(rad(arm))], hip, knee, ankle: [knee[0], knee[1] + 210] };
  };
  return syn.landmarks({ left: side(leftHip, swing), right: side(rightHip, -swing) });
}

/** Seated, facing the camera, both arms at `elev` (see syn.upper); the ankles `out` px past the hips. */
function jack(elev: number, out = 0): number[][] {
  const lms = syn.upper({ leftElev: elev, rightElev: elev });
  lms[27] = [lms[27][0] + out / 1000, lms[27][1], lms[27][2]]; // left ankle, on the picture's right
  lms[28] = [lms[28][0] - out / 1000, lms[28][1], lms[28][2]];
  return lms;
}

/** Side view facing +x: the upper arm `deg` behind straight down (negative: in front). */
function sideElbow(deg: number): number[][] {
  const shoulder = [500, 400];
  const elbow = [500 - 150 * Math.sin(rad(deg)), 400 + 150 * Math.cos(rad(deg))];
  return syn.landmarks({ left: { nose: [570, 260], ear: [510, 250], shoulder, elbow, wrist: [elbow[0] + 140, elbow[1]] } });
}

/** Facing the camera, forearms pointing at it, both palms turned `deg` (0 = down, 180 = up). */
function palms(deg: number): number[][] {
  const lms = syn.upper({ leftElev: 10, rightElev: 10 });
  for (const [s, wrist, pinky, thumb] of [[1, 15, 17, 21], [-1, 16, 18, 22]]) {
    const [x, y] = [lms[wrist][0] * 1000, lms[wrist][1] * 1000];
    // Palm down the thumb points inwards (towards the other shoulder), palm up outwards.
    const d = [-s * Math.cos(rad(deg)), -Math.sin(rad(deg))];
    lms[thumb] = [(x + 30 * d[0]) / 1000, (y + 30 * d[1]) / 1000, 0.95];
    lms[pinky] = [(x - 30 * d[0]) / 1000, (y - 30 * d[1]) / 1000, 0.95];
  }
  return lms;
}

describe('angle helpers for the new moves', () => {
  it.each([0, 15, 30, 45])('trunk twist %p reads the same however the chair is turned', (deg) => {
    for (const sit of [0, 12, -18]) expect(trunkTwist(pose(sideTwist(deg, sit)), 'left')).toBeCloseTo(deg, 6);
  });

  it.each([0, 20, 40])('head turn and drop %p is the smaller of the two', (deg) => {
    expect(headTurnDrop(pose(syn.upper({ turn: deg, chinDrop: 30 })), 'left')).toBeCloseTo(Math.min(deg, 30), 6);
    expect(headTurnDrop(pose(syn.upper({ turn: 30, chinDrop: deg })), 'left')).toBeCloseTo(Math.min(deg, 30), 6);
  });

  it.each([-10, 0, 15, 30])('elbow back %p, forward is where the nose points', (deg) => {
    expect(elbowBack(pose(sideElbow(deg)), 'left')).toBeCloseTo(deg, 6);
  });

  it.each([0, 45, 90, 170])('palm turn %p on both hands, mirrored or not', (deg) => {
    const lms = palms(deg);
    expect(palmTurn(pose(lms), 'left')).toBeCloseTo(deg, 6);
    expect(palmTurn(pose(lms), 'right')).toBeCloseTo(deg, 6);
    const mirrored = lms.map(([x, y, v]) => [1 - x, y, v]);
    expect(palmTurn(pose(mirrored), 'left')).toBeCloseTo(deg, 6);
  });

  it('legs out reads the ankles past the hips, and nothing when the legs are out of view', () => {
    expect(legsOut(pose(jack(20)))).toBeCloseTo(0, 6);
    // Ankles 340 px below the hips, each 100 px further out.
    expect(legsOut(pose(jack(20, 100)))).toBeCloseTo((Math.atan2(100, 340) * 180) / Math.PI, 6);
    const hidden = jack(20, 100).map((p, i) => (i === 27 || i === 28 ? [p[0], p[1], 0.1] : p));
    expect(legsOut(pose(hidden))).toBeNull();
  });

  it('arm swing is the arm that swings further, and nothing with no arm in view', () => {
    expect(armSwing(pose(sideMarch(90, 90, 30)))).toBeCloseTo(30, 6);
    expect(armSwing(pose(sideMarch(90, 90, 0)))).toBeCloseTo(0, 6);
    const hidden = sideMarch(90, 90, 30).map((p, i) => ([13, 14].includes(i) ? [p[0], p[1], 0.1] : p));
    expect(armSwing(pose(hidden))).toBeNull();
  });
});

describe('the new moves count', () => {
  it('trunk rotation counts each side', () => {
    const frames = [...syn.trajectory(0, 35, 45).map((a) => sideTwist(a)), ...syn.trajectory(0, -35, 45).map((a) => sideTwist(a))];
    const [events, summary] = run('trunk_rotation', frames);
    expect([summary.reps, summary.good_reps]).toEqual([2, 2]);
    expect(events.every((e) => e.issues.length === 0)).toBe(true);
  });

  it('nose-to-armpit counts each side, but not a turn or a nod on its own', () => {
    const both = [...syn.trajectory(0, 35, 45).map((a) => syn.upper({ turn: a, chinDrop: a })), ...syn.trajectory(0, 35, 45).map((a) => syn.upper({ turn: -a, chinDrop: a }))];
    expect(run('levator_stretch', both)[1].reps).toBe(2);
    expect(run('levator_stretch', syn.trajectory(0, 40, 45).map((a) => syn.upper({ turn: a, chinDrop: 0 })))[1].reps).toBe(0);
    expect(run('levator_stretch', syn.trajectory(0, 40, 45).map((a) => syn.upper({ chinDrop: a })))[1].reps).toBe(0);
  });

  it('shoulder blade squeeze counts only once held for 3 s', () => {
    const [, held] = run('shoulder_blade_squeeze', heldRep(0, 22, 3.3).map((a) => sideElbow(a)));
    expect([held.reps, held.good_reps]).toEqual([1, 1]);
    const [events, short] = run('shoulder_blade_squeeze', heldRep(0, 22, 1).map((a) => sideElbow(a)));
    expect([short.reps, short.partial_reps]).toEqual([0, 1]);
    expect(events[0].issues).toEqual(['hold_longer']);
  });

  it('seated hip hinge counts each lean', () => {
    const frames = repeat(2, () => syn.trajectory(5, 45, 45).map((a) => syn.curl(150, 5, a)));
    expect(run('seated_hip_hinge', frames)[1].reps).toBe(2);
  });

  it('palm flips count each turn up', () => {
    const frames = repeat(2, () => syn.trajectory(5, 170, 45).map((a) => palms(a)));
    const [, summary] = run('palm_flip', frames);
    expect([summary.reps, summary.good_reps]).toEqual([2, 2]);
  });

  it('side-to-side tracking counts each thumb going out', () => {
    const out = (a: number, alt: boolean) => syn.upper(alt ? { leftElev: -40, rightElev: a - 90 } : { leftElev: a - 90, rightElev: -40 });
    const frames = [...syn.trajectory(45, 150, 45).map((a) => out(a, false)), ...syn.trajectory(45, 150, 45).map((a) => out(a, true))];
    expect(run('eye_track_horizontal', frames)[1].reps).toBe(2);
  });

  it('seated march counts each knee lift; arms that stay still lower the score', () => {
    const steps = (swing: number) => [
      ...syn.trajectory(90, 62, 45).map((a) => sideMarch(a, 90, ((90 - a) / 28) * swing)),
      ...syn.trajectory(90, 62, 45).map((a) => sideMarch(90, a, ((90 - a) / 28) * swing)),
    ];
    const [swinging, a] = run('seated_march', steps(35));
    const [still, b] = run('seated_march', steps(0));
    expect([a.reps, a.good_reps, b.reps, b.good_reps]).toEqual([2, 2, 2, 0]);
    expect(still.every((e) => e.issues.includes('arms_still'))).toBe(true);
    expect(still[0].score).toBe(swinging[0].score - 20);
  });

  it('seated jacks count the arms; legs that stay in lower the score, legs out of view never do', () => {
    const jacks = (out: number) => repeat(2, () => syn.trajectory(15, 140, 45).map((a) => jack(a, ((a - 15) / 125) * out)));
    const [, out] = run('seated_jacks', jacks(120));
    const [still] = run('seated_jacks', jacks(0));
    const hidden = jacks(0).map((lms) => lms.map((p, i) => (i === 27 || i === 28 ? [p[0], p[1], 0.1] : p)));
    const [, unseen] = run('seated_jacks', hidden);
    expect([out.reps, out.good_reps]).toEqual([2, 2]);
    expect(still.map((e) => e.issues)).toEqual([['legs_still'], ['legs_still']]);
    expect(still.every((e) => !e.partial)).toBe(true);
    expect([unseen.reps, unseen.good_reps]).toEqual([2, 2]);
  });
});

// A shared rule (extension/tests/check.mjs pins it too): a held stretch only counts once held.
describe('held stretches', () => {
  const bend = CATALOG.seated_side_bend as Gentle; // shoulder tilt, rest 7, target 14, held 5 s

  it('counts once held long enough, and is partial with hold_longer when let go early', () => {
    expect(bend.hold).toBe(5);
    const [held] = counterRun(bend, heldRep(2, 20, 5.2));
    expect([held.partial, held.issues]).toEqual([false, []]);
    const [short] = counterRun(bend, heldRep(2, 20, 2));
    expect([short.partial, short.issues]).toEqual([true, ['hold_longer']]);
  });

  it('a little sag keeps the hold going; sagging most of the way back starts it again', () => {
    const sag = (to: number) => [...heldRep(2, 20, 0).slice(0, FPS + 1), ...Array(2 * FPS).fill(20), ...syn.trajectory(20, to, 20), ...Array(3 * FPS).fill(20), ...syn.trajectory(20, 2, 2 * FPS).slice(FPS)];
    expect(counterRun(bend, sag(13))[0].partial).toBe(false);
    expect(counterRun(bend, sag(9))[0].partial).toBe(true);
  });

  it('the session counts the hold down, only for held stretches', () => {
    const frames = heldRep(2, 20, 5.5).map((deg) => syn.upper({ shoulderDrop: 200 * Math.tan(rad(deg)) }));
    const s = new Session('seated_side_bend');
    const holds = frames.map((lm, i) => s.process(lm, syn.SIZE, syn.SIZE, i / FPS).hold).filter((h) => h !== undefined) as number[];
    expect(holds.length).toBeGreaterThan(4 * FPS);
    expect(holds.every((h, i) => !i || h <= holds[i - 1])).toBe(true);
    const m = new Session('seated_march');
    expect(m.process(syn.upper(), syn.SIZE, syn.SIZE, 0).hold).toBeUndefined();
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
