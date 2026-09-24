-- ============================================================================
-- Terms acceptance records  (run ONCE in Supabase -> SQL Editor)
-- ----------------------------------------------------------------------------
-- >>> Safe to run before the preview is tested: it only adds a new table.
-- >>> Nothing existing is changed. Run it BEFORE testing the terms-preview
-- >>> branch, and before that branch is merged to master -- without the table,
-- >>> nobody can get past the acceptance page.
--
-- PURPOSE
-- One row per user per version of the legal documents (lib/legal.js
-- LEGAL_VERSION), recording that the user accepted the Terms of Service and
-- Privacy Policy AND acknowledged that Plotwire is not an electrical design
-- tool (so they must check all quantities, prices and calculations). The app
-- lets nobody past the acceptance page without a row for the current version.
--
-- The records are evidence, so users can only ADD their own and READ their
-- own. There is no update or delete policy: once written, a user cannot change
-- or remove an acceptance. (Rows go only when the account itself is deleted,
-- via on delete cascade.)
--
-- accepted_at and id are always set by the database, never by the app: the
-- column-level grants below let a user insert only user_id, legal_version,
-- acknowledged_not_design and user_agent.
-- ============================================================================

create table if not exists public.terms_acceptances (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users (id) on delete cascade,
  legal_version           text not null,
  acknowledged_not_design boolean not null,
  accepted_at             timestamptz not null default now(),
  user_agent              text,
  unique (user_id, legal_version)
);

-- ---------------------------------------------------------------------------
-- Row-level security: authenticated users only, own rows only
-- ---------------------------------------------------------------------------
alter table public.terms_acceptances enable row level security;

drop policy if exists "Users record their own terms acceptance" on public.terms_acceptances;
drop policy if exists "Users read their own terms acceptances"  on public.terms_acceptances;

create policy "Users record their own terms acceptance"
  on public.terms_acceptances
  for insert
  to authenticated
  with check (auth.uid() = user_id and acknowledged_not_design = true);

create policy "Users read their own terms acceptances"
  on public.terms_acceptances
  for select
  to authenticated
  using (auth.uid() = user_id);

-- No update or delete policy, on purpose (see above).

-- ---------------------------------------------------------------------------
-- Privileges, belt and braces behind RLS
-- ---------------------------------------------------------------------------
-- Signed-out visitors get nothing. Signed-in users may insert only the four
-- columns the app sends, and may read; they can never update or delete.
revoke all on public.terms_acceptances from anon;
revoke all on public.terms_acceptances from authenticated;
grant select on public.terms_acceptances to authenticated;
grant insert (user_id, legal_version, acknowledged_not_design, user_agent)
  on public.terms_acceptances to authenticated;

-- ============================================================================
-- VERIFICATION -- run these after the above and check the output.
-- ============================================================================

-- (a) RLS on. Expect rls_enabled = true.
select relname, relrowsecurity as rls_enabled
  from pg_class where relname = 'terms_acceptances';

-- (b) Exactly TWO policies: one INSERT, one SELECT, both for authenticated.
select policyname, cmd, roles, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename = 'terms_acceptances'
 order by cmd;

-- (c) Privileges. Expect authenticated: SELECT on the table, and INSERT only
--     on user_id, legal_version, acknowledged_not_design, user_agent. No rows
--     for anon, and no UPDATE or DELETE for anyone but the owner/service role.
select grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'terms_acceptances'
   and grantee in ('anon', 'authenticated')
 order by grantee, privilege_type;
select grantee, column_name, privilege_type
  from information_schema.column_privileges
 where table_schema = 'public' and table_name = 'terms_acceptances'
   and grantee in ('anon', 'authenticated')
 order by grantee, column_name, privilege_type;
