/**
 * Rep counting and per-session movement analysis (port of server/analysis/session.py).
 *
 * RepCounter is a small state machine over the exercise's primary angle:
 *
 *     rest --(leaves rest zone)--> moving --(reaches target)--> work
 *       ^                            |                           |
 *       +---- back in rest: partial -+---- back in rest: rep ----+
 *
 * Form issues are tallied per frame while a rep is in progress; an issue is
 * attributed to the rep only if it was seen in at least `minIssueFrames`
 * frames, which filters single-frame landmark glitches.
 *
 * A stretch with a `hold` only reaches its target once it has stayed there
 * (or within 30% of the way back) for `hold` seconds; back at rest sooner, the
 * rep is partial with "hold_longer". An exercise's `assist` (a second movement,
 * like the legs in a jack) is tracked over the rep: too little of it adds its
 * issue, which lowers the score but never stops the rep from counting.
 *
 * Output objects keep the server's snake_case keys, so a frame result here is
 * the same object the Python server sent over the WebSocket (minus the
 * transport fields `type`, `landmarks`, `mask`, `latency_ms`).
 */
import * as calibration from "./calibration.js";
import { Calibrator } from "./calibration.js";
import { EXERCISES, ISSUE_TEXT } from "./exercises.js";
import { Ema, Pose } from "./geometry.js";
import { pyRound, pySum } from "./pymath.js";

export const MIN_VISIBILITY = 0.5;
export const SIDE_SWITCH_MARGIN = 0.15;

/** @typedef {import("./exercises.js").Exercise} Exercise */
/** @typedef {import("./exercises.js").IssueCode} IssueCode */
/** @typedef {import("./geometry.js").Side} Side */
/** @typedef {import("./geometry.js").Landmark} Landmark */
/** @typedef {import("./geometry.js").WorldLandmark} WorldLandmark */
/** @typedef {import("./calibration.js").Thresholds} Thresholds */
/** @typedef {import("./calibration.js").CalibrationStatus} CalibrationStatus */

/** @typedef {"waiting" | "rest" | "moving" | "work"} Stage */

/**
 * @typedef {object} Rep
 * @property {number} index
 * @property {number} duration_s
 * @property {number} peak_angle deepest point reached
 * @property {number} rom range of motion in degrees
 * @property {IssueCode[]} issues
 * @property {number} score
 * @property {boolean} partial
 */

/** @typedef {Rep & { issue_text: string[] }} RepEvent */
/** @typedef {{ code: IssueCode, count: number, text: string }} TopIssue */
/** @typedef {{ code: IssueCode, text: string }} Feedback */

/**
 * @typedef {object} Summary
 * @property {number} reps
 * @property {number} good_reps
 * @property {number} partial_reps
 * @property {number | null} avg_duration_s
 * @property {number | null} avg_rom
 * @property {number | null} avg_score
 * @property {TopIssue[]} top_issues
 */

/**
 * @typedef {object} ThresholdsInfo
 * @property {number} rest
 * @property {number} target
 * @property {boolean} rest_is_high
 * @property {boolean} calibrated
 * @property {number} default_rest
 * @property {number} default_target
 */

/**
 * One frame's analysis: the shape of the old pose server's `frame` message.
 * @typedef {object} FrameResult
 * @property {string} exercise
 * @property {Side | "both" | null} side
 * @property {number | null} angle
 * @property {number | null} angle_alt
 * @property {"2d" | "3d"} angle_mode
 * @property {Stage} stage
 * @property {Feedback[]} feedback
 * @property {RepEvent | null} rep_event
 * @property {CalibrationStatus} [calibration] present only while calibrating, and on the frame calibration ends
 * @property {number} [hold] seconds left to hold, present only while a held stretch is at its target
 * @property {Summary} summary
 * @property {ThresholdsInfo} thresholds
 */

/**
 * @typedef {object} Cycle
 * @property {number} startT
 * @property {number} restRef
 * @property {number} extreme
 * @property {boolean} reachedTarget
 * @property {Map<IssueCode, number>} issueFrames per-issue frame counts, in first-seen order (like collections.Counter)
 * @property {number | null} [holdFrom] when the current hold at the target began
 * @property {boolean} [touched] reached the target zone, held long enough or not
 * @property {number} [assistLo] lowest assist value seen this rep
 * @property {number} [assistHi] highest assist value seen this rep
 */

export class RepCounter {
  /**
   * @param {Exercise} ex
   * @param {number} [minIssueFrames]
   * @param {number} [partialFraction]
   */
  constructor(ex, minIssueFrames = 3, partialFraction = 0.4) {
    /** @type {Stage} */
    this.stage = "waiting";
    /** @type {Rep[]} */
    this.reps = [];
    /** @type {Rep[]} */
    this.partials = [];
    /** @private @type {number | null} */
    this.restRef = null;
    /** @private @type {Cycle | null} */
    this.cycle = null;
    this.ex = ex;
    this.minIssueFrames = minIssueFrames;
    this.partialFraction = partialFraction;
  }

  /**
   * @private
   * @param {number} a
   * @param {number} b
   */
  deeper(a, b) {
    return this.ex.restIsHigh ? Math.min(a, b) : Math.max(a, b);
  }

  /**
   * @private
   * @param {number} a
   * @param {number} b
   */
  shallower(a, b) {
    return this.ex.restIsHigh ? Math.max(a, b) : Math.min(a, b);
  }

  /**
   * Seconds left to hold the target at `t`, or null when no hold is under way.
   * @param {number} t
   * @returns {number | null}
   */
  holdLeft(t) {
    const cyc = this.cycle;
    if (!this.ex.hold || !cyc || cyc.reachedTarget || cyc.holdFrom == null) return null;
    return Math.max(0, this.ex.hold - (t - cyc.holdFrom));
  }

  /**
   * Feed one frame. Returns a Rep when a full or partial rep just finished.
   * @param {number} value
   * @param {readonly IssueCode[]} issues
   * @param {number} t
   * @param {number | null} [assist] the exercise's second movement this frame, if it has one in view
   * @returns {Rep | null}
   */
  update(value, issues, t, assist = null) {
    const ex = this.ex;
    if (this.stage === "waiting") {
      if (ex.atRest(value)) {
        this.stage = "rest";
        this.restRef = value;
      }
      return null;
    }
    if (this.stage === "rest") {
      const restRef = this.restRef;
      if (ex.atRest(value)) {
        this.restRef = this.shallower(restRef, value);
        return null;
      }
      this.stage = "moving";
      this.cycle = { startT: t, restRef, extreme: value, reachedTarget: false, issueFrames: new Map() };
    }
    const cyc = this.cycle;
    cyc.extreme = this.deeper(cyc.extreme, value);
    for (const issue of new Set(issues)) cyc.issueFrames.set(issue, (cyc.issueFrames.get(issue) ?? 0) + 1);
    if (ex.assist && assist != null && Number.isFinite(assist)) {
      cyc.assistLo = Math.min(cyc.assistLo ?? assist, assist);
      cyc.assistHi = Math.max(cyc.assistHi ?? assist, assist);
    }
    if (ex.atTarget(value)) {
      this.stage = "work";
      cyc.touched = true;
      if (!ex.hold) cyc.reachedTarget = true;
      else cyc.holdFrom ??= t;
    } else if (cyc.holdFrom != null && !ex.holding(value)) {
      cyc.holdFrom = null; // let go before the time was up: start the hold again
    }
    if (ex.hold && !cyc.reachedTarget && cyc.holdFrom != null && t - cyc.holdFrom >= ex.hold) cyc.reachedTarget = true;
    if (!ex.atRest(value)) return null;
    // Back in the rest zone: the cycle is over.
    this.stage = "rest";
    this.restRef = value;
    this.cycle = null;
    const rom = Math.abs(cyc.restRef - cyc.extreme);
    const needed = Math.abs(cyc.restRef - ex.target);
    if (!cyc.reachedTarget && rom < this.partialFraction * needed) {
      return null; // small wobble, not an attempted rep
    }
    const repIssues = [...cyc.issueFrames]
      .filter(([, n]) => n >= this.minIssueFrames)
      .map(([i]) => i)
      .sort(compareCodePoints);
    const duration = t - cyc.startT;
    if (duration < ex.minRepSeconds) repIssues.push("too_fast");
    if (cyc.reachedTarget && ex.assist && cyc.assistHi !== undefined && cyc.assistHi - cyc.assistLo < ex.assist.range) {
      repIssues.push(ex.assist.issue);
      repIssues.sort(compareCodePoints);
    }
    if (!cyc.reachedTarget) repIssues.unshift(ex.hold && cyc.touched ? "hold_longer" : "not_deep_enough");
    const rep = {
      index: cyc.reachedTarget ? this.reps.length + 1 : 0,
      duration_s: pyRound(duration, 2),
      peak_angle: pyRound(cyc.extreme, 1),
      rom: pyRound(rom, 1),
      issues: repIssues,
      score: ex.repScore(rom, needed, duration, repIssues),
      partial: !cyc.reachedTarget,
    };
    (cyc.reachedTarget ? this.reps : this.partials).push(rep);
    return rep;
  }

  /** @returns {Summary} */
  summary() {
    const reps = this.reps;
    // collections.Counter over every issue of every rep, then most_common(3):
    // highest count first, ties in first-seen order.
    /** @type {Map<IssueCode, number>} */
    const issueCounts = new Map();
    for (const r of [...reps, ...this.partials]) {
      for (const i of r.issues) issueCounts.set(i, (issueCounts.get(i) ?? 0) + 1);
    }
    const top = [...issueCounts].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const avg = (/** @type {number[]} */ xs) => (xs.length ? pyRound(pySum(xs) / xs.length, 1) : null);
    return {
      reps: reps.length,
      good_reps: reps.filter((r) => r.issues.length === 0).length,
      partial_reps: this.partials.length,
      avg_duration_s: avg(reps.map((r) => r.duration_s)),
      avg_rom: avg(reps.map((r) => r.rom)),
      avg_score: avg(reps.map((r) => r.score)),
      top_issues: top.map(([code, count]) => ({ code, count, text: ISSUE_TEXT[code] })),
    };
  }
}

/** Python's default string ordering (code points); issue codes are ASCII. */
/**
 * @param {string} a
 * @param {string} b
 */
function compareCodePoints(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** @returns {Feedback[]} */
const notVisible = () => [{ code: "not_visible", text: ISSUE_TEXT.not_visible }];

/**
 * All per-user analysis state for one exercise set.
 *
 * `useWorld`: measure angles on MediaPipe's 3D world landmarks instead of the
 * 2D image landmarks (when the frame has them). Each frame also reports the
 * angle from the other mode as `angle_alt`, so the UI can show both.
 */
export class Session {
  /**
   * Defaults match the Python (`Session("squat")`); the app passes DEFAULT_EXERCISE.
   * @param {string} [exerciseKey]
   * @param {boolean} [useWorld]
   */
  constructor(exerciseKey = "squat", useWorld = false) {
    /** The exercise with its default thresholds. @type {Exercise} */
    this.baseExercise;
    /** Calibrated thresholds in use, or null for the defaults. @type {Thresholds | null} */
    this.thresholds;
    /** The exercise as counted: `baseExercise` with `thresholds` applied. @type {Exercise} */
    this.exercise;
    /** @type {RepCounter} */
    this.counter;
    /** @private @type {Ema} */
    this.smooth;
    /** @private @type {Ema} */
    this.altSmooth;
    /** @type {Calibrator | null} */
    this.calibrator = null;
    /** @private @type {Side | null} */
    this.side = null;
    this.useWorld = useWorld;
    this.setExercise(exerciseKey);
  }

  /**
   * Start a new set. `thresholds` replaces the default rest/target (from calibration).
   * @param {string} key
   * @param {Thresholds | null} [thresholds]
   */
  setExercise(key, thresholds = null) {
    if (!Object.prototype.hasOwnProperty.call(EXERCISES, key)) {
      throw new Error(`unknown exercise ${JSON.stringify(key)}`);
    }
    this.baseExercise = EXERCISES[key];
    this.thresholds = thresholds;
    this.exercise = thresholds ? calibration.apply(this.baseExercise, thresholds) : this.baseExercise;
    this.counter = new RepCounter(this.exercise);
    this.smooth = new Ema(0.5);
    this.altSmooth = new Ema(0.5);
    this.side = null;
    this.calibrator = null;
  }

  reset() {
    this.setExercise(this.exercise.key, this.thresholds);
  }

  /**
   * Switch 2D/3D angles. Thresholds are per mode, so this drops any calibration.
   * @param {boolean} useWorld
   */
  setAngleMode(useWorld) {
    this.useWorld = useWorld;
    this.setExercise(this.exercise.key);
  }

  /** Next reps teach the thresholds; the rep counter pauses until calibration ends. */
  startCalibration() {
    this.setExercise(this.exercise.key); // learn from the default exercise, on a fresh set
    this.calibrator = new Calibrator(this.baseExercise);
  }

  cancelCalibration() {
    this.calibrator = null;
  }

  /**
   * @private
   * @param {Pose} pose
   * @param {Side} side
   */
  visibility(pose, side) {
    return Math.min(...this.exercise.joints.map((j) => pose.vis(side, j)));
  }

  /**
   * @private
   * @param {Pose} pose
   * @returns {[Side | "both", number]}
   */
  pickSide(pose) {
    if (this.exercise.bilateral) {
      return ["both", Math.min(this.visibility(pose, "left"), this.visibility(pose, "right"))];
    }
    const vis = { left: this.visibility(pose, "left"), right: this.visibility(pose, "right") };
    /** @type {Side} */
    const best = vis.right > vis.left ? "right" : "left"; // max() keeps the first on ties
    if (this.side === null || vis[best] > vis[this.side] + SIDE_SWITCH_MARGIN) {
      this.side = best;
    }
    return [this.side, vis[this.side]];
  }

  /**
   * Analyse one frame. `t` is a timestamp in seconds; `world` = 3D landmarks
   * (already passed through `alignWorldY`), if any.
   * @param {readonly Landmark[] | null | undefined} landmarks
   * @param {number} width
   * @param {number} height
   * @param {number} t
   * @param {readonly WorldLandmark[] | null} [world]
   * @returns {FrameResult}
   */
  process(landmarks, width, height, t, world = null) {
    const ex = this.exercise;
    const hasWorld = world != null;
    /** @type {Omit<FrameResult, "summary" | "thresholds"> & Partial<FrameResult>} */
    const out = {
      exercise: ex.key,
      side: null,
      angle: null,
      angle_alt: null,
      angle_mode: this.useWorld && hasWorld ? "3d" : "2d",
      stage: this.counter.stage,
      feedback: [],
      rep_event: null,
    };
    if (landmarks == null) {
      this.smooth.reset();
      this.altSmooth.reset();
      out.feedback = notVisible();
      return this.finish(out);
    }
    const pose = new Pose(landmarks, width, height, world ?? null, this.useWorld);
    const [side, vis] = this.pickSide(pose);
    out.side = side;
    if (vis < MIN_VISIBILITY) {
      this.smooth.reset();
      this.altSmooth.reset();
      out.feedback = notVisible();
      return this.finish(out);
    }
    const measureSide = side === "both" ? "left" : side;
    const m = ex.measure(pose, measureSide);
    const value = this.smooth.update(m.value);
    out.angle = pyRound(value, 1);
    if (hasWorld) {
      // same angle measured the other way (2D vs 3D), for comparison
      const other = new Pose(landmarks, width, height, world, !this.useWorld);
      out.angle_alt = pyRound(this.altSmooth.update(ex.measure(other, measureSide).value), 1);
    }
    out.feedback = m.issues.map((c) => ({ code: c, text: ISSUE_TEXT[c] }));
    if (this.calibrator !== null) {
      if (m.valid) this.calibrate(value, out);
    } else if (m.valid) {
      const rep = this.counter.update(value, m.issues, t, m.assist ?? null);
      if (rep !== null) {
        out.rep_event = { ...rep, issues: [...rep.issues], issue_text: rep.issues.map((c) => ISSUE_TEXT[c]) };
      }
    }
    out.stage = this.counter.stage;
    const left = this.calibrator === null ? this.counter.holdLeft(t) : null;
    if (left !== null) out.hold = pyRound(left, 1);
    return this.finish(out);
  }

  /**
   * @private
   * @param {number} value
   * @param {Partial<FrameResult>} out
   */
  calibrate(value, out) {
    const cal = this.calibrator;
    cal.update(value);
    if (!cal.done) return;
    const th = cal.result();
    if (th === null) {
      // range too small to count reps on
      this.calibrator = null;
      out.calibration = { status: "failed", reps: cal.reps, needed: cal.repsNeeded };
      return;
    }
    this.setExercise(this.exercise.key, th);
    out.calibration = { status: "done", reps: cal.reps, needed: cal.repsNeeded, rest: th.rest, target: th.target };
  }

  /**
   * @private
   * @param {Omit<FrameResult, "summary" | "thresholds"> & Partial<FrameResult>} out
   * @returns {FrameResult}
   */
  finish(out) {
    if (this.calibrator !== null && !("calibration" in out)) {
      out.calibration = this.calibrator.status();
    }
    out.stage = this.counter.stage;
    out.summary = this.counter.summary();
    out.thresholds = {
      rest: this.exercise.rest,
      target: this.exercise.target,
      rest_is_high: this.exercise.restIsHigh,
      calibrated: this.thresholds !== null,
      default_rest: this.baseExercise.rest,
      default_target: this.baseExercise.target,
    };
    return /** @type {FrameResult} */ (out);
  }
}
