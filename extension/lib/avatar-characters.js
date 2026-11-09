// ---------------------------------------------------------------------------
// The sensitive-mode characters
// ---------------------------------------------------------------------------
// Original soft-toy characters in 3D. Each one has:
//  - label, head (head scale; big heads read cute), party (celebration colours);
//  - step(pose, rig, dt, g, h): its loose parts, stepped on the rig's physics clock;
//  - build(root, mats): makes its meshes and returns update(pose, s), called
//    every frame with the rig's pose (screen pixels) and state `s`
//    ({ blink, joy, issues, look, clock, buff, wobble, wings, rig }).
// update() returns where the head sits ({ z }) so the overlays (sweat drop,
// rain cloud, hearts) can find it.
import * as THREE from "./vendor/three.js";
import { RoundedBoxGeometry } from "./vendor/three.js";
import { add, bodyDirs, dist, handOf, lerp, mid, norm, rot, scale, sideOf, sub, toeOf, hash } from "./avatar-rig.js";
import {
  GEO,
  Head,
  Limb,
  decal,
  makeBlush,
  makeBrows,
  makeEye,
  makeMouth,
  mesh,
  placeBlob,
  placeRod,
  shape,
} from "./avatar-kit.js";

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// A ball in a parent's local space (y up); `s` is a radius or [rx, ry, rz].
/**
 * @param {number[]} pos [x, y, z]
 * @param {number | number[]} s
 */
function ball(parent, mat, pos, s, geo = GEO.sphere) {
  const m = mesh(parent, geo, mat);
  m.position.set(pos[0], pos[1], pos[2]);
  if (typeof s === "number") m.scale.setScalar(s);
  else m.scale.set(s[0], s[1], s[2]);
  return m;
}

// A static tapered tube in a parent's local space (y up), e.g. a curly horn.
function staticTube(parent, mat, pts, rel, s = 1) {
  const limb = new Limb(parent, mat, rel);
  limb.set(
    pts.map(([x, y]) => ({ x, y: -y })),
    s,
    pts.map((p) => p[2]),
  );
  return limb;
}

// The pieces most characters share: an egg-shaped torso (with optional
// decals painted on it), tube legs with feet, tube arms with round hands.
// Arms thicken with `buff`.
function standardBody(root, o, buff) {
  const torso = mesh(root, GEO.smooth, o.torso);
  o.paint?.(torso);
  const armRel = [1 + 0.5 * buff, 0.95 + 0.3 * buff, 0.85];
  const legs = [0, 1].map(() => new Limb(root, o.leg, [1, 0.92, 0.85]));
  const feet = [0, 1].map(() => mesh(root, GEO.sphere, o.foot ?? o.leg));
  const arms = [0, 1].map(() => new Limb(root, o.arm, armRel, { flat: o.armFlat ?? 1 }));
  const hands = o.hand === null ? [] : [0, 1].map(() => mesh(root, GEO.sphere, o.hand ?? o.arm));
  const [padX, padY] = o.pad ?? [0.22, 0.26];

  return {
    torso,
    update(pose, s) {
      const { unit } = pose;
      const [shA, shB] = pose.shoulders;
      const [hipA, hipB] = pose.hips;
      const shMid = mid(shA, shB);
      const bodyAng = Math.atan2(pose.up.x, -pose.up.y);
      // A soft toy's tummy: chubbier than the person, and low enough to swallow
      // the hips so the legs come out short and stubby.
      const bc = add(lerp(shMid, pose.hipMid, o.center ?? 0.5), pose.up, -unit * 0.1);
      let rx = Math.max(dist(shA, shB), dist(hipA, hipB)) / 2 + unit * (padX + 0.1);
      let ry = dist(shMid, pose.hipMid) / 2 + unit * (padY + 0.14);
      if (o.jelly) {
        rx *= 1 + s.wobble;
        ry *= 1 - s.wobble;
      }
      const rz = Math.min(rx, ry) * (o.depth ?? 0.85);
      placeBlob(torso, bc, 0, rx, ry, rz, bodyAng);

      pose.legs.length || legs.forEach((l) => l.hide());
      feet.forEach((f) => (f.visible = false));
      pose.legs.forEach(([hip, kn, an, ft], i) => {
        const pts = [hip, kn, an].slice(0, kn ? (an ? 3 : 2) : 1);
        if (pts.length < 2) return legs[i].hide();
        legs[i].set(pts, unit * o.legR, [0, unit * 0.04, unit * 0.08]);
        if (!an) return;
        // Seen from the front, a foot points at the camera.
        const toe = toeOf(an, ft, unit, 0.08);
        const [fx, fy, fz] = o.footSize ?? [0.17, 0.1, 0.24];
        placeBlob(feet[i], toe, unit * 0.14, unit * fx, unit * fy, unit * fz);
        feet[i].visible = true;
      });

      const armZ = [rz * 0.25, rz * 0.5, rz * 0.7];
      pose.arms.forEach(([sh, el, wr], i) => {
        if (!el) {
          arms[i].hide();
          if (hands[i]) hands[i].visible = false;
          return;
        }
        arms[i].set(wr ? [sh, el, wr] : [sh, el], unit * o.armR, armZ);
        if (!hands[i]) return;
        hands[i].visible = !!wr;
        if (wr) placeBlob(hands[i], handOf(el, wr, unit), rz * 0.72, unit * o.handR, unit * o.handR, unit * o.handR);
      });
      return { bc, rx, ry, rz, bodyAng, unit, headZ: rz * 0.6, armZ };
    },
  };
}

// The usual face: googly eyes, a mouth, arched brows and rosy cheeks.
function standardFace(head, mats, o) {
  const eyes = o.eyes.map(([fx, fy, size, iris]) => makeEye(head.group, mats, head.surface(fx, fy), size, iris));
  const mouth = makeMouth(head.group, mats, o.mouthOn ?? head.ell, o.mouth);
  const brows = o.brows ? makeBrows(head.group, mats, head.ell, o.brows) : null;
  if (o.blush) makeBlush(head.group, mats, o.blushOn ?? head.ell, o.blush);
  return (s) => {
    for (const [i, e] of eyes.entries()) e.update(o.lookFor ? { ...s, look: o.lookFor(s.look, i) } : s);
    mouth.update(s);
    brows?.update(s);
  };
}

// Little claws/toe beans: `n` balls fanned out in front of a hand or foot.
function nubs(root, mat, n) {
  return Array.from({ length: n }, () => mesh(root, GEO.sphere, mat));
}
function placeNubs(list, at, dir, z, size, spacing) {
  const side = { x: -dir.y, y: dir.x };
  list.forEach((m, k) => {
    const off = (k - (list.length - 1) / 2) * spacing;
    placeBlob(m, add(add(at, dir, size * 0.4), side, off), z, size, size, size);
  });
}

export const CHARACTERS = {
  // ---- Sloth bear: shaggy and dark, cream chest V and muzzle, long claws, a flower.
  slothbear: {
    label: "Sloth bear",
    head: 2,
    party: ["#ff8fb8", "#ffd23f", "#f1e6cf"],
    step(pose, rig, dt, g) {
      const { head, unit } = pose;
      const spots = [-1.2, -0.6, 0, 0.6, 1.2].map((a) => {
        const out = rot(head.up, a);
        return { base: add(head.c, out, head.r * 0.85), out, len: head.r * 0.3 };
      });
      for (const sh of pose.shoulders) {
        const out = norm(add(scale(pose.right, sideOf(pose, sh)), pose.up, 0.5));
        spots.push({ base: sh, out, len: unit * 0.22 });
      }
      spots.forEach((t, i) => {
        const droop = norm(add(t.out, { x: 0, y: 1 }, 0.9));
        rig.stepChain(`tuft${i}`, 3, t.base, [t.out, droop], t.len, 0.07, g, 0.97, dt);
      });
    },
    build(root, mats, { buff, rig }) {
      const fur = mats.plush("#3b312c");
      const dark = mats.plush("#26201c");
      const cream = mats.plush("#efe2c8", 0.6);
      const claw = mats.clay("#f4ecdc");
      const body = standardBody(
        root,
        {
          torso: fur,
          leg: fur,
          foot: dark,
          arm: fur,
          hand: dark,
          legR: 0.27,
          armR: 0.195,
          handR: 0.213,
          pad: [0.24, 0.28],
          footSize: [0.19, 0.11, 0.24],
          paint: (t) => decal(t, shape.band([[-0.55, 0.5], [0, 0.02], [0.55, 0.5]], 0.17), cream, undefined, { lift: 0.01 }),
        },
        buff,
      );
      const tufts = Array.from({ length: 7 }, () => new Limb(root, fur, [1, 0.6, 0.2]));
      const claws = [0, 1, 2, 3].map(() => nubs(root, claw, 3));

      const head = new Head(root, fur, [1.08, 1, 0.95]);
      for (const s of [-1, 1]) {
        ball(head.group, fur, [s * 0.78, 0.72, -0.05], 0.32);
        ball(head.group, dark, [s * 0.8, 0.74, 0.18], [0.17, 0.17, 0.1]);
      }
      const muzzleEll = { c: [0, -0.34, 0.66], r: [0.52, 0.42, 0.42] };
      ball(head.group, cream, muzzleEll.c, muzzleEll.r, GEO.smooth);
      ball(head.group, mats.gloss("#14100e"), [0, -0.14, 1.06], [0.22, 0.14, 0.12]);
      for (const s of [-1, 1]) decal(head.group, shape.ellipse(s * 0.37, 0.2, 0.25, 0.22), mats.decal("#4d4038"), head.ell);
      // A flower tucked behind the right ear.
      const flower = new THREE.Group();
      head.group.add(flower);
      flower.position.set(0.98, 0.42, 0.42);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        ball(flower, mats.clay("#ff8fb8"), [Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0], [0.1, 0.1, 0.05]);
      }
      ball(flower, mats.clay("#ffd23f"), [0, 0, 0.03], 0.07);
      const face = standardFace(head, mats, {
        eyes: [-1, 1].map((s) => [s * 0.37, -0.2, 0.17, "#6b4426"]),
        mouthOn: muzzleEll,
        mouth: { x: 0, y: -0.36, w: 0.26 },
        brows: { y: 0.52, color: "#efe2c8" },
        blush: { x: 0.68, y: -0.18, r: 0.14 },
      });

      return (pose, s) => {
        const info = body.update(pose, s);
        const { unit } = pose;
        const headZ = info.headZ;
        tufts.forEach((t, i) => t.set(rig.chain(`tuft${i}`, 3).pts, i < 5 ? pose.head.r * 0.22 : unit * 0.16, i < 5 ? headZ - pose.head.r * 0.4 : 0));
        // Claws on both hands and feet.
        pose.arms.forEach(([, el, wr], i) => {
          claws[i].forEach((m) => (m.visible = !!(el && wr)));
          if (el && wr) placeNubs(claws[i], add(handOf(el, wr, unit), norm(sub(wr, el)), unit * 0.12), norm(sub(wr, el)), info.armZ[2] + unit * 0.05, unit * 0.06, unit * 0.09);
        });
        [2, 3].forEach((c, i) => {
          const leg = pose.legs[i];
          const ok = leg && leg[1] && leg[2];
          claws[c].forEach((m) => (m.visible = !!ok));
          if (ok) placeNubs(claws[c], add(leg[2], { x: 0, y: 1 }, unit * 0.12), { x: 0, y: 1 }, unit * 0.3, unit * 0.05, unit * 0.09);
        });
        head.place(pose.head, headZ);
        face(s);
        return { z: headZ };
      };
    },
  },

  // ---- Bunny: fluffy white, long floppy ears, a bow, buck teeth and big feet.
  bunny: {
    label: "Bunny",
    head: 1.9,
    party: ["#ff8fb8", "#c9b5ff", "#ffffff"],
    step(pose, rig, dt, g) {
      const { head } = pose;
      for (const s of [-1, 1]) {
        const base = add(head.c, rot(head.up, s * 0.38), head.r * 0.8);
        // Floppy: each segment leans further out, so the ears arc over to the sides.
        const dirs = [0.4, 0.68, 0.98, 1.28].map((a) => rot(head.up, s * a));
        rig.stepChain(`ear${s}`, 5, base, dirs, head.r * 0.34, 0.06, g, 0.975, dt);
      }
    },
    build(root, mats, { buff, rig }) {
      const fur = mats.plush("#f7eff3");
      const pink = mats.plush("#ffb3c7", 0.7);
      const body = standardBody(
        root,
        {
          torso: fur,
          leg: fur,
          arm: fur,
          legR: 0.23,
          armR: 0.156,
          handR: 0.175,
          pad: [0.2, 0.24],
          footSize: [0.17, 0.11, 0.34],
          paint: (t) => decal(t, shape.ellipse(0, -0.08, 0.62, 0.7), mats.plush("#ffffff", 0.5), undefined, { lift: 0.01 }),
        },
        buff,
      );
      const tail = mesh(root, GEO.sphere, fur);
      const ears = [-1, 1].map(() => ({
        outer: new Limb(root, fur, [0.5, 0.56, 0.58, 0.56, 0.44], { flat: 0.45 }),
        inner: new Limb(root, pink, [0.22, 0.3, 0.32, 0.3, 0.2], { flat: 0.3 }),
      }));
      const bowMat = mats.gloss("#9b7bff");
      const bow = new THREE.Group();
      root.add(bow);
      for (const s of [-1, 1]) ball(bow, bowMat, [s * 0.32, 0, 0], [0.3, 0.2, 0.12]);
      ball(bow, bowMat, [0, 0, 0.04], 0.12);

      const head = new Head(root, fur, [1.05, 0.96, 0.95]);
      ball(head.group, mats.gloss("#ff7aa2"), [0, -0.16, 0.96], [0.12, 0.08, 0.07]);
      const whisker = mats.clay("#6d5560");
      for (const s of [-1, 1]) {
        for (const k of [-1, 1]) {
          const m = mesh(head.group, GEO.rod, whisker);
          placeRod(m, { x: s * 0.3, y: 0.28 }, { x: s * 0.95, y: 0.24 - k * 0.08 }, 0.85, 0.55, 0.012);
        }
      }
      const face = standardFace(head, mats, {
        eyes: [-1, 1].map((s) => [s * 0.38, 0.0, 0.19, "#8a5ab8"]),
        mouth: { x: 0, y: -0.3, w: 0.22, teeth: "buck" },
        brows: { y: 0.4, color: "#a9919c" },
        blush: { x: 0.62, y: -0.28, r: 0.15 },
      });

      return (pose, s) => {
        const info = body.update(pose, s);
        const { unit } = pose;
        placeBlob(tail, add(add(pose.hipMid, pose.right, unit * 0.5), pose.up, unit * 0.1), -info.rz * 0.3, unit * 0.2, unit * 0.2, unit * 0.2);
        const r = pose.head.r;
        const earZ = info.headZ - r * 0.35;
        ears.forEach(({ outer, inner }, i) => {
          const pts = rig.chain(`ear${i ? 1 : -1}`, 5).pts;
          outer.set(pts, r, earZ);
          inner.set(pts.slice(0), r, earZ + r * 0.12);
        });
        const knot = rig.chain("ear1", 5).pts[1];
        bow.position.set(knot.x, -knot.y, earZ + r * 0.3);
        bow.scale.setScalar(r);
        bow.rotation.set(0, 0, -pose.head.tilt - 0.3);
        head.place(pose.head, info.headZ);
        face(s);
        return { z: info.headZ };
      };
    },
  },

  // ---- Penguin: egg-shaped, white tummy, flippers, a striped scarf and a party hat.
  penguin: {
    label: "Penguin",
    head: 1.85,
    party: ["#e8455a", "#7cc7ff", "#ffffff"],
    step(pose, rig, dt, g) {
      const { unit } = pose;
      const knot = add(add(pose.neck, pose.right, unit * 0.22), pose.up, unit * 0.04);
      for (const [spread, name] of [
        [0.15, "scarfA"],
        [0.5, "scarfB"],
      ]) {
        const d = norm(add(scale(pose.right, spread), pose.up, -1));
        rig.stepChain(name, 5, knot, [d, d, d, d], unit * 0.13, 0.03, g, 0.99, dt);
      }
    },
    build(root, mats, { buff, rig }) {
      const back = mats.plush("#40568a", 0.6);
      const belly = mats.plush("#f7f8fc", 0.5);
      const orange = mats.clay("#ffa63d");
      const scarf = mats.plush("#e8455a");
      const stripe = mats.plush("#ffd4dc");
      const body = standardBody(
        root,
        {
          torso: back,
          leg: back,
          foot: orange,
          arm: back,
          hand: null,
          armFlat: 0.35,
          legR: 0.203,
          armR: 0.208,
          pad: [0.28, 0.34],
          center: 0.55,
          footSize: [0.22, 0.07, 0.27],
          paint: (t) => decal(t, shape.ellipse(0, -0.12, 0.7, 0.8), belly, undefined, { lift: 0.01, rounds: 4 }),
        },
        buff,
      );
      const band = mesh(root, GEO.smooth, scarf);
      const ends = ["scarfA", "scarfB"].map(() => new Limb(root, scarf, [1, 1, 1, 1, 0.95], { flat: 0.45, mats: [scarf, stripe] }));

      const head = new Head(root, back, [1, 1, 1]);
      for (const s of [-1, 1]) decal(head.group, shape.ellipse(s * 0.3, -0.1, 0.42, 0.56), belly, head.ell, { lift: 0.004 });
      // Party hat: stacked striped rings tapering to a pompom, at a jaunty angle.
      const hat = new THREE.Group();
      head.group.add(hat);
      hat.position.set(0.22, 0.8, 0.12);
      hat.rotation.z = -0.3;
      for (let i = 0; i < 4; i++) {
        const r0 = 0.34 * (1 - i / 4);
        const r1 = 0.34 * (1 - (i + 1) / 4);
        const m = mesh(hat, new THREE.CylinderGeometry(r1, r0, 0.2, 28), i % 2 ? stripe : scarf);
        m.position.y = 0.1 + i * 0.2;
      }
      ball(hat, mats.plush("#ffd23f"), [0, 0.84, 0], 0.13);
      // Beak: the lower half drops open in a laugh.
      ball(head.group, orange, [0, -0.2, 0.96], [0.2, 0.09, 0.16]);
      const lower = ball(head.group, orange, [0, -0.32, 0.92], [0.16, 0.07, 0.13]);
      const inside = ball(head.group, mats.gloss("#5a1f2a"), [0, -0.26, 0.88], [0.13, 0.06, 0.08]);
      const tongue = ball(head.group, mats.gloss("#ff7d9a"), [0, -0.3, 0.92], [0.08, 0.03, 0.05]);
      const eyes = [-1, 1].map((s) => makeEye(head.group, mats, head.surface(s * 0.3, 0.0), 0.15, "#3a5c9e"));
      const brows = makeBrows(head.group, mats, head.ell, { y: 0.34, spread: 0.3, color: "#24325a" });
      makeBlush(head.group, mats, head.ell, { x: 0.55, y: -0.3, r: 0.13 });

      return (pose, s) => {
        const info = body.update(pose, s);
        const { unit } = pose;
        placeBlob(band, add(pose.neck, pose.up, unit * 0.06), info.rz * 0.35, unit * 0.36, unit * 0.11, info.rz * 0.75, info.bodyAng);
        ends.forEach((l, i) => l.set(rig.chain(i ? "scarfB" : "scarfA", 5).pts, unit * 0.07, info.rz * 0.85));
        const gape = s.issues ? 0.01 : s.joy ? 0.2 : 0.12;
        lower.position.y = -0.24 - gape;
        inside.scale.y = 0.02 + gape * 0.55;
        inside.position.y = -0.22 - gape * 0.5;
        tongue.position.y = -0.24 - gape * 0.75;
        tongue.visible = inside.visible = gape > 0.05;
        head.place(pose.head, info.headZ);
        eyes.forEach((e) => e.update(s));
        brows.update(s);
        return { z: info.headZ };
      };
    },
  },

  // ---- Baby dragon: chubby and lavender, flapping wings, horns, a spiky tail with a heart.
  dragon: {
    label: "Baby dragon",
    head: 1.9,
    party: ["#ffd23f", "#ff8fc7", "#c9b8ff"],
    step(pose, rig, dt, g) {
      const { unit } = pose;
      const anchor = add(add(pose.hipMid, pose.right, unit * 0.25), pose.up, unit * 0.05);
      const dirs = bodyDirs(pose, [
        [1, 0.3],
        [1, 0],
        [0.9, -0.4],
        [0.6, -0.8],
        [0.2, -1],
        [-0.2, -1],
        [-0.5, -0.8],
      ]);
      rig.stepChain("tail", 8, anchor, dirs, unit * 0.17, 0.08, g, 0.98, dt);
      rig.stepWings(pose, dt);
    },
    build(root, mats, { buff, rig }) {
      const skin = mats.clay("#9b7bff");
      const dark = mats.clay("#6d4fd6");
      const light = mats.clay("#c9b8ff");
      const yellow = mats.decal("#ffe08a");
      const stripeMat = mats.decal("#e9b94a");
      const pink = mats.clay("#ff8fc7");
      const cream = mats.clay("#fff3d1");
      const body = standardBody(
        root,
        {
          torso: skin,
          leg: skin,
          foot: dark,
          arm: skin,
          legR: 0.257,
          armR: 0.169,
          handR: 0.175,
          pad: [0.22, 0.26],
          paint(t) {
            decal(t, shape.ellipse(0, -0.06, 0.55, 0.74), yellow, undefined, { lift: 0.01, rounds: 4 });
            for (const y of [-0.4, -0.12, 0.16, 0.42]) {
              const half = 0.53 * Math.sqrt(1 - ((y + 0.06) / 0.74) ** 2);
              decal(t, shape.band([[-half, y], [half, y]], 0.035), stripeMat, undefined, { lift: 0.018 });
            }
          },
        },
        buff,
      );
      // Wings: a thin scalloped membrane with two ribs, one mirrored per side.
      const w = new THREE.Shape();
      const fingers = [
        [1, 0],
        [0.72, -0.42],
        [0.42, -0.5],
        [0.12, -0.36],
      ];
      w.moveTo(0, 0);
      w.quadraticCurveTo(0.5, 0.16, 1, 0);
      for (let i = 1; i < fingers.length; i++) {
        const [a, b] = [fingers[i - 1], fingers[i]];
        w.quadraticCurveTo(((a[0] + b[0]) / 2) * 0.7, ((a[1] + b[1]) / 2) * 0.7, b[0], b[1]);
      }
      w.closePath();
      const wingGeo = new THREE.ExtrudeGeometry(w, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2 });
      const wingMat = mats.clay("#ffb3dd");
      const ribMat = mats.clay("#e27bb8");
      const wings = [-1, 1].map(() => {
        const g = new THREE.Group();
        root.add(g);
        mesh(g, wingGeo, wingMat);
        for (const [x, y] of fingers.slice(1, 3)) {
          const m = mesh(g, GEO.rod, ribMat);
          placeRod(m, { x: 0, y: 0 }, { x, y: -y }, 0.05, 0.05, 0.02);
        }
        return g;
      });
      const tail = new Limb(root, skin, [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.42, 0.34]);
      const spikes = Array.from({ length: 6 }, () => mesh(root, GEO.cone, pink));
      const heart = mesh(root, GEO.heart, mats.gloss("#ff6fae"));
      const toes = [0, 1].map(() => nubs(root, cream, 3));

      const head = new Head(root, skin, [1.05, 0.95, 0.95]);
      for (const s of [-1, 1]) {
        const horn = mesh(head.group, GEO.cone, cream);
        horn.position.set(s * 0.5, 0.92, 0);
        horn.scale.set(0.13, 0.45, 0.13);
        horn.rotation.z = -s * 0.45;
      }
      for (const k of [-1, 0, 1]) {
        const sp = mesh(head.group, GEO.cone, pink);
        sp.position.set(k * 0.17, 0.95, -0.2);
        sp.scale.set(0.08, 0.22, 0.08);
      }
      const snoutEll = { c: [0, -0.36, 0.68], r: [0.46, 0.32, 0.36] };
      ball(head.group, light, snoutEll.c, snoutEll.r, GEO.smooth);
      for (const s of [-1, 1]) ball(head.group, mats.gloss("#3b2a7a"), [s * 0.12, -0.24, 1.0], [0.04, 0.03, 0.03]);
      const puffMat = mats.plush("#ffffff", 0.3);
      const puffs = [-1, 1].map(() => mesh(head.group, GEO.sphere, puffMat));
      const face = standardFace(head, mats, {
        eyes: [-1, 1].map((s) => [s * 0.4, -0.14, 0.19, "#ffb800"]),
        mouthOn: snoutEll,
        mouth: { x: 0, y: -0.4, w: 0.26, teeth: "fangs" },
        brows: { y: 0.48, spread: 0.4, color: "#5b3fc0" },
        blush: { x: 0.72, y: -0.24, r: 0.14 },
      });

      return (pose, s) => {
        const info = body.update(pose, s);
        const { unit } = pose;
        const backZ = -info.rz * 0.5;
        // Each wing rises and flaps with its arm (angles from the rig).
        pose.arms.forEach(([sh], i) => {
          const side = sideOf(pose, sh);
          const a = s.wings[i].a + Math.sin(s.clock * 7 + side) * 0.05;
          const dir = norm(add(scale(scale(pose.right, side), Math.cos(a)), pose.up, Math.sin(a)));
          const rootPt = add(add(sh, pose.up, unit * 0.05), pose.right, -side * unit * 0.08);
          const g = wings[i];
          g.position.set(rootPt.x, -rootPt.y, backZ);
          const L = unit * 1.15;
          g.scale.set(side * L, L, L);
          g.rotation.set(0, 0, Math.atan2(-dir.y, dir.x) + (side < 0 ? Math.PI : 0));
        });
        const pts = rig.chain("tail", 8).pts;
        tail.set(pts, unit * 0.17, backZ);
        spikes.forEach((m, k) => {
          const i = k + 1;
          const d = norm(sub(pts[i + 1], pts[i - 1]));
          const n = { x: d.y, y: -d.x };
          const base = add(pts[i], n, unit * (0.15 - i * 0.016));
          placeRod(m, base, add(base, n, unit * (0.13 - i * 0.012)), backZ, backZ, unit * (0.07 - i * 0.006));
        });
        const tip = pts.at(-1);
        const tipDir = norm(sub(tip, pts.at(-2)));
        const hp = add(tip, tipDir, unit * 0.1);
        heart.position.set(hp.x, -hp.y, backZ);
        heart.scale.setScalar(unit * 0.17);
        heart.rotation.set(0, 0, Math.atan2(-tipDir.y, tipDir.x) - Math.PI / 2);
        pose.legs.forEach((leg, i) => {
          const ok = leg[1] && leg[2];
          toes[i].forEach((m) => (m.visible = !!ok));
          if (ok) placeNubs(toes[i], add(leg[2], { x: 0, y: 1 }, unit * 0.1), { x: 0, y: 1 }, unit * 0.34, unit * 0.045, unit * 0.09);
        });
        // Little smoke puffs drifting up and out of the nostrils.
        puffs.forEach((m, i) => {
          const sd = i ? 1 : -1;
          const t = (s.clock * 0.7 + i * 0.5) % 1;
          m.position.set(sd * (0.14 + t * 0.3), -0.2 + t * 0.45, 1.0);
          m.scale.setScalar(Math.sin(t * Math.PI) * 0.09);
        });
        head.place(pose.head, info.headZ);
        face(s);
        return { z: info.headZ };
      };
    },
  },

  // ---- Space critter: wobbly mint jelly, three googly eyes, glitter inside.
  critter: {
    label: "Space critter",
    head: 1.6,
    party: ["#a678ff", "#6fe0b4", "#ffffff"],
    step(pose, rig, dt, g, h) {
      rig.stepWobble(dt, h);
    },
    build(root, mats, { buff }) {
      const jelly = mats.gloss("#6fe0b4");
      const limb = mats.gloss("#4cc79a");
      const spot = mats.gloss("#a678ff");
      const body = standardBody(
        root,
        {
          torso: jelly,
          leg: limb,
          foot: mats.gloss("#3aa883"),
          arm: jelly,
          hand: limb,
          legR: 0.243,
          armR: 0.156,
          handR: 0.163,
          pad: [0.24, 0.24],
          jelly: true,
          paint(t) {
            decal(t, shape.ellipse(0, -0.25, 0.5, 0.55), mats.decal("#a8f0d2", { roughness: 0.2, clearcoat: 1 }), undefined, { lift: 0.01, rounds: 4 });
            for (const [x, y, r] of [
              [-0.55, 0.35, 0.12],
              [0.6, 0.05, 0.09],
              [-0.45, -0.45, 0.08],
            ]) {
              const k = Math.sqrt(Math.max(0, 1 - x * x - y * y));
              ball(t, spot, [x, y, k * 0.96], r);
            }
          },
        },
        buff,
      );
      // Glitter suspended in the jelly, twinkling.
      const glitter = Array.from({ length: 7 }, (_, i) => {
        const x = (hash(i) - 0.5) * 1.2;
        const y = (hash(i + 9) - 0.5) * 1.3;
        return ball(body.torso, mats.glow("#ffffff"), [x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y)) * 0.98], 0.03);
      });
      const neck = new Limb(root, jelly, [1, 1]);

      const head = new Head(root, jelly, [1.3, 1.08, 1.05]);
      for (const [x, y, r] of [
        [-0.75, 0.6, 0.12],
        [0.85, 0.45, 0.09],
      ]) {
        ball(head.group, spot, [x, y, Math.sqrt(Math.max(0, 1 - (x / 1.3) ** 2 - (y / 1.08) ** 2)) * 1.0], r);
      }
      const face = standardFace(head, mats, {
        eyes: [
          [-0.6, -0.12, 0.25, "#3a2a6b"],
          [0, -0.3, 0.33, "#3a2a6b"],
          [0.6, -0.12, 0.25, "#3a2a6b"],
        ],
        // One wobble, mirrored and scaled per eye: happily cross-eyed.
        lookFor: (look, i) => ({ x: look.x * [-0.8, 1.2, 0.8][i], y: look.y }),
        mouth: { x: 0, y: -0.32, w: 0.42, teeth: "one" },
        blush: { x: 0.85, y: -0.3, r: 0.15 },
      });

      return (pose, s) => {
        const info = body.update(pose, s);
        const { unit } = pose;
        glitter.forEach((m, i) => m.scale.setScalar(0.015 + 0.03 * Math.max(0, Math.sin(s.clock * 3 + i * 1.7))));
        neck.set([pose.neck, lerp(pose.neck, pose.head.c, 0.6)], unit * 0.09, info.rz * 0.3);
        head.place(pose.head, info.headZ);
        head.group.scale.multiply(V(1 + s.wobble * 0.8, 1 - s.wobble * 0.8, 1));
        face(s);
        return { z: info.headZ };
      };
    },
  },

  // ---- Platypus: sleek brown fur, a wide slate bill, swim goggles, a paddle tail.
  platypus: {
    label: "Platypus",
    head: 1.9,
    party: ["#7fdc5a", "#9fe3ff", "#ffd23f"],
    step(pose, rig, dt, g) {
      const { unit } = pose;
      const anchor = add(add(pose.hipMid, pose.right, unit * 0.2), pose.up, -unit * 0.08);
      const wag = Math.sin(rig.clock * 2.6) * 0.22;
      const dirs = bodyDirs(pose, [
        [0.7, 0.7],
        [1, 0.3],
        [1, 0.05],
        [1, -0.1],
      ]).map((d) => rot(d, wag));
      rig.stepChain("tail", 5, anchor, dirs, unit * 0.16, 0.1, g, 0.98, dt);
    },
    build(root, mats, { buff, rig }) {
      const fur = mats.plush("#8a5a3b", 0.7);
      const slate = mats.clay("#6b7385");
      const strap = mats.clay("#7fdc5a");
      const body = standardBody(
        root,
        {
          torso: fur,
          leg: fur,
          foot: slate,
          arm: fur,
          hand: slate,
          legR: 0.203,
          armR: 0.156,
          handR: 0.163,
          footSize: [0.24, 0.06, 0.28],
          paint: (t) => decal(t, shape.ellipse(0, -0.06, 0.6, 0.72), mats.plush("#e3c39a", 0.5), undefined, { lift: 0.01, rounds: 4 }),
        },
        buff,
      );
      const tail = new Limb(root, mats.plush("#5e3b25", 0.6), [0.7, 0.95, 1.15, 1.28, 1.3], { flat: 0.28 });

      const head = new Head(root, fur, [1.02, 0.94, 0.95]);
      const billEll = { c: [0, -0.44, 0.72], r: [0.78, 0.3, 0.44] };
      ball(head.group, slate, billEll.c, billEll.r, GEO.smooth);
      for (const s of [-1, 1]) ball(head.group, mats.gloss("#2b2f38"), [s * 0.13, -0.24, 1.08], [0.05, 0.025, 0.03]);
      // Swim goggles pushed up: a strap round the head, two rims with lenses.
      const strapPts = shape.quad([-1.05, 0.42], [0, 0.92], [1.05, 0.42]);
      decal(head.group, shape.band(strapPts, 0.13), strap, head.ell, { lift: 0.006 });
      for (const s of [-1, 1]) {
        const at = head.surface(s * 0.32, -0.66);
        const rim = mesh(head.group, GEO.ring, strap);
        rim.position.copy(at);
        rim.scale.setScalar(0.17);
        ball(head.group, mats.gloss("#9fe3ff"), [at.x, at.y, at.z], [0.15, 0.15, 0.07]);
      }
      const face = standardFace(head, mats, {
        eyes: [-1, 1].map((s) => [s * 0.37, -0.1, 0.16, "#5a3a22"]),
        mouthOn: billEll,
        mouth: { x: 0, y: -0.46, w: 0.4, teeth: "none" },
        brows: { y: 0.34, spread: 0.37, color: "#5e3b25" },
        blush: { x: 0.72, y: -0.08, r: 0.13 },
      });

      return (pose, s) => {
        const info = body.update(pose, s);
        tail.set(rig.chain("tail", 5).pts, pose.unit * 0.2, -info.rz * 0.5);
        head.place(pose.head, info.headZ);
        face(s);
        return { z: info.headZ };
      };
    },
  },

  // ---- Fuzzy monster: big, shaggy and tangerine, teal spots, one curly horn, an underbite.
  monster: {
    label: "Fuzzy monster",
    head: 1.8,
    party: ["#2fb7a4", "#ffd23f", "#ff9a4d"],
    step(pose, rig, dt, g) {
      const { head } = pose;
      [-0.75, -0.35, 0.35, 0.75].forEach((a, i) => {
        const out = rot(head.up, a);
        const droop = norm(add(out, { x: 0, y: 1 }, 0.7));
        rig.stepChain(`tuft${i}`, 3, add(head.c, out, head.r * 0.85), [out, droop], head.r * 0.36, 0.08, g, 0.97, dt);
      });
    },
    build(root, mats, { buff, rig }) {
      const fur = mats.plush("#ff9a4d");
      const darkFur = mats.plush("#d9662a");
      const claw = mats.clay("#fff8ea");
      const teal = mats.decal("#2fb7a4");
      const body = standardBody(
        root,
        {
          torso: fur,
          leg: fur,
          arm: fur,
          legR: 0.297,
          armR: 0.234,
          handR: 0.263,
          pad: [0.3, 0.3],
          footSize: [0.21, 0.12, 0.26],
          paint(t) {
            decal(t, shape.ellipse(0, -0.08, 0.56, 0.68), mats.plush("#ffe2c4", 0.6), undefined, { lift: 0.01, rounds: 4 });
            for (const [x, y, r] of [
              [-0.72, 0.42, 0.11],
              [0.74, 0.18, 0.09],
              [-0.7, -0.36, 0.08],
              [0.66, -0.5, 0.1],
            ]) {
              decal(t, shape.ellipse(x, y, r, r * 0.85), teal, undefined, { lift: 0.012 });
            }
          },
        },
        buff,
      );
      const claws = [0, 1, 2, 3].map(() => nubs(root, claw, 3));
      const tufts = Array.from({ length: 4 }, () => new Limb(root, fur, [1, 0.55, 0.15]));

      const head = new Head(root, fur, [1.04, 0.94, 0.95]);
      for (const s of [-1, 1]) {
        ball(head.group, fur, [s * 0.98, 0.05, -0.1], 0.22);
        ball(head.group, darkFur, [s * 1.0, 0.05, 0.06], [0.11, 0.11, 0.06]);
      }
      staticTube(
        head.group,
        mats.clay("#f6edd9"),
        [
          [-0.12, 0.62, 0.15],
          [-0.18, 1.08, 0.2],
          [-0.04, 1.42, 0.18],
          [0.18, 1.62, 0.12],
          [0.32, 1.66, 0.08],
        ],
        [0.24, 0.2, 0.15, 0.09, 0.04],
      );
      const face = standardFace(head, mats, {
        eyes: [-1, 1].map((s) => [s * 0.35, -0.14, 0.2, "#2fa38a"]),
        mouth: { x: 0, y: -0.3, w: 0.46, teeth: "under", color: "#5a1f2a" },
        brows: { y: 0.48, spread: 0.35, color: "#c4512a" },
        blush: { x: 0.7, y: -0.22, r: 0.14 },
      });

      return (pose, s) => {
        const info = body.update(pose, s);
        const { unit } = pose;
        tufts.forEach((t, i) => t.set(rig.chain(`tuft${i}`, 3).pts, pose.head.r * 0.2, info.headZ - pose.head.r * 0.35));
        pose.arms.forEach(([, el, wr], i) => {
          claws[i].forEach((m) => (m.visible = !!(el && wr)));
          if (el && wr) placeNubs(claws[i], add(handOf(el, wr, unit), norm(sub(wr, el)), unit * 0.14), norm(sub(wr, el)), info.armZ[2] + unit * 0.05, unit * 0.055, unit * 0.1);
        });
        [2, 3].forEach((c, i) => {
          const leg = pose.legs[i];
          const ok = leg && leg[1] && leg[2];
          claws[c].forEach((m) => (m.visible = !!ok));
          if (ok) placeNubs(claws[c], add(leg[2], { x: 0, y: 1 }, unit * 0.1), { x: 0, y: 1 }, unit * 0.36, unit * 0.055, unit * 0.1);
        });
        head.place(pose.head, info.headZ);
        face(s);
        return { z: info.headZ };
      };
    },
  },

  // ---- Robot: a friendly tin robot with a screen face, bolts and a springy antenna.
  robot: {
    label: "Robot",
    head: 1.75,
    party: ["#5ff2d6", "#ff8a3d", "#ffd23f"],
    step(pose, rig, dt, g) {
      const up = pose.head.up;
      rig.stepChain("antenna", 5, add(pose.head.c, up, pose.head.r * 0.8), [up, up, up, up], pose.head.r * 0.16, 0.14, g, 0.985, dt);
    },
    build(root, mats, { buff, rig }) {
      const metal = mats.metal("#c3cedd", 0.32);
      const dark = mats.metal("#7d8aa0", 0.4);
      const joint = mats.metal("#5d6880", 0.35);
      const screen = mats.gloss("#16222f");
      const glow = mats.glow("#5ff2d6");
      const bulb = mats.glow("#ff8a3d");
      const torso = mesh(root, new RoundedBoxGeometry(2, 2, 2, 4, 0.36), metal);
      const panel = mesh(root, new RoundedBoxGeometry(1, 1, 1, 3, 0.15), screen);
      const leds = [glow, bulb, mats.glow("#ffd23f")].map((m) => mesh(root, GEO.sphere, m));
      const belt = mesh(root, GEO.smooth, joint);
      const armRel = [1 + 0.5 * buff, 0.95 + 0.3 * buff, 0.85];
      const legs = [0, 1].map(() => new Limb(root, metal, [1, 1, 0.95], { ballMat: joint }));
      const arms = [0, 1].map(() => new Limb(root, metal, armRel, { ballMat: joint }));
      const boots = [0, 1].map(() => mesh(root, new RoundedBoxGeometry(1, 1, 1, 3, 0.25), dark));
      const grippers = [0, 1].map(() => mesh(root, new THREE.TorusGeometry(1, 0.3, 12, 24, Math.PI * 1.45), dark));

      const head = new THREE.Group();
      root.add(head);
      mesh(head, new RoundedBoxGeometry(2, 1.76, 1.7, 4, 0.36), metal);
      const face = mesh(head, new RoundedBoxGeometry(1.52, 1.1, 0.2, 3, 0.09), screen);
      face.position.z = 0.78;
      for (const s of [-1, 1]) {
        const bolt = mesh(head, GEO.rod, joint);
        bolt.rotation.z = Math.PI / 2;
        bolt.position.x = s * 1.05;
        bolt.scale.set(0.2, 0.2, 0.2);
        ball(head, bulb, [s * 1.16, 0, 0], 0.06);
      }
      // Face on the glass: LED eyes (hearts after a rep), a glowing smile or a wobble.
      const faceZ = 0.9;
      const eyes = [-1, 1].map(() => mesh(head, GEO.sphere, glow));
      const hearts = [-1, 1].map(() => mesh(head, GEO.heart, mats.glow("#ff7aa8")));
      const smile = mesh(head, new THREE.TorusGeometry(0.3, 0.05, 8, 28, Math.PI), glow);
      smile.rotation.z = Math.PI;
      smile.position.set(0, -0.12, faceZ);
      const smileFill = mesh(head, new THREE.CircleGeometry(0.3, 28, Math.PI, Math.PI), mats.glow("#5ff2d6", 0.25));
      smileFill.position.set(0, -0.12, faceZ - 0.005);
      const wobble = new THREE.Group();
      head.add(wobble);
      for (let i = 0; i < 8; i++) {
        const m = mesh(wobble, GEO.rod, glow);
        placeRod(m, { x: -0.3 + i * 0.075, y: 0.3 + (i % 2 ? -0.05 : 0.05) }, { x: -0.3 + (i + 1) * 0.075, y: 0.3 + (i % 2 ? 0.05 : -0.05) }, faceZ, faceZ, 0.03);
      }
      const worried = new THREE.Group();
      head.add(worried);
      for (const s of [-1, 1]) {
        const m = mesh(worried, GEO.rod, glow);
        placeRod(m, { x: s * 0.34 - s * 0.13, y: -0.42 }, { x: s * 0.34 + s * 0.13, y: -0.32 }, faceZ, faceZ, 0.03);
      }
      for (const s of [-1, 1]) ball(head, mats.glow("#ff7aa8", 0.4), [s * 0.54, -0.18, faceZ], [0.11, 0.06, 0.01]);
      const antenna = new Limb(root, dark, [1, 1, 1, 1, 1]);
      const tip = mesh(root, GEO.sphere, bulb);

      return (pose, s) => {
        const { unit } = pose;
        const [shA, shB] = pose.shoulders;
        const [hipA, hipB] = pose.hips;
        const shMid = mid(shA, shB);
        const bodyAng = Math.atan2(pose.up.x, -pose.up.y);
        const bc = add(lerp(shMid, pose.hipMid, 0.5), pose.up, -unit * 0.08);
        const rx = Math.max(dist(shA, shB), dist(hipA, hipB)) / 2 + unit * 0.26;
        const ry = dist(shMid, pose.hipMid) / 2 + unit * 0.3;
        const rz = Math.min(rx, ry) * 0.7;
        placeBlob(torso, bc, 0, rx, ry, rz, bodyAng);
        const pc = lerp(shMid, pose.hipMid, 0.36);
        placeBlob(panel, pc, rz, unit * 0.56, unit * 0.32, unit * 0.06, bodyAng);
        leds.forEach((m, i) => {
          const on = Math.floor(s.clock * 3) % 3 === i;
          const p = add(lerp(shMid, pose.hipMid, 0.66), pose.right, (i - 1) * unit * 0.14);
          const r = unit * (on ? 0.06 : 0.04);
          placeBlob(m, p, rz + unit * 0.02, r, r, r);
        });
        placeBlob(belt, pose.hipMid, 0, dist(hipA, hipB) / 2 + unit * 0.2, unit * 0.08, rz * 1.02, bodyAng);

        pose.legs.length || legs.forEach((l) => l.hide());
        boots.forEach((b) => (b.visible = false));
        pose.legs.forEach(([hip, kn, an], i) => {
          if (!kn) return legs[i].hide();
          legs[i].set(an ? [hip, kn, an] : [hip, kn], unit * 0.11, 0);
          if (!an) return;
          placeBlob(boots[i], add(an, { x: 0, y: 1 }, unit * 0.08), unit * 0.12, unit * 0.36, unit * 0.2, unit * 0.48);
          boots[i].visible = true;
        });
        const armZ = [rz * 0.25, rz * 0.5, rz * 0.7];
        pose.arms.forEach(([sh, el, wr], i) => {
          grippers[i].visible = !!(el && wr);
          if (!el) return arms[i].hide();
          arms[i].set(wr ? [sh, el, wr] : [sh, el], unit * 0.09, armZ);
          if (!wr) return;
          const hand = handOf(el, wr, unit);
          const ang = Math.atan2(-(wr.y - el.y), wr.x - el.x);
          grippers[i].position.set(hand.x, -hand.y, armZ[2]);
          grippers[i].scale.setScalar(unit * 0.11);
          grippers[i].rotation.set(0, 0, ang + Math.PI * 0.275 + Math.PI);
        });

        const h = pose.head;
        const headZ = rz * 0.6;
        head.position.set(h.c.x, -h.c.y, headZ);
        head.scale.setScalar(h.r);
        head.rotation.set(0, h.yaw * 0.5, -h.tilt);
        eyes.forEach((m, i) => {
          const sd = i ? 1 : -1;
          m.visible = !s.joy;
          m.position.set(sd * 0.34 + s.look.x * 0.08, 0.1 - s.look.y * 0.06, faceZ);
          m.scale.set(0.11, s.blink ? 0.025 : 0.17, 0.03);
          hearts[i].visible = s.joy;
          hearts[i].position.set(sd * 0.34, 0.1, faceZ);
          hearts[i].scale.setScalar(0.17);
        });
        smile.visible = smileFill.visible = !s.issues;
        smile.scale.set(1, s.joy ? 1.35 : 1, 1);
        smileFill.scale.set(1, s.joy ? 1.35 : 1, 1);
        wobble.visible = worried.visible = s.issues;

        const ant = rig.chain("antenna", 5).pts;
        antenna.set(ant, h.r * 0.05, headZ - h.r * 0.2);
        const tp = ant.at(-1);
        const pulse = h.r * (0.12 + 0.03 * Math.sin(s.clock * 4));
        placeBlob(tip, tp, headZ - h.r * 0.2, pulse, pulse, pulse);
        return { z: headZ };
      };
    },
  },
};
