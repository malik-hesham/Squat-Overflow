/** End-to-end HTTP + WebSocket tests; these run the real BlazePose model. */
import { originAllowed, parseOrigins } from '../../src/config';
import { Client, EXT, jpeg, startServer, type Server } from './helpers';

let server: Server;
let blank: Buffer;

beforeAll(async () => {
  server = await startServer();
  blank = await jpeg(480, 360);
});

afterAll(async () => {
  await server.app.close();
});

test('health', async () => {
  const body = (await (await fetch(`${server.http}/health`)).json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const keys = new Set<string>(body.exercises.map((e: { key: string }) => e.key));
  expect(body.ok).toBe(true);
  expect(keys.has('neck_tilt') && keys.has('palming')).toBe(true);
  expect(body.version).toBe('dev'); // FORMCOACH_VERSION is only set inside the Docker image
  for (const k of ['squat', 'pushup', 'curl', 'press']) expect(keys.has(k)).toBe(false); // office set only
  expect(keys.size).toBe(40);
  for (const e of body.exercises) expect(e.category && e.how_to && e.demo.url).toBeTruthy();
  expect(new Set(body.exercises.map((e: { stance: string }) => e.stance))).toEqual(new Set(['seated', 'standing']));
});

test('privacy page', async () => {
  const res = await fetch(`${server.http}/privacy`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toMatch(/^text\/html/);
  const text = await res.text();
  expect(text.toLowerCase()).toContain('privacy policy');
  expect(text).toContain('Competitive mode');
});

test('mobile sign-in callback hands the fragment to the app, with no other target', async () => {
  const res = await fetch(`${server.http}/auth/mobile-callback`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toMatch(/^text\/html/);
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  const csp = res.headers.get('content-security-policy') ?? '';
  // The only script allowed is the page's own, pinned by hash.
  expect(csp).toMatch(/(^|; )script-src 'sha256-[A-Za-z0-9+/]+=*'(;|$)/);
  expect(csp).toContain("default-src 'none'");
  const text = await res.text();
  expect(text).toContain('"squatoverflow://auth?" + location.hash');
  // A query string can't change where the page sends the user.
  const other = await (await fetch(`${server.http}/auth/mobile-callback?redirect=https://evil.example`)).text();
  expect(other).toBe(text);
});

test('embed page wraps a valid YouTube id', async () => {
  const res = await fetch(`${server.http}/embed/gBL3gYNtun0`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/html');
  const text = await res.text();
  expect(text).toContain('https://www.youtube-nocookie.com/embed/gBL3gYNtun0?');
  for (const p of ['loop=1', 'mute=1', 'autoplay=1']) expect(text).toContain(p);
});

test('embed page rejects bad ids', async () => {
  expect((await fetch(`${server.http}/embed/not-an-id`)).status).toBe(404);
  expect((await fetch(`${server.http}/embed/%3Cscript%3E12`)).status).toBe(404);
});

test('web page origin is rejected', async () => {
  await expect(Client.connect(server.ws, 'https://evil.example')).rejects.toThrow('handshake refused: 403');
});

test('extension round trip', async () => {
  const ws = await Client.connect(server.ws);
  const ready = await ws.receive();
  expect(ready.type).toBe('ready');
  expect(ready.connections.length).toBeGreaterThan(10);
  expect(ready.exercises).toHaveLength(40); // whole office catalog, so the extension can prefetch it
  expect(ready.exercise).toBe('neck_tilt');
  expect(ready.exercises[0].key).toBe('neck_tilt');

  ws.sendJson({ type: 'config', exercise: 'curl' }); // Workout set is not offered
  expect((await ws.receive()).type).toBe('error');

  ws.sendJson({ type: 'config', exercise: 'nerve_glide' });
  expect(await ws.receive()).toEqual({ type: 'config', exercise: 'nerve_glide', calibrated: false });

  ws.sendBytes(blank);
  const frame = await ws.receive();
  expect(frame.type).toBe('frame');
  expect(frame.exercise).toBe('nerve_glide');
  expect(frame.landmarks).toBeNull();
  expect(frame.feedback[0].code).toBe('not_visible');
  expect(frame.latency_ms).toBeGreaterThan(0);

  ws.sendBytes(Buffer.from('not a jpeg'));
  expect(await ws.receive()).toEqual({ type: 'error', message: 'could not decode frame' });

  ws.sendJson({ type: 'config', exercise: 'burpee' });
  expect((await ws.receive()).type).toBe('error');

  ws.sendJson({ type: 'config', exercise: ['neck_tilt'] });
  expect(await ws.receive()).toEqual({ type: 'error', message: "unknown exercise ['neck_tilt']" });

  ws.sendJson({ type: 'warp' });
  expect(await ws.receive()).toEqual({ type: 'error', message: "unknown message type 'warp'" });

  ws.socket.send('{not json');
  expect(await ws.receive()).toEqual({ type: 'error', message: 'invalid JSON' });

  ws.sendBytes(Buffer.alloc(2 * 1024 * 1024 + 1));
  expect(await ws.receive()).toEqual({ type: 'error', message: 'frame too large' });
  ws.close();
});

test('privacy toggle controls mask field', async () => {
  const ws = await Client.connect(server.ws);
  await ws.receive(); // ready

  ws.sendBytes(blank);
  expect(await ws.receive()).not.toHaveProperty('mask'); // off by default: no extra payload

  ws.sendJson({ type: 'privacy', enabled: true });
  expect(await ws.receive()).toEqual({ type: 'privacy', enabled: true });
  ws.sendBytes(blank);
  const frame = await ws.receive();
  expect(frame).toHaveProperty('mask', null); // nobody found -> client blurs everything

  ws.sendJson({ type: 'privacy', enabled: 'yes' }); // only a real true turns it on
  expect(await ws.receive()).toEqual({ type: 'privacy', enabled: false });

  ws.sendJson(['not', 'an', 'object']);
  expect(await ws.receive()).toEqual({ type: 'error', message: 'expected a JSON object' });
  ws.close();
});

test('angle mode and calibration messages', async () => {
  const ws = await Client.connect(server.ws);
  await ws.receive(); // ready

  ws.sendJson({ type: 'angles', mode: '3d' });
  expect(await ws.receive()).toEqual({ type: 'angles', mode: '3d', exercise: 'neck_tilt' });
  ws.sendJson({ type: 'angles', mode: '4d' });
  expect((await ws.receive()).type).toBe('error');

  ws.sendJson({ type: 'config', exercise: 'sit_to_stand', calibration: { rest: 150, target: 120 } });
  expect(await ws.receive()).toEqual({ type: 'config', exercise: 'sit_to_stand', calibrated: true });
  ws.sendBytes(blank);
  const th = (await ws.receive()).thresholds;
  expect(th.rest).toBe(150);
  expect(th.target).toBe(120);
  expect(th.calibrated).toBe(true);
  expect(th.default_rest).toBe(155);
  expect(th.default_target).toBe(110);

  // Wrong direction for this exercise: error, then the switch happens with defaults.
  ws.sendJson({ type: 'config', exercise: 'sit_to_stand', calibration: { rest: 100, target: 150 } });
  expect((await ws.receive()).type).toBe('error');
  expect(await ws.receive()).toEqual({ type: 'config', exercise: 'sit_to_stand', calibrated: false });

  ws.sendJson({ type: 'calibrate', action: 'start' });
  expect(await ws.receive()).toEqual({ type: 'calibrate', action: 'start', exercise: 'sit_to_stand' });
  ws.sendBytes(blank);
  const frame = await ws.receive();
  expect(frame.calibration).toEqual({ status: 'recording', reps: 0, needed: 3 });
  expect(frame.angle_mode).toBe('2d'); // nobody found: no world landmarks this frame

  ws.sendJson({ type: 'calibrate', action: 'cancel' });
  expect((await ws.receive()).action).toBe('cancel');
  ws.sendBytes(blank);
  expect(await ws.receive()).not.toHaveProperty('calibration');

  ws.sendJson({ type: 'calibrate', action: 'explode' });
  expect((await ws.receive()).type).toBe('error');
  ws.close();
});

test('firefox extension origin is accepted', async () => {
  const ws = await Client.connect(server.ws, 'moz-extension://2b7a1c9e-4f3d-4c55-9a51-3f0d6e8b1a22');
  expect((await ws.receive()).type).toBe('ready');
  ws.close();
});

test.each(['http://127.0.0.1:47821', 'http://localhost:3000'])('loopback origin %s is accepted', async (origin) => {
  const ws = await Client.connect(server.ws, origin);
  expect((await ws.receive()).type).toBe('ready');
  ws.close();
});

test.each(['http://127.0.0.1.evil.com', 'http://localhost.evil.com:80', 'https://127.0.0.1:47821', 'http://127.0.0.1'])(
  'lookalike loopback origin %s is rejected',
  async (origin) => {
    await expect(Client.connect(server.ws, origin)).rejects.toThrow('403');
  },
);

test('explicit allowed origins replace loopback default', () => {
  const allowed = parseOrigins(' https://coach.example , ');
  expect(originAllowed('https://coach.example', allowed)).toBe(true);
  expect(originAllowed('http://127.0.0.1:47821', allowed)).toBe(false);
  expect(originAllowed(EXT, allowed)).toBe(false);
  expect(originAllowed(undefined, allowed)).toBe(true); // non-browser clients send no Origin
});

test('without DATABASE_URL the auth and leaderboard API answers 503', async () => {
  for (const [method, path] of [['POST', '/auth/google'], ['POST', '/auth/refresh'], ['GET', '/leaderboard?period=all'], ['PUT', '/leaderboard/me']]) {
    const res = await fetch(`${server.http}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
    expect([path, res.status]).toEqual([path, 503]);
  }
});
