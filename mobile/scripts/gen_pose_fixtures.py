"""Golden fixtures for the TypeScript port of server/analysis (mobile/src/pose/analysis).

Run with the server's venv:

    cd server && .venv/bin/python ../mobile/scripts/gen_pose_fixtures.py

It drives the real Python `Session` (and the helpers around it) with synthetic
landmark sequences built on tests/synthetic.py, and writes the inputs plus
Python's outputs to mobile/src/pose/analysis/__tests__/fixtures/. The jest
suite replays the same inputs through the TypeScript port and expects the
same outputs.

Every input is rounded to 5 decimals *before* Python sees it, so both sides
get bit-identical inputs.

Session fixtures (session_<exercise>.json) are delta-encoded to stay small:

    {"exercise": key, "scenarios": [{"name", "width", "height", "steps": [...]}]}

The first step of a scenario creates the session; the rest are control ops
or frames:

    {"op": "new", "exercise": key, "use_world": bool}
    {"op": "set_exercise", "exercise": key, "thresholds": {"rest", "target"} | null}
    {"op": "reset"}
    {"op": "angle_mode", "use_world": bool}
    {"op": "calibrate", "action": "start" | "cancel"}
    {"t": seconds, "lm": [[i, x, y, v], ...] | null, "w": [[i, x, y, z], ...], "out": {...}, "gone": [...]}

`lm` lists the landmarks that changed since the previous frame that had
landmarks (all 33 the first time), as [i, x, y] when only x and y changed;
null means nobody was detected (landmarks=None). `w` works the same way for
world landmarks (always [i, x, y, z]); a frame without `w` passes world=None.
Coordinates in `lm` and `w` are integers in units of 1e-5 (the inputs are
rounded to 5 decimals anyway): value = n / 100000, which gives the exact same
double in Python and JS since both divide with correct rounding.

`out` holds the keys of Python's result that differ from the previous frame's
result, and `gone` the keys that disappeared since (e.g. "calibration").

The other fixtures: catalog.json (exercise_catalog() and the static tables),
numeric.json (round/sum/hypot/trig/score/angle/median/validate/Calibrator
cases), measure.json (every exercise's measure() on random poses) and
align_world_y.json.
"""

from __future__ import annotations

import json
import math
import random
import statistics
import sys
from decimal import Decimal
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SERVER = REPO / "server"
OUT = REPO / "mobile" / "src" / "pose" / "analysis" / "__tests__" / "fixtures"
sys.path.insert(0, str(SERVER))

import numpy as np  # noqa: E402

from analysis import calibration  # noqa: E402
from analysis.calibration import Calibrator  # noqa: E402
from analysis.exercises import (  # noqa: E402
    AREAS, CATALOG, DEFAULT_EXERCISE, EXERCISES, ISSUE_TEXT, office_rep_score,
)
from analysis.geometry import (  # noqa: E402
    CONNECTIONS, JOINTS, Pose, angle, angle_from_horizontal, angle_from_vertical,
)
from analysis.session import Session  # noqa: E402
from app import exercise_catalog  # noqa: E402
from pose_engine import align_world_y  # noqa: E402
from tests import synthetic as syn  # noqa: E402
from tests.test_office import side_head, upper  # noqa: E402

SIZE = syn.SIZE
DIGITS = 5
FPS = 10  # controlled reps; rushed and medium reps use a faster frame rate


def r5(v: float) -> float:
    return round(float(v), DIGITS)


def round_points(points):
    return None if points is None else [tuple(r5(v) for v in p) for p in points]


def q(v: float):
    """A value already rounded to 5 decimals -> exact integer count of 1e-5 (-0.0 stays a float)."""
    if v == 0 and math.copysign(1.0, v) < 0:
        return -0.0
    n = int(Decimal(repr(v)) * 100000)
    assert n / 100000 == v, v
    return n


def delta(prev, cur, keep_last: bool = True):
    """Changed points as [i, *point]; with keep_last=False, [i, x, y] when the last value (visibility)
    didn't change."""
    out = []
    for i, p in enumerate(cur):
        if prev is not None and prev[i] == p:
            continue
        same_last = prev is not None and prev[i][2] == p[2]
        out.append([i, *map(q, p[:2] if same_last and not keep_last else p)])
    return out


def normalise(obj):
    """Python result -> plain JSON values (tuples become lists), as the client would see it."""
    return json.loads(json.dumps(obj, allow_nan=False))


class Recorder:
    """One scenario: a fresh Session plus the steps that drive it, recorded as they happen."""

    def __init__(self, name: str, exercise: str, use_world: bool = False, width: int = SIZE, height: int = SIZE):
        self.name, self.width, self.height = name, width, height
        self.session = Session(exercise, use_world)
        self.steps: list[dict] = [{"op": "new", "exercise": exercise, "use_world": use_world}]
        self.t = 0.0
        self.prev_lm = None
        self.prev_w = None
        self.prev_out: dict = {}
        self.frames = 0
        self.events: list[dict] = []

    # Control ops, replayed 1:1 by the TS test.
    def set_exercise(self, key: str, thresholds=None) -> None:
        self.session.set_exercise(key, thresholds)
        self.steps.append({"op": "set_exercise", "exercise": key,
                           "thresholds": None if thresholds is None else thresholds.to_json()})

    def reset(self) -> None:
        self.session.reset()
        self.steps.append({"op": "reset"})

    def angle_mode(self, use_world: bool) -> None:
        self.session.set_angle_mode(use_world)
        self.steps.append({"op": "angle_mode", "use_world": use_world})

    def calibrate(self, action: str) -> None:
        if action == "start":
            self.session.start_calibration()
        else:
            self.session.cancel_calibration()
        self.steps.append({"op": "calibrate", "action": action})

    def frame(self, lms, world=None, dt: float = 1 / FPS) -> dict:
        lms, world = round_points(lms), round_points(world)
        t = r5(self.t)
        out = normalise(self.session.process(lms, self.width, self.height, t, world))
        step: dict = {"t": t}
        if lms is None:
            step["lm"] = None
        else:
            step["lm"] = delta(self.prev_lm, lms, keep_last=False)
            self.prev_lm = lms
        if world is not None:
            step["w"] = delta(self.prev_w, world)
            self.prev_w = world
        step["out"] = {k: v for k, v in out.items() if k not in self.prev_out or self.prev_out[k] != v}
        gone = [k for k in self.prev_out if k not in out]
        if gone:
            step["gone"] = gone
        self.prev_out = out
        self.steps.append(step)
        self.t += dt
        self.frames += 1
        if out["rep_event"]:
            self.events.append(out["rep_event"])
        return out

    def to_json(self) -> dict:
        return {"name": self.name, "width": self.width, "height": self.height, "steps": self.steps}


# --- pose builders --------------------------------------------------------
# Each maps one parameter to landmarks whose primary angle (2D, square frame)
# is that parameter, so rep levels can be chosen in angle space.

def side_arm(elev: float, elbow: float = 180.0):
    """Side view, left arm raised `elev` degrees forward from hanging, elbow bent to `elbow`."""
    shoulder = np.array([500.0, 400.0])
    e = math.radians(elev)
    elbow_pt = shoulder + 150 * np.array([math.sin(e), math.cos(e)])
    wrist = syn.bend(elbow_pt, shoulder, elbow, 140, "up")
    hand = (wrist - elbow_pt) / np.linalg.norm(wrist - elbow_pt)
    hip = np.array([500.0, 680.0])
    pts = dict(nose=shoulder + [70, -140], ear=shoulder + [5, -150], shoulder=shoulder, elbow=elbow_pt,
               wrist=wrist, index=wrist + 40 * hand, hip=hip, knee=hip + [180, 10], ankle=hip + [190, 210],
               heel=hip + [170, 225], toe=hip + [240, 225])
    return syn.landmarks({"left": pts})


def seated_legs(hip=(90.0, 90.0), knee=(90.0, 90.0)):
    """Side view, seated; per-side hip (torso vs thigh) and knee angles. Both sides visible."""
    sides = {}
    for side, h, k in (("left", hip[0], knee[0]), ("right", hip[1], knee[1])):
        hip_pt, shoulder = np.array([500.0, 600.0]), np.array([500.0, 320.0])
        knee_pt = syn.bend(hip_pt, shoulder, h, 200, "fwd")
        ankle = syn.bend(knee_pt, hip_pt, k, 200, "down")
        sides[side] = dict(nose=shoulder + [60, -110], ear=shoulder + [10, -110], shoulder=shoulder,
                           elbow=shoulder + [20, 130], wrist=shoulder + [120, 200], index=shoulder + [150, 200],
                           hip=hip_pt, knee=knee_pt, ankle=ankle, heel=ankle + [-10, 10], toe=ankle + [50, 10])
    return syn.landmarks(sides)


def standing_legs(knee=(175.0, 175.0)):
    """Side view, standing on straight thighs; per-side knee angle (heel goes back)."""
    sides = {}
    for side, k in (("left", knee[0]), ("right", knee[1])):
        hip, shoulder = np.array([500.0, 500.0]), np.array([500.0, 220.0])
        knee_pt = hip + [0, 200]
        ankle = syn.bend(knee_pt, hip, k, 200, "back")
        sides[side] = dict(nose=shoulder + [60, -110], ear=shoulder + [10, -110], shoulder=shoulder,
                           elbow=shoulder + [10, 130], wrist=shoulder + [60, 230], index=shoulder + [80, 250],
                           hip=hip, knee=knee_pt, ankle=ankle, heel=ankle + [-10, 10], toe=ankle + [50, 10])
    return syn.landmarks(sides)


def front_torso(tilt: float):
    """Front view, torso bent `tilt` degrees sideways about the mid-hip."""
    t = math.radians(tilt)
    up, across = np.array([math.sin(t), -math.cos(t)]), np.array([math.cos(t), math.sin(t)])
    mid_hip = np.array([500.0, 620.0])
    mid_sh = mid_hip + 280 * up
    sides = {}
    for side, out in (("left", 1), ("right", -1)):
        sh = mid_sh + out * 100 * across
        hip = mid_hip + [out * 60, 0]
        sides[side] = dict(nose=mid_sh + 110 * up, ear=mid_sh + 100 * up + out * 45 * across, shoulder=sh,
                           elbow=sh + [out * 15, 130], wrist=sh + [out * 20, 250], index=sh + [out * 22, 290],
                           hip=hip, knee=hip + [0, 190], ankle=hip + [0, 370], heel=hip + [0, 385],
                           toe=hip + [out * 10, 395])
    return syn.landmarks(sides)


def side_wrist(deg: float):
    """Side view, arm out in front, hand bent so the wrist angle is `deg`."""
    shoulder, elbow, wrist = np.array([380.0, 400.0]), np.array([530.0, 430.0]), np.array([680.0, 440.0])
    hip = np.array([380.0, 680.0])
    pts = dict(nose=shoulder + [60, -140], ear=shoulder + [0, -150], shoulder=shoulder, elbow=elbow, wrist=wrist,
               index=syn.bend(wrist, elbow, deg, 70, "down"), hip=hip, knee=hip + [180, 0], ankle=hip + [180, 200])
    return syn.landmarks({"left": pts})


def front_wrists(deg: float):
    """Front view, forearms up in front of the chest, both wrists bent to `deg`."""
    sides = {}
    for side, out in (("left", 1), ("right", -1)):
        shoulder = np.array([500 + out * 100.0, 400.0])
        elbow, wrist = np.array([500 + out * 150.0, 560.0]), np.array([500 + out * 40.0, 470.0])
        sides[side] = dict(nose=[500.0, 300.0], ear=[500.0 + out * 60, 290.0], shoulder=shoulder, elbow=elbow,
                           wrist=wrist, index=syn.bend(wrist, elbow, deg, 60, "up"), hip=shoulder + [0, 300],
                           knee=shoulder + [0, 450], ankle=shoulder + [0, 640])
    return syn.landmarks(sides)


def shrug_for(ear_angle: float) -> float:
    """`upper(shrug=...)` that gives this ear height angle (ears 40 px in, 120 px above the shoulders)."""
    return 120 - 40 * math.tan(math.radians(ear_angle))


def tilt_drop(deg: float) -> float:
    """`upper(shoulder_drop=...)` that tilts the shoulder line by `deg` (shoulders 200 px apart)."""
    return 200 * math.tan(math.radians(deg))


class Driver:
    """How to pose a body for one exercise: build(param, alt) -> landmarks; alt = the other side."""

    def __init__(self, build, alternates: bool = False):
        self.build = build
        self.alternates = alternates  # reps alternate sides (each side is a rep)


def _arm_across_one(a, alt):
    e = a - 90  # arm_across = 90 + arm elevation (negative = across the chest)
    return upper(left_elev=0, right_elev=e) if alt else upper(left_elev=e, right_elev=0)


DRIVERS: dict[str, Driver] = {
    "neck_tilt": Driver(lambda a, alt: upper(tilt=-a if alt else a), True),
    "head_turn": Driver(lambda a, alt: upper(turn=-a if alt else a), True),
    "chin_to_chest": Driver(lambda a, alt: upper(chin_drop=a)),
    "shoulder_shrug": Driver(lambda a, alt: upper(shrug=shrug_for(a))),
    "chin_tuck": Driver(lambda a, alt: side_head(a)),
    "cross_swing": Driver(lambda a, alt: upper(left_elev=a - 90, right_elev=a - 90)),
    "wy_raise": Driver(lambda a, alt: syn.press(a)),
    "shoulder_roll": Driver(lambda a, alt: upper(shrug=shrug_for(a))),
    "thoracic_extension": Driver(lambda a, alt: syn.curl(150, lean_deg=-a)),  # arching back
    "clasp_opener": Driver(lambda a, alt: side_arm(-a)),  # hands lifted behind the back
    "seated_row": Driver(lambda a, alt: side_arm(60, a)),
    "t_raise": Driver(lambda a, alt: upper(left_elev=a, right_elev=a)),
    "desk_punch": Driver(lambda a, alt: side_arm(70, a)),
    "rhomboid_stretch": Driver(lambda a, alt: syn.curl(150, lean_deg=a)),
    "desk_row": Driver(lambda a, alt: side_arm(30, a)),
    "scaption": Driver(lambda a, alt: upper(left_elev=a, right_elev=a)),
    "front_raise": Driver(lambda a, alt: side_arm(a)),
    "overhead_reach": Driver(lambda a, alt: upper(left_elev=a, right_elev=a)),
    "external_rotation": Driver(lambda a, alt: upper(left_elev=a - 90, right_elev=a - 90)),
    "cross_body_stretch": Driver(_arm_across_one, True),
    "seated_side_bend": Driver(lambda a, alt: upper(shoulder_drop=tilt_drop(-a if alt else a)), True),
    "knee_to_chest": Driver(lambda a, alt: seated_legs(hip=(90, a) if alt else (a, 90)), True),
    "hip_hinge": Driver(lambda a, alt: syn.curl(150, lean_deg=a)),
    "standing_side_bend": Driver(lambda a, alt: front_torso(-a if alt else a), True),
    "back_extension": Driver(lambda a, alt: syn.curl(150, lean_deg=-a)),
    "wrist_flex": Driver(lambda a, alt: side_wrist(a)),
    "extensor_stretch": Driver(lambda a, alt: side_wrist(a)),
    "flexor_stretch": Driver(lambda a, alt: side_wrist(a)),
    "prayer_stretch": Driver(lambda a, alt: front_wrists(a)),
    "nerve_glide": Driver(lambda a, alt: syn.press(a)),
    "seated_knee_ext": Driver(lambda a, alt: seated_legs(knee=(90, a) if alt else (a, 90)), True),
    "heel_slide": Driver(lambda a, alt: seated_legs(knee=(90, a) if alt else (a, 90)), True),
    "sit_to_stand": Driver(lambda a, alt: syn.squat(a)),
    "mini_squat": Driver(lambda a, alt: syn.squat(a)),
    "hamstring_curl": Driver(lambda a, alt: standing_legs(knee=(175, a) if alt else (a, 175)), True),
    "palming": Driver(lambda a, alt: upper(left_elev=a, right_elev=a)),
    "temple_massage": Driver(lambda a, alt: upper(left_elev=a, right_elev=a)),
    "look_far": Driver(lambda a, alt: upper(turn=-a if alt else a), True),
    "near_far_focus": Driver(lambda a, alt: side_arm(80, a)),
    "eye_track_vertical": Driver(lambda a, alt: side_arm(a)),
    # Workout set (not offered in the catalog, but Session accepts it).
    "squat": Driver(lambda a, alt: syn.squat(a)),
    "pushup": Driver(lambda a, alt: syn.pushup(a)),
    "curl": Driver(lambda a, alt: syn.curl(a)),
    "press": Driver(lambda a, alt: syn.press(a)),
}


def levels(key: str) -> dict[str, float]:
    """Angle levels for one exercise: relaxed (inside rest), deep (past target), and in between."""
    ex = EXERCISES[key]
    step = 1 if ex.target > ex.rest else -1
    margin = max(4.0, 0.3 * abs(ex.target - ex.rest))
    relaxed = ex.rest - step * margin
    return {
        "relaxed": relaxed,
        "deep": ex.target + step * margin,
        "partial": relaxed + (ex.target - relaxed) * 0.72,  # an attempted rep that falls short
        "shallow": relaxed + (ex.target - relaxed) * 0.8,  # this user's comfortable range, for calibration
        "wobble": relaxed + (ex.target - relaxed) * 0.38,  # too small to be an attempted rep
    }


# --- frame helpers ---------------------------------------------------------

def dim(lms, factor: float):
    return [(x, y, v * factor) for x, y, v in lms]


def mix_sides(left_lms, right_lms, vis_left: float, vis_right: float):
    """Left joints from one pose, right joints from another, with per-side visibility."""
    lms = list(left_lms)
    for idx in JOINTS["right"].values():
        lms[idx] = right_lms[idx]
    for side, vis in (("left", vis_left), ("right", vis_right)):
        for idx in JOINTS[side].values():
            x, y, _ = lms[idx]
            lms[idx] = (x, y, vis)
    return lms


def front_world(lms):
    """Front-camera exercises: world = image coordinates around the hips plus a fixed depth per
    landmark, with y pointing *up*; align_world_y must flip it back, as on the phone."""
    raw = [((x - 0.5) * 1.2, -(y - 0.6) * 1.2, 0.08 * math.sin(1.7 * i)) for i, (x, y, _v) in enumerate(lms)]
    return lms, align_world_y(lms, raw)


def world_fn(key: str):
    """Side-camera exercises are filmed from the front (2D angles flatten, 3D ones don't)."""
    return syn.turn_to_camera if EXERCISES[key].camera == "side" else front_world


def emit(rec: Recorder, lms, dt: float, to_world=None) -> None:
    if to_world is None or lms is None:
        rec.frame(lms, None, dt)
    else:
        img, world = to_world(lms)
        rec.frame(img, world, dt)


def reps(rec: Recorder, key: str, a: float, b: float, n: int = 1, seconds: float = 2.0, fps: float = FPS,
         to_world=None, alternate: bool | None = None, lost=()):
    """`n` reps a -> b -> a (cosine timing); frames whose index is in `lost` have nobody in view."""
    d = DRIVERS[key]
    alternate = d.alternates if alternate is None else alternate
    for k in range(n):
        alt = alternate and k % 2 == 1
        for i, v in enumerate(syn.trajectory(a, b, int(round(seconds * fps)))):
            emit(rec, None if i in lost else d.build(v, alt), 1 / fps, to_world)


def hold(rec: Recorder, key: str, a: float, n: int, to_world=None, fps: float = FPS) -> None:
    for _ in range(n):
        emit(rec, DRIVERS[key].build(a, False), 1 / fps, to_world)


# --- scenarios -------------------------------------------------------------

def scenario_main(key: str, rng: random.Random) -> Recorder:
    """Controlled, partial, rushed and medium-tempo reps, a wobble, fidgeting, a lost person,
    low visibility, reset, and a switch to another exercise and back."""
    lv = levels(key)
    rel, deep = lv["relaxed"], lv["deep"]
    rec = Recorder("main", key)
    hold(rec, key, rel, 2)
    reps(rec, key, rel, deep, n=3)  # controlled: 2 s each
    reps(rec, key, rel, lv["partial"])  # partial: never reaches the target
    reps(rec, key, rel, deep, seconds=0.4, fps=40)  # rushed: under 0.5 s
    hold(rec, key, rel, 2)
    reps(rec, key, rel, deep, seconds=0.8, fps=20)  # medium tempo: 0.5..1 s
    reps(rec, key, rel, lv["wobble"], seconds=1.0)  # small wobble, not an attempted rep
    span = abs(EXERCISES[key].target - EXERCISES[key].rest)
    for _ in range(8):  # fidgeting at rest
        emit(rec, DRIVERS[key].build(rel + rng.uniform(-0.1, 0.1) * span, False), 1 / FPS)
    reps(rec, key, rel, deep, lost=(8, 9, 10))  # nobody in view mid-rep
    for _ in range(4):  # everyone fades: low visibility
        emit(rec, dim(DRIVERS[key].build(rel, False), 0.35), 1 / FPS)
    hold(rec, key, rel, 2)
    rec.reset()
    hold(rec, key, rel, 1)
    reps(rec, key, rel, deep)
    keys = list(EXERCISES)
    rec.set_exercise(keys[(keys.index(key) + 1) % len(keys)])  # same motion, another exercise's angle
    reps(rec, key, rel, deep, seconds=1.0)
    rec.set_exercise(key)
    hold(rec, key, rel, 1)
    reps(rec, key, rel, deep, seconds=1.2)
    return rec


def scenario_world(key: str) -> Recorder:
    """World landmarks in 2D mode (angle_alt = 3D), switch to 3D, frames without world, back to 2D."""
    lv = levels(key)
    rel, deep = lv["relaxed"], lv["deep"]
    tw = world_fn(key)
    rec = Recorder("world", key)
    hold(rec, key, rel, 2, tw)
    reps(rec, key, rel, deep, n=2, to_world=tw)
    rec.angle_mode(True)
    hold(rec, key, rel, 2, tw)
    reps(rec, key, rel, deep, n=2, to_world=tw)
    reps(rec, key, rel, deep, n=1)  # 3D mode, but no world landmarks: falls back to 2D
    reps(rec, key, rel, deep, n=1, to_world=tw, lost=(8, 9))
    rec.angle_mode(False)
    hold(rec, key, rel, 2, tw)
    reps(rec, key, rel, deep, n=1, to_world=tw)
    return rec


def scenario_world_ctor(key: str) -> Recorder:
    """A session created in 3D mode."""
    lv = levels(key)
    tw = world_fn(key)
    rec = Recorder("world_ctor", key, use_world=True)
    hold(rec, key, lv["relaxed"], 2, tw)
    reps(rec, key, lv["relaxed"], lv["deep"], n=2, to_world=tw)
    reps(rec, key, lv["relaxed"], lv["partial"], n=1, to_world=tw)
    return rec


def scenario_calibration(key: str) -> Recorder:
    """Calibrate on a shallow range that the defaults can't count, count with it, reset (keeps it),
    recalibrate and cancel, config-message thresholds (valid and invalid), angle-mode switch."""
    ex = EXERCISES[key]
    lv = levels(key)
    rel, deep, shallow = lv["relaxed"], lv["deep"], lv["shallow"]
    rec = Recorder("calibration", key)
    hold(rec, key, rel, 3)
    reps(rec, key, rel, shallow)  # default thresholds: only a partial rep
    rec.calibrate("start")
    hold(rec, key, rel, 2)
    reps(rec, key, rel, shallow)
    reps(rec, key, rel, shallow, lost=(5, 6))  # still recording while nobody is in view
    reps(rec, key, rel, shallow)  # third rep: calibration done
    hold(rec, key, rel, 2)
    reps(rec, key, rel, shallow, n=2)  # now these count
    rec.reset()  # keeps the calibrated thresholds
    hold(rec, key, rel, 2)
    reps(rec, key, rel, shallow)
    rec.calibrate("start")
    reps(rec, key, rel, shallow)
    rec.calibrate("cancel")  # back to the defaults (start_calibration dropped the thresholds)
    reps(rec, key, rel, deep)
    # Thresholds sent by a client in a config message, validated like app.py does.
    good = calibration.validate(ex, rel + (shallow - rel) * 0.25 + 0.05, rel + (shallow - rel) * 0.75 + 0.05)
    assert good is not None, key
    rec.set_exercise(key, good)
    hold(rec, key, rel, 2)
    reps(rec, key, rel, shallow)
    bad = calibration.validate(ex, ex.target, ex.rest)  # wrong direction: rejected, defaults apply
    assert bad is None, key
    rec.set_exercise(key, bad)
    reps(rec, key, rel, shallow)
    rec.set_exercise(key, good)
    rec.angle_mode(False)  # thresholds are per mode: dropped
    reps(rec, key, rel, deep)
    return rec


def scenario_calibration_fails(key: str) -> Recorder:
    """Reps too small to give thresholds at least 3 degrees apart: calibration reports failure."""
    ex = EXERCISES[key]
    step = 1 if ex.target > ex.rest else -1
    rel = levels(key)["relaxed"]
    rec = Recorder("calibration_fails", key)
    hold(rec, key, rel, 2)
    rec.calibrate("start")
    reps(rec, key, rel, rel + step * 5.5, n=3, alternate=False)
    hold(rec, key, rel, 3)
    reps(rec, key, rel, levels(key)["deep"])  # counting resumes with the defaults
    return rec


def scenario_side_switch(key: str) -> Recorder:
    """Per-side visibility changes: the measured side only switches past SIDE_SWITCH_MARGIN."""
    lv = levels(key)
    rel, deep = lv["relaxed"], lv["deep"]
    d = DRIVERS[key]
    rec = Recorder("side_switch", key)
    segments = [(0.95, 0.9), (0.9, 0.95), (0.7, 0.95), (0.95, 0.85), (0.95, 0.75), (0.45, 0.4), (0.3, 0.9),
                (0.95, 0.95)]
    values = syn.trajectory(rel, deep, 24) + syn.trajectory(rel, deep, 24)
    offset = 0.15 * (deep - rel)  # the right side is a little further into the rep
    for i, v in enumerate(values):
        vl, vr = segments[min(i // 6, len(segments) - 1)]
        rec.frame(mix_sides(d.build(v, False), d.build(v + offset, False), vl, vr), None, 1 / FPS)
    return rec


def scenario_frame_size(key: str, width: int, height: int) -> Recorder:
    """Non-square frames: angles are measured in pixels, so the aspect ratio matters."""
    lv = levels(key)
    rec = Recorder(f"frame_{width}x{height}", key, width=width, height=height)
    hold(rec, key, lv["relaxed"], 2)
    reps(rec, key, lv["relaxed"], lv["deep"], n=2)
    reps(rec, key, lv["relaxed"], lv["partial"])
    return rec


def scenario_jitter(key: str, rng: random.Random) -> Recorder:
    """Hovering around the rest threshold with landmark noise must not count extra reps."""
    ex = EXERCISES[key]
    lv = levels(key)
    rec = Recorder("jitter", key)
    reps(rec, key, lv["relaxed"], lv["deep"], n=2)
    for _ in range(40):
        emit(rec, DRIVERS[key].build(ex.rest + rng.uniform(-4, 4), False), 1 / FPS)
    return rec


def scenario_form(key: str) -> Recorder:
    """Workout set: form faults, invalid start positions, and how they add up in the summary."""
    rec = Recorder("form", key)
    seconds = 2.0

    def run(build, a, b, n=1, s=seconds):
        for _ in range(n):
            for v in syn.trajectory(a, b, int(round(s * FPS))):
                rec.frame(build(v), None, 1 / FPS)

    if key == "squat":
        run(syn.squat, 172, 80)
        run(lambda v: syn.squat(v, lean_deg=60), 172, 80, n=2)
        run(lambda v: syn.squat(v, knee_shift=200), 172, 80)
        run(lambda v: syn.squat(v, lean_deg=60, knee_shift=200), 172, 125)  # partial with faults
        run(syn.squat, 172, 80, s=0.5)
    elif key == "pushup":
        run(syn.pushup, 170, 80)
        run(lambda v: syn.pushup(v, hip_offset=80), 170, 80, n=2)
        run(lambda v: syn.pushup(v, hip_offset=-120), 170, 80)
        run(lambda v: syn.pushup(v, vertical=True), 170, 80)  # not in a plank: never counted
        run(syn.pushup, 170, 80)
    elif key == "curl":
        run(syn.curl, 165, 40)
        run(lambda v: syn.curl(v, drift_deg=50), 165, 40, n=2)
        run(lambda v: syn.curl(v, lean_deg=22), 165, 40)
        run(lambda v: syn.curl(v, lean_deg=40), 165, 40)  # bent over: invalid
        run(lambda v: syn.curl(v, drift_deg=50, lean_deg=22), 165, 90)
    elif key == "press":
        run(syn.press, 90, 172)
        run(lambda v: syn.press(v, right_offset=90), 90, 172, n=2)
        run(lambda v: syn.press(v, arms_down=True), 90, 172)  # arms hanging: invalid
        run(syn.press, 90, 172, s=0.6)
    return rec


def scenario_form_calibration(key: str) -> Recorder:
    """Calibration ignores frames whose measurement is invalid (workout set)."""
    rec = Recorder("form_calibration", key)
    bad = {"press": lambda v: syn.press(v, arms_down=True), "pushup": lambda v: syn.pushup(v, vertical=True),
           "curl": lambda v: syn.curl(v, lean_deg=40), "squat": lambda v: syn.squat(v, lean_deg=60)}[key]
    lv = levels(key)
    rel, shallow = lv["relaxed"], lv["shallow"]
    rec.calibrate("start")
    for k in range(4):
        build = bad if k == 1 else DRIVERS[key].build
        for v in syn.trajectory(rel, shallow, 24):
            rec.frame(build(v) if k == 1 else build(v, False), None, 1 / FPS)
    reps(rec, key, rel, shallow, n=2)
    return rec


# One or two exercises per angle helper is enough for the 3D paths.
WORLD_KEYS = ["sit_to_stand", "seated_row", "hip_hinge", "chin_tuck", "front_raise", "wrist_flex", "knee_to_chest",
              "neck_tilt", "seated_side_bend", "overhead_reach", "head_turn", "squat", "press"]
WORLD_CTOR_KEYS = ["sit_to_stand", "neck_tilt", "squat"]
CALIBRATION_KEYS = ["sit_to_stand", "overhead_reach", "neck_tilt", "chin_tuck", "cross_body_stretch",
                    "seated_knee_ext", "seated_row", "squat", "press"]
CALIBRATION_FAIL_KEYS = ["neck_tilt", "chin_tuck", "seated_side_bend"]
SIDE_SWITCH_KEYS = ["seated_row", "sit_to_stand", "chin_tuck", "knee_to_chest", "neck_tilt", "front_raise"]
FRAME_SIZE_KEYS = {"neck_tilt": (1280, 720), "overhead_reach": (720, 1280), "sit_to_stand": (720, 1280),
                   "seated_row": (1280, 720), "head_turn": (720, 1280), "chin_to_chest": (1280, 720),
                   "squat": (640, 480)}
JITTER_KEYS = ["squat", "sit_to_stand", "neck_tilt"]
WORKOUT = ["squat", "pushup", "curl", "press"]


def session_fixtures() -> dict[str, list[Recorder]]:
    rng = random.Random(7)
    out: dict[str, list[Recorder]] = {}
    for key in EXERCISES:
        recs = [scenario_main(key, rng)]
        if key in WORLD_KEYS:
            recs.append(scenario_world(key))
        if key in WORLD_CTOR_KEYS:
            recs.append(scenario_world_ctor(key))
        if key in CALIBRATION_KEYS:
            recs.append(scenario_calibration(key))
        if key in CALIBRATION_FAIL_KEYS:
            recs.append(scenario_calibration_fails(key))
        if key in SIDE_SWITCH_KEYS:
            recs.append(scenario_side_switch(key))
        if key in FRAME_SIZE_KEYS:
            recs.append(scenario_frame_size(key, *FRAME_SIZE_KEYS[key]))
        if key in JITTER_KEYS:
            recs.append(scenario_jitter(key, rng))
        if key in WORKOUT:
            recs.append(scenario_form(key))
            recs.append(scenario_form_calibration(key))
        out[key] = recs
    return out


# --- non-session fixtures ---------------------------------------------------

def catalog_fixture() -> dict:
    return {
        "catalog": exercise_catalog(),
        "connections": CONNECTIONS,
        "issue_text": ISSUE_TEXT,
        "default_exercise": DEFAULT_EXERCISE,
        "areas": list(AREAS),
        "catalog_keys": list(CATALOG),
        "joints": JOINTS,
        "exercises": [
            {"key": e.key, "label": e.label, "metric": e.metric, "rest": e.rest, "target": e.target,
             "rest_is_high": e.rest_is_high, "bilateral": e.bilateral, "joints": list(e.joints), "camera": e.camera,
             "min_rep_seconds": e.min_rep_seconds, "category": e.category, "how_to": e.how_to, "stance": e.stance,
             "kind": type(e).__name__}
            for e in EXERCISES.values()
        ],
    }


def numeric_fixture() -> dict:
    rng = random.Random(42)

    rounding = []
    candidates = [rng.uniform(-200, 200) for _ in range(500)]
    candidates += [k / 4 for k in range(-80, 81)] + [k / 8 for k in range(-80, 81)] + [k + 0.5 for k in range(-20, 20)]
    candidates += [round(rng.uniform(0, 200), 2) for _ in range(400)]  # decimal-looking values, rounded again
    candidates += [round(rng.uniform(0, 200), 3) for _ in range(400)]
    candidates += [0.05, 0.15, 0.25, 0.35, 0.45, 2.675, 1.005, 8.345, 150.05, 150.25, -0.25, -0.05, 0.0, 1e-9]
    for x in candidates:
        rounding.append([x, round(x, 1), round(x, 2), round(x)])

    sums = []
    for _ in range(250):
        n = rng.randint(1, 14)
        kind = rng.random()
        if kind < 0.4:
            xs = [round(rng.uniform(0, 3), 2) for _ in range(n)]  # rep durations
        elif kind < 0.8:
            xs = [round(rng.uniform(0, 120), 1) for _ in range(n)]  # rep ROMs
        else:
            xs = [rng.uniform(-1e3, 1e3) for _ in range(n)]
        sums.append([xs, sum(xs), round(sum(xs) / len(xs), 1)])

    hypots = [[x, y, math.hypot(x, y)] for x, y in
              ((rng.uniform(0, 2), rng.uniform(0, 2)) for _ in range(600))]
    hypots += [[x, y, math.hypot(x, y)] for x, y in
               ((rng.uniform(-500, 500), rng.uniform(-1e-3, 1e-3)) for _ in range(100))]
    hypots += [[0.0, 0.0, 0.0], [3.0, 4.0, 5.0], [0.0, 2.5, 2.5], [1e-300, 1e-300, math.hypot(1e-300, 1e-300)]]

    trig = {
        "acos": [[x, math.acos(x)] for x in (rng.uniform(-1, 1) for _ in range(250))],
        "asin": [[x, math.asin(x)] for x in (rng.uniform(-1, 1) for _ in range(250))],
        "atan2": [[y, x, math.atan2(y, x)] for y, x in
                  ((rng.uniform(-500, 500), rng.uniform(-500, 500)) for _ in range(250))],
        "degrees": [[x, math.degrees(x)] for x in (rng.uniform(-4, 4) for _ in range(200))],
    }

    scores = []
    for _ in range(600):
        needed = rng.choice([0.0, -1.0]) if rng.random() < 0.03 else rng.uniform(1, 80)
        rom = rng.uniform(0, 1.6) * abs(needed) if needed else rng.uniform(0, 50)
        duration = rng.choice([0.2, 0.49, 0.5, 0.75, 0.99, 1.0, 1.5]) if rng.random() < 0.5 else rng.uniform(0, 3)
        scores.append([rom, needed, duration, office_rep_score(rom, needed, duration)])
    for rom, needed, duration in [(50, 50, 1.5), (65, 50, 1.5), (20, 50, 1.5), (35, 50, 1.5), (65, 50, 0.4),
                                  (65, 50, 0.8), (200, 50, 1.5), (5, 50, 0.2)]:
        scores.append([rom, needed, duration, office_rep_score(rom, needed, duration)])

    def pt(dim):
        return [rng.uniform(-500, 500) for _ in range(dim)]

    angles = []
    for _ in range(150):
        dim = rng.choice([2, 3])
        a, b, c = np.array(pt(dim)), np.array(pt(dim)), np.array(pt(dim))
        angles.append([a.tolist(), b.tolist(), c.tolist(), angle(a, b, c), angle_from_vertical(b, c),
                       angle_from_horizontal(b, c)])
    for dim in (2, 3):  # degenerate: zero-length vectors
        same = np.array([1.0, 2.0, 3.0][:dim])
        angles.append([same.tolist(), same.tolist(), same.tolist(), angle(same, same, same),
                       angle_from_vertical(same, same), angle_from_horizontal(same, same)])

    medians = []
    for _ in range(100):
        xs = [round(rng.uniform(0, 180), 2) for _ in range(rng.randint(1, 7))]
        medians.append([xs, statistics.median(xs)])

    validate = []
    for key in ("sit_to_stand", "overhead_reach", "neck_tilt", "press", "squat"):
        ex = EXERCISES[key]
        cases = [(ex.rest, ex.target), (ex.target, ex.rest), (150, 120), (120, 150), (150, 149), (200, 120),
                 (150.05, 120.25), (150.25, 120.35), (-1, 40), (180, 0), (0, 180), (90, 87), (90, 93), (87, 90),
                 (93, 90), ("150", 120), (True, 120), (120, False), (None, 120), ([150], 120), (150, {"x": 1})]
        cases += [(round(rng.uniform(-10, 190), rng.choice([0, 1, 2, 3])),
                   round(rng.uniform(-10, 190), rng.choice([0, 1, 2, 3]))) for _ in range(30)]
        for rest, target in cases:
            th = calibration.validate(ex, rest, target)
            validate.append([key, rest, target, None if th is None else th.to_json()])

    calibrators = []
    for key in ("sit_to_stand", "overhead_reach", "neck_tilt", "chin_tuck", "squat", "press"):
        ex = EXERCISES[key]
        for _ in range(4):
            cal = Calibrator(ex)
            values, finished = [], []
            v = rng.uniform(ex.rest - 10, ex.rest + 10)
            for _ in range(rng.randint(60, 160)):
                v += rng.uniform(-6, 6)
                values.append(round(v, 3))
                finished.append(cal.update(values[-1]))
            th = cal.result()
            calibrators.append({"exercise": key, "values": values, "finished": finished, "reps": cal.reps,
                                "depths": cal.depths, "rest_samples": cal.rest_samples,
                                "result": None if th is None else th.to_json()})

    return {"round": rounding, "sum": sums, "hypot": hypots, "trig": trig, "office_rep_score": scores,
            "angles": angles, "median": medians, "validate": validate, "calibrator": calibrators}


def measure_fixture() -> dict:
    """Every exercise's measurement on random poses, both sides, 2D and 3D."""
    rng = random.Random(99)
    poses = []
    for _ in range(14):
        lms = [(r5(rng.uniform(0.05, 0.95)), r5(rng.uniform(0.05, 0.95)), r5(rng.uniform(0.3, 1.0)))
               for _ in range(33)]
        world = [(r5(rng.uniform(-0.6, 0.6)), r5(rng.uniform(-0.8, 0.8)), r5(rng.uniform(-0.4, 0.4)))
                 for _ in range(33)]
        poses.append((lms, world))
    # Synthetic poses that hit the workout form rules.
    for lms in (syn.squat(100, lean_deg=60, knee_shift=200), syn.squat(120), syn.pushup(90, hip_offset=80),
                syn.pushup(90, hip_offset=-120), syn.pushup(90, vertical=True), syn.curl(60, drift_deg=50, lean_deg=22),
                syn.curl(60, lean_deg=40), syn.press(140, right_offset=90), syn.press(140, arms_down=True)):
        img, world = syn.turn_to_camera(lms)
        poses.append((round_points(lms), round_points(world)))
        poses.append((round_points(img), round_points(world)))
    sizes = [(1000, 1000), (1280, 720), (720, 1280)]
    # results[pose][exercise] = [value, issues, valid] for (left 2D, left 3D, right 2D, right 3D);
    # values rounded to 10 decimals to save space (the test compares within 1e-6).
    results = []
    for p, (lms, world) in enumerate(poses):
        w, h = sizes[p % len(sizes)]
        per_ex = {}
        for key, ex in EXERCISES.items():
            per_ex[key] = []
            for side in ("left", "right"):
                for use_world in (False, True):
                    m = ex.measure(Pose(lms, w, h, world, use_world=use_world), side)
                    per_ex[key].append([round(m.value, 10), m.issues, m.valid])
        results.append(per_ex)
    return {"poses": [{"landmarks": lms, "world": world, "width": sizes[i % len(sizes)][0],
                       "height": sizes[i % len(sizes)][1]} for i, (lms, world) in enumerate(poses)],
            "results": results}


def align_fixture() -> list:
    rng = random.Random(5)
    img = [(0.5, y, 1.0) for y in (0.1, 0.5, 0.9)]
    down = [(0.0, -0.5, 0.0), (0.0, 0.0, 0.0), (0.0, 0.5, 0.1)]
    up = [(x, -y, z) for x, y, z in down]
    cases = [(img, down), (img, up), ([(0.5, 0.5, 1.0)] * 3, up), (img, [(0.1, 0.2, 0.3)] * 3)]
    for _ in range(30):
        lms = [(r5(rng.uniform(0, 1)), r5(rng.uniform(0, 1)), r5(rng.uniform(0, 1))) for _ in range(33)]
        sign = rng.choice([-1, 1])
        world = [(r5(rng.uniform(-0.5, 0.5)), r5(sign * (y - 0.5) + rng.uniform(-0.2, 0.2)), r5(rng.uniform(-0.3, 0.3)))
                 for _, y, _ in lms]
        cases.append((lms, world))
    for lms in (syn.squat(120), syn.press(140)):
        _, world = syn.turn_to_camera(lms)
        cases.append((round_points(lms), round_points([(x, -y, z) for x, y, z in world])))
    return [{"landmarks": lms, "world": world, "expected": [list(p) for p in align_world_y(lms, world)]}
            for lms, world in cases]


def write(name: str, obj) -> int:
    text = json.dumps(obj, separators=(",", ":"), allow_nan=False, ensure_ascii=False)
    (OUT / name).write_text(text + "\n", encoding="utf-8")
    return len(text.encode("utf-8"))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()
    total = 0
    frames = 0
    coverage = []
    for key, recs in session_fixtures().items():
        total += write(f"session_{key}.json", {"exercise": key, "scenarios": [r.to_json() for r in recs]})
        frames += sum(r.frames for r in recs)
        reps_counted = sum(1 for r in recs for e in r.events if not e["partial"])
        partials = sum(1 for r in recs for e in r.events if e["partial"])
        coverage.append(f"  {key:20s} {', '.join(r.name for r in recs)}  "
                        f"[{sum(r.frames for r in recs)} frames, {reps_counted} reps, {partials} partial]")
    total += write("catalog.json", catalog_fixture())
    total += write("numeric.json", numeric_fixture())
    total += write("measure.json", measure_fixture())
    total += write("align_world_y.json", align_fixture())
    print("\n".join(coverage))
    print(f"{frames} session frames, {total / 1e6:.2f} MB of fixtures in {OUT.relative_to(REPO)}")


if __name__ == "__main__":
    main()
