-- ============================================================================
-- Billing hardening: the Stripe webhook's event ledger and failed-payment clock
-- ----------------------------------------------------------------------------
-- >>> NOT YET APPLIED. <<<  RUN ONCE in the Supabase SQL editor BEFORE the
-- webhook code that uses it is deployed anywhere (previews and production
-- share this database). Safe to re-run: every statement is idempotent.
-- RUN ORDER: this file BEFORE supabase/try-mode.sql, whose access rule
-- (public.access_level) reads the two columns added in section 2.
--
-- Until it is applied the webhook processes events without the duplicate
-- check (a repeat still writes nothing, because the row already matches
-- Stripe), but it can't save a subscription: subscriptions.livemode decides
-- whether a row gives access (try-mode.sql), so a write without it fails, the
-- webhook answers 500 and Stripe retries until this file is applied. Apply it
-- first.
--
-- 1. public.stripe_events: one row per Stripe webhook event id
--    (app/api/billing/webhook/route.js, lib/billing.js beginStripeEvent /
--    finishStripeEvent). An event already processed is skipped, so the same
--    event delivered twice changes nothing. Failures stay here with their
--    error for the reconciliation report.
--      outcome  processing : started (or the function died part-way; Stripe retries)
--               processed  : applied
--               skipped    : nothing to do (e.g. a one-off invoice, or the guard
--                            kept the stored subscription)
--               unmapped   : no account to apply it to (error says why)
--               failed     : error; processed_at stays null, Stripe retries
--      error    the last error. Kept after a later success, so a recovered
--               failure is still visible (outcome = processed, attempts > 1).
--    Once an event has processed_at set (processed, skipped or unmapped), a
--    redelivery -- including "Resend" in the Stripe Dashboard -- is answered
--    as a duplicate and does nothing. To make the webhook act on it again
--    (e.g. after linking an unmapped customer or deploying a fix), delete its
--    row first, then press Resend:
--      delete from public.stripe_events where id = 'evt_...';
--    Any newer event for the same subscription also re-syncs the row, because
--    every event re-reads the subscription from Stripe.
--    Events a deployment ignores (wrong mode for its key, unhandled types)
--    are NOT recorded: one deployment ignoring an event must never mark it
--    done for another that shares this table.
--    RLS on with NO policies: only the service role (the webhook) reads or
--    writes it.
--
-- 2. public.subscriptions, two new columns, written by the webhook only:
--      payment_failed_at  when the unpaid invoice behind the current past_due
--                         or unpaid spell was first charged and failed (from
--                         Stripe: the oldest open, attempted invoice's
--                         finalized_at since the last payment; never later
--                         than now, so a Stripe test clock running ahead
--                         can't stretch the grace). Set only while status is past_due or
--                         unpaid; null otherwise, so it clears when Stripe is
--                         paid. Retries, card updates and replayed events
--                         don't move it. The 7-day past_due rule reads it.
--      livemode           the Stripe mode of the subscription the row tracks
--                         (true = live). Null on rows written before this
--                         file. A test-mode subscription never replaces a
--                         live-mode row.
--    RLS is unchanged: users can read their own row; only the service role writes.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Stripe events ledger
-- ---------------------------------------------------------------------------
create table if not exists public.stripe_events (
  id              text primary key,                    -- Stripe event id (evt_...)
  type            text not null,
  livemode        boolean not null,
  object_id       text,                                -- the event data.object.id
  stripe_created  timestamptz,                         -- event.created
  received_at     timestamptz not null default now(),  -- first delivery
  last_attempt_at timestamptz not null default now(),
  processed_at    timestamptz,                         -- null until applied
  outcome         text not null default 'processing',
  error           text,
  attempts        integer not null default 0
);

alter table public.stripe_events enable row level security;
-- No policies, and no table grants for the API roles: service role only.
revoke all on table public.stripe_events from anon, authenticated;
grant select, insert, update, delete on table public.stripe_events to service_role;

-- The reconciliation report looks for events that never finished.
create index if not exists stripe_events_unfinished_idx
  on public.stripe_events (received_at)
  where processed_at is null;

-- ---------------------------------------------------------------------------
-- 2. subscriptions: failed-payment clock and Stripe mode
-- ---------------------------------------------------------------------------
alter table public.subscriptions
  add column if not exists payment_failed_at timestamptz;

alter table public.subscriptions
  add column if not exists livemode boolean;

-- ---------------------------------------------------------------------------
-- CHECK (expect: the table with RLS on and no policies; both columns present)
-- ---------------------------------------------------------------------------
--   select relname, relrowsecurity from pg_class where relname = 'stripe_events';
--   select policyname from pg_policies where schemaname = 'public' and tablename = 'stripe_events';
--   select column_name, data_type from information_schema.columns
--    where table_schema = 'public' and table_name = 'subscriptions'
--      and column_name in ('payment_failed_at', 'livemode');
--
-- Events that need a look: failed and not recovered (outcome 'failed'),
-- stuck part-way (outcome 'processing': the function died; Stripe retries),
-- or acknowledged with no account to apply them to (outcome 'unmapped'):
--   select id, type, outcome, attempts, received_at, last_attempt_at, error
--     from public.stripe_events
--    where processed_at is null or outcome = 'unmapped'
--    order by received_at;
--
-- Optional housekeeping (processed events older than 180 days):
--   delete from public.stripe_events
--    where processed_at is not null and processed_at < now() - interval '180 days';
