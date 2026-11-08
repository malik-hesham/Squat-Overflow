import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import type { AuthUser } from '../auth/auth.service';
import { BearerGuard, CurrentUser } from '../auth/bearer.guard';
import type { Profile } from './profile';
import type { SyncService } from './sync.service';
import type { PulledEvent, SettingsDoc } from './sync.store';
import { DAY_RE, WEEK_RE, validateProgress, validatePush, validateSettingsPatch } from './validate';

export const SYNC_SERVICE = Symbol('SYNC_SERVICE');

export const MAX_PULL = 500;

/** The caller's local "today" and ISO week, so "today's breaks" and week XP match their clock. */
function localKeys(day: unknown, week: unknown): { day?: string; week?: string } {
  if (day !== undefined && (typeof day !== 'string' || !DAY_RE.test(day))) throw new BadRequestException('invalid day');
  if (week !== undefined && (typeof week !== 'string' || !WEEK_RE.test(week)))
    throw new BadRequestException('invalid week');
  return { day: day as string | undefined, week: week as string | undefined };
}

function intParam(v: unknown, name: string, min: number, max: number, fallback: number): number {
  if (v === undefined) return fallback;
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new BadRequestException(`invalid ${name}`);
  return n;
}

/** Break history: push new breaks, pull everyone's breaks after a cursor. */
@Controller('sync')
@UseGuards(BearerGuard)
export class SyncController {
  constructor(@Inject(SYNC_SERVICE) private readonly sync: SyncService) {}

  @Post('breaks')
  @HttpCode(200)
  async push(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Query('day') day: unknown,
    @Query('week') week: unknown,
  ): Promise<{ accepted: number; profile: Profile }> {
    const keys = localKeys(day, week);
    const check = validatePush(body);
    if (!check.ok) throw new BadRequestException(check.error);
    return this.sync.push(user, check.value, keys.day, keys.week);
  }

  @Get('breaks')
  async pull(
    @CurrentUser() user: AuthUser,
    @Query('since') since: unknown,
    @Query('limit') limit: unknown,
  ): Promise<{ events: PulledEvent[]; next: number }> {
    return this.sync.pull(
      user,
      intParam(since, 'since', 0, Number.MAX_SAFE_INTEGER, 0),
      intParam(limit, 'limit', 1, MAX_PULL, MAX_PULL),
    );
  }
}

/** The caller's profile (derived from breaks), shared settings, and badges/challenges. */
@Controller('me')
@UseGuards(BearerGuard)
export class MeController {
  constructor(@Inject(SYNC_SERVICE) private readonly sync: SyncService) {}

  @Get('profile')
  profile(@CurrentUser() user: AuthUser, @Query('day') day: unknown, @Query('week') week: unknown): Promise<Profile> {
    const keys = localKeys(day, week);
    return this.sync.profile(user, keys.day, keys.week);
  }

  @Get('settings')
  settings(@CurrentUser() user: AuthUser): Promise<SettingsDoc> {
    return this.sync.settings(user);
  }

  @Patch('settings')
  patchSettings(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<SettingsDoc> {
    const check = validateSettingsPatch(body);
    if (!check.ok) throw new BadRequestException(check.error);
    return this.sync.patchSettings(user, check.value.patch, check.value.at);
  }

  @Put('progress')
  @HttpCode(204)
  async putProgress(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<void> {
    const check = validateProgress(body);
    if (!check.ok) throw new BadRequestException(check.error);
    const { at, ...progress } = check.value;
    await this.sync.putProgress(user, progress, at);
  }
}
