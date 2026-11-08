// Port of server/tests/test_demos.py.
import { DEMOS, MAX_DEMO_SECONDS } from '../../src/analysis/demos';
import { EXERCISES } from '../../src/analysis/exercises';

test('every exercise has a short demo', () => {
  expect(new Set(DEMOS.keys())).toEqual(new Set(EXERCISES.keys()));
  for (const [key, d] of DEMOS) {
    expect({ key, ok: /^[\w-]{11}$/.test(d.youtubeId) }).toEqual({ key, ok: true });
    expect({ key, ok: d.seconds > 0 && d.seconds < MAX_DEMO_SECONDS }).toEqual({ key, ok: true });
    expect({ key, ok: Boolean(d.channel && d.title) }).toEqual({ key, ok: true });
  }
});

test('demo videos are not reused', () => {
  const ids = [...DEMOS.values()].map((d) => d.youtubeId);
  expect(ids.length).toBe(new Set(ids).size);
});

test('demo JSON links to YouTube', () => {
  const d = DEMOS.get('neck_tilt')?.toJson();
  if (d === undefined) throw new Error('no neck_tilt demo');
  expect(d.url).toBe(`https://www.youtube.com/watch?v=${d.youtube_id}`);
  expect(new Set(Object.keys(d))).toEqual(new Set(['youtube_id', 'seconds', 'channel', 'title', 'url']));
});
