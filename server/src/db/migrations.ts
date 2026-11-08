/**
 * Schema migrations, applied in order at startup by migrate(). Never edit one that has
 * shipped: append a new entry instead. Kept in TS (not .sql files) so they ship inside dist/.
 * One statement per string: drivers run parameterised queries one statement at a time.
 */
export interface Migration {
  name: string;
  statements: readonly string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    name: '001_users_sessions_players',
    statements: [
      `create table users (
         id uuid primary key default gen_random_uuid(),
         google_sub text not null unique,
         email text not null,
         name text not null default '',
         picture text not null default '',
         created_at timestamptz not null default now(),
         updated_at timestamptz not null default now()
       )`,
      `-- Refresh tokens are stored hashed and rotated on every use.
       create table refresh_tokens (
         token_hash text primary key,
         user_id uuid not null references users (id) on delete cascade,
         expires_at timestamptz not null,
         created_at timestamptz not null default now()
       )`,
      `create index refresh_tokens_user on refresh_tokens (user_id)`,
      `create table players (
         user_id uuid primary key references users (id) on delete cascade,
         name text not null,
         company text not null,
         xp int not null,
         level int not null,
         streak int not null,
         week_xp int not null,
         week text not null,
         avatar text not null default 'bunny',
         updated_at timestamptz not null default now()
       )`,
      `create index players_company_xp on players (company, xp desc)`,
      `create index players_company_week on players (company, week, week_xp desc)`,
    ],
  },
  {
    name: '002_sync',
    statements: [
      `-- One row per finished break, from any device. The client picks the id, so a retried upload is a no-op.
       -- seq is the pull cursor; xid lets a pull skip rows whose transaction has not committed yet.
       create table break_events (
         user_id uuid not null references users (id) on delete cascade,
         id uuid not null,
         seq bigserial not null,
         xid xid8 not null default pg_current_xact_id(),
         at timestamptz not null,
         day text not null,
         week text not null,
         device text not null,
         reps int not null,
         moves int not null,
         score int,
         xp int not null,
         scored boolean not null,
         completed boolean not null,
         areas text[] not null default '{}',
         received_at timestamptz not null default now(),
         primary key (user_id, id)
       )`,
      `create index break_events_user_seq on break_events (user_id, seq)`,
      `create index break_events_user_day on break_events (user_id, day)`,
      `-- Shared settings. field_at holds, per key, the client time of the change that won.
       create table user_settings (
         user_id uuid primary key references users (id) on delete cascade,
         doc jsonb not null default '{}',
         field_at jsonb not null default '{}',
         version int not null default 0,
         updated_at timestamptz not null default now()
       )`,
      `-- Badges and challenge progress, last write wins (by client time).
       create table user_progress (
         user_id uuid primary key references users (id) on delete cascade,
         doc jsonb not null default '{}',
         at bigint not null default 0
       )`,
    ],
  },
];
