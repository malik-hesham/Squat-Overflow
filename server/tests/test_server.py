"""End-to-end WebSocket tests; these run the real MediaPipe model."""

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import app as app_module
from app import app, origin_allowed
from pose_engine import MODEL_PATH

pytestmark = pytest.mark.skipif(not MODEL_PATH.exists(), reason="pose model not downloaded")

EXT = {"origin": "chrome-extension://abcdefghijklmnopabcdefghijklmnop"}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def jpeg(img: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".jpg", img)
    assert ok
    return buf.tobytes()


def test_health(client):
    body = client.get("/health").json()
    keys = {e["key"] for e in body["exercises"]}
    assert body["ok"] and {"neck_tilt", "palming"} <= keys
    assert body["version"] == "dev"  # FORMCOACH_VERSION is only set inside the Docker image
    assert not keys & {"squat", "pushup", "curl", "press"}  # office set only
    assert len(keys) == 40
    assert all(e["category"] and e["how_to"] and e["demo"]["url"] for e in body["exercises"])
    assert {e["stance"] for e in body["exercises"]} == {"seated", "standing"}



def test_privacy_page(client):
    res = client.get("/privacy")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/html")
    assert "privacy policy" in res.text.lower() and "Competitive mode" in res.text

def test_web_page_origin_is_rejected(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws", headers={"origin": "https://evil.example"}) as ws:
            ws.receive_json()


def test_extension_round_trip(client):
    with client.websocket_connect("/ws", headers=EXT) as ws:
        ready = ws.receive_json()
        assert ready["type"] == "ready" and len(ready["connections"]) > 10
        assert len(ready["exercises"]) == 40  # whole office catalog, so the extension can prefetch it
        assert ready["exercise"] == ready["exercises"][0]["key"] == "neck_tilt"

        ws.send_json({"type": "config", "exercise": "curl"})  # Workout set is not offered
        assert ws.receive_json()["type"] == "error"

        ws.send_json({"type": "config", "exercise": "nerve_glide"})
        assert ws.receive_json() == {"type": "config", "exercise": "nerve_glide", "calibrated": False}

        ws.send_bytes(jpeg(np.full((360, 480, 3), 40, np.uint8)))
        frame = ws.receive_json()
        assert frame["type"] == "frame" and frame["exercise"] == "nerve_glide"
        assert frame["landmarks"] is None and frame["feedback"][0]["code"] == "not_visible"
        assert frame["latency_ms"] > 0

        ws.send_bytes(b"not a jpeg")
        assert ws.receive_json()["type"] == "error"

        ws.send_json({"type": "config", "exercise": "burpee"})
        assert ws.receive_json()["type"] == "error"

        ws.send_json({"type": "config", "exercise": ["neck_tilt"]})
        assert ws.receive_json()["type"] == "error"


def test_privacy_toggle_controls_mask_field(client):
    blank = jpeg(np.full((360, 480, 3), 40, np.uint8))
    with client.websocket_connect("/ws", headers=EXT) as ws:
        ws.receive_json()  # ready

        ws.send_bytes(blank)
        assert "mask" not in ws.receive_json()  # off by default: no extra payload

        ws.send_json({"type": "privacy", "enabled": True})
        assert ws.receive_json() == {"type": "privacy", "enabled": True}
        ws.send_bytes(blank)
        frame = ws.receive_json()
        assert "mask" in frame and frame["mask"] is None  # nobody found -> client blurs everything

        ws.send_json({"type": "privacy", "enabled": "yes"})  # only a real true turns it on
        assert ws.receive_json() == {"type": "privacy", "enabled": False}

        ws.send_json(["not", "an", "object"])
        assert ws.receive_json()["type"] == "error"


def test_angle_mode_and_calibration_messages(client):
    blank = jpeg(np.full((360, 480, 3), 40, np.uint8))
    with client.websocket_connect("/ws", headers=EXT) as ws:
        ws.receive_json()  # ready

        ws.send_json({"type": "angles", "mode": "3d"})
        assert ws.receive_json() == {"type": "angles", "mode": "3d", "exercise": "neck_tilt"}
        ws.send_json({"type": "angles", "mode": "4d"})
        assert ws.receive_json()["type"] == "error"

        ws.send_json({"type": "config", "exercise": "sit_to_stand", "calibration": {"rest": 150, "target": 120}})
        assert ws.receive_json() == {"type": "config", "exercise": "sit_to_stand", "calibrated": True}
        ws.send_bytes(blank)
        th = ws.receive_json()["thresholds"]
        assert th["rest"] == 150 and th["target"] == 120 and th["calibrated"]
        assert th["default_rest"] == 155 and th["default_target"] == 110

        # Wrong direction for this exercise: error, then the switch happens with defaults.
        ws.send_json({"type": "config", "exercise": "sit_to_stand", "calibration": {"rest": 100, "target": 150}})
        assert ws.receive_json()["type"] == "error"
        assert ws.receive_json() == {"type": "config", "exercise": "sit_to_stand", "calibrated": False}

        ws.send_json({"type": "calibrate", "action": "start"})
        assert ws.receive_json() == {"type": "calibrate", "action": "start", "exercise": "sit_to_stand"}
        ws.send_bytes(blank)
        frame = ws.receive_json()
        assert frame["calibration"] == {"status": "recording", "reps": 0, "needed": 3}
        assert frame["angle_mode"] == "2d"  # nobody found: no world landmarks this frame

        ws.send_json({"type": "calibrate", "action": "cancel"})
        assert ws.receive_json()["action"] == "cancel"
        ws.send_bytes(blank)
        assert "calibration" not in ws.receive_json()

        ws.send_json({"type": "calibrate", "action": "explode"})
        assert ws.receive_json()["type"] == "error"


def test_firefox_extension_origin_is_accepted(client):
    with client.websocket_connect("/ws", headers={"origin": "moz-extension://2b7a1c9e-4f3d-4c55-9a51-3f0d6e8b1a22"}) as ws:
        assert ws.receive_json()["type"] == "ready"


@pytest.mark.parametrize("origin", ["http://127.0.0.1:47821", "http://localhost:3000"])
def test_loopback_origin_is_accepted(client, origin):
    with client.websocket_connect("/ws", headers={"origin": origin}) as ws:
        assert ws.receive_json()["type"] == "ready"


@pytest.mark.parametrize(
    "origin",
    [
        "http://127.0.0.1.evil.com",
        "http://localhost.evil.com:80",
        "https://127.0.0.1:47821",
        "http://127.0.0.1",
    ],
)
def test_lookalike_loopback_origin_is_rejected(client, origin):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws", headers={"origin": origin}) as ws:
            ws.receive_json()


def test_explicit_allowed_origins_replace_loopback_default(monkeypatch):
    monkeypatch.setattr(app_module, "ALLOWED_ORIGINS", {"https://coach.example"})
    assert origin_allowed("https://coach.example")
    assert not origin_allowed("http://127.0.0.1:47821")
    assert not origin_allowed("chrome-extension://abcdefghijklmnopabcdefghijklmnop")
def test_embed_page_wraps_a_valid_youtube_id(client):
    res = client.get("/embed/gBL3gYNtun0")
    assert res.status_code == 200
    assert "text/html" in res.headers["content-type"]
    assert "https://www.youtube-nocookie.com/embed/gBL3gYNtun0?" in res.text
    assert "loop=1" in res.text and "mute=1" in res.text and "autoplay=1" in res.text


def test_embed_page_rejects_bad_ids(client):
    assert client.get("/embed/not-an-id").status_code == 404
    assert client.get("/embed/%3Cscript%3E12").status_code == 404
