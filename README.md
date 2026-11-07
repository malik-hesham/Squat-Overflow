# Squat Overflow

A Chrome extension that reminds you to move. When a break is due it opens a 2-minute routine for the muscle areas you picked. Your webcam scores how well you do each exercise, and the score turns into XP, levels, challenges and badges. In Competitive mode your score also appears on a company leaderboard.

VS Code user? See [vscode-extension/README.md](vscode-extension/README.md).

## Run the demo

1. **Pose server** (Python 3.10–3.12):
   ```bash
   cd server
   python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
   .venv/bin/python app.py        # listens on ws://127.0.0.1:8765/ws
   ```
2. **Extension**: open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and pick `extension/`. The settings page opens. Pick your areas and click **Get started**.
3. **Leaderboard**: open the Supabase project's **SQL Editor**, paste `supabase/leaderboard.sql`, and click **Run**. `extension/config.js` already holds the project URL and the publishable key. Never put a secret or `service_role` key there.
4. **Try it**: click the toolbar icon, then **Break now**. To see automatic reminders, set a custom interval of 1 minute and include today in your workdays.

## Colleagues sharing one pose server (optional)

By default the pose server accepts the browser extensions and pages served from 127.0.0.1 or localhost (used by the VS Code extension), and refuses other web pages.

On the machine running the server:

```bash
cloudflared tunnel --url http://127.0.0.1:8765
```

Each colleague opens Settings, then Advanced, and sets **Pose server URL** to `wss://<subdomain>.trycloudflare.com/ws`.

**Privacy:** blurred mode blurs only the on-screen preview. The pose server needs the real camera frames, so through a tunnel those frames travel over HTTPS to the machine running the server. They are processed in memory and never written to disk or logged. Only your name, XP, level and streak go to the leaderboard, and only in Competitive mode.

## Tests

```bash
cd server && .venv/bin/pytest -q
node extension/tests/check.mjs
```
