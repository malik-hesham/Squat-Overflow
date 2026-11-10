// AvatarScene, CameraController and LightingController in one view: draws a loaded model into a
// canvas, posed each frame from an AvatarFrameSource (avatar-core's controller). No framework: the
// extension's pages are plain JavaScript; a React wrapper can sit on top of this.
import type { AvatarFrameSource } from '@squat-overflow/avatar-types';
import * as THREE from 'three';
import { FIELD_OF_VIEW, frameCamera, type Framing } from './camera.ts';
import { createLighting } from './lighting.ts';
import type { LoadedAvatarModel } from './loader.ts';
import { createAvatarRig } from './rig.ts';

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
  /** The camera, in avatar space: e.g. to turn a pointer position into a setGaze target. */
  readonly camera: THREE.PerspectiveCamera;
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

  const camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW[framing], 1, 0.05, 50);
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
    camera,
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
