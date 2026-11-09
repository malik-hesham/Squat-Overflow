/**
 * Every exercise's `measure()` on random and synthetic poses, both sides, 2D and
 * 3D, against Python (fixtures/measure.json). This reaches form-rule branches
 * the rep scenarios don't.
 */

import { EXERCISES } from '../../../../../extension/lib/pose/exercises.js';
import { Pose, type Side } from '../../../../../extension/lib/pose/geometry.js';
import { diff, loadFixture } from './helpers';

interface MeasureFixture {
  poses: { landmarks: number[][]; world: number[][]; width: number; height: number }[];
  /** results[pose][exercise] = [value, issues, valid] for left 2D, left 3D, right 2D, right 3D. */
  results: Record<string, [number, string[], boolean][]>[];
}

const fx = loadFixture<MeasureFixture>('measure.json');
const COMBOS: [Side, boolean][] = [
  ['left', false],
  ['left', true],
  ['right', false],
  ['right', true],
];

it.each(Object.keys(EXERCISES))('%s.measure matches Python on every pose', (key) => {
  const ex = EXERCISES[key];
  const mismatches: string[] = [];
  fx.poses.forEach((p, i) => {
    COMBOS.forEach(([side, useWorld], j) => {
      const m = ex.measure(new Pose(p.landmarks, p.width, p.height, p.world, useWorld), side);
      const [value, issues, valid] = fx.results[i][key][j];
      for (const d of diff([m.value, m.issues, m.valid], [value, issues, valid])) {
        mismatches.push(`pose ${i} ${side} ${useWorld ? '3d' : '2d'}: ${d}`);
      }
    });
  });
  expect(mismatches).toEqual([]);
});
