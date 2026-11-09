/** End-to-end HTTP tests of the API server. Pose analysis runs on the clients, not here. */
import { originAllowed, parseOrigins } from '../../src/config';
import { EXT, startServer, type Server } from './helpers';

let server: Server;

beforeAll(async () => {
  server = await startServer();
});

afterAll(async () => {
  await server.app.close();
});

test('health is the version only: the exercise catalog lives in the clients', async () => {
  const body = await (await fetch(`${server.http}/health`)).json();
  expect(body).toEqual({ ok: true, version: 'dev' }); // FORMCOACH_VERSION is only set inside the Docker image
});

test('the pose routes are gone: no demo wrapper, no /ws', async () => {
  expect((await fetch(`${server.http}/embed/gBL3gYNtun0`)).status).toBe(404);
  const outcome = await new Promise<string>((resolve) => {
    const ws = new WebSocket(`${server.http.replace('http', 'ws')}/ws`);
    ws.onopen = () => {
      ws.close();
      resolve('open');
    };
    ws.onerror = () => resolve('refused');
  });
  expect(outcome).toBe('refused');
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

test('the CORS allowlist takes the extension (Chrome and Firefox) and loopback pages, not web pages', () => {
  expect(originAllowed(EXT)).toBe(true);
  expect(originAllowed('moz-extension://2b7a1c9e-4f3d-4c55-9a51-3f0d6e8b1a22')).toBe(true);
  for (const origin of ['http://127.0.0.1:47821', 'http://localhost:3000']) expect(originAllowed(origin)).toBe(true);
  for (const origin of ['https://evil.example', 'http://127.0.0.1.evil.com', 'http://localhost.evil.com:80', 'https://127.0.0.1:47821', 'http://127.0.0.1']) {
    expect([origin, originAllowed(origin)]).toEqual([origin, false]);
  }
});

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
