import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LEVELS, levelFor, previousWorkday, streakFrom } from '../../src/sync/profile';

const WEEKDAYS = [1, 2, 3, 4, 5];

describe('levels', () => {
  test('match extension/lib/xp.js', () => {
    const src = readFileSync(join(__dirname, '../../../extension/lib/xp.js'), 'utf8');
    const ext = [...src.matchAll(/\{ level: (\d+), name: "([^"]+)", xp: (\d+) \}/g)].map((m) => ({
      level: Number(m[1]),
      name: m[2],
      xp: Number(m[3]),
    }));
    expect(ext).toEqual(LEVELS);
  });

  test('levelFor picks the highest level reached', () => {
    expect(levelFor(0)).toEqual({ level: 1, name: 'Desk Potato' });
    expect(levelFor(249)).toEqual({ level: 2, name: 'Chair Escapee' });
    expect(levelFor(250).level).toBe(3);
    expect(levelFor(99_999).level).toBe(8);
  });
});

describe('streak', () => {
  test('previousWorkday skips days off', () => {
    expect(previousWorkday('2026-11-10', WEEKDAYS)).toBe('2026-11-09'); // Tue -> Mon
    expect(previousWorkday('2026-11-09', WEEKDAYS)).toBe('2026-11-06'); // Mon -> Fri
    expect(previousWorkday('2026-11-09', [])).toBeNull();
  });

  test('counts back over consecutive workdays, across a weekend', () => {
    expect(streakFrom([], WEEKDAYS)).toBe(0);
    expect(streakFrom(['2026-11-10'], WEEKDAYS)).toBe(1);
    expect(streakFrom(['2026-11-05', '2026-11-06', '2026-11-09', '2026-11-10'], WEEKDAYS)).toBe(4);
  });

  test('a missed workday ends the run; duplicates and order do not matter', () => {
    expect(streakFrom(['2026-11-10', '2026-11-06', '2026-11-10'], WEEKDAYS)).toBe(1); // Mon 9th missed
    expect(streakFrom(['2026-11-10', '2026-11-09', '2026-11-05'], WEEKDAYS)).toBe(2); // Fri 6th missed
  });

  test('a break on a day off still counts and keeps the run', () => {
    expect(streakFrom(['2026-11-06', '2026-11-07', '2026-11-09'], WEEKDAYS)).toBe(3); // Fri, Sat, Mon
  });
});
