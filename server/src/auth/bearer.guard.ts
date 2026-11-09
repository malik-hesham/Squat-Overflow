import {
  createParamDecorator,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';

import { AUTH_SERVICE } from './auth.tokens';
import type { AuthService, AuthUser } from './auth.service';

type AuthedRequest = Request & { user?: AuthUser };

/** Lets a request through only with a valid "Authorization: Bearer <access token>". */
@Injectable()
export class BearerGuard implements CanActivate {
  constructor(@Inject(AUTH_SERVICE) private readonly auth: AuthService | null) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.auth) throw new ServiceUnavailableException('leaderboard not configured');
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw new UnauthorizedException();
    try {
      req.user = await this.auth.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException();
    }
    return true;
  }
}

/** The user BearerGuard verified. */
export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext): AuthUser => context.switchToHttp().getRequest<AuthedRequest>().user!,
);
