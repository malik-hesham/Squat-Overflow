// ---------------------------------------------------------------------------
// The 3D exercise demo on a canvas
// ---------------------------------------------------------------------------
// Paints lib/demo-model.js's scene: the break window and the Practice page (and the desktop app,
// which runs those pages as they are) show it next to the camera. Nothing is fetched: the figure
// is made on the device.

import { demoScene, demoTurn, demoView } from "./demo-model.js";

/** @typedef {import("./demo-model.js").Shape} Shape */

/**
 * Paints a scene, in order (it comes sorted far to near).
 * @param {CanvasRenderingContext2D} ctx
 * @param {readonly Shape[]} shapes
 */
export function paintDemo(ctx, shapes) {
  for (const sh of shapes) {
    if (sh.kind === "poly") {
      ctx.fillStyle = sh.fill;
      ctx.beginPath();
      ctx.moveTo(sh.points[0], sh.points[1]);
      for (let i = 2; i < sh.points.length; i += 2) ctx.lineTo(sh.points[i], sh.points[i + 1]);
      ctx.closePath();
      ctx.fill();
    } else if (sh.kind === "capsule") {
      ctx.strokeStyle = sh.fill;
      ctx.lineWidth = sh.r * 2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(sh.x1, sh.y1);
      ctx.lineTo(sh.x2, sh.y2);
      ctx.stroke();
    } else {
      ctx.fillStyle = sh.fill;
      ctx.beginPath();
      if (sh.kind === "circle") ctx.arc(sh.x, sh.y, sh.r, 0, Math.PI * 2);
      else ctx.ellipse(sh.x, sh.y, sh.rx, sh.ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

const KEY_PX = 25; // an arrow key turns the figure as far as a 25 px drag

/**
 * Plays a move's demo on `canvas` while it is shown. Drag (or the arrow keys) to turn the figure.
 * The loop runs only while a move is shown, and restarts from the rest pose for each new move.
 * @param {HTMLCanvasElement} canvas
 */
export function createDemoPlayer(canvas) {
  const ctx = canvas.getContext("2d");
  const still = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  let key = null;
  let start = 0;
  let turn = 0;
  let frame = 0;
  let drag = null;

  function draw(now) {
    frame = 0;
    if (!key) return;
    const dpr = globalThis.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.clearRect(0, 0, w, h);
    const t = (now - start) / 1000;
    paintDemo(ctx, demoScene(key, t, demoView(key, t, { width: w, height: h, turn, still })) ?? []);
    frame = requestAnimationFrame(draw);
  }

  canvas.addEventListener("pointerdown", (ev) => {
    drag = { x: ev.clientX, turn };
    canvas.setPointerCapture?.(ev.pointerId);
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (drag) turn = drag.turn + demoTurn(ev.clientX - drag.x);
  });
  for (const type of ["pointerup", "pointercancel"]) canvas.addEventListener(type, () => (drag = null));
  canvas.addEventListener("keydown", (ev) => {
    const dx = { ArrowLeft: -KEY_PX, ArrowRight: KEY_PX }[ev.key];
    if (dx == null) return;
    ev.preventDefault();
    turn += demoTurn(dx);
  });

  return {
    /** Shows a move from its rest pose (the same move keeps playing). @param {string} next */
    show(next) {
      if (next !== key) start = performance.now();
      key = next;
      if (!frame) frame = requestAnimationFrame(draw);
    },
    hide() {
      key = null;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}
