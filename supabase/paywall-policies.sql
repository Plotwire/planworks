-- ============================================================================
-- Paywall enforced in the database  (projects + sketches)
-- ----------------------------------------------------------------------------
-- >>> RUN AT STRIPE GO-LIVE ONLY, after inserting billing_exempt rows for Joe
-- >>> and any comped testers -- otherwise every current user loses the ability
-- >>> to save.
--
-- WHY
-- Today the paywall is only a React check (AppShell.jsx, subscription.isActive).
-- A signed-in account without a subscription can still write drawings by
-- calling Supabase directly with its own access token. This file moves the
-- write side of the paywall into row-level security, where it can't be skipped.
--
-- WHAT CHANGES
--   * READ and DELETE stay owner-only, with NO subscription check -- a lapsed
--     customer can still open, export and tidy up their own drawings.
--   * INSERT and UPDATE additionally require public.has_active_subscription().
--   * The React paywall stays as the UX layer. When a save is refused by these
--     policies the app shows "Your subscription isn't active" (lib/writeErrors.js).
--
-- WHAT COUNTS AS ACTIVE
-- A subscriptions row for the caller with status 'active' or 'trialing', OR a
-- row in public.billing_exempt for the caller.
--
-- NOTE: the React gate (lib/useSubscription.js) ALSO unlocks 'past_due', so a
-- customer whose renewal card fails keeps working while Stripe retries. This
-- file deliberately does NOT include past_due, which means a past_due user can
-- open the app but their saves will be refused. If you want the two to match,
-- add 'past_due' to the status list in has_active_subscription() below before
-- running this.
--
-- BEFORE RUNNING -- comp yourself and any testers, e.g.:
--
--   insert into public.billing_exempt (user_id, note)
--   select id, 'Owner' from auth.users where email = 'you@example.com';
--
-- (Step 1 below creates the table, so run step 1 on its own first, insert the
--  exempt rows, check them with the verification query (e), then run the rest.)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. billing_exempt: accounts that get full access without a subscription
-- ---------------------------------------------------------------------------
-- RLS is ON with NO policies, so the anon and authenticated roles can neither
-- read nor write it. Only the dashboard / service role can add or remove rows.
-- The has_active_subscription() function below can still read it because it
-- is SECURITY DEFINER.
create table if not exists public.billing_exempt (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

alter table public.billing_exempt enable row level security;

-- ---------------------------------------------------------------------------
-- 2. has_active_subscription()
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so it can read billing_exempt (which has no policies) and
-- so policy checks don't depend on the caller's own subscriptions policy.
-- search_path = '' and fully schema-qualified names so nobody can shadow a
-- table or function with their own object.
create or replace function public.has_active_subscription()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
        from public.subscriptions s
       where s.user_id = auth.uid()
         and s.status in ('active', 'trialing')
    )
    or exists (
      select 1
        from public.billing_exempt e
       where e.user_id = auth.uid()
    );
$$;

revoke execute on function public.has_active_subscription() from public;
revoke execute on function public.has_active_subscription() from anon;
grant  execute on function public.has_active_subscription() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. projects
-- ---------------------------------------------------------------------------
-- Live today: one ALL policy "Users manage their own projects"
-- (auth.uid() = user_id). Replaced by one policy per command so the write
-- side can carry the subscription check and the read/delete side cannot.
drop policy if exists "Users manage their own projects" on public.projects;
drop policy if exists "projects select own" on public.projects;
drop policy if exists "projects insert own" on public.projects;
drop policy if exists "projects update own" on public.projects;
drop policy if exists "projects delete own" on public.projects;

create policy "projects select own"
  on public.projects for select to authenticated
  using (auth.uid() = user_id);

create policy "projects insert own"
  on public.projects for insert to authenticated
  with check (auth.uid() = user_id and public.has_active_subscription());

create policy "projects update own"
  on public.projects for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and public.has_active_subscription());

create policy "projects delete own"
  on public.projects for delete to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 4. sketches
-- ---------------------------------------------------------------------------
-- Live today: sketches_select_own / _insert_own / _update_own / _delete_own,
-- all (auth.uid() = user_id). Only insert and update are replaced; select and
-- delete are left exactly as they are.
drop policy if exists sketches_insert_own on public.sketches;
drop policy if exists sketches_update_own on public.sketches;

create policy sketches_insert_own
  on public.sketches for insert to authenticated
  with check (auth.uid() = user_id and public.has_active_subscription());

create policy sketches_update_own
  on public.sketches for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and public.has_active_subscription());

-- ============================================================================
-- VERIFICATION -- run these after the above and check the output.
-- ============================================================================

-- (a) projects: expect FOUR rows.
--       select / delete : qual = (auth.uid() = user_id)
--       insert / update : with_check includes has_active_subscription()
select policyname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename = 'projects'
 order by cmd;

-- (b) sketches: expect FOUR rows, same shape as (a).
select policyname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename = 'sketches'
 order by cmd;

-- (c) billing_exempt: RLS on, and NO policies (expect zero rows from the
--     second query).
select relname, relrowsecurity as rls_enabled
  from pg_class where relname = 'billing_exempt';
select policyname from pg_policies
 where schemaname = 'public' and tablename = 'billing_exempt';

-- (d) The function: security definer, search_path = ''.
select proname, prosecdef as security_definer, proconfig
  from pg_proc where proname = 'has_active_subscription';

-- (e) Who is exempt.
select e.user_id, u.email, e.note, e.created_at
  from public.billing_exempt e
  join auth.users u on u.id = e.user_id
 order by e.created_at;

-- ----------------------------------------------------------------------------
-- AFTER RUNNING: test before trusting it.
--   1. Signed in as an exempt account -> save a drawing and a sketch. Works.
--   2. Signed in as an account with NO subscription and NOT exempt (turn
--      NEXT_PUBLIC_BILLING_ENABLED off locally to get past the React paywall)
--      -> open a drawing: works. Save: "Your subscription isn't active".
--      Delete a drawing: works.
-- ----------------------------------------------------------------------------
