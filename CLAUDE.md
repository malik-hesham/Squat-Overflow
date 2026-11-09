# Squat Overflow

## The browser extension is the reference client

`extension/` defines every feature and every business rule: what a break does, XP, levels, streaks, challenges, badges, the schedule, privacy, demo clips, sounds, i18n strings and the leaderboard. The other clients follow it:

- `mobile/` (React Native, iOS and Android)
- `macos/` (the SwiftUI menu bar app)

When you add or change a feature or a rule in any client:

1. Find how the extension does it (`extension/break.js`, `extension/lib/*`, `extension/background.js`, and `server/` for anything the extension gets from the pose server) and do the same in the other client. Same defaults, same limits, same wording, same edge cases. For example, mobile privacy mode blurs the camera like the extension's "Blur" look; it doesn't invent its own look.
2. Mobile imports the extension's pure modules from `../extension/lib` (see `mobile/src/core/shared.ts`). Reuse them; don't copy or re-implement the logic. The macOS app can't import JS, so it ports the rule and says in a comment which extension file it follows.
3. If a change starts in mobile or macOS, either make the same change in the extension or say clearly why it's platform-only.
4. A platform can't always match (no camera on the menu bar app, no fullscreen detection on a phone, no real blur on Android before 12). Write each gap down in that client's README ("How it maps to the extension" in `mobile/README.md`, the feature list in `macos/README.md`). Keep the gap as small as the platform allows, and pick the option that keeps the user's privacy.
5. Tests that pin a shared rule should cover every client the rule ships in.
