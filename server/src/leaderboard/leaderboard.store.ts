import type { Db } from '../db/db';
import type { Score } from './score';

export type Period = 'week' | 'all';

/** One leaderboard line, in the shape the extension renders (unchanged from the Supabase RPC). */
export interface BoardRow {
  rank: number;
  name: string;
  level: number;
  xp: number;
  streak: number;
  is_me: boolean;
  avatar: string;
  company: string;
}

/** How many players every board shows; the caller's own row is added when they rank lower. */
export const TOP = 10;

export class LeaderboardStore {
  constructor(private readonly db: Db) {}

  /** Insert or replace the player's row (one row per user). */
  async submit(userId: string, company: string, s: Score): Promise<void> {
    await this.db.query(
      `insert into players (user_id, name, company, xp, level, streak, week_xp, week, avatar)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (user_id) do update
       set name = excluded.name, company = excluded.company, xp = excluded.xp, level = excluded.level,
           streak = excluded.streak, week_xp = excluded.week_xp, week = excluded.week,
           avatar = excluded.avatar, updated_at = now()`,
      [userId, s.name, company, s.xp, s.level, s.streak, s.weekXp, s.week, s.avatar],
    );
  }

  async remove(userId: string): Promise<void> {
    await this.db.query(`delete from players where user_id = $1`, [userId]);
  }

  /**
   * The caller's company board: ranked by score (week xp for "week", total xp for "all"), ties
   * broken by name. "week" only counts rows submitted for `week`, the current ISO week.
   */
  async board(userId: string, company: string, period: Period, week: string): Promise<BoardRow[]> {
    const { rows } = await this.db.query<BoardRow>(
      `with board as (
         select p.user_id, p.name, p.level, p.streak, p.avatar, p.company,
                case when $3 = 'week' then p.week_xp else p.xp end as score
         from players p
         where p.company = $2 and ($3 <> 'week' or p.week = $4)
       ),
       ranked as (
         select (row_number() over (order by b.score desc, b.name))::int as rank,
                b.name, b.level, b.score as xp, b.streak, b.user_id = $1::uuid as is_me, b.avatar, b.company
         from board b
       )
       select rank, name, level, xp, streak, is_me, avatar, company
       from ranked
       where rank <= $5 or is_me
       order by rank`,
      [userId, company, period, week, TOP],
    );
    return rows;
  }
}
