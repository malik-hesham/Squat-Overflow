import { createHash } from 'node:crypto';

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface GoogleIdentity {
  sub: string; // stable Google account ID
  email: string;
  name: string;
  picture: string;
}

export class InvalidGoogleToken extends Error {
  constructor() {
    super('invalid Google token');
  }
}

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const GOOGLE_JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs');

/** Google's published signing keys, fetched on demand and cached by jose. */
export const googleKeys = (): JWTVerifyGetKey => createRemoteJWKSet(GOOGLE_JWKS_URL);

const sha256Hex = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * Checks an ID token from the extension's Google sign-in: Google's signature, our client ID as
 * audience, not expired, a verified email, and the nonce. The extension sends Google the SHA-256
 * of a fresh random nonce and sends us the raw nonce, so a token can't be replayed for another
 * sign-in.
 */
export class GoogleTokenVerifier {
  constructor(
    private readonly clientId: string,
    private readonly keys: JWTVerifyGetKey,
  ) {}

  async verify(idToken: string, nonce: string): Promise<GoogleIdentity> {
    let payload;
    try {
      ({ payload } = await jwtVerify(idToken, this.keys, {
        issuer: GOOGLE_ISSUERS,
        audience: this.clientId,
        algorithms: ['RS256'],
      }));
    } catch {
      throw new InvalidGoogleToken();
    }
    const { sub, email, email_verified, name, picture } = payload as Record<string, unknown>;
    if (typeof sub !== 'string' || typeof email !== 'string' || email_verified !== true) throw new InvalidGoogleToken();
    if (payload.nonce !== sha256Hex(nonce)) throw new InvalidGoogleToken();
    return {
      sub,
      email,
      name: typeof name === 'string' ? name : '',
      picture: typeof picture === 'string' ? picture : '',
    };
  }
}
