"""Per-user calibration: learn rest and target thresholds from 3 comfortable reps.

The default thresholds are hand-tuned for an average body. During calibration
the user does a few reps through *their* comfortable range; we watch the
exercise's primary angle (already smoothed by the session) and record, for
each rep, where it started (rest) and how far it went (depth). The new
thresholds sit inside that range, so a normal rep for this person counts:

    rest   = rest_ref + REST_FRACTION   * depth   (towards the target side)
    target = rest_ref + TARGET_FRACTION * depth

Reps are segmented without thresholds: a rep starts when the angle leaves the
resting value by more than `min_excursion`, and ends when it comes back within
RETURN_FRACTION of that rep's own depth. The direction of a rep (angle grows or
shrinks) comes from the exercise.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from statistics import median

from .exercises import Exercise

REPS_NEEDED = 3
REST_FRACTION = 0.25
TARGET_FRACTION = 0.75
RETURN_FRACTION = 0.35
MIN_EXCURSION_FRACTION = 0.25  # of the default rest->target span
MIN_EXCURSION_DEG = 3.0
MIN_SPAN_DEG = 3.0  # calibrated rest and target must be at least this far apart


@dataclass(frozen=True)
class Thresholds:
    rest: float
    target: float

    def to_json(self) -> dict:
        return {"rest": self.rest, "target": self.target}


def validate(ex: Exercise, rest: object, target: object) -> Thresholds | None:
    """Thresholds from a client, or None if they don't fit this exercise."""
    if isinstance(rest, bool) or isinstance(target, bool):
        return None
    if not isinstance(rest, (int, float)) or not isinstance(target, (int, float)):
        return None
    rest, target = float(rest), float(target)
    if not (0.0 <= rest <= 180.0 and 0.0 <= target <= 180.0):
        return None
    span = rest - target if ex.rest_is_high else target - rest
    if span < MIN_SPAN_DEG:
        return None
    return Thresholds(round(rest, 1), round(target, 1))


def apply(ex: Exercise, th: Thresholds) -> Exercise:
    """A copy of the exercise using these thresholds."""
    return replace(ex, rest=th.rest, target=th.target)


@dataclass
class Calibrator:
    ex: Exercise
    reps_needed: int = REPS_NEEDED
    rest_samples: list[float] = field(default_factory=list)
    depths: list[float] = field(default_factory=list)
    _rest_ref: float | None = None
    _peak: float | None = None  # deepest value of the rep in progress, None when resting

    @property
    def min_excursion(self) -> float:
        span = abs(self.ex.rest - self.ex.target)
        return max(MIN_EXCURSION_DEG, MIN_EXCURSION_FRACTION * span)

    @property
    def reps(self) -> int:
        return len(self.depths)

    @property
    def done(self) -> bool:
        return self.reps >= self.reps_needed

    def _depth(self, v: float) -> float:
        """How far `v` is from rest, towards the target (negative = the other way)."""
        assert self._rest_ref is not None
        return self._rest_ref - v if self.ex.rest_is_high else v - self._rest_ref

    def update(self, v: float) -> bool:
        """Feed one smoothed angle. Returns True when a calibration rep just finished."""
        if self.done:
            return False
        if self._rest_ref is None:
            self._rest_ref = v
            return False
        depth = self._depth(v)
        if self._peak is None:  # resting
            if depth < 0:  # even further from the target: that's the real rest position
                self._rest_ref = v
            elif depth > self.min_excursion:
                self._peak = depth
            return False
        self._peak = max(self._peak, depth)
        if depth > RETURN_FRACTION * self._peak:
            return False
        self.rest_samples.append(self._rest_ref)
        self.depths.append(self._peak)
        self._rest_ref, self._peak = v, None
        return True

    def result(self) -> Thresholds | None:
        if not self.done:
            return None
        rest_ref, depth = median(self.rest_samples), median(self.depths)
        sign = -1.0 if self.ex.rest_is_high else 1.0
        clamp = lambda x: round(min(180.0, max(0.0, x)), 1)  # noqa: E731
        return validate(
            self.ex,
            clamp(rest_ref + sign * REST_FRACTION * depth),
            clamp(rest_ref + sign * TARGET_FRACTION * depth),
        )

    def status(self) -> dict:
        return {"status": "recording", "reps": self.reps, "needed": self.reps_needed}
