-- ============================================================================
-- Sign-up straight in: test
-- ----------------------------------------------------------------------------
-- Run AFTER supabase/signup-straight-in.sql, in the Supabase SQL editor.
--
-- Like the other tests: it creates a pretend account and rows, tries what
-- should and shouldn't work, then ends with a DELIBERATE error that cancels
-- the whole test, so nothing it created is saved.
--
-- It checks: signed-out visitors and signed-in accounts can't read or write
-- either table (not even their own row); only lower-case addresses and
-- proper fingerprints are accepted; deleting an account deletes its rows.
--
-- Expect a red message starting "TEST FINISHED:" with "0 failed". Any other
-- message means the test itself stopped; that is also fully cancelled.
-- ============================================================================
do $test$
declare
  me uuid := gen_random_uuid();
  hash text := md5('a') || md5('b');   -- 64 hex characters, like a SHA-256
  n integer;
  p integer := 0;
  f text[] := '{}';
begin
  -- ------------------------------------------------------------------ setup
  insert into auth.users (id, email, email_confirmed_at)
  values (me, 'ssi-test@example.invalid', now());
  insert into public.email_confirmations (user_id, email, confirmed_at)
  values (me, 'ssi-test@example.invalid', null);
  insert into public.email_confirm_links (token_hash, user_id, email, expires_at)
  values (hash, me, 'ssi-test@example.invalid', now() + interval '7 days');

  -- ------------------------------------------------ signed-out visitors
  perform set_config('role', 'anon', true);
  begin
    perform count(*) from public.email_confirmations;
    f := array_append(f, 'signed-out visitors cannot read confirmations');
  exception when insufficient_privilege then p := p + 1; end;
  begin
    perform count(*) from public.email_confirm_links;
    f := array_append(f, 'signed-out visitors cannot read links');
  exception when insufficient_privilege then p := p + 1; end;
  begin
    insert into public.email_confirmations (user_id, email, confirmed_at) values (gen_random_uuid(), 'x@example.invalid', now());
    f := array_append(f, 'signed-out visitors cannot write confirmations');
  exception when insufficient_privilege then p := p + 1; end;

  -- --------------------------------------- the account itself, signed in
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  begin
    perform count(*) from public.email_confirmations where user_id = me;
    f := array_append(f, 'an account cannot read its own confirmation row');
  exception when insufficient_privilege then p := p + 1; end;
  begin
    update public.email_confirmations set confirmed_at = now() where user_id = me;
    f := array_append(f, 'an account cannot mark itself confirmed');
  exception when insufficient_privilege then p := p + 1; end;
  begin
    perform count(*) from public.email_confirm_links where user_id = me;
    f := array_append(f, 'an account cannot read its own links');
  exception when insufficient_privilege then p := p + 1; end;
  begin
    insert into public.email_confirm_links (token_hash, user_id, email, expires_at)
    values (md5('c') || md5('d'), me, 'ssi-test@example.invalid', now() + interval '7 days');
    f := array_append(f, 'an account cannot make its own link');
  exception when insufficient_privilege then p := p + 1; end;
  perform set_config('role', 'none', true);

  -- still unconfirmed after all that
  select count(*) into n from public.email_confirmations where user_id = me and confirmed_at is null;
  if n = 1 then p := p + 1; else f := array_append(f, 'the row is unchanged'); end if;

  -- ------------------------------------------------------- what's accepted
  begin
    update public.email_confirmations set email = 'SSI-Test@Example.invalid' where user_id = me;
    f := array_append(f, 'only lower-case addresses');
  exception when check_violation then p := p + 1; end;
  begin
    insert into public.email_confirm_links (token_hash, user_id, email, expires_at)
    values ('not-a-fingerprint', me, 'ssi-test@example.invalid', now());
    f := array_append(f, 'only proper fingerprints');
  exception when check_violation then p := p + 1; end;

  -- ---------------------------------------- deleting the account
  delete from auth.users where id = me;
  select (select count(*) from public.email_confirmations where user_id = me)
       + (select count(*) from public.email_confirm_links where user_id = me) into n;
  if n = 0 then p := p + 1; else f := array_append(f, 'deleting an account deletes its rows'); end if;

  -- ------------------------------------------------------- report and cancel
  raise exception 'TEST FINISHED: % passed, % failed. Failed checks: %.',
    p, coalesce(array_length(f, 1), 0), coalesce(nullif(array_to_string(f, '; '), ''), 'none');
end;
$test$;
