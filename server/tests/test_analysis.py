import random

import numpy as np
import pytest

from analysis.geometry import angle, angle_from_vertical
from analysis.session import Session
from tests import synthetic as syn

FPS = 30


def run(session: Session, frames, start_t: float = 0.0):
    """Feed landmark frames at FPS; return list of frame results."""
    return [session.process(lm, syn.SIZE, syn.SIZE, start_t + i / FPS) for i, lm in enumerate(frames)]


def reps_of(pose_fn, rest, target, n=3, seconds=2.0, **kw):
    frames = []
    for _ in range(n):
        frames += [pose_fn(a, **kw) for a in syn.trajectory(rest, target, int(seconds * FPS))]
    return frames


# --- geometry -------------------------------------------------------------

def test_angle_basics():
    assert angle(np.array([1, 0]), np.array([0, 0]), np.array([0, 1])) == pytest.approx(90)
    assert angle(np.array([-1, 0]), np.array([0, 0]), np.array([1, 0])) == pytest.approx(180)
    assert angle_from_vertical(np.array([0, 0]), np.array([0, -5])) == pytest.approx(0)


@pytest.mark.parametrize("deg", [60, 95, 140, 175])
def test_synthetic_builder_is_exact(deg):
    s = Session("squat")
    out = s.process(syn.squat(deg), syn.SIZE, syn.SIZE, 0)
    assert out["angle"] == pytest.approx(deg, abs=0.2)


# --- squat ----------------------------------------------------------------

def test_squat_counts_clean_reps():
    s = Session("squat")
    results = run(s, reps_of(syn.squat, 172, 80, n=3))
    events = [r["rep_event"] for r in results if r["rep_event"]]
    assert [e["index"] for e in events] == [1, 2, 3]
    assert all(e["issues"] == [] and e["score"] == 100 for e in events)
    summary = results[-1]["summary"]
    assert summary["reps"] == 3 and summary["good_reps"] == 3 and summary["partial_reps"] == 0
    assert summary["avg_rom"] == pytest.approx(92, abs=3)


def test_squat_partial_rep_is_flagged_not_counted():
    s = Session("squat")
    results = run(s, reps_of(syn.squat, 172, 125, n=1))
    ev = [r["rep_event"] for r in results if r["rep_event"]]
    assert len(ev) == 1 and ev[0]["partial"] and ev[0]["issues"][0] == "not_deep_enough"
    assert results[-1]["summary"]["reps"] == 0
    assert results[-1]["summary"]["partial_reps"] == 1


def test_small_wobble_is_ignored():
    s = Session("squat")
    results = run(s, reps_of(syn.squat, 172, 150, n=2))
    assert not any(r["rep_event"] for r in results)


def test_squat_forward_lean_is_attributed_to_rep():
    s = Session("squat")
    results = run(s, reps_of(syn.squat, 172, 80, n=1, lean_deg=60))
    (ev,) = [r["rep_event"] for r in results if r["rep_event"]]
    assert "chest_up" in ev["issues"] and ev["score"] < 100


def test_squat_knees_past_toes():
    s = Session("squat")
    results = run(s, reps_of(syn.squat, 172, 80, n=1, knee_shift=200))
    (ev,) = [r["rep_event"] for r in results if r["rep_event"]]
    assert "knees_past_toes" in ev["issues"]


def test_rushed_rep_is_too_fast():
    s = Session("squat")
    results = run(s, reps_of(syn.squat, 172, 80, n=1, seconds=0.5))
    (ev,) = [r["rep_event"] for r in results if r["rep_event"]]
    assert "too_fast" in ev["issues"]


def test_jitter_at_threshold_does_not_double_count():
    random.seed(1)
    s = Session("squat")
    frames = reps_of(syn.squat, 172, 80, n=2)
    # hover around the rest threshold (160) with landmark noise
    frames += [syn.squat(160 + random.uniform(-4, 4)) for _ in range(60)]
    results = run(s, frames)
    assert results[-1]["summary"]["reps"] == 2


def test_missing_pose_gives_visibility_feedback():
    s = Session("squat")
    out = s.process(None, 640, 480, 0)
    assert out["feedback"][0]["code"] == "not_visible" and out["angle"] is None


def test_low_visibility_side_is_not_used():
    s = Session("squat")
    lms = [(x, y, 0.1) for x, y, _ in syn.squat(170)]
    out = s.process(lms, syn.SIZE, syn.SIZE, 0)
    assert out["feedback"][0]["code"] == "not_visible"


# --- push-up --------------------------------------------------------------

def test_pushup_counts_and_detects_sag_and_pike():
    s = Session("pushup")
    results = run(s, reps_of(syn.pushup, 170, 80, n=2))
    assert results[-1]["summary"]["good_reps"] == 2

    sag = Session("pushup")
    (ev,) = [r["rep_event"] for r in run(sag, reps_of(syn.pushup, 170, 80, n=1, hip_offset=80)) if r["rep_event"]]
    assert "hips_sag" in ev["issues"]

    pike = Session("pushup")
    (ev,) = [r["rep_event"] for r in run(pike, reps_of(syn.pushup, 170, 80, n=1, hip_offset=-120)) if r["rep_event"]]
    assert "hips_pike" in ev["issues"]


def test_pushup_not_counted_when_standing():
    s = Session("pushup")
    results = run(s, reps_of(syn.pushup, 170, 80, n=2, vertical=True))
    assert results[-1]["summary"]["reps"] == 0
    assert results[-1]["feedback"][0]["code"] == "not_plank"


# --- curl -----------------------------------------------------------------

def test_curl_counts_and_detects_elbow_drift():
    s = Session("curl")
    results = run(s, reps_of(syn.curl, 165, 40, n=3))
    assert results[-1]["summary"]["good_reps"] == 3

    drift = Session("curl")
    (ev,) = [r["rep_event"] for r in run(drift, reps_of(syn.curl, 165, 40, n=1, drift_deg=50)) if r["rep_event"]]
    assert "elbow_drift" in ev["issues"]


def test_curl_swinging():
    s = Session("curl")
    (ev,) = [r["rep_event"] for r in run(s, reps_of(syn.curl, 165, 40, n=1, lean_deg=22)) if r["rep_event"]]
    assert "swinging" in ev["issues"]


# --- shoulder press (rest angle is LOW) -----------------------------------

def test_press_counts_reps_with_inverted_direction():
    s = Session("press")
    results = run(s, reps_of(syn.press, 90, 172, n=3))
    assert results[-1]["summary"]["good_reps"] == 3


def test_press_ignores_arms_hanging_down():
    s = Session("press")
    results = run(s, reps_of(syn.press, 90, 172, n=2, arms_down=True))
    assert results[-1]["summary"]["reps"] == 0


def test_press_uneven():
    s = Session("press")
    (ev,) = [r["rep_event"] for r in run(s, reps_of(syn.press, 90, 172, n=1, right_offset=90)) if r["rep_event"]]
    assert "uneven_press" in ev["issues"]


# --- session controls -----------------------------------------------------

def test_reset_and_switch_exercise():
    s = Session("squat")
    run(s, reps_of(syn.squat, 172, 80, n=2))
    s.set_exercise("curl")
    out = s.process(syn.curl(165), syn.SIZE, syn.SIZE, 100)
    assert out["exercise"] == "curl" and out["summary"]["reps"] == 0
    with pytest.raises(ValueError):
        s.set_exercise("burpee")
