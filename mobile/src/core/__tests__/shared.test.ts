import { award, buildRoutine, currentAreas, levelFor, t, AREAS } from '../shared';

const catalog = AREAS.flatMap((area: string) =>
  [1, 2, 3].map((k) => ({ key: `${area}-${k}`, label: `${area} ${k}`, category: area, camera: 'front', how_to: '' })),
);

test('shared XP logic runs under Hermes-like globals', () => {
  const profile = { playerId: 'p', secret: 's', xp: 95, streak: 0, lastStreakDay: null, lastBreakDay: null, weekXp: 0, week: null, badges: [], daily: null, weekly: null };
  const result = { scored: true, countedReps: 18, targetReps: 18, scores: [100, 100, 100], moves: [{ key: 'a', area: 'Knees', completed: true }] };
  const out = award(profile, result, new Date(2026, 10, 9, 11).getTime(), [1, 2, 3, 4, 5]);
  expect(out.breakdown.breakXp).toBe(10);
  expect(out.profile.xp).toBeGreaterThanOrEqual(110);
  expect(out.levelUp?.to).toBe(2);
  expect(levelFor(out.profile.xp).name).toBe('Chair Escapee');
});

test('routine, legacy areas and i18n come from the extension', () => {
  expect(currentAreas(['Neck', 'Knees'])).toEqual(['Neck tension', 'Knees']);
  const moves = buildRoutine(catalog, { areas: ['Knees'], lastKey: null, n: 0 });
  expect(moves.length).toBeGreaterThan(0);
  expect(t('en', 'breakNow')).toBe('Break now');
  expect(t('ar', 'breakNow')).not.toBe('Break now');
});
