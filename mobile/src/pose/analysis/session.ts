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
 * Output objects keep the server's snake_case keys, so a frame result here is
 * the same object the Python server sent over the WebSocket (minus the
 * transport fields `type`, `landmarks`, `mask`, `latency_ms`).
 */

import * as calibration from './calibration';
import { Calibrator, type CalibrationStatus, type Thresholds } from './calibration';
import { EXERCISES, type Exercise, ISSUE_TEXT, type IssueCode } from './exercises';
import { Ema, type Landmark, Pose, type Side, type WorldLandmark } from './geometry';
import { pyRound, pySum } from './pymath';

export const MIN_VISIBILITY = 0.5;
export const SIDE_SWITCH_MARGIN = 0.15;

export type Stage = 'waiting' | 'rest' | 'moving' | 'work';

export interface Rep {
  index: number;
  duration_s: number;
  /** Deepest point reached. */
  peak_angle: number;
  /** Range of motion in degrees. */
  rom: number;
  issues: IssueCode[];
  score: number;
  partial: boolean;
}

export interface RepEvent extends Rep {
  issue_text: string[];
}

export interface TopIssue {
  code: IssueCode;
  count: number;
  text: string;
}

export interface Summary {
  reps: number;
  good_reps: number;
  partial_reps: number;
  avg_duration_s: number | null;
  avg_rom: number | null;
  avg_score: number | null;
  top_issues: TopIssue[];
}

export interface Feedback {
  code: IssueCode;
  text: string;
}

export interface ThresholdsInfo {
  rest: number;
  target: number;
  rest_is_high: boolean;
  calibrated: boolean;
  default_rest: number;
  default_target: number;
}

/** What `Session.process` returns for one frame (Python's frame result dict). */
export interface FrameResult {
  exercise: string;
  side: Side | 'both' | null;
  angle: number | null;
  angle_alt: number | null;
  angle_mode: '2d' | '3d';
  stage: Stage;
  feedback: Feedback[];
  rep_event: RepEvent | null;
  /** Present only while calibrating, and on the frame calibration ends. */
  calibration?: CalibrationStatus;
  summary: Summary;
  thresholds: ThresholdsInfo;
}

interface Cycle {
  startT: number;
  restRef: number;
  extreme: number;
  reachedTarget: boolean;
  /** Per-issue frame counts, in first-seen order (like collections.Counter). */
  issueFrames: Map<IssueCode, number>;
}

export class RepCounter {
  readonly ex: Exercise;
  readonly minIssueFrames: number;
  readonly partialFraction: number;
  stage: Stage = 'waiting';
  readonly reps: Rep[] = [];
  readonly partials: Rep[] = [];
  private restRef: number | null = null;
  private cycle: Cycle | null = null;

  constructor(ex: Exercise, minIssueFrames = 3, partialFraction = 0.4) {
    this.ex = ex;
    this.minIssueFrames = minIssueFrames;
    this.partialFraction = partialFraction;
  }

  private deeper(a: number, b: number): number {
    return this.ex.restIsHigh ? Math.min(a, b) : Math.max(a, b);
  }

  private shallower(a: number, b: number): number {
    return this.ex.restIsHigh ? Math.max(a, b) : Math.min(a, b);
  }

  /** Feed one frame. Returns a Rep when a full or partial rep just finished. */
  update(value: number, issues: readonly IssueCode[], t: number): Rep | null {
    const ex = this.ex;
    if (this.stage === 'waiting') {
      if (ex.atRest(value)) {
        this.stage = 'rest';
        this.restRef = value;
      }
      return null;
    }

    if (this.stage === 'rest') {
      const restRef = this.restRef as number;
      if (ex.atRest(value)) {
        this.restRef = this.shallower(restRef, value);
        return null;
      }
      this.stage = 'moving';
      this.cycle = { startT: t, restRef, extreme: value, reachedTarget: false, issueFrames: new Map() };
    }

    const cyc = this.cycle as Cycle;
    cyc.extreme = this.deeper(cyc.extreme, value);
    for (const issue of new Set(issues)) cyc.issueFrames.set(issue, (cyc.issueFrames.get(issue) ?? 0) + 1);
    if (ex.atTarget(value)) {
      cyc.reachedTarget = true;
      this.stage = 'work';
    }

    if (!ex.atRest(value)) return null;

    // Back in the rest zone: the cycle is over.
    this.stage = 'rest';
    this.restRef = value;
    this.cycle = null;
    const rom = Math.abs(cyc.restRef - cyc.extreme);
    const needed = Math.abs(cyc.restRef - ex.target);
    if (!cyc.reachedTarget && rom < this.partialFraction * needed) {
      return null; // small wobble, not an attempted rep
    }

    const repIssues: IssueCode[] = [...cyc.issueFrames]
      .filter(([, n]) => n >= this.minIssueFrames)
      .map(([i]) => i)
      .sort(compareCodePoints);
    const duration = t - cyc.startT;
    if (duration < ex.minRepSeconds) repIssues.push('too_fast');
    if (!cyc.reachedTarget) repIssues.unshift('not_deep_enough');

    const rep: Rep = {
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

  summary(): Summary {
    const reps = this.reps;
    // collections.Counter over every issue of every rep, then most_common(3):
    // highest count first, ties in first-seen order.
    const issueCounts = new Map<IssueCode, number>();
    for (const r of [...reps, ...this.partials]) {
      for (const i of r.issues) issueCounts.set(i, (issueCounts.get(i) ?? 0) + 1);
    }
    const top = [...issueCounts].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const avg = (xs: number[]): number | null => (xs.length ? pyRound(pySum(xs) / xs.length, 1) : null);
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
function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const notVisible = (): Feedback[] => [{ code: 'not_visible', text: ISSUE_TEXT.not_visible }];

/**
 * All per-user analysis state for one exercise set.
 *
 * `useWorld`: measure angles on MediaPipe's 3D world landmarks instead of the
 * 2D image landmarks (when the frame has them). Each frame also reports the
 * angle from the other mode as `angle_alt`, so the UI can show both.
 */
export class Session {
  useWorld: boolean;
  /** The exercise with its default thresholds. */
  baseExercise!: Exercise;
  /** Calibrated thresholds in use, or null for the defaults. */
  thresholds!: Thresholds | null;
  /** The exercise as counted: `baseExercise` with `thresholds` applied. */
  exercise!: Exercise;
  counter!: RepCounter;
  calibrator: Calibrator | null = null;
  private smooth!: Ema;
  private altSmooth!: Ema;
  private side: Side | null = null;

  /** Defaults match the Python (`Session("squat")`); the app passes DEFAULT_EXERCISE. */
  constructor(exerciseKey = 'squat', useWorld = false) {
    this.useWorld = useWorld;
    this.setExercise(exerciseKey);
  }

  /** Start a new set. `thresholds` replaces the default rest/target (from calibration). */
  setExercise(key: string, thresholds: Thresholds | null = null): void {
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

  reset(): void {
    this.setExercise(this.exercise.key, this.thresholds);
  }

  /** Switch 2D/3D angles. Thresholds are per mode, so this drops any calibration. */
  setAngleMode(useWorld: boolean): void {
    this.useWorld = useWorld;
    this.setExercise(this.exercise.key);
  }

  /** Next reps teach the thresholds; the rep counter pauses until calibration ends. */
  startCalibration(): void {
    this.setExercise(this.exercise.key); // learn from the default exercise, on a fresh set
    this.calibrator = new Calibrator(this.baseExercise);
  }

  cancelCalibration(): void {
    this.calibrator = null;
  }

  private visibility(pose: Pose, side: Side): number {
    return Math.min(...this.exercise.joints.map((j) => pose.vis(side, j)));
  }

  private pickSide(pose: Pose): [Side | 'both', number] {
    if (this.exercise.bilateral) {
      return ['both', Math.min(this.visibility(pose, 'left'), this.visibility(pose, 'right'))];
    }
    const vis: Record<Side, number> = { left: this.visibility(pose, 'left'), right: this.visibility(pose, 'right') };
    const best: Side = vis.right > vis.left ? 'right' : 'left'; // max() keeps the first on ties
    if (this.side === null || vis[best] > vis[this.side] + SIDE_SWITCH_MARGIN) {
      this.side = best;
    }
    return [this.side, vis[this.side]];
  }

  /**
   * Analyse one frame. `t` is a timestamp in seconds; `world` = 3D landmarks
   * (already passed through `alignWorldY`), if any.
   */
  process(
    landmarks: readonly Landmark[] | null | undefined,
    width: number,
    height: number,
    t: number,
    world: readonly WorldLandmark[] | null = null,
  ): FrameResult {
    const ex = this.exercise;
    const hasWorld = world != null;
    const out: Omit<FrameResult, 'summary' | 'thresholds'> & Partial<FrameResult> = {
      exercise: ex.key,
      side: null,
      angle: null,
      angle_alt: null,
      angle_mode: this.useWorld && hasWorld ? '3d' : '2d',
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

    const measureSide: Side = side === 'both' ? 'left' : side;
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
      const rep = this.counter.update(value, m.issues, t);
      if (rep !== null) {
        out.rep_event = { ...rep, issues: [...rep.issues], issue_text: rep.issues.map((c) => ISSUE_TEXT[c]) };
      }
    }
    out.stage = this.counter.stage;
    return this.finish(out);
  }

  private calibrate(value: number, out: Partial<FrameResult>): void {
    const cal = this.calibrator as Calibrator;
    cal.update(value);
    if (!cal.done) return;
    const th = cal.result();
    if (th === null) {
      // range too small to count reps on
      this.calibrator = null;
      out.calibration = { status: 'failed', reps: cal.reps, needed: cal.repsNeeded };
      return;
    }
    this.setExercise(this.exercise.key, th);
    out.calibration = { status: 'done', reps: cal.reps, needed: cal.repsNeeded, rest: th.rest, target: th.target };
  }

  private finish(out: Omit<FrameResult, 'summary' | 'thresholds'> & Partial<FrameResult>): FrameResult {
    if (this.calibrator !== null && !('calibration' in out)) {
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
    return out as FrameResult;
  }
}
