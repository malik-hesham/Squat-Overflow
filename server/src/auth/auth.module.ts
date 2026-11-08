import { Module } from '@nestjs/common';
import type { JWTVerifyGetKey } from 'jose';

import { DB } from '../db/database.module';
import type { Db } from '../db/db';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AUTH_SERVICE, GOOGLE_KEYS } from './auth.tokens';
import { BearerGuard } from './bearer.guard';
import { GoogleTokenVerifier, googleKeys } from './google';

export { AUTH_SERVICE, GOOGLE_KEYS } from './auth.tokens';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set when DATABASE_URL is`);
  return value;
}

function jwtSecret(): Uint8Array {
  const secret = requireEnv('AUTH_JWT_SECRET');
  if (secret.length < 32) throw new Error('AUTH_JWT_SECRET must be at least 32 characters');
  return new TextEncoder().encode(secret);
}

@Module({
  controllers: [AuthController],
  providers: [
    { provide: GOOGLE_KEYS, useFactory: googleKeys },
    {
      provide: AUTH_SERVICE,
      inject: [DB, GOOGLE_KEYS],
      useFactory: (db: Db | null, keys: JWTVerifyGetKey): AuthService | null =>
        db ? new AuthService(db, new GoogleTokenVerifier(requireEnv('GOOGLE_CLIENT_ID'), keys), jwtSecret()) : null,
    },
    BearerGuard,
  ],
  exports: [AUTH_SERVICE, BearerGuard],
})
export class AuthModule {}
