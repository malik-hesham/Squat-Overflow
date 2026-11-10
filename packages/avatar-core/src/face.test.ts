import {
  ARKIT_BLENDSHAPES,
  AVATAR_EXPRESSIONS,
  type ArkitBlendshape,
  type AvatarExpression,
} from '@squat-overflow/avatar-types';
import { describe, expect, it } from 'vitest';
import { EXPRESSION_SHAPES, FACE_SMOOTHING_MS, FacialController } from './face.ts';

/** Runs `ms` of frames `stepMs` apart and returns the last face. */
function run(
  face: FacialController,
  ms: number,
  expression: AvatarExpression,
  intensity = 1,
  stepMs = 1000 / 60
) {
  let out = face.update(0, { expression, intensity });
  for (let t = 0; t < ms - 1e-9; t += stepMs) {
    out = face.update(Math.min(stepMs, ms - t), { expression, intensity });
  }
  return out;
}

describe('EXPRESSION_SHAPES', () => {
  it('has a face for every expression; neutral is an empty face', () => {
    expect(Object.keys(EXPRESSION_SHAPES).sort()).toEqual([...AVATAR_EXPRESSIONS].sort());
    expect(EXPRESSION_SHAPES.neutral).toEqual({});
  });

  it('uses only ARKit shapes, with weights above 0 and at most 1', () => {
    const names: readonly string[] = ARKIT_BLENDSHAPES;
    for (const shapes of Object.values(EXPRESSION_SHAPES)) {
      for (const [shape, weight] of Object.entries(shapes)) {
        expect(names).toContain(shape);
        expect(weight).toBeGreaterThan(0);
        expect(weight).toBeLessThanOrEqual(1);
      }
    }
  });

  it.each([
    ['happy', ['mouthSmileLeft', 'mouthSmileRight', 'cheekSquintLeft', 'cheekSquintRight']],
    ['sad', ['browInnerUp', 'mouthFrownLeft', 'mouthFrownRight']],
    [
      'surprised',
      [
        'browInnerUp',
        'browOuterUpLeft',
        'browOuterUpRight',
        'eyeWideLeft',
        'eyeWideRight',
        'jawOpen',
      ],
    ],
    ['confused', ['browDownLeft', 'browOuterUpRight']],
    ['thinking', ['browDownLeft', 'browDownRight', 'mouthPressLeft', 'mouthPressRight']],
  ] as const)('%s uses its signature shapes', (expression, shapes: readonly ArkitBlendshape[]) => {
    for (const shape of shapes) expect(EXPRESSION_SHAPES[expression][shape]).toBeGreaterThan(0);
  });

  it('keeps happy, sad and surprised symmetric and confused lopsided', () => {
    for (const expression of ['happy', 'sad', 'surprised'] as const) {
      const shapes: Partial<Record<string, number>> = EXPRESSION_SHAPES[expression];
      for (const [shape, weight] of Object.entries(shapes)) {
        if (shape.endsWith('Left')) expect(shapes[shape.replace(/Left$/, 'Right')]).toBe(weight);
      }
    }
    const confused = EXPRESSION_SHAPES.confused;
    expect(confused.browDownLeft ?? 0).not.toBe(confused.browDownRight ?? 0);
  });
});

describe('FacialController', () => {
  it('shows an empty face while neutral', () => {
    expect(run(new FacialController(), 1000, 'neutral')).toEqual({});
  });

  it('blends towards an expression with a time constant of FACE_SMOOTHING_MS, then holds it exactly', () => {
    const face = new FacialController();

    const partly = run(face, FACE_SMOOTHING_MS, 'happy');
    for (const [shape, weight] of Object.entries(EXPRESSION_SHAPES.happy)) {
      expect(partly[shape as ArkitBlendshape]).toBeCloseTo(weight * (1 - Math.exp(-1)), 6);
    }

    expect(run(face, 20 * FACE_SMOOTHING_MS, 'happy')).toEqual(EXPRESSION_SHAPES.happy);
  });

  it('scales the expression by its intensity', () => {
    const settled = run(new FacialController(), 20 * FACE_SMOOTHING_MS, 'sad', 0.5);

    for (const [shape, weight] of Object.entries(EXPRESSION_SHAPES.sad)) {
      expect(settled[shape as ArkitBlendshape]).toBeCloseTo(weight / 2, 9);
    }
  });

  it('looks the same at 30 and 60 frames per second', () => {
    const at60 = run(new FacialController(), 500, 'surprised', 1, 1000 / 60);
    const at30 = run(new FacialController(), 500, 'surprised', 1, 1000 / 30);

    for (const [shape, weight] of Object.entries(at60)) {
      expect(at30[shape as ArkitBlendshape]).toBeCloseTo(weight, 9);
    }
  });

  it('moves smoothly from one expression to the next and drops the old shapes once gone', () => {
    const face = new FacialController();
    let before = run(face, 200, 'happy');
    const step = 1000 / 60;
    // One frame may move a shape by at most the share of the way a frame covers.
    const most = 1 - Math.exp(-step / FACE_SMOOTHING_MS);

    for (let t = 0; t < 3000; t += step) {
      const now = face.update(step, { expression: 'sad', intensity: 1 });
      for (const shape of new Set([...Object.keys(before), ...Object.keys(now)])) {
        const a = before[shape as ArkitBlendshape] ?? 0;
        const b = now[shape as ArkitBlendshape] ?? 0;
        expect(Math.abs(b - a)).toBeLessThanOrEqual(most + 1e-9);
      }
      before = now;
    }

    expect(before).toEqual(EXPRESSION_SHAPES.sad);
  });
});
