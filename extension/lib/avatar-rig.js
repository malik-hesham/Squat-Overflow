// ---------------------------------------------------------------------------
// Pose rig for the sensitive-mode characters
// ---------------------------------------------------------------------------
// Turns the ~15 fps pose landmarks into a smooth, springy body in screen
// pixels. Nothing here draws: avatar.js reads the rig each frame and poses
// the 3D character to match, so this runs (and is tested) headless.
//  - every joint follows its landmark through a slightly under-damped spring,
//    so limbs carry momentum and settle instead of snapping between updates;
//  - loose parts (ears, tails, tufts, a scarf, an antenna) are Verlet chains
//    that hang under gravity and swing when the body moves;
//  - wings are angular springs that follow the arms and flap when they move;
//    a jelly body squashes and stretches;
//  - googly pupils lag behind the head and roll around the eye;
//  - a finished rep throws hearts and stars that arc and fall under gravity.

export const IDX = {
  nose: 0,
  eyeL: 2,
  eyeR: 5,
  earL: 7,
  earR: 8,
  shL: 11,
  shR: 12,
  elL: 13,
  elR: 14,
  wrL: 15,
  wrR: 16,
  hipL: 23,
  hipR: 24,
  knL: 25,
  knR: 26,
  anL: 27,
  anR: 28,
  ftL: 31,
  ftR: 32,
};
const MIN_VIS = 0.5;
export const STEP = 1 / 120; // fixed physics step (s)
const MAX_STEPS = 12; // per frame, so a stalled tab doesn't spiral
const JOINT_FREQ = 24; // spring stiffness as angular frequency (rad/s)
const JOINT_ZETA = 0.7; // < 1: a little overshoot reads as mass
export const GRAVITY = 4.5; // frame heights per s^2, roughly real gravity for a person filling the frame
const SNAP_FRACTION = 0.35; // a joint jumping this far (of frame width) is re-placed, not sprung
const PARTICLE_LIFE = 1.6; // s, celebration hearts and stars

// A relaxed standing pose (normalised camera image coordinates), used for
// the picker thumbnails.
export const STANDING = (() => {
  const lms = Array.from({ length: 33 }, () => [0.5, 0.5, 0]);
  const set = (i, x, y) => (lms[i] = [x, y, 1]);
  set(IDX.nose, 0.5, 0.17);
  set(IDX.eyeL, 0.53, 0.155);
  set(IDX.eyeR, 0.47, 0.155);
  set(IDX.earL, 0.555, 0.165);
  set(IDX.earR, 0.445, 0.165);
  set(IDX.shL, 0.6, 0.31);
  set(IDX.shR, 0.4, 0.31);
  set(IDX.elL, 0.66, 0.45);
  set(IDX.elR, 0.34, 0.45);
  set(IDX.wrL, 0.68, 0.58);
  set(IDX.wrR, 0.32, 0.58);
  set(IDX.hipL, 0.56, 0.58);
  set(IDX.hipR, 0.44, 0.58);
  set(IDX.knL, 0.57, 0.73);
  set(IDX.knR, 0.43, 0.73);
  set(IDX.anL, 0.575, 0.88);
  set(IDX.anR, 0.425, 0.88);
  set(IDX.ftL, 0.6, 0.92);
  set(IDX.ftR, 0.4, 0.92);
  return lms;
})();

// ---- Small vector helpers (screen pixels, y down) ---------------------------
export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const mid = (a, b) => lerp(a, b, 0.5);
export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
export const add = (a, v, s = 1) => ({ x: a.x + v.x * s, y: a.y + v.y * s });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (v, s) => ({ x: v.x * s, y: v.y * s });
export const norm = (v) => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};
export const rot = (v, ang) => {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
};
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// Stable pseudo-random in [0, 1) per integer.
export const hash = (i) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// ---- Joints: spring followers ---------------------------------------------
function makeJoint() {
  return { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, a: 0, on: false, placed: false };
}

function stepJoint(j, dt) {
  if (j.placed) {
    const k = JOINT_FREQ * JOINT_FREQ;
    const c = 2 * JOINT_ZETA * JOINT_FREQ;
    j.vx += (k * (j.tx - j.x) - c * j.vx) * dt;
    j.vy += (k * (j.ty - j.y) - c * j.vy) * dt;
    j.x += j.vx * dt;
    j.y += j.vy * dt;
  }
  j.a += ((j.on ? 1 : 0) - j.a) * Math.min(1, dt * 8);
}

// ---- Loose parts: Verlet chains -------------------------------------------
function makeChain(n) {
  return { pts: Array.from({ length: n }, () => ({ x: 0, y: 0, px: 0, py: 0 })), ready: false };
}

// `dirs[i]` is the rest direction of segment i; `stiff` (0..1) is how hard the
// chain is pulled back to that shape each step, so 0 is a rope, 1 a rod.
function stepChain(ch, anchor, dirs, seg, stiff, gravity, damp, dt) {
  const pts = ch.pts;
  if (!ch.ready || dist(anchor, pts[0]) > seg * 8) {
    let p = anchor;
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) p = add(p, dirs[i - 1], seg);
      pts[i] = { x: p.x, y: p.y, px: p.x, py: p.y };
    }
    ch.ready = true;
  }
  const root = pts[0];
  root.px = root.x = anchor.x;
  root.py = root.y = anchor.y;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    const vx = (p.x - p.px) * damp;
    const vy = (p.y - p.py) * damp;
    p.px = p.x;
    p.py = p.y;
    p.x += vx;
    p.y += vy + gravity * dt * dt;
    const prev = pts[i - 1];
    p.x += (prev.x + dirs[i - 1].x * seg - p.x) * stiff;
    p.y += (prev.y + dirs[i - 1].y * seg - p.y) * stiff;
  }
  for (let iter = 0; iter < 2; iter++) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const f = seg / (dist(a, b) || 1);
      b.x = a.x + (b.x - a.x) * f;
      b.y = a.y + (b.y - a.y) * f;
    }
  }
}

// `spec`: { head (head scale), party (particle colours), step(pose, rig, dt, g)
// for the character's loose parts }. `fitness` ({ buff, droop }, both 0..1)
// comes from lib/fitness.js: buff widens the shoulders, droop slumps the body
// and hangs the head.
export function createRig(spec, fitness = {}) {
  const buff = clamp(fitness.buff || 0, 0, 1);
  const droop = clamp(fitness.droop || 0, 0, 1);
  const joints = new Map(Object.values(IDX).map((i) => [i, makeJoint()]));
  const chains = new Map();
  const wobble = { w: 0, v: 0, lastVy: 0 };
  const wings = [
    { a: 0.35, v: 0 },
    { a: 0.35, v: 0 },
  ];
  // Googly pupils: an offset in units of how far they can roll, sprung towards
  // resting a touch low and kicked the other way when the head accelerates.
  const eyes = { x: 0, y: 0.1, vx: 0, vy: 0, hx: null, hy: 0, hvx: 0, hvy: 0 };
  let particles = [];
  let lastPose = null;
  let lastH = 0;
  let acc = 0;
  let floorY = null;
  let nextBlink = 2;
  let blinkUntil = 0;
  let joyUntil = 0;
  let clock = 0;

  const J = (name) => joints.get(IDX[name]);
  const seen = (name, min = 0.5) => J(name).placed && J(name).a > min;

  function setTargets(lms, w, h) {
    const snap = w * SNAP_FRACTION;
    for (const [i, j] of joints) {
      const lm = lms?.[i];
      j.on = !!lm && lm[2] >= MIN_VIS;
      if (!j.on) continue;
      j.tx = (1 - lm[0]) * w; // mirrored, like the preview
      j.ty = lm[1] * h;
      if (!j.placed || j.a < 0.05 || Math.hypot(j.tx - j.x, j.ty - j.y) > snap) {
        j.x = j.tx;
        j.y = j.ty;
        j.vx = j.vy = 0;
        j.placed = true;
      }
    }
  }

  // Body geometry from the smoothed joints, or null when there's no torso.
  function derive(h) {
    if (!seen("shL", 0.05) || !seen("shR", 0.05)) return null;
    const jA = J("shL");
    const jB = J("shR");
    const jMid = mid(jA, jB);
    const shDist = dist(jA, jB);
    const hipsReal = seen("hipL", 0.3) && seen("hipR", 0.3);
    const earsSeen = seen("earL") && seen("earR");
    const earDist = earsSeen ? dist(J("earL"), J("earR")) : 0;
    let hipMid = hipsReal ? mid(J("hipL"), J("hipR")) : null;
    const torsoLen = hipMid ? dist(jMid, hipMid) : 0;
    const unit = Math.max(shDist, torsoLen * 0.62, earDist * 1.7, h * 0.04);

    const across = norm(sub(jB, jA));
    let up = hipMid ? norm(sub(jMid, hipMid)) : { x: across.y, y: -across.x };
    if (!hipMid && up.y > 0) up = { x: -up.x, y: -up.y };
    // Fitness: buff pushes the shoulders out into a V; droop slumps them down and in.
    const spread = shDist * (0.16 * buff - 0.05 * droop);
    const slump = -unit * 0.12 * droop;
    const shA = add(add(jA, across, -spread), up, slump);
    const shB = add(add(jB, across, spread), up, slump);
    const shMid = mid(shA, shB);
    let hipA;
    let hipB;
    if (hipsReal) {
      hipA = J("hipL");
      hipB = J("hipR");
    } else {
      hipMid = add(shMid, up, -unit * 1.45);
      hipA = add(hipMid, across, -unit * 0.33);
      hipB = add(hipMid, across, unit * 0.33);
    }
    // Keep "right" pointing screen-right so faces and tails don't flip.
    const right = across.x >= 0 ? across : { x: -across.x, y: -across.y };

    let tilt = 0;
    const pair = earsSeen ? ["earL", "earR"] : seen("eyeL") && seen("eyeR") ? ["eyeL", "eyeR"] : null;
    if (pair) {
      let [a, b] = pair.map(J);
      if (b.x < a.x) [a, b] = [b, a];
      tilt = clamp(Math.atan2(b.y - a.y, b.x - a.x), -0.9, 0.9);
    } else {
      tilt = clamp(Math.atan2(right.y, right.x), -0.6, 0.6) * 0.5;
    }
    tilt = clamp(tilt + 0.3 * droop, -0.9, 0.9); // a droopy head lolls to one side
    const headUp = rot({ x: 0, y: -1 }, tilt);
    const headRight = rot({ x: 1, y: 0 }, tilt);
    const r = clamp(Math.max(earDist * 0.62, unit * 0.36), unit * 0.3, unit * 0.6);
    let c;
    let yaw = 0;
    if (earsSeen) {
      const earMid = mid(J("earL"), J("earR"));
      c = seen("nose") ? lerp(earMid, J("nose"), 0.2) : earMid;
      if (seen("nose")) {
        const off = (J("nose").x - earMid.x) * headRight.x + (J("nose").y - earMid.y) * headRight.y;
        yaw = clamp(off / (earDist / 2 || 1), -1, 1);
      }
    } else if (seen("nose")) {
      c = J("nose");
    } else {
      c = add(shMid, up, unit * 0.8);
    }
    c = add(c, headUp, r * 0.15);
    // A character's big head is lifted so it sits on the shoulders, not over them.
    const R = r * (spec.head ?? 1);
    c = add(c, headUp, (R - r) * 0.55);
    c = add(c, up, -r * 0.5 * droop); // and sinks towards the chest

    const opt = (name) => (seen(name) ? J(name) : null);
    return {
      unit,
      up,
      right,
      shoulders: [shA, shB],
      hips: [hipA, hipB],
      hipMid,
      hipsReal,
      arms: [
        [shA, opt("elL"), opt("wrL")],
        [shB, opt("elR"), opt("wrR")],
      ],
      legs: hipsReal
        ? [
            [hipA, opt("knL"), opt("anL"), opt("ftL")],
            [hipB, opt("knR"), opt("anR"), opt("ftR")],
          ]
        : [],
      // `r` is the head radius: the tracked size times the character's head scale.
      head: { c, r: R, tilt, yaw, up: headUp, right: headRight },
      neck: shMid,
    };
  }

  // Each wing rises with its arm, and a quick arm movement flaps it.
  function stepWings(pose, dt) {
    const k = 220;
    const c = 2 * 0.3 * Math.sqrt(k); // bouncy
    pose.arms.forEach(([sh, , wr], i) => {
      const wing = wings[i];
      const raise = wr ? clamp((sh.y - wr.y) / pose.unit, -0.5, 1.5) : 0;
      const kick = wr ? -(wr.vy / pose.unit) * 25 : 0;
      wing.v += (k * (0.35 + raise * 0.45 - wing.a) - c * wing.v + kick) * dt;
      wing.a = clamp(wing.a + wing.v * dt, -0.4, 1.5);
    });
  }

  // Jelly: a damped spring for squash (> 0, wider and shorter) and stretch
  // (< 0), kicked by the body's vertical acceleration.
  function stepWobble(dt, h) {
    const vy = (J("shL").vy + J("shR").vy) / 2;
    const accel = (vy - wobble.lastVy) / dt;
    wobble.lastVy = vy;
    const k = (2 * Math.PI * 3.2) ** 2; // ~3 Hz jiggle
    const c = 2 * 0.18 * Math.sqrt(k); // lightly damped
    wobble.v += (-k * wobble.w - c * wobble.v - (accel * 10) / h) * dt;
    wobble.w = clamp(wobble.w + wobble.v * dt, -0.3, 0.3);
  }

  function stepEyes(pose, dt) {
    const { c, r } = pose.head;
    if (eyes.hx == null) {
      eyes.hx = c.x;
      eyes.hy = c.y;
    }
    const hvx = (c.x - eyes.hx) / dt;
    const hvy = (c.y - eyes.hy) / dt;
    const ax = clamp((hvx - eyes.hvx) / dt / r, -400, 400);
    const ay = clamp((hvy - eyes.hvy) / dt / r, -400, 400);
    eyes.hx = c.x;
    eyes.hy = c.y;
    eyes.hvx = hvx;
    eyes.hvy = hvy;
    // A soft ~1.2 Hz spring: slow enough to ignore pose jitter, loose enough to roll.
    const k = (2 * Math.PI * 1.2) ** 2;
    const damp = 2 * 0.2 * Math.sqrt(k);
    eyes.vx += (-k * eyes.x - damp * eyes.vx - ax * 0.6) * dt;
    eyes.vy += (-k * (eyes.y - 0.1) - damp * eyes.vy - ay * 0.6) * dt;
    eyes.x += eyes.vx * dt;
    eyes.y += eyes.vy * dt;
    // Bounce off the rim of the eye.
    const l = Math.hypot(eyes.x, eyes.y);
    if (l > 1) {
      eyes.x /= l;
      eyes.y /= l;
      const out = eyes.vx * eyes.x + eyes.vy * eyes.y;
      if (out > 0) {
        eyes.vx -= 1.6 * out * eyes.x;
        eyes.vy -= 1.6 * out * eyes.y;
      }
    }
  }

  function burst(big) {
    if (!lastPose) return;
    const { head, unit } = lastPose;
    const origin = add(head.c, head.up, head.r * 1.2);
    const party = spec.party ?? ["#ff8fb8", "#ffd23f", "#ffffff"];
    for (let i = 0, n = big ? 16 : 6; i < n; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const speed = lastH * (0.45 + Math.random() * 0.5);
      particles.push({
        x: origin.x,
        y: origin.y,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        spin: (Math.random() - 0.5) * 6,
        ang: 0,
        life: PARTICLE_LIFE * (0.8 + Math.random() * 0.4),
        size: unit * (0.08 + Math.random() * 0.07),
        kind: i % 3 === 0 ? "star" : "heart",
        color: party[i % party.length],
      });
    }
  }

  function stepParticles(dt) {
    const g = GRAVITY * lastH * 0.35; // floaty
    for (const p of particles) {
      p.vy += g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.ang += p.spin * dt;
      p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);
  }

  const rig = {
    buff,
    droop,
    wobble,
    wings,
    eyes,
    get clock() {
      return clock;
    },
    get particles() {
      return particles;
    },
    blinking: () => clock < blinkUntil,
    joyful: () => clock < joyUntil,
    // How present the tracked body is (0..1): the figure fades in and out with it.
    presence: () => Math.min(J("shL").a, J("shR").a),
    // A named Verlet chain of `n` points (created on first use).
    chain(name, n) {
      if (!chains.has(name)) chains.set(name, makeChain(n));
      return chains.get(name);
    },
    stepChain(name, n, anchor, dirs, seg, stiff, gravity, damp, dt) {
      const ch = rig.chain(name, n);
      stepChain(ch, anchor, dirs, seg, stiff, gravity, damp, dt);
      return ch.pts;
    },
    stepWings,
    stepWobble,

    // Advance by `dt` seconds towards the landmarks last set; returns the pose or null.
    advance(dt, h) {
      lastH = h;
      clock += dt;
      if (clock > nextBlink) {
        blinkUntil = clock + 0.14;
        nextBlink = clock + 2 + Math.random() * 3.5;
      }
      acc = Math.min(acc + dt, STEP * MAX_STEPS);
      let pose = null;
      while (acc >= STEP) {
        for (const j of joints.values()) stepJoint(j, STEP);
        pose = derive(h);
        if (pose) {
          spec.step?.(pose, rig, STEP, GRAVITY * h, h);
          stepEyes(pose, STEP);
        }
        acc -= STEP;
      }
      pose = pose ?? derive(h);
      if (pose) lastPose = pose;
      stepParticles(dt);
      return pose;
    },
    setTargets,

    // Snap to `lms` with every loose part settled (picker thumbnails).
    settle(lms, w, h) {
      lastH = h;
      setTargets(lms, w, h);
      for (const j of joints.values()) j.a = j.on ? 1 : 0;
      let pose = null;
      for (let i = 0; i < 240; i++) {
        pose = derive(h);
        if (pose) spec.step?.(pose, rig, STEP, GRAVITY * h, h);
      }
      clock = 1; // eyes open
      if (pose) lastPose = pose;
      return pose;
    },

    // A finished rep: a burst of hearts and stars (bigger for a clean rep) and
    // a moment of squinty, open-mouthed delight.
    celebrate(big = true) {
      burst(big);
      joyUntil = clock + (big ? 0.9 : 0.5);
    },

    // The ground shadow under the feet: the floor follows the feet down at
    // once but up only slowly, so a hop leaves the shadow on the floor.
    shadow(pose, dt) {
      const feet = pose.legs.flatMap(([, , an, ft]) => [an, ft]).filter(Boolean);
      if (!feet.length) {
        floorY = null;
        return null;
      }
      const footY = Math.max(...feet.map((p) => p.y));
      floorY = floorY == null || footY > floorY ? footY : floorY + (footY - floorY) * Math.min(1, dt * 0.6);
      const lift = clamp((floorY - footY) / (pose.unit * 2), 0, 0.6);
      return {
        x: feet.reduce((s, p) => s + p.x, 0) / feet.length,
        y: floorY + pose.unit * 0.08,
        rx: pose.unit * (1 - lift * 0.5),
        ry: pose.unit * 0.17 * (1 - lift * 0.5),
        alpha: 0.35 * (1 - lift),
      };
    },
  };
  return rig;
}

// Toe tip of a leg: towards the foot landmark, or straight down without one.
export function toeOf(an, ft, unit, len) {
  const toward = ft ? norm(sub(ft, an)) : { x: 0, y: 1 };
  return add(an, toward, unit * len);
}

// Hand centre: a little past the wrist, along the forearm.
export function handOf(el, wr, unit) {
  return add(wr, norm(sub(wr, el)), unit * 0.06);
}

// Directions in the body's frame: x along the shoulders (screen-right), y down the torso.
export const bodyDirs = (pose, local) => local.map(([x, y]) => norm(add(scale(pose.right, x), pose.up, -y)));
export const sideOf = (pose, p) => (p.x >= pose.neck.x ? 1 : -1);
