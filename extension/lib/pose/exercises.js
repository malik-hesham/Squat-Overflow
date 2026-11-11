/**
 * Exercise definitions: which angle drives the rep, and which form rules apply
 * (port of server/analysis/exercises.py).
 *
 * Every exercise reduces a pose to one *primary value* (a joint angle) that
 * moves between a REST zone and a TARGET zone once per rep, plus a list of form
 * issues seen in that frame. The rep counter in `session.js` is
 * exercise-agnostic.
 *
 * The office set (`OFFICE_EXERCISES`) is deliberately forgiving: each one only
 * counts reps on one angle with wide thresholds, and never flags form faults.
 */
import { angle, angleFromHorizontal, angleFromVertical, norm, sub } from "./geometry.js";
import { degrees, pyRound, pySum } from "./pymath.js";

/** @typedef {import("./geometry.js").Side} Side */
/** @typedef {import("./geometry.js").Joint} Joint */
/** @typedef {import("./geometry.js").Pose} Pose */

export const ISSUE_TEXT = /** @type {const} */ ({
  not_visible: "Step back so your whole body is in frame",
  chest_up: "Keep your chest up, you're leaning too far forward",
  knees_past_toes: "Sit back into your hips, knees are drifting past your toes",
  hips_sag: "Brace your core, your hips are sagging",
  hips_pike: "Lower your hips into a straight line",
  not_plank: "Get into a plank position, side-on to the camera",
  elbow_drift: "Keep your elbow pinned to your side",
  swinging: "Don't swing your torso, keep it still",
  arms_down: "Start with your hands at shoulder height",
  uneven_press: "Press both arms evenly",
  not_deep_enough: "Go through the full range of motion",
  too_fast: "Slow down and control the movement",
});

/** @typedef {keyof typeof ISSUE_TEXT} IssueCode */
/** @typedef {"front" | "side"} Camera */
/** @typedef {"seated" | "standing"} Stance */

/**
 * @typedef {object} Measurement
 * @property {number} value primary angle in degrees
 * @property {IssueCode[]} issues
 * @property {boolean} valid false = body isn't in the start position; don't count
 */

/**
 * @typedef {object} ExerciseInit
 * @property {string} key
 * @property {string} label
 * @property {string} metric what the primary value measures, for the UI
 * @property {number} rest threshold of the rest zone
 * @property {number} target threshold of the target zone
 * @property {boolean} [restIsHigh] true: angle is large at rest and shrinks during the rep. Default true
 * @property {boolean} [bilateral] true: needs both sides visible (front view). Default false
 * @property {readonly Joint[]} [joints]
 * @property {Camera} [camera] recommended camera angle, for the UI. Default "side"
 * @property {number} [minRepSeconds] default 0.8 (0.5 for the office set)
 * @property {string} [category] groups the picker in the UI. Default "Workout"
 * @property {string} [howTo] one-line instruction shown in the UI
 * @property {Stance} [stance] standing moves need the whole body in frame. Default "standing"
 */

/** @typedef {(pose: Pose, side: Side) => number} AngleFn */

/**
 * @param {number} value
 * @returns {Measurement}
 */
function measurement(value) {
  return { value, issues: [], valid: true };
}

/** @abstract */
export class Exercise {
  /** @param {ExerciseInit} init */
  constructor(init) {
    this.key = init.key;
    this.label = init.label;
    this.metric = init.metric;
    this.rest = init.rest;
    this.target = init.target;
    this.restIsHigh = init.restIsHigh ?? true;
    this.bilateral = init.bilateral ?? false;
    this.joints = init.joints ?? [];
    this.camera = init.camera ?? "side";
    this.minRepSeconds = init.minRepSeconds ?? 0.8;
    this.category = init.category ?? "Workout";
    this.howTo = init.howTo ?? "";
    this.stance = init.stance ?? "standing";
  }

  /** @param {number} v */
  atRest(v) {
    return this.restIsHigh ? v >= this.rest : v <= this.rest;
  }

  /** @param {number} v */
  atTarget(v) {
    return this.restIsHigh ? v <= this.target : v >= this.target;
  }

  /**
   * @abstract
   * @param {Pose} _pose
   * @param {Side} _side
   * @returns {Measurement}
   */
  measure(_pose, _side) {
    throw new Error(`${this.constructor.name} has no measure()`);
  }

  /**
   * @param {number} _rom
   * @param {number} _needed
   * @param {number} _duration
   * @param {readonly string[]} issues
   * @returns {number}
   */
  repScore(_rom, _needed, _duration, issues) {
    return Math.max(0, 100 - 20 * issues.length);
  }

  /**
   * A copy using other thresholds (Python's `dataclasses.replace(ex, rest=..., target=...)`).
   * `restIsHigh` is kept as is, like the Python.
   * @param {number} rest
   * @param {number} target
   * @returns {this}
   */
  withThresholds(rest, target) {
    const copy = Object.create(Object.getPrototypeOf(this));
    Object.assign(copy, this, { rest, target });
    return copy;
  }
}

/**
 * @param {Pose} pose
 * @param {Side} side
 * @param {readonly Joint[]} joints
 */
function points(pose, side, joints) {
  /** @type {Partial<Record<Joint, number[]>>} */
  const p = {};
  for (const j of joints) p[j] = pose.pt(side, j);
  return p;
}

export class Squat extends Exercise {
  measure(pose, side) {
    const p = points(pose, side, ["shoulder", "hip", "knee", "ankle", "heel", "toe"]);
    const knee = angle(p.hip, p.knee, p.ankle);
    const m = measurement(knee);
    if (knee < 140) {
      // only judge form once they are actually squatting
      if (angleFromVertical(p.hip, p.shoulder) > 45) m.issues.push("chest_up");
      const facing = p.toe[0] >= p.heel[0] ? 1.0 : -1.0;
      const shin = norm(sub(p.knee, p.ankle));
      if ((p.knee[0] - p.toe[0]) * facing > 0.35 * shin) m.issues.push("knees_past_toes");
    }
    return m;
  }
}

export class PushUp extends Exercise {
  measure(pose, side) {
    const p = points(pose, side, ["shoulder", "elbow", "wrist", "hip", "ankle"]);
    const elbow = angle(p.shoulder, p.elbow, p.wrist);
    const m = measurement(elbow);
    if (angleFromHorizontal(p.shoulder, p.ankle) > 50) {
      m.valid = false;
      m.issues.push("not_plank");
      return m;
    }
    if (angle(p.shoulder, p.hip, p.ankle) < 160) {
      const sh = p.shoulder;
      const an = p.ankle;
      const hip = p.hip;
      const dx = an[0] - sh[0];
      const t = Math.abs(dx) > 1e-6 ? (hip[0] - sh[0]) / dx : 0.5;
      const lineY = sh[1] + t * (an[1] - sh[1]);
      m.issues.push(hip[1] > lineY ? "hips_sag" : "hips_pike");
    }
    return m;
  }
}

export class BicepCurl extends Exercise {
  measure(pose, side) {
    const p = points(pose, side, ["shoulder", "elbow", "wrist", "hip"]);
    const elbow = angle(p.shoulder, p.elbow, p.wrist);
    const m = measurement(elbow);
    const lean = angleFromVertical(p.hip, p.shoulder);
    if (lean > 35) {
      m.valid = false; // bent over; this is not a standing curl
      return m;
    }
    if (angle(p.elbow, p.shoulder, p.hip) > 35) m.issues.push("elbow_drift");
    if (lean > 15) m.issues.push("swinging");
    return m;
  }
}

/** Front view, both arms. Rest = hands at shoulders, target = locked out overhead. */
export class ShoulderPress extends Exercise {
  measure(pose, _side) {
    const sides = ["left", "right"];
    const elbows = sides.map((s) => angle(pose.pt(s, "shoulder"), pose.pt(s, "elbow"), pose.pt(s, "wrist")));
    const m = measurement((elbows[0] + elbows[1]) / 2); // np.mean of two values
    const shL = pose.pt("left", "shoulder");
    const shR = pose.pt("right", "shoulder");
    const wrL = pose.pt("left", "wrist");
    const wrR = pose.pt("right", "wrist");
    const shoulderW = Math.max(norm(sub(shL, shR)), 1.0);
    const shoulderY = (shL[1] + shR[1]) / 2;
    // Arms hanging by the sides also give a straight elbow; require hands up.
    if (Math.max(wrL[1], wrR[1]) > shoulderY + 0.25 * shoulderW) {
      m.valid = false;
      m.issues.push("arms_down");
      return m;
    }
    if (Math.abs(wrL[1] - wrR[1]) > 0.3 * shoulderW) m.issues.push("uneven_press");
    return m;
  }
}

/** Shoulder->wrist vs straight down: 0 = arm hanging, 90 = shoulder height, 180 = overhead. */
export function armElevation(pose, s) {
  return 180.0 - angleFromVertical(pose.pt(s, "shoulder"), pose.pt(s, "wrist"));
}

export function elbowAngle(pose, s) {
  return angle(pose.pt(s, "shoulder"), pose.pt(s, "elbow"), pose.pt(s, "wrist"));
}

export function kneeAngle(pose, s) {
  return angle(pose.pt(s, "hip"), pose.pt(s, "knee"), pose.pt(s, "ankle"));
}

/** Torso vs thigh: ~180 standing tall, ~90 seated. */
export function hipAngle(pose, s) {
  return angle(pose.pt(s, "shoulder"), pose.pt(s, "hip"), pose.pt(s, "knee"));
}

/** Forearm vs hand: 180 = straight wrist, smaller when bent up or down. */
export function wristAngle(pose, s) {
  return angle(pose.pt(s, "elbow"), pose.pt(s, "wrist"), pose.pt(s, "index"));
}

/** Hip->shoulder vs vertical, seen from the side (forward or back). */
export function torsoLean(pose, s) {
  return angleFromVertical(pose.pt(s, "hip"), pose.pt(s, "shoulder"));
}

/** Other shoulder -> shoulder -> wrist: 180 = arm out wide, small = hand at the other shoulder. */
export function armAcross(pose, s) {
  const other = s === "left" ? "right" : "left";
  return angle(pose.pt(other, "shoulder"), pose.pt(s, "shoulder"), pose.pt(s, "wrist"));
}

function mid(pose, joint) {
  const l = pose.pt("left", joint);
  const r = pose.pt("right", joint);
  return l.map((v, i) => (v + r[i]) / 2);
}

/** Mid-hip -> mid-shoulder vs vertical, seen from the front. */
export function torsoSideTilt(pose, _s) {
  return angleFromVertical(mid(pose, "hip"), mid(pose, "shoulder"));
}

/** Shoulder line vs horizontal; works seated with the hips hidden by the desk. */
export function shoulderTilt(pose, _s) {
  return angleFromHorizontal(pose.pt("left", "shoulder"), pose.pt("right", "shoulder"));
}

/** Ear line vs horizontal (ear towards shoulder). */
export function headTilt(pose, _s) {
  return angleFromHorizontal(pose.pt("left", "ear"), pose.pt("right", "ear"));
}

/**
 * How far the nose moved off the centre of the ears, as an angle (0 = facing the camera).
 *
 * Always image-space: it measures the turn relative to the camera, and the
 * face points' depth from the model is too noisy to beat that.
 */
export function headTurn(pose, _s) {
  const el = pose.pt2d("left", "ear");
  const er = pose.pt2d("right", "ear");
  const nose = pose.pt2d("left", "nose");
  const half = Math.max(Math.abs(el[0] - er[0]) / 2, 1.0);
  const offset = Math.abs(nose[0] - (el[0] + er[0]) / 2);
  return degrees(Math.asin(Math.min(1.0, offset / half)));
}

/**
 * How far the nose sits below the line between the ears, as an angle (0 = level or above).
 *
 * Grows as the chin drops towards the chest. Image-space, like `headTurn`.
 */
export function headDrop(pose, _s) {
  const el = pose.pt2d("left", "ear");
  const er = pose.pt2d("right", "ear");
  const nose = pose.pt2d("left", "nose");
  const half = Math.max(Math.abs(el[0] - er[0]) / 2, 1.0);
  const drop = nose[1] - (el[1] + er[1]) / 2;
  return Math.max(0.0, degrees(Math.atan2(drop, half)));
}

/** Shoulder->ear vs straight up, seen from the side: grows as the head juts forward. */
export function headForward(pose, s) {
  return angleFromVertical(pose.pt(s, "shoulder"), pose.pt(s, "ear"));
}

/** Shoulder->ear vs horizontal, averaged over both sides: shrinks as the shoulders rise. */
export function earHeight(pose, _s) {
  const sides = ["left", "right"];
  return pySum(sides.map((s) => angleFromHorizontal(pose.pt(s, "shoulder"), pose.pt(s, "ear")))) / 2;
}

/** Average of left and right: both limbs move together. */
export function bothSides(fn) {
  return (pose) => (fn(pose, "left") + fn(pose, "right")) / 2;
}

/** Alternating limbs: whichever side moved further counts (`pick` is min or max). */
export function eitherSide(fn, pick) {
  return (pose) => pick(fn(pose, "left"), fn(pose, "right"));
}

// Python's min/max of two floats (Math.min/max agree for the finite values seen here).
const min2 = (a, b) => Math.min(a, b);
const max2 = (a, b) => Math.max(a, b);

/**
 * @param {number} rom
 * @param {number} needed
 * @param {number} duration
 */
export function officeRepScore(rom, needed, duration) {
  if (needed <= 0) return 0;
  const ratio = rom / needed;
  const depth =
    70 * Math.min(1.0, Math.max(0.0, (ratio - 0.4) / 0.6)) + 30 * Math.min(1.0, Math.max(0.0, (ratio - 1.0) / 0.3));
  const tempo = duration < 0.5 ? -30 : duration < 1.0 ? -15 : 0;
  return Math.trunc(Math.min(100, Math.max(0, pyRound(depth + tempo))));
}

/** Forgiving desk exercise: counts reps on one angle and never flags form faults. */
export class Gentle extends Exercise {
  /** @param {ExerciseInit & { angleFn: AngleFn }} init */
  constructor(init) {
    super({ ...init, minRepSeconds: init.minRepSeconds ?? 0.5 });
    this.angleFn = init.angleFn;
  }

  measure(pose, side) {
    return measurement(Number(this.angleFn(pose, side)));
  }

  repScore(rom, needed, duration, _issues) {
    return officeRepScore(rom, needed, duration);
  }
}

/**
 * Front-camera exercises need both sides visible; side-camera ones use the nearer side.
 * @param {string} key
 * @param {string} label
 * @param {string} metric
 * @param {AngleFn} fn
 * @param {number} rest
 * @param {number} target
 * @param {{ category: string, camera: Camera, joints: readonly Joint[], howTo: string, stance?: Stance }} opts
 * @returns {Gentle}
 */
function gentle(key, label, metric, fn, rest, target, { category, camera, joints, howTo, stance = "seated" }) {
  return new Gentle({
    key,
    label,
    metric,
    rest,
    target,
    restIsHigh: rest > target,
    bilateral: camera === "front",
    joints,
    camera,
    category,
    howTo,
    stance,
    angleFn: fn,
  });
}

// Pain areas, in the order the settings page lists them. Eyes is opt-in: the
// weekly featured area rotates over the others only.
const NECK = "Neck tension";
const ROUNDED = "Rounded shoulders";
const UPPER_BACK = "Upper back";
const ROTATOR = "Shoulder & rotator cuff";
const LOWER_BACK = "Lower back";
const WRIST_HAND = "Wrist & hand";
const KNEES = "Knees";
const EYES = "Eyes";
export const AREAS = [NECK, ROUNDED, UPPER_BACK, ROTATOR, LOWER_BACK, WRIST_HAND, KNEES, EYES];
/** @type {readonly Joint[]} */
const ARMS = ["shoulder", "elbow", "wrist"];
/** @type {readonly Joint[]} */
const LEGS = ["hip", "knee", "ankle"];
/** @type {readonly Joint[]} */
const HAND = ["elbow", "wrist", "index"];
/** @type {readonly Joint[]} */
const TORSO = ["shoulder", "hip"];

// Five per area. Thresholds are wide on purpose: rest and target sit well
// inside a comfortable range of motion, so a relaxed rep counts.
export const OFFICE_EXERCISES = [
  // Neck tension: stiff neck and headaches from looking down or pushing the head towards the screen.
  gentle("neck_tilt", "Neck side tilt", "Head tilt", headTilt, 8, 18, {
    category: NECK,
    camera: "front",
    joints: ["ear", "shoulder"],
    howTo: "Ear towards shoulder, back to centre, then the other side. Each side is a rep.",
  }),
  gentle("head_turn", "Look over your shoulder", "Head turn", headTurn, 15, 35, {
    category: NECK,
    camera: "front",
    joints: ["nose", "shoulder"],
    howTo: "Turn your head slowly to one side, back to centre, then the other side.",
  }),
  gentle("chin_to_chest", "Chin to chest", "Chin drop", headDrop, 25, 40, {
    category: NECK,
    camera: "front",
    joints: ["nose", "ear", "shoulder"],
    howTo: "Sit tall, slowly lower your chin towards your chest, then lift your head back up.",
  }),
  gentle("shoulder_shrug", "Shoulder shrugs", "Ear height", earHeight, 46, 39, {
    category: NECK,
    camera: "front",
    joints: ["ear", "shoulder"],
    howTo: "Lift both shoulders up towards your ears, hold for a moment, then let them drop.",
  }),
  gentle("chin_tuck", "Chin tuck", "Head forward", headForward, 16, 8, {
    category: NECK,
    camera: "side",
    joints: ["ear", "shoulder"],
    howTo: "Sit tall, let your head glide forward, then pull your chin straight back into a double chin.",
  }),
  // Rounded shoulders: open the chest and pull the shoulders back.
  gentle("cross_swing", "Arm open & cross", "Arm opening", bothSides(armAcross), 140, 75, {
    category: ROUNDED,
    camera: "front",
    joints: ARMS,
    howTo: "Open your arms wide, then hug them across your chest.",
  }),
  gentle("wy_raise", "W to Y raise", "Elbow angle", bothSides(elbowAngle), 110, 150, {
    category: ROUNDED,
    camera: "front",
    joints: ARMS,
    howTo: "Arms in a W with your shoulder blades squeezed, slide them up into a Y, then back to the W.",
  }),
  gentle("shoulder_roll", "Backward shoulder rolls", "Ear height", earHeight, 46, 39, {
    category: ROUNDED,
    camera: "front",
    joints: ["ear", "shoulder"],
    howTo: "Roll both shoulders up towards your ears, back, and down. Each roll is a rep.",
  }),
  gentle("thoracic_extension", "Chair-back extension", "Torso lean", torsoLean, 10, 20, {
    category: ROUNDED,
    camera: "side",
    joints: TORSO,
    howTo: "Hands behind your head, gently arch your upper back over the top of your chair, then sit tall.",
  }),
  gentle("clasp_opener", "Clasped-hands chest opener", "Arm lift", armElevation, 18, 32, {
    category: ROUNDED,
    camera: "side",
    joints: ARMS,
    stance: "standing",
    howTo: "Clasp your hands behind your back, squeeze your shoulder blades, lift your hands away, then lower.",
  }),
  // Upper back / rhomboids: a burning ache between the shoulder blades.
  gentle("seated_row", "Seated rows", "Elbow angle", elbowAngle, 150, 100, {
    category: UPPER_BACK,
    camera: "side",
    joints: ARMS,
    howTo: "Arms straight in front, pull the elbows back and squeeze the shoulder blades.",
  }),
  gentle("t_raise", "T-raise", "Arm height", bothSides(armElevation), 45, 75, {
    category: UPPER_BACK,
    camera: "front",
    joints: ARMS,
    howTo: "Lift both arms out to the sides to shoulder height, squeeze your shoulder blades, then lower.",
  }),
  gentle("desk_punch", "Desk punches", "Elbow angle", elbowAngle, 90, 150, {
    category: UPPER_BACK,
    camera: "side",
    joints: ARMS,
    howTo: "Fists by your chest, punch straight forward, then pull back.",
  }),
  gentle("rhomboid_stretch", "Upper back stretch", "Torso lean", torsoLean, 10, 20, {
    category: UPPER_BACK,
    camera: "side",
    joints: TORSO,
    howTo: "Clasp your hands in front, push them forward and round your upper back, then sit tall.",
  }),
  gentle("desk_row", "One-arm desk row", "Elbow angle", elbowAngle, 150, 100, {
    category: UPPER_BACK,
    camera: "side",
    joints: ARMS,
    stance: "standing",
    howTo: "Lean on the desk with your far hand, pull the other elbow back to your ribs, then lower it.",
  }),
  // Shoulder / rotator cuff: pain or clicking when lifting or rotating the arm.
  gentle("scaption", "Scaption raise", "Arm height", bothSides(armElevation), 45, 75, {
    category: ROTATOR,
    camera: "front",
    joints: ARMS,
    howTo: "Thumbs up, raise both straight arms slightly forward of your sides to shoulder height, then lower.",
  }),
  gentle("front_raise", "Front arm raise", "Arm height", armElevation, 40, 75, {
    category: ROTATOR,
    camera: "side",
    joints: ARMS,
    howTo: "Lift a straight arm forward to shoulder height, then lower it.",
  }),
  gentle("overhead_reach", "Overhead reach", "Arm height", bothSides(armElevation), 60, 135, {
    category: ROTATOR,
    camera: "front",
    joints: ARMS,
    howTo: "Reach both arms up towards the ceiling, then lower them.",
  }),
  gentle("external_rotation", "Elbows-in outward rotation", "Arm opening", bothSides(armAcross), 105, 120, {
    category: ROTATOR,
    camera: "front",
    joints: ARMS,
    howTo: "Elbows tucked at your sides and bent, rotate both hands out wide, then back in front of you.",
  }),
  gentle("cross_body_stretch", "Cross-body shoulder stretch", "Arm across", eitherSide(armAcross, min2), 70, 35, {
    category: ROTATOR,
    camera: "front",
    joints: ARMS,
    howTo: "Bring one arm across your chest, hug it in with the other hand, release, then switch arms.",
  }),
  // Lower back: stiffness at the base of the spine after long sitting.
  gentle("seated_side_bend", "Seated side bend", "Shoulder tilt", shoulderTilt, 7, 14, {
    category: LOWER_BACK,
    camera: "front",
    joints: ["shoulder"],
    howTo: "Sit tall, lean to one side, back to centre, then the other side.",
  }),
  gentle("knee_to_chest", "Seated knee hug", "Hip angle", eitherSide(hipAngle, min2), 80, 60, {
    category: LOWER_BACK,
    camera: "side",
    joints: ["shoulder", "hip", "knee"],
    howTo: "Sit tall, hug one knee up towards your chest, lower it, then switch legs.",
  }),
  gentle("hip_hinge", "Hip hinge", "Torso lean", torsoLean, 20, 45, {
    category: LOWER_BACK,
    camera: "side",
    joints: TORSO,
    stance: "standing",
    howTo: "Soft knees, push your hips back and tip your chest forward, then stand tall.",
  }),
  gentle("standing_side_bend", "Standing side bend", "Torso tilt", torsoSideTilt, 6, 15, {
    category: LOWER_BACK,
    camera: "front",
    joints: TORSO,
    stance: "standing",
    howTo: "Stand tall, slide one hand down your leg, back to centre, then the other side.",
  }),
  gentle("back_extension", "Standing back extension", "Torso lean", torsoLean, 6, 14, {
    category: LOWER_BACK,
    camera: "side",
    joints: TORSO,
    stance: "standing",
    howTo: "Stand tall with your hands on your lower back, gently lean back, then return.",
  }),
  // Wrist & hand: typing and mouse strain, tingling or numbness in the fingers.
  gentle("wrist_flex", "Wrist flex & extend", "Wrist angle", wristAngle, 160, 135, {
    category: WRIST_HAND,
    camera: "side",
    joints: HAND,
    howTo: "Arm out in front, bend the hand up or down, then straighten it.",
  }),
  gentle("extensor_stretch", "Wrist extensor stretch", "Wrist angle", wristAngle, 160, 130, {
    category: WRIST_HAND,
    camera: "side",
    joints: HAND,
    howTo: "Arm straight out, palm down. Gently bend the hand down with your other hand, then release.",
  }),
  gentle("flexor_stretch", "Wrist flexor stretch", "Wrist angle", wristAngle, 160, 130, {
    category: WRIST_HAND,
    camera: "side",
    joints: HAND,
    howTo: "Arm straight out, palm up. Gently pull your fingers back with your other hand, then release.",
  }),
  gentle("prayer_stretch", "Prayer stretch", "Wrist angle", bothSides(wristAngle), 145, 115, {
    category: WRIST_HAND,
    camera: "front",
    joints: HAND,
    howTo: "Palms together in front of your chest, lower your hands until the wrists stretch, then lift them.",
  }),
  gentle("nerve_glide", "Median nerve glide", "Elbow angle", bothSides(elbowAngle), 100, 150, {
    category: WRIST_HAND,
    camera: "front",
    joints: ARMS,
    howTo: "Hands by your shoulders, palms up. Straighten both arms out to the sides, palms out, then bend back.",
  }),
  // Knees: stiff or aching knees from sitting with the legs bent for hours.
  gentle("seated_knee_ext", "Seated leg extension", "Knee angle", eitherSide(kneeAngle, max2), 110, 150, {
    category: KNEES,
    camera: "side",
    joints: LEGS,
    howTo: "Sit tall, straighten one leg out in front, lower it, then switch.",
  }),
  gentle("heel_slide", "Seated heel slide", "Knee angle", eitherSide(kneeAngle, min2), 85, 65, {
    category: KNEES,
    camera: "side",
    joints: LEGS,
    howTo: "Feet flat, slide one foot back under your chair to bend the knee, slide it forward, then switch.",
  }),
  gentle("sit_to_stand", "Sit to stand", "Knee angle", kneeAngle, 155, 110, {
    category: KNEES,
    camera: "side",
    joints: LEGS,
    stance: "standing",
    howTo: "Stand up from your chair and sit back down without using your hands.",
  }),
  gentle("mini_squat", "Mini squat", "Knee angle", kneeAngle, 160, 135, {
    category: KNEES,
    camera: "side",
    joints: LEGS,
    stance: "standing",
    howTo: "Hold the desk if you like and bend the knees a little, then stand tall.",
  }),
  gentle("hamstring_curl", "Standing hamstring curl", "Knee angle", eitherSide(kneeAngle, min2), 155, 110, {
    category: KNEES,
    camera: "side",
    joints: LEGS,
    stance: "standing",
    howTo: "Hold the desk, bring one heel towards your seat, lower it, then switch legs.",
  }),
  // Eyes: the camera can't see where you look, so each move counts the hand
  // or head movement that goes with it.
  gentle("palming", "Palming", "Hand height", bothSides(armElevation), 60, 120, {
    category: EYES,
    camera: "front",
    joints: ARMS,
    howTo: "Rub your palms warm, cup them over your closed eyes for a slow breath, then lower your hands.",
  }),
  gentle("temple_massage", "Temple massage", "Hand height", bothSides(armElevation), 60, 120, {
    category: EYES,
    camera: "front",
    joints: ARMS,
    howTo: "Close your eyes, rub small slow circles on your temples with your fingertips, then lower your hands.",
  }),
  gentle("look_far", "Look into the distance", "Head turn", headTurn, 15, 35, {
    category: EYES,
    camera: "front",
    joints: ["nose", "shoulder"],
    howTo: "Turn to something far away, like a window, focus on it for a slow breath, then turn back.",
  }),
  gentle("near_far_focus", "Near-far focus", "Elbow angle", elbowAngle, 145, 90, {
    category: EYES,
    camera: "side",
    joints: ARMS,
    howTo: "Thumb up at arm's length, keep it sharp as you bring it slowly to your nose, then push it back out.",
  }),
  gentle("eye_track_vertical", "Thumb tracking", "Arm height", armElevation, 50, 110, {
    category: EYES,
    camera: "side",
    joints: ARMS,
    howTo: "Head still, follow your thumb with your eyes as you raise a straight arm up high, then lower it.",
  }),
];

/**
 * @template {Exercise} E
 * @param {readonly E[]} list
 * @returns {Readonly<Record<string, E>>}
 */
function byKey(list) {
  /** @type {Record<string, E>} */
  const out = {};
  for (const e of list) out[e.key] = e;
  return out;
}

/** Every exercise the Session accepts: the Workout set plus the office set. */
export const EXERCISES = byKey([
  new Squat({
    key: "squat",
    label: "Squat",
    metric: "Knee angle",
    rest: 160,
    target: 100,
    joints: ["shoulder", "hip", "knee", "ankle"],
    howTo: "Feet shoulder-width apart, sit back until your thighs are near parallel.",
  }),
  new PushUp({
    key: "pushup",
    label: "Push-up",
    metric: "Elbow angle",
    rest: 150,
    target: 95,
    joints: ["shoulder", "elbow", "wrist", "hip", "ankle"],
    howTo: "Body in a straight line, lower your chest until the elbows reach about 90°.",
  }),
  new BicepCurl({
    key: "curl",
    label: "Bicep curl",
    metric: "Elbow angle",
    rest: 145,
    target: 55,
    joints: ["shoulder", "elbow", "wrist", "hip"],
    howTo: "Elbow pinned to your side, curl the hand up to your shoulder.",
  }),
  new ShoulderPress({
    key: "press",
    label: "Shoulder press",
    metric: "Avg elbow angle",
    rest: 110,
    target: 155,
    restIsHigh: false,
    bilateral: true,
    joints: ["shoulder", "elbow", "wrist"],
    camera: "front",
    howTo: "Hands at shoulder height, press both arms straight overhead.",
  }),
  ...OFFICE_EXERCISES,
]);

/**
 * What the app offers: the office (workplace) set only. The Workout exercises
 * above stay defined and tested, but are not offered to users.
 */
export const CATALOG = byKey(OFFICE_EXERCISES);

export const DEFAULT_EXERCISE = OFFICE_EXERCISES[0].key;
