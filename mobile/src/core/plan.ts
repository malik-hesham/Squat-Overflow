// Reminder planning for the phone.
//
// The extension's service worker wakes up when an alarm fires and decides then
// (decideFire in extension/lib/schedule.js). A phone app can't run code at an
// arbitrary time, so here the decisions are made ahead: every reminder time is
// planned up front and handed to the OS as a local notification, and when the
// app comes back it catches up on the reminders that were delivered meanwhile.
//
// The grid rules are the extension's: reminders sit on `interval` steps from
// the last reminder; outside active hours or workdays the next one moves to the
// next window start + interval; a reminder that lands in a calendar meeting
// waits until the meeting ends, and the grid then continues from the first
// slot after it (slots that passed during the meeting are dropped, not stacked).
import { SNOOZE_CAP, applyAction, busyNow, nextActiveSlot } from './shared';

export type Busy = { start: number; end: number };

export type Hours = {
  intervalMin: number;
  activeStart: string;
  activeEnd: string;
  workdays: number[];
  autoPause: boolean;
};

export type Schedule = {
  nextAt: number | null; // when the next reminder fires (meetings and active hours already applied)
  deferredFrom: number | null; // grid slot a meeting pushed `nextAt` away from
  skipsInRow: number;
  snoozesInRow: number;
  pausedUntil: number;
  shiftedBy: number;
  lastKey: string | null;
  breakCount: number;
  dueAt: number | null; // a reminder that fired and hasn't been answered (the extension's open window)
  windowId: null;
};

const MIN_MS = 60_000;
const AFTER_MEETING_MS = MIN_MS; // like the extension: fire one minute after the meeting ends
const MAX_MEETING_HOPS = 8;
// After this long without the app, missed reminders aren't counted: start fresh
// from now, like the extension's late-alarm rule after the laptop slept.
export const CATCH_UP_MAX_MS = 24 * 60 * MIN_MS;
// The OS fires date triggers on whole seconds, so a reminder planned for
// 10:00:00.700 can arrive at 10:00:00.000; treat it as delivered.
export const DELIVERY_SLACK_MS = 2_000;

export function emptySchedule(): Schedule {
  return {
    nextAt: null,
    deferredFrom: null,
    skipsInRow: 0,
    snoozesInRow: 0,
    pausedUntil: 0,
    shiftedBy: 0,
    lastKey: null,
    breakCount: 0,
    dueAt: null,
    windowId: null,
  };
}

// Moves `s.nextAt` into active hours and out of calendar meetings.
export function settle(s: Schedule, hours: Hours, busy: Busy[]): Schedule {
  if (s.nextAt == null) return s;
  let at: number = nextActiveSlot(s.nextAt, hours.intervalMin, hours);
  let deferredFrom = at === s.nextAt ? s.deferredFrom : null; // moved into the next window: the grid re-anchors there
  if (hours.autoPause) {
    for (let hop = 0; hop < MAX_MEETING_HOPS; hop++) {
      const block: Busy | null = busyNow(busy, at);
      if (!block) break;
      deferredFrom ??= at;
      const after: number = nextActiveSlot(block.end + AFTER_MEETING_MS, hours.intervalMin, hours);
      if (after !== block.end + AFTER_MEETING_MS) deferredFrom = null; // meeting ran past active hours
      at = after;
    }
  }
  return { ...s, nextAt: at, deferredFrom };
}

// The reminder after the one at `s.nextAt`: the first grid slot after it.
export function advance(s: Schedule, hours: Hours, busy: Busy[]): Schedule {
  if (s.nextAt == null) return s;
  const step = hours.intervalMin * MIN_MS;
  let slot = (s.deferredFrom ?? s.nextAt) + step;
  while (slot <= s.nextAt) slot += step;
  return settle({ ...s, nextAt: slot, deferredFrom: null }, hours, busy);
}

export type Planned = {
  at: number;
  skipsInRow: number; // what skipsInRow will be when it fires, if nothing is answered before
  canSnooze: boolean;
};

// The next `count` reminder times, with the counters each one will see if the
// user ignores the ones before it (an ignored reminder counts as a skip). Every
// action replans, so these predictions are exact.
export function planReminders(s: Schedule, hours: Hours, busy: Busy[], count: number): Planned[] {
  const out: Planned[] = [];
  let cur = s;
  let skips = s.skipsInRow + (s.dueAt != null ? 1 : 0);
  let snoozes = s.dueAt != null ? 0 : s.snoozesInRow;
  for (let k = 0; k < count && cur.nextAt != null; k++) {
    out.push({ at: cur.nextAt, skipsInRow: skips, canSnooze: snoozes < SNOOZE_CAP });
    cur = advance(cur, hours, busy);
    skips += 1;
    snoozes = 0;
  }
  return out;
}

// Catches up on reminders that fired while the app wasn't looking. Each one
// becomes the due reminder; one that was still due when the next fired went
// unanswered and counts as a skip, like closing the extension's break window.
// `countSkips` is false when notifications are off, since nothing was shown.
export function catchUp(
  s: Schedule,
  now: number,
  hours: Hours,
  busy: Busy[],
  { countSkips }: { countSkips: boolean },
): { schedule: Schedule; skips: number } {
  if (s.nextAt == null || s.nextAt > now + DELIVERY_SLACK_MS) return { schedule: s, skips: 0 };
  if (now - s.nextAt > CATCH_UP_MAX_MS) {
    const fresh = settle({ ...s, nextAt: now + hours.intervalMin * MIN_MS, deferredFrom: null, dueAt: null }, hours, busy);
    return { schedule: fresh, skips: 0 };
  }
  let cur = s;
  let skips = 0;
  for (let guard = 0; cur.nextAt != null && cur.nextAt <= now + DELIVERY_SLACK_MS && guard < 5000; guard++) {
    if (cur.dueAt != null && countSkips) {
      cur = applyAction(cur, 'skip', now, hours.intervalMin) as Schedule;
      skips += 1;
    }
    cur = advance({ ...cur, dueAt: cur.nextAt }, hours, busy);
  }
  return { schedule: cur, skips };
}
