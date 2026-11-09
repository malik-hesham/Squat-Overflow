import type { AuthUser } from '../auth/auth.service';
import { companyFromEmail } from '../leaderboard/company';
import type { LeaderboardStore } from '../leaderboard/leaderboard.store';
import { isoWeek } from '../leaderboard/score';
import type { Profile } from './profile';
import type { SettingsDoc, SyncStore } from './sync.store';
import type { BreakEvent, Progress } from './validate';

/** The day key of `now` in UTC: the default when a client doesn't send its local day. */
export const utcDay = (now: Date) => now.toISOString().slice(0, 10);

/**
 * Sync on top of SyncStore, plus the leaderboard: the server now writes the player's board row
 * from the derived profile, so clients no longer submit their own score.
 */
export class SyncService {
  constructor(
    private readonly store: SyncStore,
    private readonly board: LeaderboardStore,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async push(user: AuthUser, events: BreakEvent[], day?: string, week?: string) {
    const accepted = await this.store.push(user.id, events);
    if (accepted > 0) await this.refreshBoard(user);
    return { accepted, profile: await this.profile(user, day, week) };
  }

  pull(user: AuthUser, since: number, limit: number) {
    return this.store.pull(user.id, since, limit);
  }

  profile(user: AuthUser, day?: string, week?: string): Promise<Profile> {
    const now = this.clock();
    return this.store.profile(user.id, day ?? utcDay(now), week ?? isoWeek(now));
  }

  settings(user: AuthUser): Promise<SettingsDoc> {
    return this.store.settings(user.id);
  }

  async patchSettings(user: AuthUser, patch: Record<string, unknown>, at: number): Promise<SettingsDoc> {
    const before = await this.store.settings(user.id);
    const after = await this.store.patchSettings(user.id, patch, at);
    if (after.version !== before.version) await this.refreshBoard(user);
    return after;
  }

  putProgress(user: AuthUser, progress: Progress, at: number): Promise<boolean> {
    return this.store.putProgress(user.id, progress, at);
  }

  /**
   * Competitive players get their board row rewritten from the profile; switching to Personal
   * removes it. Users who never synced settings keep whatever the old PUT /leaderboard/me wrote.
   */
  private async refreshBoard(user: AuthUser): Promise<void> {
    const { doc } = await this.store.settings(user.id);
    if (doc.mode === 'personal') return this.board.remove(user.id);
    if (doc.mode !== 'competitive') return;
    const company = companyFromEmail(user.email);
    const name = typeof doc.name === 'string' ? doc.name.trim() : '';
    if (!company || !name) return;
    // The board ranks by the server's (UTC) ISO week, so week XP must be counted for that week.
    const p = await this.profile(user, undefined, isoWeek(this.clock()));
    await this.board.submit(user.id, company, {
      name,
      xp: p.xp,
      level: p.level,
      streak: p.streak,
      weekXp: p.weekXp,
      week: p.week,
      avatar: typeof doc.avatar === 'string' ? doc.avatar : 'bunny',
    });
  }
}
