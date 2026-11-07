"""3D world-landmark angles and per-user calibration."""

import math

import numpy as np
import pytest

from analysis import calibration
from analysis.calibration import Calibrator, Thresholds
from analysis.exercises import EXERCISES
from analysis.geometry import angle_from_horizontal, angle_from_vertical
from analysis.session import Session
from tests import synthetic as syn

FPS = 15


def test_geometry_helpers_work_in_3d():
    o = np.zeros(3)
    assert angle_from_vertical(o, np.array([0.0, -1.0, 0.0])) == pytest.approx(0)
    assert angle_from_vertical(o, np.array([0.0, 0.0, 1.0])) == pytest.approx(90)  # towards the camera
    # A line going away from the camera is horizontal, even though it's vertical-free in x.
    assert angle_from_horizontal(o, np.array([0.0, 0.0, 1.0])) == pytest.approx(0)
    assert angle_from_horizontal(o, np.array([1.0, -1.0, 0.0])) == pytest.approx(45)
    assert angle_from_horizontal(np.zeros(2), np.array([1.0, 1.0])) == pytest.approx(45)  # 2D unchanged


def front_squat_frames(low: float, reps: int = 3, frames: int = 30):
    out = []
    for _ in range(reps):
        out += [syn.turn_to_camera(syn.squat(d)) for d in syn.trajectory(170, low, frames)]
    return out


def run(session: Session, frames, start_t: float = 0.0):
    return [session.process(img, syn.SIZE, syn.SIZE, start_t + i / FPS, world)
            for i, (img, world) in enumerate(frames)]


def test_3d_counts_a_squat_filmed_from_the_front_where_2d_cannot():
    frames = front_squat_frames(low=95)

    flat = run(Session("sit_to_stand"), frames)
    assert flat[-1]["summary"]["reps"] == 0  # 2D sees a straight leg the whole time
    assert min(r["angle"] for r in flat) > 170
    assert flat[0]["angle_mode"] == "2d"

    deep = run(Session("sit_to_stand", use_world=True), frames)
    assert deep[-1]["summary"]["reps"] == 3
    assert deep[0]["angle_mode"] == "3d"
    assert min(r["angle"] for r in deep) < 110
    # The other mode's reading travels along for the UI's comparison line.
    assert min(r["angle_alt"] for r in deep) > 170


def test_without_world_landmarks_3d_mode_falls_back_to_2d():
    s = Session("sit_to_stand", use_world=True)
    out = s.process(syn.squat(100), syn.SIZE, syn.SIZE, 0)
    assert out["angle_mode"] == "2d" and out["angle_alt"] is None
    assert out["angle"] == pytest.approx(100, abs=1)


def test_switching_angle_mode_drops_calibration():
    s = Session("sit_to_stand")
    s.set_exercise("sit_to_stand", Thresholds(150, 125))
    s.set_angle_mode(True)
    assert s.use_world and s.thresholds is None and s.exercise.rest == 155


# --- calibration ---------------------------------------------------------------

def side_squats(low: float, high: float = 170, reps: int = 3, frames: int = 30):
    out = []
    for _ in range(reps):
        out += [syn.squat(d) for d in syn.trajectory(high, low, frames)]
    return out


def feed(s: Session, frames, start_t: float = 0.0):
    return [s.process(lm, syn.SIZE, syn.SIZE, start_t + i / FPS) for i, lm in enumerate(frames)]


def test_calibration_learns_a_shallow_range_that_then_counts():
    # Sit-to-stand needs the knee to reach 110 by default; this person only gets to 130.
    shallow = side_squats(low=130)
    assert feed(Session("sit_to_stand"), shallow)[-1]["summary"]["reps"] == 0

    s = Session("sit_to_stand")
    s.start_calibration()
    out = feed(s, shallow)
    statuses = [r["calibration"] for r in out if "calibration" in r]
    assert statuses[0] == {"status": "recording", "reps": 0, "needed": 3}
    done = statuses[-1]
    assert done["status"] == "done" and done["reps"] == 3
    # rest_ref ~170, depth ~40 -> rest ~160, target ~140
    assert done["rest"] == pytest.approx(160, abs=2)
    assert done["target"] == pytest.approx(140, abs=2)
    assert out[-1]["summary"]["reps"] == 0  # calibration reps are not counted
    assert out[-1]["thresholds"]["calibrated"]
    assert s.calibrator is None

    after = feed(s, shallow, start_t=100)
    assert after[-1]["summary"]["reps"] == 3


def test_calibration_works_for_exercises_whose_angle_grows():
    ex = EXERCISES["overhead_reach"]  # rest 60 -> target 135, rest_is_high False
    cal = Calibrator(ex)
    for _ in range(3):
        for v in syn.trajectory(30, 110, 30):
            cal.update(v)
    th = cal.result()
    assert th is not None
    assert th.rest == pytest.approx(30 + 0.25 * 80, abs=1)
    assert th.target == pytest.approx(30 + 0.75 * 80, abs=1)


def test_calibration_ignores_jitter_and_tracks_the_real_rest_position():
    ex = EXERCISES["sit_to_stand"]
    cal = Calibrator(ex)
    for v in [150, 152, 168, 170, 169, 171, 170]:  # starts mid-way, settles at ~170
        cal.update(v)
    assert cal.reps == 0
    for v in [170 + 2 * math.sin(i) for i in range(50)]:  # +-2 degrees of noise
        cal.update(v)
    assert cal.reps == 0
    for v in syn.trajectory(171, 120, 30):
        cal.update(v)
    assert cal.reps == 1 and cal.depths[0] == pytest.approx(51, abs=1)


@pytest.mark.parametrize(
    "rest,target,ok",
    [(150, 120, True), (120, 150, False), (150, 149, False), (200, 120, False),
     ("150", 120, False), (True, 120, False), (None, 120, False)],
)
def test_validate_thresholds(rest, target, ok):
    assert (calibration.validate(EXERCISES["sit_to_stand"], rest, target) is not None) == ok


def test_world_y_is_aligned_with_image_y():
    from pose_engine import align_world_y

    img = [(0.5, y, 1.0) for y in (0.1, 0.5, 0.9)]
    down = [(0.0, -0.5, 0.0), (0.0, 0.0, 0.0), (0.0, 0.5, 0.1)]
    assert align_world_y(img, down) == down
    up = [(x, -y, z) for x, y, z in down]
    assert align_world_y(img, up) == down
