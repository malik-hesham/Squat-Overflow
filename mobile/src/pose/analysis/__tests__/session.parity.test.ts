/**
 * Golden-fixture parity: replay every recorded scenario through the TS Session
 * and expect the recorded frame results (floats within 1e-6, everything else exact).
 *
 * Fixtures come from mobile/scripts/gen-pose-fixtures.mjs (node, from the repo root). For every
 * exercise the Python pose server had, they are still exactly what that server produced.
 */

import { CATALOG, EXERCISES } from '../../../../../extension/lib/pose/exercises.js';
import { type SessionFixture, fixtureNames, loadFixture, replay } from './helpers';

const files = fixtureNames('session_');
const fixtures = files.map((f) => loadFixture<SessionFixture>(f));

describe('session fixtures', () => {
  it('cover every exercise in the catalog (and the workout set)', () => {
    const covered = new Set(fixtures.map((f) => f.exercise));
    for (const key of Object.keys(CATALOG)) expect(covered).toContain(key);
    for (const key of Object.keys(EXERCISES)) expect(covered).toContain(key);
  });
});

describe.each(fixtures.map((f) => [f.exercise, f] as const))('Session parity: %s', (_key, fixture) => {
  it.each(fixture.scenarios.map((s) => [s.name, s] as const))('%s', (_name, scenario) => {
    const result = replay(scenario);
    expect(result.frames).toBeGreaterThan(0);
    expect(result.mismatches).toEqual([]);
  });
});
