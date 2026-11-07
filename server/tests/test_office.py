"""Office / desk exercise set: geometry helpers, catalog sanity, forgiving rep counting."""

import math

import numpy as np
import pytest

from analysis.exercises import (
    CATALOG, DEFAULT_EXERCISE, EXERCISES, OFFICE_EXERCISES, arm_elevation, ear_height, head_drop,
    head_forward, head_tilt, head_turn, shoulder_tilt,
)
from analysis.geometry import Pose
from analysis.session import RepCounter, Session
from tests import synthetic as syn
from analysis.exercises import AREAS, office_rep_score

FPS = 30


def upper(left_elev=20.0, right_elev=20.0, tilt=0.0, turn=0.0, shoulder_drop=0.0, chin_drop=None, shrug=0.0):
    """Seated, facing the camera. Arm elevation in degrees (0 = hanging, 180 = overhead,
    negative = across the chest). `chin_drop` puts the nose that many degrees below the ears;
    `shrug` lifts both shoulders by that many pixels."""
    sides = {}
    nose_y = 300.0 if chin_drop is None else 280.0 + 60 * math.tan(math.radians(chin_drop))
    for side, sx, out in (("left", 600.0, 1), ("right", 400.0, -1)):
        shoulder = np.array([sx, 400.0 - shrug + (shoulder_drop if side == "left" else 0.0)])
        e = math.radians(left_elev if side == "left" else right_elev)
        wrist = shoulder + 250 * np.array([out * math.sin(e), math.cos(e)])
        t = math.radians(tilt)
        ear = np.array([500.0, 280.0]) + out * 60 * np.array([math.cos(t), math.sin(t)])
        nose = np.array([500.0 + 60 * math.sin(math.radians(turn)), nose_y])
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

def test_forty_office_exercises_with_unique_keys():
    keys = [e.key for e in OFFICE_EXERCISES]
    assert len(keys) == 40 and len(set(keys)) == 40
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
    assert ex.how_to and ex.category in AREAS
    assert ex.stance in ("seated", "standing")
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


@pytest.mark.parametrize("deg", [0, 20, 45])
def test_head_drop(deg):
    assert head_drop(pose(upper(chin_drop=deg))) == pytest.approx(deg, abs=0.1)
    assert head_drop(pose(upper(chin_drop=-20))) == 0  # looking up reads as level


def test_ear_height_shrinks_as_the_shoulders_rise():
    # Ears sit 40 px inside each shoulder and 120 px above it.
    assert ear_height(pose(upper())) == pytest.approx(math.degrees(math.atan2(120, 40)), abs=0.1)
    assert ear_height(pose(upper(shrug=80))) == pytest.approx(45, abs=0.1)


def side_head(forward_deg):
    """Side view: the ear sits 150 px from the shoulder, `forward_deg` in front of straight up."""
    shoulder = np.array([500.0, 400.0])
    a = math.radians(forward_deg)
    ear = shoulder + 150 * np.array([math.sin(a), -math.cos(a)])
    return syn.landmarks({"left": dict(shoulder=shoulder, ear=ear, nose=ear + [40, 10])})


@pytest.mark.parametrize("deg", [0, 8, 20])
def test_head_forward(deg):
    assert head_forward(pose(side_head(deg)), "left") == pytest.approx(deg, abs=0.1)


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


def test_cross_body_stretch_counts_each_arm():
    frames = [upper(left_elev=a, right_elev=0) for a in syn.trajectory(0, -80, 45)]
    frames += [upper(left_elev=0, right_elev=a) for a in syn.trajectory(0, -80, 45)]
    _, summary = run("cross_body_stretch", frames)
    assert summary["reps"] == 2


def test_chin_to_chest_counts_each_nod():
    frames = []
    for _ in range(2):
        frames += [upper(chin_drop=a) for a in syn.trajectory(15, 50, 45)]
    _, summary = run("chin_to_chest", frames)
    assert summary["reps"] == 2 and summary["good_reps"] == 2


def test_shrugs_and_shoulder_rolls_count_each_lift():
    frames = []
    for _ in range(3):
        frames += [upper(shrug=s) for s in syn.trajectory(0, 100, 45)]
    for key in ("shoulder_shrug", "shoulder_roll"):
        _, summary = run(key, frames)
        assert summary["reps"] == 3, key


def test_chin_tuck_counts_each_pull_back():
    frames = []
    for _ in range(2):
        frames += [side_head(a) for a in syn.trajectory(22, 3, 45)]
    _, summary = run("chin_tuck", frames)
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
    "Neck tension": {"neck_tilt", "head_turn", "chin_to_chest", "shoulder_shrug", "chin_tuck"},
    "Rounded shoulders": {"cross_swing", "wy_raise", "shoulder_roll", "thoracic_extension", "clasp_opener"},
    "Upper back": {"seated_row", "t_raise", "desk_punch", "rhomboid_stretch", "desk_row"},
    "Shoulder & rotator cuff": {"scaption", "front_raise", "overhead_reach", "external_rotation",
                                "cross_body_stretch"},
    "Lower back": {"seated_side_bend", "knee_to_chest", "hip_hinge", "standing_side_bend", "back_extension"},
    "Wrist & hand": {"wrist_flex", "extensor_stretch", "flexor_stretch", "prayer_stretch", "nerve_glide"},
    "Knees": {"seated_knee_ext", "heel_slide", "sit_to_stand", "mini_squat", "hamstring_curl"},
    "Eyes": {"palming", "temple_massage", "look_far", "near_far_focus", "eye_track_vertical"},
}


def test_every_office_exercise_sits_in_its_pain_area():
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
