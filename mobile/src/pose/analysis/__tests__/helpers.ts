/** Shared test helpers: fixture loading, a tolerant deep diff, and the session replay. */

import { Session } from '../session';

// Node built-ins, typed locally: the app's tsconfig loads only jest types, and
// this is the one test module that reads files (jest runs it under Node).
declare const require: (id: 'fs' | 'path') => unknown;
declare const __dirname: string;
const fs = require('fs') as {
  readFileSync(file: string, encoding: 'utf8'): string;
  readdirSync(dir: string): string[];
};
const path = require('path') as { join(...parts: string[]): string };

export const FIXTURES = path.join(__dirname, 'fixtures');
export const FLOAT_TOLERANCE = 1e-6;

export function loadFixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8')) as T;
}

export function fixtureNames(prefix: string): string[] {
  return fs
    .readdirSync(FIXTURES)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .sort();
}

/**
 * Differences between `actual` and `expected` (Python's JSON): numbers within
 * `tol`, everything else exact, objects must have exactly the same keys.
 */
export function diff(actual: unknown, expected: unknown, tol = FLOAT_TOLERANCE, where = '$', out: string[] = []): string[] {
  const show = (v: unknown): string => JSON.stringify(v) ?? String(v);
  if (typeof expected === 'number') {
    if (typeof actual !== 'number' || !(Math.abs(actual - expected) <= tol)) {
      out.push(`${where}: got ${show(actual)}, Python ${show(expected)}`);
    }
    return out;
  }
  if (expected === null || typeof expected !== 'object') {
    if (actual !== expected) out.push(`${where}: got ${show(actual)}, Python ${show(expected)}`);
    return out;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      out.push(`${where}: got ${show(actual)}, Python ${show(expected)}`);
      return out;
    }
    expected.forEach((e, i) => diff(actual[i], e, tol, `${where}[${i}]`, out));
    return out;
  }
  if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) {
    out.push(`${where}: got ${show(actual)}, Python ${show(expected)}`);
    return out;
  }
  const a = actual as Record<string, unknown>;
  const e = expected as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(e)]);
  for (const k of keys) {
    if (!(k in e)) out.push(`${where}.${k}: unexpected key (value ${show(a[k])})`);
    else if (!(k in a)) out.push(`${where}.${k}: missing (Python ${show(e[k])})`);
    else diff(a[k], e[k], tol, `${where}.${k}`, out);
  }
  return out;
}

// --- session fixtures --------------------------------------------------------

type Point = number[];

type Op =
  | { op: 'new'; exercise: string; use_world: boolean }
  | { op: 'set_exercise'; exercise: string; thresholds: { rest: number; target: number } | null }
  | { op: 'reset' }
  | { op: 'angle_mode'; use_world: boolean }
  | { op: 'calibrate'; action: 'start' | 'cancel' };

interface FrameStep {
  t: number;
  lm: Point[] | null;
  w?: Point[];
  out: Record<string, unknown>;
  gone?: string[];
}

export interface Scenario {
  name: string;
  width: number;
  height: number;
  steps: (Op | FrameStep)[];
}

export interface SessionFixture {
  exercise: string;
  scenarios: Scenario[];
}

export interface ReplayResult {
  frames: number;
  repEvents: number;
  /** Mismatches, first few only, each prefixed with the frame number. */
  mismatches: string[];
}

/** Fixture coordinates are integers in units of 1e-5 (see gen_pose_fixtures.py). */
const SCALE = 100000;

/**
 * Apply a delta ([i, x, y] or [i, x, y, v], coordinates in 1e-5 units) to the
 * previous points; returns a new array so earlier frames are never mutated.
 */
function applyDelta(prev: readonly Point[], changes: readonly Point[]): Point[] {
  const next = prev.slice();
  for (const [i, ...raw] of changes) {
    const values = raw.map((v) => v / SCALE);
    next[i] = values.length === prev[i]?.length ? values : [...values, ...(prev[i] ?? []).slice(values.length)];
  }
  return next;
}

/** Replay one scenario through the TS Session and compare every frame with Python's output. */
export function replay(scenario: Scenario, maxMismatches = 20): ReplayResult {
  let session: Session | null = null;
  let landmarks: Point[] = [];
  let world: Point[] = [];
  let expected: Record<string, unknown> = {};
  const mismatches: string[] = [];
  let frames = 0;
  let repEvents = 0;
  scenario.steps.forEach((step, n) => {
    if ('op' in step) {
      switch (step.op) {
        case 'new':
          session = new Session(step.exercise, step.use_world);
          break;
        case 'set_exercise':
          session!.setExercise(step.exercise, step.thresholds);
          break;
        case 'reset':
          session!.reset();
          break;
        case 'angle_mode':
          session!.setAngleMode(step.use_world);
          break;
        case 'calibrate':
          if (step.action === 'start') session!.startCalibration();
          else session!.cancelCalibration();
          break;
      }
      return;
    }
    frames++;
    let lmArg: Point[] | null = null;
    if (step.lm !== null) {
      landmarks = applyDelta(landmarks, step.lm);
      lmArg = landmarks;
    }
    let worldArg: Point[] | null = null;
    if (step.w !== undefined) {
      world = applyDelta(world, step.w);
      worldArg = world;
    }
    const actual = session!.process(lmArg, scenario.width, scenario.height, step.t, worldArg);
    expected = { ...expected, ...step.out };
    for (const k of step.gone ?? []) delete expected[k];
    if (expected.rep_event) repEvents++;
    if (mismatches.length < maxMismatches) {
      for (const d of diff(actual, expected)) {
        if (mismatches.length < maxMismatches) mismatches.push(`step ${n} (t=${step.t}): ${d}`);
      }
    }
  });
  return { frames, repEvents, mismatches };
}
