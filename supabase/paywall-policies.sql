-- ============================================================================
-- SUPERSEDED by supabase/try-mode.sql.  NEVER RUN THIS FILE.
-- ----------------------------------------------------------------------------
-- An early draft of the paywall in the database. It was never run. The billing
-- SQL that replaces it is supabase/try-mode.sql, and supabase/RUN-ORDER.md has
-- the go-live steps: follow that, not this file.
--
-- Running this draft would have dropped the live owner policies on projects,
-- sketches and planner_jobs and stopped every account without a subscription
-- from saving, straight away: it isn't gated by app_flags.enforce_billing, it
-- knows nothing about Try mode or Stripe test mode, and previews share the
-- production database.
--
-- So it can't happen by accident: the statement below stops with an error
-- (the SQL editor runs a paste as one transaction, so nothing is applied),
-- and the old SQL is kept only inside a comment, as a record.
-- ============================================================================

do $$
begin
  raise exception 'paywall-policies.sql is superseded by supabase/try-mode.sql and must never be run. Nothing was applied. Follow supabase/RUN-ORDER.md.';
end;
$$;

/* ---- THE NEVER-RUN DRAFT, kept as a record only ---------------------------

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
         and s.status in ('active', 'trialing', 'past_due')
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

-- ---------------------------------------------------------------------------
-- 5. planner_jobs
-- ---------------------------------------------------------------------------
-- Live today: one ALL policy "Users manage their own planner jobs"
-- (auth.uid() = user_id) -- see planner-rls-setup.sql and the 24 Sep 2026
-- tidy. Replaced by one policy per command, same shape as projects.
--
-- The public share link is unaffected: planner_shared() is SECURITY DEFINER
-- and only reads. Do NOT add "force row level security" here.
drop policy if exists "Users manage their own planner jobs" on public.planner_jobs;
drop policy if exists "planner jobs select own" on public.planner_jobs;
drop policy if exists "planner jobs insert own" on public.planner_jobs;
drop policy if exists "planner jobs update own" on public.planner_jobs;
drop policy if exists "planner jobs delete own" on public.planner_jobs;

create policy "planner jobs select own"
  on public.planner_jobs for select to authenticated
  using (auth.uid() = user_id);

create policy "planner jobs insert own"
  on public.planner_jobs for insert to authenticated
  with check (auth.uid() = user_id and public.has_active_subscription());

create policy "planner jobs update own"
  on public.planner_jobs for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and public.has_active_subscription());

create policy "planner jobs delete own"
  on public.planner_jobs for delete to authenticated
  using (auth.uid() = user_id);

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

-- (b2) planner_jobs: expect FOUR rows, same shape as (a).
select policyname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename = 'planner_jobs'
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
--   1. Signed in as an exempt account -> save a drawing, a sketch and a
--      planner job. All work.
--   2. Signed in as an account with NO subscription and NOT exempt (turn
--      NEXT_PUBLIC_BILLING_ENABLED off locally to get past the React paywall)
--      -> open a drawing / the planner: works. Save a drawing, sketch or
--      job: "Your subscription isn't active". Delete a drawing: works.
--   3. Signed out, open an existing /planner/view?t=<token> link -> the
--      shared week still loads.
-- ----------------------------------------------------------------------------

---- end of the never-run draft ------------------------------------------- */
