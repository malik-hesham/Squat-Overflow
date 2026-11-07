// ---------------------------------------------------------------------------
// Sensitive-mode characters
// ---------------------------------------------------------------------------
// A soft 3D toy that copies the user's pose, drawn instead of the camera
// picture so no camera pixels reach the screen. The pose and physics live in
// lib/avatar-rig.js, the building blocks in lib/avatar-kit.js and the
// characters in lib/avatar-characters.js; this module renders them with
// three.js into one shared, transparent WebGL canvas and copies each frame onto
// the 2D canvas the break window already draws on, over a 2D backdrop.
import * as THREE from "./lib/vendor/three.js";
import { RoomEnvironment } from "./lib/vendor/three.js";
import { CHARACTERS as DEFS } from "./lib/avatar-characters.js";
import { STANDING, add, clamp, createRig, hash, rot } from "./lib/avatar-rig.js";
import { GEO, faceMaterials, isShared, makeMaterials, mesh } from "./lib/avatar-kit.js";

const ISSUE_COLOR = "#ffb547";
const HALO = "rgba(190, 210, 255, 0.3)";

// Labels for the picker; the keys are what settings store.
export const CHARACTERS = Object.fromEntries(Object.entries(DEFS).map(([k, d]) => [k, { label: d.label }]));

// ---- One renderer for every character and thumbnail -------------------------
// (Browsers cap live WebGL contexts, so characters share this one.)
let renderer = null;
let envMap = null;
let failed = false;

function getRenderer() {
  if (renderer || failed) return renderer;
  if (typeof OffscreenCanvas === "undefined") {
    failed = true;
    return null;
  }
  try {
    const canvas = new OffscreenCanvas(1, 1);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Soft studio lighting from every direction: what makes plush look plush.
    const pmrem = new THREE.PMREMGenerator(renderer);
    envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  } catch (err) {
    console.warn("3D characters unavailable", err);
    renderer = null;
    failed = true;
  }
  return renderer;
}

// Whether this browser can draw the 3D characters (WebGL in an OffscreenCanvas).
export function supported() {
  return !!getRenderer();
}

function lightScene(scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6a7390, 0.9));
  const key = new THREE.DirectionalLight(0xfff4e8, 2.2);
  key.position.set(-0.8, 1.2, 1.6); // top left, in front
  const rim = new THREE.DirectionalLight(0xbcd2ff, 1.4);
  rim.position.set(1.2, 0.6, -1); // behind, for a cool edge light
  scene.add(key, rim);
}

// ---- Overlays: celebration hearts and stars, sweat drop, rain cloud ---------
function makeOverlays(scene, mats, party) {
  const group = new THREE.Group();
  scene.add(group);
  const partyMats = party.map((c) => mats.gloss(c));
  const pool = [];

  const sweat = new THREE.Group();
  group.add(sweat);
  const water = mats.gloss("#8fd3ff");
  mesh(sweat, GEO.sphere, water);
  const tip = mesh(sweat, GEO.cone, water);
  tip.position.y = 1.18;
  tip.scale.set(0.75, 1.04, 0.75);
  const shine = mesh(sweat, GEO.sphere, mats.glow("#ffffff", 0.8));
  shine.position.set(-0.35, 0.2, 0.75);
  shine.scale.set(0.15, 0.28, 0.1);

  // A little grey rain cloud that follows the head once it's properly droopy.
  const cloud = new THREE.Group();
  group.add(cloud);
  const puffMat = mats.plush("#9aa3b2", 0.6);
  for (const [x, y, r] of [
    [-0.62, -0.12, 0.42],
    [0.62, -0.12, 0.42],
    [0, 0.18, 0.56],
    [-0.28, -0.2, 0.4],
    [0.3, -0.22, 0.4],
  ]) {
    const m = mesh(cloud, GEO.sphere, puffMat);
    m.position.set(x, y, 0);
    m.scale.setScalar(r);
  }
  const rainMat = mats.gloss("#8cb9eb");
  const drops = Array.from({ length: 7 }, () => mesh(cloud, GEO.sphere, rainMat));

  return function update(rig, pose, headZ, issues) {
    // Particles: a 3D heart or star per rig particle, tumbling as it falls.
    const ps = rig.particles;
    while (pool.length < ps.length) pool.push({ heart: mesh(group, GEO.heart, partyMats[0]), star: mesh(group, GEO.star, partyMats[0]) });
    pool.forEach((m, i) => {
      const p = ps[i];
      m.heart.visible = !!p && p.kind === "heart";
      m.star.visible = !!p && p.kind === "star";
      if (!p) return;
      const o = p.kind === "heart" ? m.heart : m.star;
      o.material = partyMats[party.indexOf(p.color)] ?? partyMats[0];
      o.position.set(p.x, -p.y, (headZ ?? 0) + p.size * 4);
      o.rotation.set(0, p.ang * 0.8, -p.ang * 0.3);
      o.scale.setScalar(p.size * clamp(p.life * 2, 0, 1));
    });

    sweat.visible = !!(issues && pose);
    cloud.visible = !!(pose && rig.droop >= 0.4);
    if (!pose) return;
    const { c, r, tilt } = pose.head;
    const t = rig.clock;
    if (sweat.visible) {
      const p = add(c, rot({ x: -r * 1.05, y: -r * 0.5 + Math.sin(t * 6) * r * 0.04 }, tilt));
      sweat.position.set(p.x, -p.y, headZ + r * 0.4);
      sweat.scale.setScalar(r * 0.16);
      sweat.rotation.set(0, 0, -tilt);
    }
    if (cloud.visible) {
      const k = (rig.droop - 0.4) / 0.6;
      const size = r * (0.55 + 0.25 * k);
      const cx = c.x + Math.sin(t * 0.7) * r * 0.12;
      const cy = Math.max(size, c.y - r * 2.1 + Math.sin(t * 1.3) * r * 0.05);
      cloud.position.set(cx, -cy, headZ);
      cloud.scale.setScalar(size);
      drops.forEach((d, i) => {
        d.visible = i < 3 + Math.round(4 * k);
        const fall = (t * 0.9 + hash(i + 40)) % 1;
        d.position.set((hash(i + 50) - 0.5) * 1.8, -0.4 - fall * 2.2, 0);
        d.scale.set(0.05, 0.12, 0.05).multiplyScalar(1 - fall * 0.5);
      });
    }
  };
}

// ---- Characters -------------------------------------------------------------
// `fitness` ({ buff, droop }, both 0..1) comes from lib/fitness.js: buff
// widens the shoulders and thickens the arms, droop slumps the body, hangs the
// head and parks a rain cloud overhead.
export function create(requested, fitness = {}) {
  const key = requested in DEFS ? requested : "slothbear";
  const def = DEFS[key];
  const rig = createRig(def, fitness);
  const scene = new THREE.Scene();
  lightScene(scene);
  const root = new THREE.Group();
  scene.add(root);
  const mats = faceMaterials(makeMaterials());
  const pose3d = def.build(root, mats, { buff: rig.buff, rig });
  const overlays = makeOverlays(scene, mats, def.party);
  const camera = new THREE.OrthographicCamera(0, 1, 0, -1, -10000, 10000);
  let lastNow = 0;
  let lastDt = 0;

  const state = (issues) => ({
    blink: rig.blinking(),
    joy: rig.joyful() && !issues,
    issues,
    look: rig.eyes,
    clock: rig.clock,
    buff: rig.buff,
    droop: rig.droop,
    wobble: rig.wobble.w,
    wings: rig.wings,
    rig,
  });

  function pose(p, issues) {
    root.visible = !!p;
    const at = p ? pose3d(p, state(issues)) : null;
    overlays(rig, p, at?.z ?? 0, issues);
  }

  // Render the scene and copy it onto `ctx`, over a soft ground shadow, with a
  // light halo (an orange glow on a form issue). `ss` supersamples.
  function render(ctx, p, w, h, issues, ss = 1) {
    const r = getRenderer();
    if (!r) return;
    if (p) {
      const sh = rig.shadow(p, lastDt);
      if (sh) {
        ctx.save();
        ctx.fillStyle = `rgba(0, 0, 0, ${sh.alpha})`;
        ctx.beginPath();
        ctx.ellipse(sh.x, sh.y, sh.rx, sh.ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    const W = Math.round(w * ss);
    const H = Math.round(h * ss);
    if (r.domElement.width !== W || r.domElement.height !== H) r.setSize(W, H, false);
    camera.right = w;
    camera.bottom = -h;
    camera.updateProjectionMatrix();
    scene.environment = envMap;
    r.render(scene, camera);
    ctx.save();
    ctx.globalAlpha = p ? clamp(rig.presence(), 0, 1) : 1;
    ctx.shadowColor = issues ? ISSUE_COLOR : HALO;
    ctx.shadowBlur = p ? p.unit * (issues ? 0.35 : 0.14) : 0;
    ctx.drawImage(r.domElement, 0, 0, w, h);
    ctx.restore();
  }

  return {
    key,
    scene,
    // Advance the physics and pose the 3D figure without rendering (headless-safe).
    // `lms`: the latest landmarks, or null when nobody is tracked (the figure fades out).
    update(lms, w, h, { issues = false, now = performance.now() } = {}) {
      const dt = lastNow ? clamp((now - lastNow) / 1000, 0, 0.25) : 0;
      lastNow = now;
      lastDt = dt;
      rig.setTargets(lms, w, h);
      const p = rig.advance(dt, h);
      pose(p, issues);
      return p;
    },
    draw(ctx, lms, w, h, opts = {}) {
      const p = this.update(lms, w, h, opts);
      if (p || rig.particles.length) render(ctx, p, w, h, !!opts.issues);
    },
    // A finished rep: a burst of hearts and stars (bigger for a clean rep).
    celebrate(big = true) {
      rig.celebrate(big);
    },
    // Draw a still pose with the loose parts already settled (picker thumbnails).
    still(ctx, lms, w, h) {
      const p = rig.settle(lms, w, h);
      pose(p, false);
      if (p) render(ctx, p, w, h, false, 2);
    },
    dispose() {
      scene.traverse((o) => {
        if (o.geometry && !isShared(o.geometry)) o.geometry.dispose();
      });
      for (const m of mats.all) m.dispose();
    },
  };
}

// ---- 2D backdrop and thumbnails ---------------------------------------------
function twinkle(g, c, s, color) {
  g.beginPath();
  g.moveTo(c.x, c.y - s);
  g.quadraticCurveTo(c.x, c.y, c.x + s, c.y);
  g.quadraticCurveTo(c.x, c.y, c.x, c.y + s);
  g.quadraticCurveTo(c.x, c.y, c.x - s, c.y);
  g.quadraticCurveTo(c.x, c.y, c.x, c.y - s);
  g.fillStyle = color;
  g.fill();
}

// A soft-lit little room: a gradient wall with faint stars and a floor grid.
export function drawBackdrop(g, w, h) {
  const floorY = h * 0.8;
  const wall = g.createLinearGradient(0, 0, 0, floorY);
  wall.addColorStop(0, "#2c3755");
  wall.addColorStop(1, "#1e2539");
  g.fillStyle = wall;
  g.fillRect(0, 0, w, floorY);
  const glow = g.createRadialGradient(w / 2, h * 0.35, 0, w / 2, h * 0.35, w * 0.6);
  glow.addColorStop(0, "rgba(150, 185, 255, 0.2)");
  glow.addColorStop(1, "rgba(150, 185, 255, 0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, w, floorY);
  for (let i = 0; i < 14; i++) {
    twinkle(g, { x: hash(i) * w, y: hash(i + 50) * floorY * 0.9 }, Math.max(1.5, w / 260) * (0.6 + hash(i + 99)), "rgba(255, 255, 255, 0.18)");
  }
  const floor = g.createLinearGradient(0, floorY, 0, h);
  floor.addColorStop(0, "#2a3450");
  floor.addColorStop(1, "#181e2d");
  g.fillStyle = floor;
  g.fillRect(0, floorY, w, h - floorY);
  g.strokeStyle = "rgba(255, 255, 255, 0.06)";
  g.lineWidth = Math.max(1, w / 600);
  g.beginPath();
  for (let i = -8; i <= 8; i++) {
    g.moveTo(w / 2 + i * w * 0.05, floorY);
    g.lineTo(w / 2 + i * w * 0.3, h);
  }
  for (let k = 1; k <= 4; k++) {
    const y = floorY + (h - floorY) * (k / 5) ** 1.6;
    g.moveTo(0, y);
    g.lineTo(w, y);
  }
  g.stroke();
  g.strokeStyle = "rgba(255, 255, 255, 0.1)";
  g.beginPath();
  g.moveTo(0, floorY);
  g.lineTo(w, floorY);
  g.stroke();
}

// The standing pose shrunk towards the floor, so big heads, ears and hats fit a thumbnail.
const THUMB_POSE = STANDING.map(([x, y, v]) => [0.5 + (x - 0.5) * 0.78, 0.94 - (0.94 - y) * 0.78, v]);

// Picker thumbnail for a character key, or "blur" for the blurred-camera look.
// `fitness` shows the character as buff or droopy as the user has made it.
export function drawThumb(canvas, key, fitness) {
  const { width: w, height: h } = canvas;
  const g = canvas.getContext("2d");
  if (key === "blur") {
    const fig = new OffscreenCanvas(w, h);
    const fg = fig.getContext("2d");
    const bg = fg.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, "#6b7a73");
    bg.addColorStop(1, "#3c4752");
    fg.fillStyle = bg;
    fg.fillRect(0, 0, w, h);
    const a = create("bunny");
    a.still(fg, THUMB_POSE, w, h);
    a.dispose();
    g.save();
    g.filter = `blur(${Math.max(3, w / 18)}px)`;
    g.drawImage(fig, 0, 0);
    g.restore();
    return;
  }
  drawBackdrop(g, w, h);
  const a = create(key, fitness);
  a.still(g, THUMB_POSE, w, h);
  a.dispose();
}

export const Avatar = { CHARACTERS, create, drawBackdrop, drawThumb, supported };
