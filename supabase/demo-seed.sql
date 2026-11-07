insert into public.players (id, secret, name, company, xp, level, streak, week_xp, week, avatar, verified)
select gen_random_uuid(), 'demo-seed', v.name, 'leadliaison.com', v.xp, v.level, v.streak, v.week_xp,
       to_char(now(), 'IYYY-"W"IW'), v.avatar, true
from (values
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
) as v(name, xp, level, streak, week_xp, avatar)
where not exists (
  select 1 from public.players p where p.secret = 'demo-seed' and p.name = v.name
);
