-- ============================================================================
-- billing_exempt: the accounts with full access and no subscription
-- ----------------------------------------------------------------------------
-- >>> NOT YET APPLIED. <<<  Run in the Supabase SQL editor straight AFTER
-- supabase/try-mode.sql (which creates the table); see supabase/RUN-ORDER.md.
-- Safe to re-run: an account that is already exempt is left alone.
--
-- ONLY CONFIRMED ACCOUNTS ARE MADE EXEMPT: an account counts once its owner
-- has confirmed the email address (auth.users.email_confirmed_at is set), so
-- a sign-up made by someone who doesn't own the inbox is never made exempt.
-- That relies on Supabase Auth's "Confirm email" being ON (Authentication >
-- Sign In / Providers > Email). With it OFF, Supabase marks every sign-up as
-- confirmed straight away, and anyone who registered one of these addresses
-- first would be made exempt. Check it is ON before running this file.
--
-- RE-RUN THIS FILE once one of these accounts has signed up AND confirmed its
-- email (or has been deleted and re-created), and only after its owner has
-- told you they did it. An account that doesn't exist yet in auth.users, or
-- hasn't been confirmed, is simply skipped, without an error. The check at the
-- bottom says how many of the three were found, how many of those are still
-- unconfirmed, and how many are exempt: expect 3 / 0 / 3 before go-live (the
-- go-live block in RUN-ORDER.md refuses to switch billing on otherwise).
--
-- Emails are matched case-insensitively (lower(email)), so a sign-up typed
-- with capitals still matches.
--
-- To remove an account's exemption later (dashboard / service role only):
--   delete from public.billing_exempt
--    where user_id = (select id from auth.users where lower(email) = lower('<email>'));
-- ============================================================================

do $$
begin
  if to_regclass('public.billing_exempt') is null then
    raise exception 'Run supabase/try-mode.sql first: public.billing_exempt does not exist yet. Nothing in billing-exempt.sql was applied.';
  end if;
end;
$$;

insert into public.billing_exempt (user_id, note)
select u.id, x.note
  from (values
          ('joe@wattsonelectrical.co.uk',  'Owner (Watts On Electrical)'),
          ('admin@plotwire.uk',            'Plotwire admin'),
          ('info@fentonselectrical.co.uk', 'Fentons Electrical')
       ) as x (email, note)
  join auth.users u on lower(u.email) = lower(x.email)
                   and u.email_confirmed_at is not null
on conflict (user_id) do nothing;

-- ============================================================================
-- CHECK (counts only -- no email addresses or ids are shown).
-- Expect: expected 3, accounts_found 3, unconfirmed 0, exempt 3.
--   accounts_found below 3: an account hasn't signed up yet.
--   unconfirmed above 0: an account has signed up but its owner hasn't
--   clicked the link in the confirmation email yet.
-- Either way, re-run this file once the owner has signed up and confirmed.
-- all_exempt_rows is every row in the table (3 unless others were added).
-- ============================================================================
select count(distinct x.email)                                                     as expected,
       count(distinct lower(u.email))                                              as accounts_found,
       count(distinct lower(u.email)) filter (where u.email_confirmed_at is null)  as unconfirmed,
       count(distinct lower(u.email)) filter (where e.user_id is not null)         as exempt,
       (select count(*) from public.billing_exempt)                                as all_exempt_rows
  from (values ('joe@wattsonelectrical.co.uk'),
               ('admin@plotwire.uk'),
               ('info@fentonselectrical.co.uk')) as x (email)
  left join auth.users u on lower(u.email) = lower(x.email)
  left join public.billing_exempt e on e.user_id = u.id;
