create table if not exists public.web_game_saves (
  user_id uuid not null references auth.users(id) on delete cascade,
  slot_key text not null check (char_length(slot_key) between 1 and 64),
  payload jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, slot_key)
);

alter table public.web_game_saves enable row level security;

drop policy if exists "players read own web saves" on public.web_game_saves;
create policy "players read own web saves" on public.web_game_saves
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "players insert own web saves" on public.web_game_saves;
create policy "players insert own web saves" on public.web_game_saves
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "players update own web saves" on public.web_game_saves;
create policy "players update own web saves" on public.web_game_saves
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "players delete own web saves" on public.web_game_saves;
create policy "players delete own web saves" on public.web_game_saves
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.web_game_saves from anon;
grant select, insert, update, delete on table public.web_game_saves to authenticated;
