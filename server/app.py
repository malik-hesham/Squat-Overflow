"""FormCoach POC server: webcam frames in over WebSocket, pose analysis out.

Run:  python app.py            (listens on 127.0.0.1:8765)

Protocol on ws://127.0.0.1:8765/ws
  client -> server  text   {"type": "config", "exercise": "neck_tilt"}
                    text   {"type": "reset"}
                    text   {"type": "privacy", "enabled": true}
                    text   {"type": "angles", "mode": "3d"}         2d | 3d
                    text   {"type": "calibrate", "action": "start"}  start | cancel
                    text   {"type": "config", "exercise": "...",
                            "calibration": {"rest": 150, "target": 110}}  optional
                    binary JPEG frame
  server -> client  {"type": "ready", ...}      once, after connect
                    {"type": "config", ...}     after config/reset
                    {"type": "privacy", ...}    after privacy
                    {"type": "angles", ...}     after angles
                    {"type": "calibrate", ...}  after calibrate
                    {"type": "frame", ...}      one per binary frame; with privacy
                                                on it carries "mask": a PNG data URL
                                                whose alpha is the person, or null.
                                                While calibrating it carries
                                                "calibration": {"status": ...}
                    {"type": "error", ...}
The client should keep one frame in flight at a time (send the next frame
when the previous result arrives); that gives natural back-pressure.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from analysis import calibration
from analysis.demos import DEMOS
from analysis.exercises import CATALOG, DEFAULT_EXERCISE
from analysis.geometry import CONNECTIONS
from analysis.session import Session
from pose_engine import MODEL_PATH, PoseEngine, decode_jpeg, encode_mask, ensure_model

MAX_FRAME_BYTES = 2 * 1024 * 1024

# Comma-separated list of exact origins, e.g. "chrome-extension://abcdef...".
# Unset = accept any Chrome or Firefox extension. Web pages are always refused, so a site
# you visit can't stream frames to (or read results from) this local server.
ALLOWED_ORIGINS = {o.strip() for o in os.environ.get("FORMCOACH_ALLOWED_ORIGINS", "").split(",") if o.strip()}

@asynccontextmanager
async def lifespan(_: FastAPI):
    await asyncio.to_thread(ensure_model)
    yield


app = FastAPI(title="FormCoach POC", lifespan=lifespan)


@dataclass
class Connection:
    """Per-WebSocket state."""

    session: Session
    privacy: bool = False  # True: include a person mask with each frame result


def origin_allowed(origin: str | None) -> bool:
    if origin is None:  # non-browser client (tests, scripts); browsers always send Origin
        return True
    if ALLOWED_ORIGINS:
        return origin in ALLOWED_ORIGINS
    return origin.startswith(("chrome-extension://", "moz-extension://"))


def exercise_catalog() -> list[dict]:
    return [
        {"key": e.key, "label": e.label, "metric": e.metric, "camera": e.camera,
         "category": e.category, "how_to": e.how_to,
         "demo": DEMOS[e.key].to_json() if e.key in DEMOS else None}
        for e in CATALOG.values()
    ]


@app.get("/health")
def health() -> dict:
    return {"ok": True, "exercises": exercise_catalog()}


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket) -> None:
    if not origin_allowed(websocket.headers.get("origin")):
        await websocket.close(code=1008)
        return
    await websocket.accept()

    conn = Connection(Session(DEFAULT_EXERCISE))
    engine: PoseEngine | None = None  # loaded on the first frame, so catalog-only clients stay cheap
    t0 = time.monotonic()
    await websocket.send_json(
        {"type": "ready", "exercises": exercise_catalog(), "connections": CONNECTIONS, "exercise": DEFAULT_EXERCISE}
    )
    try:
        while True:
            msg = await websocket.receive()
            if msg["type"] == "websocket.disconnect":
                break
            if msg.get("text") is not None:
                await _handle_text(websocket, conn, msg["text"])
                continue
            data = msg.get("bytes")
            if not data:
                continue
            if len(data) > MAX_FRAME_BYTES:
                await websocket.send_json({"type": "error", "message": "frame too large"})
                continue

            started = time.perf_counter()
            if engine is None:
                engine = await asyncio.to_thread(PoseEngine, MODEL_PATH)
            rgb = decode_jpeg(data)
            if rgb is None:
                await websocket.send_json({"type": "error", "message": "could not decode frame"})
                continue
            now = time.monotonic() - t0
            landmarks, world, mask = await asyncio.to_thread(engine.detect, rgb, int(now * 1000))
            h, w = rgb.shape[:2]
            result = conn.session.process(landmarks, w, h, now, world)
            result["type"] = "frame"
            result["landmarks"] = (
                [[round(x, 4), round(y, 4), round(v, 3)] for x, y, v in landmarks] if landmarks else None
            )
            if conn.privacy:
                # None = no person found; the client then blurs the whole frame.
                result["mask"] = encode_mask(mask, landmarks) if mask is not None else None
            result["latency_ms"] = round((time.perf_counter() - started) * 1000, 1)
            await websocket.send_json(result)
    except WebSocketDisconnect:
        pass
    finally:
        if engine is not None:
            engine.close()


async def _handle_text(websocket: WebSocket, conn: Connection, text: str) -> None:
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        await websocket.send_json({"type": "error", "message": "invalid JSON"})
        return
    if not isinstance(payload, dict):
        await websocket.send_json({"type": "error", "message": "expected a JSON object"})
        return
    session = conn.session
    kind = payload.get("type")
    if kind == "privacy":
        conn.privacy = payload.get("enabled") is True
        await websocket.send_json({"type": "privacy", "enabled": conn.privacy})
        return
    if kind == "angles":
        mode = payload.get("mode")
        if mode not in ("2d", "3d"):
            await websocket.send_json({"type": "error", "message": f"unknown angle mode {mode!r}"})
            return
        session.set_angle_mode(mode == "3d")
        await websocket.send_json({"type": "angles", "mode": mode, "exercise": session.exercise.key})
        return
    if kind == "calibrate":
        action = payload.get("action")
        if action == "start":
            session.start_calibration()
        elif action == "cancel":
            session.cancel_calibration()
        else:
            await websocket.send_json({"type": "error", "message": f"unknown calibrate action {action!r}"})
            return
        await websocket.send_json({"type": "calibrate", "action": action, "exercise": session.exercise.key})
        return
    if kind == "config":
        key = payload.get("exercise", "")
        if not isinstance(key, str) or key not in CATALOG:  # Workout exercises exist server-side but are not offered
            await websocket.send_json({"type": "error", "message": f"unknown exercise {key!r}"})
            return
        thresholds = None
        cal = payload.get("calibration")
        if cal is not None:
            thresholds = calibration.validate(CATALOG[key], *(
                (cal.get("rest"), cal.get("target")) if isinstance(cal, dict) else (None, None)
            ))
            if thresholds is None:
                await websocket.send_json({"type": "error", "message": "invalid calibration"})
                # Fall through with defaults: the exercise switch itself is still valid.
        session.set_exercise(key, thresholds)
    elif kind == "reset":
        session.reset()
    else:
        await websocket.send_json({"type": "error", "message": f"unknown message type {kind!r}"})
        return
    await websocket.send_json(
        {"type": "config", "exercise": session.exercise.key, "calibrated": session.thresholds is not None}
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("FORMCOACH_PORT", "8765")))
