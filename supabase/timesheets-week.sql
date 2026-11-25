-- ============================================================================
-- Timesheets week: optional notes, submit a week, reopen a week
-- ----------------------------------------------------------------------------
-- For Joe to run in the Supabase SQL editor, once, after supabase/timesheets.sql
-- (already live). Previews and production share this database, so it goes
-- live when it is run. The app on master keeps working with it: nothing it
-- uses is removed or renamed.
--
-- WHAT IT CHANGES
--   1. A timesheet entry's note becomes OPTIONAL. Before, every entry needed
--      one (one line, up to 150 characters). Now it may be left empty; when
--      there is one, the same rule applies (one line, up to 150 characters,
--      not just spaces). Every existing entry already meets it.
--   2. ADDS a table, timesheet_weeks: one row when an operative submits a
--      week, changed when the owner reopens it.
--   3. ADDS three functions: submit a week (operatives), reopen a week (the
--      owner), and an internal one the rules use.
--   4. CHANGES the operative's write rule (ts_may_write) so that:
--        - a SUBMITTED week is locked: no adding, changing or deleting;
--        - a week the owner REOPENED can be edited again, even if it's older
--          than the usual window (this week, plus last week on a Monday);
--        - everything else is as before (own entries only, no future dates).
--      The owner's rules don't change: the owner can still correct anything.
--   5. Two read rules for the new table: the owner reads their team's weeks,
--      an operative reads only their own.
--
-- NOTHING IS DELETED. No existing row changes. Before committing it counts
-- every entry and adds up their minutes, and stops (changing nothing) if
-- either total differs afterwards.
--
-- All or nothing: one transaction. If any step fails, nothing is applied.
-- Run it once. If it has already been run it stops and changes nothing.
-- ============================================================================

begin;
set local lock_timeout = '3s';

do $$
begin
  if to_regclass('public.timesheet_entries') is null then
    raise exception 'Run supabase/timesheets.sql first. Nothing was changed.';
  end if;
  if to_regclass('public.timesheet_weeks') is not null
     or exists (select 1 from pg_catalog.pg_proc p
                  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public'
                   and p.proname in ('ts_week_status', 'timesheet_submit_week', 'timesheet_reopen_week')) then
    raise exception 'timesheets-week.sql has already been run. Nothing was changed.';
  end if;
end;
$$;

-- What's there now, to prove nothing is lost.
create temporary table ts_week_before on commit drop as
  select count(*) as entries, coalesce(sum(minutes), 0) as minutes
    from public.timesheet_entries;

-- ---------------------------------------------------------------------------
-- 1. The note becomes optional
-- ---------------------------------------------------------------------------
do $$
declare
  rule_name text;
  how_many  integer;
begin
  select count(*), min(c.conname) into how_many, rule_name
    from pg_catalog.pg_constraint c
   where c.conrelid = 'public.timesheet_entries'::regclass
     and c.contype = 'c'
     and pg_catalog.pg_get_constraintdef(c.oid) ilike '%description%';
  if how_many <> 1 then
    raise exception 'Expected one rule on the note, found %. Nothing was changed.', how_many;
  end if;
  execute format('alter table public.timesheet_entries drop constraint %I', rule_name);
end;
$$;

alter table public.timesheet_entries alter column description drop not null;

alter table public.timesheet_entries add constraint timesheet_entries_note_check
  check (description is null
         or (char_length(description) between 1 and 150
             and description ~ '\S'
             and description !~ '[\r\n]'));

-- ---------------------------------------------------------------------------
-- 2. Submitted weeks
-- ---------------------------------------------------------------------------
-- One row per operative per week, made when they submit it. week_start is
-- always a Monday.
create table public.timesheet_weeks (
  owner_id     uuid not null,
  operative_id uuid not null,
  week_start   date not null check (extract(isodow from week_start) = 1),
  status       text not null check (status in ('submitted', 'reopened')),
  submitted_at timestamptz not null default now(),
  submitted_by uuid,
  reopened_at  timestamptz,
  reopened_by  uuid,
  updated_at   timestamptz not null default now(),
  primary key (operative_id, week_start),
  foreign key (operative_id, owner_id)
    references public.timesheet_operatives (id, owner_id) on delete cascade
);
create index timesheet_weeks_owner_week on public.timesheet_weeks (owner_id, week_start);

alter table public.timesheet_weeks enable row level security;
revoke all on table public.timesheet_weeks from anon, authenticated;
grant select, insert, update, delete on table public.timesheet_weeks to service_role;
-- The app only reads. Submitting and reopening go through the functions below.
grant select on table public.timesheet_weeks to authenticated;

create policy "owner reads weeks" on public.timesheet_weeks
  for select to authenticated using (owner_id = auth.uid());
create policy "operative reads own weeks" on public.timesheet_weeks
  for select to authenticated using (operative_id = public.ts_operative_id());

-- ---------------------------------------------------------------------------
-- 3. Functions
-- ---------------------------------------------------------------------------

-- 'submitted', 'reopened', or nothing, for the week a date falls in.
-- Internal: not callable from the app.
create function public.ts_week_status(p_operative uuid, p_date date)
returns text
language sql stable security definer set search_path = ''
as $$
  select w.status from public.timesheet_weeks w
   where w.operative_id = p_operative
     and w.week_start = (date_trunc('week', p_date::timestamp))::date;
$$;

-- May the signed-in operative write this entry? Their own, set-up finished,
-- add-on on, no future dates, never in a submitted week, and either in the
-- usual window (from ts_earliest_date) or in a week the owner reopened.
create or replace function public.ts_may_write(p_operative uuid, p_owner uuid, p_date date)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.timesheet_operatives o
     where o.id = p_operative
       and o.owner_id = p_owner
       and o.user_id = auth.uid()
       and o.status = 'active'
       and public.ts_addon_active(o.owner_id)
       and p_date <= public.ts_today()
       and coalesce(public.ts_week_status(p_operative, p_date), '') <> 'submitted'
       and (p_date >= public.ts_earliest_date()
            or public.ts_week_status(p_operative, p_date) = 'reopened')
  );
$$;

-- An operative submits one of their weeks (a Monday, this week or earlier).
-- Submitting it again changes nothing.
create function public.timesheet_submit_week(p_week_start date)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me  public.timesheet_operatives%rowtype;
  wk  public.timesheet_weeks%rowtype;
begin
  select * into me from public.timesheet_operatives o
   where o.user_id = auth.uid() and o.status = 'active' and public.ts_addon_active(o.owner_id);
  if not found then
    raise exception 'TS_NOT_OPERATIVE' using errcode = 'P0001';
  end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception 'TS_NOT_A_MONDAY' using errcode = 'P0001';
  end if;
  if p_week_start > public.ts_week_start() then
    raise exception 'TS_WEEK_NOT_STARTED' using errcode = 'P0001';
  end if;

  insert into public.timesheet_weeks as w
    (owner_id, operative_id, week_start, status, submitted_at, submitted_by, updated_at)
  values (me.owner_id, me.id, p_week_start, 'submitted', now(), auth.uid(), now())
  on conflict (operative_id, week_start) do update
     set status = 'submitted', submitted_at = now(), submitted_by = auth.uid(), updated_at = now()
   where w.status <> 'submitted';

  select * into wk from public.timesheet_weeks w
   where w.operative_id = me.id and w.week_start = p_week_start;
  return jsonb_build_object('week_start', wk.week_start, 'status', wk.status,
                            'submitted_at', wk.submitted_at, 'reopened_at', wk.reopened_at);
end;
$$;

-- The owner reopens one of their operative's submitted weeks.
create function public.timesheet_reopen_week(p_operative uuid, p_week_start date)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  wk  public.timesheet_weeks%rowtype;
begin
  if not public.ts_addon_active(auth.uid()) then
    raise exception 'TS_NO_ADDON' using errcode = 'P0001';
  end if;
  update public.timesheet_weeks w
     set status = 'reopened', reopened_at = now(), reopened_by = auth.uid(), updated_at = now()
   where w.operative_id = p_operative
     and w.week_start = p_week_start
     and w.owner_id = auth.uid()
     and w.status = 'submitted'
  returning * into wk;
  if not found then
    raise exception 'TS_WEEK_NOT_SUBMITTED' using errcode = 'P0001';
  end if;
  return jsonb_build_object('week_start', wk.week_start, 'status', wk.status,
                            'submitted_at', wk.submitted_at, 'reopened_at', wk.reopened_at);
end;
$$;

revoke all on function public.ts_week_status(uuid, date)            from public, anon, authenticated;
revoke all on function public.timesheet_submit_week(date)           from public, anon;
revoke all on function public.timesheet_reopen_week(uuid, date)     from public, anon;
grant execute on function public.timesheet_submit_week(date)        to authenticated;
grant execute on function public.timesheet_reopen_week(uuid, date)  to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Self-check: undo everything unless it all came out right
-- ---------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  before_entries bigint;
  before_minutes bigint;
begin
  select entries, minutes into before_entries, before_minutes from ts_week_before;
  if (select count(*) from public.timesheet_entries) <> before_entries
     or (select coalesce(sum(minutes), 0) from public.timesheet_entries) <> before_minutes then
    problems := array_append(problems, 'the entries changed');
  end if;

  if not (select c.relrowsecurity and not c.relforcerowsecurity
            from pg_catalog.pg_class c where c.oid = 'public.timesheet_weeks'::regclass) then
    problems := array_append(problems, 'security switch wrong on timesheet_weeks');
  end if;
  if has_table_privilege('anon', 'public.timesheet_weeks', 'select, insert, update, delete') then
    problems := array_append(problems, 'anonymous visitors have access to timesheet_weeks');
  end if;
  if has_table_privilege('authenticated', 'public.timesheet_weeks', 'insert, update, delete') then
    problems := array_append(problems, 'the app can write timesheet_weeks directly');
  end if;
  if has_function_privilege('authenticated', 'public.ts_week_status(uuid, date)', 'execute') then
    problems := array_append(problems, 'the app can call ts_week_status');
  end if;
  if (select count(*) from pg_catalog.pg_policies
       where schemaname = 'public'
         and tablename in ('addon_entitlements', 'timesheet_operatives', 'timesheet_work_types',
                           'timesheet_jobs', 'timesheet_entries', 'timesheet_entry_changes',
                           'timesheet_weeks')) <> 18 then
    problems := array_append(problems, 'expected 18 rules');
  end if;
  if (select count(*) from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname ~ '^(ts_|timesheets?_)') <> 18 then
    problems := array_append(problems, 'expected 18 functions');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception 'Timesheets week self-check failed: %. Nothing was applied.', array_to_string(problems, '; ');
  end if;
end;
$$;

commit;

-- ============================================================================
-- CHECK (counts only). Expect one row: weeks_table 1, rules 18, functions 18,
-- note_optional true, submitted_weeks 0. entries is how many timesheet
-- entries there are: the same number as before you ran this.
-- ============================================================================
select
  (select count(*) from pg_catalog.pg_class c
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'timesheet_weeks' and c.relkind = 'r') as weeks_table,
  (select count(*) from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in ('addon_entitlements', 'timesheet_operatives', 'timesheet_work_types',
                        'timesheet_jobs', 'timesheet_entries', 'timesheet_entry_changes',
                        'timesheet_weeks')) as rules,
  (select count(*) from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname ~ '^(ts_|timesheets?_)') as functions,
  (select a.attnotnull = false from pg_catalog.pg_attribute a
    where a.attrelid = 'public.timesheet_entries'::regclass and a.attname = 'description') as note_optional,
  (select count(*) from public.timesheet_weeks) as submitted_weeks,
  (select count(*) from public.timesheet_entries) as entries;
