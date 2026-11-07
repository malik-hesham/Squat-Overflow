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

create index if not exists players_company_xp on public.players (company, xp desc);
create index if not exists players_company_week on public.players (company, week, week_xp desc);

alter table public.players enable row level security;
revoke all on public.players from anon, authenticated;

drop function if exists public.submit_score(uuid, text, text, text, int, int, int, int, text, boolean);

create or replace function public.submit_score(
  p_id uuid,
  p_secret text,
  p_name text,
  p_company text,
  p_xp int,
  p_level int,
  p_streak int,
  p_week_xp int,
  p_week text,
  p_delete boolean default false,
  p_avatar text default 'bunny'
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  existing text;
begin
  if p_id is null or p_secret is null or length(p_secret) not between 16 and 64 then
    raise exception 'invalid player';
  end if;

  select secret into existing from players where id = p_id;

  if coalesce(p_delete, false) then
    if existing is null then
      return true;
    end if;
    if existing <> p_secret then
      return false;
    end if;
    delete from players where id = p_id;
    return true;
  end if;

  if p_name is null or length(btrim(p_name)) not between 1 and 40 then
    raise exception 'invalid name';
  end if;
  if p_company is null or length(p_company) > 100 or p_company !~ '^[a-z0-9.-]+\.[a-z]{2,}$' then
    raise exception 'invalid company';
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

  if existing is null then
    insert into players (id, secret, name, company, xp, level, streak, week_xp, week, avatar)
    values (p_id, p_secret, btrim(p_name), p_company, p_xp, p_level, p_streak, p_week_xp, p_week, p_avatar);
    return true;
  end if;

  if existing <> p_secret then
    return false;
  end if;

  update players
  set name = btrim(p_name),
      company = p_company,
      xp = p_xp,
      level = p_level,
      streak = p_streak,
      week_xp = p_week_xp,
      week = p_week,
      avatar = p_avatar,
      updated_at = now()
  where id = p_id;
  return true;
end;
$$;

drop function if exists public.leaderboard(text, text, uuid);

create or replace function public.leaderboard(p_company text, p_period text, p_player uuid)
returns table (rank int, name text, level int, xp int, streak int, is_me boolean, avatar text)
language sql
stable
security definer
set search_path = public
as $$
  with latest as (
    select distinct on (lower(p.name)) p.id, p.name, p.level, p.streak, p.avatar, p.xp, p.week, p.week_xp
    from players p
    where p.company = lower(p_company)
    order by lower(p.name), (p.id = p_player) desc, p.updated_at desc
  ),
  board as (
    select l.id, l.name, l.level, l.streak, l.avatar,
           case when p_period = 'week' then l.week_xp else l.xp end as score
    from latest l
    where p_period <> 'week' or l.week = to_char(now(), 'IYYY-"W"IW')
  ),
  ranked as (
    select (row_number() over (order by b.score desc, b.name))::int as rank,
           b.name, b.level, b.score as xp, b.streak, b.id = p_player as is_me, b.avatar
    from board b
  )
  select r.rank, r.name, r.level, r.xp, r.streak, r.is_me, r.avatar
  from ranked r
  where r.rank <= 10 or r.is_me
  order by r.rank;
$$;

revoke all on function public.submit_score(uuid, text, text, text, int, int, int, int, text, boolean, text) from public;
grant execute on function public.submit_score(uuid, text, text, text, int, int, int, int, text, boolean, text) to anon, authenticated;
revoke all on function public.leaderboard(text, text, uuid) from public;
grant execute on function public.leaderboard(text, text, uuid) to anon, authenticated;
