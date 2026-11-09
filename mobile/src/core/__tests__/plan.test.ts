import { advance, catchUp, emptySchedule, planReminders, settle, CATCH_UP_MAX_MS, type Hours, type Schedule } from '../plan';

const HOURS: Hours = { intervalMin: 60, activeStart: '09:00', activeEnd: '17:00', workdays: [1, 2, 3, 4, 5], autoPause: true };
// Monday 9 Nov 2026, local time.
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).getTime();
const hhmm = (t: number) => {
  const d = new Date(t);
  return `${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const sched = (patch: Partial<Schedule>): Schedule => ({ ...emptySchedule(), ...patch });

test('reminders follow the hourly grid inside active hours and roll to the next workday', () => {
  const plan = planReminders(sched({ nextAt: at(9, 14) }), HOURS, [], 5).map((p) => hhmm(p.at));
  // 17:00 is outside 09:00-17:00, so the grid re-anchors at next open + interval.
  expect(plan).toEqual(['9 14:00', '9 15:00', '9 16:00', '10 10:00', '10 11:00']);
});

test('Friday evening rolls over the weekend', () => {
  const plan = planReminders(sched({ nextAt: at(13, 16) }), HOURS, [], 2).map((p) => hhmm(p.at));
  expect(plan).toEqual(['13 16:00', '16 10:00']);
});

test('a reminder in a meeting waits for its end, then the grid continues', () => {
  const busy = [{ start: at(9, 10, 50), end: at(9, 12, 20) }];
  const s = settle(sched({ nextAt: at(9, 11) }), HOURS, busy);
  expect(hhmm(s.nextAt!)).toBe('9 12:21');
  expect(hhmm(s.deferredFrom!)).toBe('9 11:00');
  // 12:00 passed during the meeting and is dropped; the grid resumes at 13:00.
  expect(planReminders(s, HOURS, busy, 3).map((p) => hhmm(p.at))).toEqual(['9 12:21', '9 13:00', '9 14:00']);
});

test('meetings are ignored when auto-pause is off', () => {
  const busy = [{ start: at(9, 10, 50), end: at(9, 12, 20) }];
  expect(hhmm(settle(sched({ nextAt: at(9, 11) }), { ...HOURS, autoPause: false }, busy).nextAt!)).toBe('9 11:00');
});

test('planned reminders predict the skip warning and the snooze cap', () => {
  const plan = planReminders(sched({ nextAt: at(9, 10), skipsInRow: 1, snoozesInRow: 2 }), HOURS, [], 3);
  expect(plan.map((p) => p.skipsInRow)).toEqual([1, 2, 3]);
  expect(plan.map((p) => p.canSnooze)).toEqual([false, true, true]);
  const due = planReminders(sched({ nextAt: at(9, 10), skipsInRow: 1, dueAt: at(9, 9) }), HOURS, [], 1);
  expect(due[0].skipsInRow).toBe(2); // the reminder still due counts as skipped by then
});

test('catching up: each reminder left unanswered when the next fires is a skip', () => {
  const s = sched({ nextAt: at(9, 10) });
  const { schedule, skips } = catchUp(s, at(9, 12, 30), HOURS, [], { countSkips: true });
  expect(skips).toBe(2); // 10:00 and 11:00 were ignored; 12:00 is due now
  expect(schedule.skipsInRow).toBe(2);
  expect(hhmm(schedule.dueAt!)).toBe('9 12:00');
  expect(hhmm(schedule.nextAt!)).toBe('9 13:00');
});

test('catching up without notifications marks the reminder due but counts no skips', () => {
  const { schedule, skips } = catchUp(sched({ nextAt: at(9, 10) }), at(9, 12, 30), HOURS, [], { countSkips: false });
  expect(skips).toBe(0);
  expect(hhmm(schedule.dueAt!)).toBe('9 12:00');
});

test('nothing happens before the next reminder', () => {
  const s = sched({ nextAt: at(9, 10) });
  expect(catchUp(s, at(9, 9, 59), HOURS, [], { countSkips: true })).toEqual({ schedule: s, skips: 0 });
});

test('after a long absence the schedule starts fresh with no skips', () => {
  const s = sched({ nextAt: at(9, 10), dueAt: at(9, 9) });
  const now = at(9, 10) + CATCH_UP_MAX_MS + 60_000;
  const { schedule, skips } = catchUp(s, now, HOURS, [], { countSkips: true });
  expect(skips).toBe(0);
  expect(schedule.dueAt).toBeNull();
  expect(schedule.nextAt!).toBeGreaterThan(now);
});

test('advance keeps the grid anchored on the slot a meeting deferred', () => {
  const s = sched({ nextAt: at(9, 11, 31), deferredFrom: at(9, 11) });
  expect(hhmm(advance(s, HOURS, []).nextAt!)).toBe('9 12:00');
});

test('a reminder the OS delivers a fraction of a second early still counts as delivered', () => {
  const { schedule } = catchUp(sched({ nextAt: at(9, 10) + 700 }), at(9, 10), HOURS, [], { countSkips: true });
  expect(schedule.dueAt).toBe(at(9, 10) + 700);
  expect(hhmm(schedule.nextAt!)).toBe('9 11:00');
});
