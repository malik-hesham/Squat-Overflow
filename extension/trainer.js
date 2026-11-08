"use strict";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DEFAULTS = {
  serverUrl: globalThis.POSE_SERVER_URL ?? "ws://127.0.0.1:8765/ws", // set by avatar-global.js from config.js
  exercise: "neck_tilt",
  voice: false,
  privacy: false,
  privacyStyle: "blur", // sensitive mode look: "blur" or an Avatar.CHARACTERS key
  angleMode: "2d", // "3d" = joint angles from the pose model's world landmarks
  calibrations: {}, // "exercise:mode" -> { rest, target } learnt from the user's own reps
  breakEnabled: true, // read by the service worker too (desk break coach)
  breakInterval: 50,
};
const CAPTURE_WIDTH = 480; // frames are downscaled before sending
const JPEG_QUALITY = 0.7;
const INFLIGHT_TIMEOUT_MS = 3000; // resend if a result never arrives
const HISTORY_SAMPLES = 300; // angle chart window (~20 s at 15 fps)
const CUE_HOLD_MS = 700; // keep a cue on screen briefly to avoid flicker
const MIN_VIS = 0.5;
const PRIVACY_DOWNSCALE = 24; // blur strength: preview is shrunk by this factor, then scaled back up
const MASK_MAX_AGE_MS = 500; // older person masks are distrusted; the whole frame is blurred instead

// Used only on the very first run with the server offline. The server's catalog
// (the 40 office exercises, five per pain area) is prefetched on page load and cached under CATALOG_KEY.
const FALLBACK_EXERCISES = [
  {
    key: "neck_tilt",
    label: "Neck side tilt",
    metric: "Head tilt",
    camera: "front",
    category: "Neck tension",
  },
  {
    key: "head_turn",
    label: "Look over your shoulder",
    metric: "Head turn",
    camera: "front",
    category: "Neck tension",
  },
  {
    key: "overhead_reach",
    label: "Overhead reach",
    metric: "Arm height",
    camera: "front",
    category: "Shoulder & rotator cuff",
  },
];
const CATALOG_KEY = "exerciseCatalog";
const PREFETCH_TIMEOUT_MS = 3000;
const FALLBACK_CONNECTIONS = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [27, 29],
  [29, 31],
  [27, 31],
  [24, 26],
  [26, 28],
  [28, 30],
  [30, 32],
  [28, 32],
];
const CAMERA_HINTS = {
  side: "Put the camera side-on, 2–3 m away, with your whole body in frame.",
  front:
    "Face the camera. Seated moves need your head, shoulders and arms in frame; standing ones your whole body.",
};
const STAGE_LABEL = {
  waiting: "get set",
  rest: "ready",
  moving: "going",
  work: "target hit",
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const els = {
  conn: $("conn"),
  connText: $("connText"),
  video: $("video"),
  overlay: $("overlay"),
  placeholder: $("placeholder"),
  hud: $("hud"),
  hudReps: $("hudReps"),
  hudAngle: $("hudAngle"),
  hudMetric: $("hudMetric"),
  hudStage: $("hudStage"),
  cues: $("cues"),
  flash: $("flash"),
  chart: $("chart"),
  chartTitle: $("chartTitle"),
  perf: $("perf"),
  exercise: $("exercise"),
  cameraHint: $("cameraHint"),
  howTo: $("howTo"),
  demo: $("demo"),
  demoBtn: $("demoBtn"),
  demoCredit: $("demoCredit"),
  startBtn: $("startBtn"),
  resetBtn: $("resetBtn"),
  voice: $("voice"),
  sReps: $("sReps"),
  sGood: $("sGood"),
  sPartial: $("sPartial"),
  sTempo: $("sTempo"),
  sRom: $("sRom"),
  sScore: $("sScore"),
  topIssues: $("topIssues"),
  repLog: $("repLog"),
  repEmpty: $("repEmpty"),
  exportBtn: $("exportBtn"),
  serverUrl: $("serverUrl"),
  privacy: $("privacy"),
  privacyStyles: $("privacyStyles"),
  styleGrid: $("styleGrid"),
  hudPrivacy: $("hudPrivacy"),
  angle3d: $("angle3d"),
  chartLegend: $("chartLegend"),
  legendMain: $("legendMain"),
  legendAlt: $("legendAlt"),
  calib: document.querySelector(".calib"),
  calibText: $("calibText"),
  calibBtn: $("calibBtn"),
  calibReset: $("calibReset"),
  calibBanner: $("calibBanner"),
  calibBannerText: $("calibBannerText"),
  calibDots: $("calibDots"),
  calibCancel: $("calibCancel"),
  routine: $("routine"),
  routineStep: $("routineStep"),
  routineName: $("routineName"),
  routineCount: $("routineCount"),
  routineBar: $("routineBar"),
  routineSkip: $("routineSkip"),
  routineEnd: $("routineEnd"),
  shareBtn: $("shareBtn"),
  breakEnabled: $("breakEnabled"),
  breakInterval: $("breakInterval"),
  breakNext: $("breakNext"),
  breakToday: $("breakToday"),
  breakNow: $("breakNow"),
  breakTest: $("breakTest"),
  cardDialog: $("cardDialog"),
  cardImg: $("cardImg"),
  cardClose: $("cardClose"),
  cardDownload: $("cardDownload"),
  cardCopy: $("cardCopy"),
};

const state = {
  settings: { ...DEFAULTS },
  exercises: FALLBACK_EXERCISES,
  connections: FALLBACK_CONNECTIONS,
  ws: null,
  stream: null,
  running: false,
  inflightSince: 0,
  reconnectTimer: 0,
  reconnectDelay: 500,
  capture: null,
  latest: null,
  latestAt: 0,
  thresholds: null,
  demoWindowId: null,
  history: [],
  reps: [],
  cueSeen: new Map(),
  frameTimes: [],
  mask: null, // { img, at }: latest decoded person mask (sensitive mode)
  maskSeq: 0, // guards against out-of-order async mask decodes
  fx: null, // full-size canvas for the blurred layer
  fxSmall: null, // tiny canvas used to blur by downscaling
  avatar: null, // Avatar renderer while sensitive mode shows a character
  calibrating: false,
  cycle: null, // { angle, landmarks } at the deepest point of the rep in progress
  aspect: 4 / 3, // video width / height, to draw poses without distortion
  routine: null, // desk break in progress, see startBreak()
  card: null, // { blob, name } of the last session card
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
async function loadSettings() {
  try {
    const stored = await chrome.storage.local.get([
      ...Object.keys(DEFAULTS),
      CATALOG_KEY,
    ]);
    const { [CATALOG_KEY]: catalog, ...settings } = stored;
    state.settings = { ...DEFAULTS, ...settings };
    if (Array.isArray(catalog?.exercises) && catalog.exercises.length) {
      state.exercises = catalog.exercises;
      state.connections = catalog.connections ?? state.connections;
    }
  } catch (err) {
    console.warn("Using default settings:", err);
  }
}

// Server sent its catalog: use it now and cache it so the next page load has it
// before any connection exists.
function applyCatalog(msg) {
  if (!Array.isArray(msg.exercises) || !msg.exercises.length) return;
  state.exercises = msg.exercises;
  state.connections = msg.connections ?? state.connections;
  renderExerciseOptions();
  chrome.storage.local
    .set({
      [CATALOG_KEY]: {
        exercises: state.exercises,
        connections: state.connections,
      },
    })
    .catch((err) => console.warn("Could not cache exercise catalog:", err));
}

// Fetch the catalog on page load without starting the camera. The server only
// loads the pose model on the first frame, so this connection is cheap.
function prefetchCatalog() {
  let ws;
  try {
    ws = new WebSocket(state.settings.serverUrl);
  } catch {
    return; // invalid URL; the cached or fallback list stays
  }
  const timer = setTimeout(() => ws.close(), PREFETCH_TIMEOUT_MS);
  ws.addEventListener("message", (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "ready") applyCatalog(msg);
    } catch (err) {
      console.warn("Bad catalog message:", err);
    }
    clearTimeout(timer);
    ws.close();
  });
  ws.addEventListener("error", () => clearTimeout(timer)); // server offline: keep cached list
}

async function saveSettings(patch) {
  Object.assign(state.settings, patch);
  try {
    await chrome.storage.local.set(patch);
  } catch (err) {
    console.warn("Could not save settings:", err);
  }
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------
function setConn(kind, text) {
  els.conn.dataset.state = kind;
  els.connText.textContent = text;
}

function connect() {
  clearTimeout(state.reconnectTimer);
  if (state.ws && state.ws.readyState <= WebSocket.OPEN) return;

  setConn("connecting", "Connecting…");
  let ws;
  try {
    ws = new WebSocket(state.settings.serverUrl);
  } catch (err) {
    setConn("error", "Invalid server URL");
    return;
  }
  ws.binaryType = "arraybuffer";
  state.ws = ws;

  ws.addEventListener("open", () => {
    state.reconnectDelay = 500;
    state.inflightSince = 0;
    setConn("open", "Connected");
    sendJson({ type: "angles", mode: state.settings.angleMode });
    configureExercise();
    sendJson({ type: "privacy", enabled: wantsMask() });
    pump();
  });
  ws.addEventListener("message", (ev) => {
    try {
      onMessage(JSON.parse(ev.data));
    } catch (err) {
      console.error("Bad message from server:", err);
    }
  });
  ws.addEventListener("close", () => {
    if (state.ws !== ws) return; // closed on purpose
    state.ws = null;
    state.inflightSince = 0;
    setConn("error", "Server offline · run npm run start:dev in server/");
    if (state.running) {
      state.reconnectTimer = setTimeout(connect, state.reconnectDelay);
      state.reconnectDelay = Math.min(state.reconnectDelay * 2, 5000);
    }
  });
}

function disconnect() {
  clearTimeout(state.reconnectTimer);
  const ws = state.ws;
  state.ws = null;
  if (ws) ws.close();
  setConn("idle", "Not connected");
}

function sendJson(obj) {
  if (state.ws?.readyState === WebSocket.OPEN)
    state.ws.send(JSON.stringify(obj));
}

function onMessage(msg) {
  switch (msg.type) {
    case "ready":
      applyCatalog(msg);
      break;
    case "frame":
      state.inflightSince = 0;
      trackFps();
      if ("mask" in msg) updateMask(msg.mask);
      if (msg.exercise === state.settings.exercise) applyFrame(msg);
      pump();
      break;
    case "error":
      console.warn("Server error:", msg.message);
      if (state.inflightSince) {
        state.inflightSince = 0;
        pump();
      }
      break;
    default:
      break;
  }
}

// One frame in flight at a time: the next frame is sent when the result for
// the previous one arrives, so a slow server lowers the frame rate instead of
// building up a queue.
async function pump() {
  const ws = state.ws;
  if (!state.running || !ws || ws.readyState !== WebSocket.OPEN) return;
  if (state.inflightSince) return;
  const video = els.video;
  if (video.readyState < 2 || !video.videoWidth) {
    setTimeout(pump, 50);
    return;
  }
  state.inflightSince = performance.now();
  try {
    const w = CAPTURE_WIDTH;
    const h = Math.round((video.videoHeight * w) / video.videoWidth);
    if (
      !state.capture ||
      state.capture.width !== w ||
      state.capture.height !== h
    ) {
      state.capture = new OffscreenCanvas(w, h);
    }
    state.capture.getContext("2d").drawImage(video, 0, 0, w, h);
    state.aspect = w / h;
    const blob = await state.capture.convertToBlob({
      type: "image/jpeg",
      quality: JPEG_QUALITY,
    });
    const buf = await blob.arrayBuffer();
    if (state.running && ws.readyState === WebSocket.OPEN) ws.send(buf);
    else state.inflightSince = 0;
  } catch (err) {
    console.error("Frame capture failed:", err);
    state.inflightSince = 0;
    setTimeout(pump, 200);
  }
}

setInterval(() => {
  if (
    state.inflightSince &&
    performance.now() - state.inflightSince > INFLIGHT_TIMEOUT_MS
  ) {
    state.inflightSince = 0;
    pump();
  }
}, 1000);

function trackFps() {
  const now = performance.now();
  state.frameTimes.push(now);
  while (state.frameTimes.length && now - state.frameTimes[0] > 2000)
    state.frameTimes.shift();
}

// ---------------------------------------------------------------------------
// Results -> UI
// ---------------------------------------------------------------------------
function applyFrame(msg) {
  state.latest = msg;
  state.latestAt = performance.now();
  const firstThresholds = !state.thresholds;
  state.thresholds = msg.thresholds;
  if (firstThresholds) renderCalib();

  state.history.push({ a: msg.angle, alt: msg.angle_alt ?? null });
  if (state.history.length > HISTORY_SAMPLES) state.history.shift();
  updateLegend(msg);

  const s = msg.summary;
  els.hudReps.textContent = s.reps;
  els.hudAngle.textContent =
    msg.angle == null ? "–" : `${Math.round(msg.angle)}°`;
  els.hudStage.textContent = STAGE_LABEL[msg.stage] ?? msg.stage;
  els.hudStage.dataset.stage = msg.stage;

  els.sReps.textContent = s.reps;
  els.sGood.textContent = s.good_reps;
  els.sPartial.textContent = s.partial_reps;
  els.sTempo.textContent =
    s.avg_duration_s == null ? "–" : `${s.avg_duration_s}s`;
  els.sRom.textContent = s.avg_rom == null ? "–" : `${Math.round(s.avg_rom)}°`;
  els.sScore.textContent = s.avg_score == null ? "–" : Math.round(s.avg_score);
  renderTopIssues(s.top_issues);
  renderCues(msg.feedback);

  const fps = state.frameTimes.length / 2;
  els.perf.textContent = `${fps.toFixed(0)} fps · ${Math.round(msg.latency_ms)} ms/frame`;

  trackCyclePose(msg);
  if (msg.rep_event) onRep(msg.rep_event);
  if (msg.stage === "rest" || msg.stage === "waiting") state.cycle = null;
  if (msg.calibration) onCalibration(msg.calibration);
  routineProgress(msg);
}

// Remember the pose at the deepest point of each rep: the share card draws the
// best rep's figure from it (landmarks only, never a camera image).
function trackCyclePose(msg) {
  if (!msg.landmarks || msg.angle == null) return;
  if (msg.stage !== "moving" && msg.stage !== "work") return;
  const c = state.cycle;
  const deeper =
    !c || (msg.thresholds.rest_is_high ? msg.angle < c.angle : msg.angle > c.angle);
  if (deeper) state.cycle = { angle: msg.angle, landmarks: msg.landmarks };
}

function renderCues(feedback) {
  const now = performance.now();
  for (const f of feedback)
    state.cueSeen.set(f.code, { text: f.text, at: now });
  const active = [...state.cueSeen.entries()].filter(
    ([, v]) => now - v.at < CUE_HOLD_MS,
  );
  for (const [code, v] of state.cueSeen)
    if (now - v.at >= CUE_HOLD_MS) state.cueSeen.delete(code);

  const items = active.slice(0, 2).map(([code, v]) => {
    const li = document.createElement("li");
    li.textContent = v.text;
    if (code === "not_visible" || code === "not_plank" || code === "arms_down")
      li.className = "bad";
    return li;
  });
  els.cues.replaceChildren(...items);
}

function renderTopIssues(top) {
  if (!top?.length) {
    els.topIssues.replaceChildren();
    return;
  }
  const p = document.createElement("p");
  p.textContent = "Most common issues";
  const ul = document.createElement("ul");
  for (const issue of top) {
    const li = document.createElement("li");
    li.textContent = `${issue.text} (${issue.count}×)`;
    ul.append(li);
  }
  els.topIssues.replaceChildren(p, ul);
}

function onRep(rep) {
  rep.pose = state.cycle?.landmarks ?? null;
  state.reps.push(rep);
  els.exportBtn.disabled = false;
  els.shareBtn.disabled = !state.reps.some((r) => !r.partial);
  els.repEmpty.hidden = true;

  const li = document.createElement("li");
  if (rep.partial) li.className = "partial";
  const n = document.createElement("span");
  n.className = "n";
  n.textContent = rep.partial ? "½" : `#${rep.index}`;
  const meta = document.createElement("span");
  meta.className = "meta";
  meta.textContent = `${rep.duration_s}s · range ${Math.round(rep.rom)}° · peak ${Math.round(rep.peak_angle)}°`;
  const score = document.createElement("span");
  score.className = `score ${rep.score >= 100 ? "good" : rep.score >= 60 ? "meh" : "bad"}`;
  score.textContent = rep.score;
  li.append(n, meta, score);
  if (rep.issue_text.length) {
    const issues = document.createElement("span");
    issues.className = "issues";
    issues.textContent = rep.issue_text.join(" · ");
    li.append(issues);
  }
  els.repLog.prepend(li);

  // Sensitive-mode characters celebrate a full rep; a clean one gets the big burst.
  if (!rep.partial) state.avatar?.celebrate(rep.issues.length === 0);
  flash(
    rep.partial ? "Partial" : String(rep.index),
    rep.partial || rep.issues.length ? "meh" : "good",
  );
  speak(
    rep.partial
      ? "Go deeper"
      : rep.issues.length
        ? rep.issue_text[0]
        : String(rep.index),
  );
}

let flashTimer = 0;
function flash(text, kind) {
  els.flash.textContent = text;
  els.flash.className = `flash show ${kind}`;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    els.flash.className = "flash";
  }, 700);
}

function speak(text) {
  if (!state.settings.voice || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.1;
  speechSynthesis.speak(u);
}

function clearSet() {
  state.reps = [];
  state.history = [];
  state.latest = null;
  state.cueSeen.clear();
  state.cycle = null;
  els.repLog.replaceChildren();
  els.repEmpty.hidden = false;
  els.exportBtn.disabled = true;
  els.shareBtn.disabled = true;
  for (const el of [els.sReps, els.sGood, els.sPartial]) el.textContent = "0";
  for (const el of [els.sTempo, els.sRom, els.sScore]) el.textContent = "–";
  els.hudReps.textContent = "0";
  els.hudAngle.textContent = "–";
  els.topIssues.replaceChildren();
  els.cues.replaceChildren();
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
function cssVar(name) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

// ---- Sensitive mode ---------------------------------------------------------
// The server sends a small PNG whose alpha channel is the person. We blur the
// preview by shrinking it and scaling it back up (opaque, cheap, no edge
// leaks), cut that blurred layer to the person shape, and draw it over the
// sharp frame. With no recent mask we blur the whole frame rather than risk
// showing the person. Only the on-screen preview is blurred: the frames sent
// to the local server stay sharp because pose tracking needs them.
async function updateMask(dataUrl) {
  const seq = ++state.maskSeq;
  if (!dataUrl) {
    state.mask = null;
    return;
  }
  const img = new Image();
  img.src = dataUrl;
  try {
    await img.decode();
  } catch (err) {
    console.warn("Could not decode person mask:", err);
    return;
  }
  if (seq === state.maskSeq) state.mask = { img, at: performance.now() };
}

function freshMask() {
  const m = state.mask;
  return m && performance.now() - m.at < MASK_MAX_AGE_MS ? m.img : null;
}

function clearMask() {
  state.maskSeq++;
  state.mask = null;
}

function drawPrivate(ctx, video, w, h) {
  const sw = Math.max(1, Math.round(w / PRIVACY_DOWNSCALE));
  const sh = Math.max(1, Math.round(h / PRIVACY_DOWNSCALE));
  if (
    !state.fxSmall ||
    state.fxSmall.width !== sw ||
    state.fxSmall.height !== sh
  ) {
    state.fxSmall = new OffscreenCanvas(sw, sh);
  }
  if (!state.fx || state.fx.width !== w || state.fx.height !== h) {
    state.fx = new OffscreenCanvas(w, h);
  }
  const small = state.fxSmall.getContext("2d");
  small.imageSmoothingQuality = "high";
  small.drawImage(video, 0, 0, sw, sh);

  const fx = state.fx.getContext("2d");
  fx.globalCompositeOperation = "source-over";
  fx.clearRect(0, 0, w, h);
  fx.imageSmoothingEnabled = true;
  fx.imageSmoothingQuality = "high";
  fx.drawImage(state.fxSmall, 0, 0, w, h);

  const mask = freshMask();
  if (mask) {
    fx.globalCompositeOperation = "destination-in"; // keep blur only where the person is
    fx.drawImage(mask, 0, 0, w, h);
    fx.globalCompositeOperation = "source-over";
  }

  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  if (mask) ctx.drawImage(video, 0, 0, w, h); // sharp background
  ctx.drawImage(state.fx, 0, 0);
  ctx.restore();
}

// ---- Sensitive mode: characters -------------------------------------------
// Instead of blurring, the preview can show a drawn character that copies the
// pose (avatar.js). No camera pixels are drawn at all, so the server's person
// mask isn't needed and isn't requested.
// A 3D character needs WebGL; without it the blurred view stands in.
function privacyStyle() {
  const s = state.settings.privacyStyle;
  return s in Avatar.CHARACTERS && Avatar.supported() ? s : "blur";
}

function wantsMask() {
  return state.settings.privacy && privacyStyle() === "blur";
}

function drawAvatar(ctx, w, h, msg) {
  const key = privacyStyle();
  if (state.avatar?.key !== key) {
    state.avatar?.dispose(); // free the old character's GPU buffers
    state.avatar = Avatar.create(key);
  }
  Avatar.drawBackdrop(ctx, w, h);
  state.avatar.draw(ctx, msg?.landmarks ?? null, w, h, {
    issues: (msg?.feedback?.length ?? 0) > 0,
  });
}

function renderStyleOptions() {
  const options = [
    ["blur", "Blur"],
    ...Object.entries(Avatar.CHARACTERS).map(([key, c]) => [key, c.label]),
  ];
  els.styleGrid.replaceChildren(
    ...options.map(([key, label]) => {
      const opt = document.createElement("label");
      opt.className = "style-opt";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "privacyStyle";
      input.value = key;
      const thumb = document.createElement("canvas");
      thumb.width = 120;
      thumb.height = 160;
      thumb.setAttribute("aria-hidden", "true");
      Avatar.drawThumb(thumb, key);
      const name = document.createElement("span");
      name.textContent = label;
      opt.append(input, thumb, name);
      return opt;
    }),
  );
}

function setPrivacyUi() {
  const on = state.settings.privacy;
  const style = privacyStyle();
  els.privacy.checked = on;
  els.privacyStyles.hidden = !on;
  for (const input of els.styleGrid.querySelectorAll("input")) {
    input.checked = input.value === style;
  }
  els.hudPrivacy.hidden = !on;
  els.hudPrivacy.textContent =
    style === "blur" ? "Blur on" : `${Avatar.CHARACTERS[style].label} on`;
}

function render() {
  if (!state.running) return;
  const video = els.video;
  const canvas = els.overlay;
  if (
    video.videoWidth &&
    (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight)
  ) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;

  const msg = state.latest;
  const fresh = msg?.landmarks && performance.now() - state.latestAt < 1000;

  if (state.settings.privacy && privacyStyle() !== "blur") {
    drawAvatar(ctx, w, h, fresh ? msg : null); // the character replaces the skeleton too
    drawChart();
    requestAnimationFrame(render);
    return;
  }

  if (state.settings.privacy) {
    drawPrivate(ctx, video, w, h);
  } else {
    // Mirror the preview so it feels like a mirror; landmarks are mirrored to match.
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();
  }

  if (fresh) {
    drawSkeleton(ctx, msg.landmarks, w, h, msg.feedback.length > 0);
  }
  drawChart();
  requestAnimationFrame(render);
}

function drawSkeleton(ctx, lms, w, h, hasIssues) {
  const color = hasIssues ? "#ffb547" : "#3ddc97";
  const px = (lm) => [(1 - lm[0]) * w, lm[1] * h];
  ctx.lineWidth = Math.max(3, w / 180);
  ctx.lineCap = "round";
  ctx.strokeStyle = color;
  for (const [a, b] of state.connections) {
    const la = lms[a];
    const lb = lms[b];
    if (la[2] < MIN_VIS || lb[2] < MIN_VIS) continue;
    const [x1, y1] = px(la);
    const [x2, y2] = px(lb);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  const r = Math.max(4, w / 140);
  for (let i = 11; i < lms.length; i++) {
    if (lms[i][2] < MIN_VIS) continue;
    const [x, y] = px(lms[i]);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
  }
}

function drawChart() {
  const canvas = els.chart;
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  if (
    canvas.width !== Math.round(cw * dpr) ||
    canvas.height !== Math.round(ch * dpr)
  ) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);

  const pad = { l: 30, r: 6, t: 6, b: 6 };
  const plotW = cw - pad.l - pad.r;
  const plotH = ch - pad.t - pad.b;
  const y = (deg) => pad.t + plotH * (1 - deg / 180);
  const muted = cssVar("--muted");

  ctx.font = "11px system-ui, sans-serif";
  ctx.fillStyle = muted;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const deg of [0, 90, 180]) ctx.fillText(`${deg}°`, pad.l - 6, y(deg));

  const th = state.thresholds;
  if (th) {
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    for (const [deg, color] of [
      [th.rest, muted],
      [th.target, cssVar("--accent")],
    ]) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(pad.l, y(deg));
      ctx.lineTo(cw - pad.r, y(deg));
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // Dashed: the same angle measured the other way (2D vs 3D), for comparison.
  const trace = (field, color, dash) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.setLineDash(dash);
    ctx.beginPath();
    let pen = false;
    state.history.forEach((h, i) => {
      const deg = h[field];
      if (deg == null) {
        pen = false;
        return;
      }
      const x = pad.l + (plotW * i) / (HISTORY_SAMPLES - 1);
      if (pen) ctx.lineTo(x, y(deg));
      else ctx.moveTo(x, y(deg));
      pen = true;
    });
    ctx.stroke();
    ctx.setLineDash([]);
  };
  trace("alt", muted, [5, 4]);
  trace("a", cssVar("--line"), []);
}

function updateLegend(msg) {
  const has = msg?.angle_alt != null;
  els.chartLegend.hidden = !has;
  if (!has) return;
  const main = msg.angle_mode === "3d" ? "3D" : "2D";
  els.legendMain.textContent = `${main} (counting)`;
  els.legendAlt.textContent = main === "3D" ? "2D" : "3D";
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
function currentExercise() {
  return (
    state.exercises.find((e) => e.key === state.settings.exercise) ??
    state.exercises[0]
  );
}

function renderExerciseOptions() {
  const groups = new Map(); // category -> <optgroup>, in catalog order
  for (const e of state.exercises) {
    const cat = e.category ?? "Exercises";
    if (!groups.has(cat)) {
      const g = document.createElement("optgroup");
      g.label = cat;
      groups.set(cat, g);
    }
    const o = document.createElement("option");
    o.value = e.key;
    o.textContent = e.label;
    groups.get(cat).append(o);
  }
  els.exercise.replaceChildren(...groups.values());
  if (!state.exercises.some((e) => e.key === state.settings.exercise)) {
    state.settings.exercise = state.exercises[0].key;
  }
  els.exercise.value = state.settings.exercise;
  renderExerciseMeta();
}

function renderExerciseMeta() {
  const ex = currentExercise();
  els.howTo.textContent = ex.how_to ?? "";
  renderDemo(ex.demo);
  els.cameraHint.textContent = CAMERA_HINTS[ex.camera] ?? "";
  els.hudMetric.textContent = ex.metric;
  els.chartTitle.textContent = ex.metric;
}

// ---------------------------------------------------------------------------
// Demo videos: a short YouTube clip per exercise, opened on youtube.com in a
// small popup window. It is not embedded here because Chrome sends no Referer
// from extension pages and YouTube's player refuses such embeds (Error 153).
// Nothing is loaded from YouTube until the user clicks.
// ---------------------------------------------------------------------------
const YOUTUBE_ID = /^[\w-]{11}$/;
const DEMO_WINDOW = { width: 480, height: 400 };

function validDemo(demo) {
  return demo && YOUTUBE_ID.test(demo.youtube_id) ? demo : null;
}

function demoUrl(demo) {
  return `https://www.youtube.com/watch?v=${demo.youtube_id}`;
}

function renderDemo(demo) {
  demo = validDemo(demo);
  els.demo.hidden = !demo;
  if (!demo) return;
  els.demoBtn.textContent = `▶ Watch demo (${demo.seconds}s)`;
  els.demoBtn.title = demo.title ?? "";
  els.demoCredit.textContent = `Video by ${demo.channel || "a YouTube creator"}, opens on YouTube`;
}

// Reuse one popup for all demos so clicking through exercises doesn't pile up windows.
async function openDemo() {
  const demo = validDemo(currentExercise().demo);
  if (!demo) return;
  const url = demoUrl(demo);
  if (state.demoWindowId != null) {
    try {
      const [tab] = await chrome.tabs.query({ windowId: state.demoWindowId });
      await chrome.tabs.update(tab.id, { url, active: true });
      await chrome.windows.update(state.demoWindowId, { focused: true });
      return;
    } catch {
      state.demoWindowId = null; // the user closed it
    }
  }
  try {
    const win = await chrome.windows.create({ url, type: "popup", ...DEMO_WINDOW });
    state.demoWindowId = win.id;
  } catch (err) {
    console.warn("Could not open demo window, using a tab:", err);
    window.open(url, "_blank", "noopener");
  }
}

async function start() {
  els.startBtn.disabled = true;
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 960 },
        height: { ideal: 720 },
        facingMode: "user",
      },
      audio: false,
    });
    els.video.srcObject = state.stream;
    await els.video.play();
  } catch (err) {
    console.error("Camera error:", err);
    showPlaceholder(
      "Camera unavailable",
      err.name === "NotAllowedError"
        ? "Camera access was blocked. Click the camera icon in the address bar to allow it, then press Start."
        : `Could not open the camera (${err.name}).`,
    );
    stopStream();
    els.startBtn.disabled = false;
    return;
  }

  clearSet();
  state.running = true;
  els.placeholder.hidden = true;
  els.hud.hidden = false;
  els.resetBtn.disabled = false;
  els.startBtn.textContent = "Stop";
  els.startBtn.classList.add("stop");
  els.startBtn.disabled = false;

  disconnect(); // a fresh connection = a fresh server-side set
  connect();
  renderCalib();
  requestAnimationFrame(render);
}

function stopStream() {
  clearMask();
  state.avatar?.dispose();
  state.avatar = null; // the next set starts from a fresh pose
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
  els.video.srcObject = null;
}

function stop() {
  state.running = false;
  if (state.calibrating) endCalibrationUi();
  stopStream();
  disconnect();
  els.hud.hidden = true;
  els.cues.replaceChildren();
  els.resetBtn.disabled = true;
  els.startBtn.textContent = "Start";
  els.startBtn.classList.remove("stop");
  const ctx = els.overlay.getContext("2d");
  ctx.clearRect(0, 0, els.overlay.width, els.overlay.height);
  showPlaceholder(
    "Set finished",
    state.reps.some((r) => !r.partial)
      ? "Your rep log is on the right. Share card turns this set into an image."
      : "Your rep log is on the right. Press Start to begin a new set.",
  );
  renderCalib();
}

function showPlaceholder(title, sub) {
  els.placeholder.querySelector(".ph-title").textContent = title;
  els.placeholder.querySelector(".ph-sub").textContent = sub;
  els.placeholder.hidden = false;
}

function exportCsv() {
  const header = [
    "rep",
    "partial",
    "duration_s",
    "peak_angle",
    "range_of_motion",
    "score",
    "issues",
  ];
  const rows = state.reps.map((r) => [
    r.partial ? "" : r.index,
    r.partial,
    r.duration_s,
    r.peak_angle,
    r.rom,
    r.score,
    r.issues.join("|"),
  ]);
  const csv = [header, ...rows].map((row) => row.join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `formcoach-${state.settings.exercise}-${new Date().toISOString().slice(0, 19).replace(/:/g, "")}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Exercise config + calibration
// Thresholds learnt from 3 of the user's own reps are stored per exercise and
// per angle mode (2D and 3D angles differ), and sent with every config.
// ---------------------------------------------------------------------------
const calibKey = (key = state.settings.exercise) =>
  `${key}:${state.settings.angleMode}`;

function currentCalibration() {
  return state.settings.calibrations?.[calibKey()] ?? null;
}

function configureExercise() {
  const cal = currentCalibration();
  sendJson({
    type: "config",
    exercise: state.settings.exercise,
    ...(cal ? { calibration: cal } : {}),
  });
}

const deg = (v) => `${Math.round(v)}°`;

function renderCalib() {
  const cal = currentCalibration();
  const mode = state.settings.angleMode.toUpperCase();
  els.calib.dataset.calibrated = String(!!cal);
  const th = state.thresholds;
  if (cal) {
    els.calibText.textContent = `Calibrated to you (${mode}): rep counts from ${deg(cal.rest)} to ${deg(cal.target)}.`;
  } else if (th && th.default_rest != null && th.calibrated === false) {
    els.calibText.textContent = `Default thresholds: ${deg(th.default_rest)} to ${deg(th.default_target)}. Calibrate to fit your range.`;
  } else {
    els.calibText.textContent = "Default thresholds. Calibrate to fit your range of motion.";
  }
  els.calibReset.hidden = !cal;
  els.calibBtn.textContent = cal ? "Recalibrate (3 reps)" : "Calibrate to me (3 reps)";
  els.calibBtn.disabled = !state.running || state.calibrating || !!state.routine;
}

function renderCalibDots(done, needed) {
  const dots = [];
  for (let i = 0; i < needed; i++) {
    const d = document.createElement("i");
    if (i < done) d.className = "on";
    dots.push(d);
  }
  els.calibDots.replaceChildren(...dots);
  els.calibBannerText.textContent =
    done === 0
      ? `${currentExercise().label}: do 3 comfortable reps`
      : `${done} of ${needed} reps recorded`;
}

function startCalibration() {
  if (!state.running || state.routine) return;
  state.calibrating = true;
  sendJson({ type: "calibrate", action: "start" });
  clearSet();
  els.calibBanner.hidden = false;
  renderCalibDots(0, 3);
  renderCalib();
  speak("Calibration. Do three comfortable reps.");
}

function endCalibrationUi() {
  state.calibrating = false;
  els.calibBanner.hidden = true;
  renderCalib();
}

function cancelCalibration() {
  if (!state.calibrating) return;
  sendJson({ type: "calibrate", action: "cancel" });
  endCalibrationUi();
}

async function onCalibration(cal) {
  if (!state.calibrating) return;
  if (cal.status === "recording") {
    renderCalibDots(cal.reps, cal.needed);
    return;
  }
  endCalibrationUi();
  if (cal.status === "done") {
    const calibrations = {
      ...state.settings.calibrations,
      [calibKey()]: { rest: cal.rest, target: cal.target },
    };
    await saveSettings({ calibrations });
    renderCalib();
    clearSet();
    flash("Calibrated", "good");
    speak("Calibrated. Reps now count on your range.");
  } else {
    els.calibText.textContent =
      "Those reps were too small to learn from. Move a bit further and try again.";
    flash("Try again", "meh");
  }
}

async function resetCalibration() {
  const calibrations = { ...state.settings.calibrations };
  delete calibrations[calibKey()];
  await saveSettings({ calibrations });
  state.thresholds = null;
  if (state.running) {
    configureExercise();
    clearSet();
  }
  renderCalib();
}

// Switch exercise without saving it as the user's choice (the break routine
// moves through several; the picker's own choice is restored afterwards).
function switchExercise(key) {
  cancelCalibration();
  state.settings.exercise = key;
  els.exercise.value = key;
  state.thresholds = null;
  renderExerciseMeta();
  configureExercise();
  clearSet();
  renderCalib();
}

// ---------------------------------------------------------------------------
// Desk break routine: 3 seated, front-camera moves (the laptop camera already
// faces you), 6 reps each. Picks rotate with the number of breaks taken.
// ---------------------------------------------------------------------------
const BREAK_REPS = 6;
const BREAK_NECK = ["neck_tilt", "head_turn", "chin_to_chest", "shoulder_shrug"];
const BREAK_UPPER = [
  "overhead_reach",
  "t_raise",
  "cross_swing",
  "wy_raise",
  "shoulder_roll",
  "external_rotation",
  "seated_side_bend",
];
const LOG_KEY = "breakLog";
const COACH_KEY = "breakCoach";

function buildRoutine(n) {
  const known = (keys) =>
    keys.filter((k) => state.exercises.some((e) => e.key === k));
  const neck = known(BREAK_NECK);
  const upper = known(BREAK_UPPER);
  let keys = [];
  if (neck.length) keys.push(neck[n % neck.length]);
  if (upper.length) {
    keys.push(upper[(2 * n) % upper.length], upper[(2 * n + 1) % upper.length]);
  }
  keys = [...new Set(keys)];
  if (!keys.length) keys = state.exercises.slice(0, 3).map((e) => e.key);
  return keys.map((key) => ({
    key,
    label: state.exercises.find((e) => e.key === key)?.label ?? key,
    target: BREAK_REPS,
  }));
}

async function readLog() {
  try {
    const { [LOG_KEY]: log = [] } = await chrome.storage.local.get(LOG_KEY);
    return Array.isArray(log) ? log : [];
  } catch {
    return [];
  }
}

async function startBreak() {
  if (state.routine) return;
  cancelCalibration();
  const moves = buildRoutine((await readLog()).length);
  state.routine = {
    moves,
    i: 0,
    done: [],
    prevExercise: state.settings.exercise,
  };
  els.exercise.disabled = true;
  switchExercise(moves[0].key);
  renderRoutine(0);
  els.routine.hidden = false;
  if (!state.running) {
    await start();
    if (!state.running) {
      // Camera blocked: drop the routine, keep the user's exercise.
      const prev = state.routine.prevExercise;
      state.routine = null;
      els.routine.hidden = true;
      els.exercise.disabled = false;
      switchExercise(prev);
      return;
    }
  }
  speak(`Desk break. First, ${moves[0].label}. ${moves[0].target} reps.`);
}

function renderRoutine(reps) {
  const r = state.routine;
  if (!r) return;
  const move = r.moves[r.i];
  els.routineStep.textContent = `Desk break · ${r.i + 1}/${r.moves.length}`;
  els.routineName.textContent = move.label;
  els.routineCount.textContent = `${Math.min(reps, move.target)} / ${move.target}`;
  const total = r.moves.reduce((n, m) => n + m.target, 0);
  const before = r.moves.slice(0, r.i).reduce((n, m) => n + m.target, 0);
  els.routineBar.style.width = `${(100 * (before + Math.min(reps, move.target))) / total}%`;
  els.calibBtn.disabled = true;
}

function routineProgress(msg) {
  const r = state.routine;
  if (!r) return;
  const move = r.moves[r.i];
  if (msg.exercise !== move.key) return;
  renderRoutine(msg.summary.reps);
  if (msg.summary.reps >= move.target) completeMove(false);
}

function completeMove(skipped) {
  const r = state.routine;
  if (!r) return;
  const move = r.moves[r.i];
  r.done.push({
    ...move,
    skipped,
    reps: state.reps.slice(),
    trace: state.history.map((h) => h.a),
  });
  r.i += 1;
  if (r.i >= r.moves.length) {
    finishBreak(true);
    return;
  }
  const next = r.moves[r.i];
  switchExercise(next.key);
  renderRoutine(0);
  flash(skipped ? "Skipped" : "Nice!", skipped ? "meh" : "good");
  speak(`${skipped ? "Skipped" : "Nice"}. Next, ${next.label}.`);
}

async function finishBreak(completed) {
  const r = state.routine;
  if (!r) return;
  if (!completed && r.i < r.moves.length && state.reps.length) {
    r.done.push({
      ...r.moves[r.i],
      skipped: true,
      reps: state.reps.slice(),
      trace: state.history.map((h) => h.a),
    });
  }
  state.routine = null;
  els.routine.hidden = true;
  els.exercise.disabled = false;

  const reps = r.done.flatMap((d) => d.reps).filter((x) => !x.partial);
  const scores = reps.map((x) => x.score);
  try {
    await chrome.runtime.sendMessage({
      type: "break-done",
      reps: reps.length,
      moves: r.done.filter((d) => d.reps.some((x) => !x.partial)).length,
      score: scores.length ? Math.round(scores.reduce((a, b) => a + b) / scores.length) : null,
      completed,
    });
  } catch (err) {
    console.warn("Could not log the break:", err);
  }

  if (state.running) stop();
  switchExercise(r.prevExercise);
  showPlaceholder(
    completed ? "Break done" : "Break ended",
    completed
      ? "Nice work. The next reminder comes after your next stretch at the keyboard."
      : "The break timer is reset. Press Start for a normal set.",
  );
  if (completed) speak("Break done. Back to work!");
  if (reps.length) await showCard(await breakCardData(r));
  refreshBreakUi();
}

// ---------------------------------------------------------------------------
// Break coach panel (the timer itself runs in the service worker)
// ---------------------------------------------------------------------------
const isToday = (t) => new Date(t).toDateString() === new Date().toDateString();

async function refreshBreakUi() {
  els.breakEnabled.checked = state.settings.breakEnabled;
  els.breakInterval.value = String(state.settings.breakInterval);
  els.breakInterval.disabled = !state.settings.breakEnabled;
  let coach = {};
  try {
    ({ [COACH_KEY]: coach = {} } = await chrome.storage.local.get(COACH_KEY));
  } catch {
    /* storage unavailable: show what we can */
  }
  if (!state.settings.breakEnabled) {
    els.breakNext.textContent = "off";
  } else {
    const left = Number(state.settings.breakInterval) - (coach.activeMin ?? 0);
    els.breakNext.textContent = left <= 0 ? "due now" : `next in ${left} min`;
  }
  const today = (await readLog()).filter((b) => isToday(b.at));
  const reps = today.reduce((n, b) => n + (b.reps || 0), 0);
  els.breakToday.textContent = today.length
    ? `Today: ${today.length} break${today.length > 1 ? "s" : ""} · ${reps} reps`
    : "No breaks yet today.";
}

function onBreakHash() {
  if (!location.hash.startsWith("#break")) return;
  history.replaceState(null, "", location.pathname);
  startBreak();
}

// ---------------------------------------------------------------------------
// Shareable session card: a 1080x1350 PNG (portrait, fits social feeds).
// Built only from numbers and landmarks; no camera pixels are ever drawn.
// ---------------------------------------------------------------------------
const CARD_W = 1080;
const CARD_H = 1350;
const CARD_PAD = 72;
const CARD = {
  bg0: "#0b1d17",
  bg1: "#0f1214",
  bg2: "#0f1a2c",
  text: "#f2f5f7",
  muted: "#93a0a9",
  accent: "#3ddc97",
  warn: "#ffb547",
  line: "#5aa9ff",
  tile: "rgba(255,255,255,0.06)",
  tileBorder: "rgba(255,255,255,0.10)",
};

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function bestRep(reps) {
  return reps
    .filter((r) => !r.partial && r.pose)
    .sort((a, b) => b.score - a.score || b.rom - a.rom)[0];
}

function repStats(all) {
  const full = all.filter((r) => !r.partial);
  return {
    reps: full.length,
    clean: full.filter((r) => !r.issues.length).length,
    partial: all.length - full.length,
    score: avg(full.map((r) => r.score)),
    tempo: avg(full.map((r) => r.duration_s)),
    rom: avg(full.map((r) => r.rom)),
    pose: bestRep(all)?.pose ?? null,
  };
}

function modeChips() {
  const chips = [];
  if (state.settings.angleMode === "3d") chips.push("3D angles");
  if (currentCalibration()) chips.push("Calibrated to me");
  return chips;
}

async function todayLine() {
  const today = (await readLog()).filter((b) => isToday(b.at));
  return today.length
    ? `${today.length} desk break${today.length > 1 ? "s" : ""} today`
    : "";
}

async function setCardData() {
  const ex = currentExercise();
  return {
    kicker: "SET COMPLETE",
    title: ex.label,
    chips: modeChips(),
    ...repStats(state.reps),
    trace: state.history.map((h) => h.a),
    footer: await todayLine(),
    name: ex.key,
  };
}

async function breakCardData(r) {
  const all = r.done.flatMap((d) => d.reps);
  const chips = r.done
    .filter((d) => d.reps.some((x) => !x.partial))
    .map((d) => `${d.label} ×${d.reps.filter((x) => !x.partial).length}`);
  return {
    kicker: "DESK BREAK DONE",
    title: "2-minute desk break",
    chips,
    ...repStats(all),
    trace: r.done.flatMap((d) => [...d.trace, null]),
    footer: await todayLine(),
    name: "desk-break",
  };
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function fitFont(g, text, maxW, size, min, weight = 800) {
  for (; size > min; size -= 2) {
    g.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    if (g.measureText(text).width <= maxW) break;
  }
  return size;
}

const font = (size, weight = 600) =>
  `${weight} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;

function drawChips(g, chips, x, y, maxW) {
  g.font = font(28, 600);
  let cx = x;
  let cy = y;
  for (const chip of chips) {
    const w = g.measureText(chip).width + 40;
    if (cx + w > x + maxW) {
      cx = x;
      cy += 60;
    }
    roundRect(g, cx, cy, w, 48, 24);
    g.fillStyle = "rgba(61,220,151,0.12)";
    g.fill();
    g.strokeStyle = "rgba(61,220,151,0.45)";
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = CARD.text;
    g.textBaseline = "middle";
    g.fillText(chip, cx + 20, cy + 25);
    cx += w + 14;
  }
  return cy + 48;
}

function drawFigure(g, lms, x, y, w, h) {
  roundRect(g, x, y, w, h, 28);
  g.fillStyle = CARD.tile;
  g.fill();
  g.strokeStyle = CARD.tileBorder;
  g.lineWidth = 2;
  g.stroke();
  g.font = font(24, 700);
  g.fillStyle = CARD.muted;
  g.textBaseline = "top";
  g.fillText("BEST REP", x + 28, y + 24);
  if (!lms) return;

  const pts = lms.map((lm) => [(1 - lm[0]) * state.aspect, lm[1], lm[2]]); // mirrored, like the preview
  const seen = pts.filter((p, i) => p[2] >= MIN_VIS && (i === 0 || i >= 11));
  if (seen.length < 3) return;
  const xs = seen.map((p) => p[0]);
  const ys = seen.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const box = { x: x + 50, y: y + 80, w: w - 100, h: h - 120 };
  const s = Math.min(box.w / Math.max(x1 - x0, 1e-3), box.h / Math.max(y1 - y0, 1e-3));
  const ox = box.x + (box.w - (x1 - x0) * s) / 2;
  const oy = box.y + (box.h - (y1 - y0) * s) / 2;
  const P = (p) => [ox + (p[0] - x0) * s, oy + (p[1] - y0) * s];
  const ok = (i) => pts[i][2] >= MIN_VIS;

  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";
  g.shadowColor = CARD.accent;
  g.shadowBlur = 24;
  g.strokeStyle = CARD.accent;
  g.lineWidth = 14;
  for (const [a, b] of state.connections) {
    if (!ok(a) || !ok(b)) continue;
    g.beginPath();
    g.moveTo(...P(pts[a]));
    g.lineTo(...P(pts[b]));
    g.stroke();
  }
  // Head: a ring around the face landmarks, sized from the ears or shoulders.
  if (ok(0)) {
    const [hx, hy] = P(pts[0]);
    const ears = ok(7) && ok(8) ? Math.hypot(...[0, 1].map((k) => P(pts[7])[k] - P(pts[8])[k])) : 0;
    const shoulders =
      ok(11) && ok(12) ? Math.hypot(...[0, 1].map((k) => P(pts[11])[k] - P(pts[12])[k])) : 0;
    const r = Math.max(26, ears * 0.75, shoulders * 0.32);
    g.beginPath();
    g.arc(hx, hy, Math.min(r, 90), 0, Math.PI * 2);
    g.stroke();
  }
  g.shadowBlur = 0;
  g.fillStyle = "#ffffff";
  for (let i = 11; i < pts.length; i++) {
    if (!ok(i)) continue;
    const [px, py] = P(pts[i]);
    g.beginPath();
    g.arc(px, py, 8, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

function drawTile(g, x, y, w, h, value, label, color = CARD.text) {
  roundRect(g, x, y, w, h, 24);
  g.fillStyle = CARD.tile;
  g.fill();
  g.strokeStyle = CARD.tileBorder;
  g.lineWidth = 2;
  g.stroke();
  g.textBaseline = "alphabetic";
  g.fillStyle = color;
  fitFont(g, value, w - 56, 72, 36, 800);
  g.fillText(value, x + 28, y + 100);
  g.font = font(24, 700);
  g.fillStyle = CARD.muted;
  g.fillText(label, x + 28, y + 146);
}

function drawScoreTile(g, x, y, w, h, score) {
  roundRect(g, x, y, w, h, 24);
  g.fillStyle = CARD.tile;
  g.fill();
  g.strokeStyle = CARD.tileBorder;
  g.lineWidth = 2;
  g.stroke();
  const cx = x + 82;
  const cy = y + h / 2;
  const r = 48;
  g.lineWidth = 12;
  g.lineCap = "round";
  g.strokeStyle = "rgba(255,255,255,0.10)";
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.stroke();
  if (score != null) {
    g.strokeStyle = score >= 80 ? CARD.accent : CARD.warn;
    g.beginPath();
    g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * score) / 100);
    g.stroke();
  }
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = CARD.text;
  g.font = font(34, 800);
  g.fillText(score == null ? "–" : String(Math.round(score)), cx, cy + 2);
  g.textAlign = "left";
  g.font = font(24, 700);
  g.fillStyle = CARD.muted;
  g.textBaseline = "alphabetic";
  g.fillText("FORM", x + 150, cy - 6);
  g.fillText("SCORE", x + 150, cy + 26);
}

function drawTrace(g, trace, x, y, w, h) {
  roundRect(g, x, y, w, h, 24);
  g.fillStyle = CARD.tile;
  g.fill();
  g.strokeStyle = CARD.tileBorder;
  g.lineWidth = 2;
  g.stroke();
  g.font = font(24, 700);
  g.fillStyle = CARD.muted;
  g.textBaseline = "top";
  g.fillText("MOVEMENT TRACE", x + 28, y + 22);
  const vals = trace.filter((v) => v != null);
  if (vals.length < 2) return;
  const step = Math.max(1, Math.ceil(trace.length / 260));
  const pts = [];
  for (let i = 0; i < trace.length; i += step) pts.push(trace[i]);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = Math.max(hi - lo, 10);
  const px = (i) => x + 28 + ((w - 56) * i) / Math.max(pts.length - 1, 1);
  const py = (v) => y + h - 24 - ((h - 84) * (v - lo)) / span;
  g.save();
  g.strokeStyle = CARD.line;
  g.lineWidth = 5;
  g.lineJoin = "round";
  g.shadowColor = CARD.line;
  g.shadowBlur = 12;
  g.beginPath();
  let pen = false;
  pts.forEach((v, i) => {
    if (v == null) {
      pen = false;
      return;
    }
    if (pen) g.lineTo(px(i), py(v));
    else g.moveTo(px(i), py(v));
    pen = true;
  });
  g.stroke();
  g.restore();
}

async function renderCard(d) {
  const c = document.createElement("canvas");
  c.width = CARD_W;
  c.height = CARD_H;
  const g = c.getContext("2d");
  const inner = CARD_W - 2 * CARD_PAD;

  const bg = g.createLinearGradient(0, 0, CARD_W, CARD_H);
  bg.addColorStop(0, CARD.bg0);
  bg.addColorStop(0.55, CARD.bg1);
  bg.addColorStop(1, CARD.bg2);
  g.fillStyle = bg;
  g.fillRect(0, 0, CARD_W, CARD_H);
  const glow = g.createRadialGradient(CARD_W - 120, 140, 0, CARD_W - 120, 140, 560);
  glow.addColorStop(0, "rgba(61,220,151,0.22)");
  glow.addColorStop(1, "rgba(61,220,151,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, CARD_W, CARD_H);

  // Header: brand + date
  try {
    const icon = new Image();
    icon.src = "icons/icon-128.png";
    // A background tab may defer decoding; never let the icon hold up the card.
    await Promise.race([
      icon.decode(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("icon timeout")), 1000)),
    ]);
    g.drawImage(icon, CARD_PAD, 64, 60, 60);
  } catch {
    /* card still works without the icon */
  }
  g.textBaseline = "middle";
  g.fillStyle = CARD.text;
  g.font = font(40, 800);
  g.fillText("FormCoach", CARD_PAD + 80, 96);
  g.textAlign = "right";
  g.fillStyle = CARD.muted;
  g.font = font(28, 600);
  g.fillText(
    new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
    CARD_W - CARD_PAD,
    96,
  );
  g.textAlign = "left";

  // Kicker, title, chips
  g.textBaseline = "alphabetic";
  g.fillStyle = CARD.accent;
  g.font = font(28, 800);
  g.fillText(d.kicker, CARD_PAD, 222);
  g.fillStyle = CARD.text;
  fitFont(g, d.title, inner, 76, 44);
  g.fillText(d.title, CARD_PAD, 300);
  const chipsEnd = d.chips.length ? drawChips(g, d.chips, CARD_PAD, 336, inner) : 300;

  // Hero: rep count + best-rep figure
  const heroY = Math.max(420, chipsEnd + 40);
  const heroH = 380;
  g.textBaseline = "alphabetic"; // drawChips leaves it at "middle"
  g.fillStyle = CARD.accent;
  fitFont(g, String(d.reps), 430, 280, 120, 900);
  g.fillText(String(d.reps), CARD_PAD - 8, heroY + 270);
  g.fillStyle = CARD.muted;
  g.font = font(34, 800);
  g.fillText(d.reps === 1 ? "REP" : "REPS", CARD_PAD, heroY + 340);
  drawFigure(g, d.pose, 540, heroY, CARD_W - CARD_PAD - 540, heroH);

  // Stat tiles
  const tilesY = heroY + heroH + 40;
  const gap = 24;
  const tw = (inner - 2 * gap) / 3;
  const th = 176;
  drawScoreTile(g, CARD_PAD, tilesY, tw, th, d.score);
  drawTile(g, CARD_PAD + tw + gap, tilesY, tw, th, `${d.clean}/${d.reps}`, "CLEAN REPS", CARD.accent);
  drawTile(
    g,
    CARD_PAD + 2 * (tw + gap),
    tilesY,
    tw,
    th,
    d.tempo == null ? "–" : `${d.tempo.toFixed(1)}s`,
    "AVG TEMPO",
  );

  // Trace, footer
  const traceY = tilesY + th + 24;
  const footY = CARD_H - 64;
  drawTrace(g, d.trace, CARD_PAD, traceY, inner, Math.max(120, footY - 48 - traceY));
  g.textBaseline = "middle";
  g.font = font(26, 600);
  g.fillStyle = CARD.muted;
  g.fillText("Tracked on-device · no video saved", CARD_PAD, footY);
  if (d.footer) {
    g.textAlign = "right";
    g.fillStyle = CARD.text;
    g.font = font(26, 700);
    g.fillText(d.footer, CARD_W - CARD_PAD, footY);
    g.textAlign = "left";
  }
  return c;
}

async function showCard(data) {
  try {
    const canvas = await renderCard(data);
    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
    if (!blob) throw new Error("PNG encoding failed");
    if (els.cardImg.src.startsWith("blob:")) URL.revokeObjectURL(els.cardImg.src);
    els.cardImg.src = URL.createObjectURL(blob);
    const now = new Date();
    const pad2 = (n) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}`;
    state.card = { blob, name: `formcoach-${data.name}-${stamp}.png` };
    els.cardCopy.textContent = "Copy image";
    if (!els.cardDialog.open) els.cardDialog.showModal();
  } catch (err) {
    console.error("Could not build the session card:", err);
  }
}

function downloadCard() {
  if (!state.card) return;
  const url = URL.createObjectURL(state.card.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = state.card.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyCard() {
  if (!state.card) return;
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": state.card.blob })]);
    els.cardCopy.textContent = "Copied ✓";
  } catch (err) {
    console.warn("Clipboard write failed:", err);
    els.cardCopy.textContent = "Copy failed, use Download";
  }
}

async function init() {
  await loadSettings();
  renderExerciseOptions();
  els.voice.checked = state.settings.voice;
  els.angle3d.checked = state.settings.angleMode === "3d";
  renderStyleOptions();
  setPrivacyUi();
  renderCalib();
  refreshBreakUi();
  els.serverUrl.value = state.settings.serverUrl;
  drawChart();
  prefetchCatalog();

  els.startBtn.addEventListener("click", () => {
    if (state.routine) finishBreak(false);
    else if (state.running) stop();
    else start();
  });
  els.resetBtn.addEventListener("click", () => {
    cancelCalibration();
    sendJson({ type: "reset" });
    clearSet();
  });
  els.exercise.addEventListener("change", async () => {
    cancelCalibration();
    await saveSettings({ exercise: els.exercise.value });
    state.thresholds = null;
    renderExerciseMeta();
    configureExercise();
    clearSet();
    renderCalib();
  });
  els.angle3d.addEventListener("change", async () => {
    cancelCalibration();
    await saveSettings({ angleMode: els.angle3d.checked ? "3d" : "2d" });
    state.thresholds = null;
    sendJson({ type: "angles", mode: state.settings.angleMode });
    configureExercise(); // thresholds are per mode
    clearSet();
    renderCalib();
  });
  els.calibBtn.addEventListener("click", startCalibration);
  els.calibCancel.addEventListener("click", cancelCalibration);
  els.calibReset.addEventListener("click", resetCalibration);

  els.routineSkip.addEventListener("click", () => completeMove(true));
  els.routineEnd.addEventListener("click", () => finishBreak(false));
  els.breakNow.addEventListener("click", startBreak);
  els.breakTest.addEventListener("click", async () => {
    try {
      await chrome.runtime.sendMessage({ type: "break-test" });
    } catch (err) {
      console.warn("Could not show a test reminder:", err);
    }
  });
  els.breakEnabled.addEventListener("change", async () => {
    await saveSettings({ breakEnabled: els.breakEnabled.checked });
    refreshBreakUi();
  });
  els.breakInterval.addEventListener("change", async () => {
    await saveSettings({ breakInterval: Number(els.breakInterval.value) });
    refreshBreakUi();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (COACH_KEY in changes || LOG_KEY in changes)) refreshBreakUi();
  });
  window.addEventListener("hashchange", onBreakHash);

  els.shareBtn.addEventListener("click", async () => showCard(await setCardData()));
  els.cardClose.addEventListener("click", () => els.cardDialog.close());
  els.cardDownload.addEventListener("click", downloadCard);
  els.cardCopy.addEventListener("click", copyCard);
  els.voice.addEventListener("change", () =>
    saveSettings({ voice: els.voice.checked }),
  );
  els.privacy.addEventListener("change", async () => {
    clearMask(); // turning it on must not reuse an old mask
    await saveSettings({ privacy: els.privacy.checked });
    setPrivacyUi();
    sendJson({ type: "privacy", enabled: wantsMask() });
  });
  els.styleGrid.addEventListener("change", async (ev) => {
    if (ev.target.name !== "privacyStyle") return;
    clearMask(); // switching back to blur must not reuse an old mask
    await saveSettings({ privacyStyle: ev.target.value });
    setPrivacyUi();
    sendJson({ type: "privacy", enabled: wantsMask() });
  });
  els.serverUrl.addEventListener("change", async () => {
    await saveSettings({
      serverUrl: els.serverUrl.value.trim() || DEFAULTS.serverUrl,
    });
    els.serverUrl.value = state.settings.serverUrl;
    if (!state.running) prefetchCatalog();
    if (state.running) {
      disconnect();
      connect();
    }
  });
  els.exportBtn.addEventListener("click", exportCsv);
  els.demoBtn.addEventListener("click", openDemo);
  window.addEventListener("resize", drawChart);
  onBreakHash(); // opened from a break reminder
}

init();
