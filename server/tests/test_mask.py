import base64

import cv2
import numpy as np

from pose_engine import encode_mask


def decode(data_url: str) -> np.ndarray:
    prefix = "data:image/png;base64,"
    assert data_url.startswith(prefix)
    raw = np.frombuffer(base64.b64decode(data_url[len(prefix):]), np.uint8)
    return cv2.imdecode(raw, cv2.IMREAD_UNCHANGED)


def person_mask(h=360, w=480):
    m = np.zeros((h, w), np.float32)
    m[60:300, 200:280] = 1.0  # a standing "person"
    return m


def test_mask_is_small_rgba_with_person_in_alpha():
    img = decode(encode_mask(person_mask()))
    assert img.ndim == 3 and img.shape[2] == 4
    assert max(img.shape[:2]) == 160 and img.shape[0] / img.shape[1] == 0.75
    alpha = img[:, :, 3]
    assert alpha[80, 80] == 255   # centre of the person (scaled 1/3)
    assert alpha[5, 5] == 0       # far background


def test_mask_is_grown_beyond_the_person():
    m = person_mask()
    alpha = decode(encode_mask(m))[:, :, 3]
    original = cv2.resize(m, alpha.shape[::-1], interpolation=cv2.INTER_AREA) > 0.5
    grown = alpha > 127
    assert grown.sum() > original.sum() * 1.2
    assert grown[original].all()  # never shrinks: every person pixel stays covered


def test_landmarks_cover_limbs_and_head_the_mask_missed():
    lms = [(0.5, 0.5, 0.0)] * 33  # unseen by default
    lms = list(lms)
    lms[0] = (0.5, 0.15, 0.99)                            # nose
    lms[11], lms[12] = (0.6, 0.3, 0.99), (0.4, 0.3, 0.99)  # shoulders
    lms[13], lms[15] = (0.75, 0.3, 0.99), (0.9, 0.3, 0.99)  # left arm out sideways
    alpha = decode(encode_mask(np.zeros((360, 480), np.float32), lms))[:, :, 3]
    h, w = alpha.shape
    assert alpha[round(0.3 * h), round(0.82 * w)] == 255  # forearm, missed by the empty mask
    assert alpha[round(0.15 * h), round(0.5 * w)] == 255  # face
    assert alpha[round(0.9 * h), round(0.1 * w)] == 0     # unrelated background
    # A connection to an unseen landmark is not drawn.
    assert alpha[round(0.7 * h), round(0.6 * w)] == 0


def test_mask_accepts_mediapipe_shape_and_empty_input():
    alpha = decode(encode_mask(person_mask()[..., None]))[:, :, 3]  # HxWx1 like MediaPipe
    assert alpha.max() == 255
    empty = decode(encode_mask(np.zeros((90, 120), np.float32)))[:, :, 3]
    assert empty.max() == 0
