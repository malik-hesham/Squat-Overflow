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
  INITIAL_STATE,
  transition,
  visibleState,
  type Activity,
  type MachineInput,
  type MachineState,
  type Transition,
} from './state-machine.ts';
