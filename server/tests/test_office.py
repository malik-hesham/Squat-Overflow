"""Office / desk exercise set: geometry helpers, catalog sanity, forgiving rep counting."""

import math

import numpy as np
import pytest

from analysis.exercises import (
    CATALOG, DEFAULT_EXERCISE, EXERCISES, OFFICE_EXERCISES, arm_elevation, head_tilt, head_turn,
    shoulder_tilt,
)
from analysis.geometry import Pose
from analysis.session import RepCounter, Session
from tests import synthetic as syn
from analysis.exercises import AREAS, office_rep_score

FPS = 30


def upper(left_elev=20.0, right_elev=20.0, tilt=0.0, turn=0.0, shoulder_drop=0.0):
    """Seated, facing the camera. Arm elevation in degrees (0 = hanging, 180 = overhead)."""
    sides = {}
    for side, sx, out in (("left", 600.0, 1), ("right", 400.0, -1)):
        shoulder = np.array([sx, 400.0 + (shoulder_drop if side == "left" else 0.0)])
        e = math.radians(left_elev if side == "left" else right_elev)
        wrist = shoulder + 250 * np.array([out * math.sin(e), math.cos(e)])
        t = math.radians(tilt)
        ear = np.array([500.0, 280.0]) + out * 60 * np.array([math.cos(t), math.sin(t)])
        nose = np.array([500.0 + 60 * math.sin(math.radians(turn)), 300.0])
        sides[side] = dict(nose=nose, ear=ear, shoulder=shoulder, elbow=(shoulder + wrist) / 2,
                           wrist=wrist, hip=shoulder + [0, 300], knee=shoulder + [0, 450],
                           ankle=shoulder + [0, 640])
    return syn.landmarks(sides)


def pose(lms):
    return Pose(lms, syn.SIZE, syn.SIZE)


def run(key, frames):
    s = Session(key)
    results = [s.process(lm, syn.SIZE, syn.SIZE, i / FPS) for i, lm in enumerate(frames)]
    return [r["rep_event"] for r in results if r["rep_event"]], results[-1]["summary"]


# --- catalog --------------------------------------------------------------

def test_about_thirty_office_exercises_with_unique_keys():
    keys = [e.key for e in OFFICE_EXERCISES]
    assert len(keys) == 30 and len(set(keys)) == 30
    assert all(EXERCISES[k] is e for k, e in zip(keys, OFFICE_EXERCISES))


def test_catalog_offers_only_the_office_set():
    assert list(CATALOG.values()) == list(OFFICE_EXERCISES)
    assert DEFAULT_EXERCISE == OFFICE_EXERCISES[0].key
    assert all(e.category != "Workout" for e in CATALOG.values())


@pytest.mark.parametrize("ex", OFFICE_EXERCISES, ids=lambda e: e.key)
def test_office_exercise_is_well_formed(ex):
    assert 0 <= min(ex.rest, ex.target) and max(ex.rest, ex.target) <= 180  # fits the 0..180 chart
    assert abs(ex.rest - ex.target) >= 7       # enough hysteresis that jitter can't count a rep
    assert ex.rest_is_high == (ex.rest > ex.target)
    assert ex.camera in ("front", "side") and ex.bilateral == (ex.camera == "front")
    assert ex.how_to and ex.category != "Workout"
    assert ex.min_rep_seconds <= 0.5


# --- geometry helpers -----------------------------------------------------

@pytest.mark.parametrize("deg", [0, 45, 90, 135, 180])
def test_arm_elevation(deg):
    p = pose(upper(left_elev=deg))
    assert arm_elevation(p, "left") == pytest.approx(deg, abs=0.1)


@pytest.mark.parametrize("deg", [0, 10, 25])
def test_head_tilt_and_turn(deg):
    assert head_tilt(pose(upper(tilt=deg))) == pytest.approx(deg, abs=0.1)
    assert head_tilt(pose(upper(tilt=-deg))) == pytest.approx(deg, abs=0.1)
    assert head_turn(pose(upper(turn=deg))) == pytest.approx(deg, abs=0.1)


def test_shoulder_tilt():
    assert shoulder_tilt(pose(upper(shoulder_drop=200 * math.tan(math.radians(12))))) == pytest.approx(12, abs=0.1)


# --- end-to-end counting --------------------------------------------------

def test_neck_tilt_counts_each_side():
    frames = [upper(tilt=a) for a in syn.trajectory(0, 25, 45)]
    frames += [upper(tilt=a) for a in syn.trajectory(0, -25, 45)]
    events, summary = run("neck_tilt", frames)
    assert summary["reps"] == 2 and all(e["issues"] == [] for e in events)


def test_overhead_reach_counts_both_arms_together():
    frames = []
    for _ in range(3):
        frames += [upper(left_elev=a, right_elev=a) for a in syn.trajectory(20, 160, 45)]
    _, summary = run("overhead_reach", frames)
    assert summary["reps"] == 3 and summary["good_reps"] == 3


def test_alternating_reach_counts_each_arm():
    frames = [upper(left_elev=a) for a in syn.trajectory(20, 160, 45)]
    frames += [upper(right_elev=a) for a in syn.trajectory(20, 160, 45)]
    _, summary = run("alt_reach", frames)
    assert summary["reps"] == 2


def test_sit_to_stand_uses_knee_angle():
    frames = []
    for _ in range(2):
        frames += [syn.squat(a) for a in syn.trajectory(172, 95, 60)]
    _, summary = run("sit_to_stand", frames)
    assert summary["reps"] == 2 and summary["good_reps"] == 2


# --- forgiving by design --------------------------------------------------

def _counter_run(ex, values, fps=FPS):
    rc = RepCounter(ex)
    return [r for i, v in enumerate(values) if (r := rc.update(v, [], i / fps))]


@pytest.mark.parametrize("ex", OFFICE_EXERCISES, ids=lambda e: e.key)
def test_relaxed_rep_that_just_reaches_target_scores_well_but_not_full(ex):
    step = 1 if ex.target > ex.rest else -1
    relaxed, just_past = ex.rest - 5 * step, ex.target + 2 * step
    (rep,) = _counter_run(ex, syn.trajectory(relaxed, just_past, 2 * FPS))
    assert not rep.partial and rep.issues == [] and 70 <= rep.score < 100


@pytest.mark.parametrize("ex", OFFICE_EXERCISES, ids=lambda e: e.key)
def test_fidgeting_at_rest_is_not_a_rep(ex):
    step = 1 if ex.target > ex.rest else -1
    relaxed = ex.rest - 5 * step
    rng = np.random.default_rng(0)
    values = relaxed + rng.uniform(-3, 3, 10 * FPS)
    assert _counter_run(ex, values) == []


AREA_MAP = {
    "Neck": {"neck_tilt", "head_turn"},
    "Shoulders": {"overhead_reach", "alt_reach", "t_raise", "front_raise"},
    "Upper back & posture": {"seated_row", "cross_swing", "desk_punch", "desk_pushup"},
    "Arms & wrists": {"wrist_flex", "air_curl", "triceps_reach", "chair_dip"},
    "Lower back & core": {"seated_side_bend", "seated_lean_back", "standing_side_bend", "hip_hinge"},
    "Hips & glutes": {"sit_to_stand", "mini_squat", "side_leg_raise", "reverse_lunge", "leg_swing"},
    "Legs & circulation": {"seated_knee_ext", "seated_knee_lift", "seated_heel_raise", "calf_raise",
                           "march", "hamstring_curl", "step_jack"},
}


def test_every_office_exercise_sits_in_its_muscle_area():
    assert list(AREAS) == list(AREA_MAP)
    for area, keys in AREA_MAP.items():
        assert {e.key for e in OFFICE_EXERCISES if e.category == area} == keys


@pytest.mark.parametrize("rom,needed,duration,expected", [
    (50, 50, 1.5, 70),
    (65, 50, 1.5, 100),
    (20, 50, 1.5, 0),
    (35, 50, 1.5, 35),
    (65, 50, 0.4, 70),
    (65, 50, 0.8, 85),
    (200, 50, 1.5, 100),
    (5, 50, 0.2, 0),
])
def test_office_rep_score(rom, needed, duration, expected):
    assert office_rep_score(rom, needed, duration) == expected


@pytest.mark.parametrize("ex", OFFICE_EXERCISES, ids=lambda e: e.key)
def test_partial_office_rep_scores_below_a_full_one(ex):
    step = 1 if ex.target > ex.rest else -1
    relaxed = ex.rest - 5 * step
    halfway = relaxed + (ex.target - relaxed) * 0.7
    (rep,) = _counter_run(ex, syn.trajectory(relaxed, halfway, 2 * FPS))
    assert rep.partial and rep.score < 70
