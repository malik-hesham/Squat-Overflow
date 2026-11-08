// The phone's version of the extension's service worker: every change to the
// schedule, XP and leaderboard goes through here, one at a time, and every
// schedule change replans the reminder notifications.
import { getLocales } from 'expo-localization';

import { getBusy } from './calendar';
import { MAX_PLANNED, cancelReminders, notificationsGranted, scheduleReminders } from './notifications';
import { catchUp, planReminders, settle, type Busy, type Hours, type Schedule } from './plan';
import {
  applyAction,
  areaName,
  award,
  backfillActivity,
  createSerial,
  noteAction,
  recordActivity,
  rescheduleForInterval,
  resolveLang,
  submitScore,
} from './shared';
import {
  appendLog,
  getActivity,
  getProfile,
  getSchedule,
  getSettings,
  readLog,
  setActivity,
  setProfile,
  setSchedule,
  type Profile,
  type Settings,
} from './store';

const MIN_MS = 60_000;
const serial = createSerial();
const queue = <T>(fn: () => Promise<T>): Promise<T> => serial(fn) as Promise<T>;

export type BreakResult = {
  scored: boolean;
  countedReps: number;
  targetReps: number;
  scores: number[];
  moves: { key: string; area: string; completed: boolean }[];
};

export type DoneOutcome = {
  breakdown: { breakXp: number; firstBreak: number; streak: number; challenges: { id: string; name: string; bonus: number }[]; total: number };
  levelUp: { from: number; to: number; name: string } | null;
  newBadges: string[];
  profile: Profile;
};

export function deviceLang(settings: Pick<Settings, 'lang'>): string {
  return resolveLang(settings.lang, getLocales()[0]?.languageTag ?? 'en');
}

const hoursOf = (s: Settings): Hours => ({
  intervalMin: s.intervalMin,
  activeStart: s.activeStart,
  activeEnd: s.activeEnd,
  workdays: s.workdays,
  autoPause: s.autoPause && s.calendar,
});

const busyFor = (s: Settings) => getBusy(s.autoPause && s.calendar);

async function save(schedule: Schedule, settings: Settings, busy?: Busy[]): Promise<Schedule> {
  const meetings = busy ?? (await busyFor(settings));
  const hours = hoursOf(settings);
  const s = settle(schedule, hours, meetings);
  await setSchedule(s);
  if (settings.setupDone && s.nextAt != null) {
    const lang = deviceLang(settings);
    await scheduleReminders(planReminders(s, hours, meetings, MAX_PLANNED), {
      lang,
      intervalMin: settings.intervalMin,
      areas: settings.areas.map((a) => areaName(lang, a)),
    });
  } else {
    await cancelReminders();
  }
  return s;
}

// Catches up on reminders delivered while the app was closed and replans the
// next ones. Run on launch, on returning to the foreground, and on a tapped
// notification.
export function sync(now = Date.now()): Promise<Schedule> {
  return queue(async () => {
    const settings = await getSettings();
    let s = await getSchedule();
    if (!settings.setupDone) {
      await cancelReminders();
      return s;
    }
    if (s.nextAt == null) s = { ...s, nextAt: now + settings.intervalMin * MIN_MS, deferredFrom: null };
    const busy = await busyFor(settings);
    const { schedule, skips } = catchUp(s, now, hoursOf(settings), busy, { countSkips: await notificationsGranted() });
    if (skips) await setProfile(noteAction(await getProfile(), 'close', now));
    return save(schedule, settings, busy);
  });
}

async function onDone(result: BreakResult, lastKey: string | null): Promise<DoneOutcome> {
  const now = Date.now();
  const [settings, s, profile] = await Promise.all([getSettings(), getSchedule(), getProfile()]);
  const { profile: next, breakdown, levelUp, newBadges } = award(profile, result, now, settings.workdays);
  await setProfile(next);
  void submitScore(next, settings);
  const activity = (await getActivity()) ?? backfillActivity(await readLog());
  await setActivity(recordActivity(activity, now, breakdown.total));
  const scores = result.scores ?? [];
  await appendLog({
    at: now,
    reps: result.countedReps,
    moves: result.moves.filter((m) => m.completed).length,
    score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    xp: breakdown.total,
    scored: result.scored,
    completed: result.moves.length > 0 && result.moves.every((m) => m.completed),
  });
  await save(
    {
      ...(applyAction(s, 'done', now, settings.intervalMin) as Schedule),
      dueAt: null,
      lastKey: lastKey ?? s.lastKey,
      breakCount: s.breakCount + 1,
    },
    settings,
  );
  return { breakdown, levelUp, newBadges, profile: next };
}

export function breakDone(result: BreakResult, lastKey: string | null): Promise<DoneOutcome> {
  return queue(() => onDone(result, lastKey));
}

// Snooze, Skip, Pause 1 hr from a break, or "close": leaving a reminder's
// break without answering it, which counts as a skip like closing the
// extension's break window.
export function breakAction(action: 'snooze' | 'skip' | 'pause' | 'close'): Promise<void> {
  return queue(async () => {
    const now = Date.now();
    const [settings, s] = await Promise.all([getSettings(), getSchedule()]);
    if (action === 'close' && s.dueAt == null) return;
    const kind = action === 'close' ? 'skip' : action;
    await setProfile(noteAction(await getProfile(), kind, now));
    const next = applyAction(s, kind, now, settings.intervalMin) as Schedule;
    if (next === s) return; // snooze cap reached
    const moved = next.nextAt !== s.nextAt; // snooze and pause re-anchor the grid
    await save({ ...next, dueAt: null, deferredFrom: moved ? null : next.deferredFrom }, settings);
  });
}

export function pause(): Promise<void> {
  return queue(async () => {
    const [settings, s] = await Promise.all([getSettings(), getSchedule()]);
    const next = applyAction(s, 'pause', Date.now(), settings.intervalMin) as Schedule;
    await save({ ...next, dueAt: s.dueAt, deferredFrom: null }, settings);
  });
}

export function resume(): Promise<void> {
  return queue(async () => {
    const [settings, s] = await Promise.all([getSettings(), getSchedule()]);
    await save({ ...(rescheduleForInterval(s, Date.now(), settings.intervalMin) as Schedule), pausedUntil: 0, deferredFrom: null }, settings);
  });
}

export function settingsSaved(scheduleChanged: boolean): Promise<void> {
  return queue(async () => {
    const [settings, s, profile] = await Promise.all([getSettings(), getSchedule(), getProfile()]);
    void submitScore(profile, settings);
    const now = Date.now();
    if (s.nextAt == null || scheduleChanged) {
      await save({ ...s, nextAt: now + settings.intervalMin * MIN_MS, deferredFrom: null }, settings);
    } else {
      await save(s, settings);
    }
  });
}

export function leftBoard(): Promise<boolean> {
  return queue(async () => {
    const [settings, profile] = await Promise.all([getSettings(), getProfile()]);
    return submitScore(profile, settings, { remove: true });
  });
}

// Whether "Break now" answers a reminder that's due, or starts an extra break.
export async function breakKind(): Promise<'reminder' | 'manual'> {
  const s = await getSchedule();
  return s.dueAt != null ? 'reminder' : 'manual';
}
