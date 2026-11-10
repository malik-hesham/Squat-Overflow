// GLBLoader: loads a model file for the web renderer.
import type { AvatarAssetManifest } from '@squat-overflow/avatar-types';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export interface LoadedAvatarModel {
  readonly root: THREE.Group;
  readonly clips: readonly THREE.AnimationClip[];
  readonly manifest: AvatarAssetManifest;
  /** Frees the model's geometries, materials and textures. */
  dispose(): void;
}

/**
 * Loads a profile's GLB. Its geometry is meshopt-compressed; the decoder is WebAssembly run on the
 * main thread (no worker), which the extension's CSP allows ('wasm-unsafe-eval').
 */
export async function loadAvatarModel(
  url: string,
  manifest: AvatarAssetManifest
): Promise<LoadedAvatarModel> {
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
  gltf.scene.traverse((object) => {
    if (!isMesh(object)) return;
    const mesh = object;
    // Skinned bounds are the bind pose; a moving arm can leave them and get culled.
    if ((mesh as Partial<THREE.SkinnedMesh>).isSkinnedMesh === true) mesh.frustumCulled = false;
    for (const material of materialsOf(mesh)) {
      // Cutouts (hair, brows, lashes, cornea): with MSAA this softens their hard alpha-test edges.
      if (material.alphaTest > 0) material.alphaToCoverage = true;
    }
  });
  return {
    root: gltf.scene,
    clips: gltf.animations,
    manifest,
    dispose: () => {
      disposeObject(gltf.scene);
    },
  };
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as Partial<THREE.Mesh>).isMesh === true;
}

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

/** Disposes every geometry, material and texture under `root`. */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!isMesh(object)) return;
    const mesh = object;
    mesh.geometry.dispose();
    for (const material of materialsOf(mesh)) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}
