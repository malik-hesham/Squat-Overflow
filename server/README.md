# Pose server

Webcam frames in over WebSocket, pose analysis out; plus Google sign-in and the team leaderboard. NestJS on Node, with TF.js BlazePose for pose detection and Postgres for accounts and scores.

Needs Node 24.9+: NestJS 12 ships as ESM, and this CommonJS build loads it through `require(esm)`, which Jest supports from Node 24.9.

```bash
cd server
npm install
npm run start:dev      # builds, then listens on http://127.0.0.1:8765 (ws path /ws)
npm test               # unit, Postgres (in-process PGlite) and end-to-end HTTP/WebSocket tests
```

Routes:

| Route | |
|---|---|
| `GET /health` | Version + exercise catalog |
| `GET /privacy` | The store's privacy policy page |
| `GET /embed/:youtubeId` | Demo clip wrapper |
| `WS /ws` | Pose stream; protocol at the top of [src/pose/protocol.ts](src/pose/protocol.ts). Keep it backward compatible (see [docs/deployment.md](../docs/deployment.md)) |
| `POST /auth/google` `{id_token, nonce}` | Exchange the extension's Google ID token (+ the raw nonce whose SHA-256 Google signed) for a session |
| `POST /auth/refresh` `{refresh_token}` | New session; the refresh token is single-use |
| `GET /leaderboard?period=week\|all` | Bearer token. My company's board: top 10, plus my row if I'm lower |
| `PUT /leaderboard/me` `{name, xp, level, streak, weekXp, week, avatar}` | Bearer token, work email. Upserts my score |
| `DELETE /leaderboard/me` | Bearer token. Leaves the board |

The company is the domain of the signed-in Google email. Personal providers (gmail.com, outlook.com, …) can sign in but get an empty board. Sessions have the same JSON shape Supabase Auth used to return: an HS256 access token (1 h) and a random refresh token (60 days, stored hashed, rotated on every refresh). Without `DATABASE_URL` the pose routes work and the auth/leaderboard routes answer 503.

Environment variables:

| Variable | Default | |
|---|---|---|
| `FORMCOACH_PORT` | `8765` (`8080` in Docker) | |
| `FORMCOACH_HOST` | `127.0.0.1` (`0.0.0.0` in Docker) | |
| `FORMCOACH_ALLOWED_ORIGINS` | unset | Comma-separated exact origins; replaces the extension + loopback default |
| `FORMCOACH_VERSION` | `dev` | Set from the Docker `VERSION` build arg |
| `FORMCOACH_TF_BACKEND` | `wasm` | `cpu` falls back to the pure-JS kernels |
| `DATABASE_URL` | unset | Postgres for accounts and the leaderboard; migrations run at startup |
| `AUTH_JWT_SECRET` | — | Required with `DATABASE_URL`; at least 32 characters. Signs session tokens |
| `GOOGLE_CLIENT_ID` | — | Required with `DATABASE_URL`; the OAuth client in `extension/config.js` |

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
| `src/auth/` | Google ID-token check, sessions (access + refresh tokens), `BearerGuard`, `/auth/*` |
| `src/leaderboard/` | Score validation, company-from-email, the board query, `/leaderboard` |
| `src/db/` | Postgres pool, migrations (`migrations.ts`) applied at startup under an advisory lock |
| `scripts/demo-seed.sql`, `demo-clear.sql` | Demo players for the leadliaison.com board |
| `models/blazepose/` | Committed TF.js graph models (8.5 MB); `npm run fetch-models` downloads them again |

## Notes

- **Model.** This server used to be Python with MediaPipe's `pose_landmarker_lite`. It now runs BlazePose (lite) through TF.js, which has the same 33-landmark topology, world landmarks in meters and a segmentation mask. The analysis layer is a line-by-line port: for identical landmarks it produces identical results. The model itself differs, though, so angles can be a few degrees off from the old server's. Check rep thresholds against real sessions when tuning.
- **Speed.** On an Apple Silicon laptop the WASM backend takes about 20 ms of inference per 480x360 frame after warm-up, and about 30 ms p50 / 40–55 ms p95 end to end with the privacy mask on. Each connected client costs one detector; the process sat at about 320–410 MB RSS across 1,600 frames on four sequential connections. Inference runs on the main event loop, so concurrent clients take turns. Move engines into `worker_threads` if Fly's `soft_limit = 4` sessions per Machine needs more headroom.
- **Losing the person.** BlazePose keeps tracking from the previous frame's region, so after a person leaves the frame one more frame may still report a pose before it reports nobody.
