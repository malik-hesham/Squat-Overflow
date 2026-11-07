# Squat Overflow

A Chrome extension that reminds you to move. When a break is due it opens a 2-minute routine for the pain areas you picked: neck tension, rounded shoulders, upper back, shoulder and rotator cuff, lower back, wrist and hand, knees, and (optionally) eyes. Each area has five exercises. Your webcam scores how well you do each exercise, and the score turns into XP, levels, challenges and badges. In Competitive mode your score also appears on a company leaderboard.

## Run the demo

1. **Pose server** (Python 3.10–3.12):
   ```bash
   cd server
   python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
   .venv/bin/python app.py        # listens on ws://127.0.0.1:8765/ws
   ```
2. **Extension**: open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and pick `extension/`. The settings page opens. Pick your areas and click **Get started**.
3. **Leaderboard**: the team's Supabase project already has the schema; the SQL lives in `supabase/migrations/` and the release workflow applies new files there. For your own project, run `npx supabase@2.122.1 link --project-ref <ref>` then `npx supabase@2.122.1 db push`. `extension/config.js` already holds the project URL and the publishable key. Never put a secret or `service_role` key there.
4. **Try it**: click the toolbar icon, then **Break now**. To see automatic reminders, set a custom interval of 1 minute and include today in your workdays.

## Releases and the hosted pose server

Tagging `vX.Y.Z` (matching `extension/manifest.json`) runs `.github/workflows/release.yml`. It applies the database migrations, deploys the pose server to Fly.io (`wss://squat-overflow-pose.fly.dev/ws`), creates a GitHub Release with the store zip, and submits the zip to the Chrome Web Store. Store builds use the hosted server; **Load unpacked** keeps using your local one. Release steps, one-time setup and rollback: [docs/deployment.md](docs/deployment.md). Store listing copy and permission justifications: [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md).

## Colleagues sharing one pose server (optional)

On the machine running the server:

```bash
cloudflared tunnel --url http://127.0.0.1:8765
```

Each colleague opens Settings, then Advanced, and sets **Pose server URL** to `wss://<subdomain>.trycloudflare.com/ws`.

**Privacy:** blurred mode blurs only the on-screen preview. The pose server needs the real camera frames, so through a tunnel those frames travel over HTTPS to the machine running the server, and with the store build they go over WSS to the hosted server on Fly.io in Frankfurt. They are processed in memory and never written to disk or logged. Only your name, company domain, XP, level, streak and avatar go to the leaderboard, and only in Competitive mode. Full policy: `server/static/privacy.html` (served at `/privacy`).

## Tests

```bash
cd server && .venv/bin/pytest -q
node extension/tests/check.mjs
```
