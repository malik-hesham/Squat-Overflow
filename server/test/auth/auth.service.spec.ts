import type { PGlite } from '@electric-sql/pglite';

import { AuthService, InvalidSession } from '../../src/auth/auth.service';
import { GoogleTokenVerifier } from '../../src/auth/google';
import { freshDb } from '../support/db';
import { CLIENT_ID, NONCE, fakeGoogle } from '../support/google';

const SECRET = new TextEncoder().encode('test-secret-at-least-32-bytes-long!!');
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

let db: PGlite;
let google: Awaited<ReturnType<typeof fakeGoogle>>;
let now: number;
let auth: AuthService;

beforeAll(async () => {
  google = await fakeGoogle();
});
beforeEach(async () => {
  db = await freshDb();
  now = Date.now();
  auth = new AuthService(db, new GoogleTokenVerifier(CLIENT_ID, google.keys), SECRET, () => new Date(now));
});
afterEach(() => db.close());

const signIn = async (claims: Record<string, unknown> = {}) => auth.signInWithGoogle(await google.idToken(claims), NONCE);

test('Google sign-in returns a session in the shape the extension stores', async () => {
  const s = await signIn();
  expect(s).toEqual({
    access_token: expect.any(String),
    refresh_token: expect.any(String),
    token_type: 'bearer',
    expires_in: 3600,
    user: {
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      email: 'malik@leadliaison.com',
      user_metadata: { full_name: 'Malik Hesham', avatar_url: 'https://pic' },
    },
  });
});

test('signing in again with the same Google account keeps the user and updates the profile', async () => {
  const first = await signIn();
  const again = await signIn({ email: 'malik.h@leadliaison.com', name: 'Malik H' });
  expect(again.user.id).toBe(first.user.id);
  expect(again.user).toMatchObject({ email: 'malik.h@leadliaison.com', user_metadata: { full_name: 'Malik H' } });
  const other = await signIn({ sub: 'google-sub-2', email: 'nour@leadliaison.com' });
  expect(other.user.id).not.toBe(first.user.id);
});

test('a bad Google token signs nobody in', async () => {
  await expect(auth.signInWithGoogle(await google.idToken({ aud: 'other-app' }), NONCE)).rejects.toThrow('invalid Google token');
});

test('the access token identifies the user', async () => {
  const s = await signIn();
  await expect(auth.verifyAccessToken(s.access_token)).resolves.toEqual({ id: s.user.id, email: 'malik@leadliaison.com' });
});

test('an expired, tampered or foreign access token is rejected', async () => {
  const s = await signIn();
  const [h, p, sig] = s.access_token.split('.');
  await expect(auth.verifyAccessToken(`${h}.${p}x.${sig}`)).rejects.toThrow(InvalidSession);
  const foreign = new AuthService(db, new GoogleTokenVerifier(CLIENT_ID, google.keys), new TextEncoder().encode('another-secret-also-32-bytes-long!!!'), () => new Date(now));
  await expect(foreign.verifyAccessToken(s.access_token)).rejects.toThrow(InvalidSession);
  now += 61 * MIN;
  await expect(auth.verifyAccessToken(s.access_token)).rejects.toThrow(InvalidSession);
});

test('refresh rotates the pair: the new tokens work, the old refresh token is spent', async () => {
  const s = await signIn();
  now += 59 * MIN;
  const next = await auth.refresh(s.refresh_token);
  expect(next.refresh_token).not.toBe(s.refresh_token);
  expect(next.user.id).toBe(s.user.id);
  now += 30 * MIN; // the first access token has expired, the refreshed one hasn't
  await expect(auth.verifyAccessToken(next.access_token)).resolves.toMatchObject({ id: s.user.id });
  await expect(auth.refresh(s.refresh_token)).rejects.toThrow(InvalidSession);
  await expect(auth.refresh(next.refresh_token)).resolves.toMatchObject({ user: { id: s.user.id } });
});

test('an unknown or expired refresh token is rejected', async () => {
  await expect(auth.refresh('nope')).rejects.toThrow(InvalidSession);
  const s = await signIn();
  now += 61 * DAY;
  await expect(auth.refresh(s.refresh_token)).rejects.toThrow(InvalidSession);
});

test('refresh tokens are stored hashed, never in the clear', async () => {
  const s = await signIn();
  const { rows } = await db.query<{ token_hash: string }>('select token_hash from refresh_tokens');
  expect(rows).toHaveLength(1);
  expect(rows[0].token_hash).not.toBe(s.refresh_token);
  expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
});
