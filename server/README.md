# Pose server

Webcam frames in over WebSocket, pose analysis out. NestJS on Node, with TF.js BlazePose for pose detection.

Needs Node 24.9+: NestJS 12 ships as ESM, and this CommonJS build loads it through `require(esm)`, which Jest supports from Node 24.9.

```bash
cd server
npm install
npm run start:dev      # builds, then listens on http://127.0.0.1:8765 (ws path /ws)
npm test               # analysis unit tests + mask tests + end-to-end HTTP/WebSocket tests
```

Routes: `GET /health` (version + exercise catalog), `GET /privacy` (the store's privacy policy page), `GET /embed/:youtubeId` (demo clip wrapper), and the WebSocket on `/ws`. The protocol is documented at the top of [src/pose/protocol.ts](src/pose/protocol.ts). Keep it backward compatible (see [docs/deployment.md](../docs/deployment.md)).

Environment variables:

| Variable | Default | |
|---|---|---|
| `FORMCOACH_PORT` | `8765` (`8080` in Docker) | |
| `FORMCOACH_HOST` | `127.0.0.1` (`0.0.0.0` in Docker) | |
| `FORMCOACH_ALLOWED_ORIGINS` | unset | Comma-separated exact origins; replaces the extension + loopback default |
| `FORMCOACH_VERSION` | `dev` | Set from the Docker `VERSION` build arg |
| `FORMCOACH_TF_BACKEND` | `wasm` | `cpu` falls back to the pure-JS kernels |

## Layout

| File | |
|---|---|
| `src/main.ts` | Bootstrap, `ws` adapter |
| `src/app.controller.ts` | HTTP routes |
| `src/pose/pose.gateway.ts` | `@WebSocketGateway` on `/ws`: one handler per message type, per-connection session |
| `src/pose/protocol.ts` | Wire protocol; a `WsAdapter` message parser that turns binary frames into a `frame` event and JSON messages into events named by their `type`. Each client's messages run strictly in order |
| `src/config.ts` | Version, frame size limits, Origin allowlist (enforced in the handshake, HTTP 403) |
| `src/pose/pose-engine.ts` | BlazePose lite on the TF.js WASM backend: landmarks, world landmarks, person mask |
| `src/pose/mask.ts` | Person mask -> small feathered PNG for the client's privacy blur |
| `src/analysis/` | Rep counting, form rules, calibration, exercise catalog, demo clips |
| `models/blazepose/` | Committed TF.js graph models (8.5 MB); `npm run fetch-models` downloads them again |

## Notes

- **Model.** This server used to be Python with MediaPipe's `pose_landmarker_lite`. It now runs BlazePose (lite) through TF.js, which has the same 33-landmark topology, world landmarks in meters and a segmentation mask. The analysis layer is a line-by-line port: for identical landmarks it produces identical results. The model itself differs, though, so angles can be a few degrees off from the old server's. Check rep thresholds against real sessions when tuning.
- **Speed.** On an Apple Silicon laptop the WASM backend takes about 20 ms of inference per 480x360 frame after warm-up, and about 30 ms p50 / 40–55 ms p95 end to end with the privacy mask on. Each connected client costs one detector; the process sat at about 320–410 MB RSS across 1,600 frames on four sequential connections. Inference runs on the main event loop, so concurrent clients take turns. Move engines into `worker_threads` if Fly's `soft_limit = 4` sessions per Machine needs more headroom.
- **Losing the person.** BlazePose keeps tracking from the previous frame's region, so after a person leaves the frame one more frame may still report a pose before it reports nobody.
