"""Thin wrapper around the MediaPipe Tasks PoseLandmarker (VIDEO mode)."""

from __future__ import annotations

import base64
import shutil
import tempfile
import urllib.request
from pathlib import Path
from typing import NamedTuple, Sequence

import cv2
import numpy as np

from analysis.geometry import CONNECTIONS

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"
)
MODEL_PATH = Path(__file__).parent / "models" / "pose_landmarker_lite.task"


def ensure_model(path: Path = MODEL_PATH, url: str = MODEL_URL) -> Path:
    """Download the pose model on first run."""
    if path.exists() and path.stat().st_size > 0:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading pose model to {path} ...", flush=True)
    with urllib.request.urlopen(url, timeout=60) as resp, tempfile.NamedTemporaryFile(
        dir=path.parent, delete=False
    ) as tmp:
        shutil.copyfileobj(resp, tmp)
    Path(tmp.name).replace(path)
    return path


def decode_jpeg(data: bytes) -> np.ndarray | None:
    """JPEG/PNG bytes -> RGB uint8 array, or None if undecodable."""
    bgr = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if bgr is None:
        return None
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)


def encode_mask(
    mask: np.ndarray,
    landmarks: Sequence[Sequence[float]] | None = None,
    max_side: int = 160,
    grow: float = 0.06,
) -> str:
    """Person mask (HxW, 0..1) -> small RGBA PNG data URL whose alpha is the mask.

    The segmentation mask sometimes misses a limb or a foot, so when landmarks
    are given, thick limb lines and a head disc are added to it. The result is
    grown by `grow` x its longest side and feathered. The preview shows the
    live video while the mask belongs to a frame one round trip older, so a
    tight mask would let a moving arm or head slip out of the blur.
    """
    m = np.clip(np.squeeze(mask).astype(np.float32), 0.0, 1.0)
    h, w = m.shape
    scale = min(1.0, max_side / max(h, w))
    size = (max(1, round(w * scale)), max(1, round(h * scale)))
    alpha = (cv2.resize(m, size, interpolation=cv2.INTER_AREA) * 255).astype(np.uint8)
    if landmarks:
        _cover_skeleton(alpha, landmarks)
    k = max(3, round(max(size) * grow)) | 1  # odd kernel size
    alpha = cv2.dilate(alpha, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    alpha = cv2.GaussianBlur(alpha, (k, k), 0)
    white = np.full_like(alpha, 255)
    ok, buf = cv2.imencode(".png", np.dstack([white, white, white, alpha]))
    if not ok:  # pragma: no cover
        raise RuntimeError("PNG encoding failed")
    return "data:image/png;base64," + base64.b64encode(buf.tobytes()).decode("ascii")


COVER_MIN_VIS = 0.2  # low on purpose: blurring a guessed limb is better than exposing a real one


def _cover_skeleton(alpha: np.ndarray, landmarks: Sequence[Sequence[float]]) -> None:
    """Paint thick limbs and a head disc onto `alpha` (in place), from normalised landmarks."""
    h, w = alpha.shape
    pts = np.array([[lm[0] * w, lm[1] * h] for lm in landmarks], dtype=np.float32)
    seen = np.array([(lm[2] if len(lm) > 2 else 1.0) >= COVER_MIN_VIS for lm in landmarks])
    thickness = max(2, round(max(h, w) * 0.05))
    for a, b in CONNECTIONS:
        if seen[a] and seen[b]:
            cv2.line(alpha, tuple(map(round, pts[a])), tuple(map(round, pts[b])), 255, thickness, cv2.LINE_AA)
    head = [i for i in range(0, 11) if seen[i]]  # face landmarks: nose, eyes, ears, mouth
    if head:
        centre = pts[head].mean(axis=0)
        radius = thickness * 1.5
        if seen[11] and seen[12]:  # head is roughly half as wide as the shoulders
            radius = max(radius, 0.45 * float(np.linalg.norm(pts[11] - pts[12])))
        if seen[7] and seen[8]:
            radius = max(radius, 0.9 * float(np.linalg.norm(pts[7] - pts[8])))
        cv2.circle(alpha, tuple(map(round, centre)), round(radius), 255, -1, cv2.LINE_AA)


def align_world_y(
    landmarks: Sequence[Sequence[float]], world: list[tuple[float, float, float]]
) -> list[tuple[float, float, float]]:
    """Make world y grow downwards like image y, so "up" is -y in both spaces.

    MediaPipe's world axes follow the image, but the angle helpers depend on
    that, so we check it: if world y runs opposite to image y across the body,
    flip it.
    """
    img_y = np.array([lm[1] for lm in landmarks], dtype=float)
    w_y = np.array([p[1] for p in world], dtype=float)
    if img_y.std() < 1e-9 or w_y.std() < 1e-9:
        return world
    if float(np.corrcoef(img_y, w_y)[0, 1]) < 0:
        return [(x, -y, z) for x, y, z in world]
    return world


class Detection(NamedTuple):
    landmarks: list[tuple[float, float, float]] | None  # 33 x (x, y, visibility), normalised
    world: list[tuple[float, float, float]] | None      # 33 x (x, y, z) in meters, origin between hips
    mask: np.ndarray | None                             # person mask HxW float 0..1


class PoseEngine:
    """One instance per client stream: VIDEO mode tracks the person across frames."""

    def __init__(self, model_path: Path = MODEL_PATH):
        import mediapipe as mp
        from mediapipe.tasks import python as mp_tasks
        from mediapipe.tasks.python import vision

        self._mp = mp
        options = vision.PoseLandmarkerOptions(
            base_options=mp_tasks.BaseOptions(model_asset_path=str(model_path)),
            running_mode=vision.RunningMode.VIDEO,
            num_poses=1,
            min_pose_detection_confidence=0.5,
            min_pose_presence_confidence=0.5,
            min_tracking_confidence=0.5,
            output_segmentation_masks=True,  # used by the client's privacy blur
        )
        self._landmarker = vision.PoseLandmarker.create_from_options(options)
        self._last_ts = -1

    def detect(self, rgb: np.ndarray, timestamp_ms: int) -> Detection:
        """Image landmarks, 3D world landmarks and person mask (all None if nobody is found)."""
        # VIDEO mode requires strictly increasing timestamps.
        ts = max(int(timestamp_ms), self._last_ts + 1)
        self._last_ts = ts
        image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        result = self._landmarker.detect_for_video(image, ts)
        if not result.pose_landmarks:
            return Detection(None, None, None)
        landmarks = [
            (lm.x, lm.y, lm.visibility if lm.visibility is not None else 1.0)
            for lm in result.pose_landmarks[0]
        ]
        world = None
        if result.pose_world_landmarks:
            world = align_world_y(landmarks, [(lm.x, lm.y, lm.z) for lm in result.pose_world_landmarks[0]])
        mask = None
        if result.segmentation_masks:
            mask = np.squeeze(result.segmentation_masks[0].numpy_view()).copy()
        return Detection(landmarks, world, mask)

    def close(self) -> None:
        self._landmarker.close()
