/**
 * On-device pose analysis: a behaviour-identical TypeScript port of the Python
 * server's `analysis/` package (rep counting, form scores, calibration).
 *
 * Typical use, once per camera frame:
 *
 *     const session = new Session(DEFAULT_EXERCISE);
 *     const world = rawWorld && alignWorldY(landmarks, rawWorld);
 *     const result = session.process(landmarks, width, height, seconds, world);
 *
 * `landmarks` = 33 x [x, y, visibility] normalised; `world` = 33 x [x, y, z]
 * meters (or null). `result` has the same snake_case shape as the server's
 * `frame` message.
 */

export { Session, RepCounter, MIN_VISIBILITY, SIDE_SWITCH_MARGIN } from './session';
export type {
  FrameResult,
  Feedback,
  Rep,
  RepEvent,
  Stage,
  Summary,
  ThresholdsInfo,
  TopIssue,
} from './session';

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
} from './exercises';
export type { AngleFn, Camera, ExerciseInit, IssueCode, Measurement, Stance } from './exercises';

export { CONNECTIONS, JOINTS, Pose, angle, angleFromHorizontal, angleFromVertical } from './geometry';
export type { Joint, Landmark, Side, Vec, WorldLandmark } from './geometry';

export { Calibrator, validate as validateCalibration } from './calibration';
export type { CalibrationDone, CalibrationRecording, CalibrationStatus, Thresholds } from './calibration';

export { DEMOS, MAX_DEMO_SECONDS, demoToJson } from './demos';
export type { DemoVideo, DemoVideoJson } from './demos';

export { exerciseCatalog } from './catalog';
export type { CatalogEntry } from './catalog';

export { alignWorldY } from './world';
