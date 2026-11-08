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
 * `Session.process` returns the exact JSON shape the Python server sent
 * (snake_case keys, same key order), since it goes straight to the clients.
 */

import * as calibration from './calibration';
import { Calibrator, type ThresholdsJson, Thresholds } from './calibration';
import { EXERCISES, type Exercise, ISSUE_TEXT, type IssueCode } from './exercises';
import { Ema, type Landmark, Pose, type Side, type WorldLandmark, pyRound, pySum } from './geometry';

export const MIN_VISIBILITY = 0.5;
export const SIDE_SWITCH_MARGIN = 0.15;

export type Stage = 'waiting' | 'rest' | 'moving' | 'work';

export interface Rep {
  index: number;
  durationS: number;
  /** deepest point reached */
  peakAngle: number;
  /** range of motion in degrees */
  rom: number;
  issues: IssueCode[];
  score: number;
  partial: boolean;
}

/** Python's `dataclasses.asdict(rep)`. */
export function repAsDict(rep: Rep): RepDict {
  return {
    index: rep.index,
    duration_s: rep.durationS,
    peak_angle: rep.peakAngle,
    rom: rep.rom,
    issues: [...rep.issues],
    score: rep.score,
    partial: rep.partial,
  };
}

// --- wire format (snake_case, as the clients read it) ----------------------

export type RepDict = {
  index: number;
  duration_s: number;
  peak_angle: number;
  rom: number;
  issues: IssueCode[];
  score: number;
  partial: boolean;
};

export type RepEvent = RepDict & {
  issue_text: string[];
};

export type Feedback = {
  code: IssueCode;
  text: string;
};

export type TopIssue = {
  code: IssueCode;
  count: number;
  text: string;
};

export type Summary = {
  reps: number;
  good_reps: number;
  partial_reps: number;
  avg_duration_s: number | null;
  avg_rom: number | null;
  avg_score: number | null;
  top_issues: TopIssue[];
};

export type CalibrationStatus =
  | calibration.CalibrationRecording
  | { status: 'failed'; reps: number; needed: number }
  | ({ status: 'done'; reps: number; needed: number } & ThresholdsJson);

export type ThresholdsInfo = {
  rest: number;
  target: number;
  rest_is_high: boolean;
  calibrated: boolean;
  default_rest: number;
  default_target: number;
};

export type FrameResult = {
  exercise: string;
  side: Side | 'both' | null;
  angle: number | null;
  angle_alt: number | null;
  angle_mode: '2d' | '3d';
  stage: Stage;
  feedback: Feedback[];
  rep_event: RepEvent | null;
  /** present only while calibrating, or on the frame calibration ends */
  calibration?: CalibrationStatus;
  summary: Summary;
  thresholds: ThresholdsInfo;
};

type FrameDraft = Omit<FrameResult, 'summary' | 'thresholds'>;

interface Cycle {
  startT: number;
  restRef: number;
  extreme: number;
  reachedTarget: boolean;
  issueFrames: Map<IssueCode, number>;
}

export class RepCounter {
  stage: Stage = 'waiting';
  readonly reps: Rep[] = [];
  readonly partials: Rep[] = [];
  private restRef: number | null = null;
  private cycle: Cycle | null = null;

  constructor(
    readonly ex: Exercise,
    readonly minIssueFrames = 3,
    readonly partialFraction = 0.4,
  ) {}

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
      const restRef = this.restRef as number; // always set once out of "waiting"
      if (ex.atRest(value)) {
        this.restRef = this.shallower(restRef, value);
        return null;
      }
      this.stage = 'moving';
      this.cycle = { startT: t, restRef, extreme: value, reachedTarget: false, issueFrames: new Map() };
    }

    const cyc = this.cycle;
    if (cyc === null) throw new Error('RepCounter: no cycle in progress');
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
    if (!cyc.reachedTarget && rom < this.partialFraction * needed) return null; // small wobble, not an attempted rep

    const repIssues = [...cyc.issueFrames]
      .filter(([, n]) => n >= this.minIssueFrames)
      .map(([i]) => i)
      .sort();
    const duration = t - cyc.startT;
    if (duration < ex.minRepSeconds) repIssues.push('too_fast');
    if (!cyc.reachedTarget) repIssues.unshift('not_deep_enough');

    const rep: Rep = {
      index: cyc.reachedTarget ? this.reps.length + 1 : 0,
      durationS: pyRound(duration, 2),
      peakAngle: pyRound(cyc.extreme, 1),
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
    // collections.Counter + most_common(3): by count, ties in first-seen order.
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
      avg_duration_s: avg(reps.map((r) => r.durationS)),
      avg_rom: avg(reps.map((r) => r.rom)),
      avg_score: avg(reps.map((r) => r.score)),
      top_issues: top.map(([code, count]) => ({ code, count, text: ISSUE_TEXT[code] })),
    };
  }
}

export class UnknownExerciseError extends Error {
  constructor(readonly key: string) {
    super(`unknown exercise ${JSON.stringify(key)}`);
    this.name = 'UnknownExerciseError';
  }
}

const notVisible = (): Feedback[] => [{ code: 'not_visible', text: ISSUE_TEXT.not_visible }];

/**
 * All per-user analysis state for one exercise set.
 *
 * `useWorld`: measure angles on the 3D world landmarks instead of the 2D image
 * landmarks (when the frame has them). Each frame also reports the angle from
 * the other mode as `angle_alt`, so the UI can show both.
 */
export class Session {
  useWorld: boolean;
  baseExercise!: Exercise;
  exercise!: Exercise;
  thresholds: Thresholds | null = null;
  counter!: RepCounter;
  smooth!: Ema;
  altSmooth!: Ema;
  side: Side | null = null;
  calibrator: Calibrator | null = null;

  constructor(exerciseKey = 'squat', useWorld = false) {
    this.useWorld = useWorld;
    this.setExercise(exerciseKey);
  }

  /** Start a new set. `thresholds` replaces the default rest/target (from calibration). */
  setExercise(key: string, thresholds: Thresholds | null = null): void {
    const base = EXERCISES.get(key);
    if (base === undefined) throw new UnknownExerciseError(key);
    this.baseExercise = base;
    this.thresholds = thresholds;
    this.exercise = thresholds ? calibration.apply(base, thresholds) : base;
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
    const joints = this.exercise.joints;
    if (joints.length === 0) throw new RangeError('min() arg is an empty sequence');
    return Math.min(...joints.map((j) => pose.vis(side, j)));
  }

  private pickSide(pose: Pose): [Side | 'both', number] {
    if (this.exercise.bilateral) {
      return ['both', Math.min(this.visibility(pose, 'left'), this.visibility(pose, 'right'))];
    }
    const vis: Record<Side, number> = { left: this.visibility(pose, 'left'), right: this.visibility(pose, 'right') };
    const best: Side = vis.right > vis.left ? 'right' : 'left'; // Python's max() keeps the first on ties
    if (this.side === null || vis[best] > vis[this.side] + SIDE_SWITCH_MARGIN) this.side = best;
    return [this.side, vis[this.side]];
  }

  /** Analyse one frame. `t` is a timestamp in seconds; `world` = 3D landmarks, if any. */
  process(
    landmarks: ReadonlyArray<Landmark> | null,
    width: number,
    height: number,
    t: number,
    world: ReadonlyArray<WorldLandmark> | null = null,
  ): FrameResult {
    const ex = this.exercise;
    const out: FrameDraft = {
      exercise: ex.key,
      side: null,
      angle: null,
      angle_alt: null,
      angle_mode: this.useWorld && world !== null ? '3d' : '2d',
      stage: this.counter.stage,
      feedback: [],
      rep_event: null,
    };
    if (landmarks === null) {
      this.smooth.reset();
      this.altSmooth.reset();
      out.feedback = notVisible();
      return this.finish(out);
    }

    const pose = new Pose(landmarks, width, height, world, this.useWorld);
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
    if (world !== null) {
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
        out.rep_event = { ...repAsDict(rep), issue_text: rep.issues.map((c) => ISSUE_TEXT[c]) };
      }
    }
    out.stage = this.counter.stage;
    return this.finish(out);
  }

  private calibrate(value: number, out: FrameDraft): void {
    const cal = this.calibrator;
    if (cal === null) return;
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
    out.calibration = { status: 'done', reps: cal.reps, needed: cal.repsNeeded, ...th.toJson() };
  }

  private finish(out: FrameDraft): FrameResult {
    if (this.calibrator !== null && !('calibration' in out)) out.calibration = this.calibrator.status();
    out.stage = this.counter.stage;
    return Object.assign(out, {
      summary: this.counter.summary(),
      thresholds: {
        rest: this.exercise.rest,
        target: this.exercise.target,
        rest_is_high: this.exercise.restIsHigh,
        calibrated: this.thresholds !== null,
        default_rest: this.baseExercise.rest,
        default_target: this.baseExercise.target,
      },
    });
  }
}
