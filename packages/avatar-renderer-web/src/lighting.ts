// LightingController: the light rig every view of the avatar uses (vanilla and React).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/** Soft studio light: an environment for reflections, a warm key, a cool fill, a rim from behind. */
export function createLighting(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04).texture;
  room.dispose(); // its boxes are only needed to bake the environment map
  scene.environment = environment;
  scene.environmentIntensity = 0.7;
  const lights: [THREE.DirectionalLight, [number, number, number]][] = [
    [new THREE.DirectionalLight(0xfff1e6, 1.6), [1.5, 2.5, 3]], // key, front right
    [new THREE.DirectionalLight(0xdfe8ff, 0.45), [-2.5, 1.5, 2]], // fill, front left
    [new THREE.DirectionalLight(0xffffff, 0.8), [0, 2.5, -3]], // rim, behind
  ];
  for (const [light, [x, y, z]] of lights) {
    light.position.set(x, y, z);
    scene.add(light);
  }
  return {
    dispose() {
      for (const [light] of lights) {
        scene.remove(light);
        light.dispose();
      }
      environment.dispose();
      pmrem.dispose();
    },
  };
}
