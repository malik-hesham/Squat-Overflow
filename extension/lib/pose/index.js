/**
 * On-device pose analysis: rep counting, form scores and calibration. A behaviour-identical port of
 * the Python server's `analysis/` package, shared by every client that has a camera (the extension
 * here, mobile through `mobile/src/pose/analysis`). No network, no DOM: plain functions of landmarks.
 *
 * Typical use, once per camera frame:
 *
 *     const session = new Session(DEFAULT_EXERCISE);
 *     const world = rawWorld && alignWorldY(landmarks, rawWorld);
 *     const result = session.process(landmarks, width, height, seconds, world);
 *
 * `landmarks` = 33 x [x, y, visibility] normalised; `world` = 33 x [x, y, z] meters (or null).
 * `result` has the snake_case shape of the old pose server's `frame` message.
 */
export { Session, RepCounter, MIN_VISIBILITY, SIDE_SWITCH_MARGIN } from "./session.js";
export {
  AREAS,
  CATALOG,
  DEFAULT_EXERCISE,
  EXERCISES,
  Exercise,
  Gentle,
  ISSUE_TEXT,
  OFFICE_EXERCISES,
  officeRepScore,
} from "./exercises.js";
export { CONNECTIONS, JOINTS, Pose, angle, angleFromHorizontal, angleFromVertical } from "./geometry.js";
export { Calibrator, validate as validateCalibration } from "./calibration.js";
export { DEMOS, MAX_DEMO_SECONDS, demoToJson } from "./demos.js";
export { exerciseCatalog } from "./catalog.js";
export { alignWorldY } from "./world.js";

/** @typedef {import("./session.js").FrameResult} FrameResult */
/** @typedef {import("./session.js").Feedback} Feedback */
/** @typedef {import("./session.js").Rep} Rep */
/** @typedef {import("./session.js").RepEvent} RepEvent */
/** @typedef {import("./session.js").Stage} Stage */
/** @typedef {import("./session.js").Summary} Summary */
/** @typedef {import("./session.js").ThresholdsInfo} ThresholdsInfo */
/** @typedef {import("./session.js").TopIssue} TopIssue */
/** @typedef {import("./exercises.js").AngleFn} AngleFn */
/** @typedef {import("./exercises.js").Camera} Camera */
/** @typedef {import("./exercises.js").ExerciseInit} ExerciseInit */
/** @typedef {import("./exercises.js").IssueCode} IssueCode */
/** @typedef {import("./exercises.js").Measurement} Measurement */
/** @typedef {import("./exercises.js").Stance} Stance */
/** @typedef {import("./geometry.js").Joint} Joint */
/** @typedef {import("./geometry.js").Landmark} Landmark */
/** @typedef {import("./geometry.js").Side} Side */
/** @typedef {import("./geometry.js").Vec} Vec */
/** @typedef {import("./geometry.js").WorldLandmark} WorldLandmark */
/** @typedef {import("./calibration.js").CalibrationDone} CalibrationDone */
/** @typedef {import("./calibration.js").CalibrationRecording} CalibrationRecording */
/** @typedef {import("./calibration.js").CalibrationStatus} CalibrationStatus */
/** @typedef {import("./calibration.js").Thresholds} Thresholds */
/** @typedef {import("./demos.js").DemoVideo} DemoVideo */
/** @typedef {import("./demos.js").DemoVideoJson} DemoVideoJson */
/** @typedef {import("./catalog.js").CatalogEntry} CatalogEntry */
