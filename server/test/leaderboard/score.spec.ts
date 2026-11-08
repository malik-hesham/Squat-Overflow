import { isoWeek, validateScore } from '../../src/leaderboard/score';

describe('isoWeek', () => {
  test.each([
    ['2026-11-06T11:00:00Z', '2026-W45'], // Friday
    ['2026-11-09T00:00:00Z', '2026-W46'], // Monday starts a week
    ['2027-01-01T12:00:00Z', '2026-W53'], // early January can belong to last year's week 53
    ['2025-12-29T12:00:00Z', '2026-W01'], // late December can belong to next year's week 1
    ['2024-12-30T12:00:00Z', '2025-W01'],
  ])('%s is %s', (iso, week) => {
    expect(isoWeek(new Date(iso))).toBe(week);
  });
});

describe('validateScore', () => {
  const valid = { name: '  Malik  ', xp: 260, level: 3, streak: 4, weekXp: 40, week: '2026-W45', avatar: 'penguin' };

  test('accepts a valid score and trims the name', () => {
    expect(validateScore(valid)).toEqual({ ok: true, score: { ...valid, name: 'Malik' } });
  });

  test('defaults a missing avatar to bunny', () => {
    const { avatar: _, ...rest } = valid;
    expect(validateScore(rest)).toEqual({ ok: true, score: { ...rest, name: 'Malik', avatar: 'bunny' } });
  });

  test.each([
    [{ name: '   ' }, 'invalid name'],
    [{ name: 'x'.repeat(41) }, 'invalid name'],
    [{ name: 42 }, 'invalid name'],
    [{ xp: -1 }, 'invalid xp'],
    [{ xp: 1_000_001 }, 'invalid xp'],
    [{ xp: 1.5 }, 'invalid xp'],
    [{ weekXp: '40' }, 'invalid xp'],
    [{ level: 0 }, 'invalid level'],
    [{ level: 9 }, 'invalid level'],
    [{ streak: 10_001 }, 'invalid streak'],
    [{ streak: null }, 'invalid streak'],
    [{ week: '2026-45' }, 'invalid week'],
    [{ week: undefined }, 'invalid week'],
    [{ avatar: '<script>' }, 'invalid avatar'],
    [{ avatar: null }, 'invalid avatar'],
  ])('rejects %p with %s', (patch, error) => {
    expect(validateScore({ ...valid, ...patch })).toEqual({ ok: false, error });
  });

  test.each([null, 'score', [1, 2], 7])('rejects a non-object body %p', (body) => {
    expect(validateScore(body)).toEqual({ ok: false, error: 'invalid body' });
  });
});
