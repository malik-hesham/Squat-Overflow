-- Removes the demo players added by demo-seed.sql (their players rows go with them).
--   psql "$DATABASE_URL" -f scripts/demo-clear.sql
delete from users where google_sub like 'demo-seed:%';
