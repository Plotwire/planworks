-- ============================================================================
-- Timesheets Batch 1 test
-- ----------------------------------------------------------------------------
-- Creates pretend accounts and data, tries what each person should and
-- shouldn't be able to do, then ends with a DELIBERATE error. That error is
-- what cancels the whole test, so nothing it created is saved. To test Mondays
-- and Tuesdays on any day, it briefly swaps the date function for a pretend
-- date. That swap is cancelled with everything else.
--
-- Expect a red message starting "TEST FINISHED:". Any other message means the
-- test itself stopped; that is also fully cancelled.
-- ============================================================================
do $test$
declare
  owner_a  uuid := gen_random_uuid();
  owner_b  uuid := gen_random_uuid();
  owner_c  uuid := gen_random_uuid();   -- has no add-on
  login_a1 uuid := gen_random_uuid();
  login_a2 uuid := gen_random_uuid();
  login_a3 uuid := gen_random_uuid();   -- invited, set-up not finished
  login_b1 uuid := gen_random_uuid();
  op_a1 uuid; op_a2 uuid; op_a3 uuid; op_b1 uuid;
  wt_a uuid; wt_a2 uuid; wt_b uuid;
  job_a uuid; job_old uuid; job_b uuid;
  entry1 uuid; entry2 uuid; entry3 uuid; entry_old uuid;
  today  date := public.ts_today();
  monday date := public.ts_week_start();
  earliest date := public.ts_earliest_date();
  real_tz text := current_setting('timezone');
  e_last_mon uuid; e_last_sun uuid; e_this_mon uuid;
  lists  jsonb;
  r      public.timesheet_entries%rowtype;
  h      public.timesheet_entry_changes%rowtype;
  n      integer;
  p      integer := 0;
  f      text[] := '{}';
begin
  -- ------------------------------------------------------------------ setup
  insert into auth.users (id, email, email_confirmed_at)
  select u, 'ts-test-' || u::text || '@example.invalid', now()
    from unnest(array[owner_a, owner_b, owner_c, login_a1, login_a2, login_a3, login_b1]) as u;

  insert into public.addon_entitlements (user_id, addon, note)
  values (owner_a, 'timesheets', 'test'), (owner_b, 'timesheets', 'test');

  insert into public.company_profile (user_id, company_name) values (owner_a, 'Test Co');

  insert into public.timesheet_operatives (owner_id, name, email, user_id, status)
  values (owner_a, 'A One', 'a1@example.invalid', login_a1, 'active') returning id into op_a1;
  insert into public.timesheet_operatives (owner_id, name, email, user_id, status)
  values (owner_a, 'A Two', 'a2@example.invalid', login_a2, 'active') returning id into op_a2;
  insert into public.timesheet_operatives (owner_id, name, email, user_id, status)
  values (owner_a, 'A Three', 'a3@example.invalid', login_a3, 'invited') returning id into op_a3;
  insert into public.timesheet_operatives (owner_id, name, email, user_id, status)
  values (owner_b, 'B One', 'b1@example.invalid', login_b1, 'active') returning id into op_b1;

  select id into wt_a  from public.timesheet_work_types where owner_id = owner_a and name = 'Price work';
  select id into wt_a2 from public.timesheet_work_types where owner_id = owner_a and name = 'Day work';
  select id into wt_b  from public.timesheet_work_types where owner_id = owner_b and name = 'Price work';

  if wt_a is not null and wt_a2 is not null and wt_b is not null
     and (select count(*) from public.timesheet_work_types where owner_id = owner_a) = 4
  then p := p + 1; else f := array_append(f, 'starter work types added'); end if;

  perform set_config('role', 'authenticated', true);

  -- ---------------------------------------------------------------- owners
  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);
  insert into public.timesheet_jobs (owner_id, job_number, job_name, site_address, default_work_type_id)
  values (owner_a, '001', 'Test job', '1 Test Road', wt_a) returning id into job_a;
  insert into public.timesheet_jobs (owner_id, job_number, job_name, status)
  values (owner_a, '002', 'Archived job', 'archived') returning id into job_old;

  begin
    insert into public.timesheet_jobs (owner_id, job_number, job_name) values (owner_a, '001', 'Duplicate');
    f := array_append(f, 'duplicate job number refused');
  exception when unique_violation then p := p + 1; end;

  begin
    insert into public.timesheet_jobs (owner_id, job_number, job_name) values (owner_b, '900', 'Cross account');
    f := array_append(f, 'owner cannot add a job to another account');
  exception when insufficient_privilege then p := p + 1; end;

  if (select count(*) from public.timesheet_operatives) = 3
  then p := p + 1; else f := array_append(f, 'owner sees whole team'); end if;

  begin
    update public.timesheet_operatives set name = 'Changed';
    f := array_append(f, 'owner cannot change team directly');
  exception when insufficient_privilege then p := p + 1; end;

  begin
    insert into public.addon_entitlements (user_id, addon) values (owner_c, 'timesheets');
    f := array_append(f, 'cannot give an account the add-on');
  exception when insufficient_privilege then p := p + 1; end;

  begin
    perform public.ts_addon_active(owner_b);
    f := array_append(f, 'internal add-on check not callable');
  exception when insufficient_privilege then p := p + 1; end;

  begin
    delete from public.timesheet_jobs where id = job_a;
    f := array_append(f, 'jobs cannot be deleted from the app');
  exception when insufficient_privilege then p := p + 1; end;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_b)::text, true);
  insert into public.timesheet_jobs (owner_id, job_number, job_name, default_work_type_id)
  values (owner_b, '001', 'B job', wt_b) returning id into job_b;

  if (select count(*) from public.timesheet_jobs) = 1
     and (select count(*) from public.timesheet_work_types) = 4
     and (select count(*) from public.timesheet_operatives) = 1
  then p := p + 1; else f := array_append(f, 'owner B sees only their own lists'); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_c)::text, true);
  begin
    insert into public.timesheet_jobs (owner_id, job_number, job_name) values (owner_c, '001', 'No add-on');
    f := array_append(f, 'account without the add-on cannot add jobs');
  exception when insufficient_privilege then p := p + 1; end;

  -- ----------------------------------------------------------- operative A1
  perform set_config('request.jwt.claims', json_build_object('sub', login_a1)::text, true);

  if (select count(*) from public.timesheet_jobs) = 0
     and (select count(*) from public.timesheet_work_types) = 0
     and (select count(*) from public.timesheet_operatives) = 0
  then p := p + 1; else f := array_append(f, 'operative cannot read Timesheets tables directly'); end if;

  begin
    perform 1 from public.addon_entitlements;
    f := array_append(f, 'operative cannot read the add-on table');
  exception when insufficient_privilege then p := p + 1; end;

  if (select count(*) from public.projects) = 0
     and (select count(*) from public.sketches) = 0
     and (select count(*) from public.planner_jobs) = 0
     and (select count(*) from public.planner_settings) = 0
     and (select count(*) from public.company_profile) = 0
     and (select count(*) from public.subscriptions) = 0
  then p := p + 1; else f := array_append(f, 'operative sees nothing else in the app'); end if;

  lists := public.timesheets_pick_lists();
  if jsonb_array_length(lists -> 'jobs') = 1
     and (lists -> 'jobs' -> 0 ->> 'job_number') = '001'
     and jsonb_array_length(lists -> 'work_types') = 4
     and (select array_agg(k order by k) from jsonb_object_keys(lists -> 'jobs' -> 0) as k)
         = array['default_work_type_id', 'id', 'job_name', 'job_number', 'site_address']
  then p := p + 1; else f := array_append(f, 'lookup gives only active jobs and listed fields'); end if;

  if (public.timesheets_context() ->> 'role') = 'operative'
     and (public.timesheets_context() ->> 'company') = 'Test Co'
  then p := p + 1; else f := array_append(f, 'context says operative, with company name'); end if;

  -- Everything forgeable is sent wrong on purpose.
  insert into public.timesheet_entries
    (owner_id, operative_id, work_date, job_id, job_number, job_name, work_type_id, work_type,
     start_time, finish_time, break_minutes, description,
     created_by, created_by_role, updated_by, updated_by_role)
  values
    (owner_b, op_a2, today, job_a, 'FORGED', 'FORGED', wt_a, 'FORGED',
     '08:00', '17:00', 30, 'Test work',
     owner_b, 'owner', owner_b, 'owner')
  returning id into entry1;

  select * into r from public.timesheet_entries where id = entry1;
  if r.owner_id = owner_a and r.operative_id = op_a1 and r.job_number = '001'
     and r.job_name = 'Test job' and r.work_type = 'Price work' and r.minutes = 510
     and r.created_by = login_a1 and r.created_by_role = 'operative'
  then p := p + 1; else f := array_append(f, 'forged fields ignored, hours correct'); end if;

  if (select count(*) from public.timesheet_entry_changes) = 0
  then p := p + 1; else f := array_append(f, 'operative cannot read the change history'); end if;

  begin
    insert into public.timesheet_entries (work_date, job_id, work_type_id, start_time, finish_time, description)
    values (earliest - 1, job_a, wt_a, '08:00', '17:00', 'Too early');
    f := array_append(f, 'operative cannot add before the earliest open date');
  exception when insufficient_privilege then p := p + 1; end;

  begin
    insert into public.timesheet_entries (work_date, job_id, work_type_id, start_time, finish_time, description)
    values (today + 1, job_a, wt_a, '08:00', '17:00', 'Future');
    f := array_append(f, 'operative cannot add a future date');
  exception when insufficient_privilege then p := p + 1; end;

  begin
    insert into public.timesheet_entries (work_date, job_id, work_type_id, start_time, finish_time, minutes, description)
    values (today, job_a, wt_a, '08:00', '17:00', 9999, 'Fake hours');
    f := array_append(f, 'hours cannot be typed in');
  exception when generated_always then p := p + 1; end;

  begin
    insert into public.timesheet_entries (work_date, job_id, work_type_id, start_time, finish_time, description)
    values (today, job_b, wt_a, '08:00', '17:00', 'Other account job');
    f := array_append(f, 'cannot use another account''s job');
  exception when raise_exception then
    if sqlerrm = 'TS_JOB_NOT_FOUND' then p := p + 1; else f := array_append(f, 'wrong refusal: ' || sqlerrm); end if;
  end;

  begin
    insert into public.timesheet_entries (work_date, job_id, work_type_id, start_time, finish_time, description)
    values (today, job_a, wt_b, '08:00', '17:00', 'Other account type');
    f := array_append(f, 'cannot use another account''s work type');
  exception when raise_exception then
    if sqlerrm = 'TS_WORK_TYPE_NOT_FOUND' then p := p + 1; else f := array_append(f, 'wrong refusal: ' || sqlerrm); end if;
  end;

  begin
    insert into public.timesheet_entries (work_date, job_id, work_type_id, start_time, finish_time, description)
    values (today, job_old, wt_a, '08:00', '17:00', 'Archived job');
    f := array_append(f, 'operative cannot pick an archived job');
  exception when raise_exception then
    if sqlerrm = 'TS_JOB_ARCHIVED' then p := p + 1; else f := array_append(f, 'wrong refusal: ' || sqlerrm); end if;
  end;

  begin
    insert into public.timesheet_entries (work_date, work_type_id, start_time, finish_time, description)
    values (today, wt_a, '08:00', '17:00', 'Other with no note');
    f := array_append(f, 'Other needs a note');
  exception when check_violation then p := p + 1; end;

  begin
    insert into public.timesheet_entries (work_date, job_id, work_type_id, start_time, finish_time, description)
    values (today, job_a, wt_a, '17:00', '08:00', 'Backwards');
    f := array_append(f, 'finish must be after start');
  exception when check_violation then p := p + 1; end;

  begin
    insert into public.timesheet_entries (work_date, job_id, work_type_id, start_time, finish_time, break_minutes, description)
    values (today, job_a, wt_a, '08:00', '09:00', 60, 'Break too long');
    f := array_append(f, 'break must be shorter than the shift');
  exception when check_violation then p := p + 1; end;

  begin
    insert into public.timesheet_entries (work_date, job_id, work_type_id, start_time, finish_time, description)
    values (today, job_a, wt_a, '08:00', '17:00', E'Two\nlines');
    f := array_append(f, 'description must be one line');
  exception when check_violation then p := p + 1; end;

  begin
    insert into public.timesheet_entries (work_date, job_id, work_type_id, start_time, finish_time, description)
    values (today, job_a, wt_a, '08:00', '17:00', E'\t');
    f := array_append(f, 'description cannot be blank');
  exception when check_violation then p := p + 1; end;

  begin
    insert into public.timesheet_entries (work_date, job_id, work_type_id, start_time, finish_time, description)
    values (today, job_a, wt_a, '08:00:20', '17:00', 'Seconds');
    f := array_append(f, 'times are whole minutes');
  exception when check_violation then p := p + 1; end;

  insert into public.timesheet_entries (work_date, other_note, work_type_id, start_time, finish_time, description)
  values (today, 'Stores run', wt_a2, '12:00', '13:00', 'Collecting cable')
  returning id into entry2;
  select * into r from public.timesheet_entries where id = entry2;
  if r.job_name = 'Other' and r.job_number is null and r.work_type = 'Day work'
  then p := p + 1; else f := array_append(f, 'Other entry saved correctly'); end if;

  update public.timesheet_entries set break_minutes = 60 where id = entry1;
  select * into r from public.timesheet_entries where id = entry1;
  if r.minutes = 480 and r.job_number = '001'
  then p := p + 1; else f := array_append(f, 'operative can edit this week, hours recalculated'); end if;

  update public.timesheet_entries
     set id = gen_random_uuid(), owner_id = owner_b, operative_id = op_a2,
         job_number = 'FORGED', job_name = 'FORGED', work_type = 'FORGED',
         created_by = owner_b, created_by_role = 'owner', updated_by = owner_b, updated_by_role = 'owner'
   where id = entry1;
  select * into r from public.timesheet_entries where id = entry1;
  if found and r.owner_id = owner_a and r.operative_id = op_a1 and r.job_number = '001'
     and r.job_name = 'Test job' and r.work_type = 'Price work'
     and r.created_by = login_a1 and r.created_by_role = 'operative'
     and r.updated_by = login_a1 and r.updated_by_role = 'operative'
  then p := p + 1; else f := array_append(f, 'forged fields ignored on edit'); end if;

  update public.timesheet_entries set other_note = 'Sneaky' where id = entry1;
  select * into r from public.timesheet_entries where id = entry1;
  if r.other_note is null
  then p := p + 1; else f := array_append(f, 'a note only stays on an Other entry'); end if;

  begin
    update public.timesheet_entries set work_date = earliest - 1 where id = entry1;
    f := array_append(f, 'operative cannot move an entry before the earliest open date');
  exception when insufficient_privilege then p := p + 1; end;

  insert into public.timesheet_entries (work_date, job_id, work_type_id, start_time, finish_time, description)
  values (today, job_a, wt_a, '18:00', '19:00', 'To delete') returning id into entry3;
  delete from public.timesheet_entries where id = entry3;
  get diagnostics n = row_count;
  if n = 1 then p := p + 1; else f := array_append(f, 'operative can delete own entry this week'); end if;

  -- ---------------------------------------------------- other operatives
  perform set_config('request.jwt.claims', json_build_object('sub', login_a2)::text, true);
  if (select count(*) from public.timesheet_entries) = 0
  then p := p + 1; else f := array_append(f, 'operative cannot see a teammate''s entries'); end if;

  update public.timesheet_entries set description = 'Tampered' where id = entry1;
  get diagnostics n = row_count;
  if n = 0 then p := p + 1; else f := array_append(f, 'operative cannot edit a teammate''s entry'); end if;

  delete from public.timesheet_entries where id = entry1;
  get diagnostics n = row_count;
  if n = 0 then p := p + 1; else f := array_append(f, 'operative cannot delete a teammate''s entry'); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', login_b1)::text, true);
  lists := public.timesheets_pick_lists();
  if (select count(*) from public.timesheet_entries) = 0
     and jsonb_array_length(lists -> 'jobs') = 1
     and (lists -> 'jobs' -> 0 ->> 'id') = job_b::text
  then p := p + 1; else f := array_append(f, 'operative at another firm sees only their own firm'); end if;

  insert into public.timesheet_entries (work_date, job_id, work_type_id, start_time, finish_time, description)
  values (today, job_b, wt_b, '08:00', '12:00', 'B work');

  perform set_config('request.jwt.claims', json_build_object('sub', login_a3)::text, true);
  begin
    insert into public.timesheet_entries (work_date, job_id, work_type_id, start_time, finish_time, description)
    values (today, job_a, wt_a, '08:00', '17:00', 'Not set up yet');
    f := array_append(f, 'set-up must be finished before adding');
  exception when insufficient_privilege then p := p + 1; end;

  if jsonb_array_length(public.timesheets_pick_lists() -> 'jobs') = 0
  then p := p + 1; else f := array_append(f, 'lists empty until set-up finished'); end if;

  -- ----------------------------------------------- owner: any date, stamped
  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);
  insert into public.timesheet_entries
    (owner_id, operative_id, work_date, job_id, work_type_id, start_time, finish_time, description)
  values (owner_a, op_a1, monday - 400, job_old, wt_a2, '07:30', '16:00', 'Old entry')
  returning id into entry_old;
  select * into r from public.timesheet_entries where id = entry_old;
  if r.created_by = owner_a and r.created_by_role = 'owner' and r.job_name = 'Archived job'
  then p := p + 1; else f := array_append(f, 'owner can add any date, stamped'); end if;

  if (select count(*) from public.timesheet_entries) = 3
  then p := p + 1; else f := array_append(f, 'owner sees whole team''s entries, no other account''s'); end if;

  update public.timesheet_entries set description = 'Tampered' where owner_id = owner_b;
  get diagnostics n = row_count;
  if n = 0 then p := p + 1; else f := array_append(f, 'owner cannot correct another account'); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', login_a1)::text, true);
  if (select count(*) from public.timesheet_entries where id = entry_old) = 1
  then p := p + 1; else f := array_append(f, 'operative can read own old entry'); end if;

  update public.timesheet_entries set description = 'Changed' where id = entry_old;
  get diagnostics n = row_count;
  if n = 0 then p := p + 1; else f := array_append(f, 'operative cannot edit an old entry'); end if;

  delete from public.timesheet_entries where id = entry_old;
  get diagnostics n = row_count;
  if n = 0 then p := p + 1; else f := array_append(f, 'operative cannot delete an old entry'); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);
  update public.timesheet_entries set break_minutes = 30 where id = entry_old;
  select * into r from public.timesheet_entries where id = entry_old;
  if r.updated_by = owner_a and r.updated_by_role = 'owner' and r.created_by_role = 'owner' and r.break_minutes = 30
  then p := p + 1; else f := array_append(f, 'owner can correct any date, stamped'); end if;

  select * into h from public.timesheet_entry_changes
   where entry_id = entry_old order by id desc limit 1;
  if (select count(*) from public.timesheet_entry_changes where entry_id = entry_old) = 2
     and h.action = 'changed' and h.changed_by = owner_a and h.changed_by_role = 'owner'
     and h.changed_at is not null
     and (h.before_values ->> 'break_minutes') = '0'
     and (h.after_values ->> 'break_minutes') = '30'
  then p := p + 1; else f := array_append(f, 'every change is in the history'); end if;

  select * into h from public.timesheet_entry_changes
   where entry_id = entry1 and action = 'added';
  if h.changed_by = login_a1 and h.changed_by_role = 'operative' and h.changed_by_name = 'A One'
  then p := p + 1; else f := array_append(f, 'operative changes are stamped with their name'); end if;

  begin
    update public.timesheet_entry_changes set changed_by_name = 'Tampered';
    f := array_append(f, 'history cannot be edited');
  exception when insufficient_privilege then p := p + 1; end;

  -- ------------------------------------------------- history keeps its copy
  update public.timesheet_jobs set job_name = 'Renamed job', status = 'archived' where id = job_a;
  update public.timesheet_work_types set name = 'Renamed type' where id = wt_a;
  select * into r from public.timesheet_entries where id = entry1;
  if r.job_name = 'Test job' and r.work_type = 'Price work'
  then p := p + 1; else f := array_append(f, 'rename and archive leave old entries alone'); end if;

  update public.timesheet_entries set break_minutes = 45 where id = entry1;
  select * into r from public.timesheet_entries where id = entry1;
  if r.job_name = 'Test job' and r.work_type = 'Price work' and r.minutes = 495
  then p := p + 1; else f := array_append(f, 'correcting a break keeps the copied names'); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', login_a1)::text, true);
  update public.timesheet_entries set description = 'Still editable' where id = entry1;
  get diagnostics n = row_count;
  select * into r from public.timesheet_entries where id = entry1;
  if n = 1 and r.job_name = 'Test job'
  then p := p + 1; else f := array_append(f, 'operative can still edit after the job is archived'); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);
  delete from public.timesheet_entries where id = entry2;
  get diagnostics n = row_count;
  select * into h from public.timesheet_entry_changes
   where entry_id = entry2 order by id desc limit 1;
  if n = 1 and h.action = 'deleted' and (h.before_values ->> 'job_name') = 'Other'
  then p := p + 1; else f := array_append(f, 'owner delete keeps a copy in the history'); end if;

  -- ---------------------------------------------------- signed-out visitors
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform 1 from public.timesheet_entries;
    f := array_append(f, 'visitors cannot read entries');
  exception when insufficient_privilege then p := p + 1; end;
  begin
    perform public.timesheets_context();
    f := array_append(f, 'visitors cannot call Timesheets functions');
  exception when insufficient_privilege then p := p + 1; end;

  -- ------------------------------------------------- the date is the UK date
  -- Checked with the session set to a time zone far from the UK.
  perform set_config('role', 'none', true);
  perform set_config('timezone', 'Pacific/Auckland', true);
  if public.ts_today() = (now() at time zone 'Europe/London')::date
     and public.ts_week_start() = (date_trunc('week', now() at time zone 'Europe/London'))::date
  then p := p + 1; else f := array_append(f, 'the date always comes from UK time'); end if;
  perform set_config('timezone', real_tz, true);

  -- ------------------------------------------- pretend Monday 9 November 2026
  create or replace function public.ts_today() returns date
    language sql stable set search_path = ''
    as $clock$ select date '2026-11-09'; $clock$;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', login_a2)::text, true);

  if (public.timesheets_context() ->> 'earliest_date') = '2026-11-02'
     and (public.timesheets_context() ->> 'today') = '2026-11-09'
  then p := p + 1; else f := array_append(f, 'Monday: the app is told last Monday is the earliest date'); end if;

  begin
    insert into public.timesheet_entries (work_date, other_note, work_type_id, start_time, finish_time, description)
    values (date '2026-11-02', 'Window', wt_a2, '08:00', '09:00', 'Last Monday') returning id into e_last_mon;
    p := p + 1;
  exception when insufficient_privilege then
    f := array_append(f, 'Monday: can add on last Monday');
  end;

  begin
    insert into public.timesheet_entries (work_date, other_note, work_type_id, start_time, finish_time, description)
    values (date '2026-11-08', 'Window', wt_a2, '08:00', '09:00', 'Last Sunday') returning id into e_last_sun;
    p := p + 1;
  exception when insufficient_privilege then
    f := array_append(f, 'Monday: can add on last Sunday');
  end;

  begin
    insert into public.timesheet_entries (work_date, other_note, work_type_id, start_time, finish_time, description)
    values (date '2026-11-09', 'Window', wt_a2, '08:00', '09:00', 'This Monday') returning id into e_this_mon;
    p := p + 1;
  exception when insufficient_privilege then
    f := array_append(f, 'Monday: can add today');
  end;

  update public.timesheet_entries set description = 'Edited on Monday' where id = e_last_sun;
  get diagnostics n = row_count;
  if n = 1 then p := p + 1; else f := array_append(f, 'Monday: can edit last week'); end if;

  delete from public.timesheet_entries where id = e_last_mon;
  get diagnostics n = row_count;
  if n = 1 then p := p + 1; else f := array_append(f, 'Monday: can delete last week'); end if;

  begin
    insert into public.timesheet_entries (work_date, other_note, work_type_id, start_time, finish_time, description)
    values (date '2026-11-01', 'Window', wt_a2, '08:00', '09:00', 'Too early');
    f := array_append(f, 'Monday: cannot add before last Monday');
  exception when insufficient_privilege then p := p + 1; end;

  begin
    insert into public.timesheet_entries (work_date, other_note, work_type_id, start_time, finish_time, description)
    values (date '2026-11-10', 'Window', wt_a2, '08:00', '09:00', 'Tomorrow');
    f := array_append(f, 'Monday: cannot add tomorrow');
  exception when insufficient_privilege then p := p + 1; end;

  -- ------------------------------------------ pretend Tuesday 10 November 2026
  perform set_config('role', 'none', true);
  create or replace function public.ts_today() returns date
    language sql stable set search_path = ''
    as $clock$ select date '2026-11-10'; $clock$;
  perform set_config('role', 'authenticated', true);

  if (public.timesheets_context() ->> 'earliest_date') = '2026-11-09'
  then p := p + 1; else f := array_append(f, 'Tuesday: the app is told this Monday is the earliest date'); end if;

  begin
    insert into public.timesheet_entries (work_date, other_note, work_type_id, start_time, finish_time, description)
    values (date '2026-11-08', 'Window', wt_a2, '08:00', '09:00', 'Too late');
    f := array_append(f, 'Tuesday: cannot add last week');
  exception when insufficient_privilege then p := p + 1; end;

  update public.timesheet_entries set description = 'Edited on Tuesday' where id = e_last_sun;
  get diagnostics n = row_count;
  if n = 0 then p := p + 1; else f := array_append(f, 'Tuesday: cannot edit last week'); end if;

  delete from public.timesheet_entries where id = e_last_sun;
  get diagnostics n = row_count;
  if n = 0 then p := p + 1; else f := array_append(f, 'Tuesday: cannot delete last week'); end if;

  begin
    update public.timesheet_entries set work_date = date '2026-11-08' where id = e_this_mon;
    f := array_append(f, 'Tuesday: cannot move an entry back to last week');
  exception when insufficient_privilege then p := p + 1; end;

  update public.timesheet_entries set description = 'Edited on Tuesday' where id = e_this_mon;
  get diagnostics n = row_count;
  if n = 1 then p := p + 1; else f := array_append(f, 'Tuesday: can still edit this week'); end if;

  begin
    insert into public.timesheet_entries (work_date, other_note, work_type_id, start_time, finish_time, description)
    values (date '2026-11-11', 'Window', wt_a2, '08:00', '09:00', 'Tomorrow');
    f := array_append(f, 'Tuesday: cannot add tomorrow');
  exception when insufficient_privilege then p := p + 1; end;

  -- ------------------------------------------- pretend Sunday 15 November 2026
  perform set_config('role', 'none', true);
  create or replace function public.ts_today() returns date
    language sql stable set search_path = ''
    as $clock$ select date '2026-11-15'; $clock$;
  perform set_config('role', 'authenticated', true);

  if (public.timesheets_context() ->> 'earliest_date') = '2026-11-09'
  then p := p + 1; else f := array_append(f, 'Sunday: the earliest date is still this Monday'); end if;

  begin
    insert into public.timesheet_entries (work_date, other_note, work_type_id, start_time, finish_time, description)
    values (date '2026-11-08', 'Window', wt_a2, '08:00', '09:00', 'Too late');
    f := array_append(f, 'Sunday: cannot add last week');
  exception when insufficient_privilege then p := p + 1; end;

  -- ------------------------------------------- pretend Monday 16 November 2026
  perform set_config('role', 'none', true);
  create or replace function public.ts_today() returns date
    language sql stable set search_path = ''
    as $clock$ select date '2026-11-16'; $clock$;
  perform set_config('role', 'authenticated', true);

  if (public.timesheets_context() ->> 'earliest_date') = '2026-11-09'
  then p := p + 1; else f := array_append(f, 'next Monday: only one week back is open'); end if;

  -- Back to the real clock, and clear the pretend entries.
  perform set_config('role', 'none', true);
  create or replace function public.ts_today() returns date
    language sql stable set search_path = ''
    as $clock$ select (now() at time zone 'Europe/London')::date; $clock$;
  delete from public.timesheet_entries where operative_id = op_a2;

  -- ---------------------------------------------------------- add-on off
  perform set_config('role', 'none', true);
  delete from public.addon_entitlements where user_id = owner_a;
  perform set_config('role', 'authenticated', true);

  perform set_config('request.jwt.claims', json_build_object('sub', login_a1)::text, true);
  begin
    insert into public.timesheet_entries (work_date, other_note, work_type_id, start_time, finish_time, description)
    values (today, 'Add-on off', wt_a2, '08:00', '09:00', 'Should fail');
    f := array_append(f, 'add-on off: operative cannot save');
  exception when insufficient_privilege then p := p + 1; end;

  if jsonb_array_length(public.timesheets_pick_lists() -> 'jobs') = 0
  then p := p + 1; else f := array_append(f, 'add-on off: lists empty'); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);
  begin
    insert into public.timesheet_entries
      (owner_id, operative_id, work_date, other_note, work_type_id, start_time, finish_time, description)
    values (owner_a, op_a1, today, 'Add-on off', wt_a2, '08:00', '09:00', 'Should fail');
    f := array_append(f, 'add-on off: owner cannot save');
  exception when insufficient_privilege then p := p + 1; end;

  if (select count(*) from public.timesheet_entries) = 2
  then p := p + 1; else f := array_append(f, 'add-on off: nothing is lost'); end if;

  -- ---------------------------------------------------------- removal
  perform set_config('role', 'none', true);
  update public.timesheet_operatives
     set status = 'removed', email = null, user_id = null, removed_at = now()
   where id = op_a1;
  perform set_config('role', 'authenticated', true);

  perform set_config('request.jwt.claims', json_build_object('sub', login_a1)::text, true);
  if (select count(*) from public.timesheet_entries) = 0
     and (public.timesheets_context() ->> 'role') = 'owner'
     and (public.timesheets_context() ->> 'addon') = 'false'
  then p := p + 1; else f := array_append(f, 'removed operative refused at once'); end if;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);
  if (select count(*) from public.timesheet_entries) = 2
     and (select o.name from public.timesheet_operatives o where o.id = op_a1) = 'A One'
  then p := p + 1; else f := array_append(f, 'removal keeps hours and name'); end if;

  -- ------------------------------------------------- administrator actions
  perform set_config('role', 'none', true);
  begin
    insert into public.addon_entitlements (user_id, addon) values (login_a2, 'timesheets');
    f := array_append(f, 'an operative''s login cannot hold the add-on');
  exception when raise_exception then
    if sqlerrm = 'TS_OPERATIVE_CANNOT_HAVE_ADDON' then p := p + 1; else f := array_append(f, 'wrong refusal: ' || sqlerrm); end if;
  end;

  begin
    insert into public.timesheet_operatives (owner_id, name, user_id, status)
    values (owner_c, 'Holds add-on', owner_b, 'invited');
    f := array_append(f, 'a login holding the add-on cannot be added as an operative');
  exception when raise_exception then
    if sqlerrm = 'TS_ADDON_HOLDER_CANNOT_BE_OPERATIVE' then p := p + 1; else f := array_append(f, 'wrong refusal: ' || sqlerrm); end if;
  end;

  begin
    update public.timesheet_operatives
       set status = 'invited', email = 'reinvite@example.invalid', user_id = owner_b
     where id = op_a1;
    f := array_append(f, 'a re-invite cannot use a login holding the add-on');
  exception when raise_exception then
    if sqlerrm = 'TS_ADDON_HOLDER_CANNOT_BE_OPERATIVE' then p := p + 1; else f := array_append(f, 'wrong refusal: ' || sqlerrm); end if;
  end;

  begin
    insert into public.timesheet_operatives (owner_id, name, user_id, status)
    values (owner_c, 'Self', owner_c, 'active');
    f := array_append(f, 'an owner cannot be their own operative');
  exception when check_violation then p := p + 1; end;

  insert into public.addon_entitlements (user_id, addon, ends_at)
  values (owner_c, 'timesheets', now() - interval '1 day');
  begin
    insert into public.timesheet_operatives (owner_id, name, user_id, status)
    values (owner_a, 'Lapsed add-on', owner_c, 'invited');
    f := array_append(f, 'an add-on past its end date still counts as holding it');
  exception when raise_exception then
    if sqlerrm = 'TS_ADDON_HOLDER_CANNOT_BE_OPERATIVE' then p := p + 1; else f := array_append(f, 'wrong refusal: ' || sqlerrm); end if;
  end;

  begin
    delete from public.timesheet_jobs where id = job_old;
    set constraints all immediate;
    f := array_append(f, 'a job with history cannot be deleted');
  exception when foreign_key_violation then p := p + 1; end;

  delete from auth.users where id = owner_b;
  set constraints all immediate;
  if (select count(*) from public.timesheet_jobs where owner_id = owner_b) = 0
     and (select count(*) from public.timesheet_work_types where owner_id = owner_b) = 0
     and (select count(*) from public.timesheet_operatives where owner_id = owner_b) = 0
     and (select count(*) from public.timesheet_entries where owner_id = owner_b) = 0
     and (select count(*) from public.timesheet_entry_changes where owner_id = owner_b) = 0
  then p := p + 1; else f := array_append(f, 'closing an owner account removes their Timesheets data'); end if;

  -- ------------------------------------------------------- report and cancel
  raise exception 'TEST FINISHED: % passed, % failed. Failed checks: %. Triggers on auth.users: %',
    p, coalesce(array_length(f, 1), 0), coalesce(nullif(array_to_string(f, '; '), ''), 'none'),
    (select count(*) from pg_catalog.pg_trigger g
      where g.tgrelid = 'auth.users'::regclass and not g.tgisinternal);
end;
$test$;
