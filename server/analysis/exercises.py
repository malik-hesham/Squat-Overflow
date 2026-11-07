"""Exercise definitions: which angle drives the rep, and which form rules apply.

Every exercise reduces a pose to one *primary value* (a joint angle) that moves
between a REST zone and a TARGET zone once per rep, plus a list of form issues
seen in that frame. The rep counter in `session.py` is exercise-agnostic.

The office set (`OFFICE_EXERCISES`) is deliberately forgiving: each one only
counts reps on one angle with wide thresholds, and never flags form faults.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable

import numpy as np

from .geometry import Pose, angle, angle_from_horizontal, angle_from_vertical

ISSUE_TEXT: dict[str, str] = {
    "not_visible": "Step back so your whole body is in frame",
    "chest_up": "Keep your chest up, you're leaning too far forward",
    "knees_past_toes": "Sit back into your hips, knees are drifting past your toes",
    "hips_sag": "Brace your core, your hips are sagging",
    "hips_pike": "Lower your hips into a straight line",
    "not_plank": "Get into a plank position, side-on to the camera",
    "elbow_drift": "Keep your elbow pinned to your side",
    "swinging": "Don't swing your torso, keep it still",
    "arms_down": "Start with your hands at shoulder height",
    "uneven_press": "Press both arms evenly",
    "not_deep_enough": "Go through the full range of motion",
    "too_fast": "Slow down and control the movement",
}


@dataclass
class Measurement:
    value: float               # primary angle in degrees
    issues: list[str] = field(default_factory=list)
    valid: bool = True         # False = body isn't in the start position; don't count


@dataclass(frozen=True)
class Exercise:
    key: str
    label: str
    metric: str                # what the primary value measures, for the UI
    rest: float                # threshold of the rest zone
    target: float              # threshold of the target zone
    rest_is_high: bool = True  # True: angle is large at rest and shrinks during the rep
    bilateral: bool = False    # True: needs both sides visible (front view)
    joints: tuple[str, ...] = ()
    camera: str = "side"       # recommended camera angle, for the UI
    min_rep_seconds: float = 0.8
    category: str = "Workout"  # groups the picker in the UI
    how_to: str = ""           # one-line instruction shown in the UI
    stance: str = "standing"   # "seated" or "standing": standing moves need the whole body in frame

    def at_rest(self, v: float) -> bool:
        return v >= self.rest if self.rest_is_high else v <= self.rest

    def at_target(self, v: float) -> bool:
        return v <= self.target if self.rest_is_high else v >= self.target

    def measure(self, pose: Pose, side: str) -> Measurement:  # pragma: no cover
        raise NotImplementedError

    def rep_score(self, rom: float, needed: float, duration: float, issues: list[str]) -> int:
        return max(0, 100 - 20 * len(issues))


class Squat(Exercise):
    def measure(self, pose: Pose, side: str) -> Measurement:
        p = {j: pose.pt(side, j) for j in ("shoulder", "hip", "knee", "ankle", "heel", "toe")}
        knee = angle(p["hip"], p["knee"], p["ankle"])
        m = Measurement(knee)
        if knee < 140:  # only judge form once they are actually squatting
            if angle_from_vertical(p["hip"], p["shoulder"]) > 45:
                m.issues.append("chest_up")
            facing = 1.0 if p["toe"][0] >= p["heel"][0] else -1.0
            shin = float(np.linalg.norm(p["knee"] - p["ankle"]))
            if (p["knee"][0] - p["toe"][0]) * facing > 0.35 * shin:
                m.issues.append("knees_past_toes")
        return m


class PushUp(Exercise):
    def measure(self, pose: Pose, side: str) -> Measurement:
        p = {j: pose.pt(side, j) for j in ("shoulder", "elbow", "wrist", "hip", "ankle")}
        elbow = angle(p["shoulder"], p["elbow"], p["wrist"])
        m = Measurement(elbow)
        if angle_from_horizontal(p["shoulder"], p["ankle"]) > 50:
            m.valid = False
            m.issues.append("not_plank")
            return m
        if angle(p["shoulder"], p["hip"], p["ankle"]) < 160:
            sh, an, hip = p["shoulder"], p["ankle"], p["hip"]
            dx = an[0] - sh[0]
            t = (hip[0] - sh[0]) / dx if abs(dx) > 1e-6 else 0.5
            line_y = sh[1] + t * (an[1] - sh[1])
            m.issues.append("hips_sag" if hip[1] > line_y else "hips_pike")
        return m


class BicepCurl(Exercise):
    def measure(self, pose: Pose, side: str) -> Measurement:
        p = {j: pose.pt(side, j) for j in ("shoulder", "elbow", "wrist", "hip")}
        elbow = angle(p["shoulder"], p["elbow"], p["wrist"])
        m = Measurement(elbow)
        lean = angle_from_vertical(p["hip"], p["shoulder"])
        if lean > 35:
            m.valid = False  # bent over; this is not a standing curl
            return m
        if angle(p["elbow"], p["shoulder"], p["hip"]) > 35:
            m.issues.append("elbow_drift")
        if lean > 15:
            m.issues.append("swinging")
        return m


class ShoulderPress(Exercise):
    """Front view, both arms. Rest = hands at shoulders, target = locked out overhead."""

    def measure(self, pose: Pose, side: str) -> Measurement:
        sides = ("left", "right")
        elbows = [angle(pose.pt(s, "shoulder"), pose.pt(s, "elbow"), pose.pt(s, "wrist")) for s in sides]
        m = Measurement(float(np.mean(elbows)))
        sh_l, sh_r = pose.pt("left", "shoulder"), pose.pt("right", "shoulder")
        wr_l, wr_r = pose.pt("left", "wrist"), pose.pt("right", "wrist")
        shoulder_w = max(float(np.linalg.norm(sh_l - sh_r)), 1.0)
        shoulder_y = (sh_l[1] + sh_r[1]) / 2
        # Arms hanging by the sides also give a straight elbow; require hands up.
        if max(wr_l[1], wr_r[1]) > shoulder_y + 0.25 * shoulder_w:
            m.valid = False
            m.issues.append("arms_down")
            return m
        if abs(wr_l[1] - wr_r[1]) > 0.3 * shoulder_w:
            m.issues.append("uneven_press")
        return m


# --- Office set: angle helpers -------------------------------------------
# Each helper maps a pose (and a body side, where it matters) to one angle in
# 0..180 degrees, so every exercise fits the same rep counter and chart.

AngleFn = Callable[[Pose, str], float]


def arm_elevation(pose: Pose, s: str) -> float:
    """Shoulder->wrist vs straight down: 0 = arm hanging, 90 = shoulder height, 180 = overhead."""
    return 180.0 - angle_from_vertical(pose.pt(s, "shoulder"), pose.pt(s, "wrist"))


def elbow_angle(pose: Pose, s: str) -> float:
    return angle(pose.pt(s, "shoulder"), pose.pt(s, "elbow"), pose.pt(s, "wrist"))


def knee_angle(pose: Pose, s: str) -> float:
    return angle(pose.pt(s, "hip"), pose.pt(s, "knee"), pose.pt(s, "ankle"))


def hip_angle(pose: Pose, s: str) -> float:
    """Torso vs thigh: ~180 standing tall, ~90 seated."""
    return angle(pose.pt(s, "shoulder"), pose.pt(s, "hip"), pose.pt(s, "knee"))


def leg_line_angle(pose: Pose, s: str) -> float:
    """Torso vs whole leg (hip->ankle): ~180 standing, smaller as the leg swings."""
    return angle(pose.pt(s, "shoulder"), pose.pt(s, "hip"), pose.pt(s, "ankle"))


def wrist_angle(pose: Pose, s: str) -> float:
    """Forearm vs hand: 180 = straight wrist, smaller when bent up or down."""
    return angle(pose.pt(s, "elbow"), pose.pt(s, "wrist"), pose.pt(s, "index"))


def heel_lift(pose: Pose, s: str) -> float:
    """Heel->toe line vs horizontal: ~0 flat foot, grows when the heel rises."""
    return angle_from_horizontal(pose.pt(s, "heel"), pose.pt(s, "toe"))


def leg_out(pose: Pose, s: str) -> float:
    """Hip->ankle vs straight down: 0 = leg under the hip, grows as it lifts out sideways."""
    return 180.0 - angle_from_vertical(pose.pt(s, "hip"), pose.pt(s, "ankle"))


def torso_lean(pose: Pose, s: str) -> float:
    """Hip->shoulder vs vertical, seen from the side (forward or back)."""
    return angle_from_vertical(pose.pt(s, "hip"), pose.pt(s, "shoulder"))


def arm_across(pose: Pose, s: str) -> float:
    """Other shoulder -> shoulder -> wrist: 180 = arm out wide, small = hand at the other shoulder."""
    other = "right" if s == "left" else "left"
    return angle(pose.pt(other, "shoulder"), pose.pt(s, "shoulder"), pose.pt(s, "wrist"))


def _mid(pose: Pose, joint: str) -> np.ndarray:
    return (pose.pt("left", joint) + pose.pt("right", joint)) / 2


def torso_side_tilt(pose: Pose, _s: str = "") -> float:
    """Mid-hip -> mid-shoulder vs vertical, seen from the front."""
    return angle_from_vertical(_mid(pose, "hip"), _mid(pose, "shoulder"))


def shoulder_tilt(pose: Pose, _s: str = "") -> float:
    """Shoulder line vs horizontal; works seated with the hips hidden by the desk."""
    return angle_from_horizontal(pose.pt("left", "shoulder"), pose.pt("right", "shoulder"))


def head_tilt(pose: Pose, _s: str = "") -> float:
    """Ear line vs horizontal (ear towards shoulder)."""
    return angle_from_horizontal(pose.pt("left", "ear"), pose.pt("right", "ear"))


def head_turn(pose: Pose, _s: str = "") -> float:
    """How far the nose moved off the centre of the ears, as an angle (0 = facing the camera).

    Always image-space: it measures the turn relative to the camera, and the
    face points' depth from the model is too noisy to beat that.
    """
    el, er, nose = pose.pt2d("left", "ear"), pose.pt2d("right", "ear"), pose.pt2d("left", "nose")
    half = max(abs(el[0] - er[0]) / 2, 1.0)
    offset = abs(nose[0] - (el[0] + er[0]) / 2)
    return math.degrees(math.asin(min(1.0, offset / half)))


def head_drop(pose: Pose, _s: str = "") -> float:
    """How far the nose sits below the line between the ears, as an angle (0 = level or above).

    Grows as the chin drops towards the chest. Image-space, like `head_turn`.
    """
    el, er, nose = pose.pt2d("left", "ear"), pose.pt2d("right", "ear"), pose.pt2d("left", "nose")
    half = max(abs(el[0] - er[0]) / 2, 1.0)
    drop = nose[1] - (el[1] + er[1]) / 2
    return max(0.0, math.degrees(math.atan2(drop, half)))


def head_forward(pose: Pose, s: str) -> float:
    """Shoulder->ear vs straight up, seen from the side: grows as the head juts forward."""
    return angle_from_vertical(pose.pt(s, "shoulder"), pose.pt(s, "ear"))


def ear_height(pose: Pose, _s: str = "") -> float:
    """Shoulder->ear vs horizontal, averaged over both sides: shrinks as the shoulders rise."""
    return sum(angle_from_horizontal(pose.pt(s, "shoulder"), pose.pt(s, "ear")) for s in ("left", "right")) / 2


def both_sides(fn: AngleFn) -> AngleFn:
    """Average of left and right: both limbs move together."""
    return lambda pose, _s: (fn(pose, "left") + fn(pose, "right")) / 2


def either_side(fn: AngleFn, pick: Callable[[float, float], float]) -> AngleFn:
    """Alternating limbs: whichever side moved further counts (`pick` is min or max)."""
    return lambda pose, _s: pick(fn(pose, "left"), fn(pose, "right"))


@dataclass(frozen=True)
class Gentle(Exercise):
    """Forgiving desk exercise: counts reps on one angle and never flags form faults."""

    min_rep_seconds: float = 0.5
    angle_fn: AngleFn | None = field(default=None, repr=False, compare=False)

    def measure(self, pose: Pose, side: str) -> Measurement:
        assert self.angle_fn is not None
        return Measurement(float(self.angle_fn(pose, side)))

    def rep_score(self, rom: float, needed: float, duration: float, issues: list[str]) -> int:
        return office_rep_score(rom, needed, duration)


def gentle(key: str, label: str, metric: str, fn: AngleFn, rest: float, target: float, *,
           category: str, camera: str, joints: tuple[str, ...], how_to: str,
           stance: str = "seated") -> Gentle:
    """Front-camera exercises need both sides visible; side-camera ones use the nearer side."""
    return Gentle(
        key=key, label=label, metric=metric, rest=rest, target=target,
        rest_is_high=rest > target, bilateral=camera == "front", joints=joints,
        camera=camera, category=category, how_to=how_to, stance=stance, angle_fn=fn,
    )


# Pain areas, in the order the settings page lists them. Eyes is opt-in: the
# weekly featured area rotates over the others only.
NECK, ROUNDED, UPPER_BACK, ROTATOR = "Neck tension", "Rounded shoulders", "Upper back", "Shoulder & rotator cuff"
LOWER_BACK, WRIST_HAND, KNEES, EYES = "Lower back", "Wrist & hand", "Knees", "Eyes"
AREAS: tuple[str, ...] = (NECK, ROUNDED, UPPER_BACK, ROTATOR, LOWER_BACK, WRIST_HAND, KNEES, EYES)
ARMS = ("shoulder", "elbow", "wrist")
LEGS = ("hip", "knee", "ankle")
HAND = ("elbow", "wrist", "index")
TORSO = ("shoulder", "hip")

# Five per area. Thresholds are wide on purpose: rest and target sit well
# inside a comfortable range of motion, so a relaxed rep counts.
OFFICE_EXERCISES: tuple[Gentle, ...] = (
    # Neck tension: stiff neck and headaches from looking down or pushing the head towards the screen.
    gentle("neck_tilt", "Neck side tilt", "Head tilt", head_tilt, 8, 18,
           category=NECK, camera="front", joints=("ear", "shoulder"),
           how_to="Ear towards shoulder, back to centre, then the other side. Each side is a rep."),
    gentle("head_turn", "Look over your shoulder", "Head turn", head_turn, 15, 35,
           category=NECK, camera="front", joints=("nose", "shoulder"),
           how_to="Turn your head slowly to one side, back to centre, then the other side."),
    gentle("chin_to_chest", "Chin to chest", "Chin drop", head_drop, 25, 40,
           category=NECK, camera="front", joints=("nose", "ear", "shoulder"),
           how_to="Sit tall, slowly lower your chin towards your chest, then lift your head back up."),
    gentle("shoulder_shrug", "Shoulder shrugs", "Ear height", ear_height, 46, 39,
           category=NECK, camera="front", joints=("ear", "shoulder"),
           how_to="Lift both shoulders up towards your ears, hold for a moment, then let them drop."),
    gentle("chin_tuck", "Chin tuck", "Head forward", head_forward, 16, 8,
           category=NECK, camera="side", joints=("ear", "shoulder"),
           how_to="Sit tall, let your head glide forward, then pull your chin straight back into a double chin."),
    # Rounded shoulders: open the chest and pull the shoulders back.
    gentle("cross_swing", "Arm open & cross", "Arm opening", both_sides(arm_across), 140, 75,
           category=ROUNDED, camera="front", joints=ARMS,
           how_to="Open your arms wide, then hug them across your chest."),
    gentle("wy_raise", "W to Y raise", "Elbow angle", both_sides(elbow_angle), 110, 150,
           category=ROUNDED, camera="front", joints=ARMS,
           how_to="Arms in a W with your shoulder blades squeezed, slide them up into a Y, then back to the W."),
    gentle("shoulder_roll", "Backward shoulder rolls", "Ear height", ear_height, 46, 39,
           category=ROUNDED, camera="front", joints=("ear", "shoulder"),
           how_to="Roll both shoulders up towards your ears, back, and down. Each roll is a rep."),
    gentle("thoracic_extension", "Chair-back extension", "Torso lean", torso_lean, 10, 20,
           category=ROUNDED, camera="side", joints=TORSO,
           how_to="Hands behind your head, gently arch your upper back over the top of your chair, then sit tall."),
    gentle("clasp_opener", "Clasped-hands chest opener", "Arm lift", arm_elevation, 18, 32,
           category=ROUNDED, camera="side", joints=ARMS, stance="standing",
           how_to="Clasp your hands behind your back, squeeze your shoulder blades, lift your hands away, then lower."),
    # Upper back / rhomboids: a burning ache between the shoulder blades.
    gentle("seated_row", "Seated rows", "Elbow angle", elbow_angle, 150, 100,
           category=UPPER_BACK, camera="side", joints=ARMS,
           how_to="Arms straight in front, pull the elbows back and squeeze the shoulder blades."),
    gentle("t_raise", "T-raise", "Arm height", both_sides(arm_elevation), 45, 75,
           category=UPPER_BACK, camera="front", joints=ARMS,
           how_to="Lift both arms out to the sides to shoulder height, squeeze your shoulder blades, then lower."),
    gentle("desk_punch", "Desk punches", "Elbow angle", elbow_angle, 90, 150,
           category=UPPER_BACK, camera="side", joints=ARMS,
           how_to="Fists by your chest, punch straight forward, then pull back."),
    gentle("rhomboid_stretch", "Upper back stretch", "Torso lean", torso_lean, 10, 20,
           category=UPPER_BACK, camera="side", joints=TORSO,
           how_to="Clasp your hands in front, push them forward and round your upper back, then sit tall."),
    gentle("desk_row", "One-arm desk row", "Elbow angle", elbow_angle, 150, 100,
           category=UPPER_BACK, camera="side", joints=ARMS, stance="standing",
           how_to="Lean on the desk with your far hand, pull the other elbow back to your ribs, then lower it."),
    # Shoulder / rotator cuff: pain or clicking when lifting or rotating the arm.
    gentle("scaption", "Scaption raise", "Arm height", both_sides(arm_elevation), 45, 75,
           category=ROTATOR, camera="front", joints=ARMS,
           how_to="Thumbs up, raise both straight arms slightly forward of your sides to shoulder height, then lower."),
    gentle("front_raise", "Front arm raise", "Arm height", arm_elevation, 40, 75,
           category=ROTATOR, camera="side", joints=ARMS,
           how_to="Lift a straight arm forward to shoulder height, then lower it."),
    gentle("overhead_reach", "Overhead reach", "Arm height", both_sides(arm_elevation), 60, 135,
           category=ROTATOR, camera="front", joints=ARMS,
           how_to="Reach both arms up towards the ceiling, then lower them."),
    gentle("external_rotation", "Elbows-in outward rotation", "Arm opening", both_sides(arm_across), 105, 120,
           category=ROTATOR, camera="front", joints=ARMS,
           how_to="Elbows tucked at your sides and bent, rotate both hands out wide, then back in front of you."),
    gentle("cross_body_stretch", "Cross-body shoulder stretch", "Arm across", either_side(arm_across, min), 70, 35,
           category=ROTATOR, camera="front", joints=ARMS,
           how_to="Bring one arm across your chest, hug it in with the other hand, release, then switch arms."),
    # Lower back: stiffness at the base of the spine after long sitting.
    gentle("seated_side_bend", "Seated side bend", "Shoulder tilt", shoulder_tilt, 7, 14,
           category=LOWER_BACK, camera="front", joints=("shoulder",),
           how_to="Sit tall, lean to one side, back to centre, then the other side."),
    gentle("knee_to_chest", "Seated knee hug", "Hip angle", either_side(hip_angle, min), 80, 60,
           category=LOWER_BACK, camera="side", joints=("shoulder", "hip", "knee"),
           how_to="Sit tall, hug one knee up towards your chest, lower it, then switch legs."),
    gentle("hip_hinge", "Hip hinge", "Torso lean", torso_lean, 20, 45,
           category=LOWER_BACK, camera="side", joints=TORSO, stance="standing",
           how_to="Soft knees, push your hips back and tip your chest forward, then stand tall."),
    gentle("standing_side_bend", "Standing side bend", "Torso tilt", torso_side_tilt, 6, 15,
           category=LOWER_BACK, camera="front", joints=TORSO, stance="standing",
           how_to="Stand tall, slide one hand down your leg, back to centre, then the other side."),
    gentle("back_extension", "Standing back extension", "Torso lean", torso_lean, 6, 14,
           category=LOWER_BACK, camera="side", joints=TORSO, stance="standing",
           how_to="Stand tall with your hands on your lower back, gently lean back, then return."),
    # Wrist & hand: typing and mouse strain, tingling or numbness in the fingers.
    gentle("wrist_flex", "Wrist flex & extend", "Wrist angle", wrist_angle, 160, 135,
           category=WRIST_HAND, camera="side", joints=HAND,
           how_to="Arm out in front, bend the hand up or down, then straighten it."),
    gentle("extensor_stretch", "Wrist extensor stretch", "Wrist angle", wrist_angle, 160, 130,
           category=WRIST_HAND, camera="side", joints=HAND,
           how_to="Arm straight out, palm down. Gently bend the hand down with your other hand, then release."),
    gentle("flexor_stretch", "Wrist flexor stretch", "Wrist angle", wrist_angle, 160, 130,
           category=WRIST_HAND, camera="side", joints=HAND,
           how_to="Arm straight out, palm up. Gently pull your fingers back with your other hand, then release."),
    gentle("prayer_stretch", "Prayer stretch", "Wrist angle", both_sides(wrist_angle), 145, 115,
           category=WRIST_HAND, camera="front", joints=HAND,
           how_to="Palms together in front of your chest, lower your hands until the wrists stretch, then lift them."),
    gentle("nerve_glide", "Median nerve glide", "Elbow angle", both_sides(elbow_angle), 100, 150,
           category=WRIST_HAND, camera="front", joints=ARMS,
           how_to="Hands by your shoulders, palms up. Straighten both arms out to the sides, palms out, then bend back."),
    # Knees: stiff or aching knees from sitting with the legs bent for hours.
    gentle("seated_knee_ext", "Seated leg extension", "Knee angle", either_side(knee_angle, max), 110, 150,
           category=KNEES, camera="side", joints=LEGS,
           how_to="Sit tall, straighten one leg out in front, lower it, then switch."),
    gentle("heel_slide", "Seated heel slide", "Knee angle", either_side(knee_angle, min), 85, 65,
           category=KNEES, camera="side", joints=LEGS,
           how_to="Feet flat, slide one foot back under your chair to bend the knee, slide it forward, then switch."),
    gentle("sit_to_stand", "Sit to stand", "Knee angle", knee_angle, 155, 110,
           category=KNEES, camera="side", joints=LEGS, stance="standing",
           how_to="Stand up from your chair and sit back down without using your hands."),
    gentle("mini_squat", "Mini squat", "Knee angle", knee_angle, 160, 135,
           category=KNEES, camera="side", joints=LEGS, stance="standing",
           how_to="Hold the desk if you like and bend the knees a little, then stand tall."),
    gentle("hamstring_curl", "Standing hamstring curl", "Knee angle", either_side(knee_angle, min), 155, 110,
           category=KNEES, camera="side", joints=LEGS, stance="standing",
           how_to="Hold the desk, bring one heel towards your seat, lower it, then switch legs."),
    # Eyes: the camera can't see where you look, so each move counts the hand
    # or head movement that goes with it.
    gentle("palming", "Palming", "Hand height", both_sides(arm_elevation), 60, 120,
           category=EYES, camera="front", joints=ARMS,
           how_to="Rub your palms warm, cup them over your closed eyes for a slow breath, then lower your hands."),
    gentle("temple_massage", "Temple massage", "Hand height", both_sides(arm_elevation), 60, 120,
           category=EYES, camera="front", joints=ARMS,
           how_to="Close your eyes, rub small slow circles on your temples with your fingertips, then lower your hands."),
    gentle("look_far", "Look into the distance", "Head turn", head_turn, 15, 35,
           category=EYES, camera="front", joints=("nose", "shoulder"),
           how_to="Turn to something far away, like a window, focus on it for a slow breath, then turn back."),
    gentle("near_far_focus", "Near-far focus", "Elbow angle", elbow_angle, 145, 90,
           category=EYES, camera="side", joints=ARMS,
           how_to="Thumb up at arm's length, keep it sharp as you bring it slowly to your nose, then push it back out."),
    gentle("eye_track_vertical", "Thumb tracking", "Arm height", arm_elevation, 50, 110,
           category=EYES, camera="side", joints=ARMS,
           how_to="Head still, follow your thumb with your eyes as you raise a straight arm up high, then lower it."),
)

EXERCISES: dict[str, Exercise] = {
    e.key: e
    for e in (
        Squat(
            key="squat", label="Squat", metric="Knee angle",
            rest=160, target=100, joints=("shoulder", "hip", "knee", "ankle"),
            how_to="Feet shoulder-width apart, sit back until your thighs are near parallel.",
        ),
        PushUp(
            key="pushup", label="Push-up", metric="Elbow angle",
            rest=150, target=95, joints=("shoulder", "elbow", "wrist", "hip", "ankle"),
            how_to="Body in a straight line, lower your chest until the elbows reach about 90°.",
        ),
        BicepCurl(
            key="curl", label="Bicep curl", metric="Elbow angle",
            rest=145, target=55, joints=("shoulder", "elbow", "wrist", "hip"),
            how_to="Elbow pinned to your side, curl the hand up to your shoulder.",
        ),
        ShoulderPress(
            key="press", label="Shoulder press", metric="Avg elbow angle",
            rest=110, target=155, rest_is_high=False, bilateral=True,
            joints=("shoulder", "elbow", "wrist"), camera="front",
            how_to="Hands at shoulder height, press both arms straight overhead.",
        ),
        *OFFICE_EXERCISES,
    )
}

# What the app offers: the office (workplace) set only. The Workout exercises
# above stay defined and tested, but are not sent to clients or accepted by them.
CATALOG: dict[str, Exercise] = {e.key: e for e in OFFICE_EXERCISES}
DEFAULT_EXERCISE = OFFICE_EXERCISES[0].key


def office_rep_score(rom: float, needed: float, duration: float) -> int:
    if needed <= 0:
        return 0
    ratio = rom / needed
    depth = 70 * min(1.0, max(0.0, (ratio - 0.4) / 0.6)) + 30 * min(1.0, max(0.0, (ratio - 1.0) / 0.3))
    tempo = -30 if duration < 0.5 else -15 if duration < 1.0 else 0
    return int(min(100, max(0, round(depth + tempo))))
