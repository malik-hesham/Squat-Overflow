import { MAX_PUSH, validateProgress, validatePush, validateSettingsPatch } from '../../src/sync/validate';

const NOW = Date.UTC(2026, 10, 8, 12);
const event = (patch: Record<string, unknown> = {}) => ({
  id: '0b9d6c1e-6f2a-4c55-9a51-2b1e8a3f9c01',
  at: NOW - 60_000,
  day: '2026-11-08',
  week: '2026-W45',
  device: 'chrome',
  reps: 24,
  moves: 4,
  score: 81,
  xp: 22,
  scored: true,
  completed: true,
  areas: ['Neck tension'],
  ...patch,
});

describe('validatePush', () => {
  test('accepts a batch and lower-cases ids; areas default to []', () => {
    const r = validatePush({ events: [event({ id: '0B9D6C1E-6F2A-4C55-9A51-2B1E8A3F9C01', areas: undefined })] }, NOW);
    expect(r).toEqual({ ok: true, value: [event({ areas: [] })] });
  });

  test.each([
    [{ id: 'nope' }, 'invalid id'],
    [{ at: NOW + 25 * 3_600_000 }, 'invalid at'],
    [{ at: 1000 }, 'invalid at'],
    [{ day: '2026-11-8' }, 'invalid day'],
    [{ week: '2026-45' }, 'invalid week'],
    [{ device: 'fax' }, 'invalid device'],
    [{ score: 101 }, 'invalid score'],
    [{ xp: -1 }, 'invalid xp'],
    [{ scored: 'yes' }, 'invalid flags'],
    [{ areas: ['x'.repeat(41)] }, 'invalid areas'],
  ])('refuses %j', (patch, error) => {
    expect(validatePush({ events: [event(), event(patch)] }, NOW)).toEqual({ ok: false, error: `events[1]: ${error}` });
  });

  test('score may be null (an unscored break)', () => {
    expect(validatePush({ events: [event({ score: null, scored: false, xp: 0 })] }, NOW).ok).toBe(true);
  });

  test('batch size is 1..MAX_PUSH', () => {
    expect(validatePush({ events: [] }, NOW).ok).toBe(false);
    expect(validatePush({ events: Array(MAX_PUSH + 1).fill(event()) }, NOW).ok).toBe(false);
    expect(validatePush({}, NOW).ok).toBe(false);
  });
});

describe('validateSettingsPatch', () => {
  test('accepts shared keys', () => {
    const patch = { intervalMin: 45, workdays: [1, 2, 3], mode: 'competitive', activeStart: '08:30', lang: 'pt-BR' };
    expect(validateSettingsPatch({ patch, at: NOW }, NOW)).toEqual({ ok: true, value: { patch, at: NOW } });
  });

  test('refuses device-only and unknown keys, and bad values', () => {
    expect(validateSettingsPatch({ patch: { serverUrl: 'wss://x' }, at: NOW }, NOW)).toEqual({
      ok: false,
      error: 'unknown setting serverUrl',
    });
    expect(validateSettingsPatch({ patch: { intervalMin: 0 }, at: NOW }, NOW).ok).toBe(false);
    expect(validateSettingsPatch({ patch: { workdays: [1, 1] }, at: NOW }, NOW).ok).toBe(false);
    expect(validateSettingsPatch({ patch: { activeEnd: '25:00' }, at: NOW }, NOW).ok).toBe(false);
    expect(validateSettingsPatch({ patch: {}, at: NOW }, NOW).ok).toBe(false);
    expect(validateSettingsPatch({ patch: { voice: true } }, NOW).ok).toBe(false);
  });
});

describe('validateProgress', () => {
  test('accepts badges and challenge objects', () => {
    const body = { badges: ['variety', 'high_five', 'weekly:Neck tension', 'weekly:Shoulder & rotator cuff'], daily: { id: 'variety', done: false }, weekly: null, at: NOW };
    expect(validateProgress(body, NOW)).toEqual({ ok: true, value: body });
  });

  test('refuses bad badges and huge challenge objects', () => {
    for (const bad of [' lead', 'trail ', 'semi;colon', 'a'.repeat(61), ''])
      expect(validateProgress({ badges: [bad], at: NOW }, NOW).ok).toBe(false);
    expect(validateProgress({ badges: [], daily: { x: 'y'.repeat(5000) }, at: NOW }, NOW).ok).toBe(false);
    expect(validateProgress({ badges: [], daily: [1], at: NOW }, NOW).ok).toBe(false);
  });
});
