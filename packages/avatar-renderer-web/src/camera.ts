// CameraController: frames the avatar the same way in every view (vanilla and React).
import * as THREE from 'three';
import type { LoadedAvatarModel } from './loader.ts';

/** portrait: head and shoulders (a side panel). full: the whole body. */
export type Framing = 'portrait' | 'full';

/** Vertical field of view per framing, in degrees: narrow for a portrait (less distortion). */
export const FIELD_OF_VIEW: Readonly<Record<Framing, number>> = { portrait: 22, full: 28 };

/**
 * Points the camera at the face (portrait) or the whole body (full), from the front (+Z). In a
 * portrait the camera is at the eyes' height (from the manifest), where avatar-core puts the user:
 * eyes looking straight ahead meet the camera.
 */
export function frameCamera(
  camera: THREE.PerspectiveCamera,
  model: LoadedAvatarModel,
  framing: Framing
) {
  model.root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model.root);
  const head = model.root.getObjectByName(model.manifest.skeleton.head);
  const target =
    framing === 'portrait' && head
      ? head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.03, 0))
      : box.getCenter(new THREE.Vector3());
  // Fit 0.42 m (head and shoulders) or the body's height plus a margin into the vertical field of view.
  const height = framing === 'portrait' ? 0.42 : (box.max.y - box.min.y) * 1.12;
  const distance = height / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.set(target.x, target.y, target.z + distance);
  if (framing === 'portrait') {
    const { left, right } = model.manifest.eyes;
    const eyes = new THREE.Vector3((left[0] + right[0]) / 2, (left[1] + right[1]) / 2, 0);
    camera.position.y = model.root.localToWorld(eyes).y;
  }
  camera.lookAt(target);
}
