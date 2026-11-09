/**
 * Per-user calibration: learn rest and target thresholds from 3 comfortable reps
 * (port of server/analysis/calibration.py).
 *
 * The default thresholds are hand-tuned for an average body. During calibration
 * the user does a few reps through *their* comfortable range; we watch the
 * exercise's primary angle (already smoothed by the session) and record, for
 * each rep, where it started (rest) and how far it went (depth). The new
 * thresholds sit inside that range, so a normal rep for this person counts:
 *
 *     rest   = restRef + REST_FRACTION   * depth   (towards the target side)
 *     target = restRef + TARGET_FRACTION * depth
 *
 * Reps are segmented without thresholds: a rep starts when the angle leaves the
 * resting value by more than `minExcursion`, and ends when it comes back within
 * RETURN_FRACTION of that rep's own depth. The direction of a rep (angle grows
 * or shrinks) comes from the exercise.
 */
import { EXERCISES } from "./exercises.js";
import { median, pyRound } from "./pymath.js";

export const REPS_NEEDED = 3;
export const REST_FRACTION = 0.25;
export const TARGET_FRACTION = 0.75;
export const RETURN_FRACTION = 0.35;
export const MIN_EXCURSION_FRACTION = 0.25; // of the default rest->target span
export const MIN_EXCURSION_DEG = 3.0;
export const MIN_SPAN_DEG = 3.0; // calibrated rest and target must be at least this far apart

/** @typedef {import("./exercises.js").Exercise} Exercise */
/** @typedef {{ readonly rest: number, readonly target: number }} Thresholds */
/** @typedef {{ status: "recording" | "failed", reps: number, needed: number }} CalibrationRecording */
/** @typedef {{ status: "done", reps: number, needed: number, rest: number, target: number }} CalibrationDone */
/** @typedef {CalibrationRecording | CalibrationDone} CalibrationStatus */

/**
 * Thresholds from a client, or null if they don't fit this exercise
 * (Python's `calibration.validate`). `ex` may be an Exercise or its key.
 * @param {Exercise | string} ex
 * @param {unknown} rest
 * @param {unknown} target
 * @returns {Thresholds | null}
 */
export function validate(ex, rest, target) {
  const exercise = typeof ex === "string" ? EXERCISES[ex] : ex;
  if (exercise === undefined) throw new Error(`unknown exercise ${JSON.stringify(ex)}`);
  if (typeof rest === "boolean" || typeof target === "boolean") return null;
  if (typeof rest !== "number" || typeof target !== "number") return null;
  if (!(rest >= 0.0 && rest <= 180.0 && target >= 0.0 && target <= 180.0)) return null;
  const span = exercise.restIsHigh ? rest - target : target - rest;
  if (span < MIN_SPAN_DEG) return null;
  return { rest: pyRound(rest, 1), target: pyRound(target, 1) };
}

/**
 * A copy of the exercise using these thresholds.
 * @template {Exercise} E
 * @param {E} ex
 * @param {Thresholds} th
 * @returns {E}
 */
export function apply(ex, th) {
  return ex.withThresholds(th.rest, th.target);
}

export class Calibrator {
  /**
   * @param {Exercise} ex
   * @param {number} [repsNeeded]
   */
  constructor(ex, repsNeeded = REPS_NEEDED) {
    /** @type {number[]} */
    this.restSamples = [];
    /** @type {number[]} */
    this.depths = [];
    /** @private @type {number | null} */
    this.restRef = null;
    /** Deepest value of the rep in progress, null when resting. @private @type {number | null} */
    this.peak = null;
    this.ex = ex;
    this.repsNeeded = repsNeeded;
  }

  get minExcursion() {
    const span = Math.abs(this.ex.rest - this.ex.target);
    return Math.max(MIN_EXCURSION_DEG, MIN_EXCURSION_FRACTION * span);
  }

  get reps() {
    return this.depths.length;
  }

  get done() {
    return this.reps >= this.repsNeeded;
  }

  /**
   * How far `v` is from rest, towards the target (negative = the other way).
   * @private
   * @param {number} v
   * @param {number} restRef
   */
  depth(v, restRef) {
    return this.ex.restIsHigh ? restRef - v : v - restRef;
  }

  /**
   * Feed one smoothed angle. Returns true when a calibration rep just finished.
   * @param {number} v
   */
  update(v) {
    if (this.done) return false;
    if (this.restRef === null) {
      this.restRef = v;
      return false;
    }
    const depth = this.depth(v, this.restRef);
    if (this.peak === null) {
      // resting
      if (depth < 0) {
        this.restRef = v; // even further from the target: that's the real rest position
      } else if (depth > this.minExcursion) {
        this.peak = depth;
      }
      return false;
    }
    this.peak = Math.max(this.peak, depth);
    if (depth > RETURN_FRACTION * this.peak) return false;
    this.restSamples.push(this.restRef);
    this.depths.push(this.peak);
    this.restRef = v;
    this.peak = null;
    return true;
  }

  /** @returns {Thresholds | null} */
  result() {
    if (!this.done) return null;
    const restRef = median(this.restSamples);
    const depth = median(this.depths);
    const sign = this.ex.restIsHigh ? -1.0 : 1.0;
    const clamp = (/** @type {number} */ x) => pyRound(Math.min(180.0, Math.max(0.0, x)), 1);
    return validate(
      this.ex,
      clamp(restRef + sign * REST_FRACTION * depth),
      clamp(restRef + sign * TARGET_FRACTION * depth),
    );
  }

  /** @returns {CalibrationRecording} */
  status() {
    return { status: "recording", reps: this.reps, needed: this.repsNeeded };
  }
}
