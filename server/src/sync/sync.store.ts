import type { Db } from '../db/db';
import { DEFAULT_WORKDAYS, buildProfile, type Profile } from './profile';
import type { BreakEvent, Progress } from './validate';

export type PulledEvent = BreakEvent & { seq: number };

export interface SettingsDoc {
  doc: Record<string, unknown>;
  version: number;
}

/** How many times patchSettings retries when another request updated the row in between. */
const PATCH_RETRIES = 5;

const EVENT_COLUMNS = `id, at, day, week, device, reps, moves, score, xp, scored, completed, areas`;

export class SyncStore {
  constructor(private readonly db: Db) {}

  /** Stores new events; ids the user already has are skipped. Returns how many were new. */
  async push(userId: string, events: BreakEvent[]): Promise<number> {
    const { rows } = await this.db.query(
      `insert into break_events (user_id, ${EVENT_COLUMNS})
       select $1, e.id, to_timestamp(e.at / 1000.0), e.day, e.week, e.device, e.reps, e.moves, e.score, e.xp,
              e.scored, e.completed, e.areas
       from jsonb_to_recordset($2::jsonb) as e(
         id uuid, at bigint, day text, week text, device text, reps int, moves int, score int, xp int,
         scored boolean, completed boolean, areas text[]
       )
       on conflict (user_id, id) do nothing
       returning id`,
      [userId, JSON.stringify(events)],
    );
    return rows.length;
  }

  /**
   * Events after cursor `since`, oldest first. seq values are handed out before commit, so a
   * row from a transaction that is still open could later appear behind a cursor a client has
   * already passed. Rows whose transaction id is not below the oldest open transaction are held
   * back until it ends, so the cursor never skips one.
   */
  async pull(userId: string, since: number, limit: number): Promise<{ events: PulledEvent[]; next: number }> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `select id, seq::float8 as seq, (extract(epoch from at) * 1000)::float8 as at, day, week, device, reps, moves,
              score, xp, scored, completed, areas
       from break_events
       where user_id = $1 and seq > $2 and xid < pg_snapshot_xmin(pg_current_snapshot())
       order by seq
       limit $3`,
      [userId, since, limit],
    );
    const events = rows.map((r) => ({ ...r, at: Math.round(Number(r.at)), seq: Number(r.seq) }) as PulledEvent);
    return { events, next: events.length ? events[events.length - 1].seq : since };
  }

  /** The derived profile, with "today" and "this week" as the caller's local keys. */
  async profile(userId: string, day: string, week: string): Promise<Profile> {
    const [totals, days, settings, progress] = await Promise.all([
      this.db.query<{ total_xp: number; week_xp: number; today: number; breaks: number; last_at: number | null; last_day: string | null }>(
        `select coalesce(sum(xp), 0)::int as total_xp,
                coalesce(sum(xp) filter (where week = $2), 0)::int as week_xp,
                (count(*) filter (where day = $3))::int as today,
                count(*)::int as breaks,
                (extract(epoch from max(at)) * 1000)::float8 as last_at,
                (select day from break_events where user_id = $1 order by at desc limit 1) as last_day
         from break_events where user_id = $1`,
        [userId, week, day],
      ),
      // A streak can't run longer than this many distinct days in a POC; plenty for a year.
      this.db.query<{ day: string }>(
        `select distinct day from break_events where user_id = $1 and xp > 0 order by day desc limit 400`,
        [userId],
      ),
      this.settings(userId),
      this.db.query<{ doc: Partial<Progress> }>(`select doc from user_progress where user_id = $1`, [userId]),
    ]);
    const t = totals.rows[0];
    const workdays = Array.isArray(settings.doc.workdays) ? (settings.doc.workdays as number[]) : DEFAULT_WORKDAYS;
    return buildProfile(day, week, {
      totalXp: t.total_xp,
      weekXp: t.week_xp,
      todayBreaks: t.today,
      breaks: t.breaks,
      lastBreakAt: t.last_at === null ? null : Math.round(Number(t.last_at)),
      lastBreakDay: t.last_day,
      xpDays: days.rows.map((r) => r.day),
      workdays,
      progress: progress.rows[0]?.doc ?? {},
    });
  }

  async settings(userId: string): Promise<SettingsDoc> {
    const { rows } = await this.db.query<SettingsDoc>(`select doc, version from user_settings where user_id = $1`, [
      userId,
    ]);
    return rows[0] ?? { doc: {}, version: 0 };
  }

  /**
   * Merges `patch` key by key: a key changes only when `at` is not older than the change that
   * set it last. Optimistic: the update only lands if the version is still the one merged from.
   */
  async patchSettings(userId: string, patch: Record<string, unknown>, at: number): Promise<SettingsDoc> {
    await this.db.query(`insert into user_settings (user_id) values ($1) on conflict (user_id) do nothing`, [userId]);
    for (let attempt = 0; attempt < PATCH_RETRIES; attempt++) {
      const { rows } = await this.db.query<SettingsDoc & { field_at: Record<string, number> }>(
        `select doc, field_at, version from user_settings where user_id = $1`,
        [userId],
      );
      const cur = rows[0];
      const doc = { ...cur.doc };
      const fieldAt = { ...cur.field_at };
      let changed = false;
      for (const [k, v] of Object.entries(patch)) {
        if ((fieldAt[k] ?? 0) > at) continue;
        doc[k] = v;
        fieldAt[k] = at;
        changed = true;
      }
      if (!changed) return { doc: cur.doc, version: cur.version };
      const upd = await this.db.query<{ version: number }>(
        `update user_settings set doc = $2, field_at = $3, version = version + 1, updated_at = now()
         where user_id = $1 and version = $4
         returning version`,
        [userId, JSON.stringify(doc), JSON.stringify(fieldAt), cur.version],
      );
      if (upd.rows.length) return { doc, version: upd.rows[0].version };
    }
    throw new Error('settings update kept conflicting');
  }

  /** Replaces badges and challenges unless a newer write (by client time) is already stored. */
  async putProgress(userId: string, progress: Progress, at: number): Promise<boolean> {
    const { rows } = await this.db.query(
      `insert into user_progress (user_id, doc, at) values ($1, $2, $3)
       on conflict (user_id) do update set doc = excluded.doc, at = excluded.at
       where user_progress.at <= excluded.at
       returning user_id`,
      [userId, JSON.stringify(progress), at],
    );
    return rows.length > 0;
  }
}
