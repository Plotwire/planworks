-- ============================================================================
-- public.user_settings -- RECORD OF THE LIVE DATABASE
-- ----------------------------------------------------------------------------
-- >>> ALREADY APPLIED -- do not run. <<<
--
-- This file records how the table's security is set up in the live project,
-- as checked in the pre-launch security audit on 24 Sep 2026. It exists so the
-- repo matches the database; it is not a migration.
--
-- Audit finding: RLS is ON with one ALL policy, roles = public,
-- (auth.uid() = user_id) on both the using and with check sides.
--
-- Columns, as the app uses them (lib/db.js getSettings / saveSettings):
--   user_id uuid primary key, data jsonb, updated_at timestamptz
-- ============================================================================

alter table public.user_settings enable row level security;

-- No "to" clause: the live policy applies to roles = public (the default).
create policy "Users manage their own settings"
  on public.user_settings
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- CHECK the live state. Expect RLS on and owner-only policies.
-- ----------------------------------------------------------------------------
--   select relname, relrowsecurity from pg_class where relname = 'user_settings';
--   select policyname, cmd, roles, qual, with_check
--     from pg_policies where schemaname = 'public' and tablename = 'user_settings';
