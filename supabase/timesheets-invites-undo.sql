-- ============================================================================
-- UNDO supabase/timesheets-invites.sql
-- ----------------------------------------------------------------------------
-- Only if something goes wrong. Removes exactly what that file added: the
-- invites table, its six functions, and the worker-login rule. Hours, jobs
-- and workers are not touched: anyone already invited stays on the team as
-- "invited" (with no login they can't do anything), and anyone who joined
-- keeps their login and hours.
--
-- All or nothing: if timesheets-invites.sql was never run, it stops and
-- changes nothing. Pending invite links stop working.
-- ============================================================================
begin;
set local lock_timeout = '3s';

create temporary table ts_invites_undo_before on commit drop as
  select (select count(*) from public.timesheet_entries) as entries,
         (select coalesce(sum(minutes), 0) from public.timesheet_entries) as minutes,
         (select count(*) from public.timesheet_operatives) as workers;

drop trigger ts_require_operative_login on public.timesheet_operatives;
drop function public.ts_require_operative_login();
drop function public.timesheet_invite_create(uuid, text, text, text);
drop function public.timesheet_invite_resend(uuid, uuid, text);
drop function public.timesheet_invite_cancel(uuid, uuid);
drop function public.timesheet_invite_lookup(text);
drop function public.timesheet_invite_accept(text, uuid);
drop function public.timesheet_remove_worker(uuid, uuid);
drop table public.timesheet_invites;

do $$
declare
  b ts_invites_undo_before%rowtype;
begin
  select * into b from ts_invites_undo_before;
  if (select count(*) from public.timesheet_entries) <> b.entries
     or (select coalesce(sum(minutes), 0) from public.timesheet_entries) <> b.minutes
     or (select count(*) from public.timesheet_operatives) <> b.workers then
    raise exception 'Something else changed. Nothing was undone.';
  end if;
end;
$$;

commit;

-- CHECK (counts only). Expect invites_table 0, worker_login_rule 0, rules 18,
-- functions 18, and entries / workers the same as before.
select
  (select count(*) from pg_catalog.pg_class c
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'timesheet_invites') as invites_table,
  (select count(*) from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.timesheet_operatives'::regclass and t.tgname = 'ts_require_operative_login') as worker_login_rule,
  (select count(*) from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in ('addon_entitlements', 'timesheet_operatives', 'timesheet_work_types',
                        'timesheet_jobs', 'timesheet_entries', 'timesheet_entry_changes', 'timesheet_weeks')) as rules,
  (select count(*) from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname ~ '^(ts_|timesheets?_)') as functions,
  (select count(*) from public.timesheet_entries) as entries,
  (select count(*) from public.timesheet_operatives) as workers;
