-- ============================================================================
-- Sign-up straight in: SWITCH-OVER step for accounts stuck "waiting for
-- verification"
-- ----------------------------------------------------------------------------
-- RUN ONLY AT SWITCH-OVER, in this order (docs/signup-straight-in-test.md,
-- "Switching over"):
--   1. supabase/signup-straight-in.sql has been run (the tables).
--   2. signup-straight-in is merged to master and production is live.
--   3. Run THIS file.
--   4. Straight away, Supabase > Authentication > Sign In / Providers >
--      Email: turn "Confirm email" OFF, and Save.
--   5. Run THIS file once more (it catches anyone who signed up in between).
-- Never before step 2: the app on master has no confirm-email note and no
-- check before paying, so the accounts this lets in could subscribe without
-- confirming.
--
-- WHAT IT DOES
-- Supabase refuses to sign in an account that never clicked its confirmation
-- link, even once "Confirm email" is off. For every such account it:
--   a. writes a row in email_confirmations saying the address is NOT
--      confirmed yet, so Plotwire shows them the confirm-email note, sends
--      them a Plotwire confirmation link, and won't let them subscribe until
--      they click it;
--   b. then marks the account confirmed in Supabase, so they can sign in
--      with the password they chose.
-- It also stops anyone else from taking over one of these accounts by
-- signing up again with the same address once "Confirm email" is off.
-- Accounts that already confirmed are not touched.
--
-- Safe to run more than once: the second time, it only picks up accounts
-- that have appeared since. All or nothing: one transaction. Nobody's
-- password or data is changed.
-- ============================================================================
begin;
set local lock_timeout = '5s';

-- a. Not confirmed yet, in Plotwire's own record.
insert into public.email_confirmations (user_id, email, confirmed_at)
select u.id, lower(u.email), null
  from auth.users u
 where u.email_confirmed_at is null and coalesce(u.email, '') <> ''
on conflict (user_id) do nothing;

-- b. Able to sign in.
update auth.users u
   set email_confirmed_at = now()
 where u.email_confirmed_at is null and coalesce(u.email, '') <> ''
   and exists (select 1 from public.email_confirmations c where c.user_id = u.id);

-- ---------------------------------------------------------------- self-check
do $$
begin
  if exists (select 1 from auth.users u where u.email_confirmed_at is null and coalesce(u.email, '') <> '') then
    raise exception 'Switch-over self-check failed: some accounts are still waiting in Supabase. Nothing was applied.';
  end if;
end;
$$;

commit;

-- ============================================================================
-- CHECK (counts only). Expect still_waiting_in_supabase 0.
-- waiting_to_confirm: accounts that still have to click a Plotwire link
-- before they can subscribe (it goes down as people confirm).
-- ============================================================================
select
  (select count(*) from auth.users u where u.email_confirmed_at is null and coalesce(u.email, '') <> '') as still_waiting_in_supabase,
  (select count(*) from public.email_confirmations where confirmed_at is null) as waiting_to_confirm,
  (select count(*) from public.email_confirmations where confirmed_at is not null) as confirmed_by_plotwire_link;
