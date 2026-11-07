"use strict";

// ---------------------------------------------------------------------------
// Sensitive-mode characters
// ---------------------------------------------------------------------------
// A cartoon character that copies the user's pose, drawn instead of the camera
// picture so no camera pixels reach the screen. To make it move like a body
// rather than a stick figure:
//  - every joint follows its landmark through a slightly under-damped spring,
//    so limbs carry momentum and settle instead of snapping between the
//    ~15 fps pose updates;
//  - loose parts (fur tufts, curls, ears, a scarf, a tail, a garland) are
//    Verlet chains that hang under gravity and swing when the body moves;
//  - the dragon's wings are angular springs that follow the arms and flap
//    when they move; the space critter's jelly body squashes and stretches;
//  - a finished rep throws hearts and stars that arc and fall under gravity;
//  - a ground shadow stays on the floor and shrinks when the feet leave it.
// Exposed as the global `Avatar`: break.html loads it as a classic script before break.js.
const Avatar = (() => {
  const MIN_VIS = 0.5;
  const IDX = {
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
  const STEP = 1 / 120; // fixed physics step (s)
  const MAX_STEPS = 12; // per frame, so a stalled tab doesn't spiral
  const JOINT_FREQ = 24; // spring stiffness as angular frequency (rad/s)
  const JOINT_ZETA = 0.7; // < 1: a little overshoot reads as mass
  const GRAVITY = 4.5; // frame heights per s^2, roughly real gravity for a person filling the frame
  const SNAP_FRACTION = 0.35; // a joint jumping this far (of frame width) is re-placed, not sprung
  const BREATH_PERIOD = 3.2; // s, the idle rise and fall of the head
  const PARTICLE_LIFE = 1.6; // s, celebration hearts and stars
  const ISSUE_COLOR = "#ffb547";
  const BLUSH = "rgba(255, 120, 150, 0.42)";

  // `head` scales the head (cute characters get big heads); `party` colours the
  // celebration hearts and stars.
  const CHARACTERS = {
    slothbear: {
      label: "Sloth bear",
      head: 1.2,
      fur: "#2e2723",
      furLight: "#5a4c43",
      furDark: "#14100e",
      cream: "#f1e6cf",
      creamDark: "#c9b38f",
      claw: "#f4ecdc",
      line: "#0a0807",
      party: ["#ff8fb8", "#ffd23f", "#f1e6cf"],
    },
    bunny: {
      label: "Bunny",
      head: 1.15,
      fur: "#f7eff3",
      furLight: "#ffffff",
      furDark: "#dccbd5",
      pink: "#ffb3c7",
      nose: "#ff7aa2",
      bow: "#9b7bff",
      line: "#3a2a33",
      party: ["#ff8fb8", "#c9b5ff", "#ffffff"],
    },
    penguin: {
      label: "Penguin",
      head: 1.1,
      back: "#4a5f8a", // lighter than the backdrop so the flippers read
      backLight: "#7a90bd",
      backDark: "#283654",
      belly: "#f7f8fc",
      bellyDark: "#d9deea",
      beak: "#ffa63d",
      scarf: "#e8455a",
      stripe: "#ffd4dc",
      line: "#0d1018",
      party: ["#e8455a", "#7cc7ff", "#ffffff"],
    },
    dragon: {
      label: "Baby dragon",
      head: 1.15,
      body: "#9b7bff",
      bodyLight: "#c9b8ff",
      bodyDark: "#6d4fd6",
      belly: "#ffe08a",
      bellyLine: "#e9b94a",
      wing: "#ffb3dd",
      wingDark: "#e27bb8",
      horn: "#fff3d1",
      spike: "#ff8fc7",
      line: "#22163f",
      party: ["#ffd23f", "#ff8fc7", "#c9b8ff"],
    },
    surfer: {
      label: "Surfer",
      head: 1,
      skin: "#c98b5e",
      top: "#22b8a6", // tank top
      bottom: "#ff8c42", // board shorts
      hair: "#f2d27a", // sun-bleached curls
      shades: "#1e2a3a",
      line: "#1d1410",
      party: ["#ff5fa2", "#ffd23f", "#22b8a6"],
    },
    critter: {
      label: "Space critter",
      head: 1,
      skin: "#6fe0b4", // jelly
      limb: "#4cc79a",
      foot: "#3aa883",
      belly: "#a8f0d2",
      spot: "#a678ff",
      line: "#0f2a22",
      party: ["#a678ff", "#6fe0b4", "#ffffff"],
    },
  };
  const LEI_FLOWERS = ["#ff5fa2", "#ffd23f", "#ff8c42", "#ffffff"];

  // A relaxed standing pose (normalised, camera image coordinates), used for
  // the picker thumbnails.
  const STANDING = (() => {
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

  // ---- Small vector helpers -------------------------------------------------
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const mid = (a, b) => lerp(a, b, 0.5);
  const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const add = (a, v, s = 1) => ({ x: a.x + v.x * s, y: a.y + v.y * s });
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  const scale = (v, s) => ({ x: v.x * s, y: v.y * s });
  const norm = (v) => {
    const l = Math.hypot(v.x, v.y) || 1;
    return { x: v.x / l, y: v.y / l };
  };
  const rot = (v, ang) => {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
  };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const TAU = Math.PI * 2;
  // Stable pseudo-random in [0, 1) per integer, so fur edges don't flicker.
  const hash = (i) => {
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
  // With `pinEnd` the last point is held too, so the chain hangs like a rope
  // between two points.
  function stepChain(ch, anchor, dirs, seg, stiff, gravity, damp, dt, pinEnd = null) {
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
    const fix = (a, b) => {
      const f = seg / (dist(a, b) || 1);
      b.x = a.x + (b.x - a.x) * f;
      b.y = a.y + (b.y - a.y) * f;
    };
    for (let iter = 0; iter < (pinEnd ? 4 : 2); iter++) {
      for (let i = 1; i < pts.length; i++) fix(pts[i - 1], pts[i]);
      if (pinEnd) {
        const last = pts[pts.length - 1];
        last.x = pinEnd.x;
        last.y = pinEnd.y;
        for (let i = pts.length - 2; i > 0; i--) fix(pts[i + 1], pts[i]);
      }
    }
  }

  // ---- Drawing helpers ------------------------------------------------------
  function strokePath(g, pts, width, color, line, lw) {
    if (pts.length < 2) return;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    if (lw) {
      g.strokeStyle = line;
      g.lineWidth = width + lw * 2;
      g.stroke();
    }
    g.strokeStyle = color;
    g.lineWidth = width;
    g.stroke();
  }

  function disc(g, p, r, color, line, lw) {
    g.beginPath();
    g.arc(p.x, p.y, r, 0, TAU);
    g.fillStyle = color;
    g.fill();
    if (lw) {
      g.lineWidth = lw;
      g.strokeStyle = line;
      g.stroke();
    }
  }

  function oval(g, p, rx, ry, color, ang = 0) {
    g.beginPath();
    g.ellipse(p.x, p.y, rx, ry, ang, 0, TAU);
    g.fillStyle = color;
    g.fill();
  }

  function fillOutline(g, fill, line, lw) {
    g.fillStyle = fill;
    g.fill();
    if (lw) {
      g.lineJoin = "round";
      g.lineWidth = lw;
      g.strokeStyle = line;
      g.stroke();
    }
  }

  // A filled band along `pts` whose width goes from w0 to w1, outlined as one
  // shape (tufts, ears, scarves, tails: no seams where segments meet).
  function ribbon(g, pts, w0, w1, color, line, lw) {
    const n = pts.length;
    const left = [];
    const right = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(n - 1, i + 1)];
      const d = norm(sub(b, a));
      const half = (w0 + (w1 - w0) * (i / (n - 1))) / 2;
      left.push(add(pts[i], { x: -d.y, y: d.x }, half));
      right.push(add(pts[i], { x: d.y, y: -d.x }, half));
    }
    g.beginPath();
    [...left, ...right.reverse()].forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.closePath();
    fillOutline(g, color, line, lw);
  }

  // Soft light from the top left, for shapes that should look round.
  function shade(g, c, rx, ry, light, base, dark) {
    const grad = g.createRadialGradient(c.x - rx * 0.35, c.y - ry * 0.45, 0, c.x, c.y, Math.max(rx, ry) * 1.25);
    grad.addColorStop(0, light);
    grad.addColorStop(0.55, base);
    grad.addColorStop(1, dark);
    return grad;
  }

  // An ellipse with a shaggy edge: points alternate between the ellipse and
  // fur tips sticking out by `fur` (fraction of the radius), jittered by `seed`.
  function furEllipse(g, c, rx, ry, ang, fur, n, seed) {
    g.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const t = (i / (n * 2)) * TAU;
      const k = i % 2 ? 1 - fur * 0.3 : 1 + fur * (0.5 + hash(seed + i));
      const p = rot({ x: Math.cos(t) * rx * k, y: Math.sin(t) * ry * k }, ang);
      if (i) g.lineTo(c.x + p.x, c.y + p.y);
      else g.moveTo(c.x + p.x, c.y + p.y);
    }
    g.closePath();
  }

  function roundQuad(g, quad, round, color, line, lw) {
    g.lineJoin = "round";
    g.beginPath();
    quad.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.closePath();
    g.lineWidth = round + lw * 2;
    g.strokeStyle = line;
    g.stroke();
    g.lineWidth = round;
    g.strokeStyle = color;
    g.stroke();
    g.fillStyle = color;
    g.fill();
  }

  function star(g, c, r, color, ang = 0) {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = ang - Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.45 : r;
      g.lineTo(c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr);
    }
    g.closePath();
    g.fillStyle = color;
    g.fill();
  }

  function heart(g, c, s, color, ang = 0) {
    g.save();
    g.translate(c.x, c.y);
    g.rotate(ang);
    g.beginPath();
    g.moveTo(0, s * 0.45);
    g.bezierCurveTo(-s * 1.15, -s * 0.25, -s * 0.5, -s * 1.05, 0, -s * 0.4);
    g.bezierCurveTo(s * 0.5, -s * 1.05, s * 1.15, -s * 0.25, 0, s * 0.45);
    g.fillStyle = color;
    g.fill();
    g.restore();
  }

  // A four-point twinkle.
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

  function drawBackdrop(g, w, h) {
    const floorY = h * 0.8;
    const wall = g.createLinearGradient(0, 0, 0, floorY);
    wall.addColorStop(0, "#28324d");
    wall.addColorStop(1, "#1c2335");
    g.fillStyle = wall;
    g.fillRect(0, 0, w, floorY);
    const glow = g.createRadialGradient(w / 2, h * 0.35, 0, w / 2, h * 0.35, w * 0.6);
    glow.addColorStop(0, "rgba(130, 170, 255, 0.16)");
    glow.addColorStop(1, "rgba(130, 170, 255, 0)");
    g.fillStyle = glow;
    g.fillRect(0, 0, w, floorY);
    // A few soft stars on the wall.
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

  // ---- Renderer -------------------------------------------------------------
  function create(requested) {
    const key = requested in CHARACTERS ? requested : "slothbear";
    const ch = CHARACTERS[key];
    const joints = new Map(Object.values(IDX).map((i) => [i, makeJoint()]));
    const chains = {
      tufts: Array.from({ length: 7 }, () => makeChain(3)), // sloth bear fur, surfer curls
      lei: makeChain(11), // surfer garland
      a: makeChain(5), // penguin scarf ends, bunny ears
      b: makeChain(5),
      tail: makeChain(8), // dragon
    };
    // Space critter jelly: a damped spring for squash (> 0, wider and shorter)
    // and stretch (< 0), kicked by the body's vertical acceleration.
    const wobble = { w: 0, v: 0, lastVy: 0 };
    // Dragon wings: an angle (rad above the shoulder line) per side, sprung.
    const wings = [
      { a: 0.35, v: 0 },
      { a: 0.35, v: 0 },
    ];
    let particles = [];
    let lastPose = null;
    let lastH = 0;
    let layer = null;
    let lastNow = 0;
    let acc = 0;
    let floorY = null;
    let nextBlink = 2;
    let blinkUntil = 0;
    let clock = 0;

    const J = (name) => joints.get(IDX[name]);
    const seen = (name, min = 0.5) => J(name).placed && J(name).a > min;
    const blinking = () => clock < blinkUntil;

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
      const shA = J("shL");
      const shB = J("shR");
      const shMid = mid(shA, shB);
      const shDist = dist(shA, shB);
      const hipsReal = seen("hipL", 0.3) && seen("hipR", 0.3);
      const earsSeen = seen("earL") && seen("earR");
      const earDist = earsSeen ? dist(J("earL"), J("earR")) : 0;
      let hipMid = hipsReal ? mid(J("hipL"), J("hipR")) : null;
      const torsoLen = hipMid ? dist(shMid, hipMid) : 0;
      const unit = Math.max(shDist, torsoLen * 0.62, earDist * 1.7, h * 0.04);

      const across = norm(sub(shB, shA));
      let up = hipMid ? norm(sub(shMid, hipMid)) : { x: across.y, y: -across.x };
      if (!hipMid && up.y > 0) up = { x: -up.x, y: -up.y };
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
        // `r` is the drawn head radius: the tracked size times the character's head scale.
        head: { c, r: r * ch.head, tilt, yaw, up: headUp, right: headRight },
        neck: shMid,
      };
    }

    // Directions in the body's frame: x along the shoulders (screen-right), y down the torso.
    const bodyDirs = (pose, local) => local.map(([x, y]) => norm(add(scale(pose.right, x), pose.up, -y)));
    const sideOf = (pose, p) => (p.x >= pose.neck.x ? 1 : -1);

    // ---- Physics of the loose parts -----------------------------------------
    function stepChains(pose, dt, h) {
      const g = GRAVITY * h;
      const { head, unit } = pose;
      if (key === "slothbear") {
        // Shaggy tufts around the top of the head and on each shoulder: short,
        // loose chains that bounce and settle as the body moves.
        const spots = [-1.2, -0.6, 0, 0.6, 1.2].map((a) => {
          const out = rot(head.up, a);
          return { base: add(head.c, out, head.r * 0.85), out, len: head.r * 0.32 };
        });
        for (const sh of pose.shoulders) {
          const out = norm(add(scale(pose.right, sideOf(pose, sh)), pose.up, 0.5));
          spots.push({ base: sh, out, len: unit * 0.24 });
        }
        spots.forEach((t, i) => {
          const droop = norm(add(t.out, { x: 0, y: 1 }, 0.9));
          stepChain(chains.tufts[i], t.base, [t.out, droop], t.len, 0.07, g, 0.97, dt);
        });
      } else if (key === "bunny") {
        // Long ears: semi-floppy chains that stand up but swing and droop.
        for (const [s, chain] of [
          [-1, chains.a],
          [1, chains.b],
        ]) {
          const base = add(head.c, rot(head.up, s * 0.38), head.r * 0.8);
          const d = rot(head.up, s * 0.22);
          stepChain(chain, base, [d, d, d, d], head.r * 0.5, 0.06, g, 0.975, dt);
        }
      } else if (key === "penguin") {
        // Two scarf ends hanging from a knot at the side of the neck.
        const knot = add(add(pose.neck, pose.right, unit * 0.22), pose.up, unit * 0.04);
        for (const [spread, chain] of [
          [0.15, chains.a],
          [0.5, chains.b],
        ]) {
          const d = norm(add(scale(pose.right, spread), pose.up, -1));
          stepChain(chain, knot, [d, d, d, d], unit * 0.13, 0.03, g, 0.99, dt);
        }
      } else if (key === "dragon") {
        // Tail out to the side, sweeping up; wings follow the arms.
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
        stepChain(chains.tail, anchor, dirs, unit * 0.17, 0.08, g, 0.98, dt);
        stepWings(pose, dt);
      } else if (key === "surfer") {
        // Curly mop: springy curls around the top of the head.
        [-1.3, -0.75, -0.25, 0.25, 0.75, 1.3].forEach((a, i) => {
          const out = rot(head.up, a);
          const droop = norm(add(out, { x: 0, y: 1 }, 1.2));
          stepChain(chains.tufts[i], add(head.c, out, head.r * 0.85), [out, droop], head.r * 0.32, 0.09, g, 0.97, dt);
        });
        // Flower garland: a rope pinned at both sides of the neck, sagging under gravity.
        const neckL = add(add(pose.neck, pose.right, -unit * 0.24), pose.up, unit * 0.05);
        const neckR = add(add(pose.neck, pose.right, unit * 0.24), pose.up, unit * 0.05);
        const n = chains.lei.pts.length - 1;
        const dirs = Array.from({ length: n }, (_, i) =>
          norm(add(scale(pose.right, 0.6), pose.up, -Math.cos((Math.PI * i) / (n - 1)) * 1.5)),
        );
        stepChain(chains.lei, neckL, dirs, unit * 0.12, 0, g, 0.98, dt, neckR);
      }
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

    function stepWobble(dt, h) {
      const vy = (J("shL").vy + J("shR").vy) / 2;
      const accel = (vy - wobble.lastVy) / dt;
      wobble.lastVy = vy;
      const k = (2 * Math.PI * 3.2) ** 2; // ~3 Hz jiggle
      const c = 2 * 0.18 * Math.sqrt(k); // lightly damped
      // Slowing a downward move (landing a squat or a hop) squashes it.
      wobble.v += (-k * wobble.w - c * wobble.v - (accel * 10) / h) * dt;
      wobble.w = clamp(wobble.w + wobble.v * dt, -0.3, 0.3);
    }

    // Scale a point about `c` by (1 + w) across the body and (1 - w) along it.
    function squash(p, c, pose) {
      const w = wobble.w;
      const d = sub(p, c);
      const a = (d.x * pose.right.x + d.y * pose.right.y) * (1 + w);
      const b = (d.x * pose.up.x + d.y * pose.up.y) * (1 - w);
      return add(add(c, pose.right, a), pose.up, b);
    }

    // ---- Celebration particles ------------------------------------------------
    function burst(big) {
      if (!lastPose) return;
      const { head, unit } = lastPose;
      const origin = add(head.c, head.up, head.r * 1.2);
      const n = big ? 16 : 6;
      for (let i = 0; i < n; i++) {
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
          color: ch.party[i % ch.party.length],
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

    function drawParticles(ctx) {
      for (const p of particles) {
        ctx.save();
        ctx.globalAlpha = clamp(p.life * 2, 0, 1);
        if (p.kind === "star") star(ctx, p, p.size, p.color, p.ang);
        else heart(ctx, p, p.size, p.color, p.ang * 0.3);
        ctx.restore();
      }
    }

    // ---- Shared body parts and faces -------------------------------------------
    function drawShadow(g, pose, dt) {
      const feet = pose.legs.flatMap(([, , an, ft]) => [an, ft]).filter(Boolean);
      if (!feet.length) {
        floorY = null;
        return;
      }
      const footY = Math.max(...feet.map((p) => p.y));
      // The floor follows the feet down at once, but up only slowly, so a hop
      // leaves the shadow on the floor.
      floorY = floorY == null || footY > floorY ? footY : floorY + (footY - floorY) * Math.min(1, dt * 0.6);
      const lift = clamp((floorY - footY) / (pose.unit * 2), 0, 0.6);
      const cx = feet.reduce((s, p) => s + p.x, 0) / feet.length;
      g.save();
      g.fillStyle = `rgba(0, 0, 0, ${0.35 * (1 - lift)})`;
      g.beginPath();
      g.ellipse(cx, floorY + pose.unit * 0.08, pose.unit * (1 - lift * 0.5), pose.unit * 0.17 * (1 - lift * 0.5), 0, 0, TAU);
      g.fill();
      g.restore();
    }

    // Toe tip of a leg: towards the foot landmark, or straight down without one.
    function toeOf(an, ft, unit, len) {
      const toward = ft ? norm(sub(ft, an)) : { x: 0, y: 1 };
      return add(an, toward, unit * len);
    }

    // Hand centre: a little past the wrist, along the forearm.
    function handOf(el, wr, unit) {
      return add(wr, norm(sub(wr, el)), unit * 0.06);
    }

    // A big glossy cartoon eye; a happy closed arc while blinking.
    function sparkleEye(g, x, y, er, iris, line) {
      if (blinking()) {
        g.strokeStyle = line;
        g.lineWidth = er * 0.42;
        g.lineCap = "round";
        g.beginPath();
        g.arc(x, y + er * 0.35, er * 0.85, 1.15 * Math.PI, 1.85 * Math.PI);
        g.stroke();
        return;
      }
      const grad = g.createLinearGradient(x, y - er, x, y + er * 1.2);
      grad.addColorStop(0, line);
      grad.addColorStop(1, iris);
      oval(g, { x, y }, er, er * 1.18, grad);
      disc(g, { x: x - er * 0.32, y: y - er * 0.42 }, er * 0.36, "#ffffff");
      disc(g, { x: x + er * 0.36, y: y + er * 0.42 }, er * 0.16, "#ffffff");
    }

    function blush(g, x, y, r) {
      oval(g, { x, y }, r, r * 0.6, BLUSH);
    }

    // Brows that lift at the inner end when the form slips.
    function brows(g, ex, y, r, issues, color) {
      g.strokeStyle = color;
      g.lineWidth = r * 0.07;
      g.lineCap = "round";
      for (const s of [-1, 1]) {
        const x = s * r * 0.36 + ex;
        g.beginPath();
        g.moveTo(x - s * r * 0.13, y - (issues ? r * 0.08 : 0));
        g.lineTo(x + s * r * 0.13, y + (issues ? r * 0.04 : 0));
        g.stroke();
      }
    }

    // Translate and rotate into the head's frame, run `fn`, restore.
    function inHead(g, head, fn) {
      g.save();
      g.translate(head.c.x, head.c.y);
      g.rotate(head.tilt);
      fn();
      g.restore();
    }

    function limbs(g, pose, width, color, lw, pick) {
      for (const parts of pick === "arms" ? pose.arms : pose.legs) {
        // Joints up to the first one not tracked (hip-knee-ankle, shoulder-elbow-wrist).
        const pts = [];
        for (const p of parts.slice(0, 3)) {
          if (!p) break;
          pts.push(p);
        }
        if (pts.length >= 2) strokePath(g, pts, width, color, ch.line, lw);
      }
    }

    // ---- Sloth bear -----------------------------------------------------------
    // Round, shaggy and softly shaded, with long claws and a flower behind one ear.
    function paintSlothBear(g, pose, issues, lw) {
      const { unit, head } = pose;
      const [shA, shB] = pose.shoulders;
      const shMid = mid(shA, shB);
      const bodyAng = Math.atan2(pose.up.x, -pose.up.y);

      limbs(g, pose, unit * 0.42, ch.fur, lw, "legs");
      for (const [, kn, an, ft] of pose.legs) {
        if (!kn || !an) continue;
        const toe = toeOf(an, ft, unit, 0.22);
        strokePath(g, [an, toe], unit * 0.32, ch.furDark, ch.line, lw);
        const d = norm(sub(toe, an));
        const side = { x: -d.y, y: d.x };
        for (const k of [-1, 0, 1]) {
          const base = add(add(toe, d, unit * 0.1), side, k * unit * 0.08);
          strokePath(g, [base, add(base, rot(d, k * 0.25), unit * 0.09)], unit * 0.035, ch.claw, null, 0);
        }
      }

      // Barrel body: a shaggy shaded ellipse from shoulders to hips.
      const [hipA, hipB] = pose.hips;
      const bc = lerp(shMid, pose.hipMid, 0.5);
      const rx = Math.max(dist(shA, shB), dist(hipA, hipB)) / 2 + unit * 0.24;
      const ry = dist(shMid, pose.hipMid) / 2 + unit * 0.28;
      furEllipse(g, bc, rx, ry, bodyAng, 0.07, 26, 1);
      fillOutline(g, shade(g, bc, rx, ry, ch.furLight, ch.fur, ch.furDark), ch.line, lw);

      // The pale V on the chest, with a soft darker edge.
      const v = lerp(shMid, pose.hipMid, 0.32);
      const vArms = [lerp(shA, v, 0.25), v, lerp(shB, v, 0.25)];
      strokePath(g, vArms, unit * 0.16, ch.creamDark, null, 0);
      strokePath(g, vArms, unit * 0.11, ch.cream, null, 0);

      // Shoulder mane, then the arms with their famous long claws.
      for (const t of chains.tufts.slice(5)) ribbon(g, t.pts, unit * 0.34, unit * 0.05, ch.fur, ch.line, lw);
      for (const [sh, el, wr] of pose.arms) {
        if (!el) continue;
        strokePath(g, wr ? [sh, el, wr] : [sh, el], unit * 0.3, ch.fur, ch.line, lw);
        if (!wr) continue;
        const hand = handOf(el, wr, unit);
        disc(g, hand, unit * 0.17, ch.furDark, ch.line, lw);
        const d = norm(sub(wr, el));
        const side = { x: -d.y, y: d.x };
        for (const k of [-1, 0, 1]) {
          const base = add(add(hand, d, unit * 0.12), side, k * unit * 0.08);
          const tip = add(base, rot(d, k * 0.3 + 0.3), unit * 0.22);
          const ctrl = add(lerp(base, tip, 0.5), side, unit * 0.04);
          g.beginPath();
          g.moveTo(base.x, base.y);
          g.quadraticCurveTo(ctrl.x, ctrl.y, tip.x, tip.y);
          g.lineCap = "round";
          g.strokeStyle = ch.line;
          g.lineWidth = unit * 0.05 + lw;
          g.stroke();
          g.strokeStyle = ch.claw;
          g.lineWidth = unit * 0.05;
          g.stroke();
        }
      }

      // Head tufts behind the head, then ears and the head itself.
      const { r } = head;
      for (const t of chains.tufts.slice(0, 5)) ribbon(g, t.pts, r * 0.46, r * 0.07, ch.fur, ch.line, lw);
      const ex = head.yaw * r * 0.3;
      inHead(g, head, () => {
        for (const s of [-1, 1]) {
          const ec = { x: s * r * 0.78, y: -r * 0.7 };
          furEllipse(g, ec, r * 0.3, r * 0.3, 0, 0.12, 9, 40 + s);
          fillOutline(g, shade(g, ec, r * 0.3, r * 0.3, ch.furLight, ch.fur, ch.furDark), ch.line, lw);
          disc(g, ec, r * 0.15, "#6b5a4e");
        }
        const hc = { x: 0, y: 0 };
        furEllipse(g, hc, r * 1.08, r, 0, 0.08, 20, 60);
        fillOutline(g, shade(g, hc, r * 1.08, r, ch.furLight, ch.fur, ch.furDark), ch.line, lw);

        // A little flower tucked behind the right ear.
        const fc = { x: r * 0.98, y: -r * 0.42 };
        for (let i = 0; i < 5; i++) {
          disc(g, add(fc, rot({ x: 0, y: -r * 0.13 }, (i * TAU) / 5)), r * 0.11, "#ff8fb8", ch.line, lw * 0.5);
        }
        disc(g, fc, r * 0.08, "#ffd23f");

        // Long pale snout with a shiny nose.
        const mc = { x: ex * 1.1, y: r * 0.33 };
        g.beginPath();
        g.ellipse(mc.x, mc.y, r * 0.52, r * 0.47, 0, 0, TAU);
        fillOutline(g, shade(g, mc, r * 0.52, r * 0.47, "#fffaf0", ch.cream, ch.creamDark), ch.line, lw * 0.6);
        const nose = { x: ex * 1.35, y: r * 0.15 };
        oval(g, nose, r * 0.24, r * 0.15, ch.line);
        oval(g, { x: nose.x - r * 0.08, y: nose.y - r * 0.05 }, r * 0.07, r * 0.035, "rgba(255, 255, 255, 0.7)", -0.3);

        // Mouth: a contented "w" with a tiny tongue, or a worried "o".
        g.strokeStyle = ch.line;
        g.lineWidth = r * 0.055;
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(nose.x, nose.y + r * 0.12);
        g.lineTo(nose.x, nose.y + r * 0.24);
        g.stroke();
        if (issues) {
          oval(g, { x: nose.x, y: nose.y + r * 0.36 }, r * 0.09, r * 0.11, "#5a2a2a");
          g.stroke();
        } else {
          oval(g, { x: nose.x, y: nose.y + r * 0.32 }, r * 0.07, r * 0.06, "#ff7d9a");
          g.beginPath();
          g.arc(nose.x - r * 0.11, nose.y + r * 0.24, r * 0.11, 0.1 * Math.PI, 0.95 * Math.PI);
          g.moveTo(nose.x + r * 0.22, nose.y + r * 0.26);
          g.arc(nose.x + r * 0.11, nose.y + r * 0.24, r * 0.11, 0.05 * Math.PI, 0.9 * Math.PI);
          g.stroke();
        }

        // Sparkly eyes on soft brown patches, rosy cheeks, worried brows on an issue.
        for (const s of [-1, 1]) {
          const x = s * r * 0.36 + ex;
          disc(g, { x, y: -r * 0.16 }, r * 0.19, "#4d4038");
          sparkleEye(g, x, -r * 0.16, r * 0.12, "#6b4426", "#120a06");
          blush(g, s * r * 0.66 + ex, r * 0.16, r * 0.13);
        }
        brows(g, ex, -r * 0.44, r, issues, ch.creamDark);
      });
    }

    // ---- Bunny ----------------------------------------------------------------
    // Fluffy and pastel, with long floppy ears, a bow, a cotton tail and big feet.
    function paintBunny(g, pose, issues, lw) {
      const { unit, head } = pose;
      const [shA, shB] = pose.shoulders;
      const shMid = mid(shA, shB);
      const [hipA, hipB] = pose.hips;
      const bodyAng = Math.atan2(pose.up.x, -pose.up.y);
      const furShade = (c, rx, ry) => shade(g, c, rx, ry, ch.furLight, ch.fur, ch.furDark);

      // Cotton tail peeking out at the hip.
      const tailC = add(add(pose.hipMid, pose.right, unit * 0.5), pose.up, unit * 0.1);
      furEllipse(g, tailC, unit * 0.2, unit * 0.2, 0, 0.18, 10, 7);
      fillOutline(g, furShade(tailC, unit * 0.2, unit * 0.2), ch.line, lw);

      limbs(g, pose, unit * 0.32, ch.fur, lw, "legs");
      for (const [, kn, an, ft] of pose.legs) {
        if (!kn || !an) continue;
        const toe = toeOf(an, ft, unit, 0.34);
        strokePath(g, [an, toe], unit * 0.26, ch.fur, ch.line, lw);
        disc(g, lerp(an, toe, 0.75), unit * 0.06, ch.pink);
      }

      const bc = lerp(shMid, pose.hipMid, 0.5);
      const rx = Math.max(dist(shA, shB), dist(hipA, hipB)) / 2 + unit * 0.2;
      const ry = dist(shMid, pose.hipMid) / 2 + unit * 0.24;
      furEllipse(g, bc, rx, ry, bodyAng, 0.035, 24, 3);
      fillOutline(g, furShade(bc, rx, ry), ch.line, lw);
      oval(g, add(bc, pose.up, -unit * 0.08), rx * 0.62, ry * 0.68, "#ffffff", bodyAng);

      for (const [sh, el, wr] of pose.arms) {
        if (!el) continue;
        strokePath(g, wr ? [sh, el, wr] : [sh, el], unit * 0.24, ch.fur, ch.line, lw);
        if (wr) disc(g, handOf(el, wr, unit), unit * 0.14, ch.fur, ch.line, lw);
      }

      // Ears behind the head: outer fur, inner pink, rounded tips; a bow on one.
      const { r } = head;
      for (const chain of [chains.a, chains.b]) {
        const pts = chain.pts;
        disc(g, pts[pts.length - 1], r * 0.27, ch.fur, ch.line, lw);
        ribbon(g, pts, r * 0.5, r * 0.56, ch.fur, ch.line, lw);
        ribbon(g, pts.slice(1), r * 0.26, r * 0.3, ch.pink, null, 0);
      }
      const bow = chains.b.pts[1];
      const bd = norm(sub(chains.b.pts[2], bow));
      const bs = { x: -bd.y, y: bd.x };
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(bow.x, bow.y);
        const a = add(add(bow, bs, s * r * 0.34), bd, r * 0.16);
        const b = add(add(bow, bs, s * r * 0.34), bd, -r * 0.16);
        g.lineTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.closePath();
        fillOutline(g, ch.bow, ch.line, lw * 0.7);
      }
      disc(g, bow, r * 0.09, ch.bow, ch.line, lw * 0.7);

      const ex = head.yaw * r * 0.3;
      inHead(g, head, () => {
        const hc = { x: 0, y: 0 };
        furEllipse(g, hc, r * 1.05, r * 0.95, 0, 0.03, 22, 80);
        fillOutline(g, furShade(hc, r * 1.05, r * 0.95), ch.line, lw);
        for (const s of [-1, 1]) {
          sparkleEye(g, s * r * 0.38 + ex, -r * 0.02, r * 0.15, "#8a5ab8", "#2a1830");
          blush(g, s * r * 0.62 + ex, r * 0.3, r * 0.14);
          // Whiskers.
          g.strokeStyle = "rgba(58, 42, 51, 0.45)";
          g.lineWidth = r * 0.03;
          for (const k of [-1, 1]) {
            g.beginPath();
            g.moveTo(s * r * 0.3 + ex, r * 0.3);
            g.lineTo(s * r * 0.85 + ex, r * (0.24 + k * 0.08));
            g.stroke();
          }
        }
        const nose = { x: ex * 1.2, y: r * 0.24 };
        g.beginPath();
        g.moveTo(nose.x - r * 0.09, nose.y - r * 0.04);
        g.lineTo(nose.x + r * 0.09, nose.y - r * 0.04);
        g.lineTo(nose.x, nose.y + r * 0.06);
        g.closePath();
        fillOutline(g, ch.nose, ch.line, lw * 0.4);
        g.strokeStyle = ch.line;
        g.lineWidth = r * 0.05;
        g.lineCap = "round";
        g.beginPath();
        if (issues) {
          g.arc(nose.x, nose.y + r * 0.26, r * 0.08, 0, TAU);
        } else {
          g.arc(nose.x - r * 0.09, nose.y + r * 0.08, r * 0.09, 0.1 * Math.PI, 0.9 * Math.PI);
          g.moveTo(nose.x + r * 0.18, nose.y + r * 0.1);
          g.arc(nose.x + r * 0.09, nose.y + r * 0.08, r * 0.09, 0.1 * Math.PI, 0.9 * Math.PI);
        }
        g.stroke();
        if (!issues) {
          // Two little front teeth.
          g.fillStyle = "#ffffff";
          g.lineWidth = r * 0.025;
          for (const s of [-1, 1]) {
            g.fillRect(nose.x + (s < 0 ? -r * 0.09 : 0), nose.y + r * 0.17, r * 0.09, r * 0.1);
            g.strokeRect(nose.x + (s < 0 ? -r * 0.09 : 0), nose.y + r * 0.17, r * 0.09, r * 0.1);
          }
        }
        brows(g, ex, -r * 0.3, r, issues, "rgba(58, 42, 51, 0.6)");
      });
    }

    // ---- Penguin --------------------------------------------------------------
    // An egg-shaped body with a white tummy, flipper arms and a striped scarf.
    function paintPenguin(g, pose, issues, lw) {
      const { unit, head } = pose;
      const [shA, shB] = pose.shoulders;
      const shMid = mid(shA, shB);
      const [hipA, hipB] = pose.hips;
      const bodyAng = Math.atan2(pose.up.x, -pose.up.y);

      limbs(g, pose, unit * 0.28, ch.back, lw, "legs");
      for (const [, kn, an, ft] of pose.legs) {
        if (!kn || !an) continue;
        strokePath(g, [an, toeOf(an, ft, unit, 0.24)], unit * 0.3, ch.beak, ch.line, lw);
      }

      const bc = lerp(shMid, pose.hipMid, 0.55);
      const rx = Math.max(dist(shA, shB), dist(hipA, hipB)) / 2 + unit * 0.28;
      const ry = dist(shMid, pose.hipMid) / 2 + unit * 0.34;
      g.beginPath();
      g.ellipse(bc.x, bc.y, rx, ry, bodyAng, 0, TAU);
      fillOutline(g, shade(g, bc, rx, ry, ch.backLight, ch.back, ch.backDark), ch.line, lw);
      const tummy = add(bc, pose.up, -unit * 0.06);
      g.beginPath();
      g.ellipse(tummy.x, tummy.y, rx * 0.7, ry * 0.8, bodyAng, 0, TAU);
      g.fillStyle = shade(g, tummy, rx * 0.7, ry * 0.8, "#ffffff", ch.belly, ch.bellyDark);
      g.fill();

      // Scarf ends (striped), flippers, then the band around the neck.
      for (const chain of [chains.b, chains.a]) {
        const pts = chain.pts;
        ribbon(g, pts, unit * 0.14, unit * 0.12, ch.scarf, ch.line, lw);
        for (let i = 1; i < pts.length; i += 2) {
          const d = norm(sub(pts[i], pts[i - 1]));
          const n = { x: -d.y, y: d.x };
          strokePath(g, [add(pts[i], n, unit * 0.055), add(pts[i], n, -unit * 0.055)], unit * 0.035, ch.stripe, null, 0);
        }
      }
      for (const [sh, el, wr] of pose.arms) {
        if (!el) continue;
        const pts = wr ? [sh, el, wr] : [sh, el];
        disc(g, pts[pts.length - 1], unit * 0.07, ch.back, ch.line, lw);
        ribbon(g, pts, unit * 0.34, unit * 0.13, ch.back, ch.line, lw);
      }
      const band = add(pose.neck, pose.up, unit * 0.06);
      strokePath(g, [add(band, pose.right, -unit * 0.3), add(band, pose.right, unit * 0.3)], unit * 0.17, ch.scarf, ch.line, lw);
      disc(g, chains.a.pts[0], unit * 0.09, ch.scarf, ch.line, lw);

      const { r } = head;
      const ex = head.yaw * r * 0.3;
      inHead(g, head, () => {
        const hc = { x: 0, y: 0 };
        g.beginPath();
        g.arc(0, 0, r, 0, TAU);
        fillOutline(g, shade(g, hc, r, r, ch.backLight, ch.back, ch.backDark), ch.line, lw);
        // White face mask, a little feather tuft on top.
        for (const s of [-1, 1]) oval(g, { x: s * r * 0.3 + ex * 0.6, y: r * 0.12 }, r * 0.42, r * 0.56, ch.belly);
        g.strokeStyle = ch.back;
        g.lineWidth = r * 0.08;
        g.lineCap = "round";
        for (const k of [-1, 0, 1]) {
          g.beginPath();
          g.moveTo(k * r * 0.08, -r * 0.95);
          g.quadraticCurveTo(k * r * 0.2, -r * 1.2, k * r * 0.3 + r * 0.05, -r * 1.22);
          g.stroke();
        }
        for (const s of [-1, 1]) {
          sparkleEye(g, s * r * 0.3 + ex, 0, r * 0.13, "#3a5c9e", "#0d1018");
          blush(g, s * r * 0.52 + ex, r * 0.32, r * 0.13);
        }
        // Beak: closed and smiling, or a little open on an issue.
        const b = { x: ex * 1.2, y: r * 0.3 };
        g.beginPath();
        g.moveTo(b.x - r * 0.15, b.y - r * 0.04);
        g.quadraticCurveTo(b.x, b.y - r * 0.16, b.x + r * 0.15, b.y - r * 0.04);
        g.quadraticCurveTo(b.x, b.y + (issues ? r * 0.24 : r * 0.14), b.x - r * 0.15, b.y - r * 0.04);
        fillOutline(g, ch.beak, ch.line, lw * 0.6);
        if (issues) {
          g.strokeStyle = ch.line;
          g.lineWidth = r * 0.03;
          g.beginPath();
          g.moveTo(b.x - r * 0.12, b.y);
          g.lineTo(b.x + r * 0.12, b.y);
          g.stroke();
        }
        brows(g, ex, -r * 0.25, r, issues, "rgba(13, 16, 24, 0.7)");
      });
    }

    // ---- Baby dragon ----------------------------------------------------------
    // Chubby and lavender, with flapping wings, horns, a spiky tail ending in a heart.
    function drawWing(g, pose, sh, wing, side, lw) {
      const { unit } = pose;
      const out = scale(pose.right, side);
      const a = wing.a + Math.sin(clock * 7 + side) * 0.05;
      const dir = norm(add(scale(out, Math.cos(a)), pose.up, Math.sin(a)));
      const root = add(add(sh, pose.up, unit * 0.05), out, -unit * 0.08);
      const L = unit * 1.15;
      g.save();
      g.translate(root.x, root.y);
      g.rotate(Math.atan2(dir.y, dir.x));
      g.scale(1, side); // local +y is always the side away from the head
      const fingers = [
        { x: L, y: 0 },
        { x: L * 0.72, y: L * 0.42 },
        { x: L * 0.42, y: L * 0.5 },
        { x: L * 0.12, y: L * 0.36 },
      ];
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(L * 0.5, -L * 0.16, L, 0);
      for (let i = 1; i < fingers.length; i++) {
        const a0 = fingers[i - 1];
        const a1 = fingers[i];
        const ctl = lerp(lerp(a0, a1, 0.5), { x: 0, y: 0 }, 0.3);
        g.quadraticCurveTo(ctl.x, ctl.y, a1.x, a1.y);
      }
      g.closePath();
      fillOutline(g, ch.wing, ch.line, lw);
      g.strokeStyle = ch.wingDark;
      g.lineWidth = unit * 0.04;
      g.lineCap = "round";
      for (const f of fingers.slice(1, 3)) {
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(f.x, f.y);
        g.stroke();
      }
      g.restore();
    }

    function paintDragon(g, pose, issues, lw) {
      const { unit, head } = pose;
      const [shA, shB] = pose.shoulders;
      const shMid = mid(shA, shB);
      const [hipA, hipB] = pose.hips;
      const bodyAng = Math.atan2(pose.up.x, -pose.up.y);

      pose.arms.forEach(([sh], i) => drawWing(g, pose, sh, wings[i], sideOf(pose, sh), lw));

      // Tail with pink spikes along the top and a heart at the tip.
      const tail = chains.tail.pts;
      ribbon(g, tail, unit * 0.32, unit * 0.08, ch.body, ch.line, lw);
      for (let i = 1; i < tail.length - 1; i++) {
        const d = norm(sub(tail[i + 1], tail[i - 1]));
        const n = { x: d.y, y: -d.x };
        const w = unit * (0.13 - i * 0.012);
        const base = add(tail[i], n, unit * (0.16 - i * 0.017));
        g.beginPath();
        g.moveTo(base.x - d.x * w * 0.6, base.y - d.y * w * 0.6);
        g.lineTo(base.x + n.x * w, base.y + n.y * w);
        g.lineTo(base.x + d.x * w * 0.6, base.y + d.y * w * 0.6);
        g.closePath();
        fillOutline(g, ch.spike, ch.line, lw * 0.6);
      }
      const tip = tail[tail.length - 1];
      const tipDir = norm(sub(tip, tail[tail.length - 2]));
      heart(g, add(tip, tipDir, unit * 0.06), unit * 0.17, ch.spike, Math.atan2(tipDir.y, tipDir.x) + Math.PI / 2);

      limbs(g, pose, unit * 0.36, ch.body, lw, "legs");
      for (const [, kn, an, ft] of pose.legs) {
        if (!kn || !an) continue;
        const toe = toeOf(an, ft, unit, 0.22);
        strokePath(g, [an, toe], unit * 0.28, ch.bodyDark, ch.line, lw);
        const d = norm(sub(toe, an));
        for (const k of [-1, 0, 1]) disc(g, add(add(toe, d, unit * 0.1), { x: -d.y, y: d.x }, k * unit * 0.08), unit * 0.04, ch.horn);
      }

      const bc = lerp(shMid, pose.hipMid, 0.5);
      const rx = Math.max(dist(shA, shB), dist(hipA, hipB)) / 2 + unit * 0.22;
      const ry = dist(shMid, pose.hipMid) / 2 + unit * 0.26;
      g.beginPath();
      g.ellipse(bc.x, bc.y, rx, ry, bodyAng, 0, TAU);
      fillOutline(g, shade(g, bc, rx, ry, ch.bodyLight, ch.body, ch.bodyDark), ch.line, lw);
      // Striped yellow belly.
      const belly = add(bc, pose.up, -unit * 0.05);
      oval(g, belly, rx * 0.55, ry * 0.75, ch.belly, bodyAng);
      g.save();
      g.beginPath();
      g.ellipse(belly.x, belly.y, rx * 0.55, ry * 0.75, bodyAng, 0, TAU);
      g.clip();
      g.strokeStyle = ch.bellyLine;
      g.lineWidth = unit * 0.035;
      for (const k of [-0.45, -0.15, 0.15, 0.45]) {
        const p = add(belly, pose.up, -k * ry);
        strokePath(g, [add(p, pose.right, -rx), add(p, pose.right, rx)], unit * 0.035, ch.bellyLine, null, 0);
      }
      g.restore();

      for (const [sh, el, wr] of pose.arms) {
        if (!el) continue;
        strokePath(g, wr ? [sh, el, wr] : [sh, el], unit * 0.24, ch.body, ch.line, lw);
        if (wr) disc(g, handOf(el, wr, unit), unit * 0.14, ch.body, ch.line, lw);
      }

      const { r } = head;
      const ex = head.yaw * r * 0.3;
      inHead(g, head, () => {
        // Horns and a row of little head spikes, behind the head.
        for (const s of [-1, 1]) {
          g.beginPath();
          g.moveTo(s * r * 0.3, -r * 0.75);
          g.quadraticCurveTo(s * r * 0.55, -r * 1.25, s * r * 0.72, -r * 1.3);
          g.quadraticCurveTo(s * r * 0.62, -r * 0.95, s * r * 0.65, -r * 0.62);
          g.closePath();
          fillOutline(g, ch.horn, ch.line, lw * 0.8);
        }
        for (const k of [-1, 0, 1]) {
          const p = { x: k * r * 0.15, y: -r * 0.95 };
          g.beginPath();
          g.moveTo(p.x - r * 0.08, p.y + r * 0.05);
          g.lineTo(p.x, p.y - r * 0.15);
          g.lineTo(p.x + r * 0.08, p.y + r * 0.05);
          g.closePath();
          fillOutline(g, ch.spike, ch.line, lw * 0.6);
        }
        const hc = { x: 0, y: 0 };
        g.beginPath();
        g.ellipse(0, 0, r * 1.05, r * 0.95, 0, 0, TAU);
        fillOutline(g, shade(g, hc, r * 1.05, r * 0.95, ch.bodyLight, ch.body, ch.bodyDark), ch.line, lw);
        // Snout with nostrils.
        const sn = { x: ex * 1.1, y: r * 0.36 };
        oval(g, sn, r * 0.44, r * 0.3, ch.bodyLight);
        for (const s of [-1, 1]) disc(g, { x: sn.x + s * r * 0.12, y: sn.y - r * 0.08 }, r * 0.035, ch.bodyDark);
        for (const s of [-1, 1]) {
          sparkleEye(g, s * r * 0.4 + ex, -r * 0.12, r * 0.16, "#ffb800", "#22163f");
          blush(g, s * r * 0.66 + ex, r * 0.22, r * 0.14);
        }
        g.strokeStyle = ch.line;
        g.lineWidth = r * 0.05;
        g.lineCap = "round";
        g.beginPath();
        if (issues) g.arc(sn.x, sn.y + r * 0.3, r * 0.12, 1.15 * Math.PI, 1.85 * Math.PI);
        else g.arc(sn.x, sn.y, r * 0.2, 0.2 * Math.PI, 0.8 * Math.PI);
        g.stroke();
        if (!issues) {
          // One tiny fang.
          const f = { x: sn.x + r * 0.1, y: sn.y + r * 0.17 };
          g.beginPath();
          g.moveTo(f.x - r * 0.04, f.y);
          g.lineTo(f.x, f.y + r * 0.08);
          g.lineTo(f.x + r * 0.04, f.y);
          g.closePath();
          fillOutline(g, "#ffffff", ch.line, lw * 0.4);
        }
        brows(g, ex, -r * 0.42, r, issues, ch.bodyDark);
      });
    }

    // ---- Surfer ---------------------------------------------------------------
    function paintSurfer(g, pose, issues, lw) {
      const { unit, head } = pose;
      const [shA, shB] = pose.shoulders;
      const [hipA, hipB] = pose.hips;
      const legW = unit * 0.3;

      // Bare legs, board shorts over the thighs, bare feet.
      for (const [hip, kn, an, ft] of pose.legs) {
        if (!kn) continue;
        strokePath(g, an ? [hip, kn, an] : [hip, kn], legW, ch.skin, ch.line, lw);
        strokePath(g, [hip, lerp(hip, kn, 0.9)], legW * 1.25, ch.bottom, ch.line, lw);
        if (an) strokePath(g, [an, toeOf(an, ft, unit, 0.22)], unit * 0.22, ch.skin, ch.line, lw);
      }

      roundQuad(g, [shA, shB, hipB, hipA], unit * 0.24, ch.top, ch.line, lw);
      const chest = lerp(mid(shA, shB), pose.hipMid, 0.42);
      disc(g, chest, unit * 0.15, "#ffd23f"); // sunset print
      strokePath(g, [add(chest, pose.right, -unit * 0.22), add(chest, pose.right, unit * 0.22)], unit * 0.05, ch.bottom, null, 0);

      strokePath(g, [pose.neck, lerp(pose.neck, head.c, 0.6)], unit * 0.17, ch.skin, ch.line, lw);
      for (const [sh, el, wr] of pose.arms) {
        if (!el) continue;
        strokePath(g, wr ? [sh, el, wr] : [sh, el], unit * 0.2, ch.skin, ch.line, lw);
        if (wr) disc(g, handOf(el, wr, unit), unit * 0.13, ch.skin, ch.line, lw);
      }

      // Flower garland over the chest.
      const lei = chains.lei.pts;
      strokePath(g, lei, unit * 0.03, "#2f9e5b", null, 0);
      lei.forEach((p, i) => {
        disc(g, p, unit * 0.075, LEI_FLOWERS[i % LEI_FLOWERS.length], ch.line, lw * 0.5);
        disc(g, p, unit * 0.025, "#ffd23f");
      });

      // Curls behind the head so they frame the face.
      const { r } = head;
      for (const t of chains.tufts.slice(0, 6)) {
        t.pts.forEach((p, i) => disc(g, p, r * (0.34 - i * 0.07), ch.hair, ch.line, lw * 0.7));
      }

      const ex = head.yaw * r * 0.3;
      inHead(g, head, () => {
        disc(g, { x: 0, y: 0 }, r, ch.skin, ch.line, lw);
        g.save();
        g.beginPath();
        g.arc(0, 0, r, 0, TAU);
        g.clip();
        oval(g, { x: head.yaw * r * 0.2, y: -r * 0.55 }, r * 1.15, r * 0.62, ch.hair);
        g.restore();
        g.beginPath();
        g.arc(0, 0, r, 0, TAU);
        g.lineWidth = lw;
        g.strokeStyle = ch.line;
        g.stroke();

        // Sunglasses pushed up on the head.
        for (const s of [-1, 1]) {
          g.beginPath();
          g.roundRect(s * r * 0.33 + ex * 0.5 - r * 0.22, -r * 0.72, r * 0.44, r * 0.26, r * 0.1);
          fillOutline(g, ch.shades, ch.line, lw * 0.6);
          g.strokeStyle = "rgba(255, 255, 255, 0.5)";
          g.lineWidth = r * 0.04;
          g.beginPath();
          g.moveTo(s * r * 0.33 + ex * 0.5 - r * 0.1, -r * 0.66);
          g.lineTo(s * r * 0.33 + ex * 0.5 - r * 0.02, -r * 0.54);
          g.stroke();
        }
        strokePath(g, [{ x: -r * 0.11 + ex * 0.5, y: -r * 0.62 }, { x: r * 0.11 + ex * 0.5, y: -r * 0.62 }], r * 0.05, ch.shades, null, 0);

        for (const s of [-1, 1]) {
          sparkleEye(g, s * r * 0.33 + ex, r * 0.02, r * 0.12, "#3b6fd8", ch.line);
          blush(g, s * r * 0.55 + ex, r * 0.3, r * 0.12);
        }
        g.strokeStyle = ch.line;
        g.lineWidth = r * 0.08;
        g.lineCap = "round";
        g.beginPath();
        if (issues) g.arc(ex, r * 0.48, r * 0.16, 1.15 * Math.PI, 1.85 * Math.PI);
        else g.arc(ex, r * 0.22, r * 0.3, 0.15 * Math.PI, 0.85 * Math.PI);
        g.stroke();
        for (const s of [-1, 1]) {
          for (const [fx, fy] of [
            [0.42, 0.18],
            [0.5, 0.22],
            [0.46, 0.27],
          ]) {
            disc(g, { x: s * r * fx + ex, y: r * fy }, r * 0.03, "rgba(90, 45, 20, 0.55)");
          }
        }
        brows(g, ex, -r * 0.22, r, issues, "rgba(29, 20, 16, 0.6)");
      });
    }

    // ---- Space critter --------------------------------------------------------
    function paintCritter(g, pose, issues, lw) {
      const { unit, head } = pose;
      const [shA, shB] = pose.shoulders;
      const [hipA, hipB] = pose.hips;

      limbs(g, pose, unit * 0.36, ch.limb, lw, "legs");
      for (const [, kn, an, ft] of pose.legs) {
        if (kn && an) strokePath(g, [an, toeOf(an, ft, unit, 0.22)], unit * 0.26, ch.foot, ch.line, lw);
      }

      // Jelly body: squashes and stretches around its centre.
      const tc = lerp(mid(shA, shB), pose.hipMid, 0.5);
      const quad = [shA, shB, hipB, hipA].map((p) => squash(p, tc, pose));
      roundQuad(g, quad, unit * 0.35, ch.skin, ch.line, lw);
      const belly = squash(lerp(tc, pose.hipMid, 0.2), tc, pose);
      oval(g, belly, unit * 0.32 * (1 + wobble.w), unit * 0.4 * (1 - wobble.w), ch.belly, Math.atan2(pose.right.y, pose.right.x));
      for (const [sx, sy, sr] of [
        [-0.42, -0.25, 0.08],
        [0.45, -0.05, 0.06],
        [-0.35, 0.3, 0.05],
      ]) {
        disc(g, squash(add(add(tc, pose.right, sx * unit), pose.up, -sy * unit), tc, pose), unit * sr, ch.spot);
      }
      // Glitter suspended in the jelly, twinkling.
      for (let i = 0; i < 7; i++) {
        const p = squash(add(add(tc, pose.right, (hash(i) - 0.5) * unit * 0.8), pose.up, (hash(i + 9) - 0.5) * unit * 1.1), tc, pose);
        const a = 0.25 + 0.75 * Math.max(0, Math.sin(clock * 3 + i * 1.7));
        twinkle(g, p, unit * 0.05, `rgba(255, 255, 255, ${a})`);
      }
      const shine = squash(add(add(tc, pose.right, -unit * 0.3), pose.up, unit * 0.35), tc, pose);
      strokePath(g, [shine, add(shine, pose.up, -unit * 0.18)], unit * 0.06, "rgba(255, 255, 255, 0.55)", null, 0);

      strokePath(g, [pose.neck, lerp(pose.neck, head.c, 0.6)], unit * 0.17, ch.skin, ch.line, lw);
      for (const [sh, el, wr] of pose.arms) {
        if (!el) continue;
        strokePath(g, wr ? [sh, el, wr] : [sh, el], unit * 0.24, ch.skin, ch.line, lw);
        if (wr) disc(g, handOf(el, wr, unit), unit * 0.13, ch.limb, ch.line, lw);
      }

      // A big jelly dome that squashes with the body, three eyes and a one-tooth grin.
      const { r } = head;
      const ex = head.yaw * r * 0.3;
      inHead(g, head, () => {
        g.scale(1.25 * (1 + wobble.w * 0.8), 1.25 * (1 - wobble.w * 0.8));
        g.beginPath();
        g.ellipse(0, 0, r * 1.15, r * 0.95, 0, 0, TAU);
        fillOutline(g, ch.skin, ch.line, lw);
        disc(g, { x: -r * 0.55, y: -r * 0.6 }, r * 0.1, ch.spot);
        disc(g, { x: r * 0.7, y: -r * 0.45 }, r * 0.07, ch.spot);
        g.strokeStyle = "rgba(255, 255, 255, 0.6)";
        g.lineWidth = r * 0.1;
        g.lineCap = "round";
        g.beginPath();
        g.ellipse(0, 0, r * 0.9, r * 0.72, 0, 1.15 * Math.PI, 1.4 * Math.PI);
        g.stroke();

        const look = head.yaw * r * 0.08;
        for (const s of [-1, 0, 1]) {
          const er = s ? r * 0.2 : r * 0.27;
          const p = { x: s * r * 0.5 + ex, y: -r * 0.12 - (s ? 0 : r * 0.08) };
          if (blinking()) {
            sparkleEye(g, p.x, p.y, er * 0.8, ch.line, ch.line);
            continue;
          }
          disc(g, p, er, "#ffffff", ch.line, r * 0.05);
          disc(g, { x: p.x + look, y: p.y + er * 0.1 }, er * 0.5, ch.line);
          disc(g, { x: p.x + look - er * 0.16, y: p.y - er * 0.1 }, er * 0.17, "#ffffff");
          disc(g, { x: p.x + look + er * 0.16, y: p.y + er * 0.25 }, er * 0.08, "#ffffff");
        }
        for (const s of [-1, 1]) blush(g, s * r * 0.62 + ex, r * 0.25, r * 0.13);
        g.strokeStyle = ch.line;
        g.lineWidth = r * 0.08;
        g.beginPath();
        if (issues) g.arc(ex, r * 0.62, r * 0.22, 1.15 * Math.PI, 1.85 * Math.PI);
        else g.arc(ex, r * 0.18, r * 0.42, 0.18 * Math.PI, 0.82 * Math.PI);
        g.stroke();
        if (!issues) {
          g.fillStyle = "#ffffff";
          g.fillRect(ex + r * 0.08, r * 0.56, r * 0.13, r * 0.14);
          g.lineWidth = r * 0.03;
          g.strokeRect(ex + r * 0.08, r * 0.56, r * 0.13, r * 0.14);
        }
      });
    }

    const PAINTERS = {
      slothbear: paintSlothBear,
      bunny: paintBunny,
      penguin: paintPenguin,
      dragon: paintDragon,
      surfer: paintSurfer,
      critter: paintCritter,
    };

    function advance(dt, h) {
      clock += dt;
      if (clock > nextBlink) {
        blinkUntil = clock + 0.14;
        nextBlink = clock + 2 + Math.random() * 3.5;
      }
      acc = Math.min(acc + dt, STEP * MAX_STEPS);
      let pose = null;
      while (acc >= STEP) {
        for (const j of joints.values()) stepJoint(j, STEP);
        if (key === "critter") stepWobble(STEP, h);
        pose = derive(h);
        if (pose) stepChains(pose, STEP, h);
        acc -= STEP;
      }
      return pose ?? derive(h);
    }

    function compose(ctx, pose, w, h, issues, dt) {
      if (!layer || layer.width !== w || layer.height !== h) layer = new OffscreenCanvas(w, h);
      // Idle breathing: the head rises and falls a touch.
      const breath = Math.sin((clock * TAU) / BREATH_PERIOD);
      const shown = { ...pose, head: { ...pose.head, c: add(pose.head.c, pose.up, pose.unit * 0.015 * breath) } };
      const g = layer.getContext("2d");
      g.clearRect(0, 0, w, h);
      drawShadow(g, shown, dt);
      PAINTERS[key](g, shown, issues, Math.max(1.5, pose.unit * 0.045));
      // One alpha for the whole figure, so overlapping parts don't show seams
      // while it fades in or out.
      const presence = Math.min(J("shL").a, J("shR").a);
      ctx.save();
      ctx.globalAlpha = clamp(presence, 0, 1);
      // A soft light halo lifts the figure off the backdrop; it turns into the
      // orange glow on a form issue.
      ctx.shadowColor = issues ? ISSUE_COLOR : "rgba(190, 210, 255, 0.45)";
      ctx.shadowBlur = pose.unit * (issues ? 0.35 : 0.22);
      ctx.drawImage(layer, 0, 0);
      ctx.restore();
    }

    return {
      key,
      // `lms`: the latest landmarks, or null when nobody is tracked (the figure fades out).
      draw(ctx, lms, w, h, { issues = false, now = performance.now() } = {}) {
        const dt = lastNow ? clamp((now - lastNow) / 1000, 0, 0.25) : 0;
        lastNow = now;
        lastH = h;
        setTargets(lms, w, h);
        const pose = advance(dt, h);
        lastPose = pose;
        if (pose) compose(ctx, pose, w, h, issues, dt);
        stepParticles(dt);
        drawParticles(ctx);
      },
      // A finished rep: a burst of hearts and stars (bigger for a clean rep).
      celebrate(big = true) {
        burst(big);
      },
      // Draw a still pose with the loose parts already settled (picker thumbnails).
      still(ctx, lms, w, h) {
        setTargets(lms, w, h);
        for (const j of joints.values()) j.a = j.on ? 1 : 0;
        let pose = null;
        for (let i = 0; i < 240; i++) {
          pose = derive(h);
          if (pose) stepChains(pose, STEP, h);
        }
        clock = 1; // eyes open
        if (pose) compose(ctx, pose, w, h, false, 0);
      },
    };
  }

  // Picker thumbnail for a character key, or "blur" for the blurred-camera look.
  function drawThumb(canvas, key) {
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
      create("surfer").still(fg, STANDING, w, h);
      g.save();
      g.filter = `blur(${Math.max(3, w / 18)}px)`;
      g.drawImage(fig, 0, 0);
      g.restore();
      return;
    }
    drawBackdrop(g, w, h);
    create(key).still(g, STANDING, w, h);
  }

  return { CHARACTERS, create, drawBackdrop, drawThumb };
})();
