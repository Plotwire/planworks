-- ============================================================================
-- Timesheets delete: the owner can delete jobs, work types, single entries
-- and removed workers' records
-- ----------------------------------------------------------------------------
-- For Joe to run in the Supabase SQL editor, once, after supabase/timesheets.sql
-- and supabase/timesheets-week.sql (both live). Previews and production share
-- this database, so it goes live when it is run. The app on master keeps
-- working with it: nothing it uses is removed, renamed or changed. It only
-- ADDS three functions.
--
-- WHAT IT ADDS
--   timesheet_delete_preview(kind, id)  what a delete would take with it:
--                                       entries, hours, how many workers, the
--                                       dates, and (for a work type) how many
--                                       jobs use it as their default. Changes
--                                       nothing.
--   timesheet_delete(kind, id)          the delete. kind is 'job', 'work_type',
--                                       'worker' or 'entry'.
--   ts_delete_entries(...)              internal: which entries go with it.
--
-- WHAT A DELETE DOES (one owner's own things only; the database checks the
-- signed-in account owns it and has the add-on)
--   job        its entries (every worker, every date) and the job
--   work_type  its entries and the work type; jobs that had it as their
--              default are left with no default
--   worker     a REMOVED worker's record and all their entries and weeks
--              (someone still on the team must be removed first)
--   entry      that one entry
-- The entries' change history goes with them, so the hours are gone for
-- good. Permanent: no undo. The app asks for the password first and offers
-- an Excel download of exactly what will go.
--
-- Workers can't use either function (it needs the add-on, which a worker's
-- login can never hold). A worker still deletes only their own entries in an
-- open week, exactly as now.
--
-- NOTHING IS DELETED by running this file. It counts every entry, minute,
-- job, work type, worker and history row before and after, and stops
-- (changing nothing) if any differ. All or nothing: one transaction. Run it
-- once; if it has already been run it stops and changes nothing.
-- To undo it: supabase/timesheets-delete-undo.sql.
-- ============================================================================

begin;
set local lock_timeout = '3s';

do $$
begin
  if to_regclass('public.timesheet_weeks') is null then
    raise exception 'Run supabase/timesheets-week.sql first. Nothing was changed.';
  end if;
  if exists (select 1 from pg_catalog.pg_proc p
               join pg_catalog.pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('timesheet_delete_preview', 'timesheet_delete', 'ts_delete_entries')) then
    raise exception 'timesheets-delete.sql has already been run. Nothing was changed.';
  end if;
end;
$$;

-- What's there now, to prove nothing changes.
create temporary table ts_delete_before on commit drop as
  select (select count(*) from public.timesheet_entries) as entries,
         (select coalesce(sum(minutes), 0) from public.timesheet_entries) as minutes,
         (select count(*) from public.timesheet_jobs) as jobs,
         (select count(*) from public.timesheet_work_types) as work_types,
         (select count(*) from public.timesheet_operatives) as workers,
         (select count(*) from public.timesheet_entry_changes) as history,
         (select count(*) from pg_catalog.pg_policies where schemaname = 'public') as rules,
         (select count(*) from pg_catalog.pg_proc p
            join pg_catalog.pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname ~ '^(ts_|timesheets?_)') as functions;

-- ---------------------------------------------------------------------------
-- Which entries go with a thing (internal: not callable from the app)
-- ---------------------------------------------------------------------------
create function public.ts_delete_entries(p_owner uuid, p_kind text, p_id uuid)
returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(e.id), '{}'::uuid[])
    from public.timesheet_entries e
   where e.owner_id = p_owner
     and ((p_kind = 'job'       and e.job_id = p_id)
       or (p_kind = 'work_type' and e.work_type_id = p_id)
       or (p_kind = 'worker'    and e.operative_id = p_id)
       or (p_kind = 'entry'     and e.id = p_id));
$$;

-- ---------------------------------------------------------------------------
-- What a delete would take with it (changes nothing)
-- ---------------------------------------------------------------------------
create function public.timesheet_delete_preview(p_kind text, p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  me         uuid := auth.uid();
  label      text;
  st         text;
  ids        uuid[];
  jobs_using integer := 0;
begin
  if me is null or not public.ts_addon_active(me) then
    raise exception 'TS_NO_ADDON' using errcode = 'P0001';
  end if;
  case p_kind
    when 'job' then
      select j.job_number || ' – ' || j.job_name into label
        from public.timesheet_jobs j where j.id = p_id and j.owner_id = me;
    when 'work_type' then
      select w.name into label from public.timesheet_work_types w where w.id = p_id and w.owner_id = me;
      select count(*) into jobs_using from public.timesheet_jobs j
       where j.owner_id = me and j.default_work_type_id = p_id;
    when 'worker' then
      select o.name, o.status into label, st from public.timesheet_operatives o where o.id = p_id and o.owner_id = me;
      if st is not null and st <> 'removed' then
        raise exception 'TS_DELETE_NOT_REMOVED' using errcode = 'P0001';
      end if;
    when 'entry' then
      select e.work_date::text into label from public.timesheet_entries e where e.id = p_id and e.owner_id = me;
    else
      raise exception 'TS_DELETE_BAD_KIND' using errcode = 'P0001';
  end case;
  if label is null then
    raise exception 'TS_DELETE_NOT_FOUND' using errcode = 'P0001';
  end if;

  ids := public.ts_delete_entries(me, p_kind, p_id);
  return jsonb_build_object(
    'kind',       p_kind,
    'label',      label,
    'entries',    coalesce(array_length(ids, 1), 0),
    'minutes',    (select coalesce(sum(e.minutes), 0) from public.timesheet_entries e where e.id = any(ids)),
    'workers',    (select count(distinct e.operative_id) from public.timesheet_entries e where e.id = any(ids)),
    'from',       (select min(e.work_date) from public.timesheet_entries e where e.id = any(ids)),
    'to',         (select max(e.work_date) from public.timesheet_entries e where e.id = any(ids)),
    'jobs_using', jobs_using);
end;
$$;

-- ---------------------------------------------------------------------------
-- The delete
-- ---------------------------------------------------------------------------
create function public.timesheet_delete(p_kind text, p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me        uuid := auth.uid();
  st        text;
  ids       uuid[];
  n_entries integer;
  n_minutes bigint;
begin
  if me is null or not public.ts_addon_active(me) then
    raise exception 'TS_NO_ADDON' using errcode = 'P0001';
  end if;

  -- The thing must be this owner's (and a worker must have been removed).
  case p_kind
    when 'job' then
      perform 1 from public.timesheet_jobs j where j.id = p_id and j.owner_id = me for update;
    when 'work_type' then
      perform 1 from public.timesheet_work_types w where w.id = p_id and w.owner_id = me for update;
    when 'worker' then
      select o.status into st from public.timesheet_operatives o where o.id = p_id and o.owner_id = me for update;
      if st is not null and st <> 'removed' then
        raise exception 'TS_DELETE_NOT_REMOVED' using errcode = 'P0001';
      end if;
    when 'entry' then
      perform 1 from public.timesheet_entries e where e.id = p_id and e.owner_id = me for update;
    else
      raise exception 'TS_DELETE_BAD_KIND' using errcode = 'P0001';
  end case;
  if not found then
    raise exception 'TS_DELETE_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Its entries, then their history (deleting writes "deleted" history rows;
  -- they go too), then the thing itself.
  ids := public.ts_delete_entries(me, p_kind, p_id);
  select count(*), coalesce(sum(e.minutes), 0) into n_entries, n_minutes
    from public.timesheet_entries e where e.id = any(ids);
  delete from public.timesheet_entries e where e.owner_id = me and e.id = any(ids);
  delete from public.timesheet_entry_changes h where h.owner_id = me and h.entry_id = any(ids);

  if p_kind = 'job' then
    delete from public.timesheet_jobs j where j.id = p_id and j.owner_id = me;
  elsif p_kind = 'work_type' then
    update public.timesheet_jobs j set default_work_type_id = null
     where j.owner_id = me and j.default_work_type_id = p_id;
    delete from public.timesheet_work_types w where w.id = p_id and w.owner_id = me;
  elsif p_kind = 'worker' then
    delete from public.timesheet_operatives o where o.id = p_id and o.owner_id = me and o.status = 'removed';
  end if;

  return jsonb_build_object('kind', p_kind, 'entries', n_entries, 'minutes', n_minutes);
end;
$$;

-- Who may call them: the signed-in owner (the functions check the rest).
revoke all on function public.ts_delete_entries(uuid, text, uuid)  from public, anon, authenticated;
revoke all on function public.timesheet_delete_preview(text, uuid) from public, anon;
revoke all on function public.timesheet_delete(text, uuid)         from public, anon;
grant execute on function public.timesheet_delete_preview(text, uuid) to authenticated;
grant execute on function public.timesheet_delete(text, uuid)         to authenticated;

-- ---------------------------------------------------------------------------
-- Self-check: undo everything unless it all came out right
-- ---------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  b ts_delete_before%rowtype;
begin
  select * into b from ts_delete_before;
  if (select count(*) from public.timesheet_entries) <> b.entries
     or (select coalesce(sum(minutes), 0) from public.timesheet_entries) <> b.minutes
     or (select count(*) from public.timesheet_jobs) <> b.jobs
     or (select count(*) from public.timesheet_work_types) <> b.work_types
     or (select count(*) from public.timesheet_operatives) <> b.workers
     or (select count(*) from public.timesheet_entry_changes) <> b.history then
    problems := array_append(problems, 'something changed');
  end if;
  if (select count(*) from pg_catalog.pg_policies where schemaname = 'public') <> b.rules then
    problems := array_append(problems, 'the rules changed');
  end if;
  if (select count(*) from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname ~ '^(ts_|timesheets?_)') <> b.functions + 3 then
    problems := array_append(problems, 'expected exactly 3 new functions');
  end if;
  if has_function_privilege('anon', 'public.timesheet_delete(text, uuid)', 'execute')
     or has_function_privilege('anon', 'public.timesheet_delete_preview(text, uuid)', 'execute') then
    problems := array_append(problems, 'signed-out visitors can call a delete function');
  end if;
  if has_function_privilege('authenticated', 'public.ts_delete_entries(uuid, text, uuid)', 'execute') then
    problems := array_append(problems, 'the app can call ts_delete_entries');
  end if;
  if array_length(problems, 1) > 0 then
    raise exception 'Timesheets delete self-check failed: %. Nothing was applied.', array_to_string(problems, '; ');
  end if;
end;
$$;

commit;

-- ============================================================================
-- CHECK (counts only). Expect delete_functions 3. The other numbers are how
-- many there are now: the same as before you ran this.
-- ============================================================================
select
  (select count(*) from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('timesheet_delete_preview', 'timesheet_delete', 'ts_delete_entries')) as delete_functions,
  (select count(*) from public.timesheet_jobs) as jobs,
  (select count(*) from public.timesheet_work_types) as work_types,
  (select count(*) from public.timesheet_operatives) as workers,
  (select count(*) from public.timesheet_entries) as entries;
