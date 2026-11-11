// Reads a skinned mesh's raw data out of a glTF document, for src/build/eyes.ts. Used by the build
// (scripts/build-profiles.mts) and by the tests on the shipped files.
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import type { SkinnedMesh } from '../src/build/eyes.ts';

/** Reads a GLB, meshopt-compressed or not. */
export async function readGlb(bytes: Uint8Array): Promise<Document> {
  await MeshoptDecoder.ready;
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
    .readBinary(bytes);
}

/** The node `name`'s mesh (its first primitive) with its skin. */
export function readSkinnedMesh(doc: Document, name: string): SkinnedMesh {
  const node = doc
    .getRoot()
    .listNodes()
    .find((n) => n.getName() === name);
  const primitive = node?.getMesh()?.listPrimitives()[0];
  const skin = node?.getSkin();
  const positions = primitive?.getAttribute('POSITION');
  const joints = primitive?.getAttribute('JOINTS_0');
  const weights = primitive?.getAttribute('WEIGHTS_0');
  const inverseBinds = skin?.getInverseBindMatrices();
  if (!node || !skin || !positions || !joints || !weights || !inverseBinds) {
    throw new Error(`${name}: no skinned mesh with positions, joints and weights`);
  }
  const all = (accessor: typeof positions) => {
    const out: number[] = [];
    const element: number[] = [];
    for (let i = 0; i < accessor.getCount(); i++) out.push(...accessor.getElement(i, element));
    return out;
  };
  return {
    positions: all(positions),
    joints: all(joints),
    weights: all(weights),
    jointWorlds: skin.listJoints().map((joint) => joint.getWorldMatrix()),
    inverseBinds: skin.listJoints().map((_, j) => inverseBinds.getElement(j, [])),
  };
}
