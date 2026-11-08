# Squat Overflow

A Chrome extension that reminds you to move. When a break is due it opens a 2-minute routine for the pain areas you picked: neck tension, rounded shoulders, upper back, shoulder and rotator cuff, lower back, wrist and hand, knees, and (optionally) eyes. Each area has five exercises. Your webcam scores how well you do each exercise, and the score turns into XP, levels, challenges and badges. In Competitive mode your score also appears on a company leaderboard.

VS Code user? See [vscode-extension/README.md](vscode-extension/README.md).

## Run the demo

1. **Pose server** (Node 24.9+; NestJS + TF.js BlazePose, see [server/README.md](server/README.md)):
   ```bash
   cd server
   npm install
   npm run start:dev              # listens on ws://127.0.0.1:8765/ws
   ```
2. **Extension**: open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and pick `extension/`. The settings page opens. Pick your areas and click **Get started**.
3. **Leaderboard**: sign-in and the leaderboard are served by the hosted pose server (`API_URL` in `extension/config.js`), so unpacked builds share the team board. To run them locally too, give the local server a Postgres database: `DATABASE_URL=postgres://… AUTH_JWT_SECRET=<32+ random chars> GOOGLE_CLIENT_ID=<the client ID in extension/config.js> npm run start:dev`, and point `API_URL` at `http://127.0.0.1:8765` (also add it to the manifest CSP `connect-src`). The server applies its schema at startup.
4. **Try it**: click the toolbar icon, then **Break now**. To see automatic reminders, set a custom interval of 1 minute and include today in your workdays.

## Releases and the hosted pose server

Tagging `vX.Y.Z` (matching `extension/manifest.json`) runs `.github/workflows/release.yml`. It applies the database migrations, deploys the pose server to Fly.io (`wss://squat-overflow-pose.fly.dev/ws`), creates a GitHub Release with the store zip, and submits the zip to the Chrome Web Store. Store builds use the hosted server; **Load unpacked** keeps using your local one. Release steps, one-time setup and rollback: [docs/deployment.md](docs/deployment.md). Store listing copy and permission justifications: [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md).

## Colleagues sharing one pose server (optional)

By default the pose server accepts the browser extensions and pages served from 127.0.0.1 or localhost (used by the VS Code extension), and refuses other web pages.

On the machine running the server:

```bash
cloudflared tunnel --url http://127.0.0.1:8765
```

Each colleague opens Settings, then Advanced, and sets **Pose server URL** to `wss://<subdomain>.trycloudflare.com/ws`.

**Privacy:** blurred mode blurs only the on-screen preview. The pose server needs the real camera frames, so through a tunnel those frames travel over HTTPS to the machine running the server, and with the store build they go over WSS to the hosted server on Fly.io in Frankfurt. They are processed in memory and never written to disk or logged. Only your name, company domain, XP, level, streak and avatar go to the leaderboard, and only in Competitive mode. Full policy: `server/static/privacy.html` (served at `/privacy`).

## Mobile app (iOS and Android)

`mobile/` is the same product as a React Native app (Expo + React Native Reusables). Pose detection runs on the phone with MediaPipe, so it needs no pose server, and it reuses the extension's XP, schedule, challenge and leaderboard logic from `extension/lib`. See [mobile/README.md](mobile/README.md).

## Tests

```bash
cd server && npm test
node extension/tests/check.mjs
cd extension && npm ci && npm run typecheck
```

The extension is plain JavaScript with no build step. `npm run typecheck` runs TypeScript over it (`checkJs`, nothing emitted) using JSDoc types and `@types/chrome`. CI runs it too.
