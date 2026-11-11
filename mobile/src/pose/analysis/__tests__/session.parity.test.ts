/**
 * Golden-fixture parity: replay every recorded scenario through the TS Session
 * and expect Python's frame results (floats within 1e-6, everything else exact).
 *
 * Fixtures come from mobile/scripts/gen_pose_fixtures.py (run with the server venv).
 */

import { CATALOG, EXERCISES } from '../../../../../extension/lib/pose/exercises.js';
import { ADDED_AFTER_PYTHON, type SessionFixture, fixtureNames, loadFixture, replay } from './helpers';

const files = fixtureNames('session_');
const fixtures = files.map((f) => loadFixture<SessionFixture>(f));

describe('session fixtures', () => {
  it('cover every exercise in the catalog (and the workout set), except those added after the Python server', () => {
    const covered = new Set(fixtures.map((f) => f.exercise));
    const keys = [...new Set([...Object.keys(CATALOG), ...Object.keys(EXERCISES)])];
    expect(keys.filter((k) => !covered.has(k)).sort()).toEqual([...ADDED_AFTER_PYTHON].sort());
  });
});

describe.each(fixtures.map((f) => [f.exercise, f] as const))('Session parity: %s', (_key, fixture) => {
  it.each(fixture.scenarios.map((s) => [s.name, s] as const))('%s', (_name, scenario) => {
    const result = replay(scenario);
    expect(result.frames).toBeGreaterThan(0);
    expect(result.mismatches).toEqual([]);
  });
});
