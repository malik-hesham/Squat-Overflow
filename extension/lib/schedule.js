export const SNOOZE_MIN = 20;
export const SNOOZE_CAP = 2;
export const WARN_SKIPS = 3;
export const PAUSE_MIN = 60;

const MIN_MS = 60_000;

export function initialSchedule(now, intervalMin) {
  return {
    nextAt: now + intervalMin * MIN_MS,
    skipsInRow: 0,
    snoozesInRow: 0,
    pausedUntil: 0,
    windowId: null,
    lastKey: null,
    breakCount: 0,
    shiftedBy: 0,
  };
}

export function onFire(s, now, intervalMin) {
  const step = intervalMin * MIN_MS;
  let nextAt = s.nextAt + step;
  while (nextAt <= now) nextAt += step;
  return { ...s, nextAt };
}

export function canSnooze(s) {
  return s.snoozesInRow < SNOOZE_CAP;
}

export function showWarning(s) {
  return s.skipsInRow >= WARN_SKIPS;
}

export function warningHours(skips, intervalMin) {
  return Math.round((skips * intervalMin) / 30) / 2;
}

export function applyAction(s, action, now, intervalMin) {
  switch (action) {
    case "done":
      return { ...s, skipsInRow: 0, snoozesInRow: 0, shiftedBy: 0, windowId: null };
    case "skip":
      return { ...s, skipsInRow: s.skipsInRow + 1, snoozesInRow: 0, shiftedBy: 0, windowId: null };
    case "close":
      return s.windowId == null ? s : applyAction(s, "skip", now, intervalMin);
    case "snooze":
      if (!canSnooze(s)) return s;
      return {
        ...s,
        nextAt: now + SNOOZE_MIN * MIN_MS,
        snoozesInRow: s.snoozesInRow + 1,
        shiftedBy: SNOOZE_MIN,
        windowId: null,
      };
    case "pause":
      return { ...s, nextAt: now + PAUSE_MIN * MIN_MS, pausedUntil: now + PAUSE_MIN * MIN_MS, windowId: null };
    default:
      return s;
  }
}

export function upcoming(s, intervalMin, count = 3) {
  return Array.from({ length: count }, (_, k) => s.nextAt + k * intervalMin * MIN_MS);
}

export function rescheduleForInterval(s, now, intervalMin) {
  return { ...s, nextAt: now + intervalMin * MIN_MS };
}
