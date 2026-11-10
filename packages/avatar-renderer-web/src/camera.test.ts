import type { AvatarAssetManifest } from '@squat-overflow/avatar-types';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FIELD_OF_VIEW, frameCamera } from './camera.ts';
import type { LoadedAvatarModel } from './loader.ts';

const EYES = { left: [0.03, 1.69, 0.137], right: [-0.03, 1.69, 0.137] } as const;

/** A 1.8 m box standing on the floor, with a head bone at 1.6 m. */
function model(): LoadedAvatarModel {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.3));
  body.position.y = 0.9;
  const head = new THREE.Object3D();
  head.name = 'head';
  head.position.y = 1.6;
  root.add(body, head);
  return {
    root,
    clips: [],
    manifest: { skeleton: { head: 'head' }, eyes: EYES } as unknown as AvatarAssetManifest,
    dispose: () => undefined,
  };
}

describe('frameCamera', () => {
  it('portrait: puts the camera at eye height in front of the face, so looking ahead is eye contact', () => {
    const camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW.portrait, 0.75);

    frameCamera(camera, model(), 'portrait');
    camera.updateMatrixWorld();

    expect(camera.position.y).toBeCloseTo(EYES.left[1], 6);
    expect(camera.position.x).toBeCloseTo(0, 6);
    expect(camera.position.z).toBeGreaterThan(0.8);
    // Still aimed at the head and shoulders: the head bone is in the middle of the picture.
    const centre = new THREE.Vector3(0, 1.63, 0).project(camera);
    expect(Math.abs(centre.x)).toBeLessThan(0.01);
    expect(Math.abs(centre.y)).toBeLessThan(0.01);
  });

  it('full: frames the whole body from in front', () => {
    const camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW.full, 0.75);

    frameCamera(camera, model(), 'full');
    camera.updateMatrixWorld();

    for (const y of [0, 1.8]) {
      const point = new THREE.Vector3(0, y, 0).project(camera);
      expect(Math.abs(point.y)).toBeLessThan(1);
    }
  });
});
