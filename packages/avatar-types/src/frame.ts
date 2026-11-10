import type { AnimationSlot } from './assets.ts';
import type { ArkitBlendshape } from './blendshapes.ts';
import type { EyeRotation, HeadRotation } from './math.ts';
import type { VisemeId } from './visemes.ts';

export interface ClipWeight {
  readonly slot: AnimationSlot;
  /** 0 to 1. */
  readonly weight: number;
  /** Position in the clip, in ms. Core keeps clip time so every platform shows the same pose. */
  readonly timeMs: number;
}

/**
 * Everything a renderer needs to pose the avatar for one frame. avatar-core computes it; renderers
 * only apply it, which is why every client moves the same way.
 */
export interface AvatarFrame {
  /** ARKit face shapes, 0 to 1. A missing shape is 0. */
  readonly blendshapes: Readonly<Partial<Record<ArkitBlendshape, number>>>;
  /** Mouth shapes, 0 to 1. A missing viseme is 0. */
  readonly visemes: Readonly<Partial<Record<VisemeId, number>>>;
  readonly head: HeadRotation;
  readonly neck: HeadRotation;
  readonly eyes: { readonly left: EyeRotation; readonly right: EyeRotation };
  /** Breathing: 0 is fully out, 1 fully in. */
  readonly breath: number;
  /** Clips to blend, in no particular order. */
  readonly clips: readonly ClipWeight[];
}

/** What a renderer pulls a frame from, once per rendered frame (avatar-core's controller). */
export interface AvatarFrameSource {
  frame(): AvatarFrame;
}
