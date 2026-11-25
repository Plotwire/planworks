-- ============================================================================
-- Timesheets delete test
-- ----------------------------------------------------------------------------
-- Run AFTER supabase/timesheets-delete.sql, in the Supabase SQL editor.
--
-- Like the other Timesheets tests: it creates pretend accounts and data, tries
-- what should and shouldn't work, then ends with a DELIBERATE error that
-- cancels the whole test, so nothing it created is saved.
--
-- Two firms. Firm A: an active worker and a removed worker, two jobs (one
-- archived), two work types, entries by both workers. Firm B: the same kind
-- of data, which must never change.
--
-- It checks: signed-out visitors, workers and another firm can't use the
-- delete functions; what a delete would take (entries, hours, workers, jobs
-- using a work type); deleting a job, a work type, a removed worker's record
-- and a single entry takes exactly what it says, with their history; someone
-- still on the team can't be deleted; a worker can still delete their own
-- entry in an open week but nothing else; firm B is untouched throughout.
--
-- Expect a red message starting "TEST FINISHED:" with "0 failed". Any other
-- message means the test itself stopped; that is also fully cancelled.
-- ============================================================================
do $test$
declare
  owner_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  w_active  uuid := gen_random_uuid();   -- firm A, still on the team
  w_gone    uuid := gen_random_uuid();   -- firm A, removed later
  w_b       uuid := gen_random_uuid();   -- firm B
  op_active uuid; op_gone uuid; op_b uuid;
  pw_a uuid; dw_a uuid; pw_b uuid;
  job1 uuid; job2 uuid; job2_again uuid; job_b uuid;
  e_keep uuid; e_one uuid; e_wt uuid; e_own uuid;
  today date := public.ts_today();
  res jsonb; n integer;
  b_before text; b_after text;
  p integer := 0;
  f text[] := '{}';
begin
  -- ------------------------------------------------------------------ setup
  insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data)
  values (owner_a, 'tsd-owner-a@example.invalid', now(), '{}'::jsonb),
         (owner_b, 'tsd-owner-b@example.invalid', now(), '{}'::jsonb),
         (w_active, 'tsd-active@example.invalid', now(), '{"plotwire_kind":"operative"}'::jsonb),
         (w_gone,   'tsd-gone@example.invalid',   now(), '{"plotwire_kind":"operative"}'::jsonb),
         (w_b,      'tsd-b@example.invalid',      now(), '{"plotwire_kind":"operative"}'::jsonb);
  insert into public.addon_entitlements (user_id, addon, note) values (owner_a, 'timesheets', 'test'), (owner_b, 'timesheets', 'test');
  select id into pw_a from public.timesheet_work_types where owner_id = owner_a order by sort_order limit 1;
  select id into dw_a from public.timesheet_work_types where owner_id = owner_a order by sort_order offset 1 limit 1;
  select id into pw_b from public.timesheet_work_types where owner_id = owner_b order by sort_order limit 1;

  insert into public.timesheet_operatives (owner_id, name, email, user_id, status)
  values (owner_a, 'Active One', 'tsd-active@example.invalid', w_active, 'active') returning id into op_active;
  insert into public.timesheet_operatives (owner_id, name, email, user_id, status)
  values (owner_a, 'Gone Two', 'tsd-gone@example.invalid', w_gone, 'active') returning id into op_gone;
  insert into public.timesheet_operatives (owner_id, name, email, user_id, status)
  values (owner_b, 'Firm B Worker', 'tsd-b@example.invalid', w_b, 'active') returning id into op_b;

  insert into public.timesheet_jobs (owner_id, job_number, job_name, default_work_type_id)
  values (owner_a, '901', 'Test job one', dw_a) returning id into job1;
  insert into public.timesheet_jobs (owner_id, job_number, job_name, status)
  values (owner_a, '902', 'Test job two', 'archived') returning id into job2;
  insert into public.timesheet_jobs (owner_id, job_number, job_name)
  values (owner_b, '901', 'Firm B job') returning id into job_b;

  -- Entries, as the database itself (any date): job 901 has 8h + 4h from two
  -- workers; job 902 has 2h on the second work type; one more entry to keep.
  insert into public.timesheet_entries (owner_id, operative_id, work_date, job_id, work_type_id, start_time, finish_time)
  values (owner_a, op_active, today - 20, job1, pw_a, '08:00', '16:00'),
         (owner_a, op_gone,   today - 20, job1, pw_a, '08:00', '12:00');
  insert into public.timesheet_entries (owner_id, operative_id, work_date, job_id, work_type_id, start_time, finish_time)
  values (owner_a, op_active, today - 19, job2, dw_a, '08:00', '10:00') returning id into e_wt;
  insert into public.timesheet_entries (owner_id, operative_id, work_date, job_id, work_type_id, start_time, finish_time)
  values (owner_a, op_gone, today - 18, job2, pw_a, '09:00', '10:00') returning id into e_keep;
  insert into public.timesheet_entries (owner_id, operative_id, work_date, job_id, work_type_id, start_time, finish_time)
  values (owner_a, op_active, today - 17, job2, pw_a, '11:00', '12:00') returning id into e_one;
  insert into public.timesheet_entries (owner_id, operative_id, work_date, job_id, work_type_id, start_time, finish_time)
  values (owner_b, op_b, today - 20, job_b, pw_b, '08:00', '16:00');

  -- "Gone Two" is removed from the team (the server deletes the login first).
  delete from auth.users where id = w_gone;
  update public.timesheet_operatives set status = 'removed', email = null, removed_at = now() where id = op_gone;

  -- Firm B's fingerprint, to prove it never changes.
  select md5(coalesce((select string_agg(x::text, ',' order by x.id) from public.timesheet_jobs x where x.owner_id = owner_b), '')
          || coalesce((select string_agg(x::text, ',' order by x.id) from public.timesheet_work_types x where x.owner_id = owner_b), '')
          || coalesce((select string_agg(x::text, ',' order by x.id) from public.timesheet_operatives x where x.owner_id = owner_b), '')
          || coalesce((select string_agg(x::text, ',' order by x.id) from public.timesheet_entries x where x.owner_id = owner_b), '')
          || coalesce((select string_agg(x::text, ',' order by x.id) from public.timesheet_entry_changes x where x.owner_id = owner_b), ''))
    into b_before;

  -- --------------------------------------------- who can't use the functions
  perform set_config('role', 'anon', true);
  begin
    perform public.timesheet_delete('job', job1);
    f := array_append(f, 'signed-out visitors cannot delete');
  exception when insufficient_privilege then p := p + 1; end;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);
  begin
    perform public.ts_delete_entries(owner_a, 'job', job1);
    f := array_append(f, 'the app cannot call ts_delete_entries');
  exception when insufficient_privilege then p := p + 1; end;

  perform set_config('request.jwt.claims', json_build_object('sub', w_active)::text, true);
  begin
    perform public.timesheet_delete('job', job1);
    f := array_append(f, 'a worker cannot delete a job');
  exception when raise_exception then
    if sqlerrm = 'TS_NO_ADDON' then p := p + 1; else f := array_append(f, 'wrong refusal: ' || sqlerrm); end if;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_b)::text, true);
  begin
    perform public.timesheet_delete('job', job1);
    f := array_append(f, 'another firm cannot delete this firm''s job');
  exception when raise_exception then
    if sqlerrm = 'TS_DELETE_NOT_FOUND' then p := p + 1; else f := array_append(f, 'wrong refusal: ' || sqlerrm); end if;
  end;
  begin
    perform public.timesheet_delete_preview('entry', e_one);
    f := array_append(f, 'another firm cannot even look');
  exception when raise_exception then
    if sqlerrm = 'TS_DELETE_NOT_FOUND' then p := p + 1; else f := array_append(f, 'wrong refusal: ' || sqlerrm); end if;
  end;

  -- ------------------------------------------------------------ the owner
  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);

  res := public.timesheet_delete_preview('job', job1);
  if (res ->> 'entries')::int = 2 and (res ->> 'minutes')::int = 720 and (res ->> 'workers')::int = 2
     and res ->> 'label' = '901 – Test job one'
  then p := p + 1; else f := array_append(f, 'the warning says what a job delete takes (12 hours, 2 workers)'); end if;

  res := public.timesheet_delete_preview('work_type', dw_a);
  if (res ->> 'entries')::int = 1 and (res ->> 'minutes')::int = 120 and (res ->> 'jobs_using')::int = 1
  then p := p + 1; else f := array_append(f, 'the warning says what a work type delete takes, and which jobs use it'); end if;

  begin
    perform public.timesheet_delete('worker', op_active);
    f := array_append(f, 'someone still on the team cannot be deleted');
  exception when raise_exception then
    if sqlerrm = 'TS_DELETE_NOT_REMOVED' then p := p + 1; else f := array_append(f, 'wrong refusal: ' || sqlerrm); end if;
  end;

  -- Delete job 901: its two entries (both workers) and their history go.
  res := public.timesheet_delete('job', job1);
  if (res ->> 'entries')::int = 2
     and (select count(*) from public.timesheet_jobs where id = job1) = 0
     and (select count(*) from public.timesheet_entries where job_id = job1) = 0
     and (select count(*) from public.timesheet_jobs where id = job2) = 1
     and (select count(*) from public.timesheet_entries where owner_id = owner_a) = 3
  then p := p + 1; else f := array_append(f, 'deleting a job takes its entries and nothing else'); end if;
  if (select count(*) from public.timesheet_entry_changes h
        where h.owner_id = owner_a
          and h.entry_id not in (select e.id from public.timesheet_entries e)) = 0
  then p := p + 1; else f := array_append(f, 'the deleted hours'' history goes too'); end if;

  -- Delete the second work type: its entry goes; nothing else.
  res := public.timesheet_delete('work_type', dw_a);
  if (select count(*) from public.timesheet_work_types where id = dw_a) = 0
     and (select count(*) from public.timesheet_entries where id = e_wt) = 0
     and (select count(*) from public.timesheet_entries where owner_id = owner_a) = 2
  then p := p + 1; else f := array_append(f, 'deleting a work type takes its entries and nothing else'); end if;

  -- Delete the removed worker's record: their entry and record go.
  res := public.timesheet_delete('worker', op_gone);
  if (select count(*) from public.timesheet_operatives where id = op_gone) = 0
     and (select count(*) from public.timesheet_entries where id = e_keep) = 0
     and (select count(*) from public.timesheet_operatives where id = op_active) = 1
  then p := p + 1; else f := array_append(f, 'deleting a removed worker takes their record and hours only'); end if;

  -- Delete one entry.
  res := public.timesheet_delete('entry', e_one);
  if (res ->> 'minutes')::int = 60 and (select count(*) from public.timesheet_entries where id = e_one) = 0
     and (select count(*) from public.timesheet_entry_changes where entry_id = e_one) = 0
  then p := p + 1; else f := array_append(f, 'deleting one entry takes it and its history'); end if;

  -- An archived job with no hours deletes cleanly, freeing its number.
  res := public.timesheet_delete('job', job2);
  insert into public.timesheet_jobs (owner_id, job_number, job_name) values (owner_a, '902', 'Reused number')
  returning id into job2_again;
  p := p + 1;

  -- ------------------------------------- a worker: open week only, as before
  perform set_config('request.jwt.claims', json_build_object('sub', w_active)::text, true);
  insert into public.timesheet_entries (work_date, job_id, work_type_id, start_time, finish_time)
  values (today, job2_again, pw_a, '07:00', '08:00')
  returning id into e_own;
  delete from public.timesheet_entries where id = e_own;
  get diagnostics n = row_count;
  if n = 1 then p := p + 1; else f := array_append(f, 'a worker still deletes their own entry in an open week'); end if;
  begin
    perform public.timesheet_delete('entry', e_own);
    f := array_append(f, 'a worker cannot use the boss''s delete');
  exception when raise_exception then
    if sqlerrm = 'TS_NO_ADDON' then p := p + 1; else f := array_append(f, 'wrong refusal: ' || sqlerrm); end if;
  end;
  perform set_config('role', 'none', true);

  -- ------------------------------------------------- firm B never changed
  select md5(coalesce((select string_agg(x::text, ',' order by x.id) from public.timesheet_jobs x where x.owner_id = owner_b), '')
          || coalesce((select string_agg(x::text, ',' order by x.id) from public.timesheet_work_types x where x.owner_id = owner_b), '')
          || coalesce((select string_agg(x::text, ',' order by x.id) from public.timesheet_operatives x where x.owner_id = owner_b), '')
          || coalesce((select string_agg(x::text, ',' order by x.id) from public.timesheet_entries x where x.owner_id = owner_b), '')
          || coalesce((select string_agg(x::text, ',' order by x.id) from public.timesheet_entry_changes x where x.owner_id = owner_b), ''))
    into b_after;
  if b_after = b_before then p := p + 1; else f := array_append(f, 'another firm''s data never changes'); end if;

  -- ------------------------------------------------------- report and cancel
  raise exception 'TEST FINISHED: % passed, % failed. Failed checks: %.',
    p, coalesce(array_length(f, 1), 0), coalesce(nullif(array_to_string(f, '; '), ''), 'none');
end;
$test$;
