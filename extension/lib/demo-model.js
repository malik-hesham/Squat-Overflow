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
 * @property {number} twist torso turn about the spine, deg, + towards the person's left
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
 * How far the wrist gets from the shoulder when asked to reach `d`: all the way up to 90% of the
 * arm's length `full`, then ever closer to straight, easing in (no snap as the arm locks out).
 * @param {number} d @param {number} full
 */
function stretch(d, full) {
  const knee = 0.9 * full;
  if (d <= knee) return d;
  const s = (d - knee) / (full - knee);
  return knee + ((full - knee) * s) / Math.cbrt(1 + s ** 3) - 1e-9;
}

/**
 * Two-bone reach: where the elbow goes for the wrist to touch `target` (or get as close as it
 * can), bending towards `pole`. Bone lengths never change. Exported for the tests.
 * @param {P3} root @param {P3} target @param {P3} pole @param {number} a @param {number} b
 * @returns {[P3, P3]} elbow, wrist
 */
export function reach(root, target, pole, a, b) {
  const to = sub(target, root);
  const d = stretch(Math.max(len(to), 1e-6), a + b);
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
/** The torso's rotation: a twist about the spine, then lean, then side bend, about the hips. @param {Params} p */
const torsoOf = (p) => mul(rotZ(p.bend), mul(rotX(p.lean), rotY(p.twist)));
/** @type {Params} */
const STAND = {
  lean: 0,
  bend: 0,
  twist: 0,
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
 * @property {Pose} [via] a pose the move heads for first, on the way there and back (lift the foot, then straighten the knee); the path curves past it, with no corner
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
  seated_jacks: { target: {}, custom: seatedJacks },
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
  // Arms folded across the chest; they turn with it.
  trunk_rotation: {
    reps: 2,
    rest: reachBoth([-0.1, -0.17, 0.13], [0.3, -1, 0.6], [90, 180]),
    target: { twist: 40, ...reachBoth([-0.1, -0.17, 0.13], [0.3, -1, 0.6], [90, 180]) },
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
  // The shin swings back before the thigh dips, so the foot never sinks into the floor (which
  // would lift the person off the seat), and the heel rises at the end, toes down.
  heel_slide: { reps: 2, via: { L_shin: -20 }, target: { L_thigh: 82, L_shin: -38, L_foot: 78 } },
  sit_to_stand: {
    rest: reachBoth([-0.1, -0.15, 0.12], [1, -0.5, 0.2], [90, 180]),
    target: { L_thigh: 85, L_shin: -5, R_thigh: 85, R_shin: -5, lean: 30, ...reachBoth([-0.1, -0.15, 0.12], [1, -0.5, 0.2], [90, 180]) },
  },
  mini_squat: { target: { L_thigh: 35, L_shin: -20, R_thigh: 35, R_shin: -20, lean: 15 } },
  hamstring_curl: { reps: 2, plant: "R", via: { L_thigh: 25, L_shin: -25 }, target: { L_shin: -95, L_foot: 10 } },
  // The shin stays upright, so the foot lifts straight off the floor; the other arm swings forward.
  seated_march: {
    reps: 2,
    rest: arms([8, 0], [80, 90]),
    target: { L_thigh: 112, L_foot: 80, L_up: [25, -90], L_fore: [70, 90], L_hand: [70, 90], R_up: [40, 90], R_fore: [115, 90], R_hand: [115, 90] },
  },
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

// ---- Seated jacks: the arms sweep up into an X while the heels slide out --------------------
// The heels stay on the floor, so the person stays on the seat. The toes lift before the heels
// slide and come down after they stop, so no foot slides on its toes; the knees follow the feet.
const JACK_ARMS = arms([138, 0], [142, 0]);
const JACK_HEEL = /** @type {P3} */ ([0.16, 0, 0.1]); // where the left heel slides to, m (mirrored for the right)
const JACK_TOES = 30; // deg the toes lift
const JACK_TURN = 20; // deg the toes turn out
/** @param {number} w 0 = rest, 1 = the X @returns {P3[]} */
function seatedJacks(w) {
  /** @type {Params} */
  const p = { ...SIT };
  for (const [k, v] of Object.entries(JACK_ARMS)) p[k] = mix(SIT[k], v, w);
  const j = skeleton(p);
  const lift = smooth(Math.min(1, w / 0.3));
  const out = smooth(Math.max(0, (w - 0.15) / 0.85));
  for (const [o, s] of [[0, 1], [1, -1]]) {
    const [hip, ankle0, heel0, toe0] = [j[23 + o], j[27 + o], j[29 + o], j[31 + o]];
    const heel = add(heel0, [JACK_HEEL[0] * s, 0, JACK_HEEL[2]], out);
    const foot = mul(rotY(JACK_TURN * s * out), rotX(-JACK_TOES * lift)); // pivots on the heel
    const ankle = add(heel, apply(foot, sub(ankle0, heel0)));
    j[25 + o] = reach(hip, ankle, [0.6 * s * out, 1, 1], THIGH, SHIN)[0];
    j[27 + o] = ankle;
    j[29 + o] = heel;
    j[31 + o] = add(heel, apply(foot, sub(toe0, heel0)));
  }
  return j;
}

// ---- Timing ------------------------------------------------------------------------
/** Minimum jerk, the way people move: starts and stops with no speed and no push. */
const smooth = (x) => x * x * x * (x * (6 * x - 15) + 10);
/** How far into the move (0 rest, 1 target) at `u` through one rep: hold, go, hold, come back, hold. */
function envelope(u) {
  if (u < 0.04) return 0;
  if (u < 0.44) return smooth((u - 0.04) / 0.4);
  if (u < 0.56) return 1;
  if (u < 0.96) return 1 - smooth((u - 0.56) / 0.4);
  return 0;
}

/** @template T @param {T} a @param {T} b @param {number} w @returns {T} */
function mix(a, b, w) {
  if (typeof a === "number" && typeof b === "number") return /** @type {T} */ (a + (b - a) * w);
  if (Array.isArray(a) && Array.isArray(b)) return /** @type {T} */ (a.map((v, i) => v + (b[i] - v) * w));
  return w < 0.5 ? a : b;
}

/**
 * A smooth way from `a` to `c` that heads for `b` first (a cubic Bezier through a, b, b, c): it
 * never overshoots them, and has no corner where a straight line through b would.
 * @template T @param {T} a @param {T} b @param {T} c @param {number} w @returns {T}
 */
function curve(a, b, c, w) {
  const [ka, kb, kc] = [(1 - w) ** 3, 3 * w * (1 - w), w ** 3];
  if (typeof a === "number" && typeof b === "number" && typeof c === "number") return /** @type {T} */ (a * ka + b * kb + c * kc);
  if (Array.isArray(a) && Array.isArray(b) && Array.isArray(c)) return /** @type {T} */ (a.map((v, i) => v * ka + b[i] * kb + c[i] * kc));
  return w < 0.5 ? a : c;
}

const MIRROR_KEYS = ["up", "fore", "hand", "to", "pole", "thigh", "shin", "foot"];
/** The same angles for the other side. @param {Params} p @returns {Params} */
function mirror(p) {
  const out = { ...p, bend: -p.bend, twist: -p.twist, yaw: -p.yaw, tilt: -p.tilt };
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
    // From rest to target; a via pose bends the way there into a curve that heads for it first.
    const target = frames.at(-1);
    const via = frames.length === 3 ? frames[1] : null;
    /** @type {Params} */
    const p = /** @type {Params} */ ({});
    for (const k of Object.keys(rest)) p[k] = via ? curve(rest[k], via[k], target[k], w) : mix(rest[k], target[k], w);
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
/** The scene around the person (how the person looks is lib/demo-look.js): the shadow on the floor. */
export const DEMO_COLORS = {
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
 * One thing to paint. Polys are filled outlines through `points` (x, y, x, y, ...); capsules are
 * round-capped lines `2r` wide; `depth` is meters from the camera, and shapes come sorted far to
 * near (paint them in order).
 * @typedef {{ kind: "poly", points: number[], fill: string, depth: number, part: string }
 *   | { kind: "capsule", x1: number, y1: number, x2: number, y2: number, r: number, fill: string, depth: number, part: string }
 *   | { kind: "circle", x: number, y: number, r: number, fill: string, depth: number, part: string }
 *   | { kind: "ellipse", x: number, y: number, rx: number, ry: number, fill: string, depth: number, part: string }} Shape
 */

// The person is drawn flat, like a vector illustration: each body part is the outline round a few
// balls placed along its bones (a limb that tapers and bulges, a chest broader than the waist), as
// the camera sees them. A ball's radius is in units of the part's size in lib/demo-look.js.
/** The parts lib/demo-look.js has to dress and size. */
export const DEMO_PARTS = ["head", "neck", "shoulders", "torso", "upperArm", "forearm", "hand", "hips", "thigh", "knee", "shin", "foot"];
const EDGE = 0.011; // m, the darker edge round each part
const ROUND = 14; // points round each ball's outline
const X = /** @type {P3} */ ([1, 0, 0]); // the axis the legs swing about

/** @param {string} hex @param {number} k 0..1 darker, 1.. lighter towards white @returns {string} */
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(k <= 1 ? c * k : c + (255 - c) * Math.min(1, k - 1)));
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** @param {P3} a @param {P3} b @returns {P3} */
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** @param {P3} a @param {P3} b @param {number} f @returns {P3} */
const lerp = (a, b, f) => add(a, sub(b, a), f);

/**
 * The outline round some circles (x, y, r), as a flat x, y list: the convex hull of points round
 * each circle.
 * @param {[number, number, number][]} circles
 * @returns {number[]}
 */
function hull(circles) {
  /** @type {[number, number][]} */
  const pts = [];
  for (const [x, y, r] of circles) {
    for (let i = 0; i < ROUND; i++) pts.push([x + r * Math.cos((2 * Math.PI * i) / ROUND), y + r * Math.sin((2 * Math.PI * i) / ROUND)]);
  }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  /** @param {[number, number]} o @param {[number, number]} a @param {[number, number]} b */
  const turn = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  /** One side of the hull, going through the points in order. @param {[number, number][]} list */
  const side = (list) => {
    /** @type {[number, number][]} */
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && turn(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    return out.slice(0, -1);
  };
  return [...side(pts), ...side(pts.slice().reverse())].flat();
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
  const depths = pose.map((p) => see(p)[2]);
  const near = Math.min(...depths);
  const far = Math.max(...depths);
  // Parts further away a little darker: depth you can read even without the swing.
  const light = (depth) => 0.86 + 0.14 * ((far - depth) / Math.max(far - near, 1e-6));
  const size = look.size;
  /** @param {string} part */
  const worn = (part) => look.colors[look.wear[part]];
  /** @type {Shape[]} */
  const shapes = [];

  /** @typedef {{ x: number, y: number, r: number, d: number, s: number }} Seen a ball as the camera sees it */
  /** @param {[P3, number][]} balls [centre, radius in m] @returns {Seen[]} */
  const seeBalls = (balls) =>
    balls.map(([p, r]) => {
      const [x, y, d, s] = see(p);
      return { x, y, r: r * s, d, s };
    });
  /** @param {Seen[]} circles */
  const meanDepth = (circles) => circles.reduce((sum, c) => sum + c.d, 0) / circles.length;
  /**
   * Paints the outline round some balls at `depth`, with a darker edge behind it (at `edgeDepth`) and
   * a darker tone on the side away from the light (bottom right), lit as if at `lit`.
   * @param {Seen[]} circles @param {string} color @param {string} name @param {number} depth
   * @param {{ edge?: boolean, tone?: boolean, edgeDepth?: number, lit?: number }} [opts]
   */
  const paint = (circles, color, name, depth, { edge = true, tone = true, edgeDepth = depth + 1e-7, lit = depth } = {}) => {
    if (edge) shapes.push({ kind: "poly", points: hull(circles.map((c) => [c.x, c.y, c.r + EDGE * c.s])), fill: shade(color, 0.6), depth: edgeDepth, part: "outline" });
    shapes.push({ kind: "poly", points: hull(circles.map((c) => [c.x, c.y, c.r])), fill: shade(color, light(lit)), depth, part: name });
    if (tone) shapes.push({ kind: "poly", points: hull(circles.map((c) => [c.x + c.r * 0.3, c.y + c.r * 0.22, c.r * 0.64])), fill: shade(color, light(lit) * 0.88), depth: depth - 1e-7, part: "shade" });
  };
  /**
   * Paints the outline round some balls ([centre, radius in m]). Its depth is the balls' average,
   * `layer` mm nearer (clothes over skin), unless `depth` sets it (a face in front of the head).
   * Returns the depth.
   * @param {[P3, number][]} balls @param {string} color @param {string} name
   * @param {{ layer?: number, depth?: number, edge?: boolean, tone?: boolean }} [opts]
   */
  const blob = (balls, color, name, { layer = 0, depth: at, edge = true, tone = true } = {}) => {
    const circles = seeBalls(balls);
    const depth = at ?? meanDepth(circles) - layer / 1000;
    paint(circles, color, name, depth, { edge, tone });
    return depth;
  };
  /** @typedef {{ layer?: number, under?: number }} Fit `under`: the depth of what covers it (skin under clothes), to sit just behind that from any side */
  /**
   * Where a part dressed and sized by the look sits: balls are [centre, radius in units of its size].
   * @param {string} name @param {[P3, number][]} balls @param {Fit} [fit]
   */
  const place = (name, balls, { layer = 0, under } = {}) => {
    const circles = seeBalls(balls.map(([p, k]) => [p, k * size[name]]));
    return { name, circles, depth: under === undefined ? meanDepth(circles) - layer / 1000 : under + 1e-3 };
  };
  /** A part dressed and sized by the look. Returns its depth. @param {string} name @param {[P3, number][]} balls @param {Fit} [fit] */
  const part = (name, balls, fit) => {
    const p = place(name, balls, fit);
    paint(p.circles, worn(name), name, p.depth);
    return p.depth;
  };
  /**
   * An arm or a leg in one piece, all in one tone: each part's edge goes just behind the parts it
   * joins, so no seam shows at the elbow, wrist or knee (and it still edges the limb against the
   * rest of the body).
   * @param {[string, [P3, number][], Fit?][]} parts from the root out
   */
  const limb = (parts) => {
    const placed = parts.map(([name, balls, fit]) => place(name, balls, fit));
    const lit = placed.reduce((sum, p) => sum + p.depth, 0) / placed.length;
    placed.forEach((p, i) => {
      const back = Math.max(...placed.slice(Math.max(0, i - 1), i + 2).map((q) => q.depth));
      paint(p.circles, worn(p.name), p.name, p.depth, { edgeDepth: back + 1e-7, lit });
    });
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

  // The body, in the torso's own directions: neck and shoulders under the top, then the shorts.
  const hips = midpoint(pose[23], pose[24]);
  const top = midpoint(pose[11], pose[12]);
  const head = midpoint(pose[7], pose[8]);
  const up = unit(sub(top, hips));
  const left = unit(sub(pose[11], pose[12]));
  const fwd = unit(cross(left, up));
  const tall = len(sub(top, hips));
  /** A point on the torso: across (m, + left), up (share of the hips-to-shoulders height), forward (m). */
  const onTorso = (x, y, z = 0) => add(add(add(hips, left, x), up, y * tall), fwd, z);
  // A tank top (narrow straps, a broad chest, a narrower waist) over the neck, shoulders and shorts.
  const shirt = part("torso", [0.98, 0.72, 0.3, 0.05].flatMap((y, i) => [1, -1].map((s) => /** @type {[P3, number]} */ ([onTorso(s * [0.085, 0.1, 0.045, 0.06][i], y), [0.42, 1.08, 0.92, 0.92][i]]))));
  part("neck", [[top, 1.1], [lerp(top, head, 0.55), 1]], { under: shirt });
  part("shoulders", [[pose[11], 0.85], [onTorso(0, 1.1), 1.05], [pose[12], 0.85]], { under: shirt });
  part("hips", [[onTorso(0.1, 0), 1], [onTorso(-0.1, 0), 1], [onTorso(0, 0.1), 1]], { under: shirt });

  for (const [o, s] of /** @type {const} */ ([[0, 1], [1, -1]])) {
    const [shoulder, elbow, wrist] = [pose[11 + o], pose[13 + o], pose[15 + o]];
    limb([
      ["upperArm", [[lerp(shoulder, elbow, 0.06), 1.3], [lerp(shoulder, elbow, 0.45), 1.02], [elbow, 0.74]], { layer: 2 }],
      ["forearm", [[elbow, 0.9], [lerp(elbow, wrist, 0.28), 1.06], [wrist, 0.68]], { layer: 2 }],
      ["hand", [[wrist, 0.9], [pose[19 + o], 0.85], [pose[17 + o], 0.85], [lerp(wrist, pose[21 + o], 1.3), 0.6]], { layer: 2 }],
    ]);

    const [hip, knee, ankle, heel, toe] = [pose[23 + o], pose[25 + o], pose[27 + o], pose[29 + o], pose[31 + o]];
    const hem = lerp(hip, knee, 0.8);
    const leg = part("thigh", [[hip, 1.08], [hem, 1]]);
    if (look.colors.stripe) {
      // Down the outer seam, on the side facing the camera.
      const out = /** @type {P3} */ ([s, 0, 0]);
      const mid = lerp(hip, knee, 0.4);
      const facing = (see(mid)[2] - see(add(mid, out, 0.01))[2]) / 0.01;
      const off = size.thigh * 0.84;
      if (facing > -0.25) blob([[add(hip, out, off), 0.012], [add(hem, out, off), 0.012]], look.colors.stripe, "stripe", { depth: leg - 2e-6, edge: false, tone: false });
    }
    const calf = unit(cross(X, unit(sub(ankle, knee)))); // the back of the leg
    limb([
      ["knee", [[lerp(hip, knee, 0.62), 1.1], [knee, 0.95]], { under: leg }],
      ["shin", [[knee, 0.95], [add(lerp(knee, ankle, 0.3), calf, 0.016), 1.12], [ankle, 0.6]]],
    ]);
    const lift = unit(cross(unit(sub(toe, heel)), X)); // up from the sole
    part("foot", [[add(heel, lift, size.foot * 0.95), 0.95], [add(toe, lift, size.foot * 0.8), 0.8], [ankle, 0.95], [add(lerp(heel, toe, 0.6), lift, size.foot), 1]], { layer: 1 });
  }

  // The head: an egg (crown and jaw), ears, hair with a quiff, a beard, then the face.
  const R = size.head;
  const face = unit(sub(pose[0], head));
  const hup = unit(sub(midpoint(pose[2], pose[5]), midpoint(pose[9], pose[10])));
  const hleft = unit(cross(hup, face));
  /** A point on the head: across (+ left), up and forward, in head sizes. */
  const onHead = (x, y, z) => add(add(add(head, hleft, x * R), hup, y * R), face, z * R);
  // What sits on the face goes in layers just in front of the head (so it all hides when the head
  // faces away), the `n`th a hair nearer so the layers keep their order seen side on.
  const faceDepth = (z, n) => see(onHead(0, 0, z))[2] - n * 1e-6;
  const skin = worn("head");
  blob([[onHead(0, 0.08, -0.02), R], [onHead(0, -0.38, 0.12), R * 0.82]], skin, "head");
  for (const x of [0.92, -0.92]) {
    const [ex, ey, ed, es] = see(onHead(x, 0, -0.05));
    shapes.push({ kind: "circle", x: ex, y: ey, r: (R * 0.24 + EDGE) * es, fill: shade(skin, 0.6), depth: ed + 2e-7, part: "outline" });
    shapes.push({ kind: "circle", x: ex, y: ey, r: R * 0.24 * es, fill: shade(skin, light(ed)), depth: ed + 1e-7, part: "head" });
  }
  blob([[onHead(0, 0.45, -0.12), 0.84 * R], [onHead(0, 0.42, -0.36), 0.7 * R], [onHead(0.1, 0.72, 0.36), 0.55 * R], [onHead(-0.12, 0.66, 0.26), 0.55 * R]], look.colors.hair, "hair", { depth: faceDepth(-0.12, 2.5) });
  if (look.colors.beard) {
    // Round the jaw and over the chin; the cheeks then cover its top, leaving a band.
    const jaw = [[0.82, -0.05, 0.05, 0.2], [-0.82, -0.05, 0.05, 0.2], [0.62, -0.55, 0.35, 0.36], [-0.62, -0.55, 0.35, 0.36], [0, -0.98, 0.55, 0.4]];
    blob(jaw.map(([x, y, z, r]) => [onHead(x, y, z), r * R]), look.colors.beard, "beard", { depth: faceDepth(0.5, 1) });
    blob([[onHead(0, 0.22, 0.42), 0.62 * R], [onHead(0.38, -0.12, 0.62), 0.3 * R], [onHead(-0.38, -0.12, 0.62), 0.3 * R]], skin, "face", { depth: faceDepth(0.6, 2), edge: false });
    blob([[onHead(0.2, -0.36, 0.9), 0.13 * R], [onHead(-0.2, -0.36, 0.9), 0.13 * R]], look.colors.beard, "beard", { depth: faceDepth(0.9, 3), edge: false, tone: false });
  }
  // Nose, eyes and brows.
  const [nx, ny, , ns] = see(pose[0]);
  shapes.push({ kind: "circle", x: nx, y: ny, r: 0.02 * ns, fill: shade(skin, 0.82), depth: faceDepth(1, 4), part: "head" });
  for (const [i, x] of /** @type {const} */ ([[2, 0.36], [5, -0.36]])) {
    const [ex, ey, , es] = see(pose[i]);
    shapes.push({ kind: "circle", x: ex, y: ey, r: 0.011 * es, fill: look.colors.eyes, depth: faceDepth(0.95, 5), part: "eyes" });
    const [x1, y1, , s1] = see(onHead(x + 0.16, 0.45, 0.82));
    const [x2, y2] = see(onHead(x - 0.16, 0.4, 0.85));
    shapes.push({ kind: "capsule", x1, y1, x2, y2, r: 0.006 * s1, fill: look.colors.hair, depth: faceDepth(0.9, 5), part: "brows" });
  }

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
