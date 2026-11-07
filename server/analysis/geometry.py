"""Pose geometry helpers.

MediaPipe returns landmarks normalised to [0, 1] on each axis. Angles must be
computed in pixel space, otherwise a non-square frame skews every angle, so
`Pose` scales x by width and y by height before any maths happens.

It also returns *world* landmarks: 3D points in meters, origin between the
hips, axes aligned with the image (x right, y down, z away from the camera).
With `use_world=True`, `Pose.pt` returns those 3D points instead, so every
angle helper below measures the real joint angle rather than its projection
on the image. A knee bending towards the camera then still reads correctly.
All helpers accept 2D or 3D points.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence

import numpy as np

# MediaPipe Pose landmark indices (33-point BlazePose topology).
JOINTS: dict[str, dict[str, int]] = {
    "left": dict(nose=0, ear=7, shoulder=11, elbow=13, wrist=15, index=19,
                 hip=23, knee=25, ankle=27, heel=29, toe=31),
    "right": dict(nose=0, ear=8, shoulder=12, elbow=14, wrist=16, index=20,
                  hip=24, knee=26, ankle=28, heel=30, toe=32),
}

# Skeleton edges, for clients that want to draw the pose.
CONNECTIONS: list[tuple[int, int]] = [
    (11, 12), (11, 13), (13, 15), (12, 14), (14, 16),
    (11, 23), (12, 24), (23, 24),
    (23, 25), (25, 27), (27, 29), (29, 31), (27, 31),
    (24, 26), (26, 28), (28, 30), (30, 32), (28, 32),
]

Landmark = Sequence[float]  # (x, y, visibility) normalised
WorldLandmark = Sequence[float]  # (x, y, z) in meters, origin between the hips


@dataclass(frozen=True)
class Pose:
    landmarks: Sequence[Landmark]
    width: int
    height: int
    world: Sequence[WorldLandmark] | None = None
    use_world: bool = False  # True (and world given): pt() returns 3D points in meters

    @property
    def is_3d(self) -> bool:
        return self.use_world and self.world is not None

    def pt(self, side: str, joint: str) -> np.ndarray:
        if self.is_3d:
            return np.array(self.world[JOINTS[side][joint]][:3], dtype=float)
        return self.pt2d(side, joint)

    def pt2d(self, side: str, joint: str) -> np.ndarray:
        """Always the image-space point in pixels."""
        x, y = self.landmarks[JOINTS[side][joint]][:2]
        return np.array([x * self.width, y * self.height], dtype=float)

    def vis(self, side: str, joint: str) -> float:
        lm = self.landmarks[JOINTS[side][joint]]
        return float(lm[2]) if len(lm) > 2 else 1.0


def angle(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    """Interior angle ABC in degrees (0..180)."""
    ba, bc = a - b, c - b
    denom = np.linalg.norm(ba) * np.linalg.norm(bc)
    if denom < 1e-9:
        return 180.0
    cos = float(np.clip(np.dot(ba, bc) / denom, -1.0, 1.0))
    return math.degrees(math.acos(cos))


def angle_from_vertical(start: np.ndarray, end: np.ndarray) -> float:
    """Angle (0..180) between the vector start->end and straight up.

    Image and world y both grow downwards, so "up" is -y in 2D and 3D.
    """
    up = np.zeros_like(start, dtype=float)
    up[1] = -1.0
    return angle(start + up, start, end)


def angle_from_horizontal(start: np.ndarray, end: np.ndarray) -> float:
    """Angle (0..90) between the line start-end and the horizontal (the x-z plane in 3D)."""
    d = np.abs(np.asarray(end, float) - np.asarray(start, float))
    flat = math.hypot(d[0], d[2]) if len(d) > 2 else d[0]
    return math.degrees(math.atan2(d[1], flat))


class Ema:
    """Exponential moving average used to de-jitter joint angles."""

    def __init__(self, alpha: float = 0.5):
        self.alpha = alpha
        self.value: float | None = None

    def __call__(self, x: float) -> float:
        self.value = x if self.value is None else self.alpha * x + (1 - self.alpha) * self.value
        return self.value

    def reset(self) -> None:
        self.value = None
