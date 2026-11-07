"""Rep counting and per-session movement analysis.

RepCounter is a small state machine over the exercise's primary angle:

    rest --(leaves rest zone)--> moving --(reaches target)--> work
      ^                            |                           |
      +---- back in rest: partial -+---- back in rest: rep ----+

Form issues are tallied per frame while a rep is in progress; an issue is
attributed to the rep only if it was seen in at least `min_issue_frames`
frames, which filters single-frame landmark glitches.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import asdict, dataclass, field
from typing import Sequence

from . import calibration
from .calibration import Calibrator, Thresholds
from .exercises import EXERCISES, ISSUE_TEXT, Exercise
from .geometry import Ema, Landmark, Pose, WorldLandmark

MIN_VISIBILITY = 0.5
SIDE_SWITCH_MARGIN = 0.15


@dataclass
class Rep:
    index: int
    duration_s: float
    peak_angle: float          # deepest point reached
    rom: float                 # range of motion in degrees
    issues: list[str]
    score: int
    partial: bool = False


@dataclass
class _Cycle:
    start_t: float
    rest_ref: float
    extreme: float
    reached_target: bool = False
    issue_frames: Counter = field(default_factory=Counter)


class RepCounter:
    def __init__(self, ex: Exercise, min_issue_frames: int = 3, partial_fraction: float = 0.4):
        self.ex = ex
        self.min_issue_frames = min_issue_frames
        self.partial_fraction = partial_fraction
        self.stage: str = "waiting"  # waiting | rest | moving | work
        self.reps: list[Rep] = []
        self.partials: list[Rep] = []
        self._rest_ref: float | None = None
        self._cycle: _Cycle | None = None

    def _deeper(self, a: float, b: float) -> float:
        return min(a, b) if self.ex.rest_is_high else max(a, b)

    def _shallower(self, a: float, b: float) -> float:
        return max(a, b) if self.ex.rest_is_high else min(a, b)

    def update(self, value: float, issues: Sequence[str], t: float) -> Rep | None:
        """Feed one frame. Returns a Rep when a full or partial rep just finished."""
        ex = self.ex
        if self.stage == "waiting":
            if ex.at_rest(value):
                self.stage, self._rest_ref = "rest", value
            return None

        if self.stage == "rest":
            if ex.at_rest(value):
                self._rest_ref = self._shallower(self._rest_ref, value)
                return None
            self.stage = "moving"
            self._cycle = _Cycle(start_t=t, rest_ref=self._rest_ref, extreme=value)

        cyc = self._cycle
        assert cyc is not None
        cyc.extreme = self._deeper(cyc.extreme, value)
        cyc.issue_frames.update(set(issues))
        if ex.at_target(value):
            cyc.reached_target = True
            self.stage = "work"

        if not ex.at_rest(value):
            return None

        # Back in the rest zone: the cycle is over.
        self.stage, self._rest_ref, self._cycle = "rest", value, None
        rom = abs(cyc.rest_ref - cyc.extreme)
        needed = abs(cyc.rest_ref - ex.target)
        if not cyc.reached_target and rom < self.partial_fraction * needed:
            return None  # small wobble, not an attempted rep

        rep_issues = sorted(i for i, n in cyc.issue_frames.items() if n >= self.min_issue_frames)
        duration = t - cyc.start_t
        if duration < ex.min_rep_seconds:
            rep_issues.append("too_fast")
        if not cyc.reached_target:
            rep_issues.insert(0, "not_deep_enough")

        rep = Rep(
            index=len(self.reps) + 1 if cyc.reached_target else 0,
            duration_s=round(duration, 2),
            peak_angle=round(cyc.extreme, 1),
            rom=round(rom, 1),
            issues=rep_issues,
            score=ex.rep_score(rom, needed, duration, rep_issues),
            partial=not cyc.reached_target,
        )
        (self.reps if cyc.reached_target else self.partials).append(rep)
        return rep

    def summary(self) -> dict:
        reps = self.reps
        issue_counts = Counter(i for r in reps + self.partials for i in r.issues)
        avg = lambda xs: round(sum(xs) / len(xs), 1) if xs else None  # noqa: E731
        return {
            "reps": len(reps),
            "good_reps": sum(1 for r in reps if not r.issues),
            "partial_reps": len(self.partials),
            "avg_duration_s": avg([r.duration_s for r in reps]),
            "avg_rom": avg([r.rom for r in reps]),
            "avg_score": avg([r.score for r in reps]),
            "top_issues": [
                {"code": c, "count": n, "text": ISSUE_TEXT[c]} for c, n in issue_counts.most_common(3)
            ],
        }


class Session:
    """All per-user analysis state for one exercise set.

    `use_world`: measure angles on MediaPipe's 3D world landmarks instead of
    the 2D image landmarks (when the frame has them). Each frame also reports
    the angle from the other mode as `angle_alt`, so the UI can show both.
    """

    def __init__(self, exercise_key: str = "squat", use_world: bool = False):
        self.use_world = use_world
        self.set_exercise(exercise_key)

    def set_exercise(self, key: str, thresholds: Thresholds | None = None) -> None:
        """Start a new set. `thresholds` replaces the default rest/target (from calibration)."""
        if key not in EXERCISES:
            raise ValueError(f"unknown exercise {key!r}")
        self.base_exercise = EXERCISES[key]
        self.thresholds = thresholds
        self.exercise = calibration.apply(self.base_exercise, thresholds) if thresholds else self.base_exercise
        self.counter = RepCounter(self.exercise)
        self.smooth = Ema(0.5)
        self.alt_smooth = Ema(0.5)
        self.side: str | None = None
        self.calibrator: Calibrator | None = None

    def reset(self) -> None:
        self.set_exercise(self.exercise.key, self.thresholds)

    def set_angle_mode(self, use_world: bool) -> None:
        """Switch 2D/3D angles. Thresholds are per mode, so this drops any calibration."""
        self.use_world = use_world
        self.set_exercise(self.exercise.key)

    def start_calibration(self) -> None:
        """Next reps teach the thresholds; the rep counter pauses until calibration ends."""
        self.set_exercise(self.exercise.key)  # learn from the default exercise, on a fresh set
        self.calibrator = Calibrator(self.base_exercise)

    def cancel_calibration(self) -> None:
        self.calibrator = None

    def _visibility(self, pose: Pose, side: str) -> float:
        return min(pose.vis(side, j) for j in self.exercise.joints)

    def _pick_side(self, pose: Pose) -> tuple[str, float]:
        if self.exercise.bilateral:
            return "both", min(self._visibility(pose, "left"), self._visibility(pose, "right"))
        vis = {s: self._visibility(pose, s) for s in ("left", "right")}
        best = max(vis, key=vis.get)
        if self.side is None or vis[best] > vis[self.side] + SIDE_SWITCH_MARGIN:
            self.side = best
        return self.side, vis[self.side]

    def process(
        self,
        landmarks: Sequence[Landmark] | None,
        width: int,
        height: int,
        t: float,
        world: Sequence[WorldLandmark] | None = None,
    ) -> dict:
        """Analyse one frame. `t` is a timestamp in seconds; `world` = 3D landmarks, if any."""
        ex = self.exercise
        out = {
            "exercise": ex.key,
            "side": None,
            "angle": None,
            "angle_alt": None,
            "angle_mode": "3d" if self.use_world and world is not None else "2d",
            "stage": self.counter.stage,
            "feedback": [],
            "rep_event": None,
        }
        if landmarks is None:
            self.smooth.reset()
            self.alt_smooth.reset()
            out["feedback"] = [{"code": "not_visible", "text": ISSUE_TEXT["not_visible"]}]
            return self._finish(out)

        pose = Pose(landmarks, width, height, world, use_world=self.use_world)
        side, vis = self._pick_side(pose)
        out["side"] = side
        if vis < MIN_VISIBILITY:
            self.smooth.reset()
            self.alt_smooth.reset()
            out["feedback"] = [{"code": "not_visible", "text": ISSUE_TEXT["not_visible"]}]
            return self._finish(out)

        measure_side = "left" if side == "both" else side
        m = ex.measure(pose, measure_side)
        value = self.smooth(m.value)
        out["angle"] = round(value, 1)
        if world is not None:  # same angle measured the other way (2D vs 3D), for comparison
            other = Pose(landmarks, width, height, world, use_world=not self.use_world)
            out["angle_alt"] = round(self.alt_smooth(ex.measure(other, measure_side).value), 1)
        out["feedback"] = [{"code": c, "text": ISSUE_TEXT[c]} for c in m.issues]
        if self.calibrator is not None:
            if m.valid:
                self._calibrate(value, out)
        elif m.valid:
            rep = self.counter.update(value, m.issues, t)
            if rep is not None:
                out["rep_event"] = asdict(rep) | {
                    "issue_text": [ISSUE_TEXT[c] for c in rep.issues],
                }
        out["stage"] = self.counter.stage
        return self._finish(out)

    def _calibrate(self, value: float, out: dict) -> None:
        cal = self.calibrator
        assert cal is not None
        cal.update(value)
        if not cal.done:
            return
        th = cal.result()
        if th is None:  # range too small to count reps on
            self.calibrator = None
            out["calibration"] = {"status": "failed", "reps": cal.reps, "needed": cal.reps_needed}
            return
        self.set_exercise(self.exercise.key, th)
        out["calibration"] = {"status": "done", "reps": cal.reps, "needed": cal.reps_needed, **th.to_json()}

    def _finish(self, out: dict) -> dict:
        if self.calibrator is not None and "calibration" not in out:
            out["calibration"] = self.calibrator.status()
        out["stage"] = self.counter.stage
        out["summary"] = self.counter.summary()
        out["thresholds"] = {
            "rest": self.exercise.rest,
            "target": self.exercise.target,
            "rest_is_high": self.exercise.rest_is_high,
            "calibrated": self.thresholds is not None,
            "default_rest": self.base_exercise.rest,
            "default_target": self.base_exercise.target,
        }
        return out
