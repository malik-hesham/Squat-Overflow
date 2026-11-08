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
];
