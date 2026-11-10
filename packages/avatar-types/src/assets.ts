import type { ArkitBlendshape } from './blendshapes.ts';
import type { VisemeId } from './visemes.ts';

/** HIGH: desktop. OPTIMIZED: extension and mobile. Both are the same person, rig and face shapes. */
export type QualityProfile = 'high' | 'optimized';

/** Bones the procedural layer moves (breathing, head, eyes). Mapped to the model's own names. */
export const HUMANOID_BONES = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'leftEye',
  'rightEye',
] as const;

export type HumanoidBone = (typeof HUMANOID_BONES)[number];

/**
 * Animation clips the state machine asks for, by role. A model must have `idle`; the others are
 * blended in when the model has them.
 */
export const ANIMATION_SLOTS = [
  'idle',
  'listening',
  'thinking',
  'talking',
  'nod',
  'react.happy',
  'react.sad',
  'react.surprised',
  'react.confused',
] as const;

export type AnimationSlot = (typeof ANIMATION_SLOTS)[number];

export interface AvatarModelFile {
  /** Relative to the manifest. */
  readonly uri: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly triangles: number;
}

export interface AnimationRef {
  /** Clip name in the model (or in `file`). */
  readonly clip: string;
  readonly durationMs: number;
  readonly loop: boolean;
  /** A separate animation file, relative to the manifest, when the clip isn't in the model. */
  readonly file?: string;
}

/** Where one source file of the model came from, and on what terms. */
export interface AssetLicense {
  /** SPDX licence id, e.g. CC0-1.0. */
  readonly spdx: string;
  readonly source: string;
  readonly attribution?: string;
}

/** How the model makes each viseme: its own morph targets, or a mix of its ARKit shapes. */
export type VisemeSource =
  | { readonly visemes: Readonly<Record<VisemeId, string>> }
  | {
      readonly visemeShapes: Readonly<
        Record<VisemeId, Readonly<Partial<Record<ArkitBlendshape, number>>>>
      >;
    };

/**
 * Describes one avatar identity and its two files. Canonical names (ARKit shapes, visemes, bones,
 * slots) map to the model's own names, so an export with other names drops in without code changes.
 * See docs/digital-human/assets.md.
 */
export interface AvatarAssetManifest {
  readonly id: string;
  readonly name: string;
  readonly licenses: readonly AssetLicense[];
  readonly profiles: Readonly<Record<QualityProfile, AvatarModelFile>>;
  readonly morphTargets: {
    readonly arkit: Readonly<Record<ArkitBlendshape, string>>;
  } & VisemeSource;
  /** Eye bones may be missing: the eyeLook* blendshapes then turn the eyes. */
  readonly skeleton: Readonly<
    Record<Exclude<HumanoidBone, 'leftEye' | 'rightEye'>, string> &
      Partial<Record<'leftEye' | 'rightEye', string>>
  >;
  readonly animations: Readonly<Partial<Record<AnimationSlot, AnimationRef>>> & {
    readonly idle: AnimationRef;
  };
}
