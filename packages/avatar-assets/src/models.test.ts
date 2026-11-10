/// <reference types="node" />
// The real model files in models/, against their generated manifest. Rebuild with
// scripts/blender/build_human.py + scripts/build-profiles.mts (see docs/digital-human/assets.md).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { QualityProfile } from '@squat-overflow/avatar-types';
import validator from 'gltf-validator';
import { describe, expect, it } from 'vitest';
import { materialSettings } from './build/materials.ts';
import { checkModel, checkProfilesMatch } from './checks.ts';
import { readGlbJson } from './glb.ts';
import { COACH_01 } from './models/coach-01.ts';
import { summarizeGltf } from './summary.ts';

const PROFILES: readonly QualityProfile[] = ['high', 'optimized'];
const bytesOf = (profile: QualityProfile) =>
  new Uint8Array(
    readFileSync(
      fileURLToPath(
        new URL(`../models/${COACH_01.id}/${COACH_01.profiles[profile].uri}`, import.meta.url)
      )
    )
  );
const jsonOf = (profile: QualityProfile) =>
  readGlbJson(bytesOf(profile), new TextDecoder()) as {
    materials: { name: string; alphaMode?: string; alphaCutoff?: number; doubleSided?: boolean }[];
  };

describe.each(PROFILES)('%s model file', (profile) => {
  it('is the file the manifest describes (size and SHA-256)', () => {
    const bytes = bytesOf(profile);

    expect(bytes.byteLength).toBe(COACH_01.profiles[profile].bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      COACH_01.profiles[profile].sha256
    );
  });

  it('is valid glTF 2.0 (no validator errors)', async () => {
    const report = await validator.validateBytes(bytesOf(profile), { maxIssues: 200 });

    expect(report.issues.messages.filter((m) => m.severity === 0)).toEqual([]);
  });

  it('has every ARKit shape, viseme, bone and clip the manifest maps, and its triangle count', () => {
    expect(checkModel(COACH_01, profile, summarizeGltf(jsonOf(profile)))).toEqual([]);
  });

  it('draws skin, eyes, teeth and clothes opaque, and hair, brows and lashes as cutouts', () => {
    for (const material of jsonOf(profile).materials) {
      const expected = materialSettings(material.name);
      expect({
        name: material.name,
        mode: material.alphaMode ?? 'OPAQUE',
        double: material.doubleSided ?? false,
      }).toEqual({
        name: material.name,
        mode: expected.alphaMode,
        double: expected.doubleSided,
      });
    }
  });
});

describe('the two profiles', () => {
  it('share one rig and one set of face shapes, so the same frame drives either', () => {
    expect(
      checkProfilesMatch(summarizeGltf(jsonOf('high')), summarizeGltf(jsonOf('optimized')))
    ).toEqual([]);
  });

  it('are the same person: OPTIMIZED has fewer triangles, not other parts', () => {
    const parts = (profile: QualityProfile) =>
      jsonOf(profile)
        .materials.map((m) => m.name)
        .sort();

    expect(parts('optimized')).toEqual(parts('high'));
    expect(COACH_01.profiles.optimized.triangles).toBeLessThan(COACH_01.profiles.high.triangles);
  });
});
