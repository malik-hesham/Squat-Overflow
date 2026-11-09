# Squat Overflow for macOS

A native SwiftUI menu bar app (macOS 14+, no Dock icon) that runs Squat Overflow on its own, with no browser involved. It has its own break timer, reminder window, camera-coached break, XP, settings and sync. It follows the browser extension (`extension/`), which defines every feature and rule (see the root `CLAUDE.md`). Sign-in is optional, as in the extension.

## How it maps to the extension

| Extension | Mac app |
|---|---|
| Toolbar badge (countdown) | Menu bar title: `23m`, `45s`, `move` |
| Popup (`popup.html`) | Menu (`MenuView.swift`): level, next break, today's breaks, skips, streak, today's challenges and badges, Break now, Pause/Resume, team board |
| Options page (`options.html`) | Settings window (`SettingsView.swift`), opened on first run like the options page on install |
| Break window (`break.html`, `break.js`) | Break window (`BreakView.swift`, `BreakController.swift`) running `SquatCore.BreakSession` |
| Service worker + `chrome.alarms` (`service-worker.js`) | `SquatCore.Engine`, a `Timer` for the next break, a 60 s sync timer |
| `chrome.storage.local` (`lib/store.js`) | `~/Library/Application Support/SquatOverflowBar/store.json`, with the same keys (`SquatCore.Store`) |
| Pose server over WebSocket (`lib/pose-client.js`) | The same server and protocol: `PoseSocket.swift` moves the bytes, `SquatCore.PoseLink` decides what to send |
| `chrome.idle` | Seconds since the last input, screen lock (`Presence.swift`) |
| Sync (`lib/sync.js`, `lib/sync-core.js`) | `SquatCore.SyncClient` and `SquatCore.SyncCore`, device `mac` |
| Web Speech, `Audio` meme clips | `AVSpeechSynthesizer`, `AVAudioPlayer` (`Sounds.swift`) |
| i18n (`lib/i18n.js`, English and Arabic) | The extension's own strings, exported to `SquatCore/Sources/SquatCore/Resources/i18n.json` |

### The rules are ported, and tested against the extension

Swift can't import the extension's JavaScript, so the rules are ported into the `SquatCore` Swift package (`macos/SquatCore`). Each type names the extension file it follows. The package covers XP and levels, streaks, daily and weekly challenges, badges, the routine, the schedule (snooze cap, skip warning, pause, active hours, late and deferred alarms), activity, meme turns, the sync merges, the settings form checks and the popup's next-break line.

`macos/scripts/parity-fixtures.mjs` runs the extension's own modules on more than 2,000 inputs and saves their answers. The Swift tests replay every case and must give the same answer. Local-time rules run in Europe/Berlin, so the cases cross daylight-saving changes. CI fails when the fixtures no longer match the extension, so a rule changed in `extension/lib` has to be followed here.

### The break

Break now and the scheduled reminder open the same break as the extension:
- three exercises from your pain areas;
- reps, form scores and cues ("Great form!", "Go deeper", the server's issue text, translated) from the pose server;
- side-on and standing moves wait until you're in frame (up to 15 s);
- Swap, the demo clip through the server's `/embed` page, and voice cues and meme clips that take turns;
- Done, Snooze 20 min (at most twice in a row) and Skip;
- the "~N hours without moving" warning after three skips in a row;
- the XP summary with bonuses, new badges and level-up.

If the camera is denied, the server can't be reached, or it's at its session cap, the break goes on by hand with no XP ("Coach offline", "Coach busy", "Camera unavailable"), as in the extension.

The camera preview is mirrored. With privacy on (the default, "Blur") the person is blurred using the mask the server sends, and the whole frame is blurred while there's no fresh mask. Frames go only to the pose server you configure and are never recorded.

### Gaps

These are things the extension does that the Mac app doesn't, or does differently because of the platform:

- **No 3D characters.** The extension's characters (`avatar.js`, three.js/WebGL) aren't ported. The camera look is Camera or Blur, and the avatar setting is a name picker (the avatar still shows on the team board). The privacy setting's text still mentions characters, because it's the extension's string. The characters' fitness caption isn't shown.
- **Meetings.** The extension defers a break for an audible Meet, Zoom or Teams tab or a fullscreen window. The Mac app can't see browser tabs, so it defers while any app is using the microphone (a call in any app) or the front app is fullscreen. It reads no titles, audio or video.
- **No Google Calendar busy times** (`calendar-client.js`), so the Settings window has no Connect Google Calendar button.
- **Not ported:** Practice (`trainer.html`), the activity heatmap, the all-time board (week only, top 5), and page themes (the app follows the system appearance). Breaks still record activity, and it syncs.
- **Meme clips** are the extension's clips converted to AAC, because macOS can't play Ogg Vorbis. The app bundles `mobile/assets/sounds/memes`, the same conversions the phone app plays.
- **Two timers on one Mac.** Signed out, the Mac app and the extension each keep their own timer and history, so with both installed you get reminders from both. Signed in, a break finished on either one moves the other's next break after its next sync (within a minute). That's the extension's `afterSync()` rule.

## Build and run

Requirements: Xcode 16 or later and [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`). The `.xcodeproj` is generated from `project.yml` and isn't committed.

```bash
cd macos && xcodegen && xcodebuild -scheme SquatOverflowBar -derivedDataPath build build && open build/Build/Products/Debug/SquatOverflowBar.app
```

Or open `SquatOverflowBar.xcodeproj` in Xcode and Run. On the first run the Settings window opens: pick your areas and press **Get started**. The first break asks for camera access.

## Tests

The rules (fast, no Xcode project needed):

```bash
cd macos/SquatCore && swift test
```

After changing a rule in `extension/lib`, regenerate the fixtures and run the Swift tests again:

```bash
node macos/scripts/parity-fixtures.mjs
```

The app's wiring, plus a pose-server integration test that runs when a server is up on `SO_SERVER_URL` and is skipped otherwise:

```bash
cd macos && xcodegen && xcodebuild -scheme SquatOverflowBar test
```

## Server URL

The server URL is the `SO_SERVER_URL` build setting. It defaults to `http://127.0.0.1:8765` (start it with `cd server && npm run start:dev`). It's used for sign-in, sync and the leaderboard. The pose WebSocket defaults to the same host at `/ws` (`ws://`, or `wss://` for an `https://` server). It can be changed under Settings → Advanced, like the extension's Pose server URL. To build against another server:

```bash
cd macos && xcodebuild -scheme SquatOverflowBar build SO_SERVER_URL=https://pose.example.com
```

`SO_GOOGLE_CLIENT_ID` in `project.yml` can be overridden the same way.

## Sign-in

Sign-in is optional, and the app never asks for it. It's in the menu (team board) and in Settings → Profile. It uses the same flow as the mobile app (`mobile/src/core/session.ts`):

1. `ASWebAuthenticationSession` opens Google's implicit flow (`response_type=id_token`) for the extension's web client ID. Google gets the SHA-256 hash of a random nonce.
2. Google redirects to `<server>/auth/mobile-callback` (`server/static/mobile-callback.html`), which forwards the result to `squatoverflow://auth`.
3. The app posts `{ id_token, nonce }` (the raw nonce) to `POST /auth/google`.

The first sync after sign-in uploads your local break history, with the same backfill ids the extension uses. The session, including the single-use refresh token, is stored in the login Keychain (service `com.squatoverflow.bar`). The access token is refreshed through `POST /auth/refresh` shortly before it expires, and again whenever a request returns 401. If the refresh token is rejected, the app signs you out.

For Google to accept the redirect, `<server>/auth/mobile-callback` must be listed under **Authorized redirect URIs** for the web client in Google Cloud Console. See `TODO.md`.

## Notes

- The app is ad-hoc signed ("Sign to Run Locally"). After each rebuild, macOS may ask once whether the new build can read its Keychain item. Click **Always Allow**.
- Camera access is under System Settings › Privacy & Security › Camera.
