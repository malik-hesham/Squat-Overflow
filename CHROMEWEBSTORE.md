# Chrome Web Store listing: Squat Overflow

> Last updated: 2026-11-07. This file is the source for everything typed into the Chrome Web Store Developer Dashboard. Update it whenever the manifest, the permissions, the data flows or the UI change. The release zip never includes it, because `scripts/build-extension.mjs` packages only `extension/`.

## Store listing

**Extension name:** Squat Overflow. This must match `manifest.json` `name`.

**Short description (132 characters max):**
Movement reminders with 2-minute camera-coached breaks. Your webcam counts reps and scores form; earn XP, levels and badges.

**Detailed description.** Paste this as plain text; the store strips markdown.

```
Squat Overflow reminds you to get up and move during the workday, then coaches you through a 2-minute break using your webcam.

WHAT IT DOES
Reminds you on a schedule you choose: every 30, 45, 60, 90 or 120 minutes, or a custom interval, only on your workdays and working hours.
Waits for you: no reminder while you're in a Google Meet, Zoom or Teams call, presenting fullscreen, or away from the computer. Connect Google Calendar to also skip busy times.
Builds a short routine for the areas you pick: neck tension, rounded shoulders, upper back, shoulder and rotator cuff, lower back, wrist and hand, knees, and eyes.
Counts your reps and scores your form live with your webcam, with a short demo clip of each exercise next to the camera.
Turns breaks into progress: XP for every break, 8 levels, daily and weekly challenges, badges, streaks and an activity heatmap.
Keeps you private: show yourself blurred or as a 3D character instead of on camera.
Practice mode: try any exercise on its own, outside a scheduled break.
Optional Competitive mode: sign in with your Google work account to join a leaderboard with colleagues on the same company email domain.
Available in English and Arabic, with six color themes.

HOW TO USE IT
1. Install, then pick your body areas, workdays and reminder interval on the welcome page.
2. When a break is due, the break window opens. Allow the camera and follow the moves.
3. Click the toolbar icon any time to see your level, upcoming break and leaderboard, or to start a break now.

PRIVACY
Camera frames are sent over an encrypted connection to the Squat Overflow pose server only during a break. They are analysed in memory and never stored. Everything else stays on your computer. Google sign-in is optional. In Competitive mode only your chosen name, company domain, XP, level, streak and avatar are shared to the leaderboard. Full policy: https://<pose server host>/privacy
```

**Category:** Productivity. "Health & Fitness" is not an extension category.

**Single purpose:** Reminds you to take short movement breaks and coaches each break with webcam-based exercise tracking.

**Primary language:** English. Arabic UI is built in.

## Graphics and assets

| Asset | Dimensions | Status | File |
|-------|-----------|--------|------|
| Store icon | 128×128 PNG | ✅ Ready | `extension/icons/icon-128.png` |
| Screenshot 1 | 1280×800 | ⬜ Not created | Break window: camera with skeleton overlay, rep counter, demo clip |
| Screenshot 2 | 1280×800 | ⬜ Not created | Toolbar popup: level, XP bar, next break, leaderboard |
| Screenshot 3 | 1280×800 | ⬜ Not created | Settings page: areas, workdays, interval, Personal/Competitive |
| Screenshot 4 | 1280×800 | ⬜ Not created | Privacy mode: blurred body or 3D avatar in the break window |
| Small promo tile | 440×280 | ⬜ Not created | Dumbbell-pulse icon on brand background |

Screenshots must show the real UI of the version being submitted. Don't show anyone's face unless they have agreed to it.

## Permissions justification

| Permission | Type | Justification |
|------------|------|---------------|
| `storage` | permissions | Saves the user's settings, break schedule, XP, level, badges, challenges and break history on their computer. |
| `alarms` | permissions | Opens the break window when the next break is due, and refreshes the countdown on the toolbar badge every minute. |
| `idle` | permissions | Skips a reminder when the computer is idle or locked, so a break isn't counted while the user is away. |
| `tabs` | permissions | Reads the address of tabs that are playing sound, to detect a Google Meet, Zoom or Teams call and hold the reminder until it ends. Also finds and focuses the extension's own break window. Addresses are checked on the device and never sent anywhere. |
| `identity` | permissions | Optional "Continue with Google" sign-in (`openid email profile`), which verifies the work email used to join the company leaderboard in Competitive mode. Also optional Google Calendar access: free/busy times only (read-only `calendar.freebusy` scope), so reminders avoid meetings. No event titles or details are read. |
| Camera (browser prompt, no manifest permission) | n/a | The break window and Practice page ask for the webcam to count reps and score form. |
| Remote connections (CSP `connect-src`) | n/a | `wss://<pose server host>`: the pose server the store zip is built for (`POSE_SERVER_URL`), which analyses camera frames. `https://<pose server host>`: the same server's account sign-in, leaderboard and sync API. Both must be added to `connect-src` before building. `googleapis.com`: Calendar free/busy. Localhost and `*.trycloudflare.com`: self-hosted pose servers set in Advanced settings. No `host_permissions` are requested. |

## Privacy and data use

### Data collection

**Does the extension collect user data?** Yes.

| Data type | Collected? | Off device? | Purpose | Shared with third parties? |
|-----------|-----------|-------------|---------|---------------------------|
| Personally identifiable info | Yes | Yes | (1) Webcam images of the user during a break, sent to the pose server for real-time pose detection and discarded immediately, never stored. (2) After optional Google sign-in: the account's email, name and picture, kept by our server (the pose server's account database). (3) In Competitive mode: display name, plus the company domain taken from the verified email, on the leaderboard. | No. The service providers that host them (our server and database hosts) only process them for these features. |
| Health info | No | | XP and form scores are game points, not health data, and form scores never leave the device. | |
| Financial info | No | | | |
| Authentication info | Yes | Yes | The Google sign-in token is exchanged once with our server for a session. The session is stored on the device and sent to our server with leaderboard requests. The Google Calendar access token is stored on the device and sent only to Google; it is revoked on disconnect. | No |
| Personal communications | No | | | |
| Location | No | | | |
| Web history | No | | Tab addresses are checked on the device to detect meeting sites; nothing is stored or sent. | |
| User activity | No | | | |
| Website content | No | | | |

### Data use certification
- [x] Data is not sold to third parties.
- [x] Data is not used for purposes unrelated to the extension's core functionality.
- [x] Data is not used for creditworthiness or lending purposes.

## Privacy policy

**Privacy policy URL:** `https://<pose server host>/privacy`. The pose server serves it from `server/static/privacy.html`, because the repo is private. Keep it in sync with the table above.

⚠️ Before the first submission, replace the placeholder contact address (`privacy@example.com`) in `server/static/privacy.html` with a monitored address.

## Distribution

**Visibility:** Unlisted at first (shared by link with colleagues). Switch to Public once the listing has passed review.
**Regions:** All regions.

## Developer info

**Publisher name:** To fill in. This is the Developer Dashboard account that owns the item.
**Contact email:** To fill in. It is shown publicly, so it must be monitored.
**Support URL / email:** Same as the contact email until there is a public support page.

## Version history

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 0.4.0 | 2026-11-07 | First store version. Uses the pose server set by `POSE_SERVER_URL` at build time. | Draft |

## Review notes

### Known issues and limitations
- The store assigns its own extension ID, which differs from the unpacked dev ID (`lpkaoaegdjhciohkfidnmabjigidofnd`). Moving from an unpacked install to the store install starts with fresh local progress.
- The Google OAuth client must list the store ID's redirect URI, `https://<store-id>.chromiumapp.org/`, or Google sign-in and Calendar fail. If the app is used outside the team, the `calendar.freebusy` scope may need Google's OAuth consent-screen verification.
- The pose server must allow the store origin. Add `chrome-extension://<store-id>` to the `FORMCOACH_ALLOWED_ORIGINS` environment variable on the server.

### Rejection history
None yet.
