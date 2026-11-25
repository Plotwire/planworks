-- ============================================================================
-- Timesheets week: make two TEST logins into workers on your account
-- ----------------------------------------------------------------------------
-- For trying the worker screens on the test link. Adding workers properly
-- (invites from the Team screen) is a later batch; until then this is how a
-- test worker is set up. Run AFTER supabase/timesheets-week.sql.
--
-- BEFORE RUNNING:
--   1. Sign up two test accounts in Plotwire with addresses you own (they are
--      just normal logins until this runs). Don't use a customer's address.
--   2. Replace every placeholder in this file (find and replace does it in one
--      go): YOUR LOGIN EMAIL with your login (the one with
--      Timesheets on), FIRST TEST LOGIN EMAIL and SECOND TEST LOGIN EMAIL
--      with the two test logins.
--
-- WHAT IT DOES, for each test login: marks it as a worker (the same marker
-- the real invites will set) and adds it to your team as an active worker.
-- It refuses, changing nothing, if a placeholder wasn't replaced, a login
-- doesn't exist, a test login is yours, or a test login has Timesheets on.
-- Running it twice changes nothing more.
--
-- Shows counts only. To undo it when you've finished testing, see the end.
-- ============================================================================
do $$
declare
  owner_email text := 'YOUR LOGIN EMAIL';
  workers text[][] := array[
    array['FIRST TEST LOGIN EMAIL',  'Test Worker One'],
    array['SECOND TEST LOGIN EMAIL', 'Test Worker Two']
  ];
  boss_id  uuid;
  login_id uuid;
  i integer;
begin
  if owner_email like '%EMAIL%' or workers[1][1] like '%EMAIL%' or workers[2][1] like '%EMAIL%' then
    raise exception 'Replace the email placeholders first. Nothing was changed.';
  end if;

  select u.id into boss_id from auth.users u where lower(u.email) = lower(owner_email);
  if boss_id is null then
    raise exception 'Your login wasn''t found. Nothing was changed.';
  end if;
  if not exists (select 1 from public.addon_entitlements e where e.user_id = boss_id and e.addon = 'timesheets') then
    raise exception 'Timesheets isn''t on for your login. Nothing was changed.';
  end if;

  for i in 1 .. array_length(workers, 1) loop
    select u.id into login_id from auth.users u where lower(u.email) = lower(workers[i][1]);
    if login_id is null then
      raise exception 'Test login % wasn''t found. Sign it up first. Nothing was changed.', i;
    end if;
    if login_id = boss_id then
      raise exception 'Test login % is your own login. Nothing was changed.', i;
    end if;

    update auth.users
       set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"plotwire_kind": "operative"}'::jsonb
     where id = login_id;

    insert into public.timesheet_operatives (owner_id, name, email, user_id, status, activated_at, notice_version)
    values (boss_id, workers[i][2], lower(workers[i][1]), login_id, 'active', now(), 'test')
    on conflict (user_id) do update
       set status = 'active', activated_at = coalesce(public.timesheet_operatives.activated_at, now())
     where public.timesheet_operatives.owner_id = excluded.owner_id;
  end loop;
end;
$$;

-- CHECK (counts only). Expect test_workers 2 (more if you already had
-- workers), workers_marked 2.
select
  (select count(*) from public.timesheet_operatives o
     join auth.users u on u.id = o.owner_id
    where lower(u.email) = lower('YOUR LOGIN EMAIL') and o.status = 'active') as test_workers,
  (select count(*) from auth.users u
    where lower(u.email) in (lower('FIRST TEST LOGIN EMAIL'), lower('SECOND TEST LOGIN EMAIL'))
      and u.raw_app_meta_data ->> 'plotwire_kind' = 'operative') as workers_marked;

-- ============================================================================
-- UNDO, when you've finished testing (replace the same placeholders, then
-- run only these lines). Their hours stay in your records under their names;
-- the logins go back to being ordinary logins.
-- ============================================================================
-- update public.timesheet_operatives
--    set status = 'removed', removed_at = now(), email = null, user_id = null
--  where user_id in (select id from auth.users
--                     where lower(email) in (lower('FIRST TEST LOGIN EMAIL'), lower('SECOND TEST LOGIN EMAIL')));
-- update auth.users
--    set raw_app_meta_data = raw_app_meta_data - 'plotwire_kind'
--  where lower(email) in (lower('FIRST TEST LOGIN EMAIL'), lower('SECOND TEST LOGIN EMAIL'));
