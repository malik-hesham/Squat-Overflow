/**
 * The old pose server's /ws protocol, answered on the device (port of server/src/pose/pose.gateway.ts
 * without the WebSocket plumbing). Pages keep talking the same messages; lib/pose/local-socket.js
 * hands them here instead of to a server.
 *
 *   client -> gateway  JSON text  {"type": "config", "exercise": "neck_tilt", "calibration"?: {"rest", "target"}}
 *                                 {"type": "reset"} | {"type": "privacy", "enabled": true}
 *                                 {"type": "angles", "mode": "2d" | "3d"} | {"type": "calibrate", "action": "start" | "cancel"}
 *                      anything else is a camera frame for `detect`
 *   gateway -> client  {"type": "ready", ...} first, then one or more replies per message: "config", "privacy",
 *                      "angles", "calibrate", "frame" (with "mask" while privacy is on) or "error"
 *
 * `detect(frame, ms, { mask })` is the pose model (lib/pose/detector.js in the browser, a fake in tests). It
 * returns the frame's size, its 33 landmarks (or null when nobody is found), its world landmarks
 * and its person mask.
 */
import { validate as validateCalibration } from "./calibration.js";
import { exerciseCatalog } from "./catalog.js";
import { CATALOG, DEFAULT_EXERCISE } from "./exercises.js";
import { CONNECTIONS } from "./geometry.js";
import { encodeMask } from "./mask.js";
import { Session } from "./session.js";
import { alignWorldY } from "./world.js";

/**
 * @typedef {object} Detection
 * @property {number} width
 * @property {number} height
 * @property {number[][] | null} landmarks 33 x [x, y, visibility], normalised
 * @property {number[][] | null} world 33 x [x, y, z] meters, as the model gives them
 * @property {import("./mask.js").PersonMask | null} mask
 */
/**
 * `mask`: whether the client needs the person mask (privacy blur); segmentation costs time.
 * @typedef {(frame: any, ms: number, opts: { mask: boolean }) => Promise<Detection>} Detect
 */
/** @typedef {Record<string, any>} Reply */

const TEXT_EVENTS = ["config", "reset", "privacy", "angles", "calibrate"];

/** @param {string} message */
const error = (message) => ({ type: "error", message });

/**
 * Python-style repr for error texts, matching the original server's f"{x!r}" messages.
 * @param {unknown} value
 * @returns {string}
 */
export function pyRepr(value) {
  if (value === undefined || value === null) return "None";
  if (typeof value === "string") return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  if (typeof value === "boolean") return value ? "True" : "False";
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(", ")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value).map(([k, v]) => `${pyRepr(k)}: ${pyRepr(v)}`).join(", ")}}`;
  }
  return String(value);
}

/** @param {number[][]} landmarks */
function roundLandmarks(landmarks) {
  const r = (/** @type {number} */ v, /** @type {number} */ d) => Math.round(v * 10 ** d) / 10 ** d;
  return landmarks.map(([x, y, v]) => [r(x, 4), r(y, 4), r(v, 3)]);
}

/**
 * One gateway per open socket: it owns that client's analysis session.
 * @param {{ detect: Detect, now?: () => number }} deps `now` in milliseconds (performance.now by default)
 */
export function createPoseGateway({ detect, now = () => performance.now() }) {
  const session = new Session(DEFAULT_EXERCISE);
  const t0 = now();
  let privacy = false; // true: include a person mask with each frame result

  const configReply = () => ({ type: "config", exercise: session.exercise.key, calibrated: session.thresholds !== null });

  /** @type {Record<string, (payload: Record<string, any>) => Reply[]>} */
  const handlers = {
    privacy(payload) {
      privacy = payload.enabled === true;
      return [{ type: "privacy", enabled: privacy }];
    },
    angles(payload) {
      const mode = payload.mode;
      if (mode !== "2d" && mode !== "3d") return [error(`unknown angle mode ${pyRepr(mode)}`)];
      session.setAngleMode(mode === "3d");
      return [{ type: "angles", mode, exercise: session.exercise.key }];
    },
    calibrate(payload) {
      const action = payload.action;
      if (action === "start") session.startCalibration();
      else if (action === "cancel") session.cancelCalibration();
      else return [error(`unknown calibrate action ${pyRepr(action)}`)];
      return [{ type: "calibrate", action, exercise: session.exercise.key }];
    },
    config(payload) {
      const key = "exercise" in payload ? payload.exercise : "";
      // Workout exercises exist in lib/pose but are not offered.
      if (typeof key !== "string" || !Object.hasOwn(CATALOG, key)) return [error(`unknown exercise ${pyRepr(key)}`)];
      /** @type {Reply[]} */
      const replies = [];
      let thresholds = null;
      const cal = payload.calibration;
      if (cal !== undefined && cal !== null) {
        const { rest, target } = typeof cal === "object" && !Array.isArray(cal) ? cal : {};
        thresholds = validateCalibration(CATALOG[key], rest, target);
        // Report the bad calibration, then switch with defaults: the exercise itself is valid.
        if (thresholds === null) replies.push(error("invalid calibration"));
      }
      session.setExercise(key, thresholds);
      return [...replies, configReply()];
    },
    reset() {
      session.reset();
      return [configReply()];
    },
  };

  /**
   * @param {any} frame
   * @returns {Promise<Reply[]>}
   */
  async function onFrame(frame) {
    const started = now();
    const t = (started - t0) / 1000;
    /** @type {Detection} */
    let found;
    try {
      found = await detect(frame, Math.trunc(t * 1000), { mask: privacy });
    } catch {
      return [error("could not read frame")];
    }
    const { width, height, landmarks, mask } = found;
    const world = landmarks && found.world ? alignWorldY(landmarks, found.world) : null;
    /** @type {Reply} */
    const result = session.process(landmarks, width, height, t, world);
    result.type = "frame";
    result.landmarks = landmarks ? roundLandmarks(landmarks) : null;
    // null = no person found; the client then blurs the whole frame.
    if (privacy) result.mask = mask ? encodeMask(mask, landmarks) : null;
    result.latency_ms = Math.round((now() - started) * 10) / 10;
    return [result];
  }

  return {
    /** The first message a client gets. */
    ready() {
      return { type: "ready", exercises: exerciseCatalog(), connections: CONNECTIONS, exercise: DEFAULT_EXERCISE };
    },
    /**
     * Replies to one client message, in order. Text is a JSON message; anything else is a frame.
     * @param {unknown} message
     * @returns {Promise<Reply[]>}
     */
    async handle(message) {
      if (typeof message !== "string") return onFrame(message);
      let payload;
      try {
        payload = JSON.parse(message);
      } catch {
        return [error("invalid JSON")];
      }
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return [error("expected a JSON object")];
      const kind = payload.type;
      if (typeof kind !== "string" || !TEXT_EVENTS.includes(kind)) return [error(`unknown message type ${pyRepr(kind)}`)];
      return handlers[kind](payload);
    },
  };
}
