-- ============================================================================
-- Sign-up straight in: make ONE test account "not confirmed yet"
-- ----------------------------------------------------------------------------
-- For testing on the test link BEFORE the switch-over, while Supabase's
-- "Confirm email" is still on (so every account that can sign in is
-- confirmed). Run AFTER supabase/signup-straight-in.sql.
--
-- Put your TEST account's address in place of TEST_EMAIL_HERE everywhere it
-- appears (find and replace). Only that one account is touched: it gets the
-- row a brand-new account gets after the switch-over, so Plotwire shows the
-- confirm-email note, sends it a Plotwire confirmation link, and won't let it
-- subscribe until the link is clicked. Its sign-in and data are unchanged.
-- Never use it on a real customer's account.
--
-- Safe to run again (it resets that account to "not confirmed yet" and
-- forgets its old links).
-- ============================================================================
begin;

delete from public.email_confirm_links
 where user_id = (select id from auth.users where lower(email) = lower('TEST_EMAIL_HERE'));

insert into public.email_confirmations (user_id, email, confirmed_at)
select id, lower(email), null from auth.users where lower(email) = lower('TEST_EMAIL_HERE')
on conflict (user_id) do update set email = excluded.email, confirmed_at = null, updated_at = now();

commit;

-- CHECK (counts only). Expect accounts_found 1, not_confirmed_yet 1.
select
  (select count(*) from auth.users where lower(email) = lower('TEST_EMAIL_HERE')) as accounts_found,
  (select count(*) from public.email_confirmations c join auth.users u on u.id = c.user_id
    where lower(u.email) = lower('TEST_EMAIL_HERE') and c.confirmed_at is null) as not_confirmed_yet;

-- UNDO for that account (puts it back to judged by Supabase's own record):
-- delete from public.email_confirmations where user_id = (select id from auth.users where lower(email) = lower('TEST_EMAIL_HERE'));
-- delete from public.email_confirm_links where user_id = (select id from auth.users where lower(email) = lower('TEST_EMAIL_HERE'));
