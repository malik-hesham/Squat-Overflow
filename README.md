# Squat Overflow

A Chrome extension that reminds you to move. When a break is due it opens a 2-minute routine for the pain areas you picked: neck tension, rounded shoulders, upper back, shoulder and rotator cuff, lower back, wrist and hand, knees, and (optionally) eyes. Each area has six exercises. Your webcam scores how well you do each exercise, and the score turns into XP, levels, challenges and badges. In Competitive mode your score also appears on a company leaderboard.

VS Code user? See [vscode-extension/README.md](vscode-extension/README.md).

## Run the demo

1. **Extension**: open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and pick `extension/`. The settings page opens. Pick your areas and click **Get started**.
2. **Try it**: click the toolbar icon, then **Break now**. To see automatic reminders, set a custom interval of 1 minute and include today in your workdays.

That's all a break needs. Pose detection, rep counting and form scoring run in the extension (MediaPipe's pose model, bundled in `extension/lib/vendor/mediapipe`, and the analysis in `extension/lib/pose`). Camera frames never leave your computer, and breaks work offline and signed out. Everything is saved on your computer.

### Restyle the exercise demo

The figure that shows each exercise is drawn on the device from `extension/lib/demo-model.js`. How the person looks is one small file, `extension/lib/demo-look.js`: the colours (skin, hair, top, bottoms, shoes), what each body part wears (long sleeves, trousers) and how thick each part is. Edit a value and reload; the extension, the desktop app and the phone all draw from it. `node extension/tests/check.mjs` checks the file.

### Add an exercise demo video

A move can show a short video of a person doing it instead of the figure. The API server serves it at `/demos/<move>.mp4`; the break window, the Practice page, the desktop app and the phone ask for it when the user opens the demo, and play it in place of the figure once it loads. Offline, with no video for the move, or in a build with no server, the figure stays.

Record one rep (or one rep each side) on a phone, held level, with the whole body in the middle of the frame and a plain wall behind. Then run (needs `ffmpeg`):

```bash
node extension/scripts/make-demo-video.mjs seated_march ~/Movies/march.mov --from 1.2 --to 5.4
```

It writes `server/demos/seated_march.mp4`: 480×480, 24 fps, H.264, no sound, at most 8 s and 500 KB, and able to start playing before it has all loaded. Commit it and deploy the server ([docs/aws-free-plan.md](docs/aws-free-plan.md#updating)); the image serves every file in `server/demos/`. `--remove <move>` takes a video out. `node extension/tests/check.mjs` checks every file in that folder.

The server publishes these videos, so use footage you made or have written permission to use. Clips copied from another website can't go in without the owner's permission.

### Sign-in, leaderboard and sync (optional)

These come from the API server in `server/` (Node 24.9+, NestJS + Postgres, see [server/README.md](server/README.md)). `API_URL` in `extension/config.js` points at it, `http://127.0.0.1:8765` by default:

```bash
cd server
npm install
DATABASE_URL=postgres://… AUTH_JWT_SECRET=<32+ random chars> GOOGLE_CLIENT_ID=<the client ID in extension/config.js> npm run start:dev
```

The server applies its schema at startup. Without `DATABASE_URL` those endpoints answer 503. Sync only runs while you're signed in: your breaks wait on your computer and go up when you're online. Signed out, nothing is sent.

## Releases

Tagging `vX.Y.Z` (matching `extension/manifest.json`) runs `.github/workflows/release.yml`, which builds the store zip, creates a GitHub Release with it, and submits it to the Chrome Web Store. With the `API_URL` repository variable set (`https://<your API server>`), the zip has sign-in, the leaderboard and sync. Without it, the zip is local only: no sign-in and no leaderboard. Running the API server (`server/Dockerfile`) is up to you. **Load unpacked** keeps using your local server. Release steps, one-time setup and rollback: [docs/deployment.md](docs/deployment.md). Store listing copy and permission justifications: [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md).

## Privacy

Blurred mode blurs the on-screen preview. The pose model runs in the extension, so camera frames are processed on your computer and never sent anywhere. The API server only gets something once you sign in: your account, your synced breaks and settings, and, in Competitive mode, your name, company domain, XP, level, streak and avatar for the leaderboard. Full policy: `server/static/privacy.html` (served at `/privacy`).

## Mobile app (iOS and Android)

`mobile/` is the same product as a React Native app (Expo + React Native Reusables). Pose detection runs on the phone with MediaPipe and the same model file, and it reuses the extension's pose analysis, XP, schedule, challenge and leaderboard logic from `extension/lib`. See [mobile/README.md](mobile/README.md).

## Desktop app (macOS, Windows, Linux): proof of concept

`desktop/` is a status bar app with a Rust shell (Tauri). It runs the extension's own pages and `service-worker.js`, unchanged, behind a small `chrome.*` shim, so it has no rules of its own to keep in step. See [desktop/README.md](desktop/README.md) for what has been checked and what hasn't.

## Tests

```bash
cd server && npm test
node extension/tests/check.mjs
node --test 'scripts/tests/*.test.mjs'
cd extension && npm ci && npm run typecheck
```

`extension/tests/e2e/` has Playwright checks that run a break and the Practice page offline in Chromium with a fake camera (see the top of each file).

The extension is plain JavaScript with no build step. `npm run typecheck` runs TypeScript over it (`checkJs`, nothing emitted) using JSDoc types and `@types/chrome`. CI runs it too.
