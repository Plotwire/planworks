-- ============================================================================
-- public.user_settings -- RECORD OF THE LIVE DATABASE
-- ----------------------------------------------------------------------------
-- >>> ALREADY APPLIED -- do not run. <<<
--
-- This file records how the table's security is set up in the live project,
-- as checked in the pre-launch security audit on 24 Sep 2026. It exists so the
-- repo matches the database; it is not a migration.
--
-- Audit finding: RLS is ON and the only access is owner-only,
-- (auth.uid() = user_id).
--
-- TO CONFIRM: the audit did not record this table's policy NAME or whether it
-- is one ALL policy or one per command. The statement below assumes a single
-- ALL policy, matching the other "Users manage their own ..." tables. Run the
-- check query at the bottom and correct the name/shape here to match.
--
-- Columns, as the app uses them (lib/db.js getSettings / saveSettings):
--   user_id uuid primary key, data jsonb, updated_at timestamptz
-- ============================================================================

alter table public.user_settings enable row level security;

create policy "Users manage their own settings"   -- NAME TO CONFIRM
  on public.user_settings
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- CHECK the live state. Expect RLS on and owner-only policies.
-- ----------------------------------------------------------------------------
--   select relname, relrowsecurity from pg_class where relname = 'user_settings';
--   select policyname, cmd, roles, qual, with_check
--     from pg_policies where schemaname = 'public' and tablename = 'user_settings';
