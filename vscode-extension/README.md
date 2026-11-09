# StandUp Break for VS Code

Break reminders with webcam-scored exercises, driven from VS Code. It behaves like the Chrome extension in `../extension/`: same schedule, XP, levels and leaderboard.

## Quick start

1. **Build or get the `.vsix`.** From this folder run `npm install && npm run package`. It creates `standup-break-vscode-0.3.0.vsix`.
2. **Install it.** In VS Code open the Extensions view, click `...`, choose **Install from VSIX...** and pick the file. Or from a terminal: `code --install-extension standup-break-vscode-0.3.0.vsix --force`. On macOS, if `code` is not found, use `"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"` instead, or run **Shell Command: Install 'code' command in PATH** from the Command Palette.
3. **Reload VS Code** (Command Palette, **Developer: Reload Window**). A `StandUp` item appears in the status bar.
4. **Set up.** On the first run the Settings page opens. Pick your muscle areas and click **Get started**. You can reopen it any time with **StandUp Break: Settings**.
5. **Try a break.** Click `StandUp` in the status bar and choose **Break now**. With the default `openIn: browser` the page opens in your default browser; allow the camera when asked.
6. **Automatic reminders.** In Settings, check that today is a work day, that the current time is inside your active hours, and set the interval (use a short custom one such as 1 minute to test). When a break is due, a dialog appears; click **Start**.

### Troubleshooting

- **No reminder appears.** Run **StandUp Break: Show log** and read the `idleState` and reminder lines. The defaults only remind on weekdays during 09:00 to 17:00, and a reminder is held back when VS Code is not focused and idle for 5 minutes.
- **Break page opens but the coach says it's unavailable.** The pose model runs in the page and needs WebAssembly; use a current Chrome, Edge or Firefox as the default browser.
- **Nothing happens on Break now.** Open **StandUp Break: Show log**, and check **Developer: Show Running Extensions** to confirm StandUp Break is active.

## How it works

- The unmodified `extension/service-worker.js` runs inside the VS Code extension host (Node) against a fake `chrome.*` object.
- The unmodified pages (`break.html`, `trainer.html`, `popup.html`, `options.html`) are copied into `web/` by `scripts/sync-web.mjs` and served from a local HTTP server on `127.0.0.1`. A small `chrome.*` shim is injected into each page.
- A status-bar item shows the countdown to the next break.

## Camera

By default (`standupBreak.openIn: browser`) Break and Practice open in your default browser, where the webcam works. Dashboard and Settings always open in VS Code panels.

Set `standupBreak.openIn` to `editor` to open Break and Practice in a VS Code editor panel too. VS Code webviews block `getUserMedia`, so in this mode there is no webcam and exercises are not scored by camera; the pages show "camera unavailable".

Webcam scoring needs no server: the pose model ships with the pages (`lib/vendor/mediapipe/`) and runs in the browser, so camera frames never leave your computer. Sign-in, the leaderboard and sync are optional and use the API server in `server/` (see the root README). It accepts pages served from `127.0.0.1` and `localhost`, which is how the VS Code extension's pages call it.

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
