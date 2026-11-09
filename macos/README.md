# Squat Overflow menu bar app (macOS)

A SwiftUI `MenuBarExtra` app (macOS 14+, no Dock icon) that shows your synced Squat Overflow data and hands breaks off to Chrome. It doesn't use the camera.

- **Menu bar title:** the countdown to your next break. It's computed from the shared settings (`intervalMin`, `activeStart`/`activeEnd`, `workdays`) and the newest break on any device (`lastBreakAt`), using the rules in `extension/lib/schedule.js`.
- **Menu:** level and XP bar, streak, today's breaks, week XP, and your team's top 5 for the week.
- **Break now** opens the extension's start page (`SO_START_URL`, from PR #10 / `docs/start-break-link.md`) in Chrome, which starts a break. **Open settings** opens the extension's options page, `chrome-extension://<SO_EXTENSION_ID>/options.html`. **Sign out** removes the session from Keychain.
- **Data:** `GET /me/profile?day=&week=`, `GET /me/settings` and `GET /leaderboard?period=week`, fetched every 60 s and each time the menu opens.

## Build and run

Requirements: Xcode 16 or later and [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`). The `.xcodeproj` is generated from `project.yml` and isn't committed.

```bash
cd macos && xcodegen && xcodebuild -scheme SquatOverflowBar build
```

To run it, open the project in Xcode (`open SquatOverflowBar.xcodeproj`, then Run), or build to a known folder and launch the app:

```bash
cd macos && xcodebuild -scheme SquatOverflowBar -derivedDataPath build build && open build/Build/Products/Debug/SquatOverflowBar.app
```

Unit tests (schedule port, level bar, settings decoding, sign-in URL):

```bash
cd macos && xcodebuild -scheme SquatOverflowBar test
```

## Server URL

The server URL is the `SO_SERVER_URL` build setting. It defaults to `http://127.0.0.1:8765` (start it with `cd server && npm run start:dev`). To build against another server:

```bash
cd macos && xcodebuild -scheme SquatOverflowBar build SO_SERVER_URL=https://pose.example.com
```

`SO_START_URL`, `SO_EXTENSION_ID` and `SO_GOOGLE_CLIENT_ID` in `project.yml` can be overridden the same way.

## Sign-in

The app uses the same flow as the mobile app (`mobile/src/core/session.ts`):

1. `ASWebAuthenticationSession` opens Google's implicit flow (`response_type=id_token`) for the extension's web client ID. Google gets the SHA-256 hash of a random nonce.
2. Google redirects to `<server>/auth/mobile-callback` (`server/static/mobile-callback.html`), which forwards the result to `squatoverflow://auth`.
3. The app posts `{ id_token, nonce }` (the raw nonce) to `POST /auth/google`.

The session, including the single-use refresh token, is stored in the login Keychain (service `com.squatoverflow.bar`). The access token is refreshed through `POST /auth/refresh` shortly before it expires, and again whenever a request returns 401. If the refresh token is rejected, the app signs you out.

For Google to accept the redirect, `<server>/auth/mobile-callback` must be listed under **Authorized redirect URIs** for the web client in Google Cloud Console. See `TODO.md`. `http://127.0.0.1:8765/auth/mobile-callback` is only accepted if it's added there too. Otherwise, build against the hosted server.

## Notes

- The app is ad-hoc signed ("Sign to Run Locally"). After each rebuild, macOS may ask once whether the new build can read its Keychain item. Click **Always Allow**.
- Chrome may refuse to open a `chrome-extension://` URL from another app. If **Open settings** opens a blank tab, use the extension's popup → Settings instead.
- Break now needs the extension build that includes the start-page content script (PR #10).
