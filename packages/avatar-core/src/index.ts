// The digital human's behaviour, shared by every client. See docs/digital-human/architecture.md.
export { AnimationManager, CLIP_FADE_MS, type AvatarClips, type ClipInfo } from './animation.ts';
export {
  DEFAULT_REACTION_MS,
  MAX_FRAME_STEP_MS,
  createAvatarController,
  type AvatarCoreOptions,
  type CoreAvatar,
} from './controller.ts';
export { AvatarEvents } from './events.ts';
export {
  BLINK_CLOSE_MS,
  BLINK_HOLD_WIDE,
  BLINK_INTERVAL_MS,
  BLINK_MS,
  BLINK_OPEN_MS,
  DOUBLE_BLINK_CHANCE,
  DOUBLE_BLINK_GAP_MS,
  EYES_ALONE,
  EYE_RANGE,
  EyeController,
  GAZE_STYLES,
  HEAD_FOLLOW_MS,
  HEAD_TURN_RANGE,
  NEAREST_FOCUS_M,
  SACCADE_MS,
  VIEWER_DISTANCE_M,
  type EyeInput,
  type EyeOutput,
  type GazeStyle,
} from './eyes.ts';
export {
  EXPRESSION_SHAPES,
  FACE_SMOOTHING_MS,
  FacialController,
  type FaceShapes,
  type FaceTarget,
} from './face.ts';
export {
  BREATH_IN,
  BREATH_MS,
  BREATH_VARIATION,
  DOUBLE_NOD_CHANCE,
  DRIFT,
  DRIFT_SCALE,
  DRIFT_SMOOTHING_MS,
  NECK_SHARE,
  NOD_INTERVAL_MS,
  NOD_MS,
  NOD_PITCH,
  POSTURES,
  POSTURE_SMOOTHING_MS,
  ProceduralAnimation,
  REACTION_POSTURES,
  type BodyInput,
  type BodyOutput,
  type Posture,
} from './procedural.ts';
export {
  INITIAL_STATE,
  transition,
  visibleState,
  type Activity,
  type MachineInput,
  type MachineState,
  type Transition,
} from './state-machine.ts';
