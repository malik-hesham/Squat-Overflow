# Squat Overflow

## The browser extension is the reference client

`extension/` defines every feature and every business rule: what a break does, XP, levels, streaks, challenges, badges, the schedule, privacy, the 3D exercise demos, sounds, i18n strings and the leaderboard. The other clients follow it:

- `mobile/` (React Native, iOS and Android)
- `desktop/` (the status bar app for macOS, Windows and Linux, a Rust/Tauri shell)

When you add or change a feature or a rule in any client:

1. Find how the extension does it (`extension/break.js`, `extension/lib/*` including the pose analysis in `extension/lib/pose`, `extension/background.js`, and `server/`, the optional API server, for sign-in, the leaderboard and sync) and do the same in the other client. Same defaults, same limits, same wording, same edge cases. For example, mobile privacy mode blurs the camera like the extension's "Blur" look; it doesn't invent its own look.
2. Mobile imports the extension's pure modules from `../extension/lib` (see `mobile/src/core/shared.ts`). Reuse them; don't copy or re-implement the logic. The desktop app runs the extension's own pages and `service-worker.js` unchanged behind a `chrome.*` shim (`desktop/shim/chrome-shim.js`, the extension files copied in by `desktop/scripts/sync-web.mjs`), so it has no rules of its own: a rule changed in the extension ships there as is. Only the shim and the Rust shell (`desktop/src-tauri`) are desktop code, and they implement `chrome.*` APIs, not product rules.
3. If a change starts in mobile or desktop, either make the same change in the extension or say clearly why it's platform-only.
4. A platform can't always match (no browser tabs to check for meetings on the desktop, no fullscreen detection on a phone, no real blur on Android before 12). Write each gap down in that client's README ("How it maps to the extension" in `mobile/README.md`, the gaps in `desktop/README.md`). Keep the gap as small as the platform allows, and pick the option that keeps the user's privacy.
5. Tests that pin a shared rule should cover every client the rule ships in.

## Digital human engine: `packages/`

The interactive 3D human (plan: [docs/digital-human/architecture.md](docs/digital-human/architecture.md)) is
the one exception to "the extension defines every rule": its rules live in the pnpm workspace under
`packages/`, and every client uses those packages instead of having its own copy. The extension loads a
vendored bundle (it keeps no build step), the desktop app gets it through the extension's pages, and
mobile imports the packages through Metro, as it does `../extension/lib`.

1. `avatar-types`, `avatar-core`, `avatar-assets` and `speech-client` stay platform-free: no React, three,
   Expo, React Native, Tauri, DOM or Node globals. Time, randomness, audio and network come in through
   the ports in `avatar-types`. `tools/workspace-check` enforces this in `pnpm check`; fix the code, not
   the rule.
2. A new workspace package needs a rule in `tools/workspace-check/src/rules.ts`.
3. extension/, mobile/, server/ and vscode-extension/ are not in the workspace; they keep their npm
   lockfiles.
4. Don't call the generated human photorealistic unless it comes from a scan or a likeness source; see
   [docs/digital-human/assets.md](docs/digital-human/assets.md).
