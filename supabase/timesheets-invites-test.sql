-- ============================================================================
-- Timesheets invites test
-- ----------------------------------------------------------------------------
-- Run AFTER supabase/timesheets-invites.sql, in the Supabase SQL editor.
--
-- Like the other Timesheets tests: it creates pretend accounts and data, tries
-- what should and shouldn't work, then ends with a DELIBERATE error that
-- cancels the whole test, so nothing it created is saved.
--
-- It checks: the app can't reach the invites table or any invite function;
-- inviting, sending again (not twice a minute), the old link stopping when a
-- new one is sent; refusing a customer's email, your own, someone on another
-- company's team, and an account without the add-on; a link that has run out;
-- accepting only with a worker login for the invited email; the worker-login
-- rule; the privacy notice version being recorded; cancelling; removing a
-- worker (hours kept) and inviting the same email again; the daily limit.
--
-- Expect a red message starting "TEST FINISHED:" with "0 failed". Any other
-- message means the test itself stopped; that is also fully cancelled.
-- ============================================================================
do $test$
declare
  owner_a  uuid := gen_random_uuid();
  owner_b  uuid := gen_random_uuid();
  customer uuid := gen_random_uuid();
  dave_login  uuid := gen_random_uuid();
  other_login uuid := gen_random_uuid();
  tok1 text := encode(sha256(convert_to('tsi-one', 'UTF8')), 'hex');
  tok2 text := encode(sha256(convert_to('tsi-two', 'UTF8')), 'hex');
  tok3 text := encode(sha256(convert_to('tsi-three', 'UTF8')), 'hex');
  tok4 text := encode(sha256(convert_to('tsi-four', 'UTF8')), 'hex');
  tok5 text := encode(sha256(convert_to('tsi-five', 'UTF8')), 'hex');
  dave_email text := 'tsi-dave@example.invalid';
  amy_email  text := 'tsi-amy@example.invalid';
  op_dave uuid; op_amy uuid;
  wt uuid; job uuid; today date;
  res jsonb; n integer; t text; i integer;
  p integer := 0;
  f text[] := '{}';
begin
  -- ------------------------------------------------------------------ setup
  insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data)
  values (owner_a,  'tsi-owner-a@example.invalid',  now(), '{}'::jsonb),
         (owner_b,  'tsi-owner-b@example.invalid',  now(), '{}'::jsonb),
         (customer, 'tsi-customer@example.invalid', now(), '{}'::jsonb),
         (other_login, 'tsi-other@example.invalid', now(), '{"plotwire_kind":"operative"}'::jsonb);
  insert into public.addon_entitlements (user_id, addon, note) values (owner_a, 'timesheets', 'test'), (owner_b, 'timesheets', 'test');
  select id into wt from public.timesheet_work_types where owner_id = owner_a order by sort_order limit 1;
  insert into public.timesheet_jobs (owner_id, job_number, job_name) values (owner_a, '901', 'Test job') returning id into job;
  today := public.ts_today();

  -- ------------------------------------------ the app can't reach any of it
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', owner_a)::text, true);
  foreach t in array array[
      format('select public.timesheet_invite_create(%L, %L, %L, %L)', owner_a, 'X', 'x@example.invalid', tok1),
      format('select public.timesheet_invite_resend(%L, %L, %L)', owner_a, owner_a, tok1),
      format('select public.timesheet_invite_cancel(%L, %L)', owner_a, owner_a),
      format('select public.timesheet_invite_lookup(%L)', tok1),
      format('select public.timesheet_invite_accept(%L, %L)', tok1, owner_a),
      format('select public.timesheet_remove_worker(%L, %L)', owner_a, owner_a),
      'select count(*) from public.timesheet_invites'] loop
    begin
      execute t;
      f := array_append(f, 'the app cannot run: ' || left(t, 45));
    exception when insufficient_privilege then p := p + 1; end;
  end loop;
  perform set_config('role', 'none', true);

  -- ------------------------------------------------------------- inviting
  res := public.timesheet_invite_create(owner_a, '  Dave   Smith ', 'TSI-Dave@Example.invalid', tok1);
  op_dave := (res ->> 'operative_id')::uuid;
  if res ->> 'outcome' = 'invited'
     and (select name = 'Dave Smith' and email = dave_email and status = 'invited' and user_id is null
            from public.timesheet_operatives where id = op_dave)
     and (select count(*) from public.timesheet_invites where operative_id = op_dave and token_hash = tok1) = 1
  then p := p + 1; else f := array_append(f, 'an invite adds the worker as invited, with a tidy name and email'); end if;

  begin
    perform public.timesheet_invite_create(owner_a, 'Dave Smith', dave_email, tok2);
    f := array_append(f, 'the same invite cannot be sent twice in a minute');
  exception when raise_exception then
    if sqlerrm = 'TS_INVITE_TOO_SOON' then p := p + 1; else f := array_append(f, 'wrong refusal: ' || sqlerrm); end if;
  end;

  update public.timesheet_invites set sent_at = now() - interval '2 minutes' where operative_id = op_dave;
  res := public.timesheet_invite_create(owner_a, 'Dave Smith', dave_email, tok2);
  if res ->> 'outcome' = 'resent' and (res ->> 'operative_id')::uuid = op_dave
     and (public.timesheet_invite_lookup(tok1) ->> 'state') = 'invalid'
     and (public.timesheet_invite_lookup(tok2) ->> 'state') = 'ok'
  then p := p + 1; else f := array_append(f, 'inviting again sends a new link and the old one stops'); end if;

  begin
    perform public.timesheet_invite_resend(owner_a, op_dave, tok3);
    f := array_append(f, 'Resend waits a minute');
  exception when raise_exception then
    if sqlerrm = 'TS_INVITE_TOO_SOON' then p := p + 1; else f := array_append(f, 'wrong refusal: ' || sqlerrm); end if;
  end;
  update public.timesheet_invites set sent_at = now() - interval '2 minutes' where operative_id = op_dave;
  res := public.timesheet_invite_resend(owner_a, op_dave, tok3);
  if res ->> 'email' = dave_email and (public.timesheet_invite_lookup(tok2) ->> 'state') = 'invalid'
  then p := p + 1; else f := array_append(f, 'Resend sends a new link and the old one stops'); end if;

  -- ------------------------------------------------------------- refusals
  foreach t in array array['customer', 'self', 'other company', 'no add-on', 'bad email', 'blank name'] loop
    begin
      case t
        when 'customer'      then perform public.timesheet_invite_create(owner_a, 'C', 'tsi-customer@example.invalid', tok4);
        when 'self'          then perform public.timesheet_invite_create(owner_a, 'Me', 'tsi-owner-a@example.invalid', tok4);
        when 'other company' then perform public.timesheet_invite_create(owner_b, 'Dave', dave_email, tok4);
        when 'no add-on'     then perform public.timesheet_invite_create(customer, 'Someone', 'tsi-x@example.invalid', tok4);
        when 'bad email'     then perform public.timesheet_invite_create(owner_a, 'Someone', 'not an email', tok4);
        else                      perform public.timesheet_invite_create(owner_a, '   ', 'tsi-y@example.invalid', tok4);
      end case;
      f := array_append(f, 'refuses: ' || t);
    exception when raise_exception then
      -- The CASE is in brackets: an IF's condition ends at its first THEN.
      if sqlerrm = (case t when 'customer' then 'TS_INVITE_CUSTOMER' when 'self' then 'TS_INVITE_SELF'
                           when 'other company' then 'TS_INVITE_OTHER_COMPANY' when 'no add-on' then 'TS_NO_ADDON'
                           when 'bad email' then 'TS_INVITE_BAD_EMAIL' else 'TS_INVITE_BAD_NAME' end)
      then p := p + 1; else f := array_append(f, 'refuses ' || t || ' (got ' || sqlerrm || ')'); end if;
    end;
  end loop;
  if (select count(*) from public.timesheet_operatives where owner_id in (owner_a, owner_b)) = 1
  then p := p + 1; else f := array_append(f, 'a refused invite adds nobody'); end if;

  -- -------------------------------------------------- a link that ran out
  res := public.timesheet_invite_create(owner_a, 'Amy Jones', amy_email, tok4);
  op_amy := (res ->> 'operative_id')::uuid;
  update public.timesheet_invites set expires_at = now() - interval '1 minute' where operative_id = op_amy;
  if public.timesheet_invite_lookup(tok4) ->> 'state' = 'expired'
  then p := p + 1; else f := array_append(f, 'a link that ran out says so'); end if;
  begin
    perform public.timesheet_invite_accept(tok4, other_login);
    f := array_append(f, 'a link that ran out cannot be used');
  exception when raise_exception then
    if sqlerrm = 'TS_INVITE_EXPIRED' then p := p + 1; else f := array_append(f, 'wrong refusal: ' || sqlerrm); end if;
  end;

  -- ------------------------------------------------------------ accepting
  res := public.timesheet_invite_lookup(tok3);
  if res ->> 'state' = 'ok' and res ->> 'name' = 'Dave Smith' and res ->> 'email' = dave_email and res ->> 'login' = 'none'
  then p := p + 1; else f := array_append(f, 'checking a link says who it is for, without using it'); end if;

  begin
    perform public.timesheet_invite_accept(tok3, other_login);
    f := array_append(f, 'only a login for the invited email can accept');
  exception when raise_exception then
    if sqlerrm = 'TS_INVITE_WRONG_LOGIN' then p := p + 1; else f := array_append(f, 'wrong refusal: ' || sqlerrm); end if;
  end;

  begin
    update public.timesheet_operatives set user_id = customer where id = op_dave;
    f := array_append(f, 'a worker row cannot link to a customer''s login');
  exception when raise_exception then
    if sqlerrm = 'TS_LOGIN_NOT_OPERATIVE' then p := p + 1; else f := array_append(f, 'wrong refusal: ' || sqlerrm); end if;
  end;

  -- The server makes Dave's login, marked as a worker, then accepts.
  insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data)
  values (dave_login, dave_email, now(), '{"plotwire_kind":"operative"}'::jsonb);
  if public.timesheet_invite_lookup(tok3) ->> 'login' = 'worker'
  then p := p + 1; else f := array_append(f, 'checking a link sees the new worker login'); end if;
  res := public.timesheet_invite_accept(tok3, dave_login);
  if (select user_id = dave_login and status = 'invited' from public.timesheet_operatives where id = op_dave)
     and (select count(*) from public.timesheet_invites where operative_id = op_dave) = 0
     and public.timesheet_invite_lookup(tok3) ->> 'state' = 'invalid'
  then p := p + 1; else f := array_append(f, 'accepting links the login and uses the link up'); end if;

  begin
    perform public.timesheet_invite_accept(tok3, dave_login);
    f := array_append(f, 'a link works once');
  exception when raise_exception then
    if sqlerrm = 'TS_INVITE_INVALID' then p := p + 1; else f := array_append(f, 'wrong refusal: ' || sqlerrm); end if;
  end;

  begin
    perform public.timesheet_invite_cancel(owner_a, op_dave);
    f := array_append(f, 'an accepted invite cannot be cancelled (remove instead)');
  exception when raise_exception then
    if sqlerrm = 'TS_INVITE_ACCEPTED' then p := p + 1; else f := array_append(f, 'wrong refusal: ' || sqlerrm); end if;
  end;

  -- ------------------------------------ Dave sees the notice, then records
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', dave_login)::text, true);
  res := public.timesheets_context();
  if res ->> 'role' = 'operative' and res ->> 'status' = 'invited'
  then p := p + 1; else f := array_append(f, 'a new worker is invited until they''ve seen the notice'); end if;
  perform public.timesheet_activate('2026-11-25');
  res := public.timesheets_context();
  if res ->> 'status' = 'active' and res ->> 'notice_version' = '2026-11-25'
  then p := p + 1; else f := array_append(f, 'the notice version they saw is recorded'); end if;
  insert into public.timesheet_entries (work_date, job_id, work_type_id, start_time, finish_time)
  values (today, job, wt, '08:00', '16:00');
  perform set_config('role', 'none', true);

  -- -------------------------------------------------------- cancel, remove
  res := public.timesheet_invite_cancel(owner_a, op_amy);
  if (select status = 'removed' and email is null from public.timesheet_operatives where id = op_amy)
     and (select count(*) from public.timesheet_invites where operative_id = op_amy) = 0
  then p := p + 1; else f := array_append(f, 'cancelling an invite takes them off and stops the link'); end if;

  begin
    perform public.timesheet_remove_worker(owner_a, op_dave);
    f := array_append(f, 'the login goes first');
  exception when raise_exception then
    if sqlerrm = 'TS_LOGIN_STILL_THERE' then p := p + 1; else f := array_append(f, 'wrong refusal: ' || sqlerrm); end if;
  end;

  begin
    perform public.timesheet_remove_worker(owner_b, op_dave);
    f := array_append(f, 'another company cannot remove this worker');
  exception when raise_exception then
    if sqlerrm = 'TS_NOT_ON_TEAM' then p := p + 1; else f := array_append(f, 'wrong refusal: ' || sqlerrm); end if;
  end;

  -- The server deletes Dave's login, then removes him.
  delete from auth.users where id = dave_login;
  res := public.timesheet_remove_worker(owner_a, op_dave);
  if (select status = 'removed' and email is null and user_id is null and name = 'Dave Smith'
        from public.timesheet_operatives where id = op_dave)
     and (select count(*) from public.timesheet_entries where operative_id = op_dave) = 1
  then p := p + 1; else f := array_append(f, 'removing a worker keeps their name and hours'); end if;

  res := public.timesheet_invite_create(owner_a, 'Dave Smith', dave_email, tok5);
  if res ->> 'outcome' = 'invited' and (res ->> 'operative_id')::uuid <> op_dave
  then p := p + 1; else f := array_append(f, 'a removed worker''s email can be invited again'); end if;

  -- ------------------------------------------------------- the daily limit
  for i in 1 .. 30 loop
    perform public.timesheet_invite_create(owner_b, 'Worker ' || i, 'tsi-many-' || i || '@example.invalid',
                                           encode(sha256(convert_to('tsi-many-' || i, 'UTF8')), 'hex'));
  end loop;
  begin
    perform public.timesheet_invite_create(owner_b, 'One too many', 'tsi-many-31@example.invalid',
                                           encode(sha256(convert_to('tsi-many-31', 'UTF8')), 'hex'));
    f := array_append(f, 'no more than 30 invites a day');
  exception when raise_exception then
    if sqlerrm = 'TS_INVITE_LIMIT' then p := p + 1; else f := array_append(f, 'wrong refusal: ' || sqlerrm); end if;
  end;

  -- ------------------------------------------------------- report and cancel
  raise exception 'TEST FINISHED: % passed, % failed. Failed checks: %.',
    p, coalesce(array_length(f, 1), 0), coalesce(nullif(array_to_string(f, '; '), ''), 'none');
end;
$test$;
