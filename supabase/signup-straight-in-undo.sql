-- ============================================================================
-- UNDO supabase/signup-straight-in.sql
-- ----------------------------------------------------------------------------
-- Only if something goes wrong. Removes exactly the two tables that file
-- added (and every row in them); nothing else is touched.
--
-- Before the switch-over (Supabase "Confirm email" still ON): safe at any
-- time. The live app doesn't use these tables until signup-straight-in is
-- merged; once it is, the confirm-email note goes away and paying is judged
-- by Supabase's own record again, which is right while "Confirm email" is on.
--
-- After the switch-over: FIRST turn Supabase "Confirm email" back ON
-- (Authentication > Sign In / Providers > Email), and put master back to
-- before the merge. Otherwise accounts made since the switch could never
-- confirm, so could never subscribe. Accounts let in by
-- signup-straight-in-switch.sql stay able to sign in: that part can't be
-- undone without locking them out again, so it isn't.
--
-- All or nothing: if signup-straight-in.sql was never run, it stops and
-- changes nothing.
-- ============================================================================
begin;
set local lock_timeout = '3s';

drop table public.email_confirm_links;
drop table public.email_confirmations;

commit;

-- CHECK (counts only). Expect new_tables 0.
select count(*) as new_tables
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('email_confirmations', 'email_confirm_links');
