// ---------------------------------------------------------------------------
// The exercise demo's person: the Blender human, drawn with WebGL
// ---------------------------------------------------------------------------
// Loads the digital human built in Blender (models/coach-01.glb, from packages/avatar-assets) and
// poses it each frame like the demo mannequin (lib/demo-rig.js), seen through the mannequin's own
// camera (lib/demo-model.js). The file is part of the extension: nothing is fetched from the network.
// lib/demo-player.js falls back to the drawn mannequin when this can't run (no WebGL).
import * as THREE from "./vendor/three.js";
import { GLTFLoader, MeshoptDecoder } from "./vendor/three.js";
import { demoChair, demoMotion, demoPose, demoView3d } from "./demo-model.js";
import { humanPose, rigFromGlb, rigLandmarks, rigWorld } from "./demo-rig.js";

/** @typedef {import("./demo-model.js").View} View */
/** @typedef {import("./demo-model.js").P3} P3 */

const MODEL = new URL("../models/coach-01.glb", import.meta.url);
const NEAR = 0.1;
const FAR = 20;
const COLORS = { chair: 0x7d8695, shadow: 0x000000 };

/**
 * Draws the human doing the demo on `canvas`. Rejects (leaving the canvas untouched, so the player
 * can paint the flat figure on it instead) when the browser has no WebGL or the model won't load.
 * @param {HTMLCanvasElement} canvas
 */
export async function createHumanRenderer(canvas) {
  // Ask a spare canvas first: once a canvas has a WebGL context it can't paint in 2D.
  if (!document.createElement("canvas").getContext("webgl2")) throw new Error("no WebGL 2");
  const bytes = await (await fetch(MODEL)).arrayBuffer();
  const rig = rigFromGlb(bytes);
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes, "");
  const bones = rig.bones.map((b) => {
    const bone = gltf.scene.getObjectByName(b.name);
    if (!bone) throw new Error(`the model has no ${b.name} bone`);
    return bone;
  });
  gltf.scene.traverse((object) => {
    const mesh = /** @type {THREE.Mesh} */ (object);
    if (!mesh.isMesh) return;
    // Skinned bounds are the rest pose; an arm that leaves them would be culled.
    mesh.frustumCulled = false;
    for (const m of [mesh.material].flat()) if (m.alphaTest > 0) m.alphaToCoverage = true; // hair, brows, lashes
  });

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); // the player sizes the canvas in device pixels
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.add(gltf.scene);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7f74, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(1.5, 3, 2.5);
  scene.add(key);

  // A soft shadow on the floor, under what's near it (the feet, or a whole body in a push-up).
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1, 48),
    new THREE.MeshBasicMaterial({ color: COLORS.shadow, transparent: true, opacity: 0.2, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.002;
  scene.add(shadow);

  const chair = new THREE.Group();
  scene.add(chair);
  const rail = new THREE.CylinderGeometry(0.022, 0.022, 1, 12);
  const wood = new THREE.MeshStandardMaterial({ color: COLORS.chair, roughness: 0.7 });
  let chairFor = "";
  /** The mannequin's chair, raised to the human's seat (its legs are a little longer). @param {string} move */
  function placeChair(move) {
    if (chairFor === move) return;
    chairFor = move;
    chair.clear();
    const rails = demoChair(move);
    if (!rails) return;
    const { stance, seconds } = demoMotion(move);
    const t = stance === "seated" ? 0 : seconds / 2;
    const posed = humanPose(rig, move, t);
    const seat = rigLandmarks(rig, rigWorld(rig, posed.local, posed.root));
    const mannequin = demoPose(move, t);
    const lift = (seat[23][1] + seat[24][1] - mannequin[23][1] - mannequin[24][1]) / 2;
    for (const [a, b] of rails) {
      const from = new THREE.Vector3(a[0], a[1] + (a[1] > 0.05 ? lift : 0), a[2]);
      const to = new THREE.Vector3(b[0], b[1] + (b[1] > 0.05 ? lift : 0), b[2]);
      const m = new THREE.Mesh(rail, wood);
      m.position.copy(from).add(to).multiplyScalar(0.5);
      m.scale.y = from.distanceTo(to);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
      chair.add(m);
    }
  }

  const camera = new THREE.PerspectiveCamera(30, 1, NEAR, FAR);
  let size = "";
  return {
    /** Poses the human for a move at `t` s and draws it through `view`. @param {string} move @param {number} t @param {View} view */
    draw(move, t, view) {
      const posed = humanPose(rig, move, t);
      if (!posed) return;
      posed.local.forEach((q, i) => bones[i].quaternion.set(q[0], q[1], q[2], q[3]));
      const top = rig.bones[0].t;
      bones[0].position.set(top[0] + posed.root[0], top[1] + posed.root[1], top[2] + posed.root[2]);
      placeChair(move);

      const l = rigLandmarks(rig, rigWorld(rig, posed.local, posed.root));
      const low = l.filter((p) => p[1] < 0.5);
      const xs = low.length ? low.map((p) => p[0]) : [0];
      const zs = low.length ? low.map((p) => p[2]) : [0];
      shadow.position.x = (Math.min(...xs) + Math.max(...xs)) / 2;
      shadow.position.z = (Math.min(...zs) + Math.max(...zs)) / 2;
      shadow.scale.set(0.2 + (Math.max(...xs) - Math.min(...xs)) / 2, 0.2 + (Math.max(...zs) - Math.min(...zs)) / 2, 1);

      // The mannequin's pinhole camera.
      const { eye, target, focal } = demoView3d(move, view);
      camera.fov = (2 * Math.atan(view.height / 2 / focal) * 180) / Math.PI;
      camera.aspect = view.width / view.height;
      camera.position.set(...eye);
      camera.lookAt(...target);
      camera.updateProjectionMatrix();
      // The player sizes the canvas; the renderer's viewport has to follow it.
      if (size !== `${view.width}x${view.height}`) {
        renderer.setSize(view.width, view.height, false);
        size = `${view.width}x${view.height}`;
      }
      renderer.render(scene, camera);
    },
    dispose() {
      gltf.scene.traverse((object) => {
        const mesh = /** @type {THREE.Mesh} */ (object);
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        for (const m of [mesh.material].flat()) {
          for (const v of Object.values(m)) if (v && typeof v === "object" && "isTexture" in v) v.dispose();
          m.dispose();
        }
      });
      rail.dispose();
      wood.dispose();
      shadow.geometry.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
