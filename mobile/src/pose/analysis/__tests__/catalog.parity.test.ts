/** Static data parity with the server: catalog, exercise definitions, issue texts, skeleton. */

import {
  AREAS,
  CATALOG,
  CONNECTIONS,
  DEFAULT_EXERCISE,
  EXERCISES,
  ISSUE_TEXT,
  JOINTS,
  Session,
  exerciseCatalog,
} from '../../../../../extension/lib/pose/index.js';
import { demoLandmarks, demoMotion } from '../../../../../extension/lib/demo-model.js';
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

// A shared rule (extension/tests/check.mjs pins it too): every exercise has a 3D demo, and seen
// from the coach's camera the demo counts its reps cleanly on the same rep counter the phone uses.
it('every exercise has a 3D demo that the coach counts cleanly', () => {
  for (const key of Object.keys(EXERCISES)) {
    const motion = demoMotion(key);
    expect(motion).not.toBeNull();
    const { seconds, reps } = motion!;
    const session = new Session(key);
    const events = [];
    for (let i = 0; i < Math.round(seconds * 2 * 30); i++) {
      const t = i / 30;
      const out = session.process(demoLandmarks(key, t, { width: 640, height: 480 }), 640, 480, t);
      expect(out.feedback).toEqual([]);
      if (out.rep_event) events.push(out.rep_event);
    }
    expect({ key, reps: events.length, partial: events.filter((r) => r.partial).length }).toEqual({ key, reps: reps * 2, partial: 0 });
    for (const r of events) expect(r.issues).toEqual([]);
  }
});
