// ---------------------------------------------------------------------------
// 3D building blocks for the sensitive-mode characters
// ---------------------------------------------------------------------------
// Everything is in screen pixels with y flipped up (world = (x, -y, z)) and
// seen through an orthographic camera, so a character's body parts sit
// exactly on the tracked joints while the lighting stays properly 3D.
// Characters are soft toys: plush (sheen) fur, glossy eyes and noses, faces
// as decals bent onto the head so they curve with it.
import * as THREE from "./vendor/three.js";

// ---- Shared geometry: one copy for every character, never disposed --------
const SHARED = new Set();
const keep = (g) => (SHARED.add(g), g);
export const isShared = (g) => SHARED.has(g);

function heartGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.45);
  s.bezierCurveTo(-1.15, 0.25, -0.5, 1.05, 0, 0.4);
  s.bezierCurveTo(0.5, 1.05, 1.15, 0.25, 0, -0.45);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.25, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 4, curveSegments: 16 });
  g.center();
  return g;
}

function starGeometry() {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 0.45 : 1;
    if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.08, bevelSegments: 3 });
  g.center();
  return g;
}

export const GEO = {
  sphere: keep(new THREE.SphereGeometry(1, 36, 24)),
  smooth: keep(new THREE.SphereGeometry(1, 64, 44)), // heads and bodies
  rod: keep(new THREE.CylinderGeometry(1, 1, 1, 28, 1, true)),
  cone: keep(new THREE.ConeGeometry(1, 1, 28)),
  lid: keep(new THREE.TorusGeometry(0.72, 0.15, 10, 28, Math.PI)), // a happy closed eye
  ring: keep(new THREE.TorusGeometry(1, 0.2, 14, 40)),
  heart: keep(heartGeometry()),
  star: keep(starGeometry()),
};

// ---- Materials --------------------------------------------------------------
const tint = (hex, toward, k) => new THREE.Color(hex).lerp(new THREE.Color(toward), k);

// A per-character material factory; `all` lists everything made, for dispose().
export function makeMaterials() {
  const all = [];
  const add = (m) => (all.push(m), m);
  const decalOpts = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide };
  return {
    all,
    // Soft toy fur: matte with a velvety sheen at the edges.
    plush: (color, sheen = 1) =>
      add(new THREE.MeshPhysicalMaterial({ color, roughness: 0.82, sheen: sheen * 0.8, sheenRoughness: 0.55, sheenColor: tint(color, 0xffffff, 0.35) })),
    // Smooth vinyl/clay: skin, bills, beaks, horns.
    clay: (color) => add(new THREE.MeshPhysicalMaterial({ color, roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.35 })),
    // Wet-look gloss: eyes, noses, tongues, jelly.
    gloss: (color) => add(new THREE.MeshPhysicalMaterial({ color, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.06 })),
    metal: (color, roughness = 0.3) => add(new THREE.MeshStandardMaterial({ color, metalness: 0.85, roughness })),
    // Unlit and untoned: LEDs, eye sparkles, glitter.
    glow: (color, opacity = 1) => add(new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: opacity < 1, opacity })),
    // Painted on: mouths, patches, spots.
    decal: (color, { opacity = 1, roughness = 0.6, clearcoat = 0 } = {}) =>
      add(
        new THREE.MeshPhysicalMaterial({ color, roughness, clearcoat, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, ...decalOpts }),
      ),
    decalGlow: (color, opacity = 1) =>
      add(new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: opacity < 1, opacity, depthWrite: false, ...decalOpts })),
  };
}

// ---- Placement --------------------------------------------------------------
const UP = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();

// An ellipsoid (or any unit mesh) centred on screen point `p`, rotated by the
// screen angle `ang` (clockwise, like the 2D pose).
export function placeBlob(m, p, z, rx, ry, rz, ang = 0) {
  m.position.set(p.x, -p.y, z);
  m.scale.set(rx, ry, rz);
  m.rotation.set(0, 0, -ang);
}

// A rod (unit cylinder along +y) from screen point a to b; `flat` squashes it front to back.
export function placeRod(m, a, b, za, zb, r, flat = 1) {
  const dx = b.x - a.x;
  const dy = a.y - b.y;
  const dz = zb - za;
  const len = Math.hypot(dx, dy, dz) || 1e-6;
  m.position.set((a.x + b.x) / 2, -(a.y + b.y) / 2, (za + zb) / 2);
  m.quaternion.setFromUnitVectors(UP, tmp.set(dx / len, dy / len, dz / len));
  m.scale.set(r, len, r * flat);
}

export function mesh(parent, geo, mat) {
  const m = new THREE.Mesh(geo, mat);
  parent.add(m);
  return m;
}

// A smooth tapered tube through screen points: a ball at each point and a
// tapered rod between neighbours. `rel` gives each point's radius relative to
// the scale passed to set(), so the taper is baked into the rods once.
export class Limb {
  // `mats` alternates materials along the tube (stripes); `ballMat` gives the
  // joints their own material (a robot's bolts).
  constructor(parent, mat, rel, { flat = 1, mats = null, ballMat = null } = {}) {
    this.rel = rel;
    this.flat = flat;
    const pick = (i) => (mats ? mats[i % mats.length] : mat);
    this.balls = rel.map((_, i) => mesh(parent, GEO.sphere, ballMat ?? pick(i)));
    this.rods = rel.slice(1).map((r1, i) => mesh(parent, new THREE.CylinderGeometry(r1, rel[i], 1, 28, 1, true), pick(i)));
  }

  // `pts`: screen points (fewer than rel.length hides the rest); `s`: radius
  // scale in pixels; `z`: depth, or one per point.
  /** @param {number | number[]} [z] */
  set(pts, s, z = 0) {
    const zi = (i) => (typeof z === "number" ? z : z[Math.min(i, z.length - 1)]);
    this.balls.forEach((b, i) => {
      b.visible = i < pts.length;
      if (!b.visible) return;
      const r = this.rel[i] * s;
      b.position.set(pts[i].x, -pts[i].y, zi(i));
      b.scale.set(r, r, r * this.flat);
    });
    this.rods.forEach((m, i) => {
      m.visible = i + 1 < pts.length;
      if (m.visible) placeRod(m, pts[i], pts[i + 1], zi(i), zi(i + 1), s, this.flat);
    });
  }

  hide() {
    for (const m of [...this.balls, ...this.rods]) m.visible = false;
  }
}

// ---- 2D outlines for decals (y up, closed polygons as [x, y] pairs) ---------
export const shape = {
  ellipse(cx, cy, rx, ry, n = 40) {
    return Array.from({ length: n }, (_, i) => {
      const t = (i / n) * Math.PI * 2;
      return [cx + Math.cos(t) * rx, cy + Math.sin(t) * ry];
    });
  },
  // Points along a quadratic curve from p0 to p2 via control c.
  quad(p0, c, p2, n = 20) {
    return Array.from({ length: n + 1 }, (_, i) => {
      const t = i / n;
      const a = (1 - t) * (1 - t);
      const b = 2 * t * (1 - t);
      const d = t * t;
      return [a * p0[0] + b * c[0] + d * p2[0], a * p0[1] + b * c[1] + d * p2[1]];
    });
  },
  arc(cx, cy, r, a0, a1, n = 18) {
    return Array.from({ length: n + 1 }, (_, i) => {
      const a = a0 + ((a1 - a0) * i) / n;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    });
  },
  // A stroke of width w0 → w1 along a polyline, as an outline.
  band(pts, w0, w1 = w0) {
    const n = pts.length;
    const left = [];
    const right = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(n - 1, i + 1)];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      const half = (w0 + (w1 - w0) * (i / Math.max(1, n - 1))) / 2;
      left.push([pts[i][0] - (dy / l) * half, pts[i][1] + (dx / l) * half]);
      right.push([pts[i][0] + (dy / l) * half, pts[i][1] - (dx / l) * half]);
    }
    return [...left, ...right.reverse()];
  },
  roundRect(x0, y0, x1, y1, r, n = 6) {
    const pts = [];
    const corner = (cx, cy, a0) => {
      for (let i = 0; i <= n; i++) {
        const a = a0 + (i / n) * (Math.PI / 2);
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
    };
    corner(x1 - r, y1 - r, 0);
    corner(x0 + r, y1 - r, Math.PI / 2);
    corner(x0 + r, y0 + r, Math.PI);
    corner(x1 - r, y0 + r, Math.PI * 1.5);
    return pts;
  },
};

// ---- Decals -----------------------------------------------------------------
const UNIT = { c: [0, 0, 0], r: [1, 1, 1] };

// A flat outline bent onto the front of an ellipsoid (centre c, radii r, in the
// parent's space), lifted a hair so it sits on the surface. The outline is
// triangulated, then subdivided so long triangles don't cut into the curve.
export function decalGeometry(poly, ell = UNIT, { lift = 0.006, rounds = 3 } = {}) {
  const contour = poly.map(([x, y]) => new THREE.Vector2(x, y));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  let p = new Float32Array(tris.length * 6);
  tris.forEach((t, i) => t.forEach((k, j) => p.set([contour[k].x, contour[k].y], i * 6 + j * 2)));
  for (let r = 0; r < rounds; r++) {
    const out = new Float32Array(p.length * 4);
    let o = 0;
    for (let i = 0; i < p.length; i += 6) {
      const [ax, ay, bx, by, cx, cy] = p.subarray(i, i + 6);
      const ab = [(ax + bx) / 2, (ay + by) / 2];
      const bc = [(bx + cx) / 2, (by + cy) / 2];
      const ca = [(cx + ax) / 2, (cy + ay) / 2];
      for (const v of [ax, ay, ...ab, ...ca, ...ab, bx, by, ...bc, ...ca, ...bc, cx, cy, ...ab, ...bc, ...ca]) out[o++] = v;
    }
    p = out;
  }
  const n = p.length / 2;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const [cx, cy, cz] = ell.c;
  const [rx, ry, rz] = ell.r;
  for (let i = 0; i < n; i++) {
    const x = p[i * 2];
    const y = p[i * 2 + 1];
    const u = (x - cx) / rx;
    const v = (y - cy) / ry;
    const k = Math.sqrt(Math.max(0, 1 - u * u - v * v));
    pos.set([x, y, cz + rz * k + lift], i * 3);
    const nl = Math.hypot(u / rx, v / ry, k / rz) || 1;
    nor.set([u / rx / nl, v / ry / nl, k / rz / nl], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  return geo;
}

export function decal(parent, poly, mat, ell, opts) {
  return mesh(parent, decalGeometry(poly, ell, opts), mat);
}

// ---- Faces --------------------------------------------------------------------
// A head: a group scaled to the tracked head radius, so everything on it is in
// head units (radius ~1). Feature positions use (fx right, fy down), like the pose.
export class Head {
  /** @param {number[]} [radii] [rx, ry, rz] */
  constructor(parent, mat, radii = [1, 1, 1]) {
    this.radii = radii;
    this.ell = { c: [0, 0, 0], r: radii };
    this.group = new THREE.Group();
    parent.add(this.group);
    this.mesh = mesh(this.group, GEO.smooth, mat);
    this.mesh.scale.set(radii[0], radii[1], radii[2]);
  }

  // The point on the head's front surface at (fx, fy), in head units.
  surface(fx, fy) {
    const [rx, ry, rz] = this.radii;
    const u = fx / rx;
    const v = fy / ry;
    return new THREE.Vector3(fx, -fy, rz * Math.sqrt(Math.max(0, 1 - u * u - v * v)));
  }

  // Follow the tracked head: position, size, tilt, and a real turn for yaw.
  place(head, z) {
    this.group.position.set(head.c.x, -head.c.y, z);
    this.group.scale.setScalar(head.r);
    this.group.rotation.set(0, head.yaw * 0.5, -head.tilt);
  }
}

// A big glossy googly eye: a white ball sunk into the face, an iris and pupil
// that roll with the rig's eye wobble, two fixed sparkles, and a happy "^"
// lid shown while blinking or right after a rep.
export function makeEye(parent, mats, at, size, iris) {
  const g = new THREE.Group();
  parent.add(g);
  g.position.copy(at).setZ(at.z - size * 0.45);
  const white = mesh(g, GEO.sphere, mats.eyeWhite);
  white.scale.setScalar(size);
  const look = new THREE.Group();
  g.add(look);
  const irisBall = mesh(look, GEO.sphere, mats.gloss(iris));
  irisBall.scale.setScalar(size * 0.74);
  irisBall.position.z = size * 0.34;
  const pupil = mesh(look, GEO.sphere, mats.pupil);
  pupil.scale.setScalar(size * 0.42);
  pupil.position.z = size * 0.72;
  const sparkles = [
    [-0.3, 0.32, 1.14, 0.18],
    [0.26, -0.24, 1.1, 0.08],
  ].map(([x, y, z, r]) => {
    const m = mesh(g, GEO.sphere, mats.sparkle);
    m.position.set(x * size, y * size, z * size);
    m.scale.setScalar(r * size);
    return m;
  });
  const lid = mesh(g, GEO.lid, mats.lid);
  lid.scale.setScalar(size);
  lid.position.set(0, -size * 0.1, size * 0.9);
  return {
    group: g,
    update(s) {
      const closed = s.blink || s.joy;
      white.visible = look.visible = !closed;
      for (const m of sparkles) m.visible = !closed;
      lid.visible = closed;
      look.rotation.set(s.look.y * 0.5, s.look.x * 0.55, 0);
    },
  };
}

// The mouth's three looks as decal groups: a happy open grin with a tongue,
// a wider one right after a rep, and a comic "eek" of clenched teeth.
// (mx, my) is the mouth's centre-top, y up; `teeth`: "top" (a row), "buck"
// (two big front teeth), "fangs" (two little fangs down), "under" (two fangs
// up from the lower lip), "one" or "none".
export function makeMouth(parent, mats, ell, { x: mx, y: my, w, teeth = "top", color = "#5a1f2a", lift = 0.006 }) {
  const dark = mats.decal(color, { roughness: 0.35 });
  const tongue = mats.decal("#ff7d9a", { roughness: 0.3, clearcoat: 0.6 });
  const white = mats.decal("#ffffff", { roughness: 0.3 });
  const line = mats.decal("#2a1418");
  const at = (pts) => pts;
  const L = (k) => ({ lift: lift * k });

  function grin(depthK) {
    const g = new THREE.Group();
    parent.add(g);
    const depth = w * 1.25 * depthK; // control point; the lip dips half that
    const p0 = [mx - w, my];
    const p2 = [mx + w, my];
    const lip = shape.quad(p0, [mx, my - w * 0.18], p2);
    const bottom = shape.quad(p2, [mx, my - depth], p0);
    decal(g, [...lip, ...bottom.slice(1, -1)], dark, ell, L(1));
    const low = shape.quad(p0, [mx, my - depth], p2).slice(4, 17);
    decal(g, [...low, ...shape.quad(low.at(-1), [mx + w * 0.05, my - depth * 0.15], low[0]).slice(1, -1)], tongue, ell, L(2));
    const lipAt = (x) => {
      const t = (x - (mx - w)) / (2 * w);
      return my - 2 * t * (1 - t) * w * 0.18;
    };
    const fang = (x, y, dir) => decal(g, at([[x - w * 0.12, y], [x + w * 0.12, y], [x, y + dir * w * 0.3]]), white, ell, L(3));
    if (teeth === "top") {
      const xs = Array.from({ length: 13 }, (_, i) => mx - w * 0.72 + (i / 12) * w * 1.44);
      decal(g, [...xs.map((x) => [x, lipAt(x) + w * 0.02]), ...xs.reverse().map((x) => [x, lipAt(x) - w * 0.2])], white, ell, L(3));
    }
    if (teeth === "one") decal(g, shape.roundRect(mx + w * 0.12, my - w * 0.32, mx + w * 0.4, my, w * 0.05), white, ell, L(3));
    if (teeth === "buck") {
      for (const x0 of [mx - w * 0.31, mx + w * 0.01]) decal(g, shape.roundRect(x0, my - w * 0.46, x0 + w * 0.3, my - w * 0.02, w * 0.07), white, ell, L(3));
    }
    for (const s of [-1, 1]) {
      if (teeth === "fangs") fang(mx + s * w * 0.5, lipAt(mx + s * w * 0.5) + w * 0.02, -1);
      if (teeth === "under") fang(mx + s * w * 0.5, my - depth * 0.375 - w * 0.03, 1);
    }
    return g;
  }

  const happy = grin(1);
  const joy = grin(1.4);
  const eek = new THREE.Group();
  parent.add(eek);
  const h = w * 0.55;
  decal(eek, shape.roundRect(mx - w * 0.8, my - h * 0.7, mx + w * 0.8, my + h * 0.3, h * 0.45), white, ell, L(1));
  decal(eek, shape.roundRect(mx - w * 0.78, my - h * 0.23, mx + w * 0.78, my - h * 0.17, h * 0.03), line, ell, L(2));
  for (const k of [-0.4, 0, 0.4]) {
    decal(eek, shape.roundRect(mx + k * w - w * 0.025, my - h * 0.66, mx + k * w + w * 0.025, my + h * 0.26, w * 0.01), line, ell, L(2));
  }
  return {
    update(s) {
      happy.visible = !s.issues && !s.joy;
      joy.visible = !s.issues && s.joy;
      eek.visible = s.issues;
    },
  };
}

// Happy arched brows, or a comic fluster (inner ends raised) on an issue.
export function makeBrows(parent, mats, ell, { y, spread = 0.36, color, lift = 0.006 }) {
  const mat = mats.decal(color);
  const happy = new THREE.Group();
  const worried = new THREE.Group();
  parent.add(happy, worried);
  for (const s of [-1, 1]) {
    const x = s * spread;
    decal(happy, shape.band(shape.arc(x, y - 0.06, 0.15, Math.PI * 0.2, Math.PI * 0.8), 0.07), mat, ell, { lift });
    decal(worried, shape.band([[x - s * 0.14, y + 0.08], [x + s * 0.14, y - 0.04]], 0.07), mat, ell, { lift });
  }
  return {
    update(s) {
      happy.visible = !s.issues;
      worried.visible = s.issues;
    },
  };
}

// Rosy cheeks: stacked translucent ovals, so the edge is soft.
export function makeBlush(parent, mats, ell, { x, y, r, lift = 0.004 }) {
  const mat = mats.decal("#ff6f96", { opacity: 0.22 });
  for (const s of [-1, 1]) {
    for (const k of [1, 0.75, 0.5]) decal(parent, shape.ellipse(s * x, y, r * 1.15 * k, r * 0.7 * k, 28), mat, ell, { lift, rounds: 2 });
  }
}

// The standard materials every face uses.
export function faceMaterials(mats, line = "#1a1012") {
  return Object.assign(mats, {
    eyeWhite: mats.gloss("#fbfaf7"),
    pupil: mats.gloss("#0b0a0c"),
    sparkle: mats.glow("#ffffff"),
    lid: mats.clay(line),
  });
}
