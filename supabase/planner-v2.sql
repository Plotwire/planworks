-- ============================================================================
-- Work Planner v2: order within a day, multi-day jobs, unscheduled jobs
-- Run ONCE in Supabase -> SQL Editor (paste the whole file, press Run).
-- Safe to run again.
-- ----------------------------------------------------------------------------
-- Previews and production share this database, so this changes production too.
-- It only ADDS to planner_jobs, so the live app keeps working before and after:
--   * sort_order integer  -- a job's place within its day (null = by start time)
--   * end_date   date     -- the last day of a multi-day job (null = one day)
--   * job_date may be empty -- a job waiting in the "Unscheduled" tray
-- The current live app never sends these columns and only ever reads jobs with
-- a date in its four weeks, so it carries on exactly as now. The new planner
-- notices the columns by itself (lib/planner.js, plannerSchemaV2) and switches
-- the three features on; until this is run they stay hidden.
--
-- Untouched: row level security, the owner and billing policies on
-- planner_jobs, planner_settings, and planner_shared() (the share link).
-- ============================================================================

-- If something is holding the table, stop after 10 s rather than queue every
-- planner request behind this ("canceling statement due to lock timeout"):
-- nothing is applied and it can simply be run again.
set lock_timeout = '10s';

alter table public.planner_jobs add column if not exists sort_order integer;
alter table public.planner_jobs add column if not exists end_date date;
alter table public.planner_jobs alter column job_date drop not null;

-- A multi-day job ends on or after the day it starts, and only a dated job can
-- have an end.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'planner_jobs_end_after_start'
                    and conrelid = 'public.planner_jobs'::regclass) then
    alter table public.planner_jobs
      add constraint planner_jobs_end_after_start
      check (end_date is null or (job_date is not null and end_date >= job_date));
  end if;
end $$;

reset lock_timeout;

-- ============================================================================
-- CHECK: expect one row: sort_order_column 1, end_date_column 1,
-- job_date_nullable YES, end_check 1, jobs (the same count as before).
-- ============================================================================
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'planner_jobs' and column_name = 'sort_order') as sort_order_column,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'planner_jobs' and column_name = 'end_date')   as end_date_column,
  (select is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'planner_jobs' and column_name = 'job_date')   as job_date_nullable,
  (select count(*) from pg_constraint
    where conname = 'planner_jobs_end_after_start')                                                as end_check,
  (select count(*) from public.planner_jobs)                                                       as jobs;

-- ----------------------------------------------------------------------------
-- SHARE LINKS (optional check, read-only). The view-only link shows a job's
-- extra days only if planner_shared() hands back whole rows. This shows whether
-- it does: share_returns_whole_rows true means multi-day jobs show on the link
-- too; false means the link shows each multi-day job on its first day only
-- (nothing breaks either way, and the function can be updated later).
-- ----------------------------------------------------------------------------
select position('end_date' in pg_get_functiondef(p.oid)) > 0
       or pg_get_functiondef(p.oid) ~* '(to_json|json_agg|jsonb_agg)\s*\(\s*j\s*\)'
       or pg_get_functiondef(p.oid) ~* 'row_to_json'                                               as share_returns_whole_rows
  from pg_proc p
 where p.proname = 'planner_shared';
