-- ============================================================================
-- public.sketches -- RECORD OF THE LIVE DATABASE
-- ----------------------------------------------------------------------------
-- >>> ALREADY APPLIED -- do not run. <<<
--
-- This file records how the table's security is set up in the live project,
-- as checked in the pre-launch security audit on 24 Sep 2026. It exists so the
-- repo matches the database; it is not a migration.
--
-- Once supabase/paywall-policies.sql is run (at Stripe go-live), the insert
-- and update policies below are replaced by versions that also require an
-- active subscription. Update this file when that happens.
--
-- Columns, as the app uses them (lib/cad/sketchStore.js):
--   id uuid, user_id uuid, name text, data jsonb, updated_at timestamptz
-- ============================================================================

alter table public.sketches enable row level security;

-- No "to" clause: all four live policies apply to roles = public (the default).

create policy sketches_select_own
  on public.sketches for select
  using (auth.uid() = user_id);

create policy sketches_insert_own
  on public.sketches for insert
  with check (auth.uid() = user_id);

create policy sketches_update_own
  on public.sketches for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy sketches_delete_own
  on public.sketches for delete
  using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- CHECK the live state still matches. Expect RLS on and four policies, each
-- using (auth.uid() = user_id).
-- ----------------------------------------------------------------------------
--   select relname, relrowsecurity from pg_class where relname = 'sketches';
--   select policyname, cmd, roles, qual, with_check
--     from pg_policies where schemaname = 'public' and tablename = 'sketches';
