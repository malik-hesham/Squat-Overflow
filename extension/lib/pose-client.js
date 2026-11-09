import { CLOSE_MODEL_FAILED, openPoseSocket } from "./pose/local-socket.js";

const INFLIGHT_TIMEOUT_MS = 3000;
const PRIVACY_DOWNSCALE = 24;
const MASK_MAX_AGE_MS = 500;
const MIN_VIS = 0.5;
const CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25],
  [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];

/** The pose model runs in this page (lib/pose): no server, and camera frames never leave the device. */
const openLocal = () => openPoseSocket({ createDetector: async () => (await import("./pose/detector.js")).createDetector() });

/**
 * Camera, on-device pose analysis and the preview canvas for one break. `openSocket` is for tests.
 * Statuses: "connecting" (the model is loading), "open", "camera-denied", "unavailable" (this browser
 * can't run the model).
 */
export function createPoseClient({ video, canvas, privacy, style = "blur", avatars = null, fitness = null, onFrame, onStatus, openSocket = openLocal }) {
  const st = {
    privacy,
    style,
    avatar: null,
    ws: null,
    stream: null,
    running: false,
    exercise: null,
    inflightSince: 0,
    latest: null,
    latestAt: 0,
    mask: null,
    maskSeq: 0,
    fx: null,
    fxSmall: null,
    connections: CONNECTIONS,
    watchdog: 0,
    awaitingFrame: false, // pump() is waiting for the camera's next frame
  };

  const sendJson = (obj) => {
    if (st.ws && st.ws.readyState === st.ws.OPEN) st.ws.send(JSON.stringify(obj));
  };
  // A 3D character needs WebGL; without it the blurred mask stands in.
  const character = () =>
    st.privacy && avatars && Object.hasOwn(avatars.CHARACTERS, st.style) && avatars.supported?.() !== false ? st.style : null;
  const wantsMask = () => st.privacy && !character();

  function connect() {
    onStatus("connecting");
    const ws = openSocket();
    st.ws = ws;
    ws.addEventListener("open", () => {
      st.inflightSince = 0;
      onStatus("open");
      if (st.exercise) sendJson({ type: "config", exercise: st.exercise });
      sendJson({ type: "privacy", enabled: wantsMask() });
      pump();
    });
    ws.addEventListener("message", (/** @type {MessageEvent} */ ev) => {
      const msg = ev.data;
      if (msg.type === "ready") {
        if (msg.connections) st.connections = msg.connections;
      } else if (msg.type === "frame") {
        st.inflightSince = 0;
        if ("mask" in msg) updateMask(msg.mask);
        if (msg.exercise === st.exercise) {
          st.latest = msg;
          st.latestAt = performance.now();
          onFrame(msg);
        }
        pump();
      } else if (msg.type === "error" && st.inflightSince) {
        st.inflightSince = 0;
        pump();
      }
    });
    ws.addEventListener("close", (/** @type {any} */ ev) => {
      if (st.ws !== ws) return;
      st.ws = null;
      if (st.running) onStatus(ev.code === CLOSE_MODEL_FAILED ? "unavailable" : "offline");
    });
  }

  // One frame in flight at a time, and each camera frame analysed once: after a result, the next
  // frame goes when the camera presents a new one. That wait also lets the page render and run
  // timers; the model answers in a few ms, so sending straight away would spin on the main thread.
  // (A live stream's currentTime moves with the clock, so it can't tell frames apart.)
  function pump() {
    const ws = st.ws;
    if (!st.running || !ws || ws.readyState !== ws.OPEN || st.inflightSince || st.awaitingFrame) return;
    st.awaitingFrame = true;
    const send = () => {
      st.awaitingFrame = false;
      if (!st.running || st.ws !== ws || ws.readyState !== ws.OPEN || st.inflightSince) return;
      if (video.readyState < 2 || !video.videoWidth) {
        setTimeout(pump, 50);
        return;
      }
      st.inflightSince = performance.now();
      ws.send(video); // the model reads the frame on screen
    };
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(send);
    else setTimeout(send, 33);
  }

  /** @param {import("./pose/mask.js").MaskAlpha | null} mask the person in alpha (lib/pose/mask.js) */
  function updateMask(mask) {
    st.maskSeq++;
    if (!mask) {
      st.mask = null;
      return;
    }
    const rgba = new Uint8ClampedArray(mask.width * mask.height * 4).fill(255);
    for (let i = 0; i < mask.alpha.length; i++) rgba[i * 4 + 3] = mask.alpha[i];
    const img = new OffscreenCanvas(mask.width, mask.height);
    img.getContext("2d").putImageData(new ImageData(rgba, mask.width, mask.height), 0, 0);
    st.mask = { img, at: performance.now() };
  }

  function freshMask() {
    const m = st.mask;
    return m && performance.now() - m.at < MASK_MAX_AGE_MS ? m.img : null;
  }

  function drawPrivate(ctx, w, h) {
    const sw = Math.max(1, Math.round(w / PRIVACY_DOWNSCALE));
    const sh = Math.max(1, Math.round(h / PRIVACY_DOWNSCALE));
    if (!st.fxSmall || st.fxSmall.width !== sw || st.fxSmall.height !== sh) st.fxSmall = new OffscreenCanvas(sw, sh);
    if (!st.fx || st.fx.width !== w || st.fx.height !== h) st.fx = new OffscreenCanvas(w, h);
    const small = st.fxSmall.getContext("2d");
    small.imageSmoothingQuality = "high";
    small.drawImage(video, 0, 0, sw, sh);
    const fx = st.fx.getContext("2d");
    fx.globalCompositeOperation = "source-over";
    fx.clearRect(0, 0, w, h);
    fx.imageSmoothingEnabled = true;
    fx.imageSmoothingQuality = "high";
    fx.drawImage(st.fxSmall, 0, 0, w, h);
    const mask = freshMask();
    if (mask) {
      fx.globalCompositeOperation = "destination-in";
      fx.drawImage(mask, 0, 0, w, h);
      fx.globalCompositeOperation = "source-over";
    }
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    if (mask) ctx.drawImage(video, 0, 0, w, h);
    ctx.drawImage(st.fx, 0, 0);
    ctx.restore();
  }

  function drawSkeleton(ctx, lms, w, h, hasIssues) {
    const color = hasIssues ? "#ffb547" : "#3ddc97";
    const px = (lm) => [(1 - lm[0]) * w, lm[1] * h];
    ctx.lineWidth = Math.max(3, w / 180);
    ctx.lineCap = "round";
    ctx.strokeStyle = color;
    for (const [a, b] of st.connections) {
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

  function render() {
    if (!st.running) return;
    if (video.videoWidth && (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight)) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    const ctx = canvas.getContext("2d");
    const { width: w, height: h } = canvas;
    const msg = st.latest;
    const fresh = msg?.landmarks && performance.now() - st.latestAt < 1000;
    const key = character();
    if (key) {
      if (st.avatar?.key !== key) {
        st.avatar?.dispose?.();
        st.avatar = avatars.create(key, fitness ?? {});
      }
      avatars.drawBackdrop(ctx, w, h);
      st.avatar.draw(ctx, fresh ? msg.landmarks : null, w, h, { issues: fresh && msg.feedback.length > 0 });
      requestAnimationFrame(render);
      return;
    }
    if (st.privacy) {
      drawPrivate(ctx, w, h);
    } else {
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, w, h);
      ctx.restore();
    }
    if (fresh) {
      drawSkeleton(ctx, msg.landmarks, w, h, msg.feedback.length > 0);
    }
    requestAnimationFrame(render);
  }

  async function start() {
    try {
      st.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 960 }, height: { ideal: 720 }, facingMode: "user" },
        audio: false,
      });
      video.srcObject = st.stream;
      await video.play();
    } catch {
      stop();
      onStatus("camera-denied");
      return false;
    }
    st.running = true;
    connect();
    st.watchdog = setInterval(() => {
      if (st.inflightSince && performance.now() - st.inflightSince > INFLIGHT_TIMEOUT_MS) {
        st.inflightSince = 0;
        pump();
      }
    }, 1000);
    requestAnimationFrame(render);
    return true;
  }

  function stop() {
    st.running = false;
    clearInterval(st.watchdog);
    st.maskSeq++;
    st.mask = null;
    st.stream?.getTracks().forEach((t) => t.stop());
    st.stream = null;
    video.srcObject = null;
    const ws = st.ws;
    st.ws = null;
    ws?.close();
  }

  function setLook(next) {
    st.privacy = next.privacy;
    st.style = next.style;
    st.maskSeq++;
    st.mask = null;
    sendJson({ type: "privacy", enabled: wantsMask() });
  }

  function celebrate(clean) {
    if (character()) st.avatar?.celebrate(clean);
  }

  function setExercise(key) {
    st.exercise = key;
    st.latest = null;
    sendJson({ type: "config", exercise: key });
  }

  return { start, stop, setExercise, setLook, celebrate };
}
