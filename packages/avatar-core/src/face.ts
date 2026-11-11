// FacialController: the face the avatar wears (expressions as ARKit shapes), blended smoothly. Which
// expression wins is the controller's rule (docs/digital-human/architecture.md, section 4); this
// layer only moves the face towards it.
import type { ArkitBlendshape, AvatarExpression } from '@squat-overflow/avatar-types';
import { approach } from './smoothing.ts';

export type FaceShapes = Readonly<Partial<Record<ArkitBlendshape, number>>>;

/**
 * Each expression as ARKit shapes, after the facial action units that make it (FACS): happy is a
 * cheek raise and lip-corner pull, sad an inner-brow raise with lip corners down, surprised raised
 * brows, wide eyes and a dropped jaw, confused one brow down and the other up, thinking lowered
 * brows and pressed lips. Gaze is the eye layer's job, so no eyeLook shapes here.
 */
export const EXPRESSION_SHAPES: Readonly<Record<AvatarExpression, FaceShapes>> = {
  neutral: {},
  happy: {
    mouthSmileLeft: 0.85,
    mouthSmileRight: 0.85,
    cheekSquintLeft: 0.55,
    cheekSquintRight: 0.55,
    eyeSquintLeft: 0.3,
    eyeSquintRight: 0.3,
  },
  sad: {
    browInnerUp: 0.7,
    browDownLeft: 0.2,
    browDownRight: 0.2,
    mouthFrownLeft: 0.5,
    mouthFrownRight: 0.5,
    mouthShrugLower: 0.3,
  },
  surprised: {
    browInnerUp: 0.8,
    browOuterUpLeft: 0.7,
    browOuterUpRight: 0.7,
    eyeWideLeft: 0.6,
    eyeWideRight: 0.6,
    jawOpen: 0.25,
  },
  confused: {
    browDownLeft: 0.5,
    browOuterUpRight: 0.55,
    browInnerUp: 0.25,
    eyeSquintLeft: 0.3,
    mouthPressLeft: 0.3,
    mouthLeft: 0.15,
  },
  thinking: {
    browDownLeft: 0.3,
    browDownRight: 0.3,
    mouthPressLeft: 0.35,
    mouthPressRight: 0.35,
    mouthRollLower: 0.2,
    eyeSquintLeft: 0.15,
    eyeSquintRight: 0.15,
    mouthLeft: 0.12,
  },
};

/** Time constant of the face's blend: an expression is 95% there after three of these. */
export const FACE_SMOOTHING_MS = 120;

export interface FaceTarget {
  readonly expression: AvatarExpression;
  /** 0 to 1: scales the expression's shapes. */
  readonly intensity: number;
}

export class FacialController {
  readonly #weights = new Map<ArkitBlendshape, number>();

  /** Moves the face `dtMs` towards `target` and returns it (shapes at 0 are left out). */
  update(dtMs: number, { expression, intensity }: FaceTarget): FaceShapes {
    const goal = EXPRESSION_SHAPES[expression];
    const shapes = new Set([...this.#weights.keys(), ...(Object.keys(goal) as ArkitBlendshape[])]);
    for (const shape of shapes) {
      const next = approach(
        this.#weights.get(shape) ?? 0,
        (goal[shape] ?? 0) * intensity,
        dtMs,
        FACE_SMOOTHING_MS
      );
      if (next === 0) this.#weights.delete(shape);
      else this.#weights.set(shape, next);
    }
    return Object.fromEntries(this.#weights);
  }
}
