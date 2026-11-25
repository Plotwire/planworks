-- ============================================================================
-- Timesheets add-on test: accounts WITHOUT the add-on get nothing
-- ----------------------------------------------------------------------------
-- Run in the Supabase SQL editor, after supabase/timesheets.sql (and, if it's
-- been run, supabase/timesheets-week.sql; the week checks are skipped if not).
--
-- Like the other Timesheets tests: it creates pretend accounts and data, tries
-- what each account can do, then ends with a DELIBERATE error that cancels
-- the whole test, so nothing it created is saved. It pretends today is
-- Wednesday 25 November 2026; that is cancelled too.
--
-- The pretend accounts:
--   boss    has the add-on, with a worker, a job, an entry and a submitted week
--           (so there is something for the others NOT to see)
--   four accounts without it, each tried in turn:
--     - an ordinary account (no subscription: Try mode)
--     - a billing-exempt account
--     - an account with a paid subscription (skipped if the test can't make one)
--     - an account whose add-on has ended
--
-- For each: the app is told the add-on is off; the drop-down lists are empty;
-- none of the boss's jobs, work types, team, entries, history or weeks can be
-- read; nothing can be added, changed or deleted; the add-on list can't be
-- read or written; and every Timesheets function refuses.
--
-- Expect a red message starting "TEST FINISHED:" with "0 failed". Any other
-- message means the test itself stopped; that is also fully cancelled.
-- ============================================================================
do $test$
declare
  boss    uuid := gen_random_uuid();
  normal  uuid := gen_random_uuid();
  exempt  uuid := gen_random_uuid();
  paying  uuid := gen_random_uuid();
  lapsed  uuid := gen_random_uuid();
  worker  uuid := gen_random_uuid();
  op uuid; wt uuid; job uuid; entry uuid;
  accounts uuid[];
  labels   text[];
  who uuid; lbl text; i integer;
  res jsonb; n integer;
  have_weeks boolean := to_regclass('public.timesheet_weeks') is not null;
  have_paying boolean := false;
  p integer := 0;
  f text[] := '{}';
begin
  -- ------------------------------------------- pretend Wednesday 25 Nov 2026
  create or replace function public.ts_today() returns date
    language sql stable set search_path = ''
    as $clock$ select date '2026-11-25'; $clock$;

  -- ------------------------------------------------------------------ setup
  insert into auth.users (id, email, email_confirmed_at)
  select u, 'tsa-test-' || u::text || '@example.invalid', now()
    from unnest(array[boss, normal, exempt, paying, lapsed, worker]) as u;

  insert into public.addon_entitlements (user_id, addon, note) values (boss, 'timesheets', 'test');
  insert into public.addon_entitlements (user_id, addon, note, ends_at)
  values (lapsed, 'timesheets', 'test', now() - interval '1 day');

  if to_regclass('public.billing_exempt') is not null then
    execute 'insert into public.billing_exempt (user_id, note) values ($1, $2)' using exempt, 'test';
  end if;
  begin
    execute 'insert into public.subscriptions (user_id, status, plan) values ($1, $2, $3)' using paying, 'active', 'test';
    have_paying := true;
  exception when others then
    have_paying := false;
  end;

  insert into public.timesheet_operatives (owner_id, name, email, user_id, status)
  values (boss, 'Test Worker', 'tsa-worker@example.invalid', worker, 'active') returning id into op;
  select id into wt from public.timesheet_work_types where owner_id = boss order by sort_order limit 1;
  insert into public.timesheet_jobs (owner_id, job_number, job_name)
  values (boss, '901', 'Test job') returning id into job;

  perform set_config('role', 'authenticated', true);

  -- The boss's worker records a day and (if the week feature is in) submits.
  perform set_config('request.jwt.claims', json_build_object('sub', worker)::text, true);
  insert into public.timesheet_entries (work_date, job_id, work_type_id, start_time, finish_time, description)
  values (date '2026-11-25', job, wt, '08:00', '16:00', 'Test') returning id into entry;
  if have_weeks then
    perform public.timesheet_submit_week(date '2026-11-23');
  end if;

  -- --------------------------------------------- the accounts without it
  accounts := array[normal, exempt, lapsed];
  labels   := array['an ordinary account (Try mode)', 'a billing-exempt account', 'an account whose add-on has ended'];
  if have_paying then
    accounts := accounts || paying;
    labels   := labels || 'an account with a paid subscription'::text;
  end if;

  for i in 1 .. array_length(accounts, 1) loop
    who := accounts[i];
    lbl := labels[i];
    perform set_config('request.jwt.claims', json_build_object('sub', who)::text, true);

    -- The app is told: an owner, add-on off.
    res := public.timesheets_context();
    if res ->> 'role' = 'owner' and (res ->> 'addon')::boolean = false
    then p := p + 1; else f := array_append(f, lbl || ': is told the add-on is off'); end if;

    if public.ts_i_have_addon() = false
    then p := p + 1; else f := array_append(f, lbl || ': has no add-on'); end if;

    res := public.timesheets_pick_lists();
    if jsonb_array_length(res -> 'jobs') = 0 and jsonb_array_length(res -> 'work_types') = 0
    then p := p + 1; else f := array_append(f, lbl || ': gets empty drop-down lists'); end if;

    -- Can read nothing that isn't theirs. (An ended add-on still owns its own
    -- old records, so only other accounts' rows are counted.)
    if (select count(*) from public.timesheet_jobs where owner_id <> who) = 0
       and (select count(*) from public.timesheet_work_types where owner_id <> who) = 0
       and (select count(*) from public.timesheet_operatives where owner_id <> who) = 0
       and (select count(*) from public.timesheet_entries where owner_id <> who) = 0
       and (select count(*) from public.timesheet_entry_changes where owner_id <> who) = 0
    then p := p + 1; else f := array_append(f, lbl || ': reads none of another account''s Timesheets'); end if;

    if have_weeks then
      execute 'select count(*) from public.timesheet_weeks where owner_id <> $1' into n using who;
      if n = 0 then p := p + 1; else f := array_append(f, lbl || ': reads none of another account''s weeks'); end if;
    end if;

    -- Can add nothing.
    begin
      insert into public.timesheet_jobs (owner_id, job_number, job_name) values (who, '1', 'Nope');
      f := array_append(f, lbl || ': cannot add a job');
    exception when insufficient_privilege then p := p + 1; end;

    begin
      insert into public.timesheet_work_types (owner_id, name) values (who, 'Nope');
      f := array_append(f, lbl || ': cannot add a work type');
    exception when insufficient_privilege then p := p + 1; end;

    begin
      insert into public.timesheet_entries (owner_id, operative_id, work_date, job_id, work_type_id, start_time, finish_time, description)
      values (who, op, date '2026-11-25', job, wt, '08:00', '09:00', 'Nope');
      f := array_append(f, lbl || ': cannot add an entry');
    exception when insufficient_privilege or raise_exception then p := p + 1; end;

    -- Can change or delete nothing of the boss's.
    update public.timesheet_jobs set job_name = 'Changed' where id = job;
    get diagnostics n = row_count;
    if n = 0 then p := p + 1; else f := array_append(f, lbl || ': cannot change another account''s job'); end if;

    delete from public.timesheet_entries where id = entry;
    get diagnostics n = row_count;
    if n = 0 then p := p + 1; else f := array_append(f, lbl || ': cannot delete another account''s entry'); end if;

    -- Can't see who has the add-on, or give it to themselves.
    begin
      select count(*) into n from public.addon_entitlements;
      if n = 0 then p := p + 1; else f := array_append(f, lbl || ': cannot read the add-on list'); end if;
    exception when insufficient_privilege then p := p + 1; end;

    begin
      insert into public.addon_entitlements (user_id, addon) values (who, 'timesheets');
      f := array_append(f, lbl || ': cannot switch the add-on on');
    exception when insufficient_privilege then p := p + 1; end;

    -- Every Timesheets function refuses.
    begin
      perform public.timesheet_activate('test');
      f := array_append(f, lbl || ': cannot act as a worker');
    exception when raise_exception then
      if sqlerrm = 'TS_NOT_OPERATIVE' then p := p + 1; else f := array_append(f, lbl || ': wrong refusal: ' || sqlerrm); end if;
    end;

    if have_weeks then
      begin
        perform public.timesheet_submit_week(date '2026-11-23');
        f := array_append(f, lbl || ': cannot submit a week');
      exception when raise_exception then
        if sqlerrm = 'TS_NOT_OPERATIVE' then p := p + 1; else f := array_append(f, lbl || ': wrong refusal: ' || sqlerrm); end if;
      end;

      begin
        perform public.timesheet_reopen_week(op, date '2026-11-23');
        f := array_append(f, lbl || ': cannot reopen a week');
      exception when raise_exception then
        if sqlerrm = 'TS_NO_ADDON' then p := p + 1; else f := array_append(f, lbl || ': wrong refusal: ' || sqlerrm); end if;
      end;
    end if;
  end loop;

  -- --------------------------------------- and the boss, who has the add-on
  -- (proves the checks above found something to hide)
  perform set_config('request.jwt.claims', json_build_object('sub', boss)::text, true);
  if public.ts_i_have_addon()
     and (select count(*) from public.timesheet_jobs where id = job) = 1
     and (select count(*) from public.timesheet_entries where id = entry) = 1
  then p := p + 1; else f := array_append(f, 'the account with the add-on sees its own Timesheets'); end if;

  -- ------------------------------------------------------- report and cancel
  raise exception 'TEST FINISHED: % passed, % failed. Paid-subscription account: %. Failed checks: %.',
    p, coalesce(array_length(f, 1), 0),
    case when have_paying then 'tested' else 'skipped (could not make one here)' end,
    coalesce(nullif(array_to_string(f, '; '), ''), 'none');
end;
$test$;
