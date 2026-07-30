-- Each player save slot is synchronized independently.  The legacy `primary`
-- row remains readable for a non-destructive one-time client migration.
alter table public.web_game_saves
  add column if not exists encoding text not null default 'json',
  add column if not exists payload_gzip text,
  add column if not exists content_hash text;

-- The primary key already begins with user_id, so it efficiently serves
-- authenticated per-player slot reads without exposing data across accounts.
