/** Static data parity with the server: catalog, exercise definitions, issue texts, skeleton. */

import {
  AREAS,
  CATALOG,
  CONNECTIONS,
  DEFAULT_EXERCISE,
  DEMOS,
  EXERCISES,
  ISSUE_TEXT,
  JOINTS,
  MAX_DEMO_SECONDS,
  exerciseCatalog,
} from '../index';
import { diff, loadFixture } from './helpers';

interface CatalogFixture {
  catalog: unknown[];
  connections: number[][];
  issue_text: Record<string, string>;
  default_exercise: string;
  areas: string[];
  catalog_keys: string[];
  joints: unknown;
  exercises: Record<string, unknown>[];
}

const fx = loadFixture<CatalogFixture>('catalog.json');

it("exerciseCatalog() equals app.py's exercise_catalog(), in order", () => {
  expect(diff(exerciseCatalog(), fx.catalog, 0)).toEqual([]);
  // Same key order inside each entry, as the server serialised it.
  expect(exerciseCatalog().map((e) => Object.keys(e))).toEqual(fx.catalog.map((e) => Object.keys(e as object)));
});

it('CATALOG, DEFAULT_EXERCISE, AREAS, ISSUE_TEXT, CONNECTIONS and JOINTS match', () => {
  expect(Object.keys(CATALOG)).toEqual(fx.catalog_keys);
  expect(DEFAULT_EXERCISE).toBe(fx.default_exercise);
  expect([...AREAS]).toEqual(fx.areas);
  expect(ISSUE_TEXT).toEqual(fx.issue_text);
  expect(Object.keys(ISSUE_TEXT)).toEqual(Object.keys(fx.issue_text));
  expect(CONNECTIONS).toEqual(fx.connections);
  expect(JOINTS).toEqual(fx.joints);
});

it('every exercise definition matches, including the workout set', () => {
  const ours = Object.values(EXERCISES).map((e) => ({
    key: e.key,
    label: e.label,
    metric: e.metric,
    rest: e.rest,
    target: e.target,
    rest_is_high: e.restIsHigh,
    bilateral: e.bilateral,
    joints: [...e.joints],
    camera: e.camera,
    min_rep_seconds: e.minRepSeconds,
    category: e.category,
    how_to: e.howTo,
    stance: e.stance,
    kind: e.constructor.name, // class names: Squat, PushUp, BicepCurl, ShoulderPress, Gentle
  }));
  expect(diff(ours, fx.exercises, 0)).toEqual([]);
});

it('every exercise has a short demo video', () => {
  expect(Object.keys(DEMOS).sort()).toEqual(Object.keys(EXERCISES).sort());
  for (const d of Object.values(DEMOS)) {
    expect(d.youtube_id).toMatch(/^[\w-]{11}$/);
    expect(d.seconds).toBeGreaterThan(0);
    expect(d.seconds).toBeLessThan(MAX_DEMO_SECONDS);
  }
});
