create table if not exists public.players (
  id uuid primary key,
  secret text not null,
  name text not null,
  company text not null,
  xp int not null,
  level int not null,
  streak int not null,
  week_xp int not null,
  week text not null,
  updated_at timestamptz not null default now()
);

alter table public.players add column if not exists avatar text not null default 'bunny';
alter table public.players add column if not exists verified boolean not null default false;

create index if not exists players_company_xp on public.players (company, xp desc);
create index if not exists players_company_week on public.players (company, week, week_xp desc);

alter table public.players enable row level security;
revoke all on public.players from anon, authenticated;

drop function if exists public.submit_score(uuid, text, text, text, int, int, int, int, text, boolean);
drop function if exists public.submit_score(uuid, text, text, text, int, int, int, int, text, boolean, text);
drop function if exists public.leaderboard(text, text, uuid);

create or replace function public.player_company()
returns text
language sql
stable
set search_path = public
as $$
  select case
    when position('@' in coalesce(auth.jwt() ->> 'email', '')) = 0 then null
    when split_part(lower(auth.jwt() ->> 'email'), '@', 2) in (
      'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
      'yahoo.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com',
      'gmx.com', 'yandex.com', 'mail.com', 'zoho.com'
    ) then null
    else split_part(lower(auth.jwt() ->> 'email'), '@', 2)
  end
$$;

create or replace function public.submit_score(
  p_name text,
  p_xp int,
  p_level int,
  p_streak int,
  p_week_xp int,
  p_week text,
  p_avatar text default 'bunny',
  p_delete boolean default false
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  co text := public.player_company();
begin
  if uid is null then
    raise exception 'sign in required';
  end if;

  if coalesce(p_delete, false) then
    delete from players where id = uid;
    return true;
  end if;

  if co is null then
    raise exception 'company email required';
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 40 then
    raise exception 'invalid name';
  end if;
  if coalesce(p_xp, -1) not between 0 and 1000000 or coalesce(p_week_xp, -1) not between 0 and 1000000 then
    raise exception 'invalid xp';
  end if;
  if coalesce(p_level, 0) not between 1 and 8 then
    raise exception 'invalid level';
  end if;
  if coalesce(p_streak, -1) not between 0 and 10000 then
    raise exception 'invalid streak';
  end if;
  if p_week is null or p_week !~ '^\d{4}-W\d{2}$' then
    raise exception 'invalid week';
  end if;
  if p_avatar is null or p_avatar !~ '^[a-z]{2,20}$' then
    raise exception 'invalid avatar';
  end if;

  insert into players (id, secret, name, company, xp, level, streak, week_xp, week, avatar, verified)
  values (uid, '', btrim(p_name), co, p_xp, p_level, p_streak, p_week_xp, p_week, p_avatar, true)
  on conflict (id) do update
  set name = excluded.name,
      company = excluded.company,
      xp = excluded.xp,
      level = excluded.level,
      streak = excluded.streak,
      week_xp = excluded.week_xp,
      week = excluded.week,
      avatar = excluded.avatar,
      verified = true,
      updated_at = now();
  return true;
end;
$$;

create or replace function public.leaderboard(p_period text)
returns table (rank int, name text, level int, xp int, streak int, is_me boolean, avatar text, company text)
language sql
stable
security definer
set search_path = public
as $$
  with board as (
    select p.id, p.name, p.level, p.streak, p.avatar, p.company,
           case when p_period = 'week' then p.week_xp else p.xp end as score
    from players p
    where p.verified
      and p.company = public.player_company()
      and (p_period <> 'week' or p.week = to_char(now(), 'IYYY-"W"IW'))
  ),
  ranked as (
    select (row_number() over (order by b.score desc, b.name))::int as rank,
           b.name, b.level, b.score as xp, b.streak, b.id = auth.uid() as is_me, b.avatar, b.company
    from board b
  )
  select r.rank, r.name, r.level, r.xp, r.streak, r.is_me, r.avatar, r.company
  from ranked r
  where r.rank <= 10 or r.is_me
  order by r.rank;
$$;

revoke all on function public.submit_score(text, int, int, int, int, text, text, boolean) from public, anon;
grant execute on function public.submit_score(text, int, int, int, int, text, text, boolean) to authenticated;
revoke all on function public.leaderboard(text) from public, anon;
grant execute on function public.leaderboard(text) to authenticated;
