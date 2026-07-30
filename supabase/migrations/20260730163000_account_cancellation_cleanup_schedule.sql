-- Keep due-account cleanup inexpensive as the number of players grows, and
-- shorten the post-deadline delay from an hour to at most fifteen minutes.
create index if not exists account_deletion_requests_due_idx
on public.account_deletion_requests (delete_after);

select cron.unschedule(jobid)
from cron.job
where jobname = 'purge-due-account-deletions';

select cron.schedule(
  'purge-due-account-deletions',
  '*/15 * * * *',
  $$select app_private.purge_due_account_deletions();$$
);
