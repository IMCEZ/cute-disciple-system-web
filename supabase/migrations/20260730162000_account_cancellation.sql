-- A player can request deletion, then has a three-day cooling-off window.
-- Logging in during that window removes this row; deleting auth.users cascades
-- both this request and the player's cloud saves.
create schema if not exists app_private;
revoke all on schema app_private from public;

create table if not exists public.account_deletion_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  delete_after timestamptz not null
);

alter table public.account_deletion_requests enable row level security;
revoke all on table public.account_deletion_requests from anon;
grant select, insert, update, delete on table public.account_deletion_requests to authenticated;

drop policy if exists "Players can read their own deletion request" on public.account_deletion_requests;
create policy "Players can read their own deletion request"
on public.account_deletion_requests
for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Players can request their own deletion" on public.account_deletion_requests;
create policy "Players can request their own deletion"
on public.account_deletion_requests
for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Players can update their own deletion request" on public.account_deletion_requests;
create policy "Players can update their own deletion request"
on public.account_deletion_requests
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Players can cancel their own deletion" on public.account_deletion_requests;
create policy "Players can cancel their own deletion"
on public.account_deletion_requests
for delete to authenticated
using ((select auth.uid()) = user_id);

-- The browser cannot choose or extend the deadline: every insert/upsert is fixed
-- to a new three-day cooling-off period by the database clock.
create or replace function app_private.set_account_deletion_window()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.requested_at := now();
  new.delete_after := now() + interval '3 days';
  return new;
end;
$$;

revoke all on function app_private.set_account_deletion_window() from public;

drop trigger if exists account_deletion_window on public.account_deletion_requests;
create trigger account_deletion_window
before insert or update on public.account_deletion_requests
for each row execute function app_private.set_account_deletion_window();

-- Only the scheduled database job may execute this privileged function.  It is
-- intentionally in a non-exposed schema and has a fixed search path.
create or replace function app_private.purge_due_account_deletions()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  delete from auth.users as u
  using public.account_deletion_requests as r
  where u.id = r.user_id
    and r.delete_after <= now();
end;
$$;

revoke all on function app_private.purge_due_account_deletions() from public;

create extension if not exists pg_cron;

-- Idempotently keep exactly one hourly cleanup job.  The small delay means an
-- account is removed within one scheduled run after its three-day deadline.
select cron.unschedule(jobid)
from cron.job
where jobname = 'purge-due-account-deletions';

select cron.schedule(
  'purge-due-account-deletions',
  '17 * * * *',
  $$select app_private.purge_due_account_deletions();$$
);
