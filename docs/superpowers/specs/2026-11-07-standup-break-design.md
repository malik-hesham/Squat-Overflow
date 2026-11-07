# StandUp Break — design

Date: 2026-11-07 (hackathon demo is **today**)
Status: draft, awaiting approval
Repo: `malik-hesham/Squat-Overflow` (this repo), branch `feature/standup-break`

## 1. Intent

Office workers sit for hours without moving. Existing break timers only say "take a break", don't say what to do, and get ignored.

StandUp Break is a Chrome extension that reminds the user at a fixed interval to do a 2-minute exercise routine for the muscle areas that bother them. The webcam scores **how well** they do each exercise, the score turns into XP, and XP feeds levels, challenges, and, if the user opts in, a company leaderboard. The point is to make breaks fun enough that people take them.

It is a **hackathon demo, built and shown today**. It needs to work end to end on stage. It doesn't need to be production-hardened. §17 says what must exist for the demo and what gets cut first.

## 2. Who uses it and how

- Office workers at a desk with a laptop webcam, each exercising alone. There are no group workouts.
- Each user picks a mode in settings:
  - **Personal**: XP, level, streak, and badges stay in the browser.
  - **Competitive**: additionally shares display name, level, XP, and streak on a **company leaderboard**.
- **Where things run:**
  - **Pose server** (the repo's FastAPI + MediaPipe server): runs locally on the demo laptop at `ws://127.0.0.1:8765`, which the extension already allows. Colleagues who want to join either run it locally too, or connect through an optional HTTPS tunnel to the demo laptop (§10.3).
  - **Leaderboard**: Supabase (hosted Postgres plus its auto-generated REST API). The extension calls it directly, so no server of ours is involved.

## 3. Goals, non-goals, anti-goals

**Goals**
- Reliable reminders on a fixed schedule that survive browser restarts.
- A fun, rewarding reminder window: a camera-coached routine with live rep counting, form-based XP, level-ups, challenges, and badges.
- A Personal / Competitive switch with a company leaderboard.
- Demo-friendly: a reminder can be triggered on demand.

**Non-goals (for this demo)**
- Accounts, login, or anti-cheat beyond a per-player secret (§9).
- Hosting the pose server in the cloud, or running pose detection in the browser (later option, §11).
- An Eyes category. Pose detection can't score "look 20 ft away".
- Embedding YouTube clips inside the reminder window (§7.2 explains why).
- Detecting meetings in desktop apps (Zoom/Teams desktop clients).
- Chrome Web Store publishing. Group or team workouts.

**Anti-goals: a failure even if it technically works**
- A reminder pops up over a meeting or a fullscreen presentation.
- Anyone loses XP or a level. XP only ever goes up.
- Someone gets shamed for bad form. The leaderboard never shows raw form scores or break history.
- Camera frames are stored anywhere, or shown to anyone other than the user.

## 4. Starting point: what the repo already has

- `server/`: FastAPI app. WebSocket `/ws` takes JPEG frames and returns reps, per-rep scores, form issues, and an optional person mask for the blurred preview. `GET /health` returns the exercise catalog. It allows only `chrome-extension://` origins. MediaPipe Pose Landmarker lite runs one engine per connection. Tests use pytest.
- `server/analysis/exercises.py`: 30 forgiving office exercises (`Gentle`), each with `key`, `label`, `category`, `camera` (front/side), and `how_to` text. Thresholds are wide on purpose.
- `server/analysis/session.py`: `RepCounter` scores each rep `100 − 20 × issues`. `Gentle.measure` never adds form issues. `not_deep_enough` only marks partial reps, and `too_fast` applies under 0.5 s. So today every counted office rep scores 100, or 80 if it was rushed. **Form doesn't move the score yet; §8.1 fixes that.**
- `server/analysis/demos.py`: a demo clip under 20 s per exercise (YouTube id, channel, title).
- `extension/` (MV3):
  - `service-worker.js`: an idle-minutes break coach with chrome notifications.
  - `trainer.html/js/css`: the full trainer, with camera, skeleton, blurred mode, calibration, a 3-move × 6-rep break routine, a break log, a "Watch demo" button that opens the clip in a small YouTube popup window, and a shareable PNG summary card.

**What changes**
- The idle-minutes coach is replaced by the fixed-interval scheduler in §6.
- Reminders open a new popup window (`break.html`) instead of a notification.
- New pages: a toolbar popup (`popup.html`) and settings (`options.html`, opened on install).
- `trainer.html` stays as **Practice mode**, reachable from the toolbar popup.
- On the server: muscle-area categories (§5) and real form scoring for office exercises (§8.1).
- New: a Supabase table and two SQL functions for the leaderboard (§10.2).

## 5. Exercise categories: by muscle area

Replace the `category` values in `exercises.py` with these 7 muscle areas. Each exercise belongs to exactly one.

| Area | Exercise keys |
|---|---|
| Neck | `neck_tilt`, `head_turn` |
| Shoulders | `overhead_reach`, `alt_reach`, `t_raise`, `front_raise` |
| Upper back & posture | `seated_row`, `cross_swing`, `desk_punch`, `desk_pushup` |
| Arms & wrists | `wrist_flex`, `air_curl`, `triceps_reach`, `chair_dip` |
| Lower back & core | `seated_side_bend`, `seated_lean_back`, `standing_side_bend`, `hip_hinge` |
| Hips & glutes | `sit_to_stand`, `mini_squat`, `side_leg_raise`, `reverse_lunge`, `leg_swing` |
| Legs & circulation | `seated_knee_ext`, `seated_knee_lift`, `seated_heel_raise`, `calf_raise`, `march`, `hamstring_curl`, `step_jack` |

The extension reads areas from the server catalog. `trainer.js`'s offline `FALLBACK_EXERCISES` must use the same names.

## 6. Reminders and scheduling

### 6.1 Settings (first run and later)
- The settings page opens on install. It is reachable later from the toolbar popup.
- **Interval**: presets 30 / 45 / 60 (default) / 90 / 120 min, or a custom value from 1 to 240 min. The low minimum makes stage demos possible.
- **Muscle areas** ("Where do you feel it?"): pick at least one. On first run, "Get started" stays disabled until one is picked.
- **Active hours**: default 09:00–17:00. **Workdays**: default Mon–Fri.
- **Auto-pause in meetings / fullscreen**: on by default.
- **Blurred camera**: on by default. Uses the existing privacy blur.
- **Mode**: Personal (default) or Competitive. Competitive requires a display name and a company (email domain, e.g. `leadliaison.com`).
- **Pose server URL**: advanced field, default `ws://127.0.0.1:8765/ws`.
- A one-line privacy notice; see §9.

All settings live in `chrome.storage.local`.

### 6.2 The schedule
- The state is stored in `chrome.storage.local`: `nextAt` (next reminder time), `skipsInRow`, `snoozesInRow`, `pausedUntil`, and the open reminder window id.
- There is one `chrome.alarms` alarm set to `nextAt`. It is re-created on startup and install from storage. The service worker holds no state in variables.
- Reminders sit on a grid: after a reminder at slot `S`, the next slot is `S + interval` unless an action below says otherwise.
- **Outside active hours or workdays**: the next reminder moves to the next active-window start + interval. Slots skipped this way count as nothing.
- **Late alarm** (laptop asleep, browser closed): if the alarm itself fires more than 10 min after `nextAt`, no stale reminder opens. `nextAt = now + interval`, and no skip is counted. This rule does not apply to auto-pause deferrals.
- **Away at fire time**: if `chrome.idle.queryState(300)` is not `active`, the user is already away from the desk. No window opens, no skip is counted, no XP is given, and the grid continues.
- **Auto-pause**: if any Chrome window is fullscreen, or an **audible** tab is on `meet.google.com`, `*.zoom.us`, `teams.microsoft.com`, or `teams.live.com`, the reminder is deferred and rechecked every 5 min until clear, however long the meeting runs. Counters don't change. When it clears, the deferred reminder fires right away, so the user gets the break right after the meeting. The grid then continues from the first slot after now, and any slots that passed during the deferral are dropped, not stacked.
- Only one reminder window at a time. If one is already open when the alarm fires, the alarm does nothing.

### 6.3 Reminder actions (from the story)
| Action | Effect |
|---|---|
| **Done** | Logs the break, sets `skipsInRow = 0` and `snoozesInRow = 0`. The next reminder stays at its scheduled grid time. XP is awarded per §8. |
| **Snooze 20 min** | `nextAt = now + 20 min`, and the grid re-anchors there, so all later reminders shift by 20 min. `snoozesInRow += 1`. |
| **Skip** | The next reminder stays at its original grid time. `skipsInRow += 1`, `snoozesInRow = 0`. |
| **Close window without acting** | Counts as Skip (detected with `chrome.windows.onRemoved` on the stored window id). Closing after Done does not count. |
| **Snooze cap** | After 2 snoozes in a row, the Snooze button is disabled with the text "Snoozed twice, time to move". Done or Skip resets the cap. |

### 6.4 Warning screen: 3 skips in a row
When `skipsInRow ≥ 3`, the next reminder shows a warning screen instead of the routine:
- Headline: "~N hours without moving", where N = `skipsInRow × interval`, rounded to the nearest half hour ("~3 hours" at the 60-min default).
- Three actions:
  - **Start a break now**: goes into the normal routine in the same window.
  - **Snooze 20 min**: normal snooze rules, including the cap.
  - **Pause 1 hr**: `nextAt = now + 60 min`, re-anchors the grid, counters unchanged.
- The warning keeps appearing until a Done. Closing it counts as Skip.

## 7. The reminder window (`break.html`)

Opened with `chrome.windows.create({type: "popup"})`, about 520×720, focused.

### 7.1 Routine
- 3 exercises, 6 reps each (the existing `BREAK_REPS`), aiming at about 2 minutes. There's no hard time cut.
- Composition: **slot 1** comes from this week's featured area (§8.4). **Slots 2–3** come from the user's selected areas, rotating round-robin across breaks. If the featured area is one of the user's areas, all slots come from the user's areas.
- No duplicates within a routine, and slot 1 is never the exercise that ended the previous routine.
- **Full-body / side-on exercises** (most Hips & glutes and Legs & circulation moves need hips, knees, or feet in view): before each such exercise, a "Get in position" step shows a camera hint ("Stand up, turn sideways, step back until your feet are in frame") and waits until the needed joints are visible, or 15 s pass, before counting starts. Front-camera seated exercises skip this step. Stage demos should use Neck or Shoulders.
- The window title (`document.title`) is `"<Area> | <Exercise label>"`, e.g. "Shoulders | T-raise", and updates per exercise.

### 7.2 Layout
- Header: area | exercise, step "1/3", overall progress bar.
- Camera preview, blurred if blurred mode is on, with skeleton overlay, rep counter "4 / 6", the last rep's form score, and live form cue ("Go a little further", "Slow down").
- Exercise guide: the `how_to` text, a camera hint if the exercise is side-on, and a "▶ Watch demo" button that opens the clip in a small YouTube popup window. This reuses the trainer's existing behavior. The clip is **not embedded**, because YouTube refuses embeds from extension pages (no Referer, Error 153, noted in `trainer.js`).
- XP ticker: XP earned so far this break.
- "Show me a different exercise" link: swaps the current exercise for another one from the same area, not shown last. Reps for that exercise reset.
- Footer: **Done**, **Snooze 20 min**, **Skip**.

### 7.3 End of break
When the routine finishes, or the user presses Done, a summary screen shows:
- An XP breakdown (break XP, bonuses, challenge bonuses) with a count-up animation.
- A level bar animation. On a level-up, a CSS-only confetti burst and the new title ("You're now a Posture Pro!").
- Challenge ticks and any new badge.
- The existing shareable PNG card button, if it carries over cheaply.
- "Back to work", which closes the window. That close is not a Skip.

### 7.4 Fallbacks
- **Camera denied or missing, or pose server unreachable**: the window shows the `how_to` text and the Watch demo button. Done still works for the schedule and resets skips, but earns **0 XP** and doesn't advance streak or challenges.
- **Offline**: text instructions only.

## 8. Gamification

All constants (XP values, thresholds, scoring weights, challenge pool) live in one module per side so they can be tuned on stage.

### 8.1 Form score (server, new for office exercises)
Each finished rep of a `Gentle` exercise, full or partial, gets a 0–100 score from how far it moved and how controlled it was. Workout exercises (squat, push-up, curl, press) keep their issue-based scoring.

```
needed      = |rest_ref − target|            # angle span from rest to the target threshold
depth_ratio = rom / needed
depth_pts   = 70 × clamp((depth_ratio − 0.4) / 0.6, 0, 1)    # 0 at 40% of the way, 70 at target
            + 30 × clamp((depth_ratio − 1.0) / 0.3, 0, 1)    # +30 for going 30% past target
tempo_pts   = −30 if duration < 0.5 s, −15 if duration < 1.0 s, else 0
rep_score   = clamp(round(depth_pts + tempo_pts), 0, 100)
```
- Reaching the target exactly at a controlled pace scores 70. A full, controlled range scores 100. A half-done or rushed rep scores low.
- Live cues for office exercises: "Go a little further" after a rep under 70 on depth, "Slow down" after a rushed rep. Both texts already exist in `ISSUE_TEXT`.
- Weights are tuning knobs. They should be checked against real reps on the demo laptop.

### 8.2 Break XP (extension)
```
completion = min(1, counted_reps / target_reps)   # counted = full reps, capped at target per exercise
form       = average rep_score of all finished reps this break (full + partial) / 100
break_xp   = round(10 × completion × form)
```
- **First break of the day**: +5.
- **Streak bonus** on the first break of the day: +1 per streak day, max +10.
- A **streak** is consecutive workdays (per settings) with at least one Done break that earned XP. Non-workdays don't break it.

### 8.3 Levels (the user's table)
| Level | Name | Total XP |
|---|---|---|
| 1 | Desk Potato | 0 |
| 2 | Chair Escapee | 100 |
| 3 | Stretch Rookie | 250 |
| 4 | Desk Mover | 500 |
| 5 | Posture Pro | 900 |
| 6 | Flow Stretcher | 1400 |
| 7 | Mobility Ninja | 2000 |
| 8 | Movement Master | 3000 |

Lifetime XP never resets or drops.

### 8.4 Daily challenges
Every day, 3 challenges are picked from this pool. The pick is seeded by the date, so every user gets the same three. They reset at local midnight.

| Id | Name | Rule | Bonus |
|---|---|---|---|
| `variety` | Variety pack | Exercises from 3 different muscle areas today | +25 |
| `high_five` | High five | 5 Done breaks today | +30 |
| `clean_form` | Clean form | One break with average form ≥ 90 | +20 |
| `early_mover` | Early mover | A Done break before 10:00 | +15 |
| `no_excuses` | No excuses | 3 Done breaks in a row today, no snooze or skip between | +25 |

### 8.5 Weekly featured area
- One muscle area is featured each week, the same for everyone. It is chosen by ISO week number mod 7 over the 7 areas and rotates Monday 00:00 local.
- Challenge: "<Area> week: complete 10 <area> exercises" (an exercise counts when its target reps are reached). Reward: +100 XP and that area's badge.

### 8.6 Badges
A badge is earned on the first completion of each daily challenge type (5) and of each weekly area (7). Level titles show alongside. The toolbar popup shows the badge shelf.

## 9. Privacy and security

- **Camera frames.** Blurred mode blurs only the on-screen preview. The pose server needs the real frame.
  - With the pose server on the user's own laptop (the default), frames never leave the machine.
  - Through the optional tunnel (§10.3), frames travel over HTTPS to the demo laptop. They are processed in memory and **never written to disk or logged**. This is already true, and must stay true.
- **Setup notice** (one line): "Your camera is used only to count reps and is never recorded. Only your name, XP, level and streak are shared, and only in Competitive mode."
- **Leaderboard data in Supabase:** player id (a random UUID generated at install), display name, company, total XP, level, streak, week XP, week key, and a per-player secret. Nothing else.
- **Supabase access:**
  - The extension holds the project URL and the **anon** key only, never the service-role key.
  - The table is not directly writable or readable by anon.
  - Writes go through a `submit_score` SQL function that inserts a new player, or updates one only when the per-player secret matches. The secret is generated at install and stored locally. This stops people overwriting each other's rows.
  - Reads go through a `leaderboard` SQL function that never returns secrets.
- Switching to Personal calls `submit_score` with a delete flag, which removes the row.
- Inputs are validated in the SQL functions: name ≤ 40 chars, company ≤ 100 chars, numbers non-negative and bounded.
- The pose server keeps its existing origin rule (only `chrome-extension://` origins).

## 10. Backend pieces

### 10.1 Pose server changes (`server/`)
- Exercise categories per §5.
- Form scoring for `Gentle` exercises per §8.1, with pytest coverage in `tests/test_office.py` / `tests/test_analysis.py`.
- No other protocol changes. Frame results already carry each rep's `score` and the session `summary`.

### 10.2 Supabase leaderboard
- **One table, `players`**: `id uuid pk`, `secret text`, `name text`, `company text`, `xp int`, `level int`, `streak int`, `week_xp int`, `week text` (ISO week, e.g. `2026-W45`), `updated_at timestamptz`.
- **`submit_score(p_id, p_secret, p_name, p_company, p_xp, p_level, p_streak, p_week_xp, p_week, p_delete)`**: `security definer`, callable by anon.
- **`leaderboard(p_company, p_period, p_player)`**: `period` is `week` or `all`. Returns the top 10 plus the caller's row and rank. The week view only counts rows whose `week` equals the current ISO week.
- RLS enabled on `players` with no anon policies. Access is through the two functions only.
- The extension calls them with `POST {SUPABASE_URL}/rest/v1/rpc/<fn>`, sending the header `apikey: <publishable key>`. No SDK; `fetch` is enough.
- Project: `https://hysvvrdopodlqvuxnvco.supabase.co`, with a publishable (`sb_publishable_…`) key.
- The client sends a snapshot after every XP change and when the popup opens. Failures are ignored, because the next snapshot replaces it.
- The SQL lives in the repo as one file, e.g. `supabase/leaderboard.sql`, and is pasted into the Supabase SQL editor.
- **Needed from the team:** a Supabase project, plus its URL and anon key.

### 10.3 Optional: colleagues sharing the demo laptop's pose server
- Run `cloudflared tunnel --url http://127.0.0.1:8765` on the demo laptop. Colleagues set the Pose server URL to `wss://<random>.trycloudflare.com/ws`.
- The extension CSP must allow `wss://*.trycloudflare.com`.
- Only if time allows. Otherwise colleagues run the server locally.

## 11. Constraints

- Chrome MV3. The service worker is stateless; everything is in `chrome.storage.local`. `chrome.alarms` has a 30 s minimum.
- Extension CSP `connect-src` must include `ws://127.0.0.1:*` (present), the Supabase project origin (`https://<ref>.supabase.co`), and optionally `wss://*.trycloudflare.com`.
- Permissions: `storage`, `alarms`, `idle`, `tabs` (meeting detection). The existing `notifications` permission can go once the notification coach is removed.
- The pose server keeps one MediaPipe engine per WebSocket, so CPU scales with simultaneous breaks. That's fine for one demo laptop plus a few tunnel users.
- Later option (not today): run MediaPipe in the browser (`@mediapipe/tasks-vision`) and port `analysis/` to JS. That removes the pose server and keeps frames on every user's machine.

## 12. Toolbar popup (`popup.html`)

- **Header**: level number and title, XP bar to the next level, total XP.
- **Next break**: "Next break at 14:20 · in 23 min". After a snooze it shows the next 3 times with "shifted +20 min". It also shows "Paused until 15:00" or "Outside active hours" when relevant.
- **Today**: breaks done, skips in a row, streak (days).
- **Challenges**: the 3 daily challenges and the weekly featured area, each with progress.
- **Badges**: shelf row.
- **Leaderboard tab** (Competitive only): This week / All time; rank, name, level title, XP, streak; your row highlighted. In Personal mode the tab shows "Switch to Competitive to join <company>'s board".
- **Actions**: **Break now** (demo trigger; opens the reminder window immediately), Pause 1 hr / Resume, Practice (opens `trainer.html`), Settings.
- The badge text on the toolbar icon shows minutes to the next break. The existing coach already does this.

## 13. Demo needs
- **Break now** in the popup, plus custom intervals down to 1 min.
- The pose server running on the demo laptop.
- Leaderboard pre-populated by colleagues who installed the unpacked extension and played a break, or by the presenter switching between two Chrome profiles.

## 14. Decisions

**Decided by the user**
- Gamified, fun experience. Personal vs Competitive modes with a company leaderboard.
- The 8 levels and XP thresholds in §8.3.
- XP depends on how correctly the exercise is done, using this repo's motion detection with blurred mode, including **adding real form scoring for office exercises** (§8.1).
- Categories by muscle area (§5 mapping accepted).
- The challenge design in §8.4–8.5, and the guesses played back about XP (no XP loss, level never resets, leaderboard shows XP not form scores).
- Supabase for the backend, to the extent it can host it.
- Hackathon demo, today.
- Everything in the original story: setup, presets, Done/Snooze/Skip semantics, 3-skip warning, close = skip, offline fallback, plus the suggested enhancements (active hours, auto-pause, swap exercise, popup stats, snooze cap 2). Eyes was dropped by agreement.

**Calls made by Claude (check these)**
- The pose server stays local on the demo laptop, because Supabase can't run Python MediaPipe. Sharing it is an optional tunnel (§10.3). Supabase hosts the leaderboard only.
- Build on this repo. Practice mode keeps the existing trainer, and a new lean `break.html` is the reminder window.
- The story's embedded 2-min YouTube video becomes a camera-coached 3-exercise routine, with demo clips opening in a small YouTube popup window instead of embedded.
- Form-score formula (§8.1) and XP formula and bonus sizes (§8.2). These are tuning knobs.
- No camera or no server: Done counts for the schedule but earns 0 XP.
- Weekly featured area always takes routine slot 1, even if the user didn't pick that area.
- Late-alarm, away-at-fire-time, and auto-pause rules (§6.2), none of which count as skips. Auto-pause waits out the meeting, then fires once.
- Full-body exercises stay in, behind a "Get in position" step (§7.1).
- Pause 1 hr doesn't reset the skip counter. The warning repeats until a Done.
- Identity: a random UUID plus a secret, a typed display name and a company domain. No login.
- Custom interval minimum of 1 min for demos.
- The demo-day cut order in §17.

## 15. Left to the builder
- How `break.html` shares camera/WebSocket/blur code with `trainer.js` (extract a module or duplicate the minimum).
- Visual style, animations, exact copy beyond what's quoted above.
- Window size and position details, popup layout details.
- How scheduler and XP logic get tested. Keep it small, e.g. pure functions with one Node self-check script, plus pytest for the form scoring.

## 16. Risks to check first
1. `getUserMedia` prompts and works in a `chrome.windows.create({type:"popup"})` extension page, and the grant persists.
2. The form-score weights give sensible numbers on real reps (a lazy rep under 60, a good rep over 85).
3. Supabase RPC calls from the extension work under the updated CSP.

## 17. Demo-day scope and cut order

Build in this order. Each step leaves a demoable product. If time runs out, everything after the last finished step is cut.

1. **Server**: muscle-area categories plus form scoring (§5, §8.1).
2. **Reminder window**: `break.html` with routine, camera plus blur, reps, form score, live XP, summary screen with level-up; `Break now` from a minimal popup (§7, §8.2–8.3).
3. **Settings page**: interval, muscle areas (≥1 to get started), mode, name, company; opens on install (§6.1).
4. **Scheduler**: fixed-interval alarm, Done / Snooze / Skip, close = skip, snooze cap, 3-skip warning (§6.2 core, §6.3, §6.4).
5. **Toolbar popup**: level bar, next break and shifted schedule, today stats, actions (§12 minus challenges and leaderboard).
6. **Leaderboard**: Supabase SQL plus popup tab (§10.2, §12).
7. **Challenges and badges** (§8.4–8.6).
8. **Scheduler extras**: active hours and workdays, auto-pause, away-at-fire-time, late alarm (§6.2).
9. **Tunnel** for colleagues (§10.3).
