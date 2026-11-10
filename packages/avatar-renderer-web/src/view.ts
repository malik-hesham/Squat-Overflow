// AvatarScene, CameraController and LightingController in one view: draws a loaded model into a
// canvas, posed each frame from an AvatarFrameSource (avatar-core's controller). No framework: the
// extension's pages are plain JavaScript; a React wrapper can sit on top of this.
import type { AvatarFrameSource } from '@squat-overflow/avatar-types';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { LoadedAvatarModel } from './loader.ts';
import { createAvatarRig } from './rig.ts';

/** portrait: head and shoulders (a side panel). full: the whole body. */
export type Framing = 'portrait' | 'full';

export interface AvatarViewOptions {
  readonly canvas: HTMLCanvasElement;
  readonly model: LoadedAvatarModel;
  readonly frames: AvatarFrameSource;
  readonly framing?: Framing;
  /** Caps the device pixel ratio; lower it on phones and low-end machines. Default 2. */
  readonly maxPixelRatio?: number;
}

export interface AvatarView {
  readonly renderer: THREE.WebGLRenderer;
  /** Starts drawing every animation frame. It pauses by itself while the page is hidden. */
  start(): void;
  stop(): void;
  /** Poses and draws one frame now. */
  renderOnce(): void;
  /** The canvas's new size in CSS pixels. */
  resize(width: number, height: number): void;
  /** Stops, and frees the model, the lights' environment map and the WebGL context. */
  dispose(): void;
}

export function createAvatarView(options: AvatarViewOptions): AvatarView {
  const { canvas, model, frames, framing = 'portrait', maxPixelRatio = 2 } = options;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, maxPixelRatio));

  const scene = new THREE.Scene();
  scene.add(model.root);
  const lighting = createLighting(renderer, scene);
  const rig = createAvatarRig({ root: model.root, clips: model.clips, manifest: model.manifest });

  const camera = new THREE.PerspectiveCamera(framing === 'portrait' ? 22 : 28, 1, 0.05, 50);
  const size = () => ({
    width: canvas.clientWidth || canvas.width,
    height: canvas.clientHeight || canvas.height,
  });
  rig.apply(frames.frame()); // pose once so the camera frames the avatar as it stands
  frameCamera(camera, model, framing);
  const resize = (width: number, height: number) => {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize(size().width, size().height);

  const renderOnce = () => {
    rig.apply(frames.frame());
    renderer.render(scene, camera);
  };

  let running = false;
  let handle = 0;
  const tick = () => {
    handle = requestAnimationFrame(tick);
    renderOnce();
  };
  const schedule = () => {
    cancelAnimationFrame(handle);
    if (running && !document.hidden) handle = requestAnimationFrame(tick);
  };
  // A hidden page (tab in the background, side panel closed) draws nothing.
  const onVisibility = () => {
    schedule();
  };
  document.addEventListener('visibilitychange', onVisibility);

  let disposed = false;
  return {
    renderer,
    start() {
      if (disposed) return;
      running = true;
      schedule();
    },
    stop() {
      running = false;
      cancelAnimationFrame(handle);
    },
    renderOnce,
    resize,
    dispose() {
      if (disposed) return;
      disposed = true;
      running = false;
      cancelAnimationFrame(handle);
      document.removeEventListener('visibilitychange', onVisibility);
      scene.remove(model.root);
      model.dispose();
      lighting.dispose();
      renderer.dispose();
    },
  };
}

/** Soft studio light: an environment for reflections, a warm key, a cool fill, a rim from behind. */
function createLighting(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
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

/** Points the camera at the face (portrait) or the whole body (full), from the front (+Z). */
function frameCamera(camera: THREE.PerspectiveCamera, model: LoadedAvatarModel, framing: Framing) {
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
  camera.lookAt(target);
}
