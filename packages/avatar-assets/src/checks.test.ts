import {
  ARKIT_BLENDSHAPES,
  VISEMES,
  type ArkitBlendshape,
  type AvatarAssetManifest,
  type VisemeId,
} from '@squat-overflow/avatar-types';
import { describe, expect, it } from 'vitest';
import { checkModel, checkProfilesMatch } from './checks.ts';
import type { ModelSummary } from './summary.ts';

const arkit = Object.fromEntries(ARKIT_BLENDSHAPES.map((n) => [n, n])) as Record<
  ArkitBlendshape,
  string
>;
const visemes = Object.fromEntries(VISEMES.map((v) => [v, `viseme_${v}`])) as Record<
  VisemeId,
  string
>;

const MANIFEST: AvatarAssetManifest = {
  id: 'test-human',
  name: 'Test human',
  licenses: [{ spdx: 'CC0-1.0', source: 'https://example.test/assets' }],
  profiles: {
    high: { uri: 'high.glb', bytes: 10, sha256: 'aa', triangles: 1000 },
    optimized: { uri: 'optimized.glb', bytes: 5, sha256: 'bb', triangles: 400 },
  },
  morphTargets: { arkit, visemes },
  eyes: { left: [0.03, 1.69, 0.137], right: [-0.03, 1.69, 0.137] },
  skeleton: { hips: 'pelvis', spine: 'spine_01', chest: 'spine_03', neck: 'neck_01', head: 'head' },
  animations: { idle: { clip: 'Idle', durationMs: 4000, loop: true } },
};

const GOOD: ModelSummary = {
  bones: ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head'],
  morphTargets: { Body: [...ARKIT_BLENDSHAPES, ...Object.values(visemes)], Teeth: ['jawOpen'] },
  triangles: 1000,
  animations: ['Idle'],
};

describe('checkModel', () => {
  it('passes a model that has everything its manifest maps', () => {
    expect(checkModel(MANIFEST, 'high', GOOD)).toEqual([]);
  });

  it('names each missing morph target, bone and clip, and a wrong triangle count', () => {
    const broken: ModelSummary = {
      bones: GOOD.bones.filter((b) => b !== 'neck_01'),
      morphTargets: {
        Body:
          GOOD.morphTargets['Body']?.filter((n) => n !== 'tongueOut' && n !== 'viseme_PP') ?? [],
      },
      triangles: 999,
      animations: [],
    };

    expect(checkModel(MANIFEST, 'high', broken)).toEqual([
      'high: ARKit shape tongueOut maps to morph target "tongueOut", which no mesh has',
      'high: viseme PP maps to morph target "viseme_PP", which no mesh has',
      'high: bone neck maps to "neck_01", which the skeleton does not have',
      'high: clip idle maps to "Idle", which the model does not have',
      'high: has 999 triangles, the manifest says 1000',
    ]);
  });
});

describe('checkProfilesMatch', () => {
  it('passes two profiles with the same bones and morph targets', () => {
    const optimized = {
      ...GOOD,
      triangles: 400,
      morphTargets: { Body: [...(GOOD.morphTargets['Body'] ?? [])] },
    };

    expect(checkProfilesMatch(GOOD, optimized)).toEqual([]);
  });

  it('names what only one profile has', () => {
    const optimized: ModelSummary = {
      ...GOOD,
      bones: [...GOOD.bones, 'jaw'],
      morphTargets: { Body: GOOD.morphTargets['Body']?.filter((n) => n !== 'cheekPuff') ?? [] },
    };

    expect(checkProfilesMatch(GOOD, optimized)).toEqual([
      'bones only in optimized: jaw',
      'morph targets only in high: cheekPuff',
    ]);
  });
});
