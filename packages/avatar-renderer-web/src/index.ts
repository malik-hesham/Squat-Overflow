// The web renderer (browser extension pages, desktop webviews). See docs/digital-human/architecture.md.
export { disposeObject, loadAvatarModel, type LoadedAvatarModel } from './loader.ts';
export {
  BREATH_PITCH_MAX,
  createAvatarRig,
  EYE_PITCH_MAX,
  EYE_YAW_MAX,
  type AvatarRig,
  type AvatarRigOptions,
} from './rig.ts';
export { FIELD_OF_VIEW, frameCamera, type Framing } from './camera.ts';
export { createLighting } from './lighting.ts';
export { createAvatarView, type AvatarView, type AvatarViewOptions } from './view.ts';
