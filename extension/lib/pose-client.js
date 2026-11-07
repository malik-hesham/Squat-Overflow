import { cacheCatalog } from "./store.js";

const CAPTURE_WIDTH = 480;
const JPEG_QUALITY = 0.7;
const INFLIGHT_TIMEOUT_MS = 3000;
const PRIVACY_DOWNSCALE = 24;
const MASK_MAX_AGE_MS = 500;
const MIN_VIS = 0.5;
const CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25],
  [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];

export function createPoseClient({ serverUrl, video, canvas, privacy, onFrame, onStatus }) {
  const st = {
    ws: null,
    stream: null,
    running: false,
    exercise: null,
    inflightSince: 0,
    capture: null,
    latest: null,
    latestAt: 0,
    mask: null,
    maskSeq: 0,
    fx: null,
    fxSmall: null,
    connections: CONNECTIONS,
    watchdog: 0,
  };

  const sendJson = (obj) => {
    if (st.ws?.readyState === WebSocket.OPEN) st.ws.send(JSON.stringify(obj));
  };

  function connect() {
    onStatus("connecting");
    let ws;
    try {
      ws = new WebSocket(serverUrl);
    } catch {
      onStatus("offline");
      return;
    }
    ws.binaryType = "arraybuffer";
    st.ws = ws;
    ws.addEventListener("open", () => {
      st.inflightSince = 0;
      onStatus("open");
      if (st.exercise) sendJson({ type: "config", exercise: st.exercise });
      sendJson({ type: "privacy", enabled: privacy });
      pump();
    });
    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === "ready") {
        if (msg.connections) st.connections = msg.connections;
        cacheCatalog(msg).catch(() => {});
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
    ws.addEventListener("close", () => {
      if (st.ws !== ws) return;
      st.ws = null;
      if (st.running) onStatus("offline");
    });
  }

  async function pump() {
    const ws = st.ws;
    if (!st.running || !ws || ws.readyState !== WebSocket.OPEN || st.inflightSince) return;
    if (video.readyState < 2 || !video.videoWidth) {
      setTimeout(pump, 50);
      return;
    }
    st.inflightSince = performance.now();
    try {
      const w = CAPTURE_WIDTH;
      const h = Math.round((video.videoHeight * w) / video.videoWidth);
      if (!st.capture || st.capture.width !== w || st.capture.height !== h) st.capture = new OffscreenCanvas(w, h);
      st.capture.getContext("2d").drawImage(video, 0, 0, w, h);
      const blob = await st.capture.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
      const buf = await blob.arrayBuffer();
      if (st.running && ws.readyState === WebSocket.OPEN) ws.send(buf);
      else st.inflightSince = 0;
    } catch {
      st.inflightSince = 0;
      setTimeout(pump, 200);
    }
  }

  async function updateMask(dataUrl) {
    const seq = ++st.maskSeq;
    if (!dataUrl) {
      st.mask = null;
      return;
    }
    const img = new Image();
    img.src = dataUrl;
    try {
      await img.decode();
    } catch {
      return;
    }
    if (seq === st.maskSeq) st.mask = { img, at: performance.now() };
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
    if (privacy) {
      drawPrivate(ctx, w, h);
    } else {
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, w, h);
      ctx.restore();
    }
    const msg = st.latest;
    if (msg?.landmarks && performance.now() - st.latestAt < 1000) {
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

  function setExercise(key) {
    st.exercise = key;
    st.latest = null;
    sendJson({ type: "config", exercise: key });
  }

  return { start, stop, setExercise };
}

export function fetchCatalog(serverUrl, timeoutMs = 3000) {
  return new Promise((resolve) => {
    let ws;
    try {
      ws = new WebSocket(serverUrl);
    } catch {
      resolve([]);
      return;
    }
    const finish = (list) => {
      clearTimeout(timer);
      ws.close();
      resolve(list);
    };
    const timer = setTimeout(() => finish([]), timeoutMs);
    ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type !== "ready") return;
        cacheCatalog(msg).catch(() => {});
        finish(Array.isArray(msg.exercises) ? msg.exercises : []);
      } catch {
        finish([]);
      }
    });
    ws.addEventListener("error", () => finish([]));
  });
}
