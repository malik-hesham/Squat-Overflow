export const SNOOZE_MIN = 20;
export const SNOOZE_CAP = 2;
export const WARN_SKIPS = 3;
export const PAUSE_MIN = 60;
export const LATE_MS = 10 * 60_000;
export const DEFER_MIN = 5;
export const IDLE_SEC = 300;

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
    deferredFrom: null,
  };
}

export function onFire(s, now, intervalMin) {
  const step = intervalMin * MIN_MS;
  let nextAt = s.nextAt + step;
  while (nextAt <= now) nextAt += step;
  return { ...s, nextAt };
}

export function canSnooze(s) {
  return (s.snoozesInRow ?? 0) < SNOOZE_CAP;
}

export function showWarning(s) {
  return (s.skipsInRow ?? 0) >= WARN_SKIPS;
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

function minutesOf(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function atMinutes(day, minutes) {
  const d = new Date(day);
  d.setHours(0, minutes, 0, 0);
  return d.getTime();
}

export function isActive(t, { activeStart, activeEnd, workdays }) {
  const d = new Date(t);
  const mins = d.getHours() * 60 + d.getMinutes();
  return workdays.includes(d.getDay()) && mins >= minutesOf(activeStart) && mins < minutesOf(activeEnd);
}

export function nextActiveSlot(t, intervalMin, hours) {
  if (isActive(t, hours)) return t;
  const start = minutesOf(hours.activeStart);
  for (let k = 0; k < 8; k++) {
    const day = new Date(t);
    day.setDate(day.getDate() + k);
    const opens = atMinutes(day.getTime(), start);
    if (hours.workdays.includes(day.getDay()) && opens > t) return opens + intervalMin * MIN_MS;
  }
  return t + intervalMin * MIN_MS;
}

export function decideFire(s, now, intervalMin, { idle, meeting, settings }) {
  const slot = (t) => nextActiveSlot(t, intervalMin, settings);
  if (!isActive(now, settings)) {
    return { kind: "outside", schedule: { ...s, nextAt: slot(now), deferredFrom: null } };
  }
  const deferred = s.deferredFrom != null;
  if (!deferred && now - s.nextAt > LATE_MS) {
    return { kind: "late", schedule: { ...s, nextAt: slot(now + intervalMin * MIN_MS) } };
  }
  if (settings.autoPause && meeting) {
    return {
      kind: "defer",
      schedule: { ...s, nextAt: now + DEFER_MIN * MIN_MS, deferredFrom: deferred ? s.deferredFrom : s.nextAt },
    };
  }
  const base = deferred ? { ...s, nextAt: s.deferredFrom } : s;
  const fired = onFire(base, now, intervalMin);
  const schedule = { ...fired, nextAt: slot(fired.nextAt), deferredFrom: null };
  return { kind: idle === "active" ? "open" : "away", schedule };
}

export function scheduleSettingsChanged(prev, next) {
  const days = (w) => [...w].sort().join();
  return (
    prev.intervalMin !== next.intervalMin ||
    prev.activeStart !== next.activeStart ||
    prev.activeEnd !== next.activeEnd ||
    days(prev.workdays) !== days(next.workdays)
  );
}

export function weekOrder(weekStart) {
  return Array.from({ length: 7 }, (_, k) => (weekStart + k) % 7);
}
