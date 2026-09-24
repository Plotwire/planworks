-- ============================================================================
-- public.subscriptions -- RECORD OF THE LIVE DATABASE
-- ----------------------------------------------------------------------------
-- >>> ALREADY APPLIED -- do not run. <<<
--
-- This file records how the table's security is set up in the live project,
-- as checked in the pre-launch security audit on 24 Sep 2026. It exists so the
-- repo matches the database; it is not a migration.
--
-- Audit finding: RLS is ON with one SELECT-only policy, roles = public,
-- (auth.uid() = user_id), and NO insert/update/delete policy. That is deliberate: a user can read
-- their own row (lib/useSubscription.js), but only the Stripe webhook, using
-- the service role (which bypasses RLS), can write it. A user must never be
-- able to mark their own subscription active.
--
-- Columns, as the app uses them (lib/billing.js upsertSubscription):
--   user_id uuid (unique -- the webhook upserts on it),
--   stripe_customer_id text, stripe_subscription_id text, status text,
--   plan text, price_id text, current_period_end timestamptz,
--   cancel_at_period_end boolean, trial_end timestamptz, updated_at timestamptz
-- ============================================================================

alter table public.subscriptions enable row level security;

-- No "to" clause: the live policy applies to roles = public (the default).
create policy "read own subscription"
  on public.subscriptions
  for select
  using (auth.uid() = user_id);

-- No insert / update / delete policies -- by design, see above.

-- ----------------------------------------------------------------------------
-- CHECK the live state. Expect RLS on and exactly ONE policy, cmd = SELECT.
-- If a second row ever appears here, something has opened the table to writes.
-- ----------------------------------------------------------------------------
--   select relname, relrowsecurity from pg_class where relname = 'subscriptions';
--   select policyname, cmd, roles, qual, with_check
--     from pg_policies where schemaname = 'public' and tablename = 'subscriptions';
