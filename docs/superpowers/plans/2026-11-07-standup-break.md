# StandUp Break Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the FormCoach POC into StandUp Break: fixed-interval movement reminders that open a camera-coached 2-minute routine, score form into XP, and feed levels, challenges and an opt-in company leaderboard.

**Architecture:**
- **Pose server** (`server/`, FastAPI + MediaPipe): stays local on the demo laptop. It gains muscle-area categories and real per-rep form scoring for office exercises.
- **Extension** (`extension/`, MV3):
  - Pure logic in `extension/lib/*.js` ES modules (schedule, XP, routine, challenges). These are tested by one Node self-check script.
  - Chrome-facing code in the service worker and three new pages: `break.html` (reminder window), `popup.html` (toolbar), `options.html` (settings).
  - The existing `trainer.html` stays as Practice mode.
- **Leaderboard**: Supabase. One table plus two `security definer` SQL functions, called with `fetch` from the extension.

**Tech Stack:** Python 3.12, FastAPI, MediaPipe, pytest · Chrome MV3, vanilla JS ES modules, no bundler, no npm deps · Node 22 (`node:assert`) for the self-check · Supabase Postgres (PostgREST RPC).

**Spec:** `docs/superpowers/specs/2026-11-07-standup-break-design.md`. Read it with this plan; section numbers below (§) refer to it.

## Global Constraints

- Demo is today. Tasks run in order. Each task leaves a demoable product, and work after the last finished task is cut (§17).
- No new runtime dependencies: no npm packages, no Supabase SDK, no Python packages beyond `server/requirements.txt`.
- The extension service worker holds no state in variables. All state is in `chrome.storage.local`.
- Everything in `extension/lib/` except `store.js`, `leaderboard.js` and `pose-client.js` must be pure: no `chrome.*`, no DOM, time passed in as `now` (ms). That keeps them runnable under Node.
- Muscle areas, exact strings, in this order: `Neck`, `Shoulders`, `Upper back & posture`, `Arms & wrists`, `Lower back & core`, `Hips & glutes`, `Legs & circulation`.
- Levels, exact: 1 Desk Potato 0 · 2 Chair Escapee 100 · 3 Stretch Rookie 250 · 4 Desk Mover 500 · 5 Posture Pro 900 · 6 Flow Stretcher 1400 · 7 Mobility Ninja 2000 · 8 Movement Master 3000.
- XP never decreases. The leaderboard never shows form scores or break history.
- Camera frames are never stored or logged, on either side.
- Copy fixed by the spec:
  - window title `"<Area> | <Exercise label>"`
  - warning headline `"~N hours without moving"`
  - snooze-cap text `"Snoozed twice, time to move"`
  - privacy notice `"Your camera is used only to count reps and is never recorded. Only your name, XP, level and streak are shared, and only in Competitive mode."`
- ISO week key format `YYYY-"W"WW`, e.g. `2026-W45`. It must match Postgres `to_char(now(), 'IYYY-"W"IW')`.
- Commits: one per task minimum, on branch `feature/standup-break`. Follow the `committing-changes` skill.

## Review Focus

1. **Reminder window closed mid-routine (window X, or Cmd+W)**: counts as Skip exactly once, even if a Done/Snooze message raced it. Closing the summary after Done never counts as Skip. Test: `applyAction` on a schedule whose `windowId` is null ignores `close` (Task 5).
2. **Pose server down, or camera permission denied, when the reminder opens**: the window still renders text instructions and all three buttons. Done gives 0 XP and no streak. Test: `award` with `scored: false` returns `total: 0` and leaves the streak unchanged (Task 2).
3. **Interval changed in settings while a reminder is scheduled**: the next reminder moves to `now + new interval`. It must not keep the old `nextAt` or fire immediately. Test: `rescheduleForInterval` (Task 5).
4. **Browser restarted, or service worker killed, between reminders**: the alarm is re-created from stored `nextAt`, and a late fire over 10 min doesn't open a stale window. Tests: `decideFire` late case (Task 9). `ensureAlarm` runs on `onStartup` and at the top level (Task 5).
5. **Leaderboard unconfigured (empty Supabase config) or unreachable**: popup and break flow work normally, and the leaderboard tab says it is unavailable. Test: `fetchBoard` returns `null` when `SUPABASE_URL` is empty, without throwing (Task 7).

---

### Task 1: Server — muscle-area categories and office form scoring

**Files:**
- Modify: `server/analysis/exercises.py` (category constants and each `gentle(...)` call's `category=`; add `office_rep_score`; add `Gentle.rep_score`, `Exercise.rep_score`)
- Modify: `server/analysis/session.py` (`RepCounter.update`: score via `ex.rep_score`)
- Modify: `server/tests/test_office.py` (replace `test_relaxed_rep_that_just_reaches_target_scores_full_marks`, add new tests at end)
- Modify: `extension/trainer.js:27-50` (`FALLBACK_EXERCISES` category strings only)

**Interfaces:**
- Produces: `office_rep_score(rom: float, needed: float, duration: float) -> int` in `analysis/exercises.py`
- Produces: `Exercise.rep_score(self, rom: float, needed: float, duration: float, issues: list[str]) -> int`
  - Base class returns `max(0, 100 - 20 * len(issues))`, which is the current behavior.
  - `Gentle` overrides it to return `office_rep_score(rom, needed, duration)`.
- Produces: catalog `category` values are exactly the 7 muscle areas (Global Constraints). `/health` and the WS `ready` message carry them unchanged.

- [ ] **Step 1: Set up the server venv**

Run: `cd server && python3.12 -m venv .venv && .venv/bin/pip install -q -r requirements.txt && .venv/bin/pytest -q`
Expected: all existing tests pass. This is the baseline.

- [ ] **Step 2: Write failing tests** (append to `server/tests/test_office.py`)

```python
from analysis.exercises import office_rep_score, AREAS

AREA_MAP = {
    "Neck": {"neck_tilt", "head_turn"},
    "Shoulders": {"overhead_reach", "alt_reach", "t_raise", "front_raise"},
    "Upper back & posture": {"seated_row", "cross_swing", "desk_punch", "desk_pushup"},
    "Arms & wrists": {"wrist_flex", "air_curl", "triceps_reach", "chair_dip"},
    "Lower back & core": {"seated_side_bend", "seated_lean_back", "standing_side_bend", "hip_hinge"},
    "Hips & glutes": {"sit_to_stand", "mini_squat", "side_leg_raise", "reverse_lunge", "leg_swing"},
    "Legs & circulation": {"seated_knee_ext", "seated_knee_lift", "seated_heel_raise", "calf_raise",
                           "march", "hamstring_curl", "step_jack"},
}

def test_every_office_exercise_sits_in_its_muscle_area():
    assert list(AREAS) == list(AREA_MAP)
    for area, keys in AREA_MAP.items():
        assert {e.key for e in OFFICE_EXERCISES if e.category == area} == keys

@pytest.mark.parametrize("rom,needed,duration,expected", [
    (50, 50, 1.5, 70),    # exactly at target, calm
    (65, 50, 1.5, 100),   # 30% past target
    (20, 50, 1.5, 0),     # 40% of the way
    (35, 50, 1.5, 35),    # 70% of the way
    (65, 50, 0.4, 70),    # rushed < 0.5 s: -30
    (65, 50, 0.8, 85),    # quick < 1.0 s: -15
    (200, 50, 1.5, 100),  # clamp high
    (5, 50, 0.2, 0),      # clamp low
])
def test_office_rep_score(rom, needed, duration, expected):
    assert office_rep_score(rom, needed, duration) == expected

@pytest.mark.parametrize("ex", OFFICE_EXERCISES, ids=lambda e: e.key)
def test_partial_office_rep_scores_below_a_full_one(ex):
    step = 1 if ex.target > ex.rest else -1
    relaxed = ex.rest - 5 * step
    halfway = relaxed + (ex.target - relaxed) * 0.7
    (rep,) = _counter_run(ex, syn.trajectory(relaxed, halfway, 2 * FPS))
    assert rep.partial and rep.score < 70
```

Replace the existing `test_relaxed_rep_that_just_reaches_target_scores_full_marks` with:

```python
@pytest.mark.parametrize("ex", OFFICE_EXERCISES, ids=lambda e: e.key)
def test_relaxed_rep_that_just_reaches_target_scores_about_70(ex):
    step = 1 if ex.target > ex.rest else -1
    relaxed, just_past = ex.rest - 5 * step, ex.target + 2 * step
    (rep,) = _counter_run(ex, syn.trajectory(relaxed, just_past, 2 * FPS))
    assert not rep.partial and rep.issues == [] and 70 <= rep.score <= 85
```

- [ ] **Step 3: Run to verify failure**

Run: `cd server && .venv/bin/pytest tests/test_office.py -q`
Expected: FAIL with `ImportError: cannot import name 'office_rep_score'`.

- [ ] **Step 4: Implement**
  - In `exercises.py`, replace `NECK, UPPER, LOWER, STAND` with 7 area constants plus `AREAS: tuple[str, ...]` in the Global Constraints order. Set each `gentle(...)` call's `category=` per the `AREA_MAP` above (spec §5).
  - Add `office_rep_score` exactly as spec §8.1: `depth_pts` = 70·clamp((r−0.4)/0.6) + 30·clamp((r−1.0)/0.3); `tempo_pts` = −30 if d<0.5, −15 if d<1.0, else 0; `round` then clamp 0..100. Guard `needed <= 0` by returning 0.
  - Add `rep_score` on `Exercise` and the `Gentle` override. `calibration.apply` uses `dataclasses.replace`, so overrides survive calibration.
  - In `RepCounter.update`, replace `score=max(0, 100 - 20 * len(rep_issues))` with `score=ex.rep_score(rom, needed, duration, rep_issues)`. `rom`, `needed` and `duration` already exist there.
  - In `extension/trainer.js` `FALLBACK_EXERCISES`, set `neck_tilt`/`head_turn` to `"Neck"` and `overhead_reach` to `"Shoulders"`.

- [ ] **Step 5: Run the full server suite**

Run: `cd server && .venv/bin/pytest -q`
Expected: all pass. `test_analysis.py:47` (`score == 100`) covers workout exercises, so it must still pass unchanged.

- [ ] **Step 6: Manual check on real reps (spec risk 2)**

Run: `cd server && .venv/bin/python app.py`. Load `extension/` unpacked, open the trainer, and do 3 lazy and 3 full `overhead_reach` reps.
Expected: lazy reps under 60, full controlled reps over 85. If not, tune only the 0.4/0.6/0.3 constants and update the parametrized expectations.

- [ ] **Step 7: Commit** — `feat(server): muscle-area categories and office form scoring`

---

### Task 2: Pure game logic — XP, levels, routine builder, Node self-check

**Files:**
- Create: `extension/package.json` (contents: `{"type": "module", "private": true}`, so Node treats `lib/*.js` as ES modules; Chrome ignores it)
- Create: `extension/lib/xp.js`
- Create: `extension/lib/routine.js`
- Create: `extension/tests/check.mjs`

**Interfaces:**
- Produces (`lib/routine.js`):
  - `AREAS: string[]`: the 7 areas, Global Constraints order.
  - `BREAK_REPS = 6`.
  - `featuredArea(now: number): string`: `AREAS[isoWeekNumber(now) % 7]`.
  - `buildRoutine(catalog: Exercise[], opts: {areas: string[], featured: string, lastKey: string|null, n: number}): Move[]`
    - `Exercise` = catalog entry `{key, label, category, camera, how_to, demo}`.
    - `Move = {key, label, area, camera, how_to, demo, target: BREAK_REPS}`.
    - Returns up to 3 moves. Slot 1 is from `featured`, unless `featured` is in `areas`. The rest round-robin over `areas`, starting at index `n`, and within an area pick by `n`.
    - No duplicate keys. `moves[0].key !== lastKey`.
  - `swapMove(catalog: Exercise[], moves: Move[], i: number): Move|null`: another exercise of `moves[i].area`, not in `moves`. `null` if none.
  - `needsPositioning(move: Move): boolean`: `move.camera === "side"` or `move.area` is `Hips & glutes`/`Legs & circulation`.
- Produces (`lib/xp.js`):
  - `LEVELS: {level, name, xp}[]` (Global Constraints).
  - `XP = {base: 10, firstBreak: 5, streakPerDay: 1, streakMax: 10}`.
  - `levelFor(xp: number): {level, name, floor, next: number|null, progress: number}`, where `progress` is 0..1 and equals 1 at max level.
  - `dayKey(now): "YYYY-MM-DD"` (local). `isoWeek(now): "YYYY-Www"`. `isoWeekNumber(now): number`.
  - `breakXp({countedReps, targetReps, scores}): number`, per spec §8.2. `scores` holds all finished rep scores (full and partial). Returns 0 if `scores` is empty.
  - `award(profile: Profile, result: BreakResult, now: number, workdays: number[]): {profile: Profile, breakdown: Breakdown, levelUp: null | {from: number, to: number, name: string}}`
    - `Profile = {playerId, secret, xp, streak, lastStreakDay, lastBreakDay, weekXp, week, badges: string[], daily: object|null, weekly: object|null}`.
    - `BreakResult = {scored: boolean, countedReps, targetReps, scores: number[], moves: {key, area, completed: boolean}[]}`.
    - `Breakdown = {breakXp, firstBreak, streak, challenges: {id, name, bonus}[], total}`. `challenges` stays `[]` until Task 8.
    - Rules (§8.2):
      - `scored:false` gives total 0 and leaves the profile unchanged except `lastBreakDay`.
      - First scored break of `dayKey(now)` gets `firstBreak` + `min(streak, streakMax)` after the streak update.
      - The streak increments when `lastStreakDay` is the previous workday in `workdays` (0=Sun..6=Sat). It resets to 1 otherwise, and is unchanged if `lastStreakDay` is today.
      - It only updates when `breakXp > 0`.
      - `weekXp` resets when `week !== isoWeek(now)`.
      - The input profile is never mutated.

- [ ] **Step 1: Write the failing self-check** `extension/tests/check.mjs`

The file is plain `node:assert/strict` with one `check(name, fn)` helper that prints `ok <name>` and sets `process.exitCode = 1` on failure. Cases:

```js
check("levels", () => {
  assert.equal(levelFor(0).name, "Desk Potato");
  assert.equal(levelFor(99).level, 1);
  assert.equal(levelFor(100).name, "Chair Escapee");
  assert.equal(levelFor(3000).name, "Movement Master");
  assert.equal(levelFor(3000).next, null);
  assert.equal(levelFor(175).progress, 0.5);
});
check("breakXp", () => {
  assert.equal(breakXp({countedReps: 18, targetReps: 18, scores: Array(18).fill(100)}), 10);
  assert.equal(breakXp({countedReps: 9, targetReps: 18, scores: Array(9).fill(80)}), 4);
  assert.equal(breakXp({countedReps: 0, targetReps: 18, scores: []}), 0);
});
check("award: first scored break of day gets bonuses, streak continues from previous workday", () => {
  const fri = new Date(2026, 10, 6, 11).getTime(), mon = new Date(2026, 10, 9, 11).getTime();
  const p0 = {...blankProfile(), xp: 95, streak: 2, lastStreakDay: dayKey(fri)};
  const {profile, breakdown, levelUp} = award(p0, full(), mon, [1,2,3,4,5]);
  assert.equal(profile.streak, 3);
  assert.deepEqual([breakdown.breakXp, breakdown.firstBreak, breakdown.streak], [10, 5, 3]);
  assert.equal(profile.xp, 113);
  assert.deepEqual(levelUp, {from: 1, to: 2, name: "Chair Escapee"});
  assert.equal(p0.xp, 95);  // not mutated
});
check("award: second break same day has no bonus", ...);          // breakdown.total === 10
check("award: unscored Done earns nothing", ...);                  // total 0, streak unchanged
check("award: gap of a workday resets streak to 1", ...);
check("award: new ISO week resets weekXp", ...);
check("routine: featured slot first, no dupes, avoids lastKey", ...); // using a 30-entry catalog fixture built from AREA→keys
check("routine: all slots from user areas when featured is one of them", ...);
check("swapMove returns same-area exercise not already in routine; null when area exhausted", ...);
check("featuredArea rotates weekly", () => assert.notEqual(featuredArea(mon), featuredArea(mon + 7*864e5)));
```

`blankProfile()` and `full()` are local fixtures in the check file. `full()` is a scored result with 18/18 reps at 100.

- [ ] **Step 2: Run to verify failure**

Run: `node extension/tests/check.mjs`
Expected: fails with `ERR_MODULE_NOT_FOUND` for `../lib/xp.js`.

- [ ] **Step 3: Implement `lib/xp.js` and `lib/routine.js`** per the Interfaces above. `isoWeek` uses the Thursday-of-week rule, so `2026-11-09` → `2026-W46`.

- [ ] **Step 4: Run to verify pass**

Run: `node extension/tests/check.mjs`
Expected: every line `ok …`, exit code 0.

- [ ] **Step 5: Commit** — `feat(extension): XP, levels and routine builder with Node self-check`

---

### Task 3: Reminder window — camera-coached routine, live XP, summary

**Files:**
- Create: `extension/lib/store.js`
- Create: `extension/lib/pose-client.js`
- Create: `extension/break.html`, `extension/break.js`, `extension/break.css`
- Create: `extension/popup.html`, `extension/popup.js`, `extension/popup.css` (minimal for now: a **Break now** button only)
- Modify: `extension/service-worker.js` (replace the idle coach and notifications; see below)
- Modify: `extension/manifest.json`

**Interfaces:**
- Consumes: Task 1 catalog categories and rep `score`. Task 2 `buildRoutine`, `swapMove`, `needsPositioning`, `featuredArea`, `award`, `levelFor`, `breakXp`.
- Produces (`lib/store.js`; all async, all wrap `chrome.storage.local`):
  - `SETTINGS_DEFAULTS = {intervalMin: 60, areas: [], activeStart: "09:00", activeEnd: "17:00", workdays: [1,2,3,4,5], autoPause: true, privacy: true, mode: "personal", name: "", company: "", serverUrl: "ws://127.0.0.1:8765/ws", setupDone: false}`
    - `privacy` and `serverUrl` are the same keys `trainer.js` already uses, so Practice mode shares them.
  - `getSettings()` / `saveSettings(patch)`.
  - `getProfile()`: creates `playerId` and `secret` with `crypto.randomUUID()` on first call. `setProfile(p)`.
  - `getSchedule()` / `setSchedule(s)` (shape owned by Task 5; Task 3 stores only `windowId`, `lastKey`, `breakCount`).
  - `appendLog(entry)` / `readLog()` (key `breakLog`, max 500).
  - `getCatalog()`: reads the cached `exerciseCatalog` (same key as `trainer.js`).
- Produces (`lib/pose-client.js`):
  - `createPoseClient({serverUrl, video, canvas, privacy, onFrame, onStatus}) → {start(): Promise<boolean>, stop(): void, setExercise(key: string): void}`
  - `onStatus(state)` with `state` in `"connecting" | "open" | "offline" | "camera-denied"`. `onFrame(msg)` gets every server `frame` message for the current exercise. Catalog messages (`ready`) are cached into `exerciseCatalog`.
  - Adapted copy (not a move) of `trainer.js`: `connect`/`pump`/`onMessage` (lines 266-393), the mask blur `updateMask`/`drawPrivate` (576-646), `render`/`drawSkeleton` (653-716), and camera start/stop (888-955).
  - `// ponytail: duplicated from trainer.js to keep Practice mode untouched on demo day; extract a shared module later.`
- Produces (service worker messages; sender must be `chrome.runtime.id`):
  - `{type: "break-now"}` → opens the reminder window. Responds `{ok}`.
  - `{type: "break-action", action: "done", result: BreakResult}` → `award`, `setProfile`, `appendLog`, clears `windowId`. Responds `{ok, breakdown, levelUp, profile}`.
  - `{type: "break-action", action: "snooze"|"skip"}` → Task 3 just clears `windowId` and closes the window. Task 5 adds the schedule effects.
- Produces: `openReminder({manual: boolean})` in the service worker.
  - If `windowId` is set and the window exists, focus it.
  - Otherwise call `chrome.windows.create({url: "break.html" + (manual ? "#manual" : ""), type: "popup", width: 520, height: 720, focused: true})` and store `windowId`.
- Manifest:
  - `name` "StandUp Break".
  - `action.default_popup: "popup.html"`; remove the `action.onClicked` handler.
  - `background: {service_worker: "service-worker.js", type: "module"}`.
  - `permissions: ["storage", "alarms", "idle", "tabs"]`; drop `notifications`.
  - `options_ui: {page: "options.html", open_in_tab: true}`. The file arrives in Task 4; until then the options link 404s, which is acceptable.

`break.js` behavior (spec §7):
- **Init**:
  - Load settings, profile, catalog, and schedule (`lastKey`, `breakCount`).
  - `moves = buildRoutine(catalog, {areas: settings.areas.length ? settings.areas : AREAS.slice(0, 2), featured: featuredArea(now), lastKey, n: breakCount})`.
  - Start the pose client with the first move.
- **Per move**:
  - `document.title` = `"<area> | <label>"`.
  - Show the `how_to` text, a camera hint if side-on, and a **▶ Watch demo** button. It opens `https://www.youtube.com/watch?v=<id>` in a 480×400 popup window, validating id `/^[\w-]{11}$/`; this is the trainer's `openDemo` behavior.
  - If `needsPositioning(move)`: a "Get in position" overlay stays until a frame arrives with `feedback` not containing `not_visible`, or 15 s pass.
  - Count `summary.reps` up to `target`. Collect every `rep_event.score` (full and partial). Show the last rep score and any `rep_event.issue_text[0]` as the cue. Live XP ticker = `breakXp` of what's collected so far.
  - At target, auto-advance.
  - "Show me a different exercise" → `swapMove`, then reset that move's reps.
- **Done** (button, or the last move finishing):
  - Build a `BreakResult` and send `break-action done`.
  - Show the summary: count-up of `breakdown.total` with a line per non-zero item; a level bar from `levelFor`; and on `levelUp`, a CSS-only confetti and `You're now a <name>!`.
  - "Back to work" calls `window.close()`.
- **Snooze / Skip**: send the action, then `window.close()`.
- **Fallback**:
  - `onStatus("offline" | "camera-denied")` → hide the camera and show the `how_to` text plus Watch demo. Done sends `result.scored = false`.
  - `navigator.onLine === false` → hide Watch demo.
- Also save `lastKey` (the last move's key) and `breakCount + 1` via the service worker on Done.

- [ ] **Step 1: Write `store.js` and `pose-client.js`**, then a throwaway check: open `break.html` with only the camera preview wired.
Expected: camera prompt appears in the popup window, and after allowing it the skeleton shows (spec risk 1). Verify the grant persists by reopening the window. Remove nothing; this becomes the page.
- [ ] **Step 2: Implement the full `break.html/js/css`, minimal popup, service worker messages, and manifest changes.**
- [ ] **Step 3: Run the self-check** (unchanged libs must still pass): `node extension/tests/check.mjs`. Expected: all `ok`.
- [ ] **Step 4: Manual demo path** with the server running and the extension reloaded:
  1. Click toolbar → **Break now** → window opens titled e.g. `Neck | Neck side tilt`.
  2. Do the reps → counter advances, rep score and cue show, XP ticker rises.
  3. Finish 3 moves → summary shows the XP breakdown. Starting from 95 XP (set via DevTools `chrome.storage.local`), level-up confetti shows "You're now a Chair Escapee!".
  4. Stop the server → **Break now** → text-instructions fallback. Done → summary shows 0 XP.
- [ ] **Step 5: Commit** — `feat(extension): camera-coached reminder window with XP summary`

---

### Task 4: Settings page (first run + later edits)

**Files:**
- Create: `extension/options.html`, `extension/options.js`, `extension/options.css`
- Modify: `extension/service-worker.js` (`chrome.runtime.onInstalled` with `reason === "install"` → `chrome.runtime.openOptionsPage()`)

**Interfaces:**
- Consumes: `getSettings`, `saveSettings`, `getProfile`, `AREAS`.
- Produces:
  - On save, it sends `{type: "settings-saved", intervalChanged: boolean}` to the service worker. Task 5 consumes it.
  - On save with `mode` changed to `personal` from `competitive`, it also sends `{type: "left-board"}`. Task 7 consumes it; until then the service worker ignores it.

Fields (spec §6.1):
- **Interval**: preset radio 30/45/60/90/120 plus "Custom" number 1–240.
- **"Where do you feel it?"**: 7 area chips; at least one required.
- **Active hours**: two `<input type="time">`. **Workdays**: 7 toggles.
- **Auto-pause** checkbox. **Blurred camera** checkbox.
- **Mode**: Personal/Competitive radio. Competitive reveals display name (1–40 chars) and company (`<input>` with pattern `^[a-z0-9.-]+\.[a-z]{2,}$`, lowercased).
- **Advanced**: pose server URL.
- The privacy notice line (exact copy in Global Constraints).

Buttons:
- First run (`setupDone === false`): button **Get started**. It is disabled until ≥1 area is picked and the Competitive fields are valid. It saves with `setupDone: true`.
- Later: button **Save**, same validation.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Manual check**:
  1. Remove and re-add the unpacked extension → settings opens in a tab.
  2. **Get started** stays disabled until an area is picked, and stays disabled again with Competitive and an empty name.
  3. Save, reopen → values persist.
  4. **Break now** routine uses only the picked areas plus the featured slot.
- [ ] **Step 3: Commit** — `feat(extension): settings page with first-run setup`

---

### Task 5: Scheduler — fixed interval, Done/Snooze/Skip, close = skip, snooze cap, 3-skip warning

**Files:**
- Create: `extension/lib/schedule.js`
- Modify: `extension/service-worker.js`, `extension/break.js`, `extension/break.html`
- Modify: `extension/tests/check.mjs` (append cases)

**Interfaces:**
- Produces (`lib/schedule.js`, pure, times in ms):
  - Constants: `SNOOZE_MIN = 20`, `SNOOZE_CAP = 2`, `WARN_SKIPS = 3`, `PAUSE_MIN = 60`.
  - `Schedule = {nextAt, skipsInRow, snoozesInRow, pausedUntil, windowId, lastKey, breakCount, shiftedBy}`
    - `shiftedBy` = minutes of shift from the last snooze. The popup shows it; it resets on Done/Skip.
  - `initialSchedule(now, intervalMin): Schedule`, with `nextAt = now + interval`.
  - `onFire(s, now, intervalMin): Schedule`. It records the fired slot and sets `nextAt = slot + interval`, so Done/Skip keep the grid.
  - `applyAction(s, action, now, intervalMin): Schedule`, with `action` one of `"done" | "skip" | "snooze" | "pause" | "close"`, per spec §6.3/§6.4:
    - `done`: skips 0, snoozes 0.
    - `skip`: skips +1, snoozes 0.
    - `snooze`: `nextAt = now + 20m`, snoozes +1, `shiftedBy = 20`. A no-op if `!canSnooze(s)`.
    - `pause`: `nextAt = now + 60m`, counters unchanged.
    - `close`: same as `skip`, **but only if `s.windowId != null`**. Otherwise the schedule is returned unchanged.
    - Every action sets `windowId = null`.
  - `canSnooze(s): boolean` → `s.snoozesInRow < SNOOZE_CAP`.
  - `showWarning(s): boolean` → `s.skipsInRow >= WARN_SKIPS`.
  - `warningHours(skips, intervalMin): number` → `Math.round(skips * intervalMin / 30) / 2`.
  - `upcoming(s, intervalMin, count = 3): number[]`.
  - `rescheduleForInterval(s, now, intervalMin): Schedule` → `nextAt = now + interval`.
- Service worker:
  - One alarm named `next-break` at `nextAt`. `ensureAlarm()` runs at the top level, on `onStartup`, and on `onInstalled`; it creates `initialSchedule` if none is stored.
  - On alarm: if a reminder window is open, `nextAt += interval` and nothing opens. Otherwise call `onFire`, then `openReminder({manual: false})`.
  - `chrome.windows.onRemoved(id)`: if `id === s.windowId`, apply `close`.
  - `break-action` now also applies `applyAction`. A new message `{type: "pause"}` comes from the warning screen.
  - `settings-saved` with `intervalChanged` → `rescheduleForInterval`.
  - Toolbar badge = minutes to `nextAt`, keeping the existing badge colors; recomputed on each alarm and on storage change.
  - A 1-min `badge-tick` alarm refreshes the badge text.
- `break.js`:
  - If `showWarning(schedule)` and not `#manual`: render the warning screen first. Headline `~${warningHours(...)} hours without moving`; buttons **Start a break now** (→ routine), **Snooze 20 min**, **Pause 1 hr**.
  - The Snooze button is disabled with text `Snoozed twice, time to move` when `!canSnooze`.

- [ ] **Step 1: Append failing cases to `check.mjs`**

```js
check("done keeps grid", () => { const s = onFire(initialSchedule(T0, 60), T0 + H, 60); assert.equal(applyAction(s, "done", T0 + H + 5*M, 60).nextAt, T0 + 2*H); });
check("snooze shifts to now+20 and counts", () => { const s = applyAction(fired(), "snooze", T0 + H + M, 60); assert.equal(s.nextAt, T0 + H + 21*M); assert.equal(s.snoozesInRow, 1); });
check("snooze capped at 2", () => { /* third snooze leaves nextAt unchanged, canSnooze false */ });
check("skip keeps grid and counts", ...);          // nextAt === T0+2H, skipsInRow 1
check("done resets skips and snoozes", ...);
check("close counts as skip once", () => { const s = applyAction({...fired(), windowId: 7}, "close", T, 60); assert.equal(s.skipsInRow, 1); assert.equal(applyAction(s, "close", T, 60).skipsInRow, 1); });
check("close after done is ignored", ...);
check("warning after 3 skips; hours rounded", () => { assert.equal(warningHours(3, 60), 3); assert.equal(warningHours(3, 45), 2.5); assert.equal(warningHours(3, 30), 1.5); });
check("pause 1hr keeps counters", ...);
check("rescheduleForInterval", () => assert.equal(rescheduleForInterval(fired(), T, 30).nextAt, T + 30*M));
check("upcoming after snooze lists shifted times", ...);   // [now+20m, +80m, +140m]
```

- [ ] **Step 2: Run** `node extension/tests/check.mjs`. Expected: the new cases fail with an import error.
- [ ] **Step 3: Implement `schedule.js`, then wire up the service worker and `break.js`.**
- [ ] **Step 4: Run** `node extension/tests/check.mjs`. Expected: all `ok`.
- [ ] **Step 5: Manual check** with interval Custom 1 min:
  1. Window opens on its own about 1 min after save.
  2. Close it with X → the next one is on time. Do that 3 times → the warning screen appears. Its hours read `~0` at a 1-min interval; use 30 min plus DevTools `skipsInRow = 3` to see `~1.5 hours`.
  3. Snooze twice → the button is disabled with the cap text.
  4. Restart Chrome → the alarm survives (`chrome.alarms.getAll()` in the service worker console).
- [ ] **Step 6: Commit** — `feat(extension): fixed-interval scheduler with snooze cap and skip warning`

---

### Task 6: Toolbar popup — level, next break, today, actions

**Files:**
- Modify: `extension/popup.html`, `extension/popup.js`, `extension/popup.css`
- Modify: `extension/service-worker.js` (add `{type: "resume"}`: `pausedUntil = 0`, `nextAt = now + interval`; and `{type: "pause"}` from the popup, reusing Task 5's handler)

**Interfaces:**
- Consumes: `getSettings`, `getProfile`, `getSchedule`, `readLog`, `levelFor`, `upcoming`, `dayKey`.

Content (spec §12, minus challenges, badges and leaderboard):
- **Header**: `Lv N · <name>`, an XP bar (`progress`), `xp / next`.
- **Next break**: `Next break at HH:MM · in N min`. If `shiftedBy > 0`, list `upcoming(s, interval, 3)` with "shifted +20 min". `Paused until HH:MM` when `pausedUntil > now`.
- **Today** from `readLog()` entries with `dayKey === today`: breaks done, plus `skipsInRow` and `streak`.
- **Buttons**: **Break now**, **Pause 1 hr** / **Resume**, **Practice** (`chrome.tabs.create({url: "trainer.html"})`), **Settings** (`chrome.runtime.openOptionsPage()`).
- It re-renders on `chrome.storage.onChanged`.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Manual check**:
  1. After a Done, the popup shows the updated XP bar and breaks today.
  2. After a snooze, it lists 3 shifted times.
  3. Pause → "Paused until …", and the window does not open for 1 hr; Resume clears it.
- [ ] **Step 3: Commit** — `feat(extension): toolbar popup with level, schedule and today stats`

---

### Task 7: Company leaderboard on Supabase

**Files:**
- Create: `supabase/leaderboard.sql`
- Create: `extension/config.js` (`export const SUPABASE_URL = "https://hysvvrdopodlqvuxnvco.supabase.co"; export const SUPABASE_KEY = "sb_publishable_nTXynJ8zSlGh6tOB0Nid-Q_PUuozYwN";`). This is a publishable key, safe to ship in the client. Never put a secret or service_role key here.
- Create: `extension/lib/leaderboard.js`
- Modify: `extension/manifest.json` (CSP `connect-src` add `https://*.supabase.co`)
- Modify: `extension/service-worker.js`, `extension/popup.*`
- Modify: `extension/tests/check.mjs` (append)

**Interfaces:**
- SQL (spec §9, §10.2):
  - Table `public.players(id uuid primary key, secret text not null, name text not null, company text not null, xp int not null, level int not null, streak int not null, week_xp int not null, week text not null, updated_at timestamptz not null default now())`.
  - Indexes: `(company, xp desc)` and `(company, week, week_xp desc)`.
  - `alter table players enable row level security;` with no policies, plus `revoke all on players from anon, authenticated;`.
  - `submit_score(p_id uuid, p_secret text, p_name text, p_company text, p_xp int, p_level int, p_streak int, p_week_xp int, p_week text, p_delete boolean default false) returns boolean`
    - `language plpgsql security definer set search_path = public`.
    - Validates: name 1–40 chars, company 1–100 chars matching `^[a-z0-9.-]+\.[a-z]{2,}$`, xp and week_xp 0–1000000, level 1–8, streak 0–10000, week matching `^\d{4}-W\d{2}$`. It raises on violation.
    - Insert if the id is new. Update or delete only if `secret = p_secret`; otherwise return false.
  - `leaderboard(p_company text, p_period text, p_player uuid) returns table(rank int, name text, level int, xp int, streak int, is_me boolean)`
    - `language sql stable security definer set search_path = public`.
    - The score column is `xp` for `all` and `week_xp` for `week`. Week rows are filtered to `week = to_char(now(), 'IYYY-"W"IW')`.
    - Returns the top 10 by score desc, plus the caller's row if outside the top 10. It never returns `secret` or `id`.
  - `grant execute on function submit_score(...), leaderboard(...) to anon;`.
- Produces (`lib/leaderboard.js`):
  - `rpc(fn, body)` → `fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {method: "POST", headers: {apikey: SUPABASE_KEY, "Content-Type": "application/json"}, body})`. No `Authorization` header: the `sb_publishable_` key is not a JWT, and `apikey` alone maps to the `anon` role (verified against the project, which returns `PGRST202`, not 401).
  - `submitScore(profile, settings, {remove = false} = {}): Promise<boolean>`
    - A no-op returning false when the config is empty or `settings.mode !== "competitive"` (unless `remove`).
    - It never throws.
  - `fetchBoard(company, period, playerId, cfg = {url: SUPABASE_URL, key: SUPABASE_KEY}): Promise<Row[] | null>`. Returns `null` on empty `cfg.url` or any error. `submitScore` takes the same trailing `cfg`.
  - `toPayload(profile, settings, remove): object`: pure, maps to the `p_*` names with `p_level = levelFor(profile.xp).level`, `p_week = profile.week`, `p_company` lowercased.
- Service worker: after each `done` award, and on `left-board` (with `remove: true`), call `submitScore`. The popup also calls it when opened.
- Popup: tabs **This week** / **All time**, shown only when `mode === "competitive"`.
  - Rows show rank, name, level title (`LEVELS[level-1].name`), XP, `🔥streak`. Your own row (`is_me`) is highlighted.
  - Personal mode shows `Switch to Competitive to join <company or "your company">'s board`.
  - `fetchBoard` returning `null` shows `Leaderboard unavailable`.

- [ ] **Step 1: Append failing checks**: `toPayload` maps fields and lowercases the company. `fetchBoard(company, period, id, {url: ""})` resolves `null`. `fetchBoard` and `submitScore` take an optional last `{url, key}` override defaulting to `config.js`, so the empty-config path is testable.
- [ ] **Step 2: Run** `node extension/tests/check.mjs`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement the SQL, `leaderboard.js`, the service worker hooks, the popup tab and the CSP.**
- [ ] **Step 4: Run** `node extension/tests/check.mjs`. Expected: all `ok`.
- [ ] **Step 5: Apply the SQL and verify with the team's Supabase project.** The user pastes `supabase/leaderboard.sql` into the SQL Editor and clicks Run. Then, with `URL` and `KEY` set from `config.js`:

```bash
curl -s "$URL/rest/v1/rpc/submit_score" -H "apikey: $KEY" -H "Content-Type: application/json" \
  -d '{"p_id":"00000000-0000-4000-8000-000000000001","p_secret":"s1","p_name":"Test","p_company":"example.com","p_xp":120,"p_level":2,"p_streak":1,"p_week_xp":120,"p_week":"'"$(date +%G-W%V)"'"}'
# expected: true
curl -s "$URL/rest/v1/rpc/submit_score" ... same id, "p_secret":"WRONG", "p_xp":9999 ...
# expected: false
curl -s "$URL/rest/v1/players?select=*" -H "apikey: $KEY"
# expected: permission denied (401/403), table not readable by anon
curl -s "$URL/rest/v1/rpc/leaderboard" ... -d '{"p_company":"example.com","p_period":"week","p_player":"00000000-0000-4000-8000-000000000001"}'
# expected: one row, xp 120, is_me true, no secret field
```

Then delete the test row with `p_delete: true` and the right secret. Expected: `true`.

- [ ] **Step 6: Manual check**: use two Chrome profiles, both Competitive on the same company. Each does a break → both appear in the popup leaderboard. Switch one to Personal → its row disappears.
- [ ] **Step 7: Commit** — `feat: company leaderboard on Supabase`

---

### Task 8: Daily challenges, weekly featured area, badges

**Files:**
- Create: `extension/lib/challenges.js`
- Modify: `extension/lib/xp.js` (`award` calls `updateChallenges`; adds challenge bonuses to `total`, `xp` and `weekXp`)
- Modify: `extension/service-worker.js` (call `noteAction` on snooze/skip/close)
- Modify: `extension/break.js` (summary shows challenge ticks and new badges)
- Modify: `extension/popup.*` (challenges section and badge shelf)
- Modify: `extension/tests/check.mjs` (append)

**Interfaces:**
- Produces (`lib/challenges.js`, pure):
  - `DAILY_POOL = [{id: "variety", name: "Variety pack", bonus: 25}, {id: "high_five", name: "High five", bonus: 30}, {id: "clean_form", name: "Clean form", bonus: 20}, {id: "early_mover", name: "Early mover", bonus: 15}, {id: "no_excuses", name: "No excuses", bonus: 25}]`
  - `WEEKLY = {target: 10, bonus: 100}`.
  - `dailyFor(now): string[]`: 3 ids, deterministic per `dayKey(now)`, the same for all users. Use a string hash of the day key to pick a rotation offset.
  - `updateChallenges(profile, result, avgForm, now): {profile, completed: {id, name, bonus}[], newBadges: string[]}`
    - Resets `profile.daily` when `daily.day !== dayKey(now)`, and `profile.weekly` when `weekly.week !== isoWeek(now)`; the area comes from `featuredArea(now)`.
    - Rules per spec §8.4:
      - `variety`: ≥3 distinct areas among completed moves today.
      - `high_five`: 5 scored Done breaks today.
      - `clean_form`: `avgForm >= 90` on a scored break.
      - `early_mover`: scored Done before 10:00 local.
      - `no_excuses`: `daily.run` reaches 3. `run` +1 per scored Done and is reset by `noteAction`.
    - Weekly per §8.5: count completed moves whose area is the featured area, up to 10.
    - Each challenge completes at most once per period.
    - Badge ids: `daily:<id>` and `weekly:<area>`, added on first-ever completion.
  - `noteAction(profile, action, now): Profile`: `snooze`/`skip`/`close` reset `daily.run` to 0.
- `award` (Task 2) now fills `breakdown.challenges` and adds the bonuses to `total`. It only runs for `scored: true`.

- [ ] **Step 1: Append failing checks**
  - `dailyFor` is stable for the same day, returns 3 distinct ids, and differs on at least one of 7 consecutive days.
  - `variety` completes on the 3rd distinct area, and only once.
  - `no_excuses` resets after `noteAction(...,"skip")`.
  - `early_mover` at 09:59 yes, 10:00 no.
  - `clean_form` at avgForm 90 yes, 89 no.
  - The weekly challenge completes at 10 featured-area moves with +100 and badge `weekly:<area>`.
  - The weekly counter resets on a new ISO week.
  - `award` total includes challenge bonuses.
- [ ] **Step 2: Run** `node extension/tests/check.mjs`. Expected: the new cases fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node extension/tests/check.mjs`. Expected: all `ok`.
- [ ] **Step 5: Manual check**: the popup shows today's 3 challenges plus the weekly featured area with progress. Finishing breaks ticks challenges in the summary and adds a badge to the shelf.
- [ ] **Step 6: Commit** — `feat(extension): daily challenges, weekly featured area and badges`

---

### Task 9: Scheduler extras — active hours, workdays, auto-pause, away, late alarm

**Files:**
- Modify: `extension/lib/schedule.js` (add `decideFire`, `nextActiveSlot`)
- Modify: `extension/service-worker.js` (alarm handler uses `decideFire`)
- Modify: `extension/popup.js` (show `Outside active hours · next at <day HH:MM>` when `now` is outside the active window)
- Modify: `extension/tests/check.mjs` (append)

**Interfaces:**
- Produces:
  - `deferred: boolean` added to `Schedule` (default `false`).
  - `LATE_MS = 10 * 60_000`, `DEFER_MIN = 5`, `IDLE_SEC = 300`.
  - `nextActiveSlot(t, intervalMin, {activeStart, activeEnd, workdays}): number`. If `t` falls in an active window on a workday, it returns `t`. Otherwise it returns the next workday's `activeStart` + interval.
  - `decideFire(s, now, intervalMin, ctx): {kind, schedule}`, where `ctx = {idle, meeting: boolean, deferred: boolean, settings}` and `kind` is one of `"open" | "defer" | "away" | "late" | "outside"`. Checked in this order (spec §6.2):
    1. `outside`: `now` is not inside active hours on a workday → `nextAt = nextActiveSlot(now, …)`.
    2. `late`: `!ctx.deferred && now - s.nextAt > LATE_MS` → `nextAt = now + interval`.
    3. `defer`: `settings.autoPause && ctx.meeting` → `nextAt = now + 5m`, `deferred = true` stored on the schedule.
    4. `away`: `ctx.idle !== "active"` → `onFire` grid advance, no window.
    5. `open`: `onFire`, with `deferred = false`. If deferred, `nextAt` = the first grid slot after `now`.
    - None of these change `skipsInRow` or `snoozesInRow`.
- Service worker builds `ctx`:
  - `idle = await chrome.idle.queryState(IDLE_SEC)`.
  - `meeting` = any window with `state === "fullscreen"` (`chrome.windows.getAll()`), or an audible tab from `chrome.tabs.query({audible: true})` whose URL host matches `meet.google.com`, `*.zoom.us`, `teams.microsoft.com` or `teams.live.com`.
- Every `nextAt` computed in Task 5 (`initialSchedule`, `onFire`, `rescheduleForInterval`, `applyAction` snooze/pause) passes through `nextActiveSlot`.

- [ ] **Step 1: Append failing checks**, using settings `09:00–17:00 Mon–Fri`:
  - Fri 16:30 + 60 min → Mon 10:00.
  - Sat 11:00 → `outside`, rescheduled to Mon 10:00.
  - Alarm 11 min late → `late`, `nextAt = now + interval`, skips unchanged.
  - Meeting → `defer` 5 min; still meeting 40 min later → `defer` again, not `late`.
  - Meeting clears 70 min after the slot → `open`, and the next slot is the first grid slot after `now`, not stacked.
  - Idle → `away`, no counter change.
- [ ] **Step 2: Run** `node extension/tests/check.mjs`. Expected: the new cases fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node extension/tests/check.mjs`. Expected: all `ok`.
- [ ] **Step 5: Manual check**:
  1. Fullscreen a YouTube tab with interval 1 min → no window opens. Exit fullscreen → the window opens within 5 min.
  2. Set active hours to end 1 min ago → the popup shows "Outside active hours" with the next morning's time.
- [ ] **Step 6: Commit** — `feat(extension): active hours, auto-pause, away and late-alarm rules`

---

### Task 10 (optional): Tunnel for colleagues

**Files:**
- Modify: `extension/manifest.json` (CSP `connect-src` add `wss://*.trycloudflare.com`)
- Modify: `README.md` (a "Run the demo" section)

The README section covers:
- Server venv setup (`python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python app.py`).
- Loading `extension/` unpacked.
- Filling `extension/config.js`.
- Applying `supabase/leaderboard.sql`.
- Optional `cloudflared tunnel --url http://127.0.0.1:8765`, with colleagues setting the pose server URL to `wss://<sub>.trycloudflare.com/ws`.
- The frame-privacy line from spec §9.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Manual check**: on a second machine, with the URL set to the tunnel, the break window shows the skeleton and counts reps.
- [ ] **Step 3: Commit** — `docs: demo runbook and optional tunnel`
