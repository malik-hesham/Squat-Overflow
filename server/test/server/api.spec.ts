/** End-to-end tests of the auth and leaderboard HTTP API (replaces Supabase Auth + RPC). */
import type { PGlite } from '@electric-sql/pglite';

import { isoWeek } from '../../src/leaderboard/score';
import { call, startApi, type ApiServer } from '../support/api';
import { freshDb } from '../support/db';
import { NONCE, fakeGoogle } from '../support/google';
import { EXT } from './helpers';

let db: PGlite;
let google: Awaited<ReturnType<typeof fakeGoogle>>;
let server: ApiServer;

beforeAll(async () => {
  google = await fakeGoogle();
  db = await freshDb();
  server = await startApi(db, google.keys);
});
afterAll(async () => {
  await server.app.close();
  await db.close();
});

const api = (method: string, path: string, body?: unknown, token?: string) =>
  call(`${server.url}${path}`, method, body, token ? { Authorization: `Bearer ${token}` } : {});

async function signIn(claims: Record<string, unknown> = {}) {
  const res = await api('POST', '/auth/google', { id_token: await google.idToken(claims), nonce: NONCE });
  expect(res.status).toBe(200);
  return res.body as { access_token: string; refresh_token: string; user: { id: string } };
}

const score = (patch: Record<string, unknown> = {}) => ({
  name: 'Malik', xp: 260, level: 3, streak: 4, weekXp: 40, week: isoWeek(new Date()), avatar: 'penguin', ...patch,
});

describe('auth', () => {
  test('POST /auth/google exchanges a Google ID token for a session', async () => {
    const res = await api('POST', '/auth/google', { id_token: await google.idToken(), nonce: NONCE });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ token_type: 'bearer', expires_in: 3600, user: { email: 'malik@leadliaison.com' } });
  });

  test('POST /auth/google with a bad token or missing fields is refused', async () => {
    expect((await api('POST', '/auth/google', { id_token: await google.idToken({ aud: 'x' }), nonce: NONCE })).status).toBe(401);
    expect((await api('POST', '/auth/google', { id_token: 42 })).status).toBe(400);
  });

  test('POST /auth/refresh rotates the session; a spent refresh token is refused', async () => {
    const s = await signIn();
    const next = await api('POST', '/auth/refresh', { refresh_token: s.refresh_token });
    expect(next.status).toBe(200);
    expect(next.body.user.id).toBe(s.user.id);
    expect((await api('POST', '/auth/refresh', { refresh_token: s.refresh_token })).status).toBe(401);
    expect((await api('POST', '/auth/refresh', {})).status).toBe(400);
  });
});

describe('leaderboard', () => {
  test('requires a valid bearer token', async () => {
    expect((await api('GET', '/leaderboard?period=all')).status).toBe(401);
    expect((await api('PUT', '/leaderboard/me', score(), 'not-a-token')).status).toBe(401);
    expect((await api('DELETE', '/leaderboard/me')).status).toBe(401);
  });

  test('submit, read back on both boards, then leave', async () => {
    const s = await signIn({ sub: 'board-user', email: 'board@acme.io' });
    expect((await api('PUT', '/leaderboard/me', score({ name: '  Board  ' }), s.access_token)).status).toBe(204);

    const all = await api('GET', '/leaderboard?period=all', undefined, s.access_token);
    expect(all.status).toBe(200);
    expect(all.body).toEqual([
      { rank: 1, name: 'Board', level: 3, xp: 260, streak: 4, is_me: true, avatar: 'penguin', company: 'acme.io' },
    ]);
    const week = await api('GET', '/leaderboard?period=week', undefined, s.access_token);
    expect(week.body).toEqual([expect.objectContaining({ xp: 40, is_me: true })]);

    expect((await api('DELETE', '/leaderboard/me', undefined, s.access_token)).status).toBe(204);
    expect((await api('GET', '/leaderboard?period=all', undefined, s.access_token)).body).toEqual([]);
  });

  test('teammates share a board; other companies are not on it', async () => {
    const a = await signIn({ sub: 'team-a', email: 'a@team.dev', name: 'A' });
    const b = await signIn({ sub: 'team-b', email: 'b@team.dev', name: 'B' });
    const x = await signIn({ sub: 'other-x', email: 'x@else.dev', name: 'X' });
    await api('PUT', '/leaderboard/me', score({ name: 'A', xp: 10 }), a.access_token);
    await api('PUT', '/leaderboard/me', score({ name: 'B', xp: 20 }), b.access_token);
    await api('PUT', '/leaderboard/me', score({ name: 'X', xp: 99 }), x.access_token);
    const board = await api('GET', '/leaderboard?period=all', undefined, a.access_token);
    expect(board.body.map((r: { name: string; is_me: boolean }) => [r.name, r.is_me])).toEqual([['B', false], ['A', true]]);
  });

  test('a personal email can sign in but cannot join a board', async () => {
    const s = await signIn({ sub: 'gmail-user', email: 'someone@gmail.com' });
    const res = await api('PUT', '/leaderboard/me', score(), s.access_token);
    expect(res).toEqual({ status: 403, body: expect.objectContaining({ message: 'company email required' }) });
    expect((await api('GET', '/leaderboard?period=all', undefined, s.access_token)).body).toEqual([]);
    expect((await api('DELETE', '/leaderboard/me', undefined, s.access_token)).status).toBe(204);
  });

  test('an invalid score or period is a 400 with the reason', async () => {
    const s = await signIn();
    expect(await api('PUT', '/leaderboard/me', score({ level: 9 }), s.access_token)).toEqual({
      status: 400,
      body: expect.objectContaining({ message: 'invalid level' }),
    });
    expect((await api('GET', '/leaderboard?period=year', undefined, s.access_token)).status).toBe(400);
  });
});

describe('CORS', () => {
  test('the extension may call the API with a bearer token', async () => {
    const res = await fetch(`${server.url}/leaderboard?period=all`, {
      method: 'OPTIONS',
      headers: { Origin: EXT, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(EXT);
    expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization');
  });

  test('a web page gets no CORS grant', async () => {
    const res = await fetch(`${server.url}/leaderboard?period=all`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
