// Does a model file deliver what its manifest promises? Each problem is one readable line.
import type { AvatarAssetManifest, QualityProfile } from '@squat-overflow/avatar-types';
import type { ModelSummary } from './summary.ts';

/** Checks one profile's file (summarized) against the manifest. Empty when it's all there. */
export function checkModel(
  manifest: AvatarAssetManifest,
  profile: QualityProfile,
  model: ModelSummary
): string[] {
  const problems: string[] = [];
  const targets = new Set(Object.values(model.morphTargets).flat());
  const bones = new Set(model.bones);
  const clips = new Set(model.animations);
  const { morphTargets } = manifest;

  for (const [shape, target] of Object.entries(morphTargets.arkit)) {
    if (!targets.has(target)) {
      problems.push(
        `${profile}: ARKit shape ${shape} maps to morph target "${target}", which no mesh has`
      );
    }
  }
  if ('visemes' in morphTargets) {
    for (const [viseme, target] of Object.entries(morphTargets.visemes)) {
      if (!targets.has(target)) {
        problems.push(
          `${profile}: viseme ${viseme} maps to morph target "${target}", which no mesh has`
        );
      }
    }
  }
  for (const [bone, name] of Object.entries(manifest.skeleton)) {
    if (!bones.has(name)) {
      problems.push(`${profile}: bone ${bone} maps to "${name}", which the skeleton does not have`);
    }
  }
  for (const [slot, ref] of Object.entries(manifest.animations)) {
    if (ref.file === undefined && !clips.has(ref.clip)) {
      problems.push(
        `${profile}: clip ${slot} maps to "${ref.clip}", which the model does not have`
      );
    }
  }
  const expected = manifest.profiles[profile].triangles;
  if (model.triangles !== expected) {
    problems.push(`${profile}: has ${model.triangles} triangles, the manifest says ${expected}`);
  }
  return problems;
}

/** Both profiles must be the same rig and face, so one animation and one frame drive either. */
export function checkProfilesMatch(high: ModelSummary, optimized: ModelSummary): string[] {
  const problems: string[] = [];
  const compare = (what: string, a: readonly string[], b: readonly string[]) => {
    const inA = new Set(a);
    const inB = new Set(b);
    const onlyA = [...inA].filter((x) => !inB.has(x));
    const onlyB = [...inB].filter((x) => !inA.has(x));
    if (onlyA.length) problems.push(`${what} only in high: ${onlyA.join(', ')}`);
    if (onlyB.length) problems.push(`${what} only in optimized: ${onlyB.join(', ')}`);
  };
  compare('bones', high.bones, optimized.bones);
  compare(
    'morph targets',
    Object.values(high.morphTargets).flat(),
    Object.values(optimized.morphTargets).flat()
  );
  return problems;
}
