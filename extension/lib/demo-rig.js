// ---------------------------------------------------------------------------
// The Blender human's skeleton, posed like the demo mannequin
// ---------------------------------------------------------------------------
// The exercise demo shows the digital human built in Blender (packages/avatar-assets, coach-01,
// copied to models/coach-01.glb). lib/demo-model.js says where the mannequin's joints are at each
// moment of a move; this module turns that into rotations for the human's bones, so the human does
// the same move. The coach's rep counter checks the result like it checks the mannequin
// (tests/check.mjs).
//
// No DOM and no three.js here: the page's renderer copies the rotations onto the model's bones.
import { demoChest, demoMotion, demoPose, demoUpright } from "./demo-model.js";
import { EXERCISES } from "./pose/exercises.js";

/** @typedef {[number, number, number]} P3 */
/** A rotation as a unit quaternion: x, y, z, w. @typedef {[number, number, number, number]} Q */
/** A bone at rest, relative to its parent. @typedef {{ name: string, parent: number, t: P3, r: Q }} Bone */
/** A skeleton, parents before children. @typedef {{ bones: Bone[], byName: Map<string, number> }} Rig */

// ---- Quaternions -----------------------------------------------------------------
/** @type {Q} */
const IDENTITY = [0, 0, 0, 1];
/** @param {Q} a @param {Q} b @returns {Q} */
function qmul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
/** @param {Q} q @returns {Q} */
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
/** Rotates a vector. @param {Q} q @param {P3} v @returns {P3} */
function qrot(q, v) {
  const r = qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q));
  return [r[0], r[1], r[2]];
}

// ---- Reading the model ---------------------------------------------------------------
/**
 * The skeleton of a GLB file's first skin, in its rest pose. Ancestors that aren't bones (Blender's
 * armature object) are folded into the top bone.
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {Rig}
 */
export function rigFromGlb(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("not a GLB file");
  const jsonLength = view.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jsonLength)));
  /** @type {{ name?: string, children?: number[], translation?: P3, rotation?: Q, scale?: P3 }[]} */
  const nodes = gltf.nodes;
  const joints = new Set(gltf.skins[0].joints);
  /** @type {Map<number, number>} */
  const parentOf = new Map();
  nodes.forEach((n, i) => n.children?.forEach((c) => parentOf.set(c, i)));
  for (const i of joints) {
    if (n3(nodes[i].scale ?? [1, 1, 1]).some((s) => Math.abs(s - 1) > 1e-4)) throw new Error(`bone ${nodes[i].name} is scaled`);
  }
  /** Where a node is in the world, from its non-bone ancestors (they hold no bones' rest pose). */
  const above = (i) => {
    /** @type {{ t: P3, r: Q }} */
    let at = { t: [0, 0, 0], r: IDENTITY };
    for (let p = parentOf.get(i); p != null; p = parentOf.get(p)) {
      const n = nodes[p];
      const t = qrot(n.rotation ?? IDENTITY, at.t);
      at = { t: add(t, n.translation ?? [0, 0, 0]), r: qmul(n.rotation ?? IDENTITY, at.r) };
    }
    return at;
  };
  /** @type {Bone[]} */
  const bones = [];
  /** @type {Map<number, number>} */
  const index = new Map();
  /** @param {number} i @param {number} parent */
  const visit = (i, parent) => {
    const n = nodes[i];
    let t = n3(n.translation ?? [0, 0, 0]);
    let r = qnorm(/** @type {Q} */ ([...(n.rotation ?? IDENTITY)])); // float32 in the file
    if (parent < 0) {
      const at = above(i);
      t = add(qrot(at.r, t), at.t);
      r = qmul(at.r, r);
    }
    index.set(i, bones.length);
    bones.push({ name: n.name ?? `bone${i}`, parent, t, r });
    const me = bones.length - 1;
    for (const c of n.children ?? []) if (joints.has(c)) visit(c, me);
  };
  for (const i of joints) if (!joints.has(parentOf.get(i) ?? -1)) visit(i, -1);
  return { bones, byName: new Map(bones.map((b, i) => [b.name, i])) };
}

/** @param {number[]} v @returns {P3} */
const n3 = (v) => [v[0], v[1], v[2]];
/** @param {P3} a @param {P3} b @returns {P3} */
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
/** @param {P3} a @param {P3} b @returns {P3} */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// ---- The coach's landmarks on the human ----------------------------------------------
// MediaPipe's 33 pose landmarks, each on a bone: at the bone's head, or at a spot on the mesh
// measured in the rest pose (the face from the Body mesh, the eyes from avatar-assets' manifest,
// heel and toe from the shoes). Given for the person's left; the right is the mirror image.
/** @type {[index: number, bone: string, rest?: P3][]} */
const LEFT_POINTS = [
  [1, "head", [0.015, 1.6885, 0.137]], // eye, inner corner
  [2, "head", [0.03, 1.6885, 0.1371]], // eye
  [3, "head", [0.045, 1.6885, 0.13]], // eye, outer corner
  [7, "head", [0.09, 1.683, 0.04]], // ear
  [9, "head", [0.024, 1.607, 0.149]], // mouth corner
  [11, "upperarm_l"],
  [13, "lowerarm_l"],
  [15, "hand_l"],
  [17, "pinky_01_l"],
  [19, "index_01_l"],
  [21, "thumb_02_l"],
  [23, "thigh_l"],
  [25, "calf_l"],
  [27, "foot_l"],
  [29, "foot_l", [0.199, 0.006, -0.058]], // heel
  [31, "foot_l", [0.189, 0.011, 0.225]], // toe
];
/** The right side's landmark for each left one (MediaPipe numbers the face's differently). */
const RIGHT_OF = { 1: 4, 2: 5, 3: 6, 7: 8, 9: 10 };
/** @type {[index: number, bone: string, rest?: P3][]} */
const POINTS = [
  [0, "head", [0, 1.646, 0.179]], // nose tip
  ...LEFT_POINTS,
  ...LEFT_POINTS.map(([i, bone, rest]) => /** @type {[number, string, P3?]} */ ([RIGHT_OF[i] ?? i + 1, bone.replace(/_l$/, "_r"), rest && [-rest[0], rest[1], rest[2]]])),
];

/** @type {WeakMap<Rig, { bone: number, offset: P3 }[]>} */
const ANCHORS = new WeakMap();
/** Each landmark as a bone and an offset in that bone's frame. @param {Rig} rig */
function anchors(rig) {
  let out = ANCHORS.get(rig);
  if (out) return out;
  const rest = rigWorld(rig);
  out = [];
  for (const [i, name, at] of POINTS) {
    const bone = rig.byName.get(name);
    if (bone == null) throw new Error(`the model has no ${name} bone`);
    out[i] = { bone, offset: at ? qrot(qinv(rest.q[bone]), sub(at, rest.p[bone])) : [0, 0, 0] };
  }
  ANCHORS.set(rig, out);
  return out;
}

/**
 * The 33 landmarks the coach measures (MediaPipe's pose landmarks), on the posed human.
 * @param {Rig} rig
 * @param {{ p: P3[], q: Q[] }} world from rigWorld
 * @returns {P3[]}
 */
export function rigLandmarks(rig, world) {
  return anchors(rig).map(({ bone, offset }) => add(world.p[bone], qrot(world.q[bone], offset)));
}

/**
 * Where every bone is: its head's position and its rotation in the world, for local rotations
 * `local` (one per bone; the rest pose by default), with the whole skeleton moved by `root`.
 * @param {Rig} rig
 * @param {readonly Q[]} [local]
 * @param {P3} [root]
 * @returns {{ p: P3[], q: Q[] }}
 */
export function rigWorld(rig, local = rig.bones.map((b) => b.r), root = [0, 0, 0]) {
  /** @type {P3[]} */
  const p = [];
  /** @type {Q[]} */
  const q = [];
  rig.bones.forEach((b, i) => {
    if (b.parent < 0) {
      p.push(add(b.t, root));
      q.push(local[i]);
    } else {
      p.push(add(p[b.parent], qrot(q[b.parent], b.t)));
      q.push(qmul(q[b.parent], local[i]));
    }
  });
  return { p, q };
}

// ---- Posing --------------------------------------------------------------------------
/** @param {P3} a @param {P3} b */
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** @param {P3} a @param {P3} b @returns {P3} */
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** @param {P3} a @returns {P3} */
const unit = (a) => {
  const n = Math.hypot(...a) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};
/** @param {Q} q @returns {Q} */
const qnorm = (q) => {
  const n = Math.hypot(...q) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
};
/** The shortest rotation taking direction `a` to direction `b`. @param {P3} a @param {P3} b @returns {Q} */
function swing(a, b) {
  const ua = unit(a);
  const ub = unit(b);
  const d = dot(ua, ub);
  if (d < -0.999999) {
    const axis = unit(cross(ua, Math.abs(ua[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
    return [axis[0], axis[1], axis[2], 0];
  }
  const c = cross(ua, ub);
  return qnorm([c[0], c[1], c[2], 1 + d]);
}

/** A rotation matrix's quaternion (columns: where x, y and z go). @param {P3} x @param {P3} y @param {P3} z @returns {Q} */
function qFromAxes(x, y, z) {
  const [m00, m10, m20] = x;
  const [m01, m11, m21] = y;
  const [m02, m12, m22] = z;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return qnorm([(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s]);
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return qnorm([0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]);
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return qnorm([(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]);
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return qnorm([(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]);
}
/** The axes of a body part, as a rotation: `x` across it (to the person's left), `up` along it. @param {P3} x @param {P3} up @returns {Q} */
function frame(x, up) {
  const ux = unit(x);
  const uy = unit(sub(up, scale(ux, dot(up, ux))));
  return qFromAxes(ux, uy, cross(ux, uy));
}
/** @param {P3} a @param {number} k @returns {P3} */
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
/** @param {P3} a @param {P3} b @returns {P3} */
const midpoint = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
/** Part way from rotation `a` to `b`. @param {Q} a @param {Q} b @param {number} k @returns {Q} */
function slerp(a, b, k) {
  let d = dot4(a, b);
  const bb = d < 0 ? /** @type {Q} */ (b.map((v) => -v)) : b;
  d = Math.abs(d);
  if (d > 0.9995) return qnorm(/** @type {Q} */ (a.map((v, i) => v + (bb[i] - v) * k)));
  const th = Math.acos(d);
  const wa = Math.sin((1 - k) * th) / Math.sin(th);
  const wb = Math.sin(k * th) / Math.sin(th);
  return /** @type {Q} */ (a.map((v, i) => v * wa + bb[i] * wb));
}
/** @param {Q} a @param {Q} b */
const dot4 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];

/**
 * How the hips (pelvis), the chest and the head are turned, from landmarks. The torso runs up from
 * the hips to `chest`, the middle of the chest (by default the middle of the shoulders).
 * @param {readonly P3[]} l @param {P3 | null} [chest]
 */
function bodyFrames(l, chest = null) {
  const up = sub(chest ?? midpoint(l[11], l[12]), midpoint(l[23], l[24]));
  return {
    pelvis: frame(sub(l[23], l[24]), up),
    chest: frame(sub(l[11], l[12]), up),
    head: frame(sub(l[7], l[8]), cross(sub(l[0], midpoint(l[7], l[8])), sub(l[7], l[8]))),
    neck: sub(midpoint(l[7], l[8]), midpoint(l[11], l[12])),
  };
}

// The limbs, for the person's left (the right is +1): each bone and the landmarks it spans.
//
// A bone points along the mannequin's segment by the shortest turn from a starting pose, which sets
// how it twists about its own length. The shortest turn is unsteady near a half turn, so each start
// is one the bone never points against: an upper arm or thigh starts along `reference` (in the
// chest's or hips' frame: x to the person's left, y up, z forward); a forearm or shin bent 75 deg in
// its own hinge's plane (elbows fold to 150, knees to about 100); a hand in line with its forearm.
// From the model's A-pose instead, "arm overhead" would be nearly opposite and the twist would flip.
/** @type {{ frame: "chest" | "pelvis", reference: P3, bones: [bone: string, from: number, to: number][] }[]} */
const LIMBS = [
  { frame: "chest", reference: [0.45, -0.55, 0.7], bones: [["upperarm", 11, 13], ["lowerarm", 13, 15], ["hand", 15, 19]] },
  { frame: "pelvis", reference: [0, -0.95, 0.3], bones: [["thigh", 23, 25], ["calf", 25, 27], ["foot", 27, 31]] },
];

const HINGE_START = 75 * (Math.PI / 180);
/** The turn by `angle` radians about `axis`. @param {P3} axis @param {number} angle @returns {Q} */
function axisAngle(axis, angle) {
  const a = unit(axis);
  const s = Math.sin(angle / 2);
  return [a[0] * s, a[1] * s, a[2] * s, Math.cos(angle / 2)];
}

/**
 * @typedef {object} Drive
 * @property {number} from @property {number} to landmarks the bone spans
 * @property {P3} seg the span's direction at rest, in the bone's own frame
 * @property {"chest" | "pelvis" | "parent"} base what the straight pose is held in
 * @property {Q} straight the bone's turn in the straight pose, in `base`'s frame
 */

/** @type {WeakMap<Rig, Map<number, Drive>>} */
const DRIVES = new WeakMap();
/** @param {Rig} rig */
function drives(rig) {
  let out = DRIVES.get(rig);
  if (out) return out;
  const rest = rigWorld(rig);
  const at = rigLandmarks(rig, rest);
  const frames = bodyFrames(at);
  out = new Map();
  for (const limb of LIMBS) {
    for (const [suffix, o, side] of /** @type {const} */ ([["_l", 0, 1], ["_r", 1, -1]])) {
      limb.bones.forEach(([name, from, to], n) => {
        const bone = rig.byName.get(name + suffix);
        if (bone == null) throw new Error(`the model has no ${name + suffix} bone`);
        const seg = qrot(qinv(rest.q[bone]), sub(at[to + o], at[from + o]));
        // The starting pose: where the bone points in it, and the frame it is held in (at rest).
        /** @type {Drive["base"]} */
        const base = n === 0 ? limb.frame : "parent";
        const held = n === 0 ? frames[limb.frame] : rest.q[rig.bones[bone].parent];
        const parentSpan = n === 0 ? null : sub(at[from + o], at[limb.bones[n - 1][1] + o]);
        /** @type {P3} */
        let along;
        if (n === 0) along = qrot(held, [limb.reference[0] * side, limb.reference[1], limb.reference[2]]);
        else if (n === 1) along = qrot(axisAngle(cross(parentSpan, sub(at[to + o], at[from + o])), HINGE_START), parentSpan);
        else along = parentSpan;
        const straight = qmul(swing(qrot(rest.q[bone], seg), along), rest.q[bone]);
        out.set(bone, { from: from + o, to: to + o, seg, base, straight: qmul(qinv(held), straight) });
      });
    }
  }
  DRIVES.set(rig, out);
  return out;
}

/**
 * A limb bone's turn: from its straight pose, the shortest turn along the mannequin's segment.
 * @param {Drive} d @param {Q} parent the parent bone's turn @param {readonly P3[]} joints @param {Record<"chest" | "pelvis", Q>} body
 * @returns {Q}
 */
function pointLimb(d, parent, joints, body) {
  const straight = qmul(d.base === "parent" ? parent : body[d.base], d.straight);
  return qmul(swing(qrot(straight, d.seg), sub(joints[d.to], joints[d.from])), straight);
}

/** @type {WeakMap<Rig, ReturnType<typeof makeTrunk>>} */
const TRUNKS = new WeakMap();
/** The bones from the hips to the head, with how they sit at rest. @param {Rig} rig */
function trunk(rig) {
  let out = TRUNKS.get(rig);
  if (!out) TRUNKS.set(rig, (out = makeTrunk(rig)));
  return out;
}
/** @param {Rig} rig */
function makeTrunk(rig) {
  const bone = (name) => {
    const i = rig.byName.get(name);
    if (i == null) throw new Error(`the model has no ${name} bone`);
    return i;
  };
  const rest = rigWorld(rig);
  const at = rigLandmarks(rig, rest);
  const neck = bone("neck_01");
  const head = bone("head");
  const top = bone("spine_03");
  const restFrames = bodyFrames(at);
  const up = demoUpright();
  const upright = bodyFrames(up, up[33]);
  /** A point in the human's chest frame at rest, from the top of its spine. @param {P3} p */
  const inChest = (p) => qrot(qinv(restFrames.chest), sub(p, rest.p[top]));
  /** A point in the mannequin's upright chest frame, from the middle of its chest. @param {P3} p */
  const inUpright = (p) => qrot(qinv(upright.chest), sub(p, up[33]));
  const earMid = midpoint(at[7], at[8]);
  const neckLength = (l, o) => Math.hypot(...sub(l[7 + o], l[11 + o]));
  return {
    rest,
    restFrames,
    upright,
    spine: [bone("pelvis"), bone("spine_01"), bone("spine_02"), bone("spine_03")],
    // From the pelvis bone to the middle of the hips, and from the top of the spine to the middle
    // of the shoulders, at rest.
    hips: sub(midpoint(at[23], at[24]), rest.p[bone("pelvis")]),
    shoulders: sub(midpoint(at[11], at[12]), rest.p[bone("spine_03")]),
    neck,
    head,
    // The neck bone's direction at rest, in its own frame (to the head bone).
    neckSeg: qrot(qinv(rest.q[neck]), sub(rest.p[head], rest.p[neck])),
    top,
    clavicles: [bone("clavicle_l"), bone("clavicle_r")],
    // Shoulders and the middle of the ears: the human's at rest (chest frame, from the top of the
    // spine), the mannequin's upright (from the middle of its chest), and the ears on the head bone.
    shoulderAt: [inChest(at[11]), inChest(at[12])],
    clavicleAt: [inChest(rest.p[bone("clavicle_l")]), inChest(rest.p[bone("clavicle_r")])],
    earAt: inChest(earMid),
    shoulderUpright: [inUpright(up[11]), inUpright(up[12])],
    earUpright: inUpright(midpoint(up[7], up[8])),
    earOnHead: qrot(qinv(rest.q[head]), sub(earMid, rest.p[head])),
    // How much longer the human's neck is (shoulder to ear) than the mannequin's: its shoulders and
    // head move this much further, so the line the coach measures turns as far.
    reach: (neckLength(at, 0) + neckLength(at, 1)) / (neckLength(up, 0) + neckLength(up, 1)),
  };
}

/**
 * How far each spine bone turns (pelvis to chest, as turns of their rest pose). The hips turn like
 * the mannequin's hips and the chest like its chest. The mannequin's torso is one piece hinged at the
 * hips, but the human's spine bends from higher up, so its lower spine bends as far as it takes for
 * the shoulders to sit where the mannequin's are, seen from the hips (`torso`, the coach measures it).
 * @param {Rig} rig @param {ReturnType<typeof makeTrunk>} body @param {Q} toPelvis @param {Q} toChest @param {P3} torso
 * @returns {Q[]}
 */
function spineTurns(rig, body, toPelvis, toChest, torso) {
  const [pelvis, s1, s2, s3] = body.spine;
  /** @param {number} k how far the lower spine goes, 0 = like the hips, 1 = like the chest */
  const turns = (k) => [toPelvis, slerp(toPelvis, toChest, k), slerp(toPelvis, toChest, (k + 1) / 2), toChest];
  const miss = (k) => {
    const [t0, t1, t2] = turns(k);
    const hip = qrot(t0, body.hips);
    let at = qrot(qmul(t0, body.rest.q[pelvis]), rig.bones[s1].t);
    at = add(at, qrot(qmul(t1, body.rest.q[s1]), rig.bones[s2].t));
    at = add(at, qrot(qmul(t2, body.rest.q[s2]), rig.bones[s3].t));
    const shoulder = add(at, qrot(toChest, body.shoulders));
    return 1 - dot(unit(sub(shoulder, hip)), unit(torso));
  };
  // Golden-section search; the miss has one low point over this range.
  let lo = 0;
  let hi = 3;
  const g = (Math.sqrt(5) - 1) / 2;
  for (let n = 0; n < 24; n++) {
    const a = hi - g * (hi - lo);
    const b = lo + g * (hi - lo);
    if (miss(a) < miss(b)) hi = b;
    else lo = a;
  }
  return turns((lo + hi) / 2);
}

/**
 * Rotations for the human's bones (local, one per bone) and where its root goes, so it stands like
 * the mannequin's `joints` (lib/demo-model.js's demoPose).
 * @param {Rig} rig
 * @param {readonly P3[]} joints
 * @param {{ hands?: boolean, chest?: P3 | null, palms?: [number, number] }} [opts] hands: false leaves
 *   the hands relaxed, in line with the forearms; chest: the middle of the mannequin's chest
 *   (demoChest), so the shoulders can shrug and the head glide (without it, the middle of its
 *   shoulders); palms: how far each forearm turns about its length (rad, left and right)
 * @returns {{ local: Q[], root: P3, palms: [number, number] }} palms: the turns that would make
 *   each wrist bend forward or back in this pose, not sideways (see humanPose)
 */
export function poseRig(rig, joints, { hands = true, chest = null, palms = [0, 0] } = {}) {
  const limbs = drives(rig);
  const body = trunk(rig);
  const middle = chest ?? midpoint(joints[11], joints[12]);
  const now = bodyFrames(joints, middle);
  // Hips and chest point where the mannequin's do (the coach measures them); the head turns as far
  // as the mannequin's turns from upright (each face sits on its head its own way).
  const toPelvis = qmul(now.pelvis, qinv(body.restFrames.pelvis));
  const toChest = qmul(now.chest, qinv(body.restFrames.chest));
  const headTurn = qmul(now.head, qinv(body.upright.head));
  const spine = spineTurns(rig, body, toPelvis, toChest, sub(middle, midpoint(joints[23], joints[24])));
  /** @type {Map<number, Q>} */
  const fixed = new Map(body.spine.map((i, n) => [i, qmul(spine[n], body.rest.q[i])]));
  const headQ = qmul(headTurn, body.rest.q[body.head]);
  fixed.set(body.head, headQ);
  // The shoulders shrug and pull back, and the head glides, as far as the mannequin's (from the
  // middle of its chest) times `reach`: the coach measures the line from shoulder to ear.
  const fromChest = (p) => qrot(qinv(now.chest), sub(p, middle));
  const moved = (at, upright, p) => add(at, scale(sub(fromChest(p), upright), body.reach));
  /** Where the human's clavicles and neck reach to, in its chest frame from the top of its spine. */
  const reachTo = new Map([
    [body.clavicles[0], shoulderOn(body.clavicleAt[0], moved(body.shoulderAt[0], body.shoulderUpright[0], joints[11]), body.shoulderAt[0])],
    [body.clavicles[1], shoulderOn(body.clavicleAt[1], moved(body.shoulderAt[1], body.shoulderUpright[1], joints[12]), body.shoulderAt[1])],
    [body.neck, moved(body.earAt, body.earUpright, midpoint(joints[7], joints[8]))],
  ]);
  /** @type {Q[]} */
  const world = [];
  /** @type {Q[]} */
  const local = [];
  /** @type {P3[]} */
  const pos = [];
  /** @type {[number, number]} */
  const fit = [0, 0];
  rig.bones.forEach((b, i) => {
    const parent = b.parent < 0 ? IDENTITY : world[b.parent];
    pos.push(b.parent < 0 ? b.t : add(pos[b.parent], qrot(parent, b.t)));
    const limb = limbs.get(i);
    /** @type {Q | undefined} */
    let q = fixed.get(i);
    const target = reachTo.get(i);
    if (target) {
      const goal = add(pos[body.top], qrot(now.chest, target));
      const follow = qmul(parent, b.r);
      // A clavicle points its shoulder there; the neck puts the head where its ears land there.
      const [span, to] =
        i === body.neck
          ? [qrot(follow, body.neckSeg), sub(sub(goal, qrot(headQ, body.earOnHead)), pos[i])]
          : [qrot(follow, rig.bones[CHILD.get(rig)?.get(i) ?? i].t), sub(goal, pos[i])];
      q = qmul(swing(span, to), follow);
    } else if (limb && (hands || !HAND_BONES.has(b.name))) {
      q = pointLimb(limb, parent, joints, now);
      const side = FOREARMS.indexOf(b.name);
      if (side >= 0) {
        const along = sub(joints[15 + side], joints[13 + side]);
        fit[side] = palmTurn(rig, q, along, sub(joints[19 + side], joints[15 + side]), side);
        if (palms[side]) q = qmul(axisAngle(along, palms[side]), q);
      }
    }
    // A bone nothing moves keeps its rest pose on its parent (fingers, toes).
    world.push(q ? qnorm(q) : qmul(parent, b.r));
    local.push(q ? qnorm(qmul(qinv(parent), world[i])) : b.r);
  });
  // Hips over the mannequin's hips, lowest point on the floor (the mannequin's own rule).
  const l = rigLandmarks(rig, rigWorld(rig, local));
  const hips = midpoint(l[23], l[24]);
  const goal = midpoint(joints[23], joints[24]);
  return { local, root: [goal[0] - hips[0], -Math.min(...l.map((p) => p[1])), goal[2] - hips[2]], palms: fit };
}

const FOREARMS = ["lowerarm_l", "lowerarm_r"];

/** @type {WeakMap<Rig, P3[]>} */
const KNUCKLES = new WeakMap();
/**
 * How far a forearm turns about its length so its wrist bends forward or back (about the line
 * across the knuckles) into the hand's direction, not sideways. 0 while the wrist is nearly straight.
 * @param {Rig} rig @param {Q} forearm its turn @param {P3} along its direction @param {P3} hand the hand's direction @param {number} side 0 left, 1 right
 */
function palmTurn(rig, forearm, along, hand, side) {
  let knuckles = KNUCKLES.get(rig);
  if (!knuckles) {
    const rest = rigWorld(rig);
    const at = rigLandmarks(rig, rest);
    const hands = [rig.byName.get("hand_l"), rig.byName.get("hand_r")];
    knuckles = [0, 1].map((o) => qrot(qinv(rest.q[hands[o]]), sub(at[19 + o], at[17 + o])));
    KNUCKLES.set(rig, knuckles);
  }
  const axis = cross(along, hand);
  if (Math.hypot(...axis) < 0.2 * Math.hypot(...along) * Math.hypot(...hand)) return 0;
  // The knuckle line with the hand in line with the forearm, across the forearm.
  const straight = drives(rig).get(rig.byName.get(side ? "hand_r" : "hand_l")).straight;
  const f = unit(along);
  const k = qrot(qmul(forearm, straight), knuckles[side]);
  const kx = unit(sub(k, scale(f, dot(k, f))));
  const ax = unit(axis);
  // The signed angle about the forearm from the knuckle line to the bend's axis; either way round
  // the axis will do (that's bending forward or back), so the nearer one.
  let turn = Math.atan2(dot(cross(kx, ax), f), dot(kx, ax));
  if (turn > Math.PI / 2) turn -= Math.PI;
  if (turn < -Math.PI / 2) turn += Math.PI;
  return turn;
}

/** @type {WeakMap<Rig, Map<string, [number, number]>>} */
const PALMS = new WeakMap();
/**
 * Each forearm's turn for a move whose hands the coach measures: the one that makes the wrist bend
 * forward or back where it bends most. One turn for the whole loop, so the forearm doesn't spin as
 * the wrist bends.
 * @param {Rig} rig @param {string} key
 * @returns {[number, number]}
 */
function palmsFor(rig, key) {
  let byKey = PALMS.get(rig);
  if (!byKey) PALMS.set(rig, (byKey = new Map()));
  let out = byKey.get(key);
  if (out) return out;
  const { seconds } = demoMotion(key);
  out = [0, 0];
  for (const o of [0, 1]) {
    let most = -1;
    for (let n = 0; n < 48; n++) {
      const t = (n / 48) * seconds;
      const j = demoPose(key, t);
      const bend = Math.acos(Math.max(-1, Math.min(1, dot(unit(sub(j[15 + o], j[13 + o])), unit(sub(j[19 + o], j[15 + o]))))));
      if (bend > most) {
        most = bend;
        out[o] = poseRig(rig, j, { chest: demoChest(key, t) }).palms[o];
      }
    }
  }
  byKey.set(key, out);
  return out;
}

/**
 * Where a clavicle can put its shoulder, nearest `goal` (chest frame). The bone is rigid, so not
 * every goal fits: the height comes first (a shrug is what the coach reads, from the front), then
 * the width (the shoulder comes in at most a tenth of the bone: closer to the ear would read as less
 * of a shrug), and pulling back gets what room is left. `head` is the clavicle's own end, `rest` the
 * shoulder at rest.
 * @param {P3} head @param {P3} goal @param {P3} rest @returns {P3}
 */
function shoulderOn(head, goal, rest) {
  const across = sub(rest, head);
  const length = Math.hypot(...across);
  const y = Math.max(-length, Math.min(length, goal[1] - head[1]));
  const widest = Math.sqrt(length * length - y * y);
  const x = Math.min(widest, Math.max(0.9 * Math.abs(across[0]), Math.sqrt(Math.max(0, length * length - y * y - (goal[2] - head[2]) ** 2))));
  const z = Math.sign(goal[2] - head[2]) * Math.min(Math.abs(goal[2] - head[2]), Math.sqrt(Math.max(0, length * length - x * x - y * y)));
  return add(head, [Math.sign(across[0]) * x, y, z]);
}

/**
 * The middle of the human's chest, where its shoulders hang from before they shrug or pull back
 * (the mannequin's is demoChest).
 * @param {Rig} rig
 * @param {{ p: P3[], q: Q[] }} world from rigWorld
 * @returns {P3}
 */
export function rigChest(rig, world) {
  const body = trunk(rig);
  return add(world.p[body.top], qrot(qmul(world.q[body.top], qinv(body.rest.q[body.top])), body.shoulders));
}

const HAND_BONES = new Set(["hand_l", "hand_r"]);

/** @type {WeakMap<Rig, Map<number, number>>} */
const CHILDREN = new WeakMap();
/** Each clavicle's upper arm (the bone at the shoulder). */
const CHILD = {
  /** @param {Rig} rig */
  get(rig) {
    let out = CHILDREN.get(rig);
    if (!out) {
      out = new Map();
      for (const side of ["l", "r"]) out.set(rig.byName.get(`clavicle_${side}`), rig.byName.get(`upperarm_${side}`));
      CHILDREN.set(rig, out);
    }
    return out;
  },
};

/**
 * The human doing a move's demo at `t` seconds (it loops), like the mannequin does. It copies the
 * mannequin's hands only where the coach measures them, with the forearms turned so the wrists
 * bend forward or back (palms together in a prayer stretch): elsewhere the mannequin's reaching hands
 * point straight up whatever the forearm does, a bend no wrist makes.
 * @param {Rig} rig
 * @param {string} key
 * @param {number} t
 * @returns {{ local: Q[], root: P3 } | null}
 */
export function humanPose(rig, key, t) {
  const joints = demoPose(key, t);
  if (!joints) return null;
  const hands = EXERCISES[key].joints.includes("index");
  return poseRig(rig, joints, { hands, chest: demoChest(key, t), palms: hands ? palmsFor(rig, key) : [0, 0] });
}
