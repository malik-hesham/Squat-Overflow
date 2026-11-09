// The engine end to end on top of mocked storage and notifications: what a
// user's taps do to the schedule, XP and planned reminders.
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));
jest.mock('expo-crypto', () => ({ randomUUID: () => `id-${Math.random().toString(36).slice(2)}` }));
jest.mock('../calendar', () => ({ getBusy: async () => [] }));
const scheduled: { at: number; skipsInRow: number; canSnooze: boolean }[][] = [];
jest.mock('../notifications', () => ({
  MAX_PLANNED: 48,
  notificationsGranted: async () => true,
  cancelReminders: async () => {},
  scheduleReminders: async (planned: { at: number; skipsInRow: number; canSnooze: boolean }[]) => {
    scheduled.push(planned);
    return planned.length;
  },
}));
jest.mock('../board', () => ({ submitScore: jest.fn(async () => false) }));
jest.mock('../session', () => ({ getSession: async () => null })); // signed out: sync is a no-op

import { breakAction, breakDone, breakElsewhere, pause, sync } from '../engine';
import { emptySchedule } from '../plan';
import { removeItems } from '../storage';
import { OUTBOX_KEY, readOutbox } from '../sync';
import { getProfile, getSchedule, readLog, saveSettings, setSchedule } from '../store';

const MIN = 60_000;
// Monday 9 Nov 2026, 10:00 local.
const MON_10 = new Date(2026, 10, 9, 10, 0).getTime();

beforeEach(async () => {
  jest.useFakeTimers({ now: MON_10, doNotFake: ['nextTick', 'setImmediate'] });
  scheduled.length = 0;
  await removeItems(['profile', 'breakLog', 'activity', OUTBOX_KEY]);
  await setSchedule(emptySchedule());
  await saveSettings({ setupDone: true, areas: ['Knees'], intervalMin: 60, workdays: [1, 2, 3, 4, 5], activeStart: '09:00', activeEnd: '17:00' });
});

afterEach(() => jest.useRealTimers());

test('first sync plans hourly reminders inside active hours', async () => {
  const s = await sync(MON_10);
  expect(s.nextAt).toBe(MON_10 + 60 * MIN);
  const plan = scheduled.at(-1)!;
  expect(plan.slice(0, 3).map((p) => (p.at - MON_10) / MIN)).toEqual([60, 120, 180]);
});

test('ignored reminders become skips, then Done clears them and awards XP', async () => {
  await sync(MON_10);
  // Reminders at 11:00 and 12:00 went by unanswered; at 12:10 the 12:00 one is due.
  const s = await sync(MON_10 + 130 * MIN);
  expect(s.skipsInRow).toBe(1);
  expect(s.dueAt).toBe(MON_10 + 120 * MIN);
  jest.setSystemTime(MON_10 + 131 * MIN);
  const out = await breakDone(
    { scored: true, countedReps: 18, targetReps: 18, scores: [100, 90, 80], moves: [{ key: 'a', area: 'Knees', completed: true }] },
    'a',
  );
  expect(out.breakdown.breakXp).toBe(9);
  expect(out.breakdown.firstBreak).toBe(5);
  const after = await getSchedule();
  expect(after.skipsInRow).toBe(0);
  expect(after.dueAt).toBeNull();
  expect(after.nextAt).toBe(MON_10 + 180 * MIN); // Done keeps the grid
  expect(after.lastKey).toBe('a');
  expect((await getProfile()).xp).toBe(out.profile.xp);
  expect((await readLog()).at(-1)).toMatchObject({ xp: out.breakdown.total, scored: true, completed: true });
});

test('snooze moves the next reminder 20 minutes out and caps at two in a row', async () => {
  await sync(MON_10);
  await breakAction('snooze');
  let s = await getSchedule();
  expect(s.nextAt).toBe(MON_10 + 20 * MIN);
  expect(s.snoozesInRow).toBe(1);
  await breakAction('snooze');
  await breakAction('snooze'); // capped: no change
  s = await getSchedule();
  expect(s.snoozesInRow).toBe(2);
  expect(scheduled.at(-1)![0].canSnooze).toBe(false);
});

test('leaving a reminder break without answering counts as a skip; leaving otherwise does nothing', async () => {
  await sync(MON_10);
  await breakAction('close'); // nothing due
  expect((await getSchedule()).skipsInRow).toBe(0);
  await sync(MON_10 + 61 * MIN); // 11:00 fired
  await breakAction('close');
  const s = await getSchedule();
  expect(s.skipsInRow).toBe(1);
  expect(s.dueAt).toBeNull();
});

test('a finished break is logged with an id and queued for sync', async () => {
  await sync(MON_10);
  await breakDone(
    {
      scored: true,
      countedReps: 18,
      targetReps: 18,
      scores: [90],
      moves: [
        { key: 'a', area: 'Knees', completed: true },
        { key: 'b', area: 'Knees', completed: true },
      ],
    },
    'b',
  );
  const [logged] = await readLog();
  expect(logged.id).toEqual(expect.any(String));
  const outbox = await readOutbox();
  expect(outbox).toHaveLength(1);
  expect(outbox[0]).toMatchObject({ id: logged.id, at: logged.at, xp: logged.xp, device: 'ios', day: '2026-11-09', week: '2026-W46', areas: ['Knees'] });
});

test("another device's break restarts the interval from it, on a whole second", async () => {
  await sync(MON_10);
  const at = MON_10 + 25 * MIN + 400; // a Chrome break at 10:25:00.400
  jest.setSystemTime(MON_10 + 26 * MIN);
  await breakElsewhere(at);
  const s = await getSchedule();
  expect(s.nextAt).toBe(MON_10 + 85 * MIN + 1000);
  expect(scheduled.at(-1)![0].at).toBe(s.nextAt);
});

test('a break elsewhere answers a due reminder', async () => {
  await sync(MON_10);
  await sync(MON_10 + 61 * MIN); // the 11:00 reminder is due
  expect((await getSchedule()).dueAt).toBe(MON_10 + 60 * MIN);
  jest.setSystemTime(MON_10 + 63 * MIN);
  await breakElsewhere(MON_10 + 62 * MIN);
  const s = await getSchedule();
  expect(s.dueAt).toBeNull();
  expect(s.skipsInRow).toBe(0);
  expect(s.nextAt).toBe(MON_10 + 122 * MIN);
});

test('a pause or a long-past break elsewhere leaves the schedule alone', async () => {
  await sync(MON_10);
  await breakElsewhere(MON_10 - 90 * MIN); // its next break would already be over
  expect((await getSchedule()).nextAt).toBe(MON_10 + 60 * MIN);
  await pause();
  const paused = await getSchedule();
  await breakElsewhere(MON_10 + MIN);
  expect(await getSchedule()).toEqual(paused);
});
