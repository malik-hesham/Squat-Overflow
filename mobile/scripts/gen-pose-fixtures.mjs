#!/usr/bin/env node
/**
 * Golden fixtures for the pose analysis (extension/lib/pose), replayed by the mobile jest suite in
 * mobile/src/pose/analysis/__tests__ (helpers.ts `replay`, session/measure/catalog .parity tests).
 *
 * Run from the repo root:
 *
 *     node mobile/scripts/gen-pose-fixtures.mjs           # rewrite the fixtures whose content changed
 *     node mobile/scripts/gen-pose-fixtures.mjs --check   # write nothing; exit 1 listing what would change
 *
 * The extension's pose module is the reference now. These fixtures used to be recorded from the
 * Python pose server's `analysis` package by gen_pose_fixtures.py; that server was deleted in
 * 5ebe1162, so this script drives extension/lib/pose instead. It is a port of the Python script:
 * the same scenarios, scenario lists, pose builders, rep levels and encoding, and Python's own
 * random number generator (MT19937, `random.Random(seed)`) consumed in the same order. For every
 * exercise the Python server had, it reproduces the Python-recorded fixtures value for value; new
 * exercises get fixtures too (iterated after the Python ones, see PYTHON_ORDER).
 *
 * It generates session_<exercise>.json, catalog.json (exerciseCatalog() and the static tables) and
 * measure.json (every exercise's measure() on random and synthetic poses). Each output is compared
 * with the file on disk after parsing both (integers exactly, floats within 1e-9), and only files
 * whose content differs are rewritten, so number formatting alone never causes churn.
 *
 * numeric.json and align_world_y.json are NOT generated here and stay as Python recorded them.
 * They pin the numerics that the JS port has to share with CPython (pymath's round/sum/hypot/median,
 * the trig functions, officeRepScore, the angle helpers, calibration validate and Calibrator, and
 * alignWorldY) against Python's own results. Recording them from the JS code would only compare
 * the JS with itself.
 *
 * Every input is rounded to 5 decimals (Python's round, pyRound) before the session sees it, so the
 * replay gets bit-identical inputs.
 *
 * Session fixtures (session_<exercise>.json) are delta-encoded to stay small:
 *
 *     {"exercise": key, "scenarios": [{"name", "width", "height", "steps": [...]}]}
 *
 * The first step of a scenario creates the session; the rest are control ops or frames:
 *
 *     {"op": "new", "exercise": key, "use_world": bool}
 *     {"op": "set_exercise", "exercise": key, "thresholds": {"rest", "target"} | null}
 *     {"op": "reset"}
 *     {"op": "angle_mode", "use_world": bool}
 *     {"op": "calibrate", "action": "start" | "cancel"}
 *     {"t": seconds, "lm": [[i, x, y, v], ...] | null, "w": [[i, x, y, z], ...], "out": {...}, "gone": [...]}
 *
 * `lm` lists the landmarks that changed since the previous frame that had landmarks (all 33 the
 * first time), as [i, x, y] when only x and y changed; null means nobody was detected. `w` works
 * the same way for world landmarks (always [i, x, y, z]); a frame without `w` passes world = null.
 * Coordinates in `lm` and `w` are integers in units of 1e-5 (value = n / 100000, the same double in
 * any language that divides with correct rounding), except negative zero, written as -0.0.
 *
 * `out` holds the keys of the session's result that differ from the previous frame's result, and
 * `gone` the keys that disappeared since (e.g. "calibration").
 */

import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AREAS,
  CATALOG,
  CONNECTIONS,
  DEFAULT_EXERCISE,
  EXERCISES,
  ISSUE_TEXT,
  JOINTS,
  Pose,
  Session,
  alignWorldY,
  exerciseCatalog,
  validateCalibration,
} from "../../extension/lib/pose/index.js";
import { add, norm, sub } from "../../extension/lib/pose/geometry.js";
import { pyRound, radians } from "../../extension/lib/pose/pymath.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(REPO, "mobile/src/pose/analysis/__tests__/fixtures");

const SIZE = 1000; // synthetic poses are built in a 1000 x 1000 pixel space
const DIGITS = 5;
const FPS = 10; // controlled reps; rushed and medium reps use a faster frame rate
const FLOAT_TOLERANCE = 1e-9; // when comparing with the fixtures on disk

/**
 * The order of the Python server's EXERCISES. The Python script iterated EXERCISES with one rng
 * shared across exercises, so the Python-era keys go first, in this order, for their fixtures to
 * come out the same. Exercises added since follow, in EXERCISES order.
 */
const PYTHON_ORDER = [
  "squat", "pushup", "curl", "press", "neck_tilt", "head_turn", "chin_to_chest", "shoulder_shrug", "chin_tuck",
  "cross_swing", "wy_raise", "shoulder_roll", "thoracic_extension", "clasp_opener", "seated_row", "t_raise",
  "desk_punch", "rhomboid_stretch", "desk_row", "scaption", "front_raise", "overhead_reach", "external_rotation",
  "cross_body_stretch", "seated_side_bend", "knee_to_chest", "hip_hinge", "standing_side_bend", "back_extension",
  "wrist_flex", "extensor_stretch", "flexor_stretch", "prayer_stretch", "nerve_glide", "seated_knee_ext",
  "heel_slide", "sit_to_stand", "mini_squat", "hamstring_curl", "palming", "temple_massage", "look_far",
  "near_far_focus", "eye_track_vertical",
];
const PYTHON_KEYS = PYTHON_ORDER.filter((k) => Object.hasOwn(EXERCISES, k));
const ORDER = [...PYTHON_KEYS, ...Object.keys(EXERCISES).filter((k) => !PYTHON_ORDER.includes(k))];

// --- Python's random.Random -------------------------------------------------

/**
 * CPython's `random.Random(seed)` for an int seed: MT19937 seeded with init_by_array over the
 * seed's 32-bit words, random() = 53 bits from two draws, uniform(a, b) = a + (b - a) * random().
 */
class PyRandom {
  static N = 624;
  static M = 397;

  /** @param {number} seed */
  constructor(seed) {
    if (!Number.isSafeInteger(seed)) throw new Error(`seed must be an integer, got ${seed}`);
    const key = [];
    let n = Math.abs(seed);
    do {
      key.push(n % 2 ** 32);
      n = Math.floor(n / 2 ** 32);
    } while (n > 0);
    this.mt = new Uint32Array(PyRandom.N);
    this.index = PyRandom.N;
    this.initByArray(key);
  }

  /** @private @param {number} s */
  initGenrand(s) {
    const mt = this.mt;
    mt[0] = s;
    for (let i = 1; i < PyRandom.N; i++) {
      mt[i] = (Math.imul(1812433253, mt[i - 1] ^ (mt[i - 1] >>> 30)) + i) >>> 0;
    }
    this.index = PyRandom.N;
  }

  /** @private @param {number[]} key */
  initByArray(key) {
    const { N } = PyRandom;
    const mt = this.mt;
    this.initGenrand(19650218);
    let i = 1;
    let j = 0;
    for (let k = Math.max(N, key.length); k > 0; k--) {
      mt[i] = ((mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1664525)) + key[j] + j) >>> 0; // non linear
      i++;
      j++;
      if (i >= N) {
        mt[0] = mt[N - 1];
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (let k = N - 1; k > 0; k--) {
      mt[i] = ((mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1566083941)) - i) >>> 0; // non linear
      i++;
      if (i >= N) {
        mt[0] = mt[N - 1];
        i = 1;
      }
    }
    mt[0] = 0x80000000; // MSB is 1, assuring a non-zero initial array
  }

  /** @private */
  genrand() {
    const { N, M } = PyRandom;
    const mt = this.mt;
    const twist = (kk, next, far) => {
      const y = (mt[kk] & 0x80000000) | (mt[next] & 0x7fffffff);
      mt[kk] = mt[far] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
    };
    if (this.index >= N) {
      let kk = 0;
      for (; kk < N - M; kk++) twist(kk, kk + 1, kk + M);
      for (; kk < N - 1; kk++) twist(kk, kk + 1, kk + (M - N));
      twist(N - 1, 0, M - 1);
      this.index = 0;
    }
    let y = mt[this.index++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  random() {
    const a = this.genrand() >>> 5;
    const b = this.genrand() >>> 6;
    return (a * 67108864.0 + b) / 9007199254740992.0;
  }

  /** @param {number} a @param {number} b */
  uniform(a, b) {
    return a + (b - a) * this.random();
  }
}

// --- rounding and encoding ---------------------------------------------------

/** Python's round(x, ndigits). pyRound turns -0.0 into 0 (toFixed drops the sign); Python keeps it. */
function pythonRound(x, ndigits) {
  return Object.is(x, -0) ? -0 : pyRound(x, ndigits);
}

const r5 = (v) => pythonRound(v, DIGITS);

/** @param {number[][] | null} points */
function roundPoints(points) {
  return points === null ? null : points.map((p) => p.map(r5));
}

/**
 * A value already rounded to 5 decimals -> exact integer count of 1e-5 (-0.0 stays a float).
 * Python computed int(Decimal(repr(v)) * 100000); for a value rounded to 5 decimals that is the one
 * integer n with n / 100000 == v, which is what this finds and checks.
 */
function q(v) {
  if (Object.is(v, -0)) return -0;
  const n = Math.round(v * 100000) || 0;
  if (n / 100000 !== v) throw new Error(`${v} is not rounded to ${DIGITS} decimals`);
  return n;
}

/** Python's == on JSON-like values: 1 == 1.0 == True, -0.0 == 0.0, dicts in any key order. */
function pyEq(a, b) {
  if (typeof a === "boolean") a = Number(a);
  if (typeof b === "boolean") b = Number(b);
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => pyEq(x, b[i]));
  }
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && pyEq(a[k], b[k]));
}

/**
 * Changed points as [i, ...point]; with keepLast = false, [i, x, y] when the last value
 * (visibility) didn't change.
 */
function delta(prev, cur, keepLast = true) {
  const out = [];
  cur.forEach((p, i) => {
    if (prev !== null && pyEq(prev[i], p)) return;
    const sameLast = prev !== null && prev[i][2] === p[2];
    out.push([i, ...(sameLast && !keepLast ? p.slice(0, 2) : p).map(q)]);
  });
  return out;
}

/**
 * A result -> plain JSON values, as a client would see it after JSON (Python's
 * json.loads(json.dumps(obj))), except that -0 keeps its sign as it does in Python.
 */
function plain(v) {
  if (v === null || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`not JSON: ${v}`);
    return v;
  }
  if (typeof v === "object" && typeof v.toJSON === "function") return plain(v.toJSON());
  if (Array.isArray(v)) return v.map((x) => (x === undefined || typeof x === "function" ? null : plain(x)));
  if (typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined && typeof x !== "function") out[k] = plain(x);
    return out;
  }
  throw new Error(`not JSON: ${typeof v}`);
}

/** One scenario: a fresh Session plus the steps that drive it, recorded as they happen. */
class Recorder {
  constructor(name, exercise, { useWorld = false, width = SIZE, height = SIZE } = {}) {
    this.name = name;
    this.width = width;
    this.height = height;
    this.session = new Session(exercise, useWorld);
    this.steps = [{ op: "new", exercise, use_world: useWorld }];
    this.t = 0.0;
    this.prevLm = null;
    this.prevW = null;
    this.prevOut = {};
    this.frames = 0;
    this.events = [];
  }

  // Control ops, replayed 1:1 by the jest test.
  setExercise(key, thresholds = null) {
    this.session.setExercise(key, thresholds);
    this.steps.push({
      op: "set_exercise",
      exercise: key,
      thresholds: thresholds === null ? null : { rest: thresholds.rest, target: thresholds.target },
    });
  }

  reset() {
    this.session.reset();
    this.steps.push({ op: "reset" });
  }

  angleMode(useWorld) {
    this.session.setAngleMode(useWorld);
    this.steps.push({ op: "angle_mode", use_world: useWorld });
  }

  calibrate(action) {
    if (action === "start") this.session.startCalibration();
    else this.session.cancelCalibration();
    this.steps.push({ op: "calibrate", action });
  }

  frame(lms, world = null, dt = 1 / FPS) {
    lms = roundPoints(lms);
    world = roundPoints(world);
    const t = r5(this.t);
    const out = plain(this.session.process(lms, this.width, this.height, t, world));
    const step = { t };
    if (lms === null) {
      step.lm = null;
    } else {
      step.lm = delta(this.prevLm, lms, false);
      this.prevLm = lms;
    }
    if (world !== null) {
      step.w = delta(this.prevW, world);
      this.prevW = world;
    }
    step.out = Object.fromEntries(
      Object.entries(out).filter(([k, v]) => !Object.hasOwn(this.prevOut, k) || !pyEq(this.prevOut[k], v)),
    );
    const gone = Object.keys(this.prevOut).filter((k) => !Object.hasOwn(out, k));
    if (gone.length) step.gone = gone;
    this.prevOut = out;
    this.steps.push(step);
    this.t += dt;
    this.frames += 1;
    if (out.rep_event) this.events.push(out.rep_event);
    return out;
  }

  toJSON() {
    return { name: this.name, width: this.width, height: this.height, steps: this.steps };
  }
}

// --- synthetic poses -----------------------------------------------------------
// Port of server/tests/synthetic.py and the `upper` / `side_head` builders of
// server/tests/test_office.py, with numpy's arithmetic in the same order (radians is CPython's
// x * (pi / 180), norm is sqrt(v . v) like np.linalg.norm).

const mul = (k, a) => [k * a[0], k * a[1]];
const div = (a, k) => [a[0] / k, a[1] / k];

/**
 * Point at `length` from `center` such that angle(ref, center, point) == deg.
 * Two points satisfy that; `prefer` picks one: "up", "down", "fwd" (+x), "back" (-x).
 */
function bend(center, ref, deg, length, prefer) {
  const d = sub(ref, center);
  const u = div(d, norm(d));
  const r = radians(deg);
  const cands = [1, -1].map((s) => {
    const c = Math.cos(s * r);
    const sn = Math.sin(s * r);
    return add(center, mul(length, [c * u[0] - sn * u[1], sn * u[0] + c * u[1]]));
  });
  const key = { up: (p) => p[1], down: (p) => -p[1], fwd: (p) => -p[0], back: (p) => p[0] }[prefer];
  return key(cands[1]) < key(cands[0]) ? cands[1] : cands[0]; // min() keeps the first on ties
}

/** points: {left, right}; a side not given mirrors left at low visibility. */
function landmarks(points, otherVis = 0.2) {
  const lms = Array.from({ length: 33 }, () => [0.5, 0.5, 0.9]);
  for (const side of ["left", "right"]) {
    const [src, vis] = side in points ? [points[side], 0.95] : [points.left, otherVis];
    for (const [joint, idx] of Object.entries(JOINTS[side])) {
      if (joint in src) {
        const [x, y] = src[joint];
        lms[idx] = [x / SIZE, y / SIZE, vis];
      }
    }
  }
  return lms;
}

function squat(kneeDeg, { leanDeg = 10.0, kneeShift = 0.0 } = {}) {
  const ankle = [500.0, 900.0];
  const knee = [500.0 + kneeShift, 700.0];
  const hip = bend(knee, ankle, kneeDeg, 200, "back");
  const lean = radians(leanDeg);
  const shoulder = add(hip, mul(250, [Math.sin(lean), -Math.cos(lean)]));
  return landmarks({
    left: {
      ankle, knee, hip, shoulder, heel: [480.0, 915.0], toe: [560.0, 915.0],
      elbow: add(shoulder, [0, 120]), wrist: add(shoulder, [0, 240]),
    },
  });
}

function pushup(elbowDeg, { hipOffset = 0.0, vertical = false } = {}) {
  const [shoulder, hip, ankle] = vertical // standing upright: not a plank
    ? [[500.0, 300], [500.0, 550], [500.0, 900]]
    : [[300.0, 500], [550.0, 520 + hipOffset], [800.0, 540]];
  const elbow = add(shoulder, [0, 110]);
  const wrist = bend(elbow, shoulder, elbowDeg, 110, "back");
  return landmarks({
    left: {
      shoulder, elbow, wrist, hip, ankle,
      knee: div(add(hip, ankle), 2), heel: add(ankle, [10, 0]), toe: add(ankle, [10, 20]),
    },
  });
}

function curl(elbowDeg, { driftDeg = 5.0, leanDeg = 0.0 } = {}) {
  const hip = [500.0, 600];
  const lean = radians(leanDeg);
  const shoulder = add(hip, mul(280, [Math.sin(lean), -Math.cos(lean)]));
  const elbow = bend(shoulder, hip, driftDeg, 150, "fwd");
  const wrist = bend(elbow, shoulder, elbowDeg, 140, "fwd");
  return landmarks({
    left: {
      shoulder, elbow, wrist, hip,
      knee: add(hip, [0, 200]), ankle: add(hip, [0, 400]), heel: add(hip, [-10, 410]), toe: add(hip, [40, 410]),
    },
  });
}

function press(elbowDeg, { armsDown = false, rightOffset = 0.0 } = {}) {
  const sides = {};
  for (const [side, sx, out] of [["left", 600.0, 1], ["right", 400.0, -1]]) {
    const shoulder = [sx, 300.0];
    const elbow = add(shoulder, [out * 110, 0]);
    let wrist = bend(elbow, shoulder, elbowDeg, 110, armsDown ? "down" : "up");
    if (side === "right") wrist = add(wrist, [0, rightOffset]);
    sides[side] = {
      shoulder, elbow, wrist, hip: add(shoulder, [0, 260]), knee: add(shoulder, [0, 450]), ankle: add(shoulder, [0, 640]),
    };
  }
  return landmarks(sides);
}

/** start -> end -> start following a cosine (natural acceleration). */
function trajectory(start, end, frames) {
  return Array.from({ length: frames + 1 }, (_, i) => start + ((end - start) * (1 - Math.cos((2 * Math.PI * i) / frames))) / 2);
}

/**
 * Side-view landmarks -> the same pose filmed from the front: the side view's x becomes depth.
 * Returns [image landmarks, world landmarks] (world centred on x = 0.5, in the side view's units).
 */
function turnToCamera(lms, halfWidth = 0.06) {
  const image = [];
  const world = [];
  lms.forEach(([x, y], i) => {
    const offset = i < 11 ? 0.0 : i % 2 ? halfWidth : -halfWidth; // odd = left side
    image.push([0.5 + offset, y, 0.95]);
    world.push([offset, y, x - 0.5]);
  });
  return [image, world];
}

/**
 * Seated, facing the camera. Arm elevation in degrees (0 = hanging, 180 = overhead, negative =
 * across the chest). `chinDrop` puts the nose that many degrees below the ears; `shrug` lifts both
 * shoulders by that many pixels.
 */
function upper({ leftElev = 20.0, rightElev = 20.0, tilt = 0.0, turn = 0.0, shoulderDrop = 0.0, chinDrop = null, shrug = 0.0 } = {}) {
  const sides = {};
  const noseY = chinDrop === null ? 300.0 : 280.0 + 60 * Math.tan(radians(chinDrop));
  for (const [side, sx, out] of [["left", 600.0, 1], ["right", 400.0, -1]]) {
    const shoulder = [sx, 400.0 - shrug + (side === "left" ? shoulderDrop : 0.0)];
    const e = radians(side === "left" ? leftElev : rightElev);
    const wrist = add(shoulder, mul(250, [out * Math.sin(e), Math.cos(e)]));
    const t = radians(tilt);
    const ear = add([500.0, 280.0], mul(out * 60, [Math.cos(t), Math.sin(t)]));
    const nose = [500.0 + 60 * Math.sin(radians(turn)), noseY];
    sides[side] = {
      nose, ear, shoulder, elbow: div(add(shoulder, wrist), 2), wrist,
      hip: add(shoulder, [0, 300]), knee: add(shoulder, [0, 450]), ankle: add(shoulder, [0, 640]),
    };
  }
  return landmarks(sides);
}

/** Side view: the ear sits 150 px from the shoulder, `forwardDeg` in front of straight up. */
function sideHead(forwardDeg) {
  const shoulder = [500.0, 400.0];
  const a = radians(forwardDeg);
  const ear = add(shoulder, mul(150, [Math.sin(a), -Math.cos(a)]));
  return landmarks({ left: { shoulder, ear, nose: add(ear, [40, 10]) } });
}

// --- pose builders ---------------------------------------------------------------
// Each maps one parameter to landmarks whose primary angle (2D, square frame) is that parameter,
// so rep levels can be chosen in angle space.

/** Side view, left arm raised `elev` degrees forward from hanging, elbow bent to `elbow`. */
function sideArm(elev, elbow = 180.0) {
  const shoulder = [500.0, 400.0];
  const e = radians(elev);
  const elbowPt = add(shoulder, mul(150, [Math.sin(e), Math.cos(e)]));
  const wrist = bend(elbowPt, shoulder, elbow, 140, "up");
  const hand = div(sub(wrist, elbowPt), norm(sub(wrist, elbowPt)));
  const hip = [500.0, 680.0];
  return landmarks({
    left: {
      nose: add(shoulder, [70, -140]), ear: add(shoulder, [5, -150]), shoulder, elbow: elbowPt, wrist,
      index: add(wrist, mul(40, hand)), hip, knee: add(hip, [180, 10]), ankle: add(hip, [190, 210]),
      heel: add(hip, [170, 225]), toe: add(hip, [240, 225]),
    },
  });
}

/** Side view, seated; per-side hip (torso vs thigh) and knee angles. Both sides visible. */
function seatedLegs({ hip = [90.0, 90.0], knee = [90.0, 90.0] } = {}) {
  const sides = {};
  for (const [side, h, k] of [["left", hip[0], knee[0]], ["right", hip[1], knee[1]]]) {
    const hipPt = [500.0, 600.0];
    const shoulder = [500.0, 320.0];
    const kneePt = bend(hipPt, shoulder, h, 200, "fwd");
    const ankle = bend(kneePt, hipPt, k, 200, "down");
    sides[side] = {
      nose: add(shoulder, [60, -110]), ear: add(shoulder, [10, -110]), shoulder,
      elbow: add(shoulder, [20, 130]), wrist: add(shoulder, [120, 200]), index: add(shoulder, [150, 200]),
      hip: hipPt, knee: kneePt, ankle, heel: add(ankle, [-10, 10]), toe: add(ankle, [50, 10]),
    };
  }
  return landmarks(sides);
}

/** Side view, standing on straight thighs; per-side knee angle (heel goes back). */
function standingLegs({ knee = [175.0, 175.0] } = {}) {
  const sides = {};
  for (const [side, k] of [["left", knee[0]], ["right", knee[1]]]) {
    const hip = [500.0, 500.0];
    const shoulder = [500.0, 220.0];
    const kneePt = add(hip, [0, 200]);
    const ankle = bend(kneePt, hip, k, 200, "back");
    sides[side] = {
      nose: add(shoulder, [60, -110]), ear: add(shoulder, [10, -110]), shoulder,
      elbow: add(shoulder, [10, 130]), wrist: add(shoulder, [60, 230]), index: add(shoulder, [80, 250]),
      hip, knee: kneePt, ankle, heel: add(ankle, [-10, 10]), toe: add(ankle, [50, 10]),
    };
  }
  return landmarks(sides);
}

/** Front view, torso bent `tilt` degrees sideways about the mid-hip. */
function frontTorso(tilt) {
  const t = radians(tilt);
  const up = [Math.sin(t), -Math.cos(t)];
  const across = [Math.cos(t), Math.sin(t)];
  const midHip = [500.0, 620.0];
  const midSh = add(midHip, mul(280, up));
  const sides = {};
  for (const [side, out] of [["left", 1], ["right", -1]]) {
    const sh = add(midSh, mul(out * 100, across));
    const hip = add(midHip, [out * 60, 0]);
    sides[side] = {
      nose: add(midSh, mul(110, up)), ear: add(add(midSh, mul(100, up)), mul(out * 45, across)), shoulder: sh,
      elbow: add(sh, [out * 15, 130]), wrist: add(sh, [out * 20, 250]), index: add(sh, [out * 22, 290]),
      hip, knee: add(hip, [0, 190]), ankle: add(hip, [0, 370]), heel: add(hip, [0, 385]), toe: add(hip, [out * 10, 395]),
    };
  }
  return landmarks(sides);
}

/** Side view, arm out in front, hand bent so the wrist angle is `deg`. */
function sideWrist(deg) {
  const shoulder = [380.0, 400.0];
  const elbow = [530.0, 430.0];
  const wrist = [680.0, 440.0];
  const hip = [380.0, 680.0];
  return landmarks({
    left: {
      nose: add(shoulder, [60, -140]), ear: add(shoulder, [0, -150]), shoulder, elbow, wrist,
      index: bend(wrist, elbow, deg, 70, "down"), hip, knee: add(hip, [180, 0]), ankle: add(hip, [180, 200]),
    },
  });
}

/** Front view, forearms up in front of the chest, both wrists bent to `deg`. */
function frontWrists(deg) {
  const sides = {};
  for (const [side, out] of [["left", 1], ["right", -1]]) {
    const shoulder = [500 + out * 100.0, 400.0];
    const elbow = [500 + out * 150.0, 560.0];
    const wrist = [500 + out * 40.0, 470.0];
    sides[side] = {
      nose: [500.0, 300.0], ear: [500.0 + out * 60, 290.0], shoulder, elbow, wrist,
      index: bend(wrist, elbow, deg, 60, "up"), hip: add(shoulder, [0, 300]), knee: add(shoulder, [0, 450]),
      ankle: add(shoulder, [0, 640]),
    };
  }
  return landmarks(sides);
}

/**
 * Side view, seated, arms crossed on the chest, for trunkTwist: the shoulders (0.76 torso lengths
 * wide) turned `turn` degrees from side-on, the hips (0.4 wide) square. Side-on, a line `span`
 * torso lengths wide turned `a` degrees spreads span * torso * sin(a) across the picture, so the
 * shoulders spread to give `turn` and the hips, at 0 degrees, sit on top of each other.
 */
function seatedTwist(turn) {
  const midHip = [500.0, 600.0];
  const midSh = [500.0, 320.0];
  const torso = midHip[1] - midSh[1];
  const spread = (span, deg) => span * torso * Math.sin(radians(deg));
  const sides = {};
  for (const [side, out] of [["left", 1], ["right", -1]]) {
    const sh = add(midSh, [(out * spread(0.76, turn)) / 2, 0]);
    const hip = add(midHip, [(out * spread(0.4, 0)) / 2, 0]);
    sides[side] = {
      nose: add(midSh, [60, -110]), ear: add(midSh, [10, -110]), shoulder: sh,
      elbow: add(sh, [50, 110]), wrist: add(sh, [70, 30]), index: add(sh, [85, 20]),
      hip, knee: add(hip, [200, 0]), ankle: add(hip, [200, 200]), heel: add(hip, [190, 210]), toe: add(hip, [250, 210]),
    };
  }
  return landmarks(sides);
}

/** seatedLegs with the arms swinging: the left upper arm `swing` degrees forward, the right as far back. */
function seatedMarch(hip, swing) {
  const lms = seatedLegs({ hip });
  const shoulder = [500.0, 320.0];
  for (const [i, deg] of [[JOINTS.left.elbow, swing], [JOINTS.right.elbow, -swing]]) {
    lms[i] = [(shoulder[0] + 150 * Math.sin(radians(deg))) / SIZE, (shoulder[1] + 150 * Math.cos(radians(deg))) / SIZE, lms[i][2]];
  }
  return lms;
}

/** upper() with both arms at `elev` and the ankles `out` px further out than the hips. */
function jack(elev, out) {
  const lms = upper({ leftElev: elev, rightElev: elev });
  for (const [i, s] of [[JOINTS.left.ankle, 1], [JOINTS.right.ankle, -1]]) lms[i] = [lms[i][0] + (s * out) / SIZE, lms[i][1], lms[i][2]];
  return lms;
}

/** Side view facing +x (nose ahead of the ear): the upper arm `deg` behind straight down. */
function sideElbow(deg) {
  const shoulder = [500.0, 400.0];
  const elbow = add(shoulder, mul(150, [-Math.sin(radians(deg)), Math.cos(radians(deg))]));
  const hip = [500.0, 680.0];
  return landmarks({
    left: {
      nose: add(shoulder, [70, -140]), ear: add(shoulder, [10, -150]), shoulder, elbow, wrist: add(elbow, [140, 0]),
      index: add(elbow, [180, 0]), hip, knee: add(hip, [180, 10]), ankle: add(hip, [190, 210]),
    },
  });
}

/** Facing the camera, forearms pointing at it, both palms turned `deg` (0 = down, 180 = up). */
function palms(deg) {
  const lms = upper({ leftElev: 10, rightElev: 10 });
  for (const [side, s, pinky, thumb] of [["left", 1, 17, 21], ["right", -1, 18, 22]]) {
    const [x, y] = lms[JOINTS[side].wrist];
    // Palm down the thumb points inwards (towards the other shoulder), palm up outwards.
    const d = [-s * Math.cos(radians(deg)), -Math.sin(radians(deg))];
    lms[thumb] = [x + (30 * d[0]) / SIZE, y + (30 * d[1]) / SIZE, 0.95];
    lms[pinky] = [x - (30 * d[0]) / SIZE, y - (30 * d[1]) / SIZE, 0.95];
  }
  return lms;
}

/** `upper({ shrug })` that gives this ear height angle (ears 40 px in, 120 px above the shoulders). */
const shrugFor = (earAngle) => 120 - 40 * Math.tan(radians(earAngle));

/** `upper({ shoulderDrop })` that tilts the shoulder line by `deg` (shoulders 200 px apart). */
const tiltDrop = (deg) => 200 * Math.tan(radians(deg));

/**
 * How to pose a body for one exercise: build(param, alt) -> landmarks; alt = the other side.
 * Exercises with an assist also say how to pose it with the second movement kept still (`still`)
 * and which landmarks to hide to take it out of view (`hide`).
 */
const driver = (build, alternates = false, extra = {}) => ({ build, alternates, ...extra }); // alternates: each side is a rep

const armAcrossOne = (a, alt) => {
  const e = a - 90; // arm_across = 90 + arm elevation (negative = across the chest)
  return alt ? upper({ leftElev: 0, rightElev: e }) : upper({ leftElev: e, rightElev: 0 });
};

/** One driver per exercise in EXERCISES. A new exercise needs a line here. */
const DRIVERS = {
  neck_tilt: driver((a, alt) => upper({ tilt: alt ? -a : a }), true),
  head_turn: driver((a, alt) => upper({ turn: alt ? -a : a }), true),
  chin_to_chest: driver((a) => upper({ chinDrop: a })),
  shoulder_shrug: driver((a) => upper({ shrug: shrugFor(a) })),
  chin_tuck: driver((a) => sideHead(a)),
  cross_swing: driver((a) => upper({ leftElev: a - 90, rightElev: a - 90 })),
  wy_raise: driver((a) => press(a)),
  shoulder_roll: driver((a) => upper({ shrug: shrugFor(a) })),
  thoracic_extension: driver((a) => curl(150, { leanDeg: -a })), // arching back
  clasp_opener: driver((a) => sideArm(-a)), // hands lifted behind the back
  seated_row: driver((a) => sideArm(60, a)),
  t_raise: driver((a) => upper({ leftElev: a, rightElev: a })),
  desk_punch: driver((a) => sideArm(70, a)),
  rhomboid_stretch: driver((a) => curl(150, { leanDeg: a })),
  desk_row: driver((a) => sideArm(30, a)),
  scaption: driver((a) => upper({ leftElev: a, rightElev: a })),
  front_raise: driver((a) => sideArm(a)),
  overhead_reach: driver((a) => upper({ leftElev: a, rightElev: a })),
  external_rotation: driver((a) => upper({ leftElev: a - 90, rightElev: a - 90 })),
  cross_body_stretch: driver(armAcrossOne, true),
  seated_side_bend: driver((a, alt) => upper({ shoulderDrop: tiltDrop(alt ? -a : a) }), true),
  knee_to_chest: driver((a, alt) => seatedLegs({ hip: alt ? [90, a] : [a, 90] }), true),
  hip_hinge: driver((a) => curl(150, { leanDeg: a })),
  standing_side_bend: driver((a, alt) => frontTorso(alt ? -a : a), true),
  back_extension: driver((a) => curl(150, { leanDeg: -a })),
  wrist_flex: driver((a) => sideWrist(a)),
  extensor_stretch: driver((a) => sideWrist(a)),
  flexor_stretch: driver((a) => sideWrist(a)),
  prayer_stretch: driver((a) => frontWrists(a)),
  nerve_glide: driver((a) => press(a)),
  seated_knee_ext: driver((a, alt) => seatedLegs({ knee: alt ? [90, a] : [a, 90] }), true),
  heel_slide: driver((a, alt) => seatedLegs({ knee: alt ? [90, a] : [a, 90] }), true),
  sit_to_stand: driver((a) => squat(a)),
  mini_squat: driver((a) => squat(a)),
  hamstring_curl: driver((a, alt) => standingLegs({ knee: alt ? [175, a] : [a, 175] }), true),
  palming: driver((a) => upper({ leftElev: a, rightElev: a })),
  temple_massage: driver((a) => upper({ leftElev: a, rightElev: a })),
  look_far: driver((a, alt) => upper({ turn: alt ? -a : a }), true),
  near_far_focus: driver((a) => sideArm(80, a)),
  eye_track_vertical: driver((a) => sideArm(a)),
  // Added since the Python server (their fixtures were first recorded by this script).
  levator_stretch: driver((a, alt) => upper({ turn: alt ? -a : a, chinDrop: a }), true),
  shoulder_blade_squeeze: driver((a) => sideElbow(a)),
  trunk_rotation: driver((a, alt) => seatedTwist(alt ? -a : a), true),
  // The ankles go out with the arms (from 15 degrees, 1 px per degree), so the legs' assist is met.
  seated_jacks: driver((a) => jack(a, Math.max(0, a - 15)), false, { still: (a) => jack(a, 0), hide: [27, 28] }),
  seated_hip_hinge: driver((a) => curl(150, { leanDeg: a })),
  palm_flip: driver((a) => palms(a)),
  // The arms swing as the knee lifts (half a degree per degree off level), so the arms' assist is met.
  seated_march: driver((a, alt) => seatedMarch(alt ? [90, a] : [a, 90], Math.max(0, 90 - a) * 2), true, {
    still: (a, alt) => seatedMarch(alt ? [90, a] : [a, 90], 0),
    hide: [13, 14],
  }),
  eye_track_horizontal: driver((a, alt) => upper(alt ? { leftElev: -40, rightElev: a - 90 } : { leftElev: a - 90, rightElev: -40 }), true),
  // Workout set (not offered in the catalog, but Session accepts it).
  squat: driver((a) => squat(a)),
  pushup: driver((a) => pushup(a)),
  curl: driver((a) => curl(a)),
  press: driver((a) => press(a)),
};

/** Angle levels for one exercise: relaxed (inside rest), deep (past target), and in between. */
function levels(key) {
  const ex = EXERCISES[key];
  const step = ex.target > ex.rest ? 1 : -1;
  const margin = Math.max(4.0, 0.3 * Math.abs(ex.target - ex.rest));
  const relaxed = ex.rest - step * margin;
  return {
    relaxed,
    deep: ex.target + step * margin,
    partial: relaxed + (ex.target - relaxed) * 0.72, // an attempted rep that falls short
    shallow: relaxed + (ex.target - relaxed) * 0.8, // this user's comfortable range, for calibration
    wobble: relaxed + (ex.target - relaxed) * 0.38, // too small to be an attempted rep
  };
}

// --- frame helpers -----------------------------------------------------------------

const dim = (lms, factor) => lms.map(([x, y, v]) => [x, y, v * factor]);

/** Left joints from one pose, right joints from another, with per-side visibility. */
function mixSides(leftLms, rightLms, visLeft, visRight) {
  const lms = [...leftLms];
  for (const idx of Object.values(JOINTS.right)) lms[idx] = rightLms[idx];
  for (const [side, vis] of [["left", visLeft], ["right", visRight]]) {
    for (const idx of Object.values(JOINTS[side])) {
      const [x, y] = lms[idx];
      lms[idx] = [x, y, vis];
    }
  }
  return lms;
}

/**
 * Front-camera exercises: world = image coordinates around the hips plus a fixed depth per
 * landmark, with y pointing *up*; alignWorldY must flip it back, as on the phone.
 */
function frontWorld(lms) {
  const raw = lms.map(([x, y], i) => [(x - 0.5) * 1.2, -(y - 0.6) * 1.2, 0.08 * Math.sin(1.7 * i)]);
  return [lms, alignWorldY(lms, raw)];
}

/** Side-camera exercises are filmed from the front (2D angles flatten, 3D ones don't). */
const worldFn = (key) => (EXERCISES[key].camera === "side" ? turnToCamera : frontWorld);

function emit(rec, lms, dt, toWorld = null) {
  if (toWorld === null || lms === null) {
    rec.frame(lms, null, dt);
  } else {
    const [img, world] = toWorld(lms);
    rec.frame(img, world, dt);
  }
}

/**
 * `n` reps a -> b -> a (cosine timing); frames whose index is in `lost` have nobody in view. A held
 * stretch stays at b for its hold and a bit (`holdTop` seconds; 0 to let go at once).
 */
function reps(rec, key, a, b, { n = 1, seconds = 2.0, fps = FPS, toWorld = null, alternate = null, lost = [], holdTop = null } = {}) {
  const d = DRIVERS[key];
  alternate = alternate === null ? d.alternates : alternate;
  const top = holdTop ?? (EXERCISES[key].hold ? EXERCISES[key].hold + 0.3 : 0);
  for (let k = 0; k < n; k++) {
    const alt = alternate && k % 2 === 1;
    const frames = pyRound(seconds * fps);
    const path = trajectory(a, b, frames);
    const mid = Math.floor(frames / 2); // the cosine path peaks halfway
    if (top > 0) path.splice(mid + 1, 0, ...Array(pyRound(top * fps)).fill(path[mid]));
    path.forEach((v, i) => {
      emit(rec, lost.includes(i) ? null : d.build(v, alt), 1 / fps, toWorld);
    });
  }
}

function hold(rec, key, a, n, { toWorld = null, fps = FPS } = {}) {
  for (let i = 0; i < n; i++) emit(rec, DRIVERS[key].build(a, false), 1 / fps, toWorld);
}

// --- scenarios ---------------------------------------------------------------------

/** The exercise after `key`, for scenarioMain's switch; the Python-era keys keep Python's ring. */
function nextExercise(key) {
  const ring = PYTHON_KEYS.includes(key) ? PYTHON_KEYS : ORDER;
  return ring[(ring.indexOf(key) + 1) % ring.length];
}

/**
 * Controlled, partial, rushed and medium-tempo reps, a wobble, fidgeting, a lost person, low
 * visibility, reset, and a switch to another exercise and back.
 */
function scenarioMain(key, rng) {
  const lv = levels(key);
  const { relaxed: rel, deep } = lv;
  const rec = new Recorder("main", key);
  hold(rec, key, rel, 2);
  reps(rec, key, rel, deep, { n: 3 }); // controlled: 2 s each
  reps(rec, key, rel, lv.partial); // partial: never reaches the target
  reps(rec, key, rel, deep, { seconds: 0.4, fps: 40, holdTop: 0 }); // rushed: under 0.5 s (a held stretch let go)
  hold(rec, key, rel, 2);
  reps(rec, key, rel, deep, { seconds: 0.8, fps: 20 }); // medium tempo: 0.5..1 s
  reps(rec, key, rel, lv.wobble, { seconds: 1.0 }); // small wobble, not an attempted rep
  const span = Math.abs(EXERCISES[key].target - EXERCISES[key].rest);
  for (let i = 0; i < 8; i++) {
    // fidgeting at rest
    emit(rec, DRIVERS[key].build(rel + rng.uniform(-0.1, 0.1) * span, false), 1 / FPS);
  }
  reps(rec, key, rel, deep, { lost: [8, 9, 10] }); // nobody in view mid-rep
  for (let i = 0; i < 4; i++) {
    // everyone fades: low visibility
    emit(rec, dim(DRIVERS[key].build(rel, false), 0.35), 1 / FPS);
  }
  hold(rec, key, rel, 2);
  rec.reset();
  hold(rec, key, rel, 1);
  reps(rec, key, rel, deep);
  rec.setExercise(nextExercise(key)); // same motion, another exercise's angle
  reps(rec, key, rel, deep, { seconds: 1.0 });
  rec.setExercise(key);
  hold(rec, key, rel, 1);
  reps(rec, key, rel, deep, { seconds: 1.2 });
  return rec;
}

/**
 * An exercise with an assist: reps with the second movement kept still (they count, but score lower
 * with its issue), then the same with it out of view (never held against you).
 */
function scenarioAssist(key) {
  const { relaxed: rel, deep } = levels(key);
  const d = DRIVERS[key];
  const rec = new Recorder("assist", key);
  const hidden = (lms) => lms.map((p, i) => (d.hide.includes(i) ? [p[0], p[1], 0.1] : p));
  hold(rec, key, rel, 2);
  for (const build of [d.still, (v, alt) => hidden(d.still(v, alt))]) {
    for (let k = 0; k < 2; k++) {
      for (const v of trajectory(rel, deep, pyRound(2.0 * FPS))) emit(rec, build(v, d.alternates && k % 2 === 1), 1 / FPS);
    }
  }
  return rec;
}

/** World landmarks in 2D mode (angle_alt = 3D), switch to 3D, frames without world, back to 2D. */
function scenarioWorld(key) {
  const { relaxed: rel, deep } = levels(key);
  const toWorld = worldFn(key);
  const rec = new Recorder("world", key);
  hold(rec, key, rel, 2, { toWorld });
  reps(rec, key, rel, deep, { n: 2, toWorld });
  rec.angleMode(true);
  hold(rec, key, rel, 2, { toWorld });
  reps(rec, key, rel, deep, { n: 2, toWorld });
  reps(rec, key, rel, deep, { n: 1 }); // 3D mode, but no world landmarks: falls back to 2D
  reps(rec, key, rel, deep, { n: 1, toWorld, lost: [8, 9] });
  rec.angleMode(false);
  hold(rec, key, rel, 2, { toWorld });
  reps(rec, key, rel, deep, { n: 1, toWorld });
  return rec;
}

/** A session created in 3D mode. */
function scenarioWorldCtor(key) {
  const lv = levels(key);
  const toWorld = worldFn(key);
  const rec = new Recorder("world_ctor", key, { useWorld: true });
  hold(rec, key, lv.relaxed, 2, { toWorld });
  reps(rec, key, lv.relaxed, lv.deep, { n: 2, toWorld });
  reps(rec, key, lv.relaxed, lv.partial, { n: 1, toWorld });
  return rec;
}

/**
 * Calibrate on a shallow range that the defaults can't count, count with it, reset (keeps it),
 * recalibrate and cancel, config-message thresholds (valid and invalid), angle-mode switch.
 */
function scenarioCalibration(key) {
  const ex = EXERCISES[key];
  const { relaxed: rel, deep, shallow } = levels(key);
  const rec = new Recorder("calibration", key);
  hold(rec, key, rel, 3);
  reps(rec, key, rel, shallow); // default thresholds: only a partial rep
  rec.calibrate("start");
  hold(rec, key, rel, 2);
  reps(rec, key, rel, shallow);
  reps(rec, key, rel, shallow, { lost: [5, 6] }); // still recording while nobody is in view
  reps(rec, key, rel, shallow); // third rep: calibration done
  hold(rec, key, rel, 2);
  reps(rec, key, rel, shallow, { n: 2 }); // now these count
  rec.reset(); // keeps the calibrated thresholds
  hold(rec, key, rel, 2);
  reps(rec, key, rel, shallow);
  rec.calibrate("start");
  reps(rec, key, rel, shallow);
  rec.calibrate("cancel"); // back to the defaults (startCalibration dropped the thresholds)
  reps(rec, key, rel, deep);
  // Thresholds sent by a client in a config message, validated as the server did.
  const good = validateCalibration(ex, rel + (shallow - rel) * 0.25 + 0.05, rel + (shallow - rel) * 0.75 + 0.05);
  if (good === null) throw new Error(`${key}: the calibrated thresholds don't validate`);
  rec.setExercise(key, good);
  hold(rec, key, rel, 2);
  reps(rec, key, rel, shallow);
  const bad = validateCalibration(ex, ex.target, ex.rest); // wrong direction: rejected, defaults apply
  if (bad !== null) throw new Error(`${key}: reversed thresholds validate`);
  rec.setExercise(key, bad);
  reps(rec, key, rel, shallow);
  rec.setExercise(key, good);
  rec.angleMode(false); // thresholds are per mode: dropped
  reps(rec, key, rel, deep);
  return rec;
}

/** Reps too small to give thresholds at least 3 degrees apart: calibration reports failure. */
function scenarioCalibrationFails(key) {
  const ex = EXERCISES[key];
  const step = ex.target > ex.rest ? 1 : -1;
  const rel = levels(key).relaxed;
  const rec = new Recorder("calibration_fails", key);
  hold(rec, key, rel, 2);
  rec.calibrate("start");
  reps(rec, key, rel, rel + step * 5.5, { n: 3, alternate: false });
  hold(rec, key, rel, 3);
  reps(rec, key, rel, levels(key).deep); // counting resumes with the defaults
  return rec;
}

/** Per-side visibility changes: the measured side only switches past SIDE_SWITCH_MARGIN. */
function scenarioSideSwitch(key) {
  const { relaxed: rel, deep } = levels(key);
  const d = DRIVERS[key];
  const rec = new Recorder("side_switch", key);
  const segments = [[0.95, 0.9], [0.9, 0.95], [0.7, 0.95], [0.95, 0.85], [0.95, 0.75], [0.45, 0.4], [0.3, 0.9], [0.95, 0.95]];
  const values = [...trajectory(rel, deep, 24), ...trajectory(rel, deep, 24)];
  const offset = 0.15 * (deep - rel); // the right side is a little further into the rep
  values.forEach((v, i) => {
    const [vl, vr] = segments[Math.min(Math.floor(i / 6), segments.length - 1)];
    rec.frame(mixSides(d.build(v, false), d.build(v + offset, false), vl, vr), null, 1 / FPS);
  });
  return rec;
}

/** Non-square frames: angles are measured in pixels, so the aspect ratio matters. */
function scenarioFrameSize(key, width, height) {
  const lv = levels(key);
  const rec = new Recorder(`frame_${width}x${height}`, key, { width, height });
  hold(rec, key, lv.relaxed, 2);
  reps(rec, key, lv.relaxed, lv.deep, { n: 2 });
  reps(rec, key, lv.relaxed, lv.partial);
  return rec;
}

/** Hovering around the rest threshold with landmark noise must not count extra reps. */
function scenarioJitter(key, rng) {
  const ex = EXERCISES[key];
  const lv = levels(key);
  const rec = new Recorder("jitter", key);
  reps(rec, key, lv.relaxed, lv.deep, { n: 2 });
  for (let i = 0; i < 40; i++) emit(rec, DRIVERS[key].build(ex.rest + rng.uniform(-4, 4), false), 1 / FPS);
  return rec;
}

/** Workout set: form faults, invalid start positions, and how they add up in the summary. */
function scenarioForm(key) {
  const rec = new Recorder("form", key);
  const run = (build, a, b, n = 1, s = 2.0) => {
    for (let k = 0; k < n; k++) {
      for (const v of trajectory(a, b, pyRound(s * FPS))) rec.frame(build(v), null, 1 / FPS);
    }
  };
  if (key === "squat") {
    run((v) => squat(v), 172, 80);
    run((v) => squat(v, { leanDeg: 60 }), 172, 80, 2);
    run((v) => squat(v, { kneeShift: 200 }), 172, 80);
    run((v) => squat(v, { leanDeg: 60, kneeShift: 200 }), 172, 125); // partial with faults
    run((v) => squat(v), 172, 80, 1, 0.5);
  } else if (key === "pushup") {
    run((v) => pushup(v), 170, 80);
    run((v) => pushup(v, { hipOffset: 80 }), 170, 80, 2);
    run((v) => pushup(v, { hipOffset: -120 }), 170, 80);
    run((v) => pushup(v, { vertical: true }), 170, 80); // not in a plank: never counted
    run((v) => pushup(v), 170, 80);
  } else if (key === "curl") {
    run((v) => curl(v), 165, 40);
    run((v) => curl(v, { driftDeg: 50 }), 165, 40, 2);
    run((v) => curl(v, { leanDeg: 22 }), 165, 40);
    run((v) => curl(v, { leanDeg: 40 }), 165, 40); // bent over: invalid
    run((v) => curl(v, { driftDeg: 50, leanDeg: 22 }), 165, 90);
  } else if (key === "press") {
    run((v) => press(v), 90, 172);
    run((v) => press(v, { rightOffset: 90 }), 90, 172, 2);
    run((v) => press(v, { armsDown: true }), 90, 172); // arms hanging: invalid
    run((v) => press(v), 90, 172, 1, 0.6);
  }
  return rec;
}

/** Calibration ignores frames whose measurement is invalid (workout set). */
function scenarioFormCalibration(key) {
  const rec = new Recorder("form_calibration", key);
  const bad = {
    press: (v) => press(v, { armsDown: true }),
    pushup: (v) => pushup(v, { vertical: true }),
    curl: (v) => curl(v, { leanDeg: 40 }),
    squat: (v) => squat(v, { leanDeg: 60 }),
  }[key];
  const { relaxed: rel, shallow } = levels(key);
  rec.calibrate("start");
  for (let k = 0; k < 4; k++) {
    for (const v of trajectory(rel, shallow, 24)) {
      rec.frame(k === 1 ? bad(v) : DRIVERS[key].build(v, false), null, 1 / FPS);
    }
  }
  reps(rec, key, rel, shallow, { n: 2 });
  return rec;
}

// One or two exercises per angle helper is enough for the 3D paths.
const WORLD_KEYS = ["sit_to_stand", "seated_row", "hip_hinge", "chin_tuck", "front_raise", "wrist_flex", "knee_to_chest",
  "neck_tilt", "seated_side_bend", "overhead_reach", "head_turn", "squat", "press", "trunk_rotation",
  "shoulder_blade_squeeze", "palm_flip"];
const WORLD_CTOR_KEYS = ["sit_to_stand", "neck_tilt", "squat"];
const CALIBRATION_KEYS = ["sit_to_stand", "overhead_reach", "neck_tilt", "chin_tuck", "cross_body_stretch",
  "seated_knee_ext", "seated_row", "squat", "press", "shoulder_blade_squeeze"];
const CALIBRATION_FAIL_KEYS = ["neck_tilt", "chin_tuck", "seated_side_bend"];
const SIDE_SWITCH_KEYS = ["seated_row", "sit_to_stand", "chin_tuck", "knee_to_chest", "neck_tilt", "front_raise", "seated_march"];
const FRAME_SIZE_KEYS = {
  neck_tilt: [1280, 720], overhead_reach: [720, 1280], sit_to_stand: [720, 1280], seated_row: [1280, 720],
  head_turn: [720, 1280], chin_to_chest: [1280, 720], squat: [640, 480],
};
const JITTER_KEYS = ["squat", "sit_to_stand", "neck_tilt"];
const WORKOUT = ["squat", "pushup", "curl", "press"];

/** @returns {Map<string, Recorder[]>} */
function sessionFixtures() {
  const missing = ORDER.filter((k) => !Object.hasOwn(DRIVERS, k));
  if (missing.length) throw new Error(`no driver for ${missing.join(", ")}: add one to DRIVERS`);
  const rng = new PyRandom(7);
  const out = new Map();
  for (const key of ORDER) {
    const recs = [scenarioMain(key, rng)];
    if (WORLD_KEYS.includes(key)) recs.push(scenarioWorld(key));
    if (WORLD_CTOR_KEYS.includes(key)) recs.push(scenarioWorldCtor(key));
    if (CALIBRATION_KEYS.includes(key)) recs.push(scenarioCalibration(key));
    if (CALIBRATION_FAIL_KEYS.includes(key)) recs.push(scenarioCalibrationFails(key));
    if (SIDE_SWITCH_KEYS.includes(key)) recs.push(scenarioSideSwitch(key));
    if (Object.hasOwn(FRAME_SIZE_KEYS, key)) recs.push(scenarioFrameSize(key, ...FRAME_SIZE_KEYS[key]));
    if (JITTER_KEYS.includes(key)) recs.push(scenarioJitter(key, rng));
    if (EXERCISES[key].assist) recs.push(scenarioAssist(key));
    if (WORKOUT.includes(key)) {
      recs.push(scenarioForm(key));
      recs.push(scenarioFormCalibration(key));
    }
    out.set(key, recs);
  }
  return out;
}

// --- non-session fixtures ------------------------------------------------------------

function catalogFixture() {
  return plain({
    catalog: exerciseCatalog(),
    connections: CONNECTIONS,
    issue_text: ISSUE_TEXT,
    default_exercise: DEFAULT_EXERCISE,
    areas: [...AREAS],
    catalog_keys: Object.keys(CATALOG),
    joints: JOINTS,
    exercises: Object.values(EXERCISES).map((e) => ({
      key: e.key, label: e.label, metric: e.metric, rest: e.rest, target: e.target, rest_is_high: e.restIsHigh,
      bilateral: e.bilateral, joints: [...e.joints], camera: e.camera, min_rep_seconds: e.minRepSeconds,
      category: e.category, how_to: e.howTo, stance: e.stance, kind: e.constructor.name,
      hold: e.hold, reps: e.reps, assist: e.assist && { range: e.assist.range, issue: e.assist.issue },
    })),
  });
}

/** Every exercise's measurement on random poses, both sides, 2D and 3D. */
function measureFixture() {
  const rng = new PyRandom(99);
  const poses = [];
  for (let p = 0; p < 14; p++) {
    const lms = Array.from({ length: 33 }, () => [
      r5(rng.uniform(0.05, 0.95)), r5(rng.uniform(0.05, 0.95)), r5(rng.uniform(0.3, 1.0)),
    ]);
    const world = Array.from({ length: 33 }, () => [
      r5(rng.uniform(-0.6, 0.6)), r5(rng.uniform(-0.8, 0.8)), r5(rng.uniform(-0.4, 0.4)),
    ]);
    poses.push([lms, world]);
  }
  // Synthetic poses that hit the workout form rules.
  for (const lms of [
    squat(100, { leanDeg: 60, kneeShift: 200 }), squat(120), pushup(90, { hipOffset: 80 }),
    pushup(90, { hipOffset: -120 }), pushup(90, { vertical: true }), curl(60, { driftDeg: 50, leanDeg: 22 }),
    curl(60, { leanDeg: 40 }), press(140, { rightOffset: 90 }), press(140, { armsDown: true }),
  ]) {
    const [img, world] = turnToCamera(lms);
    poses.push([roundPoints(lms), roundPoints(world)]);
    poses.push([roundPoints(img), roundPoints(world)]);
  }
  const sizes = [[1000, 1000], [1280, 720], [720, 1280]];
  // results[pose][exercise] = [value, issues, valid] for (left 2D, left 3D, right 2D, right 3D);
  // values rounded to 10 decimals to save space (the test compares within 1e-6).
  const results = poses.map(([lms, world], p) => {
    const [w, h] = sizes[p % sizes.length];
    const perEx = {};
    for (const [key, ex] of Object.entries(EXERCISES)) {
      perEx[key] = [];
      for (const side of ["left", "right"]) {
        for (const useWorld of [false, true]) {
          const m = ex.measure(new Pose(lms, w, h, world, useWorld), side);
          perEx[key].push([pythonRound(m.value, 10), [...m.issues], m.valid]);
        }
      }
    }
    return perEx;
  });
  return plain({
    poses: poses.map(([lms, world], i) => ({
      landmarks: lms, world, width: sizes[i % sizes.length][0], height: sizes[i % sizes.length][1],
    })),
    results,
  });
}

// --- comparing and writing -------------------------------------------------------------

/** A float literal in a fixture on disk (has a ".", "e" or "E"); bare numbers are integers. */
class FloatLiteral {
  constructor(value) {
    this.value = value;
  }
}

function parseFixture(text) {
  return JSON.parse(text, (_key, value, context) =>
    typeof value === "number" && /[.eE]/.test(context.source) ? new FloatLiteral(value) : value,
  );
}

const show = (v) => {
  const text = v instanceof FloatLiteral ? (Object.is(v.value, -0) ? "-0.0" : String(v.value)) : v === undefined ? "nothing" : dumps(v);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
};
const MAX_DIFFS = 1000;

/**
 * Semantic differences between a generated value and the fixture on disk: integers exactly,
 * floats within FLOAT_TOLERANCE (and the same sign when zero), objects in any key order.
 */
function compare(actual, expected, where = "$", diffs = { list: [], count: 0 }) {
  const differ = (what, at = where) => {
    diffs.count += 1;
    if (diffs.list.length < MAX_DIFFS) diffs.list.push(`${at}: ${what}`);
  };
  if (expected instanceof FloatLiteral) {
    const e = expected.value;
    const ok = typeof actual === "number" && Math.abs(actual - e) <= FLOAT_TOLERANCE && (actual !== 0 || e !== 0 || Object.is(actual, e));
    if (!ok) differ(`${show(actual)}, was ${show(expected)}`);
  } else if (typeof expected === "number") {
    if (!Object.is(actual, expected)) differ(`${show(actual)}, was ${show(expected)}`);
  } else if (expected === null || typeof expected !== "object") {
    if (actual !== expected) differ(`${show(actual)}, was ${show(expected)}`);
  } else if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) differ(`${show(actual)}, was a list`);
    else if (actual.length !== expected.length) differ(`${actual.length} items, was ${expected.length}`);
    else expected.forEach((e, i) => compare(actual[i], e, `${where}[${i}]`, diffs));
  } else if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
    differ(`${show(actual)}, was an object`);
  } else {
    for (const k of Object.keys(expected)) {
      if (Object.hasOwn(actual, k)) compare(actual[k], expected[k], `${where}.${k}`, diffs);
      else differ("removed", `${where}.${k}`);
    }
    for (const k of Object.keys(actual)) if (!Object.hasOwn(expected, k)) differ("added", `${where}.${k}`);
  }
  return diffs;
}

/** Compact JSON like Python's json.dumps(separators=(",", ":"), ensure_ascii=False); -0 is written -0.0. */
function dumps(v) {
  if (v === null) return "null";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`not JSON: ${v}`);
    return Object.is(v, -0) ? "-0.0" : String(v);
  }
  if (typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(dumps).join(",")}]`;
  return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}:${dumps(x)}`).join(",")}}`;
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const unknown = args.filter((a) => a !== "--check");
  if (unknown.length) {
    console.error(`unknown argument ${unknown[0]}\nusage: node mobile/scripts/gen-pose-fixtures.mjs [--check]`);
    process.exit(2);
  }

  /** @type {Map<string, unknown>} */
  const files = new Map();
  const coverage = [];
  let frames = 0;
  for (const [key, recs] of sessionFixtures()) {
    files.set(`session_${key}.json`, plain({ exercise: key, scenarios: recs }));
    const n = recs.reduce((s, r) => s + r.frames, 0);
    frames += n;
    const events = recs.flatMap((r) => r.events);
    coverage.push(
      `  ${key.padEnd(20)} ${recs.map((r) => r.name).join(", ")}  ` +
        `[${n} frames, ${events.filter((e) => !e.partial).length} reps, ${events.filter((e) => e.partial).length} partial]`,
    );
  }
  files.set("catalog.json", catalogFixture());
  files.set("measure.json", measureFixture());

  const rel = (name) => path.relative(REPO, path.join(OUT, name));
  const changes = []; // [verb, name, detail]
  let bytes = 0;
  for (const [name, obj] of files) {
    const text = `${dumps(obj)}\n`;
    bytes += Buffer.byteLength(text);
    const file = path.join(OUT, name);
    if (!existsSync(file)) {
      changes.push(["add", name, ""]);
      if (!check) writeFileSync(file, text, "utf8");
      continue;
    }
    // Round-trip what we'd write, so the comparison sees exactly what a reader would get.
    const diffs = compare(JSON.parse(text), parseFixture(readFileSync(file, "utf8")));
    if (diffs.count === 0) continue;
    const shown = diffs.list.slice(0, 3).join("; ");
    changes.push(["change", name, `${diffs.count} difference${diffs.count > 1 ? "s" : ""}: ${shown}${diffs.count > 3 ? "; ..." : ""}`]);
    if (!check) writeFileSync(file, text, "utf8");
  }
  // Session fixtures for exercises that no longer exist (Python's script wiped the folder first).
  for (const name of readdirSync(OUT).filter((f) => f.startsWith("session_") && f.endsWith(".json")).sort()) {
    if (files.has(name)) continue;
    changes.push(["remove", name, ""]);
    if (!check) unlinkSync(path.join(OUT, name));
  }

  if (check) {
    if (changes.length === 0) {
      console.log(`${files.size} pose fixtures are up to date in ${path.relative(REPO, OUT)}`);
      return;
    }
    console.log(`${changes.length} pose fixture${changes.length > 1 ? "s" : ""} would change:`);
    for (const [verb, name, detail] of changes) console.log(`  ${`would ${verb}`.padEnd(14)} ${rel(name)}${detail ? `  (${detail})` : ""}`);
    console.log("Run node mobile/scripts/gen-pose-fixtures.mjs to update them.");
    process.exitCode = 1;
    return;
  }
  console.log(coverage.join("\n"));
  const done = { add: "added", change: "changed", remove: "removed" };
  for (const [verb, name] of changes) console.log(`${done[verb].padEnd(8)} ${rel(name)}`);
  console.log(
    `${frames} session frames, ${(bytes / 1e6).toFixed(2)} MB of generated fixtures in ${path.relative(REPO, OUT)}` +
      ` (${changes.length} file${changes.length === 1 ? "" : "s"} written or removed, numeric.json and align_world_y.json left as Python recorded them)`,
  );
}

main();
