// Google sign-in on the phone: the nonce handshake with the server, token refresh and sign-out,
// with the browser sheet, secure storage and network mocked.
const mockSecure = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockSecure.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockSecure.set(k, v),
  deleteItemAsync: async (k: string) => void mockSecure.delete(k),
}));
jest.mock('expo-crypto', () => {
  const nodeCrypto = require('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    getRandomBytes: (n: number) => new Uint8Array(nodeCrypto.randomBytes(n)),
    digestStringAsync: async (_alg: string, data: string) => nodeCrypto.createHash('sha256').update(data).digest('hex'),
  };
});
const mockOpenAuthSession = jest.fn();
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: (...args: unknown[]) => mockOpenAuthSession(...args) }));
const secure = mockSecure;
const openAuthSessionAsync = mockOpenAuthSession;

import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';

import { API_URL, GOOGLE_CLIENT_ID } from '../../../../extension/config.js';
import { BOARD, fetchBoard, submitScore } from '../board';
import {
  APP_REDIRECT,
  CALLBACK_URL,
  SignInCancelled,
  getSession,
  idTokenFrom,
  resetSessionForTests,
  signIn,
  signOut,
  signInUrl,
} from '../session';
import type { Profile, Settings } from '../store';

const HOUR = 3_600_000;
const reply = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const sessionBody = (access: string, refresh: string) => ({
  access_token: access,
  refresh_token: refresh,
  token_type: 'bearer',
  expires_in: 3600,
  user: { id: 'u1', email: 'sam@acme.com', user_metadata: { full_name: 'Sam Lee', avatar_url: '' } },
});
const stored = (expiresAt: number, refreshToken = 'r1') =>
  JSON.stringify({ accessToken: 'a1', refreshToken, expiresAt, user: { id: 'u1', email: 'sam@acme.com', name: 'Sam', picture: '' } });

let fetchMock: jest.Mock;
beforeEach(() => {
  secure.clear();
  resetSessionForTests();
  openAuthSessionAsync.mockReset();
  fetchMock = jest.fn();
  globalThis.fetch = fetchMock;
});

test('the sign-in URL asks Google for an ID token for our web client, returned to the relay page', () => {
  const url = signInUrl('abc123');
  expect(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?')).toBe(true);
  const q = new URLSearchParams(url.split('?')[1]);
  expect(q.get('client_id')).toBe(GOOGLE_CLIENT_ID);
  expect(q.get('response_type')).toBe('id_token');
  expect(q.get('redirect_uri')).toBe(`${API_URL}/auth/mobile-callback`);
  expect(CALLBACK_URL).toBe(`${API_URL}/auth/mobile-callback`);
  expect(q.get('scope')).toBe('openid email profile');
  expect(q.get('nonce')).toBe('abc123');
  expect(q.get('prompt')).toBe('select_account');
});

test('idTokenFrom reads the token and rejects errors', () => {
  expect(idTokenFrom('squatoverflow://auth?id_token=a.b%2Bc&authuser=0')).toBe('a.b+c');
  expect(idTokenFrom('squatoverflow://auth?error=access_denied')).toBeNull();
  expect(idTokenFrom('squatoverflow://auth?id_token=x&error=interaction_required')).toBeNull();
  expect(idTokenFrom('squatoverflow://auth?')).toBeNull();
  expect(idTokenFrom('squatoverflow://auth')).toBeNull();
});

test('sign-in sends Google the nonce hash and the server the raw nonce, then stores the session', async () => {
  openAuthSessionAsync.mockImplementation(async (url: string, redirect: string) => {
    expect(redirect).toBe(APP_REDIRECT);
    return { type: 'success', url: `${APP_REDIRECT}?id_token=google-jwt` };
  });
  fetchMock.mockResolvedValue(reply(200, sessionBody('a1', 'r1')));

  const session = await signIn();

  const googleNonce = new URLSearchParams((openAuthSessionAsync.mock.calls[0][0] as string).split('?')[1]).get('nonce');
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe(`${API_URL}/auth/google`);
  const body = JSON.parse(init.body);
  expect(body.id_token).toBe('google-jwt');
  expect(body.nonce).toMatch(/^[0-9a-f]{32}$/);
  expect(await digestStringAsync(CryptoDigestAlgorithm.SHA256, body.nonce)).toBe(googleNonce);
  expect(session.user.email).toBe('sam@acme.com');
  expect(JSON.parse(secure.get('auth')!).accessToken).toBe('a1');
  expect((await getSession())?.accessToken).toBe('a1');
});

test('closing the sheet is a cancel, and a Google error is a failure; neither calls the server', async () => {
  openAuthSessionAsync.mockResolvedValueOnce({ type: 'cancel' });
  await expect(signIn()).rejects.toBeInstanceOf(SignInCancelled);
  openAuthSessionAsync.mockResolvedValueOnce({ type: 'success', url: `${APP_REDIRECT}?error=access_denied` });
  await expect(signIn()).rejects.not.toBeInstanceOf(SignInCancelled);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(secure.has('auth')).toBe(false);
});

test('a fresh session is returned as stored, without a refresh', async () => {
  secure.set('auth', stored(Date.now() + HOUR));
  expect((await getSession())?.accessToken).toBe('a1');
  expect(fetchMock).not.toHaveBeenCalled();
});

test('callers that arrive together share one refresh, since refresh tokens are single-use', async () => {
  secure.set('auth', stored(Date.now() + 10_000));
  fetchMock.mockResolvedValue(reply(200, sessionBody('a2', 'r2')));
  const [a, b] = await Promise.all([getSession(), getSession()]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe(`${API_URL}/auth/refresh`);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ refresh_token: 'r1' });
  expect(a?.accessToken).toBe('a2');
  expect(b?.accessToken).toBe('a2');
  expect(JSON.parse(secure.get('auth')!).refreshToken).toBe('r2');
});

test('a refused refresh signs out; a network failure keeps the session for later', async () => {
  secure.set('auth', stored(Date.now() + 10_000));
  fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
  expect(await getSession()).toBeNull();
  expect(secure.has('auth')).toBe(true);

  fetchMock.mockResolvedValueOnce(reply(401, {}));
  expect(await getSession()).toBeNull();
  expect(secure.has('auth')).toBe(false);
});

test('a refresh that finishes after sign-out does not sign the user back in', async () => {
  secure.set('auth', stored(Date.now() + 10_000));
  let finish!: (r: Response) => void;
  fetchMock.mockReturnValue(new Promise<Response>((res) => (finish = res)));
  const pending = getSession();
  await new Promise<void>((r) => setTimeout(r, 0));
  await signOut();
  finish(reply(200, sessionBody('a2', 'r2')));
  expect(await pending).toBeNull();
  expect(secure.has('auth')).toBe(false);
});

test('the board client uses the phone session and the hosted API', async () => {
  expect(BOARD.url).toBe(API_URL);
  expect(BOARD.session).toBe(getSession);

  // Signed out: nothing is sent.
  expect(await fetchBoard('week')).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();

  secure.set('auth', stored(Date.now() + HOUR));
  fetchMock.mockResolvedValueOnce(reply(200, [{ rank: 1, name: 'Sam', is_me: true }]));
  expect(await fetchBoard('all')).toEqual([{ rank: 1, name: 'Sam', is_me: true }]);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe(`${API_URL}/leaderboard?period=all`);
  expect(init.headers.Authorization).toBe('Bearer a1');

  fetchMock.mockResolvedValueOnce(reply(204, null));
  const profile = { xp: 120, streak: 2, weekXp: 40, week: null } as unknown as Profile;
  const settings = { name: 'Sam', mode: 'personal', avatar: 'bunny' } as unknown as Settings;
  expect(await submitScore(profile, settings, { remove: true })).toBe(true);
  expect(fetchMock.mock.calls[1][0]).toBe(`${API_URL}/leaderboard/me`);
  expect(fetchMock.mock.calls[1][1].method).toBe('DELETE');
});
