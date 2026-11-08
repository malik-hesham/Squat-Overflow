-- Demo leaderboard for leadliaison.com: 12 made-up players on this week's board.
-- Safe to run more than once. Undo with demo-clear.sql.
--   psql "$DATABASE_URL" -f scripts/demo-seed.sql
with demo (name, xp, level, streak, week_xp, avatar) as (
  values
    ('Omar Fathy', 2140, 7, 12, 186, 'robot'),
    ('Nour Adel', 1620, 6, 9, 214, 'bunny'),
    ('Karim Samir', 1180, 5, 7, 142, 'dragon'),
    ('Youssef Nabil', 960, 5, 5, 98, 'slothbear'),
    ('Mariam Hany', 740, 4, 6, 165, 'penguin'),
    ('Hassan Tarek', 610, 4, 3, 77, 'platypus'),
    ('Laila Mostafa', 455, 3, 4, 120, 'critter'),
    ('Ahmed Zaki', 380, 3, 2, 54, 'monster'),
    ('Salma Ehab', 260, 3, 3, 88, 'bunny'),
    ('Mahmoud Reda', 175, 2, 1, 36, 'robot'),
    ('Dina Wael', 120, 2, 2, 61, 'penguin'),
    ('Tamer Shawky', 45, 1, 1, 45, 'dragon')
),
demo_users as (
  -- Demo accounts are marked by a "demo-seed:" Google ID, which no real Google account has.
  insert into users (google_sub, email, name)
  select 'demo-seed:' || d.name, 'demo-seed@leadliaison.com', d.name from demo d
  on conflict (google_sub) do update set name = excluded.name
  returning id, name
)
insert into players (user_id, name, company, xp, level, streak, week_xp, week, avatar)
select u.id, d.name, 'leadliaison.com', d.xp, d.level, d.streak, d.week_xp, to_char(now(), 'IYYY-"W"IW'), d.avatar
from demo d join demo_users u on u.name = d.name
on conflict (user_id) do update
set xp = excluded.xp, level = excluded.level, streak = excluded.streak, week_xp = excluded.week_xp,
    week = excluded.week, avatar = excluded.avatar, updated_at = now();
