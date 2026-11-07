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

import { EXERCISES, type Exercise } from './exercises';
import { median, pyRound } from './pymath';

export const REPS_NEEDED = 3;
export const REST_FRACTION = 0.25;
export const TARGET_FRACTION = 0.75;
export const RETURN_FRACTION = 0.35;
export const MIN_EXCURSION_FRACTION = 0.25; // of the default rest->target span
export const MIN_EXCURSION_DEG = 3.0;
export const MIN_SPAN_DEG = 3.0; // calibrated rest and target must be at least this far apart

export interface Thresholds {
  readonly rest: number;
  readonly target: number;
}

/**
 * Thresholds from a client, or null if they don't fit this exercise
 * (Python's `calibration.validate`). `ex` may be an Exercise or its key.
 */
export function validate(ex: Exercise | string, rest: unknown, target: unknown): Thresholds | null {
  const exercise = typeof ex === 'string' ? EXERCISES[ex] : ex;
  if (exercise === undefined) throw new Error(`unknown exercise ${JSON.stringify(ex)}`);
  if (typeof rest === 'boolean' || typeof target === 'boolean') return null;
  if (typeof rest !== 'number' || typeof target !== 'number') return null;
  if (!(rest >= 0.0 && rest <= 180.0 && target >= 0.0 && target <= 180.0)) return null;
  const span = exercise.restIsHigh ? rest - target : target - rest;
  if (span < MIN_SPAN_DEG) return null;
  return { rest: pyRound(rest, 1), target: pyRound(target, 1) };
}

/** A copy of the exercise using these thresholds. */
export function apply<E extends Exercise>(ex: E, th: Thresholds): E {
  return ex.withThresholds(th.rest, th.target);
}

export interface CalibrationRecording {
  status: 'recording' | 'failed';
  reps: number;
  needed: number;
}

export interface CalibrationDone {
  status: 'done';
  reps: number;
  needed: number;
  rest: number;
  target: number;
}

export type CalibrationStatus = CalibrationRecording | CalibrationDone;

export class Calibrator {
  readonly ex: Exercise;
  readonly repsNeeded: number;
  readonly restSamples: number[] = [];
  readonly depths: number[] = [];
  private restRef: number | null = null;
  /** Deepest value of the rep in progress, null when resting. */
  private peak: number | null = null;

  constructor(ex: Exercise, repsNeeded: number = REPS_NEEDED) {
    this.ex = ex;
    this.repsNeeded = repsNeeded;
  }

  get minExcursion(): number {
    const span = Math.abs(this.ex.rest - this.ex.target);
    return Math.max(MIN_EXCURSION_DEG, MIN_EXCURSION_FRACTION * span);
  }

  get reps(): number {
    return this.depths.length;
  }

  get done(): boolean {
    return this.reps >= this.repsNeeded;
  }

  /** How far `v` is from rest, towards the target (negative = the other way). */
  private depth(v: number, restRef: number): number {
    return this.ex.restIsHigh ? restRef - v : v - restRef;
  }

  /** Feed one smoothed angle. Returns true when a calibration rep just finished. */
  update(v: number): boolean {
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

  result(): Thresholds | null {
    if (!this.done) return null;
    const restRef = median(this.restSamples);
    const depth = median(this.depths);
    const sign = this.ex.restIsHigh ? -1.0 : 1.0;
    const clamp = (x: number): number => pyRound(Math.min(180.0, Math.max(0.0, x)), 1);
    return validate(
      this.ex,
      clamp(restRef + sign * REST_FRACTION * depth),
      clamp(restRef + sign * TARGET_FRACTION * depth),
    );
  }

  status(): CalibrationRecording {
    return { status: 'recording', reps: this.reps, needed: this.repsNeeded };
  }
}
