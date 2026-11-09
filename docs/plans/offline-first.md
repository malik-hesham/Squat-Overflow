# Offline-first: drop the pose server

brief: Pose detection, rep counting and form scores run on the user's own device in every client, so a break works with no network and no server. The server in `server/` stops being a pose server: it keeps Google sign-in, the team leaderboard and cross-device sync, which only run when the user has signed in. Signed out, everything is saved on the device and nothing goes over the network. Work branch: `feat/offline-first` (from `main`).

gates:
- `node extension/tests/check.mjs` and `cd extension && npm run typecheck`
- `cd mobile && npx jest && npx tsc --noEmit`
- `cd server && npm test && npm run typecheck`
- `cd vscode-extension && npm test`
- `node --test 'deploy/tests/*.test.mjs'` and `node --test 'scripts/tests/*.test.mjs'`
- `cd macos && xcodegen && xcodebuild -scheme SquatOverflowBar test`
- Browser, needs Playwright and a Chromium: `PLAYWRIGHT=<playwright/index.mjs> [CHROME=<chromium>] node extension/tests/e2e/break-offline.mjs` and `… trainer-offline.mjs`

Every item is done test-first (`/tdd-workflow`): a failing test, the minimum code to pass it, then refactoring under green tests.

## Where the pose work happens today

| | Chrome extension | Mobile | Mac menu bar |
|---|---|---|---|
| Pose model | Server: TF.js BlazePose lite over `WS /ws` (JPEG frames in, landmarks out) | On the phone: MediaPipe `pose_landmarker_lite.task` (`modules/squat-pose`) | No camera |
| Rep counting, form, calibration | Server: `server/src/analysis/` | On the phone: a separate TS port in `mobile/src/pose/analysis/` | none |
| Exercise catalog, demo clips | Server: `ready` message, `GET /health`, `GET /embed/:id` | `mobile/src/pose/analysis/catalog.ts`, `demos.ts` | none |
| Privacy blur mask | Server: `server/src/pose/mask.ts` (PNG data URL) | `expo-blur` (`src/pose/privacy.ts`) | none |
| Sign-in, leaderboard, sync | Server HTTP API (`API_URL`) | same | same |

So the analysis exists twice (server and mobile), and the extension can't run a break without a reachable server. A release build can't even be made without one (`scripts/build-extension.mjs` requires `POSE_SERVER_URL`).

## Design (decided, do not re-decide)

**One analysis module, in the extension.** The analysis moves to `extension/lib/pose/` as plain ES modules with JSDoc types, like the rest of `extension/lib`. It is a port of the existing TS port (see item 1), not a rewrite. Mobile drops its own port and imports these modules through `mobile/src/pose/analysis/index.ts`, like `src/core/shared.ts` does for the other modules. The macOS app has no camera, so it needs none of it.

**The extension runs the same model as the phone.** `@mediapipe/tasks-vision` `PoseLandmarker` with the same `pose_landmarker_lite.task` file as `mobile/modules/squat-pose/assets/`, in VIDEO mode, GPU delegate with a CPU fallback. MV3 forbids remote code, so the WASM runtime and the model are vendored in `extension/lib/vendor/mediapipe/` and loaded from the extension. The manifest CSP adds `'wasm-unsafe-eval'` to `script-src`, nothing else.

**The protocol stays; only the transport goes.** The server's gateway logic (`config`, `reset`, `privacy`, `angles`, `calibrate`, `frame` replies, error texts) is ported to a pure `extension/lib/pose/gateway.js` with the detector injected. `extension/lib/pose/local-socket.js` wraps it in a WebSocket-like object (`send`, `readyState`, `open`/`message`/`close` events), so `lib/pose-client.js` and `trainer.js` keep their message handling and only swap `new WebSocket(serverUrl)` for `openPoseSocket()`. Frames are passed as the video element instead of JPEG bytes. One frame in flight at a time, as now.

**The privacy mask is made on the device.** `server/src/pose/mask.ts` (resize, skeleton cover, dilation, feather) is ported to `extension/lib/pose/mask.js` minus the PNG step: it returns `{ width, height, alpha }`, and `pose-client.js` draws it from a small canvas instead of decoding a data URL. Camera frames never leave the device.

**No pose server setting.** `serverUrl` leaves `SETTINGS_DEFAULTS`, the options page and the trainer; a stored value is deleted on upgrade. `POSE_SERVER_URL`, `lib/server-status.js`, the "server busy"/"server offline" states and their i18n strings go. The extension's CSP drops the `ws://` and `trycloudflare.com` entries.

**The API server is optional.** `API_URL` in `extension/config.js` may be empty. With it empty (the default for a build with no `API_URL` set), the extension hides sign-in and the leaderboard and makes no network requests. `scripts/build-extension.mjs` takes an optional `API_URL=https://…` instead of a required `POSE_SERVER_URL`. Mobile and macOS already skip sync when `API_URL` is unset; they follow the same rule.

**Signed in: sync. Signed out: local only.** This is the existing sync design (`docs/plans/cross-platform-sync.md`): breaks wait in the outbox and go up when the user is signed in and online. Signed out, `syncNow` returns `signed-out` before any request. This plan only adds tests that pin "no request while signed out" and "offline keeps the outbox" in each client.

**Demo clips open YouTube, not our server.** The break page stops wrapping clips in `GET /embed/:id`. It opens the clip the way the trainer already does (YouTube's own page in a small popup window), and hides the button while `navigator.onLine` is false. Demos are the only online part of a break.

**The server shrinks.** It drops `src/pose/`, `src/analysis/`, `src/catalog.ts`, `models/`, `GET /embed/:id`, the `/ws` gateway, the TF.js, `pngjs` and `ws` dependencies and `FORMCOACH_MAX_SESSIONS`. `GET /health` returns `{ version }`. It keeps auth, leaderboard, sync, `/privacy` and `/auth/mobile-callback`. Docs call it "the API server". The single-host AWS design is unchanged and costs nothing extra; the server needs less memory, so `deploy/` keeps the same Free-tier instance type.

## Items

- [x] 1. Shared analysis in `extension/lib/pose/`. Done: `extension/lib/pose/*.js` (JS + JSDoc), `mobile/src/pose/analysis/index.ts` is a one-line re-export and the TS port is deleted; mobile's analysis tests import `extension/lib/pose/*.js` directly; two smoke checks in `extension/tests/check.mjs`.
      Ported from mobile's TS (`mobile/src/pose/analysis`), not the server's: both are line-by-line ports of the Python server checked against the same Python-recorded fixtures, mobile's suite pins more of it (464 tests with the parity fixtures, a superset of `server/test/analysis/`: 3D angles, calibration, demos and the office moves are all there), and its API is the one the phone already calls. So the server's analysis specs don't need moving; they go with the server code in item 7.
      verify: `cd mobile && npx jest && npx tsc --noEmit` (464 pass, clean); `node extension/tests/check.mjs` (122 ok); `cd extension && npm run typecheck` (clean).

- [x] 2. Local gateway and mask: `extension/lib/pose/gateway.js`, `mask.js`. Done: 11 checks in `extension/tests/check.mjs` ("pose gateway: …", "pose mask: …"). `gateway.handle(message)` returns the replies as an array; a frame the detector throws on answers `could not read frame`.
      `createPoseGateway({ detect, now })` answers the same messages as `server/src/pose/pose.gateway.ts`: `ready` (catalog, connections, default exercise), `config` (unknown exercise, invalid calibration then defaults), `reset`, `privacy`, `angles`, `calibrate`, `frame` (rounded landmarks, `mask` only with privacy on, `null` when nobody is found). `mask.js` ports `encodeMask` up to the alpha channel.
      Red first, from the behavior pinned in `server/test/server/server.spec.ts` and `mask.spec.ts`, with a fake `detect`. Those server specs are deleted in item 7, so nothing is lost.
      verify: `node extension/tests/check.mjs`.

- [x] 3. On-device detector: `extension/lib/pose/detector.js`, `local-socket.js`, vendored MediaPipe. Done: `@mediapipe/tasks-vision` 1.2.2 (the version mobile's Android build uses), `npm run vendor` (`extension/scripts/vendor-mediapipe.mjs`) writes `lib/vendor/mediapipe/` (bundle + `vision_bundle.d.mts`, `vision_wasm_internal.{js,wasm}`, the model, LICENSE; about 21 MB). Socket `message` events carry reply objects, not JSON (the mask is a typed array). The gateway passes `{ mask }` to `detect`, so segmentation only runs while privacy blur is on. 8 checks.
      Add `@mediapipe/tasks-vision` as a dev dependency of `extension/` and a `npm run vendor` script that copies its ESM bundle and WASM files into `lib/vendor/mediapipe/`, plus the model from `mobile/modules/squat-pose/assets/`. `detector.js` returns `{ landmarks, world, mask }` per frame, the shape the gateway takes. `local-socket.js` connects gateway and detector.
      Red: a check that the vendored model has the same SHA-256 as the mobile one; checks for `local-socket.js` with a fake detector (open, ready first, one reply per message, close stops replies). The detector itself is browser-only and is covered by item 4's end-to-end run.
      verify: `node extension/tests/check.mjs`; `cd extension && npm run typecheck`.

- [x] 4. Break page on the device. Done: `extension/tests/e2e/break-offline.mjs` (run with `PLAYWRIGHT=<playwright/index.mjs> [CHROME=<chromium>] node extension/tests/e2e/break-offline.mjs`): offline, fake camera, privacy off and on, about 20 analyses a second, Done ends the break, all requests `chrome-extension://`. Found on the way: without a server round trip the model answers in ~6 ms, so `pump()` spun on the main thread and froze the page; it now waits for each new camera frame (`requestVideoFrameCallback`). The demo iframe became a "Watch demo" button (popup, like the trainer), hidden offline. A model that can't load shows "Pose coach unavailable".
      `lib/pose-client.js` uses `openPoseSocket()`, passes the video element as the frame, and draws the local mask. `break.js` takes the catalog from `lib/pose`, opens demos the trainer's way, and loses the server status UI. Manifest CSP: `'wasm-unsafe-eval'`, no `ws://` entries.
      Red: a Playwright run of `break.html` with Chromium's fake camera (`--use-fake-device-for-media-stream`) and every non-extension request blocked. It fails today with "server offline". Green when the break gets `frame` results, shows the skeleton and finishes.
      verify: the Playwright run; `node extension/tests/check.mjs`.

- [x] 5. Trainer on the device. Done: `extension/tests/e2e/trainer-offline.mjs`. `avatar-global.js` exposes `globalThis.PoseLocal` (catalog, skeleton, socket); the trainer lost its fallback catalog, catalog cache, prefetch, reconnect loop and "Server" settings card.
      `trainer.js` swaps its two `new WebSocket(...)` calls for `openPoseSocket()` and drops the server URL field and the 1013 handling.
      verify: Playwright run of `trainer.html` with the network blocked: calibration starts and the rep counter moves.

- [x] 6. No pose server setting; optional API server. Done: `store.dropRetiredKeys()` (run from `onInstalled`, so updates clean up) deletes `serverUrl` and the old `exerciseCatalog` cache; `lib/server-status.js` and the pose-server strings are gone; `scripts/build-extension.mjs` takes an optional `API_URL` (https only, added to `connect-src`; loopback entries dropped; `POSE_SERVER_URL` refused with a pointer), leaves out `scripts/` and `*.d.mts`; `scripts/tests/build-extension.test.mjs` (4 tests, `node --test scripts/tests/*.test.mjs`). "No request while signed out / without `API_URL`" was already pinned ("sync: signed out or unconfigured never calls the server"). Hiding sign-in and the board in a local-only build is UI wiring, checked with a Playwright smoke run of a built package, not an automated test.
      Remove `serverUrl` from `lib/store.js` defaults (and delete the stored key), the options page, `sync-core.js`'s per-device key list and the server's settings validator; remove `POSE_SERVER_URL`, `lib/server-status.js`, `errServer` and the busy/offline strings from every language in `lib/i18n.js`. `API_URL = ""` hides sign-in and the leaderboard. `scripts/build-extension.mjs` takes an optional `API_URL`.
      Red: checks that `SETTINGS_DEFAULTS` has no `serverUrl`, that a stored `serverUrl` is removed on start-up, that `syncNow` with no session or no `API_URL` calls `fetch` zero times, and that a build without `API_URL` succeeds with no `connect-src` entry for a server.
      verify: `node extension/tests/check.mjs`; `cd extension && npm run typecheck`; `node scripts/build-extension.mjs`.

- [x] 7. Server: API only. Done: `test/server/server.spec.ts` pins `/health` = `{ ok, version }`, `/embed` 404 and no `/ws`; the WebSocket origin tests became `originAllowed()` tests (the allowlist still guards CORS). 113 tests pass, typecheck clean, `package-lock.json` lost 1,051 lines. Not verified here: `docker build` (no Docker on this machine).
      Delete the pose gateway, protocol, engine, mask, analysis, catalog, `/embed`, `models/`, `scripts/fetch-models.mjs`, the TF.js/`pngjs`/`ws` dependencies and `FORMCOACH_MAX_SESSIONS`; `/health` returns `{ version }`. Update the Dockerfile.
      Red: `test/server/api.spec.ts` expects `/health` to have no `exercises`, `GET /embed/x` to be 404, and a WebSocket upgrade on `/ws` to fail.
      verify: `cd server && npm test && npm run typecheck`; `docker build server` succeeds and the image is smaller.

- [x] 8. Mobile. Done: the sync rules were already pinned ("nothing happens while signed out", "offline keeps the queue; back online it uploads once"). The fallback screen now uses the extension's `coachUnavailable`/`unavailableText` instead of mobile overrides of the removed `coachOffline`/`offlineText` (test in `src/core/__tests__/shared.test.ts`); the extension's text took mobile's "No XP this time." README table and comments updated. 465 tests pass.
      Nothing goes over the network for pose already. Pin the sync rule: `syncNow` with no session makes no request, and an upload that fails offline keeps the outbox (`src/core/__tests__/sync.test.ts`). Update the "How it maps to the extension" table in `mobile/README.md`: the analysis is now shared from `extension/lib/pose`.
      verify: `cd mobile && npx jest && npx tsc --noEmit`.

- [x] 9. macOS. Done: signed out, `refresh()` already returned before any request. New: `Config.serverURL` is optional (`serverURL(from:)`, nil when `SO_SERVER_URL` is empty or undefined), API and Auth throw `AuthError.noServer` without one, and the menu has no "Continue with Google" row then, matching the extension's local-only build. `SquatOverflowBarTests/ConfigTests.swift`; 14 tests pass.
      No pose code. Pin that a build with no server URL shows the signed-out view and makes no request (`SquatOverflowBarTests`), and rename "pose server" to "API server" in `macos/README.md` and `Config.swift`'s comment.
      verify: `xcodebuild -scheme SquatOverflowBar test`.

- [x] 10. VS Code extension. Done: `.wasm` is served as `application/wasm` (`.task` already was octet-stream); `scripts/sync-web.mjs` already copied all of `lib/`, vendored MediaPipe included. Test in `test/server.test.mjs`; 21 pass.
      Red: a `node --test` check that `GET <base>/lib/vendor/mediapipe/<wasm file>` returns 200 with `application/wasm`.
      verify: `cd vscode-extension && npm test`.

- [x] 11. Deploy and docs. Docs done: README, server/README, deployment, aws-free-plan, CHROMEWEBSTORE, privacy.html (adds the sync section it lacked), TODO, vscode-extension/README, CLAUDE.md item 1. Left on purpose: CLAUDE.md's AWS rules still say "pose server" (yours to reword), docs/superpowers/ and older plans (history). Deploy and CI done: `.env.example`, `docker-compose.yml`, `Caddyfile`, `aws-provision.sh`/`ec2-setup.sh` comments; `FORMCOACH_MAX_SESSIONS` gone; CI always builds the zip (optional `API_URL` repository variable replaces `POSE_SERVER_URL`), runs the build tests, and the image check lost its BlazePose step. The compose service `pose` and the AWS tag `squat-overflow-pose` keep their names on purpose: renaming them would start a second container or provision a second instance and Elastic IP next to the live ones. Docs: in progress.
      `deploy/`: the service is `api`, not `pose`; no WebSocket note in the Caddyfile; no `FORMCOACH_MAX_SESSIONS`; Postgres memory note updated. `deploy/tests/` keeps passing (no plan upgrade, Free-tier instance type). Cost change: none.
      Docs: `README.md`, `server/README.md`, `docs/deployment.md`, `docs/aws-free-plan.md`, `CHROMEWEBSTORE.md`, `server/static/privacy.html` and the manifest description say camera frames never leave the device and the server is only for optional sign-in, leaderboard and sync. `TODO.md`: the redirect URI is on the API server.
      verify: `node --test 'deploy/tests/*.test.mjs'` (14 pass); server tests still 113 after the privacy page edit.

- [ ] 12. End-to-end check.
      With the network off: finish a break in Chrome, on the phone and in the VS Code extension; XP, streak and today's count update in each. Sign in on two clients, go online: each offline break uploads once and shows on the other client.

Items 2 and 3 depend on item 1. Items 4 and 5 depend on 2 and 3. Item 6 can run after item 4. Items 7–10 depend only on item 6. Item 11 comes last before 12.

## Risks and follow-ups

- **Model drift.** The extension moves from TF.js BlazePose (server) to MediaPipe's own lite model (the phone's). Angles can be a few degrees off from today's extension. The parity tests run on recorded landmarks, so they can't catch this; check rep thresholds on real sessions after item 4.
- **CPU on slow laptops.** Inference now runs in the user's browser. If the break page drops below about 10 frames a second on an older laptop, move the detector into a dedicated worker (`OffscreenCanvas` + `ImageBitmap` transfer) before release.
- **Extension size.** The MediaPipe WASM (SIMD and non-SIMD builds) and the 5.5 MB model add roughly 25 MB to the zip. The Chrome Web Store allows that, but updates download it once.
- **Old builds.** Extension builds from before this change still need a pose server. Once the server drops `/ws`, those builds can't run a break until they update. Ship the extension update before deploying item 7.
