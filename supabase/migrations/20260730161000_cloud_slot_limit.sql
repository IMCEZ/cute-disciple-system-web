-- Enforce the two-slot cloud limit on the server as well as in the client.
-- `primary` is retained temporarily for legacy-save migration and is excluded.
create schema if not exists app_private;
revoke all on schema app_private from public;

create or replace function app_private.enforce_web_save_slot_limit()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.slot_key <> 'primary'
     and not exists (
       select 1 from public.web_game_saves
       where user_id = new.user_id and slot_key = new.slot_key
     ) then
    perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
    if (select count(*) from public.web_game_saves where user_id = new.user_id and slot_key <> 'primary') >= 2 then
      raise exception 'A player may keep at most two cloud save slots';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function app_private.enforce_web_save_slot_limit() from public;

drop trigger if exists web_game_saves_slot_limit on public.web_game_saves;
create trigger web_game_saves_slot_limit
before insert on public.web_game_saves
for each row execute function app_private.enforce_web_save_slot_limit();
