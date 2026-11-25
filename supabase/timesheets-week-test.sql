-- ============================================================================
-- Timesheets week test: two workers, submit and reopen, and what a worker
-- can never see
-- ----------------------------------------------------------------------------
-- Run AFTER supabase/timesheets-week.sql, in the Supabase SQL editor.
--
-- Like supabase/timesheets-test.sql: it creates pretend accounts (two firms,
-- two workers at firm A, one at firm B) and pretend data, tries what each
-- person should and shouldn't be able to do, then ends with a DELIBERATE
-- error. That error cancels the whole test, so nothing it created is saved.
-- It pretends today is Wednesday 25 November 2026 (and later Tuesday
-- 1 December) by briefly swapping the date function; that is cancelled too.
--
-- Expect a red message starting "TEST FINISHED:" with "0 failed". Any other
-- message means the test itself stopped; that is also fully cancelled.
-- ============================================================================
do $test$
declare
  owner_a  uuid := gen_random_uuid();
  owner_b  uuid := gen_random_uuid();
  login_a1 uuid := gen_random_uuid();   -- worker 1 at firm A
  login_a2 uuid := gen_random_uuid();   -- worker 2 at firm A
  login_b1 uuid := gen_random_uuid();   -- a worker at firm B
  op_a1 uuid; op_a2 uuid; op_b1 uuid;
  wt_a uuid; wt_b uuid;
  job_a uuid; job_a2 uuid; job_b uuid;
  e1 uuid; e1b uuid; e2 uuid; forced uuid;
  monday date := date '2026-11-23';
  wed    date := date '2026-11-25';
  res    jsonb;
  who    uuid;
  n      integer;
  t      text;
  have_drawing boolean := false;
  p      integer := 0;
  f      text[] := '{}';
begin
  -- ------------------------------------------- pretend Wednesday 25 Nov 2026
  create or replace function public.ts_today() returns date
    language sql stable set search_path = ''
    as $clock$ select date '2026-11-25'; $clock$;

  -- ------------------------------------------------------------------ setup
  insert into auth.users (id, email, email_confirmed_at)
  select u, 'tsw-test-' || u::text || '@example.invalid', now()
    from unnest(array[owner_a, owner_b, login_a1, login_a2, login_b1]) as u;

  insert into public.addon_entitlements (user_id, addon, note)
  values (owner_a, 'timesheets', 'test'), (owner_b, 'timesheets', 'test');

  insert into public.timesheet_operatives (owner_id, name, email, user_id, status)
  values (owner_a, 'Worker One', 'w1@example.invalid', login_a1, 'active') returning id into op_a1;
  insert into public.timesheet_operatives (owner_id, name, email, user_id, status)
  values (owner_a, 'Worker Two', 'w2@example.invalid', login_a2, 'active') returning id into op_a2;
  insert into public.timesheet_operatives (owner_id, name, email, user_id, status)
  values (owner_b, 'Other Firm', 'b1@example.invalid', login_b1, 'active') returning id into op_b1;

  select id into wt_a from public.timesheet_work_types where owner_id = owner_a and name = 'Price work';
  select id into wt_b from public.timesheet_work_types where owner_id = owner_b and name = 'Price work';

  insert into public.timesheet_jobs (owner_id, job_number, job_name, site_address)
  values (owner_a, '001', 'Smith, Driffield', '1 Test Road') returning id into job_a;
  insert into public.timesheet_jobs (owner_id, job_number, job_name)
  values (owner_a, '002', 'Jones, Beverley') returning id into job_a2;
  insert into public.timesheet_jobs (owner_id, job_number, job_name)
  values (owner_b, '001', 'B job') returning id into job_b;

  -- A drawing for firm A's owner, so the "can't see drawings" check has
  -- something to find. If this database won't take a bare test drawing, the
  -- check still runs against every drawing already there.
  begin
    insert into public.projects (user_id, name, data) values (owner_a, 'TEST drawing', '{}'::jsonb);
    have_drawing := true;
  exception when others then
    have_drawing := false;
  end;

  perform set_config('role', 'authenticated', true);

  -- ----------------------------------------------------- worker 1, firm A
  perform set_config('request.jwt.claims', json_build_object('sub', login_a1)::text, true);

  insert into public.timesheet_entries (work_date, job_id, work_type_id, start_time, finish_time)
  values (wed, job_a, wt_a, '07:30', '12:00') returning id into e1;
  if e1 is not null and (select description from public.timesheet_entries where id = e1) is null
  then p := p + 1; else f := array_append(f, 'a note is optional'); end if;

  if (select minutes from public.timesheet_entries where id = e1) = 270
  then p := p + 1; else f := array_append(f, 'hours are worked out from start and finish'); end if;

  insert into public.timesheet_entries (work_date, job_id, work_type_id, start_time, finish_time, description)
  values (wed, job_a2, wt_a, '12:30', '16:00', 'Moved to Beverley') returning id into e1b;
  if e1b is not null
  then p := p + 1; else f := array_append(f, 'a second job on the same day'); end if;

  begin
    insert into public.timesheet_entries (work_date, job_id, work_type_id, start_time, finish_time, description)
    values (wed, job_a, wt_a, '16:00', '17:00', '   ');
    f := array_append(f, 'a note that is only spaces is refused');
  exception when check_violation then p := p + 1; end;

  begin
    insert into public.timesheet_entries (work_date, job_id, work_type_id, start_time, finish_time, description)
    values (wed, job_a, wt_a, '16:00', '17:00', repeat('x', 151));
    f := array_append(f, 'a note is at most 150 characters');
  exception when check_violation then p := p + 1; end;

  begin
    insert into public.timesheet_entries (work_date, job_id, work_type_id, start_time, finish_time)
    values (wed + 1, job_a, wt_a, '08:00', '16:00');
    f := array_append(f, 'no future dates');
  exception when insufficient_privilege then p := p + 1; end;

  -- ----------------------------------------------------- worker 2, firm A
  perform set_config('request.jwt.claims', json_build_object('sub', login_a2)::text, true);

  insert into public.timesheet_entries (work_date, job_id, work_type_id, start_time, finish_time)
  values (wed, job_a, wt_a, '08:00', '16:30') returning id into e2;

  if (select count(*) from public.timesheet_entries) = 1
  then p := p + 1; else f := array_append(f, 'worker 2 sees only their own entries'); end if;

  update public.timesheet_entries set start_time = '06:00' where id = e1;
  get diagnostics n = row_count;
  if n = 0 then p := p + 1; else f := array_append(f, 'worker 2 cannot change worker 1''s entry'); end if;

  delete from public.timesheet_entries where id = e1;
  get diagnostics n = row_count;
  if n = 0 then p := p + 1; else f := array_append(f, 'worker 2 cannot delete worker 1''s entry'); end if;

  insert into public.timesheet_entries (operative_id, work_date, job_id, work_type_id, start_time, finish_time)
  values (op_a1, wed, job_a, wt_a, '17:00', '18:00') returning id into forced;
  select operative_id into who from public.timesheet_entries where id = forced;
  if who = op_a2
  then p := p + 1; else f := array_append(f, 'worker 2 cannot add an entry as worker 1'); end if;
  delete from public.timesheet_entries where id = forced;

  if (select count(*) from public.timesheet_jobs) = 0
     and (select count(*) from public.timesheet_work_types) = 0
     and (select count(*) from public.timesheet_operatives) = 0
     and (select count(*) from public.timesheet_entry_changes) = 0
  then p := p + 1; else f := array_append(f, 'a worker cannot read the firm''s lists, team or history directly'); end if;

  if jsonb_array_length(public.timesheets_pick_lists() -> 'jobs') = 2
  then p := p + 1; else f := array_append(f, 'a worker gets their firm''s jobs for the drop-down'); end if;

  -- Never drawings, quotes, settings, business details or billing. Every row
  -- already in these tables counts: a worker must see none of them.
  foreach t in array array['projects', 'sketches', 'user_settings', 'company_profile', 'company_logos',
                           'subscriptions', 'billing_exempt', 'billing_test_accounts', 'terms_acceptances',
                           'planner_jobs', 'planner_settings'] loop
    if to_regclass('public.' || t) is not null then
      begin
        execute format('select count(*) from public.%I', t) into n;
        if n = 0 then p := p + 1;
        else f := array_append(f, format('a worker sees nothing in %s (saw %s)', t, n)); end if;
      exception when insufficient_privilege then p := p + 1;
      end;
    end if;
  end loop;
  if have_drawing then p := p + 1; end if;   -- the test drawing existed and stayed hidden

  -- ---------------------------------------------------------- firm B worker
  perform set_config('request.jwt.claims', json_build_object('sub', login_b1)::text, true);
  if (select count(*) from public.timesheet_entries) = 0
     and jsonb_array_length(public.timesheets_pick_lists() -> 'jobs') = 1
  then p := p + 1; else f := array_append(f, 'a worker at another firm sees none of firm A'); end if;

  -- --------------------------------------------------- worker 1 submits
  perform set_config('request.jwt.claims', json_build_object('sub', login_a1)::text, true);
  res := public.timesheet_submit_week(monday);
  if res ->> 'status' = 'submitted'
  then p := p + 1; else f := array_append(f, 'a worker submits their week'); end if;

  begin
    insert into public.timesheet_entries (work_date, job_id, work_type_id, start_time, finish_time)
    values (monday, job_a, wt_a, '08:00', '16:00');
    f := array_append(f, 'a submitted week takes no new entries');
  exception when insufficient_privilege then p := p + 1; end;

  update public.timesheet_entries set finish_time = '13:00' where id = e1;
  get diagnostics n = row_count;
  if n = 0 then p := p + 1; else f := array_append(f, 'a submitted week cannot be changed'); end if;

  delete from public.timesheet_entries where id = e1;
  get diagnostics n = row_count;
  if n = 0 then p := p + 1; else f := array_append(f, 'a submitted week cannot be deleted from'); end if;

  res := public.timesheet_submit_week(monday);
  if res ->> 'status' = 'submitted'
  then p := p + 1; else f := array_append(f, 'submitting twice changes nothing'); end if;

  begin
    perform public.timesheet_submit_week(monday + 7);
    f := array_append(f, 'next week cannot be submitted yet');
  exception when raise_exception then
    if sqlerrm = 'TS_WEEK_NOT_STARTED' then p := p + 1; else f := array_append(f, 'wrong refusal: ' || sqlerrm); end if;
  end;

  begin
    perform public.timesheet_submit_week(monday + 1);
    f := array_append(f, 'a week starts on a Monday');
  exception when raise_exception then
    if sqlerrm = 'TS_NOT_A_MONDAY' then p := p + 1; else f := array_append(f, 'wrong refusal: ' || sqlerrm); end if;
  end;

  begin
    perform public.timesheet_reopen_week(op_a1, monday);
    f := array_append(f, 'a worker cannot reopen their own week');
  exception when raise_exception then
    if sqlerrm = 'TS_NO_ADDON' then p := p + 1; else f := array_append(f, 'wrong refusal: ' || sqlerrm); end if;
  end;

  begin
    update public.timesheet_weeks set status = 'reopened';
    f := array_append(f, 'a worker cannot change the week record directly');
  exception when insufficient_privilege then p := p + 1; end;

  if (select count(*) from public.timesheet_weeks) = 1
  then p := p + 1; else f := array_append(f, 'a worker sees their own submitted week'); end if;

  -- ------------------------------------------ worker 2's week is still open
  perform set_config('request.jwt.claims', json_build_object('sub', login_a2)::text, true);
  if (select count(*) from public.timesheet_weeks) = 0
  then p := p + 1; else f := array_append(f, 'worker 2 cannot see worker 1''s week'); end if;

  insert into public.timesheet_entries (work_date, job_id, work_type_id, start_time, finish_time)
  values (monday, job_a, wt_a, '08:00', '16:00');
  p := p + 1;   -- one worker submitting doesn't lock another

  -- ------------------------------------------------------ the other firm
  perform set_config('request.jwt.claims', json_build_object('sub', owner_b)::text, true);
  begin
    perform public.timesheet_reopen_week(op_a1, monday);
    f := array_append(f, 'another firm cannot reopen this firm''s week');
  exception when raise_exception then
    if sqlerrm = 'TS_WEEK_NOT_SUBMITTED' then p := p + 1; else f := array_append(f, 'wrong refusal: ' || sqlerrm); end if;
  end;
  if (select count(*) from public.timesheet_weeks) = 0
     and (select count(*) from public.timesheet_entries where owner_id = owner_a) = 0
  then p := p + 1; else f := array_append(f, 'another firm sees none of this firm''s weeks or entries'); end if;

  -- -------------------------------------------------------------- the boss
  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);
  if (select count(distinct operative_id) from public.timesheet_entries) = 2
     and (select count(*) from public.timesheet_weeks) = 1
  then p := p + 1; else f := array_append(f, 'the boss sees both workers'' entries and the submitted week'); end if;

  update public.timesheet_entries set description = 'Boss correction' where id = e1;
  get diagnostics n = row_count;
  if n = 1 then p := p + 1; else f := array_append(f, 'the boss can still correct a submitted week'); end if;

  begin
    perform public.timesheet_reopen_week(op_a2, monday);
    f := array_append(f, 'a week that was never submitted cannot be reopened');
  exception when raise_exception then
    if sqlerrm = 'TS_WEEK_NOT_SUBMITTED' then p := p + 1; else f := array_append(f, 'wrong refusal: ' || sqlerrm); end if;
  end;

  res := public.timesheet_reopen_week(op_a1, monday);
  if res ->> 'status' = 'reopened'
  then p := p + 1; else f := array_append(f, 'the boss reopens a submitted week'); end if;

  -- ------------------------------------------- worker 1 can edit again
  perform set_config('request.jwt.claims', json_build_object('sub', login_a1)::text, true);
  update public.timesheet_entries set description = 'After reopening' where id = e1;
  get diagnostics n = row_count;
  if n = 1 then p := p + 1; else f := array_append(f, 'a reopened week can be edited'); end if;

  -- --------------------------------- pretend Tuesday 1 December: next week
  perform set_config('role', 'none', true);
  create or replace function public.ts_today() returns date
    language sql stable set search_path = ''
    as $clock$ select date '2026-12-01'; $clock$;
  perform set_config('role', 'authenticated', true);

  perform set_config('request.jwt.claims', json_build_object('sub', login_a1)::text, true);
  update public.timesheet_entries set description = 'Late fix' where id = e1;
  get diagnostics n = row_count;
  if n = 1 then p := p + 1; else f := array_append(f, 'a reopened older week stays editable'); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', login_a2)::text, true);
  update public.timesheet_entries set start_time = '07:00' where id = e2;
  get diagnostics n = row_count;
  if n = 0 then p := p + 1; else f := array_append(f, 'an older week that wasn''t reopened stays closed'); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', login_a1)::text, true);
  res := public.timesheet_submit_week(monday);
  update public.timesheet_entries set description = 'Too late' where id = e1;
  get diagnostics n = row_count;
  if res ->> 'status' = 'submitted' and n = 0
  then p := p + 1; else f := array_append(f, 'submitting a reopened week locks it again'); end if;

  -- ------------------------------------------------------- report and cancel
  raise exception 'TEST FINISHED: % passed, % failed. Failed checks: %.',
    p, coalesce(array_length(f, 1), 0), coalesce(nullif(array_to_string(f, '; '), ''), 'none');
end;
$test$;
