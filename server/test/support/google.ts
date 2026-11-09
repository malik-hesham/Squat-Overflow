import { createHash } from 'node:crypto';

import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey } from 'jose';

export const CLIENT_ID = 'test-client.apps.googleusercontent.com';
export const NONCE = 'raw-nonce-123';
export const hashed = (nonce: string) => createHash('sha256').update(nonce).digest('hex');

/** A stand-in for Google's signing keys: signs ID tokens and serves the matching JWKS. */
export async function fakeGoogle(): Promise<{
  keys: JWTVerifyGetKey;
  idToken: (claims?: Record<string, unknown>, opts?: { expiresIn?: string; issuer?: string }) => Promise<string>;
}> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const idToken = async (claims: Record<string, unknown> = {}, opts: { expiresIn?: string; issuer?: string } = {}) =>
    new SignJWT({
      email: 'malik@leadliaison.com',
      email_verified: true,
      name: 'Malik Hesham',
      picture: 'https://pic',
      nonce: hashed(NONCE),
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setSubject((claims.sub as string) ?? 'google-sub-1')
      .setIssuer(opts.issuer ?? 'https://accounts.google.com')
      .setAudience((claims.aud as string) ?? CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime(opts.expiresIn ?? '1h')
      .sign(privateKey);
  return { keys, idToken };
}
