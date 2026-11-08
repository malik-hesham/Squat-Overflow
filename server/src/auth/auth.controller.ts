import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import { InvalidGoogleToken } from './google';
import { AUTH_SERVICE } from './auth.tokens';
import { InvalidSession, type AuthService, type SessionResponse } from './auth.service';

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length < 8192;

@Controller('auth')
export class AuthController {
  constructor(@Inject(AUTH_SERVICE) private readonly auth: AuthService | null) {}

  /** Sign in with the ID token from the extension's Google sign-in, plus the raw nonce it hashed. */
  @Post('google')
  @HttpCode(200)
  async google(@Body() body: { id_token?: unknown; nonce?: unknown }): Promise<SessionResponse> {
    const auth = this.service();
    if (!str(body?.id_token) || !str(body?.nonce)) throw new BadRequestException('id_token and nonce required');
    return this.unauthorizedOn(() => auth.signInWithGoogle(body.id_token as string, body.nonce as string));
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() body: { refresh_token?: unknown }): Promise<SessionResponse> {
    const auth = this.service();
    if (!str(body?.refresh_token)) throw new BadRequestException('refresh_token required');
    return this.unauthorizedOn(() => auth.refresh(body.refresh_token as string));
  }

  private service(): AuthService {
    if (!this.auth) throw new ServiceUnavailableException('leaderboard not configured');
    return this.auth;
  }

  private async unauthorizedOn<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof InvalidGoogleToken || err instanceof InvalidSession) throw new UnauthorizedException(err.message);
      throw err;
    }
  }
}
