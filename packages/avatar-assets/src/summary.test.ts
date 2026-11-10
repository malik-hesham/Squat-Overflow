import { describe, expect, it } from 'vitest';
import { summarizeGltf } from './summary.ts';

/** A cut-down glTF JSON: skinned body + teeth, two morph target sets, one clip. */
const GLTF = {
  asset: { version: '2.0' },
  nodes: [
    { name: 'pelvis' },
    { name: 'neck_01' },
    { name: 'head' },
    { name: 'Body' },
    { name: 'Teeth' },
  ],
  skins: [{ joints: [0, 1, 2] }, { joints: [2] }],
  accessors: [{ count: 100 }, { count: 300 }, { count: 36 }, { count: 9 }],
  meshes: [
    {
      name: 'Body',
      primitives: [{ attributes: { POSITION: 0 }, indices: 1, targets: [{}, {}] }],
      extras: { targetNames: ['jawOpen', 'viseme_aa'] },
    },
    {
      name: 'Teeth',
      primitives: [{ attributes: { POSITION: 2 }, targets: [{}] }],
      extras: { targetNames: ['jawOpen'] },
    },
    { name: 'Lines', primitives: [{ attributes: { POSITION: 3 }, mode: 1 }] },
  ],
  animations: [{ name: 'idle', channels: [] }],
};

describe('summarizeGltf', () => {
  it('lists the skin joints, morph targets per mesh, triangles and animations', () => {
    expect(summarizeGltf(GLTF)).toEqual({
      bones: ['pelvis', 'neck_01', 'head'],
      morphTargets: { Body: ['jawOpen', 'viseme_aa'], Teeth: ['jawOpen'], Lines: [] },
      triangles: 100 + 12, // 300 indices / 3, plus 36 unindexed vertices / 3; lines don't count
      animations: ['idle'],
    });
  });

  it('rejects data that is not glTF JSON', () => {
    expect(() => summarizeGltf([])).toThrow('glTF JSON must be an object');
  });
});
