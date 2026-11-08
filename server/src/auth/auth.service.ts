import { createHash, randomBytes } from 'node:crypto';

import { SignJWT, jwtVerify } from 'jose';

import type { Db } from '../db/db';
import type { GoogleTokenVerifier } from './google';

export class InvalidSession extends Error {
  constructor() {
    super('invalid session');
  }
}

export interface AuthUser {
  id: string;
  email: string;
}

/**
 * The session the extension stores. It keeps the shape of Supabase Auth's token response, so
 * the extension's toSession() reads it unchanged.
 */
export interface SessionResponse {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
  expires_in: number;
  user: { id: string; email: string; user_metadata: { full_name: string; avatar_url: string } };
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  picture: string;
}

export const ACCESS_TOKEN_SECONDS = 60 * 60;
export const REFRESH_TOKEN_DAYS = 60;
const ISSUER = 'squat-overflow';

const sha256Hex = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * Accounts and sessions, replacing Supabase Auth. A Google ID token signs a user in; the server
 * then issues its own short-lived access token (an HS256 JWT) and a long-lived refresh token.
 * Refresh tokens are random, stored only as SHA-256 hashes, and single-use: each refresh spends
 * the old one and issues a new pair.
 */
export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly google: GoogleTokenVerifier,
    private readonly secret: Uint8Array,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async signInWithGoogle(idToken: string, nonce: string): Promise<SessionResponse> {
    const who = await this.google.verify(idToken, nonce);
    const { rows } = await this.db.query<UserRow>(
      `insert into users (google_sub, email, name, picture) values ($1, $2, $3, $4)
       on conflict (google_sub) do update
       set email = excluded.email, name = excluded.name, picture = excluded.picture, updated_at = now()
       returning id, email, name, picture`,
      [who.sub, who.email, who.name, who.picture],
    );
    return this.issue(rows[0]);
  }

  async refresh(refreshToken: string): Promise<SessionResponse> {
    // Spend the token atomically, so two concurrent refreshes can't both succeed.
    const { rows } = await this.db.query<UserRow>(
      `with spent as (
         delete from refresh_tokens where token_hash = $1 and expires_at > $2 returning user_id
       )
       select u.id, u.email, u.name, u.picture from users u join spent on spent.user_id = u.id`,
      [sha256Hex(String(refreshToken)), this.clock()],
    );
    if (rows.length === 0) throw new InvalidSession();
    return this.issue(rows[0]);
  }

  async verifyAccessToken(token: string): Promise<AuthUser> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        issuer: ISSUER,
        audience: ISSUER,
        algorithms: ['HS256'],
        currentDate: this.clock(),
      });
      if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') throw new InvalidSession();
      return { id: payload.sub, email: payload.email };
    } catch {
      throw new InvalidSession();
    }
  }

  private async issue(user: UserRow): Promise<SessionResponse> {
    const now = this.clock();
    const nowSeconds = Math.floor(now.getTime() / 1000);
    const accessToken = await new SignJWT({ email: user.email })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer(ISSUER)
      .setAudience(ISSUER)
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + ACCESS_TOKEN_SECONDS)
      .sign(this.secret);
    const refreshToken = randomBytes(32).toString('base64url');
    await this.db.query(`insert into refresh_tokens (token_hash, user_id, expires_at) values ($1, $2, $3)`, [
      sha256Hex(refreshToken),
      user.id,
      new Date(now.getTime() + REFRESH_TOKEN_DAYS * 86_400_000),
    ]);
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'bearer',
      expires_in: ACCESS_TOKEN_SECONDS,
      user: { id: user.id, email: user.email, user_metadata: { full_name: user.name, avatar_url: user.picture } },
    };
  }
}
