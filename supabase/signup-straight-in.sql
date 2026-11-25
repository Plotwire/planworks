-- ============================================================================
-- Sign-up straight in: Plotwire's own record of confirmed email addresses
-- ----------------------------------------------------------------------------
-- For Joe to run in the Supabase SQL editor, once. Previews and production
-- share this database, so it is live when it is run. Safe to run before the
-- branch signup-straight-in is merged: the app on master never reads these
-- tables, and nothing existing is changed, renamed or removed. It only ADDS
-- two empty tables.
--
-- WHY
--   With Supabase's "Confirm email" turned off, Supabase marks every new
--   account confirmed the moment it is made, so its own "confirmed" flag no
--   longer says whether the person has clicked a link. Plotwire keeps its own
--   record instead, and checks it before anyone can subscribe.
--
-- WHAT IT ADDS
--   email_confirmations   one row per account that has been sent a Plotwire
--                         confirmation link: the address, and when it was
--                         confirmed (empty until the link is clicked). An
--                         account with no row is judged by Supabase's own
--                         record (lib/emailConfirm.js emailConfirmed).
--   email_confirm_links   the links sent: only a fingerprint (SHA-256) of each
--                         link's code is kept, never the code itself, with the
--                         address it was for and when it runs out (7 days).
-- Both are for the server only (it uses the service role): row-level
-- security is on with no rules, and signed-out visitors and signed-in
-- accounts are given no access at all. Deleting an account deletes its rows.
--
-- All or nothing: one transaction. If it has already been run it stops and
-- changes nothing.
--
-- AFTER THIS, at switch-over time only: supabase/signup-straight-in-switch.sql
-- (see the steps in docs/signup-straight-in-test.md). Undo:
-- supabase/signup-straight-in-undo.sql.
-- ============================================================================
begin;
set local lock_timeout = '3s';

do $$
begin
  if to_regclass('public.email_confirmations') is not null
     or to_regclass('public.email_confirm_links') is not null then
    raise exception 'signup-straight-in.sql has already been run. Nothing was changed.';
  end if;
end;
$$;

create table public.email_confirmations (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  email        text not null check (email = lower(email) and length(email) between 3 and 320),
  confirmed_at timestamptz,
  updated_at   timestamptz not null default now()
);
comment on table public.email_confirmations is
  'Plotwire''s own record of confirmed email addresses (signup-straight-in). Server only.';

create table public.email_confirm_links (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id    uuid not null references auth.users (id) on delete cascade,
  email      text not null check (email = lower(email) and length(email) between 3 and 320),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index email_confirm_links_user_idx on public.email_confirm_links (user_id, created_at desc);
comment on table public.email_confirm_links is
  'Email confirmation links sent (SHA-256 of each code only). Server only.';

alter table public.email_confirmations enable row level security;
alter table public.email_confirm_links enable row level security;
revoke all on table public.email_confirmations from anon, authenticated;
revoke all on table public.email_confirm_links from anon, authenticated;
grant select, insert, update, delete on table public.email_confirmations to service_role;
grant select, insert, update, delete on table public.email_confirm_links to service_role;

-- ---------------------------------------------------------------- self-check
do $$
declare
  problems text[] := '{}';
  t text;
begin
  foreach t in array array['public.email_confirmations', 'public.email_confirm_links'] loop
    if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = t::regclass) then
      problems := array_append(problems, t || ' has row-level security off');
    end if;
    if exists (select 1 from pg_catalog.pg_policies p
                where p.schemaname = 'public' and p.tablename = split_part(t, '.', 2)) then
      problems := array_append(problems, t || ' has rules on it');
    end if;
    if has_table_privilege('anon', t, 'select') or has_table_privilege('anon', t, 'insert')
       or has_table_privilege('anon', t, 'update') or has_table_privilege('anon', t, 'delete') then
      problems := array_append(problems, 'signed-out visitors can use ' || t);
    end if;
    if has_table_privilege('authenticated', t, 'select') or has_table_privilege('authenticated', t, 'insert')
       or has_table_privilege('authenticated', t, 'update') or has_table_privilege('authenticated', t, 'delete') then
      problems := array_append(problems, 'signed-in accounts can use ' || t);
    end if;
    if not (has_table_privilege('service_role', t, 'select') and has_table_privilege('service_role', t, 'insert')
            and has_table_privilege('service_role', t, 'update') and has_table_privilege('service_role', t, 'delete')) then
      problems := array_append(problems, 'the server can''t use ' || t);
    end if;
  end loop;
  if (select count(*) from public.email_confirmations) <> 0 or (select count(*) from public.email_confirm_links) <> 0 then
    problems := array_append(problems, 'the new tables aren''t empty');
  end if;
  if array_length(problems, 1) > 0 then
    raise exception 'Sign-up straight in self-check failed: %. Nothing was applied.', array_to_string(problems, '; ');
  end if;
end;
$$;

commit;

-- ============================================================================
-- CHECK (counts only). Expect new_tables 2, rls_on 2, rules 0, rows 0.
-- ============================================================================
select
  (select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('email_confirmations', 'email_confirm_links')) as new_tables,
  (select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('email_confirmations', 'email_confirm_links') and c.relrowsecurity) as rls_on,
  (select count(*) from pg_catalog.pg_policies
    where schemaname = 'public' and tablename in ('email_confirmations', 'email_confirm_links')) as rules,
  (select count(*) from public.email_confirmations) + (select count(*) from public.email_confirm_links) as rows;
