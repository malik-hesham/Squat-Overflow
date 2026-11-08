/** alignWorldY against pose_engine.align_world_y (fixtures/align_world_y.json). */

import { alignWorldY } from '../world';
import { diff, loadFixture } from './helpers';

interface AlignCase {
  landmarks: number[][];
  world: number[][];
  expected: number[][];
}

const cases = loadFixture<AlignCase[]>('align_world_y.json');

it(`alignWorldY matches Python on ${cases.length} cases`, () => {
  const bad = cases
    .map((c, i) => [i, diff(alignWorldY(c.landmarks, c.world), c.expected, 0)] as const)
    .filter(([, d]) => d.length > 0);
  expect(bad).toEqual([]);
});

it('flips world y when it runs against image y, and leaves it alone otherwise', () => {
  const img = [0.1, 0.5, 0.9].map((y) => [0.5, y, 1.0]);
  const down = [
    [0.0, -0.5, 0.0],
    [0.0, 0.0, 0.0],
    [0.0, 0.5, 0.1],
  ];
  const up = down.map(([x, y, z]) => [x, -y, z]);
  expect(alignWorldY(img, down)).toBe(down); // same array back: nothing to do
  expect(diff(alignWorldY(img, up), down, 0)).toEqual([]);
  // A flat image or a flat world gives no direction to compare: unchanged.
  expect(alignWorldY(img.map(([x, , v]) => [x, 0.5, v]), up)).toBe(up);
});
