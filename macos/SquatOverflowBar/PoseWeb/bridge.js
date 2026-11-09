// The extension's pose gateway (extension/lib/pose) inside the Mac app, behind PoseBridge.swift.
// Swift sends what it used to send the pose server's WebSocket: JSON text messages and JPEG frames
// (base64). The replies go back as the same JSON text the server sent, the person mask as a PNG
// data URL, so SquatCore.PoseLink reads them unchanged. Nothing leaves the Mac.
import { openPoseSocket } from "/lib/pose/local-socket.js";
import { createDetector } from "/lib/pose/detector.js";

const post = (msg) => window.webkit.messageHandlers.pose.postMessage(msg);
// Errors in this page go to the app's log (there's no console to see them in).
window.addEventListener("error", (ev) => post({ kind: "log", text: `${ev.message} (${ev.filename}:${ev.lineno})` }));
window.addEventListener("unhandledrejection", (ev) => post({ kind: "log", text: String(ev.reason?.stack ?? ev.reason) }));

const socket = openPoseSocket({ createDetector });
socket.addEventListener("open", () => post({ kind: "open" }));
socket.addEventListener("close", (ev) => post({ kind: "close", code: ev.code, reason: ev.reason }));

/** The mask as the server sent it: a white PNG whose alpha is the person. */
function maskDataURL({ width, height, alpha }) {
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let i = 0; i < alpha.length; i++) rgba[i * 4 + 3] = alpha[i];
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas.toDataURL("image/png");
}

socket.addEventListener("message", (ev) => {
  const reply = ev.data;
  const wire = reply.mask ? { ...reply, mask: maskDataURL(reply.mask) } : reply;
  post({ kind: "text", text: JSON.stringify(wire) });
});

// Messages go to the socket in the order Swift sent them, though a frame needs decoding first.
let inbound = Promise.resolve();
const enqueue = (make) => {
  inbound = inbound.then(async () => socket.send(await make())).catch(() => {});
};

window.poseBridge = {
  text: (json) => enqueue(() => json),
  frame: (base64) =>
    enqueue(() => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      return createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
    }),
  close: () => socket.close(),
};
post({ kind: "loaded" });
