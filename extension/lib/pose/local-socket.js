/**
 * A WebSocket-shaped connection to the pose gateway in this page, so the break page and the trainer
 * keep their message handling from the days of the pose server. Differences from a WebSocket:
 * `message` events carry the reply object itself (no JSON), `send` takes a JSON string or a frame
 * for the detector, and "connecting" means loading the model (lib/pose/detector.js).
 *
 * Messages are answered strictly in order, one at a time, so a reply never overtakes the one before
 * it (a "config" sent between two frames applies to the second frame only).
 */
import { createPoseGateway } from "./gateway.js";

/** Close code when the model can't load (WebSocket's 1011 "internal error"). */
export const CLOSE_MODEL_FAILED = 1011;

/** @typedef {{ detect: import("./gateway.js").Detect, close(): void }} Detector */

/**
 * @typedef {EventTarget & {
 *   readonly CONNECTING: 0, readonly OPEN: 1, readonly CLOSING: 2, readonly CLOSED: 3,
 *   readyState: number, send(message: unknown): void, close(code?: number, reason?: string): void,
 * }} PoseSocket
 */

/**
 * @param {{ createDetector: () => Promise<Detector>, now?: () => number }} deps
 * @returns {PoseSocket}
 */
export function openPoseSocket({ createDetector, now }) {
  /** @type {Detector | null} */
  let detector = null;
  /** @type {ReturnType<typeof createPoseGateway> | null} */
  let gateway = null;
  let queue = Promise.resolve();

  const socket = /** @type {PoseSocket} */ (
    Object.assign(new EventTarget(), { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3, readyState: 0, send, close })
  );
  const emit = (/** @type {unknown} */ data) => {
    if (socket.readyState === socket.OPEN) socket.dispatchEvent(new MessageEvent("message", { data }));
  };

  createDetector().then(
    (d) => {
      if (socket.readyState !== socket.CONNECTING) {
        d.close();
        return;
      }
      detector = d;
      gateway = createPoseGateway({ detect: d.detect, now });
      socket.readyState = socket.OPEN;
      socket.dispatchEvent(new Event("open"));
      emit(gateway.ready());
    },
    (err) => {
      if (socket.readyState === socket.CONNECTING) {
        socket.dispatchEvent(new Event("error"));
        close(CLOSE_MODEL_FAILED, String(err?.message ?? err));
      }
    },
  );

  /** @param {unknown} message a JSON text message, or a frame (a video element) */
  function send(message) {
    if (socket.readyState !== socket.OPEN) return;
    const g = gateway;
    queue = queue.then(async () => {
      if (socket.readyState !== socket.OPEN) return;
      for (const reply of await g.handle(message)) emit(reply);
    });
  }

  /**
   * @param {number} [code]
   * @param {string} [reason]
   */
  function close(code = 1000, reason = "") {
    if (socket.readyState === socket.CLOSED) return;
    socket.readyState = socket.CLOSED;
    detector?.close();
    socket.dispatchEvent(Object.assign(new Event("close"), { code, reason }));
  }

  return socket;
}
