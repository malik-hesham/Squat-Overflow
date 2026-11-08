import { SignJWT, generateKeyPair } from 'jose';

import { GoogleTokenVerifier } from '../../src/auth/google';
import { CLIENT_ID, NONCE, fakeGoogle } from '../support/google';

let google: Awaited<ReturnType<typeof fakeGoogle>>;
let verifier: GoogleTokenVerifier;

beforeAll(async () => {
  google = await fakeGoogle();
  verifier = new GoogleTokenVerifier(CLIENT_ID, google.keys);
});

test('accepts a valid token and returns the identity', async () => {
  await expect(verifier.verify(await google.idToken(), NONCE)).resolves.toEqual({
    sub: 'google-sub-1', email: 'malik@leadliaison.com', name: 'Malik Hesham', picture: 'https://pic',
  });
});

test('accepts the bare accounts.google.com issuer too', async () => {
  await expect(verifier.verify(await google.idToken({}, { issuer: 'accounts.google.com' }), NONCE)).resolves.toMatchObject({ sub: 'google-sub-1' });
});

test('missing name and picture become empty strings', async () => {
  const token = await google.idToken({ name: undefined, picture: undefined });
  await expect(verifier.verify(token, NONCE)).resolves.toMatchObject({ name: '', picture: '' });
});

test.each([
  ['a token for another app', () => google.idToken({ aud: 'other-app' })],
  ['another issuer', () => google.idToken({}, { issuer: 'https://evil.example' })],
  ['an unverified email', () => google.idToken({ email_verified: false })],
  ['no email', () => google.idToken({ email: undefined })],
  ['an expired token', () => google.idToken({}, { expiresIn: '-1m' })],
  ['a nonce for another sign-in', () => google.idToken({ nonce: 'something-else' })],
])('rejects %s', async (_case, make) => {
  await expect(verifier.verify(await make(), NONCE)).rejects.toThrow('invalid Google token');
});

test('rejects a token signed by someone else', async () => {
  const { privateKey } = await generateKeyPair('RS256');
  const forged = await new SignJWT({ email: 'malik@leadliaison.com', email_verified: true })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setSubject('google-sub-1').setIssuer('https://accounts.google.com').setAudience(CLIENT_ID)
    .setIssuedAt().setExpirationTime('1h').sign(privateKey);
  await expect(verifier.verify(forged, NONCE)).rejects.toThrow('invalid Google token');
});

test('rejects garbage', async () => {
  await expect(verifier.verify('not.a.jwt', NONCE)).rejects.toThrow('invalid Google token');
});
