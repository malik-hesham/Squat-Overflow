// ---------------------------------------------------------------------------
// The 3D exercise demo on a canvas
// ---------------------------------------------------------------------------
// The break window and the Practice page (and the desktop app, which runs those pages as they are)
// show it next to the camera. With WebGL it is the Blender human (lib/demo-human.js, the model ships
// in the extension); without, lib/demo-model.js's mannequin painted flat. Nothing is fetched from
// the network. The canvas says which in data-renderer ("human" or "2d").

import { demoScene, demoTurn, demoView } from "./demo-model.js";

/** @typedef {import("./demo-model.js").Shape} Shape */

/**
 * Paints a scene, in order (it comes sorted far to near).
 * @param {CanvasRenderingContext2D} ctx
 * @param {readonly Shape[]} shapes
 */
export function paintDemo(ctx, shapes) {
  for (const sh of shapes) {
    if (sh.kind === "capsule") {
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
  /** @type {{ draw(key: string, t: number, view: import("./demo-model.js").View): void } | null} */
  let human = null;
  /** @type {CanvasRenderingContext2D | null} */
  let ctx = null;
  /** @type {Promise<void> | null} */
  let ready = null;
  // The human (three.js and the model) loads with the first demo shown, not with the page.
  const load = () =>
    (ready ??= import("./demo-human.js")
      .then((m) => m.createHumanRenderer(canvas))
      .then((renderer) => {
        human = renderer;
      })
      .catch((err) => {
        console.warn("3D demo: showing the drawn figure, the human can't load here:", err);
        ctx = canvas.getContext("2d");
      })
      .then(() => {
        canvas.dataset.renderer = human ? "human" : "2d";
      }));
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
    const t = (now - start) / 1000;
    const view = demoView(key, t, { width: w, height: h, turn, still });
    if (human) human.draw(key, t, view);
    else if (ctx) {
      ctx.clearRect(0, 0, w, h);
      paintDemo(ctx, demoScene(key, t, view) ?? []);
    }
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
      load();
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
