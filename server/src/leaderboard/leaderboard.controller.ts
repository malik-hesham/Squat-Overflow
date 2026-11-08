import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import type { AuthUser } from '../auth/auth.service';
import { BearerGuard, CurrentUser } from '../auth/bearer.guard';
import { companyFromEmail } from './company';
import { LeaderboardStore, type BoardRow, type Period } from './leaderboard.store';
import { isoWeek, validateScore } from './score';

export const LEADERBOARD_STORE = Symbol('LEADERBOARD_STORE');

/** The caller's company leaderboard. BearerGuard answers 503 first when there is no database. */
@Controller('leaderboard')
@UseGuards(BearerGuard)
export class LeaderboardController {
  constructor(@Inject(LEADERBOARD_STORE) private readonly store: LeaderboardStore) {}

  @Get()
  async board(@CurrentUser() user: AuthUser, @Query('period') period: unknown): Promise<BoardRow[]> {
    if (period !== 'week' && period !== 'all') throw new BadRequestException('period must be week or all');
    const company = companyFromEmail(user.email);
    if (!company) return []; // personal addresses have no team board
    return this.store.board(user.id, company, period as Period, isoWeek(new Date()));
  }

  @Put('me')
  @HttpCode(204)
  async submit(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<void> {
    const company = companyFromEmail(user.email);
    if (!company) throw new ForbiddenException('company email required');
    const check = validateScore(body);
    if (!check.ok) throw new BadRequestException(check.error);
    await this.store.submit(user.id, company, check.score);
  }

  /** Leaving Competitive mode removes the player's row. Works for any signed-in user. */
  @Delete('me')
  @HttpCode(204)
  async leave(@CurrentUser() user: AuthUser): Promise<void> {
    await this.store.remove(user.id);
  }
}
