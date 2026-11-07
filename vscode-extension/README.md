# StandUp Break for VS Code

Break reminders with webcam-scored exercises, driven from VS Code. It behaves like the Chrome extension in `../extension/`: same schedule, XP, levels and leaderboard.

## How it works

- The unmodified `extension/service-worker.js` runs inside the VS Code extension host (Node) against a fake `chrome.*` object.
- The unmodified pages (`break.html`, `trainer.html`, `popup.html`, `options.html`) are copied into `web/` by `scripts/sync-web.mjs` and served from a local HTTP server on `127.0.0.1`. A small `chrome.*` shim is injected into each page.
- A status-bar item shows the countdown to the next break.

## Camera

By default (`standupBreak.openIn: browser`) Break and Practice open in your default browser, where the webcam works. Dashboard and Settings always open in VS Code panels.

Set `standupBreak.openIn` to `editor` to open Break and Practice in a VS Code editor panel too. VS Code webviews block `getUserMedia`, so in this mode there is no webcam and exercises are not scored by camera; the pages show "camera unavailable".

Webcam scoring needs the pose server: run `server/` as described in the root README (`ws://127.0.0.1:8765/ws` by default). The pose server accepts pages served from `127.0.0.1` and `localhost`, which is how the VS Code extension's pages connect; restart a server started before this change.

Automatic reminders first show a modal dialog with a Start button. It stays until answered. Start opens the break page; closing the dialog without Start skips that break, and the next reminder comes at the next interval. Manual breaks (`Break now`) open immediately.

Reminders follow the schedule in Settings (work days, active hours, interval). A reminder is held back when VS Code is not focused and there has been no editor or terminal activity for 5 minutes. A focused VS Code window always counts as active.

## Commands

- `StandUp Break: Break now`
- `StandUp Break: Pause 1 hr`
- `StandUp Break: Resume`
- `StandUp Break: Dashboard`
- `StandUp Break: Settings`
- `StandUp Break: Practice`
- `StandUp Break: Show menu` (also opens when you click the status-bar item)
- `StandUp Break: Show log` (opens the "StandUp Break" output channel with idle and reminder decisions)

## Settings

- `standupBreak.port` (default 47821): preferred local server port. A random free port is used if it is busy.
- `standupBreak.openIn` (`browser` or `editor`, default `browser`): `browser` opens Break and Practice in your default browser with the webcam; `editor` opens them in a VS Code panel without webcam.

## Develop and package

- Develop: open `vscode-extension/` in VS Code and press F5 ("Run Extension").
- Test: `npm test`
- Package: `npm install && npm run package` produces a `.vsix`.

## Privacy

The server binds to `127.0.0.1` only. Every URL carries a random token generated per session, and requests with a foreign `Host` or `Origin` are rejected. No cookies are used.
