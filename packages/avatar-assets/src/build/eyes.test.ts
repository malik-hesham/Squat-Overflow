import { describe, expect, it } from 'vitest';
import { eyeCentres, type SkinnedMesh } from './eyes.ts';

/** A cube of `size` around `centre`, as 8 corners. */
function cube(centre: readonly number[], size: number): number[] {
  const out: number[] = [];
  for (const dx of [-1, 1])
    for (const dy of [-1, 1])
      for (const dz of [-1, 1]) {
        out.push(
          (centre[0] ?? 0) + (dx * size) / 2,
          (centre[1] ?? 0) + (dy * size) / 2,
          (centre[2] ?? 0) + (dz * size) / 2
        );
      }
  return out;
}

/** Column-major 4×4: scale by s, then move by t. */
const scaleMove = (s: number, t: readonly number[]) => [
  s,
  0,
  0,
  0,
  0,
  s,
  0,
  0,
  0,
  0,
  s,
  0,
  t[0] ?? 0,
  t[1] ?? 0,
  t[2] ?? 0,
  1,
];
const IDENTITY = scaleMove(1, [0, 0, 0]);

describe('eyeCentres', () => {
  it('finds the centre of each eyeball, the avatar’s left eye on the +X side', () => {
    const positions = [...cube([0.03, 1.69, 0.137], 0.024), ...cube([-0.03, 1.69, 0.137], 0.024)];
    const mesh: SkinnedMesh = {
      positions,
      joints: positions.flatMap((_, i) => (i % 3 === 0 ? [0, 0, 0, 0] : [])),
      weights: positions.flatMap((_, i) => (i % 3 === 0 ? [1, 0, 0, 0] : [])),
      jointWorlds: [IDENTITY],
      inverseBinds: [IDENTITY],
    };

    const eyes = eyeCentres(mesh);

    expect(eyes.left[0]).toBeCloseTo(0.03, 9);
    expect(eyes.right[0]).toBeCloseTo(-0.03, 9);
    for (const eye of [eyes.left, eyes.right]) {
      expect(eye[1]).toBeCloseTo(1.69, 9);
      expect(eye[2]).toBeCloseTo(0.137, 9);
    }
  });

  it('puts stored (quantized) positions back where the skin draws them, joint weights included', () => {
    // Stored as offsets in a unit box; joint world × inverse bind maps them back, as a
    // quantized, skinned glTF does. Two joints share each vertex half and half.
    const s = 0.5;
    const t = [0, 1.69, 0.137];
    const actual = [...cube([0.03, 1.69, 0.137], 0.024), ...cube([-0.03, 1.69, 0.137], 0.024)];
    const stored = actual.map((v, i) => (v - (t[i % 3] ?? 0)) / s);
    const mesh: SkinnedMesh = {
      positions: stored,
      joints: stored.flatMap((_, i) => (i % 3 === 0 ? [0, 1, 0, 0] : [])),
      weights: stored.flatMap((_, i) => (i % 3 === 0 ? [0.5, 0.5, 0, 0] : [])),
      jointWorlds: [scaleMove(s, t), IDENTITY],
      inverseBinds: [IDENTITY, scaleMove(s, t)],
    };

    const eyes = eyeCentres(mesh);

    expect(eyes.left[0]).toBeCloseTo(0.03, 9);
    expect(eyes.left[1]).toBeCloseTo(1.69, 9);
    expect(eyes.right[2]).toBeCloseTo(0.137, 9);
  });

  it('refuses a mesh without vertices on both sides', () => {
    const one = cube([0.03, 1.69, 0.137], 0.024);
    expect(() =>
      eyeCentres({
        positions: one,
        joints: one.flatMap((_, i) => (i % 3 === 0 ? [0, 0, 0, 0] : [])),
        weights: one.flatMap((_, i) => (i % 3 === 0 ? [1, 0, 0, 0] : [])),
        jointWorlds: [IDENTITY],
        inverseBinds: [IDENTITY],
      })
    ).toThrow(/both eyes/);
  });
});
