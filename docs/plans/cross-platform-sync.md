# Cross-platform sync POC: Chrome extension, mobile app, Mac menu bar app

brief: Make one user's core data follow them across the Chrome extension (`extension/`), the React Native app (`mobile/`) and a new macOS menu bar app (`macos/`). The NestJS server (`server/`) stores it in Postgres. Core data = break history, profile and progress (XP, level, streak, badges), and settings. Base branch: `feat/nestjs-pose-server` (PR #11, not merged yet); work branch: `feat/cross-platform-sync`.

gates:
- `cd server && npm test && npm run typecheck`
- `node extension/tests/check.mjs`
- `cd mobile && npx jest`
- `cd macos && xcodebuild -scheme SquatOverflowBar build` (from item 4 on)

## Where the data lives today

| Data | Chrome extension | Mobile | Server |
|---|---|---|---|
| Settings | `chrome.storage.local` (`SETTINGS_DEFAULTS` keys) | AsyncStorage, `so:` prefix | none |
| Break log | `breakLog`, last 500 entries | same shape | none |
| Profile (XP, streak, badges, challenges) | `profile` | same | `players` row (leaderboard only) |

Mobile already imports the extension's pure modules (`extension/lib/xp.js`, `schedule.js`, `routine.js`, ...) through `mobile/src/core/shared.ts`. The server can import the same modules, so XP and streak rules stay in one place.

## Design (decided, do not re-decide)

**Break history is the source of truth.** Every finished break is one immutable event. The client generates the event's UUID, so a retried upload never counts twice. An event holds today's log entry (`at, reps, moves, score, xp, scored, completed`) plus `day` (local `dayKey`), `week` (`isoWeek`), `device` (`chrome | ios | android | mac | vscode`) and `areas`. The client computes `day` and `week` in its own time zone. The server runs in UTC, so it never computes them.

**The server derives the profile from events.** Total XP, level, week XP, streak, today's break count and `lastBreakAt` are computed from the user's events. Events from two devices that were offline merge without conflict. For the POC, badges and challenges are one JSON field with last-write-wins.

**Settings are one document per user, last-write-wins per field.** The server keeps a per-field timestamp (`field_at`) and keeps the newer value of each field.
- Shared: `intervalMin, areas, activeStart, activeEnd, workdays, autoPause, voice, memes, mode, name, avatar, lang, weekStart`.
- Per device, never synced: `serverUrl, setupDone, theme, privacy, privacyStyle`.

**Sync uses an offline outbox and a cursor pull.** Each client queues events locally and pushes them when it is online. It pulls with `since=<seq>` when it starts, when it comes to the foreground, and every 60 s. Live push over SSE is a stretch goal.

**One shared break timer.** When a client pulls a `lastBreakAt` newer than its own last break, it reschedules its next break from that time, so a break on the phone also resets Chrome and the Mac.

**The Mac app only shows data and hands off breaks.** It does not use the camera. Its **Break now** button opens the Chrome break page through the deep link from PR #10 (`feature/start-break-from-link`).

**Leaderboard.** The server writes the `players` row from the derived profile whenever events arrive. Clients stop calling `PUT /leaderboard/me`; the endpoint stays for old builds.

**Sign-in.** All clients use the existing `POST /auth/google` + `POST /auth/refresh`. The Mac app copies the mobile flow: `ASWebAuthenticationSession` opens Google's implicit flow with the web client ID, `server/static/mobile-callback.html` relays the result to `squatoverflow://auth`, and the app posts the ID token and raw nonce. Because the audience is the same web client ID, the server needs no new Google client ID.

## API (all under `BearerGuard`)

```
POST  /sync/breaks              { events: BreakEvent[] }  -> { accepted: number, profile: Profile }
GET   /sync/breaks?since=&limit= -> { events: (BreakEvent & { seq })[], next: number }
GET   /me/profile               -> Profile
PUT   /me/progress              { badges, daily, weekly, at } -> 204   (last-write-wins)
GET   /me/settings              -> { doc, version }
PATCH /me/settings              { patch: { [field]: value }, at } -> { doc, version }
```

`Profile = { xp, level, levelName, streak, weekXp, week, todayBreaks, lastBreakAt, badges, daily, weekly }`

`POST /sync/breaks` and `GET /me/profile` take optional `?day=YYYY-MM-DD&week=YYYY-Www`, the caller's local keys, so "today" and week XP follow the device's clock (default: server UTC). Limits: at most 200 events per POST and 500 per GET page. `POST /sync/breaks` validates every field the same way `validateScore` does today and rejects unknown settings keys.

## Items

- [x] 1. Server: schema and sync API. Done: `server/src/sync/`, migration `002_sync`, specs in `server/test/sync/`.
      Add migration `002_sync` to `server/src/db/migrations.ts`:
      `break_events (user_id uuid references users on delete cascade, id uuid, seq bigserial, at timestamptz, day text, week text, device text, reps int, moves int, score int null, xp int, scored boolean, completed boolean, areas text[], received_at timestamptz default now(), primary key (user_id, id))`, an index on `(user_id, seq)`;
      `user_settings (user_id uuid primary key references users on delete cascade, doc jsonb not null default '{}', field_at jsonb not null default '{}', version int not null default 0, updated_at timestamptz default now())`;
      `user_progress (user_id uuid primary key references users on delete cascade, doc jsonb not null default '{}', at timestamptz)`.
      Add `server/src/sync/` (`sync.module.ts`, `sync.controller.ts`, `sync.store.ts`, `validate.ts`, `profile.ts`) and `server/src/me/` (or one `SyncModule` exposing both routes). `profile.ts` derives the profile from events with `LEVELS` and the streak rule ported from `extension/lib/xp.js` (the server is CommonJS and ships alone in its image, so it can't import that ES module); `test/sync/profile.spec.ts` checks the levels still match. Inserts use `on conflict do nothing`. After an insert, upsert `players` when the user has a company email and `mode = competitive`.
      verify: Jest specs on PGlite cover idempotent re-POST, the cursor walking pages, streak across days, the per-field settings merge (an older `at` loses), and 401 without a token.

- [x] 2. Chrome extension client. Done: `extension/lib/sync.js` (network + storage) and `extension/lib/sync-core.js` (pure: events, UUIDv5 backfill ids, outbox, settings and profile merges; mobile can import it), `appendLog` queues, `saveSettings` marks changed shared keys in `syncDirty`, checks in `extension/tests/check.mjs`.
      `extension/lib/sync.js`: outbox in `chrome.storage.local` (`syncOutbox`), `pushOutbox()`, `pull()`, `syncCursor`, settings merge. `appendLog` also enqueues the event with `id = crypto.randomUUID()`. The first sync after sign-in uploads the old `breakLog` with ids = UUIDv5 of `playerId:at`, so repeating it is safe. Pull on start-up, on popup open, and on a 1-minute `chrome.alarms`. After a pull, replace the local profile with the server profile, apply the shared timer rule, and stop the direct `PUT /leaderboard/me`.
      verify: `node extension/tests/check.mjs` plus new unit tests for outbox, merge and backfill ids.

- [x] 3. Mobile client. Done: `mobile/src/core/sync.ts` (+ `uuid.ts`), hooked into `engine.ts` and `AppData.tsx`; tests in `mobile/src/core/__tests__/sync.test.ts` and `engine.test.ts`. Backfill ids use UUIDv5 namespace `240ab37e-ad3a-409a-a2f2-29f50c8e346d`, the same as the extension. Simulator check done on 2026-11-08 against a local server: a break posted as `device: chrome` showed on the phone (XP, breaks today, activity) on launch and on foreground, and the phone's own breaks went up once.
      `mobile/src/core/sync.ts` mirrors item 2 on the `storage.ts` API. Hook it into `engine.ts` (after `appendLog`) and `AppData.tsx` (on foreground via `AppState`). Reschedule notifications when `lastBreakAt` moves forward.
      verify: Jest tests for the outbox and merge; manual check on the iOS simulator that a break done in Chrome shows in the app.

- [ ] 4. Mac menu bar app.
      New `macos/` folder: a SwiftUI `MenuBarExtra` app (macOS 14+, `LSUIElement`, generated with XcodeGen from `macos/project.yml`). Keychain holds the refresh token. It shows level and XP bar, streak, today's breaks, a next-break countdown from shared settings + `lastBreakAt`, and the team top 5 from `GET /leaderboard`. The menu bar title is the countdown. Buttons: **Break now** (opens the deep link), **Open settings**, **Sign out**. It polls every 60 s and when the menu opens.
      verify: `xcodebuild` builds; a manual run signs in and shows the same XP as Chrome.

- [ ] 5. End-to-end check.
      Finish a break on the phone. Within 60 s Chrome's popup and the Mac menu show the new XP and today's count, and both reset their next break. Change the interval in Chrome; the phone and the Mac follow. Turn the phone offline, do a break, go back online: it uploads once.

Items 2, 3 and 4 depend only on item 1's API and can run in parallel.

## Risks and follow-ups

- **XP trust:** the server still trusts the `xp` each client sends, as the leaderboard does today. Before production, recompute XP on the server from `reps`, `moves` and `completed`.
- **Challenges** that count snoozes and skips need action events too. Until then they stay last-write-wins per device.
- **Clock skew:** `day` comes from the device clock. A wrong clock can break a streak. The server refuses breaks dated more than 24 h ahead; old ones are allowed so local logs can be backfilled.
- **PR #11** may change before it merges. Rebase `feat/cross-platform-sync` onto it, or onto `main` once it merges.
