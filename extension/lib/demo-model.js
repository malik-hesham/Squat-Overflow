// ---------------------------------------------------------------------------
// 3D exercise demos
// ---------------------------------------------------------------------------
// A jointed 3D figure shows each exercise in the break window and on the
// Practice page. It is made here, on the device, so a demo needs no network
// and sends nothing anywhere. How the person looks (clothes, hair, skin,
// thickness) is lib/demo-look.js.
//
// Each move is a rest pose and a target pose (joint angles), eased from one to
// the other and back in a loop; a move done one side at a time does the other
// side in the second half of the loop, mirrored. `demoPose` gives the 33
// MediaPipe joints in meters, so a demo can be checked with the same rep
// counter that coaches the user (tests/check.mjs does, for every move).
//
// No DOM here: extension pages and the phone app draw the shapes this module
// returns (lib/demo-player.js on a canvas, mobile's DemoModel with SVG).
import { EXERCISES } from "./pose/exercises.js";
import { JOINTS } from "./pose/geometry.js";
import { DEMO_LOOK } from "./demo-look.js";

/** @typedef {import("./demo-look.js").DemoLook} DemoLook */

/** A point in meters: x to the person's left, y up from the floor, z forward. @typedef {[number, number, number]} P3 */
/** Raise from straight down (deg) and direction (deg: 0 out to the side, 90 forward, 180 across, -90 back). @typedef {[number, number]} Aim */

/**
 * Joint angles of the mannequin. Arms use `_up/_fore/_hand` aims in the torso's frame, or `_to` (a
 * wrist position in the torso's frame, from the middle of the shoulders) with `_pole` (where the
 * elbow points) for a hand that reaches a spot. Legs are pitches from straight down, + forward.
 * @typedef {object} Params
 * @property {number} lean torso pitch, deg, + forward
 * @property {number} bend torso side bend, deg, + towards the person's left
 * @property {number} shrug shoulders up, m
 * @property {number} back shoulders back, m
 * @property {number} headFwd head glides forward, m
 * @property {number} yaw head turn, deg, + towards the person's left
 * @property {number} nod head pitch, deg, + chin down
 * @property {number} tilt head side tilt, deg, + left ear down
 * @property {Aim} L_up @property {Aim} L_fore @property {Aim} L_hand
 * @property {Aim} R_up @property {Aim} R_fore @property {Aim} R_hand
 * @property {P3 | null} L_to @property {P3} L_pole @property {P3 | null} R_to @property {P3} R_pole
 * @property {number} L_thigh @property {number} L_shin @property {number} R_thigh @property {number} R_shin
 * @property {number} L_foot @property {number} R_foot foot pitch, 90 = flat and pointing forward
 */

const DEG = Math.PI / 180;
// Body sizes in meters, a person about 1.75 m tall.
const HIP_HALF = 0.1;
const TORSO = 0.5;
const SHOULDER_HALF = 0.19;
const UPPER_ARM = 0.29;
const FOREARM = 0.26;
const HAND = 0.09;
const THIGH = 0.44;
const SHIN = 0.43;
const FOOT_DROP = 0.06; // ankle to sole
const HEEL = 0.05;
const TOE = 0.15;
const REP_SECONDS = 3.6;

// ---- Small 3D maths ---------------------------------------------------------
/** @param {P3} a @param {P3} b @param {number} [s] @returns {P3} */
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
/** @param {P3} a @param {P3} b @returns {P3} */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** @param {P3} a @param {P3} b */
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** @param {P3} a */
const len = (a) => Math.sqrt(dot(a, a));
/** @param {P3} a @param {P3} b @returns {P3} */
const midpoint = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
/** @param {P3} a @returns {P3} */
const unit = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** A 3x3 rotation, rows. @typedef {number[][]} M3 */
/** @param {number} deg @returns {M3} */
function rotX(deg) {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return [[1, 0, 0], [0, c, -s], [0, s, c]];
}
/** @param {number} deg @returns {M3} */
function rotY(deg) {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
}
/** @param {number} deg @returns {M3} */
function rotZ(deg) {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}
/** @param {M3} a @param {M3} b @returns {M3} */
function mul(a, b) {
  return a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
}
/** The inverse of a rotation. @param {M3} m @returns {M3} */
function transpose(m) {
  return [0, 1, 2].map((i) => [m[0][i], m[1][i], m[2][i]]);
}
/** @param {M3} m @param {P3} p @returns {P3} */
function apply(m, p) {
  return [dot(/** @type {P3} */ (m[0]), p), dot(/** @type {P3} */ (m[1]), p), dot(/** @type {P3} */ (m[2]), p)];
}

/** An arm aim as a direction in the torso's frame. side: +1 left, -1 right. @param {Aim} aim @param {number} side @returns {P3} */
function armDir([raise, plane], side) {
  const r = raise * DEG;
  const p = plane * DEG;
  return [Math.sin(r) * Math.cos(p) * side, -Math.cos(r), Math.sin(r) * Math.sin(p)];
}

/** A leg pitch (from straight down, + forward) as a direction. @param {number} pitch @returns {P3} */
function legDir(pitch) {
  return [0, -Math.cos(pitch * DEG), Math.sin(pitch * DEG)];
}

/**
 * Two-bone reach: where the elbow goes for the wrist to touch `target` (or get as close as it
 * can), bending towards `pole`. Bone lengths never change. Exported for the tests.
 * @param {P3} root @param {P3} target @param {P3} pole @param {number} a @param {number} b
 * @returns {[P3, P3]} elbow, wrist
 */
export function reach(root, target, pole, a, b) {
  const to = sub(target, root);
  const d = Math.min(Math.max(len(to), 1e-6), a + b - 1e-9);
  const u = unit(to);
  const along = (a * a - b * b + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a * a - along * along));
  let off = sub(pole, [u[0] * dot(pole, u), u[1] * dot(pole, u), u[2] * dot(pole, u)]);
  // A hint along the arm (or none) says nothing about which way to bend: bend forward, or sideways
  // when the arm itself points forward.
  if (len(off) < 1e-9) off = Math.abs(u[2]) < 0.9 ? sub([0, 0, 1], [u[0] * u[2], u[1] * u[2], u[2] * u[2]]) : sub([1, 0, 0], [u[0] * u[0], u[1] * u[0], u[2] * u[0]]);
  const side = unit(off);
  const elbow = add(add(root, u, along), side, h);
  return [elbow, add(root, u, d)];
}

// ---- The mannequin ------------------------------------------------------------
/** The torso's rotation: lean, then side bend, about the hips. @param {Params} p */
const torsoOf = (p) => mul(rotZ(p.bend), rotX(p.lean));
/** @type {Params} */
const STAND = {
  lean: 0,
  bend: 0,
  shrug: 0,
  back: 0,
  headFwd: 0,
  yaw: 0,
  nod: 0,
  tilt: 0,
  L_up: [6, 0],
  L_fore: [8, 20],
  L_hand: [8, 20],
  R_up: [6, 0],
  R_fore: [8, 20],
  R_hand: [8, 20],
  L_to: null,
  L_pole: [1, -1, -0.3],
  R_to: null,
  R_pole: [-1, -1, -0.3],
  L_thigh: 0,
  L_shin: 0,
  L_foot: 90,
  R_thigh: 0,
  R_shin: 0,
  R_foot: 90,
};

/** Seated: thighs level, shins down, hands resting on the thighs. @type {Params} */
const SIT = {
  ...STAND,
  L_up: [18, 90],
  L_fore: [70, 80],
  L_hand: [70, 80],
  R_up: [18, 90],
  R_fore: [70, 80],
  R_hand: [70, 80],
  L_thigh: 90,
  R_thigh: 90,
};

// Points on the head, in the head's frame (meters from the head's centre).
/** @type {[number, P3][]} */
const FACE = [
  [0, [0, -0.01, 0.11]],
  [1, [0.018, 0.025, 0.088]],
  [2, [0.035, 0.025, 0.085]],
  [3, [0.05, 0.025, 0.078]],
  [4, [-0.018, 0.025, 0.088]],
  [5, [-0.035, 0.025, 0.085]],
  [6, [-0.05, 0.025, 0.078]],
  [7, [0.078, 0, -0.01]],
  [8, [-0.078, 0, -0.01]],
  [9, [0.025, -0.045, 0.085]],
  [10, [-0.025, -0.045, 0.085]],
];

/**
 * The 33 joints for these angles, with the middle of the hips at the origin.
 * @param {Params} p
 * @returns {P3[]}
 */
function skeleton(p) {
  /** @type {P3[]} */
  const j = Array.from({ length: 33 }, () => [0, 0, 0]);
  const torso = torsoOf(p);
  /** @param {P3} v */
  const inTorso = (v) => apply(torso, v);
  const chest = inTorso([0, TORSO, 0]);

  // Head: on a short neck above the shoulders.
  const neck = add(add(chest, inTorso([0, 0.04, 0])), inTorso([0, 0, p.headFwd]));
  const headRot = mul(torso, mul(rotY(p.yaw), mul(rotX(p.nod), rotZ(-p.tilt))));
  const head = add(neck, apply(headRot, [0, 0.11, 0]));
  for (const [i, v] of FACE) j[i] = add(head, apply(headRot, v));

  for (const [side, s] of /** @type {const} */ ([["L", 1], ["R", -1]])) {
    const o = side === "L" ? 0 : 1;
    const shoulder = add(chest, inTorso([SHOULDER_HALF * s, p.shrug, -p.back]));
    let elbow;
    let wrist;
    const to = p[`${side}_to`];
    if (to) {
      [elbow, wrist] = reach(shoulder, add(chest, inTorso(to)), inTorso(p[`${side}_pole`]), UPPER_ARM, FOREARM);
    } else {
      elbow = add(shoulder, inTorso(armDir(p[`${side}_up`], s)), UPPER_ARM);
      wrist = add(elbow, inTorso(armDir(p[`${side}_fore`], s)), FOREARM);
    }
    const hand = inTorso(armDir(p[`${side}_hand`], s));
    j[11 + o] = shoulder;
    j[13 + o] = elbow;
    j[15 + o] = wrist;
    j[17 + o] = add(wrist, hand, HAND * 0.8);
    j[19 + o] = add(wrist, hand, HAND);
    j[21 + o] = add(wrist, hand, HAND * 0.6);

    const hip = /** @type {P3} */ ([HIP_HALF * s, 0, 0]);
    const knee = add(hip, legDir(p[`${side}_thigh`]), THIGH);
    const ankle = add(knee, legDir(p[`${side}_shin`]), SHIN);
    const foot = legDir(p[`${side}_foot`]);
    const sole = legDir(p[`${side}_foot`] - 90);
    j[23 + o] = hip;
    j[25 + o] = knee;
    j[27 + o] = ankle;
    j[29 + o] = add(add(ankle, sole, FOOT_DROP), foot, -HEEL);
    j[31 + o] = add(add(ankle, sole, FOOT_DROP), foot, TOE);
  }
  return j;
}

// ---- Moves ---------------------------------------------------------------------
/** @typedef {Partial<Params>} Pose */
/**
 * @typedef {object} Move
 * @property {"seated" | "standing"} [stance] defaults to the exercise's stance
 * @property {Pose} [rest]
 * @property {Pose} target
 * @property {Pose} [via] a pose halfway, on the way there and back (lift the foot, then straighten the knee)
 * @property {1 | 2} [reps] 2: one side, then the other, in each loop
 * @property {"both" | "L" | "R"} [plant] feet that stay put when standing (mirrored for the second side)
 * @property {(w: number) => P3[]} [custom] a move the angles above can't describe
 */

/** Both arms at the same aims. @param {Aim} up @param {Aim} fore @param {Aim} [hand] @returns {Pose} */
const arms = (up, fore, hand = fore) => ({ L_up: up, L_fore: fore, L_hand: hand, R_up: up, R_fore: fore, R_hand: hand });
/** The left arm only. @param {Aim} up @param {Aim} fore @param {Aim} [hand] @returns {Pose} */
const leftArm = (up, fore, hand = fore) => ({ L_up: up, L_fore: fore, L_hand: hand });
/** Both hands reaching mirrored spots (given for the left hand). @param {P3} to @param {P3} pole @param {Aim} [hand] @returns {Pose} */
const reachBoth = (to, pole, hand = [170, 0]) => ({
  L_to: to,
  L_pole: pole,
  R_to: [-to[0], to[1], to[2]],
  R_pole: [-pole[0], pole[1], pole[2]],
  L_hand: hand,
  R_hand: hand,
});
const HANGING = arms([8, 20], [8, 20]);

/** @type {Record<string, Move>} */
const MOVES = {
  squat: { target: { L_thigh: 62, L_shin: -28, R_thigh: 62, R_shin: -28, lean: 35, ...arms([80, 90], [80, 90]) } },
  pushup: { target: {}, custom: pushUp },
  curl: { rest: leftArm([2, 90], [4, 90]), target: leftArm([2, 90], [140, 90], [150, 90]) },
  press: { rest: arms([90, 0], [175, 0]), target: arms([168, 0], [178, 0]) },
  // Neck tension
  neck_tilt: { reps: 2, target: { tilt: 30 } },
  head_turn: { reps: 2, target: { yaw: 55 } },
  chin_to_chest: { target: { nod: 45 } },
  shoulder_shrug: { target: { shrug: 0.07 } },
  chin_tuck: { rest: { headFwd: 0.05 }, target: { headFwd: -0.01 } },
  // Rounded shoulders
  cross_swing: { rest: arms([90, -10], [90, -10]), target: arms([90, 135], [90, 140]) },
  wy_raise: { rest: arms([50, -5], [160, 0]), target: arms([150, -5], [155, 0]) },
  shoulder_roll: { target: { shrug: 0.07, back: 0.04 } },
  thoracic_extension: {
    rest: reachBoth([0.08, 0.22, -0.06], [1, 0.3, 0.2]),
    target: { lean: -24, ...reachBoth([0.08, 0.22, -0.06], [1, 0.3, 0.2]) },
  },
  clasp_opener: {
    rest: { ...arms([12, -90], [12, -120]), back: 0.02 },
    target: { ...arms([40, -90], [40, -110]), back: 0.04 },
  },
  // Upper back
  seated_row: { rest: arms([85, 90], [85, 90]), target: arms([30, -80], [90, 90]) },
  t_raise: { rest: arms([12, 0], [12, 0]), target: arms([92, 0], [92, 0]) },
  desk_punch: { rest: arms([20, -70], [95, 90]), target: arms([88, 90], [88, 90]) },
  rhomboid_stretch: { rest: arms([80, 100], [80, 110]), target: { lean: 26, ...arms([95, 100], [95, 110]) } },
  desk_row: {
    rest: { lean: 45, ...leftArm([45, 90], [45, 90]), R_up: [80, 90], R_fore: [80, 90], R_hand: [80, 90] },
    target: { lean: 45, ...leftArm([10, -90], [80, 90]), R_up: [80, 90], R_fore: [80, 90], R_hand: [80, 90] },
  },
  // Shoulder & rotator cuff
  scaption: { rest: arms([12, 30], [12, 30]), target: arms([92, 30], [92, 30]) },
  front_raise: { rest: HANGING, target: { ...HANGING, ...leftArm([92, 90], [92, 90]) } },
  overhead_reach: { rest: HANGING, target: arms([170, 0], [172, 0]) },
  external_rotation: { rest: arms([5, 0], [90, 90]), target: arms([5, 0], [90, 10]) },
  cross_body_stretch: { reps: 2, target: { ...leftArm([90, 165], [90, 170]), R_up: [30, 90], R_fore: [95, 150], R_hand: [95, 150] } },
  // Lower back
  seated_side_bend: { reps: 2, target: { bend: 22 } },
  knee_to_chest: { reps: 2, target: { L_thigh: 135, L_shin: 10, L_foot: 105, ...arms([40, 90], [80, 100]) } },
  hip_hinge: {
    rest: reachBoth([0.17, -0.45, 0], [1, 0, -0.6], [0, 0]),
    target: { lean: 55, L_thigh: 10, L_shin: -8, R_thigh: 10, R_shin: -8, ...reachBoth([0.17, -0.45, 0], [1, 0, -0.6], [0, 0]) },
  },
  standing_side_bend: { reps: 2, target: { bend: 20 } },
  back_extension: {
    rest: reachBoth([0.12, -0.42, -0.12], [1, 0.2, -1], [0, -90]),
    target: { lean: -20, ...reachBoth([0.12, -0.42, -0.12], [1, 0.2, -1], [0, -90]) },
  },
  // Wrist & hand
  wrist_flex: { rest: leftArm([88, 90], [88, 90]), target: leftArm([88, 90], [88, 90], [30, 90]) },
  extensor_stretch: {
    rest: leftArm([88, 90], [88, 90]),
    target: { ...leftArm([88, 90], [88, 90], [25, 90]), R_up: [70, 120], R_fore: [80, 150], R_hand: [80, 150] },
  },
  flexor_stretch: {
    rest: leftArm([88, 90], [88, 90]),
    target: { ...leftArm([88, 90], [88, 90], [150, 90]), R_up: [70, 120], R_fore: [80, 150], R_hand: [80, 150] },
  },
  prayer_stretch: {
    rest: reachBoth([0.015, 0, 0.3], [0.05, -1, 0.1], [180, 0]),
    target: reachBoth([0.015, -0.3, 0.2], [1, 0.6, 0], [180, 0]),
  },
  nerve_glide: { rest: arms([30, 0], [170, 0]), target: arms([85, 0], [80, 0], [70, 0]) },
  // Knees
  seated_knee_ext: { reps: 2, via: { L_thigh: 105, L_foot: 100 }, target: { L_thigh: 105, L_shin: 80, L_foot: 155 } },
  heel_slide: { reps: 2, target: { L_thigh: 82, L_shin: -38 } },
  sit_to_stand: {
    rest: reachBoth([-0.1, -0.15, 0.12], [1, -0.5, 0.2], [90, 180]),
    target: { L_thigh: 85, L_shin: -5, R_thigh: 85, R_shin: -5, lean: 30, ...reachBoth([-0.1, -0.15, 0.12], [1, -0.5, 0.2], [90, 180]) },
  },
  mini_squat: { target: { L_thigh: 35, L_shin: -20, R_thigh: 35, R_shin: -20, lean: 15 } },
  hamstring_curl: { reps: 2, plant: "R", via: { L_thigh: 25, L_shin: -25 }, target: { L_shin: -95, L_foot: 10 } },
  // Eyes
  palming: { target: reachBoth([0.045, 0.2, 0.17], [1, -0.6, 0.3], [175, 0]) },
  temple_massage: { target: reachBoth([0.1, 0.22, 0.03], [1, -0.6, -0.2], [170, 0]) },
  look_far: { target: { yaw: 55 } },
  near_far_focus: {
    rest: { L_to: [0.19, 0.12, 0.6], L_pole: [1, -1, 0], L_hand: [180, 90] },
    target: { L_to: [0.05, 0.19, 0.19], L_pole: [1, -1, 0], L_hand: [180, 90] },
  },
  eye_track_vertical: { rest: leftArm([45, 90], [45, 90]), target: leftArm([120, 90], [120, 90]) },
};

// ---- A push-up: a straight body pivoting on the toes, hands planted under the shoulders ----
const PLANK_TOP = 67; // deg the body is tipped from standing, arms straight
const PLANK_BOTTOM = 84;
/** @param {number} w 0 = top, 1 = bottom @returns {P3[]} */
function pushUp(w) {
  const body = skeleton({ ...STAND, nod: -20 });
  const pivot = /** @type {P3} */ ([0, body[31][1], body[31][2]]);
  /** @param {number} deg */
  const tip = (deg) => body.map((p) => add(pivot, apply(rotX(deg), sub(p, pivot))));
  const top = tip(PLANK_TOP);
  const j = tip(PLANK_TOP + (PLANK_BOTTOM - PLANK_TOP) * w);
  const floor = Math.min(...top.map((p) => p[1]));
  for (const [o, s] of [[0, 1], [1, -1]]) {
    const shoulder = j[11 + o];
    // Hands on the floor under where the shoulders are at the top.
    const palm = /** @type {P3} */ ([top[11 + o][0] + 0.03 * s, floor + 0.03, top[11 + o][2]]);
    const [elbow, wrist] = reach(shoulder, palm, [0.6 * s, 0.3, -1], UPPER_ARM, FOREARM);
    j[13 + o] = elbow;
    j[15 + o] = wrist;
    j[17 + o] = add(wrist, [0, -0.03, 0.07]);
    j[19 + o] = add(wrist, [0, -0.03, 0.09]);
    j[21 + o] = add(wrist, [0.02 * -s, -0.03, 0.05]);
  }
  return j;
}

// ---- Timing ------------------------------------------------------------------------
const smooth = (x) => x * x * (3 - 2 * x);
/** How far into the move (0 rest, 1 target) at `u` through one rep: hold, go, hold, come back, hold. */
function envelope(u) {
  if (u < 0.1) return 0;
  if (u < 0.42) return smooth((u - 0.1) / 0.32);
  if (u < 0.58) return 1;
  if (u < 0.9) return 1 - smooth((u - 0.58) / 0.32);
  return 0;
}

/** @template T @param {T} a @param {T} b @param {number} w @returns {T} */
function mix(a, b, w) {
  if (typeof a === "number" && typeof b === "number") return /** @type {T} */ (a + (b - a) * w);
  if (Array.isArray(a) && Array.isArray(b)) return /** @type {T} */ (a.map((v, i) => v + (b[i] - v) * w));
  return w < 0.5 ? a : b;
}

const MIRROR_KEYS = ["up", "fore", "hand", "to", "pole", "thigh", "shin", "foot"];
/** The same angles for the other side. @param {Params} p @returns {Params} */
function mirror(p) {
  const out = { ...p, bend: -p.bend, yaw: -p.yaw, tilt: -p.tilt };
  for (const k of MIRROR_KEYS) {
    out[`L_${k}`] = p[`R_${k}`];
    out[`R_${k}`] = p[`L_${k}`];
  }
  for (const k of ["L_to", "R_to", "L_pole", "R_pole"]) if (out[k]) out[k] = [-out[k][0], out[k][1], out[k][2]];
  return out;
}

/**
 * @typedef {object} Built
 * @property {number} seconds
 * @property {1 | 2} reps
 * @property {"seated" | "standing"} stance
 * @property {"front" | "side"} camera
 * @property {Params[][]} sides keyframes from rest to target, per side
 * @property {("both" | "L" | "R")[]} plant per side
 * @property {((w: number) => P3[]) | undefined} custom
 */

/**
 * Where a hand aimed by angles is, as a reach (wrist and elbow direction in the torso's frame), so
 * a move can blend from resting hands to hands that reach a spot.
 * @param {Params} p @param {"L" | "R"} side @returns {Params}
 */
function asReach(p, side) {
  const j = skeleton({ ...p, [`${side}_to`]: null });
  const torso = torsoOf(p);
  /** @param {P3} v */
  const inTorso = (v) => apply(transpose(torso), v);
  const chest = apply(torso, [0, TORSO, 0]);
  const o = side === "L" ? 0 : 1;
  return { ...p, [`${side}_to`]: inTorso(sub(j[15 + o], chest)), [`${side}_pole`]: inTorso(sub(j[13 + o], midpoint(j[11 + o], j[15 + o]))) };
}

/** Keyframes with each hand driven the same way in all of them. @param {Params[]} stops @returns {Params[]} */
function sameDrive(stops) {
  for (const side of /** @type {const} */ (["L", "R"])) {
    if (stops.some((p) => p[`${side}_to`])) stops = stops.map((p) => (p[`${side}_to`] ? p : asReach(p, side)));
  }
  return stops;
}

/** @type {Map<string, Built>} */
const BUILT = new Map();
/** @param {string} key @returns {Built | null} */
function built(key) {
  if (BUILT.has(key)) return BUILT.get(key);
  if (!Object.hasOwn(MOVES, key) || !Object.hasOwn(EXERCISES, key)) return null;
  const move = MOVES[key];
  const ex = EXERCISES[key];
  const stance = move.stance ?? ex.stance;
  const base = stance === "seated" ? SIT : STAND;
  /** @type {Params} */
  const rest = { ...base, ...move.rest };
  const frames = sameDrive([rest, ...(move.via ? [{ ...rest, ...move.via }] : []), { ...rest, ...move.target }]);
  const reps = move.reps ?? 1;
  const plant = move.plant ?? "both";
  /** @type {Built} */
  const b = {
    seconds: REP_SECONDS * reps,
    reps,
    stance,
    camera: ex.camera,
    sides: reps === 2 ? [frames, frames.map(mirror)] : [frames],
    plant: reps === 2 ? [plant, plant === "L" ? "R" : plant === "R" ? "L" : "both"] : [plant],
    custom: move.custom,
  };
  BUILT.set(key, b);
  return b;
}

/**
 * How long one loop of a move's demo is, and how many reps it shows.
 * @param {string} key
 * @returns {{ seconds: number, reps: 1 | 2, stance: "seated" | "standing", camera: "front" | "side" } | null}
 */
export function demoMotion(key) {
  const b = built(key);
  return b && { seconds: b.seconds, reps: b.reps, stance: b.stance, camera: b.camera };
}

/**
 * The 33 MediaPipe joints of a move's demo at `t` seconds (it loops), in meters: x to the
 * person's left, y up from the floor, z forward. Null for an unknown move.
 * @param {string} key
 * @param {number} t
 * @returns {P3[] | null}
 */
export function demoPose(key, t) {
  const b = built(key);
  if (!b) return null;
  const loop = ((t % b.seconds) + b.seconds) % b.seconds;
  const rep = Math.min(b.reps - 1, Math.floor(loop / REP_SECONDS));
  const w = envelope(loop / REP_SECONDS - rep);
  /** @type {P3[]} */
  let j;
  if (b.custom) {
    j = b.custom(w);
  } else {
    const frames = b.sides[rep];
    const rest = frames[0];
    // Through the keyframes in turn: rest, (via,) target.
    const span = w * (frames.length - 1);
    const at = Math.min(frames.length - 2, Math.floor(span));
    /** @type {Params} */
    const p = /** @type {Params} */ ({});
    for (const k of Object.keys(rest)) p[k] = mix(frames[at][k], frames[at + 1][k], span - at);
    j = skeleton(p);
    if (b.stance === "standing") {
      // Planted feet stay where they were at rest: move the body, not the feet.
      const still = skeleton(rest);
      const feet = { both: [27, 28], L: [27], R: [28] }[b.plant[rep]];
      let dx = 0;
      let dz = 0;
      for (const f of feet) {
        dx += still[f][0] - j[f][0];
        dz += still[f][2] - j[f][2];
      }
      j = j.map((q) => /** @type {P3} */ ([q[0] + dx / feet.length, q[1], q[2] + dz / feet.length]));
    }
  }
  const floor = Math.min(...j.map((q) => q[1]));
  return j.map((q) => /** @type {P3} */ ([q[0], q[1] - floor, q[2]]));
}

// ---- Camera ------------------------------------------------------------------------
/** Where a move's camera sits, by the camera the coach recommends for it. */
export const CAMERA_YAW = { front: 0, side: 90 };
const DISTANCE = 4; // m from the middle of the figure
const FILL = 0.36; // of the smaller side of the picture, for the figure's reach from its middle

/**
 * @typedef {object} View
 * @property {number} width px
 * @property {number} height px
 * @property {number} [yaw] deg around the figure: 0 in front, 90 at the person's left. Defaults to the move's camera
 * @property {number} [pitch] deg above the figure, 0 = level (a webcam at chest height)
 */

/** @type {Map<string, { centre: P3, radius: number }>} */
const FRAMES = new Map();
/** Middle and reach of everything a demo shows over its loop, so the camera can keep it all in view. @param {string} key */
function framing(key) {
  if (FRAMES.has(key)) return FRAMES.get(key);
  const b = built(key);
  const pts = Array.from({ length: 48 }, (_, i) => demoPose(key, (i / 48) * b.seconds)).flat();
  const lo = [0, 1, 2].map((a) => Math.min(...pts.map((p) => p[a])));
  const hi = [0, 1, 2].map((a) => Math.max(...pts.map((p) => p[a])));
  const centre = /** @type {P3} */ ([0, 1, 2].map((a) => (lo[a] + hi[a]) / 2));
  const radius = Math.max(...pts.map((p) => len(sub(p, centre)))) + 0.12; // + a head's width
  const f = { centre, radius };
  FRAMES.set(key, f);
  return f;
}

/**
 * A pinhole camera orbiting the figure. Returns picture x, y (px, y down), the depth (m) and the
 * size of a meter there (px).
 * @param {string} key @param {View} view
 * @returns {(p: P3) => [number, number, number, number]}
 */
function camera(key, view) {
  const { centre, radius } = framing(key);
  const yaw = (view.yaw ?? CAMERA_YAW[built(key).camera]) * DEG;
  const pitch = (view.pitch ?? 0) * DEG;
  const eye = add(centre, [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)], DISTANCE);
  const f = unit(sub(centre, eye));
  const r = unit([-f[2], 0, f[0]]); // f x up
  const u = /** @type {P3} */ ([r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]]);
  const focal = (FILL * Math.min(view.width, view.height) * DISTANCE) / radius;
  return (p) => {
    const d = sub(p, eye);
    const depth = dot(d, f);
    const s = focal / depth;
    return [view.width / 2 + dot(d, r) * s, view.height / 2 - dot(d, u) * s, depth, s];
  };
}

/**
 * The demo as a camera would see it, in MediaPipe's image landmark format: 33 x [x, y, visibility],
 * x and y normalised to [0, 1], the person's left on the right of the picture.
 * @param {string} key
 * @param {number} t
 * @param {View} view
 * @returns {[number, number, number][] | null}
 */
export function demoLandmarks(key, t, view) {
  const pose = demoPose(key, t);
  if (!pose) return null;
  const see = camera(key, view);
  return pose.map((p) => {
    const [x, y] = see(p);
    return /** @type {[number, number, number]} */ ([x / view.width, y / view.height, 1]);
  });
}

// ---- What to draw -----------------------------------------------------------------
/** The scene around the person (how the person looks is lib/demo-look.js): the joints the coach measures, the chair and the shadow. */
export const DEMO_COLORS = {
  accent: "#3ddc97",
  chair: "#7d8695",
  shadow: "rgba(0, 0, 0, 0.22)",
};
const SWING = 30; // deg either side of the coach's camera
const SWING_SECONDS = 16;
const PITCH = 12; // deg above, so the floor shows

/**
 * How to look at a demo at `t`: from the coach's camera, swinging slowly either side of it so
 * the figure reads as 3D, plus however far the user has turned it (`turn`, deg). `still` (reduced
 * motion) keeps the camera put.
 * @param {string} key
 * @param {number} t
 * @param {{ width: number, height: number, turn?: number, still?: boolean }} opts
 * @returns {Required<View> | null}
 */
export function demoView(key, t, { width, height, turn = 0, still = false }) {
  const b = built(key);
  if (!b) return null;
  const swing = still ? 0 : SWING * Math.sin((2 * Math.PI * t) / SWING_SECONDS);
  return { width, height, yaw: CAMERA_YAW[b.camera] + swing + turn, pitch: PITCH };
}

/**
 * One thing to paint. Capsules are round-capped lines `2r` wide; `depth` is meters from the
 * camera, and shapes come sorted far to near (paint them in order).
 * @typedef {{ kind: "capsule", x1: number, y1: number, x2: number, y2: number, r: number, fill: string, depth: number, part: string }
 *   | { kind: "circle", x: number, y: number, r: number, fill: string, depth: number, part: string }
 *   | { kind: "ellipse", x: number, y: number, rx: number, ry: number, fill: string, depth: number, part: string }} Shape
 */

// Body parts as capsules between joints, by the name lib/demo-look.js dresses and sizes them by.
// -1 / -2: the middle of the hips / shoulders, -3: the head.
/** @type {[number, number, string][]} */
const LIMBS = [
  [-1, -2, "torso"],
  [23, 24, "hips"],
  [11, 12, "shoulders"],
  [-2, -3, "neck"],
  [11, 13, "upperArm"],
  [13, 15, "forearm"],
  [15, 19, "hand"],
  [12, 14, "upperArm"],
  [14, 16, "forearm"],
  [16, 20, "hand"],
  [23, 25, "thigh"],
  [25, 27, "shin"],
  [27, 29, "foot"],
  [29, 31, "foot"],
  [24, 26, "thigh"],
  [26, 28, "shin"],
  [28, 30, "foot"],
  [30, 32, "foot"],
];
/** The parts lib/demo-look.js has to dress and size: the limbs, and the head. */
export const DEMO_PARTS = [...new Set([...LIMBS.map(([, , part]) => part), "head"])];
// Marks on the joints the coach measures (radius in meters): a little wider than the limb there.
/** @type {[number, number][]} */
const MARKS = [
  [11, 0.052],
  [12, 0.052],
  [13, 0.043],
  [14, 0.043],
  [15, 0.034],
  [16, 0.034],
  [19, 0.026],
  [20, 0.026],
  [23, 0.07],
  [24, 0.07],
  [25, 0.056],
  [26, 0.056],
  [27, 0.044],
  [28, 0.044],
  [29, 0.03],
  [30, 0.03],
  [31, 0.03],
  [32, 0.03],
];

/** @param {string} hex @param {number} k 0..1 darker, 1.. lighter towards white @returns {string} */
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(k <= 1 ? c * k : c + (255 - c) * Math.min(1, k - 1)));
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** Joint indices of what a move measures, both sides. @param {string} key @returns {Set<number>} */
function watched(key) {
  const out = new Set();
  for (const joint of EXERCISES[key].joints) for (const side of /** @type {const} */ (["left", "right"])) out.add(JOINTS[side][joint]);
  return out;
}

/** @type {Map<string, P3[][] | null>} */
const CHAIRS = new Map();
/** A plain chair under the seated pose, as rails (pairs of points), or null when the move has no seat. @param {string} key */
function chair(key) {
  if (CHAIRS.has(key)) return CHAIRS.get(key);
  const b = built(key);
  /** @type {P3[][] | null} */
  let rails = null;
  if (b.stance === "seated" || key === "sit_to_stand") {
    const seated = demoPose(key, b.stance === "seated" ? 0 : REP_SECONDS / 2);
    const y = (seated[23][1] + seated[24][1]) / 2 - 0.09;
    const z = (seated[23][2] + seated[24][2]) / 2 - 0.06;
    const w = 0.22;
    const d = 0.21;
    rails = [];
    for (const x of [-w, -w / 2, 0, w / 2, w]) rails.push([[x, y, z - d], [x, y, z + d]]); // seat slats
    for (const [x, zz] of [[-w, z - d], [w, z - d], [-w, z + d], [w, z + d]]) rails.push([[x, 0.02, zz], [x, y, zz]]); // legs
    for (const x of [-w, w]) rails.push([[x, y, z - d], [x, y + 0.42, z - d - 0.04]]); // back posts
    for (const h of [0.26, 0.4]) rails.push([[-w, y + h, z - d - 0.03], [w, y + h, z - d - 0.03]]); // back rails
  }
  CHAIRS.set(key, rails);
  return rails;
}

/**
 * Everything to paint for a move's demo at `t`, seen through `view`, far to near, the person dressed
 * and sized by `look` (lib/demo-look.js).
 * @param {string} key
 * @param {number} t
 * @param {View} view
 * @param {DemoLook} [look]
 * @returns {Shape[] | null}
 */
export function demoScene(key, t, view, look = DEMO_LOOK) {
  const pose = demoPose(key, t);
  if (!pose) return null;
  const see = camera(key, view);
  /** @param {number} i @returns {P3} */
  const at = (i) => (i === -1 ? midpoint(pose[23], pose[24]) : i === -2 ? midpoint(pose[11], pose[12]) : i === -3 ? midpoint(pose[7], pose[8]) : pose[i]);
  const seen = pose.map(see);
  const depths = seen.map((p) => p[2]);
  const near = Math.min(...depths);
  const far = Math.max(...depths);
  // Nearer parts a little lighter: depth you can read even without the swing.
  const light = (depth) => 0.84 + 0.2 * ((far - depth) / Math.max(far - near, 1e-6));
  const hot = watched(key);
  /** @type {Shape[]} */
  const shapes = [];

  // A darker edge just behind each part of the person: it reads on a light page as on a dark one,
  // and a near limb stands out from what's behind it.
  const EDGE = 0.012; // m
  /** @param {P3} a @param {P3} b @param {number} r @param {string} color @param {string} part @param {boolean} [edge] */
  const capsule = (a, b, r, color, part, edge = true) => {
    const [x1, y1, d1, s1] = see(a);
    const [x2, y2, d2, s2] = see(b);
    const depth = (d1 + d2) / 2;
    const rp = (r * (s1 + s2)) / 2;
    if (edge) shapes.push({ kind: "capsule", x1, y1, x2, y2, r: rp + (EDGE * (s1 + s2)) / 2, fill: shade(color, 0.6), depth: depth + 1e-4, part: "outline" });
    shapes.push({ kind: "capsule", x1, y1, x2, y2, r: rp, fill: shade(color, light(depth)), depth, part });
    // A soft highlight on the side facing the light (top left).
    const o = rp * 0.32;
    shapes.push({ kind: "capsule", x1: x1 - o, y1: y1 - o, x2: x2 - o, y2: y2 - o, r: rp * 0.38, fill: shade(color, 1.28), depth: depth - 1e-4, part: "highlight" });
  };
  /** @param {P3} p @param {number} r @param {string} color @param {string} part @param {boolean} [shine] @param {boolean} [edge] */
  const ball = (p, r, color, part, shine = true, edge = false) => {
    const [x, y, depth, s] = see(p);
    if (edge) shapes.push({ kind: "circle", x, y, r: (r + EDGE) * s, fill: shade(color, 0.6), depth: depth + 1e-4, part: "outline" });
    // The eyes and the watched joints keep their exact colour.
    const fill = part === "eyes" || part === "joint" ? color : shade(color, light(depth));
    shapes.push({ kind: "circle", x, y, r: r * s, fill, depth, part });
    if (shine) shapes.push({ kind: "circle", x: x - r * s * 0.3, y: y - r * s * 0.32, r: r * s * 0.42, fill: shade(color, 1.3), depth: depth - 1e-4, part: "highlight" });
  };

  // Shadow on the floor under what's near it (feet, legs; a whole body in a push-up), under everything.
  const low = pose.filter((p) => p[1] < 0.5);
  const xs = low.map((p) => p[0]);
  const zs = low.map((p) => p[2]);
  const floorMid = /** @type {P3} */ ([(Math.min(...xs) + Math.max(...xs)) / 2, 0, (Math.min(...zs) + Math.max(...zs)) / 2]);
  const spread = 0.18 + Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2;
  const [sx, sy, , ss] = see(floorMid);
  const tilt = Math.sin(((view.pitch ?? 0) * Math.PI) / 180);
  shapes.push({ kind: "ellipse", x: sx, y: sy, rx: spread * ss, ry: Math.max(2, spread * ss * tilt), fill: DEMO_COLORS.shadow, depth: 1e9, part: "shadow" });

  for (const [a, b] of chair(key) ?? []) capsule(a, b, 0.022, DEMO_COLORS.chair, "chair", false);
  /** @param {string} part */
  const worn = (part) => look.colors[look.wear[part]];
  for (const [a, b, part] of LIMBS) capsule(at(a), at(b), look.size[part], worn(part), part);
  for (const [i, r] of MARKS) if (hot.has(i)) ball(pose[i], r, DEMO_COLORS.accent, "joint");
  // The head, with hair, a nose and eyes so you can see where it faces. The hair is a second head a
  // little behind and above it: a hairline from the front, over the head from behind. The ears show
  // only when the coach measures them (they'd sit on the hair from the side).
  const head = at(-3);
  const facing = unit(sub(pose[0], head));
  const up = unit(sub(head, at(-2)));
  ball(add(add(head, facing, -0.16 * look.size.head), up, 0.3 * look.size.head), look.size.head * 1.05, look.colors.hair, "hair", false, true);
  ball(head, look.size.head, worn("head"), "head", true, true);
  for (const i of [7, 8]) if (hot.has(i)) ball(pose[i], 0.026, DEMO_COLORS.accent, "joint", false);
  ball(pose[0], 0.022, hot.has(0) ? DEMO_COLORS.accent : worn("head"), hot.has(0) ? "joint" : "head", false);
  for (const i of [2, 5]) ball(pose[i], 0.011, look.colors.eyes, "eyes", false);

  // Fixes the order so equal depths always paint the same way.
  return shapes.map((sh, i) => ({ sh, i })).sort((a, b) => b.sh.depth - a.sh.depth || a.i - b.i).map(({ sh }) => sh);
}

const TURN_PER_PX = 0.6;
/**
 * How far to turn the view (`turn` for demoView, deg) for a drag of `dx` pixels to the right (points
 * on a phone). Like grabbing a globe, the side facing you follows the finger: the camera goes the
 * other way.
 * @param {number} dx
 */
export function demoTurn(dx) {
  return dx ? -dx * TURN_PER_PX : 0;
}
