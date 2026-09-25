-- ============================================================================
-- public.subscriptions.cancel_at -- RUN ONCE in the Supabase SQL editor.
-- ----------------------------------------------------------------------------
-- Stores the date a scheduled cancellation takes effect. Newer Stripe API
-- versions record a portal "cancel at period end" as subscription.cancel_at,
-- and the webhook (lib/billing.js upsertSubscription) now copies it here. It is
-- null when nothing is scheduled, including after "Don't cancel subscription".
--
-- Safe to re-run. Until it is applied the webhook still works: it saves the
-- row without this column and the app uses current_period_end for the date.
-- RLS is unchanged -- still read-own only, writes by the service role.
-- ============================================================================

alter table public.subscriptions
  add column if not exists cancel_at timestamptz;

-- CHECK:
--   select column_name, data_type from information_schema.columns
--    where table_schema = 'public' and table_name = 'subscriptions'
--      and column_name = 'cancel_at';
