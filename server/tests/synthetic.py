"""Build synthetic MediaPipe-style landmark lists with exact joint angles.

Coordinates are built in a 1000x1000 pixel space and normalised, so tests can
reason about geometry without a camera.
"""

from __future__ import annotations

import math

import numpy as np

from analysis.geometry import JOINTS

SIZE = 1000


def bend(center, ref, deg: float, length: float, prefer: str) -> np.ndarray:
    """Point at `length` from `center` such that angle(ref, center, point) == deg.

    Two points satisfy that; `prefer` picks one: "up", "down", "fwd" (+x), "back" (-x).
    """
    center, ref = np.asarray(center, float), np.asarray(ref, float)
    u = (ref - center) / np.linalg.norm(ref - center)
    r = math.radians(deg)
    cands = []
    for s in (1, -1):
        c, sn = math.cos(s * r), math.sin(s * r)
        cands.append(center + length * np.array([c * u[0] - sn * u[1], sn * u[0] + c * u[1]]))
    key = {"up": lambda p: p[1], "down": lambda p: -p[1], "fwd": lambda p: -p[0], "back": lambda p: p[0]}[prefer]
    return min(cands, key=key)


def landmarks(points: dict[str, dict[str, np.ndarray]], other_vis: float = 0.2) -> list[tuple]:
    """points: {"left": {...}, "right": {...}}; a side not given mirrors left at low visibility."""
    lms = [(0.5, 0.5, 0.9)] * 33
    lms = list(lms)
    for side in ("left", "right"):
        src, vis = (points[side], 0.95) if side in points else (points["left"], other_vis)
        for joint, idx in JOINTS[side].items():
            if joint in src:
                x, y = src[joint]
                lms[idx] = (x / SIZE, y / SIZE, vis)
    return lms


def squat(knee_deg: float, lean_deg: float = 10.0, knee_shift: float = 0.0):
    ankle = np.array([500.0, 900.0])
    knee = np.array([500.0 + knee_shift, 700.0])
    hip = bend(knee, ankle, knee_deg, 200, "back")
    lean = math.radians(lean_deg)
    shoulder = hip + 250 * np.array([math.sin(lean), -math.cos(lean)])
    pts = dict(ankle=ankle, knee=knee, hip=hip, shoulder=shoulder,
               heel=np.array([480.0, 915.0]), toe=np.array([560.0, 915.0]),
               elbow=shoulder + [0, 120], wrist=shoulder + [0, 240])
    return landmarks({"left": pts})


def pushup(elbow_deg: float, hip_offset: float = 0.0, vertical: bool = False):
    if vertical:  # standing upright: not a plank
        shoulder, hip, ankle = np.array([500.0, 300]), np.array([500.0, 550]), np.array([500.0, 900])
    else:
        shoulder, hip, ankle = np.array([300.0, 500]), np.array([550.0, 520 + hip_offset]), np.array([800.0, 540])
    elbow = shoulder + [0, 110]
    wrist = bend(elbow, shoulder, elbow_deg, 110, "back")
    pts = dict(shoulder=shoulder, elbow=elbow, wrist=wrist, hip=hip, ankle=ankle,
               knee=(hip + ankle) / 2, heel=ankle + [10, 0], toe=ankle + [10, 20])
    return landmarks({"left": pts})


def curl(elbow_deg: float, drift_deg: float = 5.0, lean_deg: float = 0.0):
    hip = np.array([500.0, 600])
    lean = math.radians(lean_deg)
    shoulder = hip + 280 * np.array([math.sin(lean), -math.cos(lean)])
    elbow = bend(shoulder, hip, drift_deg, 150, "fwd")
    wrist = bend(elbow, shoulder, elbow_deg, 140, "fwd")
    pts = dict(shoulder=shoulder, elbow=elbow, wrist=wrist, hip=hip,
               knee=hip + [0, 200], ankle=hip + [0, 400], heel=hip + [-10, 410], toe=hip + [40, 410])
    return landmarks({"left": pts})


def press(elbow_deg: float, arms_down: bool = False, right_offset: float = 0.0):
    sides = {}
    for side, sx, out in (("left", 600.0, 1), ("right", 400.0, -1)):
        shoulder = np.array([sx, 300.0])
        elbow = shoulder + [out * 110, 0]
        wrist = bend(elbow, shoulder, elbow_deg, 110, "down" if arms_down else "up")
        if side == "right":
            wrist = wrist + [0, right_offset]
        sides[side] = dict(shoulder=shoulder, elbow=elbow, wrist=wrist, hip=shoulder + [0, 260],
                           knee=shoulder + [0, 450], ankle=shoulder + [0, 640])
    return landmarks(sides)


def trajectory(start: float, end: float, frames: int) -> list[float]:
    """start -> end -> start following a cosine (natural acceleration)."""
    return [start + (end - start) * (1 - math.cos(2 * math.pi * i / frames)) / 2 for i in range(frames + 1)]


def turn_to_camera(lms: list[tuple], half_width: float = 0.06) -> tuple[list[tuple], list[tuple]]:
    """Side-view landmarks -> the same pose filmed from the front.

    The side view's x (forward/back) becomes depth, so in the image every joint
    of a leg sits on one vertical line and 2D angles flatten to ~180 degrees.
    Returns (image landmarks, world landmarks); world is in the side view's
    units (angles don't care about scale), centred on x = 0.5.
    """
    image, world = [], []
    for i, (x, y, _v) in enumerate(lms):
        offset = 0.0 if i < 11 else (half_width if i % 2 else -half_width)  # odd = left side
        image.append((0.5 + offset, y, 0.95))
        world.append((offset, y, x - 0.5))
    return image, world
