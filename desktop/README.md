# Squat Overflow for the desktop (proof of concept)

One status bar app for macOS, Windows 10 and later, and Linux, with a Rust shell ([Tauri 2](https://tauri.app)).

It doesn't port the extension. It runs it. The app's windows show the extension's own pages (`popup.html`, `options.html`, `break.html`, `trainer.html`), and a page that is never shown runs the extension's `service-worker.js`. All of them load unchanged from `extension/`. The Rust shell does what the browser does for an extension: the status bar icon, the windows, storage, alarms and the idle time. A small script, `shim/chrome-shim.js`, gives the pages the `chrome.*` calls they use and passes each one to the shell.

So every rule (schedule, XP, streaks, challenges, badges, the routine, pose analysis, i18n) is the extension's code, not a copy of it. The root `CLAUDE.md` asks every client to follow the extension, and this client does it by construction: a rule changed in `extension/lib` changes here on the next build, with no fixtures to regenerate.

This is a proof of concept. "What has been checked" below says what has run and what hasn't.

## How it maps to the extension

| Extension | Desktop app |
|---|---|
| Toolbar button and its badge (countdown) | Status bar icon. The badge text (`23m`, `45s`, `move`) is the title next to the icon on macOS and on Linux trays that show labels. On Windows it's in the tooltip and the menu's first line |
| Popup (`popup.html`) | The same page. A left click on the icon opens it under the icon (macOS) or above it (Windows), and it closes when you click elsewhere. On Linux, where a tray reports no clicks, **Open Squat Overflow** in the menu opens it as a small window |
| — | Right-click menu: the next-break line, Open, **Break now**, **Pause 1 hr** / **Resume**, **Settings**, Quit. The three in bold send `service-worker.js` the same messages as the popup's buttons, and their labels are the extension's strings in the user's language (`shim/background.js`) |
| Options page (`options.html`) | The same page in a window, opened on first run like the options page on install |
| Break window (`break.html`), Practice (`trainer.html`) | The same pages in windows, opened by `service-worker.js` through `chrome.windows.create` |
| Service worker (`service-worker.js`) | The same file, in a hidden window (`shim/background.html`) |
| `chrome.storage.local` | `store.json` with the same keys, in the app's data folder (`src-tauri/src/store.rs`) |
| `chrome.alarms` | `src-tauri/src/alarms.rs`, checked against the wall clock twice a second, so an alarm that came due during sleep fires right after waking |
| `chrome.runtime.sendMessage` / `onMessage` | Passed through the shell to the hidden page, and the answer back |
| `chrome.idle.queryState` | Seconds since the last keyboard or mouse input (the `user-idle` crate) |
| On-device pose (`lib/pose`, MediaPipe) | The same code and model, in the break window's webview |
| Demo clips on youtube.com | Open in the user's browser. The app never loads a web page in its own windows |

The app keeps the extension's Content Security Policy (`tauri.conf.json`), and it does real work: the vendored MediaPipe tries to send a log request to `odml.pa.googleapis.com`, and the policy blocks it here as it does in the extension.

The shim covers the `chrome.*` calls the extension makes today (about 30). If the extension starts using a new one, add it to `shim/chrome-shim.js` and, if it needs the system, a command in `src-tauri/src/lib.rs`.

## What has been checked

On macOS 26 (Apple silicon), by running a debug build and reading the log (`SO_TRACE=1`):

- First run: `service-worker.js` starts, creates its alarms, and the Settings window opens on "Welcome to Squat Overflow".
- With setup done: the countdown reaches the menu bar and ticks every second in the last minute (`51s`, `50s`, …), from the hidden page.
- A click on the icon opens the popup under it, with the level, next break, challenges and heatmap rendered.
- Pause from the menu sets `pausedUntil` in the store and turns the label into Resume; Resume turns it back.
- With the language set to Arabic, the menu labels, the tooltip, the popup and the Settings page are in Arabic.
- The pose model loads in the app's webview with WebGL2 and analyses frames (a blank test frame, no camera).
- No page error and no blocked request under the extension's own Content Security Policy.

Checked by tests: `cargo test` (storage changes and alarm timing), the extension's `node tests/check.mjs`, and its offline break test in Chromium (`tests/e2e/break-offline.mjs`) after the one change this needed in the extension (see below).

The same checks pass in the packaged `.app` (`cargo tauri build --debug`), with one exception:

- **The packaged app's icon wasn't placed in the menu bar on the test Mac (macOS 26.6).** The system reported the icon at the bottom-left corner of the screen, which is where an item sits that isn't shown, and the popup opened there. The binary run straight from `target/debug` is placed correctly. On that Mac the saved setting `NSStatusItem VisibleCC Item-0` is `0` for other apps' icons too (the SwiftUI app `com.squatoverflow.bar`, UTM, Parallels) and `1` only for Apple's own, so this looks like the Mac's menu bar settings (System Settings › Menu Bar) and not the app. It isn't confirmed: nobody has looked at the screen, and the setting wasn't changed.

On Linux, in a container (Debian 12, WebKitGTK 2.50, a virtual display, no GPU and no tray):

- The app builds and `cargo test` passes.
- `service-worker.js` runs, the countdown ticks, the popup opens as a window with its content rendered, and Pause works.
- **The pose model doesn't run there as shipped.** WebKitGTK has WebGL2 on a canvas element but not on an `OffscreenCanvas`, and MediaPipe makes an `OffscreenCanvas` of its own, so both of its modes fail. Given a canvas element (MediaPipe's `canvas` option) both work: 35 ms a frame on the CPU. So a break on Linux needs `extension/lib/pose/detector.js` to pass a canvas where `OffscreenCanvas` has no WebGL2. That isn't done here: the detector is shared with Chrome and Firefox, and the change should be tested in each.

**Not checked yet:**

- **A break with the real camera, on any system.** `break.html` hasn't been opened in the app, so `getUserMedia`, the camera prompt, rep counting, voice cues and meme clips are untested here. The pieces under it (the page, the model, the messages) are checked above.
- **Windows.** Nothing has been built or run on Windows. CI builds it (`.github/workflows/ci.yml`, job `desktop`) once the branch is pushed.
- **Linux on a real desktop.** The container has no tray, camera or GPU, so the icon, its menu and a camera break are untested there. GNOME needs the AppIndicator extension to show any tray icon.
- How the icon and title look. The checks above read logs, not the screen.

## One change in the extension

`extension/lib/pose/detector.js` passed MediaPipe a folder address ending in `/`, and MediaPipe adds `/vision_wasm_internal.js` to it, so the request had `//` in it. Chrome serves that; Tauri's file server answers 500. The address now has no slash at the end. The files requested are the same, and the extension's own tests pass with it.

## Gaps

Things the extension does that this app doesn't, or does differently:

- **No sign-in, team board or sync.** `chrome.identity.launchWebAuthFlow` has no counterpart yet, so the app is built local only (`API_URL` empty, like a store build with no API server): the pages hide sign-in and the board, and the app makes no requests. The phone app's flow (`/auth/mobile-callback` to a custom URL scheme) would fit here.
- **Meetings.** Before a reminder, `service-worker.js` looks for a fullscreen browser window and for a Meet, Zoom or Teams tab playing sound. The app can't see browser tabs, and `chrome.windows.getAll()` lists only its own windows, so it never defers for a meeting. Deferring while the microphone is in use or the front app is fullscreen would need code per system.
- **Screen lock.** `chrome.idle.queryState` can answer `"locked"`. Here a locked screen counts as idle once there has been no input for the same time, not at once.
- **No Google Calendar busy times**, for the same reason as sign-in.
- **Windows shows no countdown next to the icon.** The system tray there has no text. Drawing the badge onto the icon, as Chrome does, is the way to close this.
- **Camera consent on Windows and Linux.** The shell grants the camera to the break and Practice pages only, and refuses every other permission on every page. macOS asks the user itself the first time. Windows and Linux don't, so before a release the app needs its own "allow the camera?" step there.
- **Menu wording.** "Open Squat Overflow" and "Quit Squat Overflow" are English only: the extension has no string for either.
- **Not built:** start at login, one running copy at a time, updates, signing and notarizing, and a monochrome menu bar icon for macOS.

## Open questions

- **Linux webview.** Besides the pose model (above), WebKitGTK decides whether the camera, speech and Ogg audio work, and it varies by distribution.
- **Meme clips on older macOS.** They are Ogg Vorbis, which WebKit plays only in recent versions. The phone app bundles AAC copies for this reason (`mobile/assets/sounds/memes`).

## Build and run

Requirements: Rust (stable), Node 24, and the Tauri CLI (`cargo install tauri-cli --version "^2"`). On Linux also the libraries the CI job installs: `libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev libx11-dev libxss-dev`. On Windows 10 the WebView2 runtime (Windows 11 has it).

```bash
cd desktop && cargo tauri dev
```

`cargo tauri dev` and `cargo tauri build` first run `scripts/sync-web.mjs`, which copies `extension/` into `desktop/web/` (not committed) for the app to embed. `API_URL=https://… cargo tauri build` builds against an API server, for when sign-in exists.

A packaged app (`.app` and `.dmg`, `.msi` and `.exe`, or `.deb`, `.rpm` and `.AppImage`, for the system you build on):

```bash
cd desktop && cargo tauri build
```

The store is `store.json` in the app's data folder: `~/Library/Application Support/com.squatoverflow.desktop` on macOS, `%APPDATA%\com.squatoverflow.desktop` on Windows, `~/.local/share/com.squatoverflow.desktop` on Linux.

## Tests and debugging

```bash
cd desktop/src-tauri && cargo test
```

Environment variables for a run:

| Variable | What it does |
|---|---|
| `SO_DATA_DIR=/some/folder` | Keeps the store there instead of the app's data folder |
| `SO_TRACE=1` | Logs every `chrome.*` call and what each page rendered. Page errors are always logged |
| `SO_DEBUG_MENU=click,pause` | Debug builds: acts like those menu items after launch, three seconds apart. `click` is a click on the icon; the others are `open`, `break-now`, `pause`, `settings`, `quit` |
| `SO_DEBUG_EVAL='…'` | Debug builds: runs a script in the hidden page |
