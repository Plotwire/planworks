-- ============================================================================
-- "Try Plotwire" mode, enforced in the database
-- ----------------------------------------------------------------------------
-- >>> NOT YET APPLIED. <<<  Replaces supabase/paywall-policies.sql, which was
-- never run (do not run that file).
--
-- RUN ORDER: supabase/billing-hardening.sql FIRST (it adds the
-- subscriptions.payment_failed_at and .livemode columns the access rule
-- reads), THEN this file. Run out of order, this file stops at its first
-- statement with "Run supabase/billing-hardening.sql first" and changes
-- nothing. Safe to re-run.
--
-- SAFE TO INSTALL BEFORE LAUNCH: everything below is dormant until the
-- enforce_billing switch (section 0) is set to true. While it is false, every
-- signed-in account can save exactly as today -- previews and production share
-- this database, so that matters. Flip it at launch:
--
--   update public.app_flags set value = true, updated_at = now()
--    where key = 'enforce_billing';
--
-- ACCESS LEVELS (public.access_level, section 2) -- the ONE access rule. The
-- app shows the level my_access() returns; lib/access.js is a documented copy
-- of this rule (kept identical) for the browser.
--   full   : billing_exempt; or a subscription that is active or trialing; or
--            past_due for at most past_due_grace_days() = 7 days after the
--            failed payment (subscriptions.payment_failed_at, taken from
--            Stripe's failed invoice by the webhook). A past_due row without
--            payment_failed_at (written before billing-hardening.sql) counts
--            from the start of the unpaid month: current_period_end minus one
--            month. Coupon (promotion code) subscribers are 'active' in
--            Stripe, so they are full too.
--   lapsed : has had a real subscription that isn't full -- canceled, unpaid,
--            paused, past_due beyond the 7 days, ... Can read and delete;
--            cannot save.
--   try    : has never paid -- no subscriptions row, or only an abandoned /
--            failed first checkout (incomplete, incomplete_expired). Can save,
--            but all their drawings together may hold at most 25 symbols.
--   The 7 days are measured when the question is asked (now()), so nothing
--   has to run for the grace to end.
--
-- WHICH SUBSCRIPTION ROW COUNTS: only a LIVE-mode Stripe subscription
-- (subscriptions.livemode = true). Previews and production share this
-- database, and the Stripe TEST-mode preview writes test subscriptions for
-- real accounts, so a test card must never unlock anything. The one
-- exception is billing_test_accounts (section 1b): accounts set up to test
-- billing on that preview, whose test-mode rows count too. A row that doesn't
-- count is ignored, so the account is Try (as if it had never subscribed).
--
-- WHAT IS ENFORCED (only while enforce_billing = true)
--   * projects / sketches / planner_jobs: insert + update need full or try.
--     Read and delete stay owner-only with no billing check, so a lapsed
--     customer can still open, export and tidy up their own work.
--   * projects: a trigger refuses any save that would take a try account over
--     25 placed symbols across ALL its drawings (the current saved total, so
--     deleting a drawing frees its symbols). Saves that don't add symbols
--     always pass.
--   * planner_settings: a try or lapsed account can't create or change a
--     planner share token (the share link). See section 7 for links made
--     before launch.
--
-- NOT RESTRICTED for try accounts: anything inside a drawing apart from the
-- symbol count -- BOQ rates, totals, labour, VAT, client details, On-quote
-- ticks and output choices are part of projects.data and save like any other
-- edit. Try mode locks only the OUTPUTS (PDF/CSV downloads, print, the
-- Save As file, planner image share); those are made in the browser, so the
-- app enforces them, not the database.
--
-- The React app mirrors all of this for the user experience; these rules are
-- what stop anyone skipping the app and calling Supabase directly.
--
-- ORDER: run supabase/billing-hardening.sql, then the whole of this file (the
-- switch starts OFF), add the billing_exempt rows (section 1) and, for
-- testing on the Stripe test-mode preview, the billing_test_accounts rows
-- (section 1b), check with the verification queries, test, and only then
-- flip the switch.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Before anything else: billing-hardening.sql must have been run (RUN ORDER).
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from pg_catalog.pg_attribute a
       where a.attrelid = to_regclass('public.subscriptions')
         and a.attname in ('payment_failed_at', 'livemode')
         and a.attnum > 0 and not a.attisdropped) < 2 then
    raise exception 'Run supabase/billing-hardening.sql first: public.subscriptions has no payment_failed_at / livemode column yet. Nothing in try-mode.sql was applied.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 0. The enforcement switch
-- ---------------------------------------------------------------------------
-- RLS on with NO policies: only the dashboard / service role can read or change
-- it. The functions below read it as SECURITY DEFINER.
create table if not exists public.app_flags (
  key        text primary key,
  value      boolean not null,
  updated_at timestamptz not null default now()
);
alter table public.app_flags enable row level security;

insert into public.app_flags (key, value) values ('enforce_billing', false)
on conflict (key) do nothing;

create or replace function public.billing_enforced()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select f.value from public.app_flags f where f.key = 'enforce_billing'), false);
$$;
revoke execute on function public.billing_enforced() from public, anon;
grant  execute on function public.billing_enforced() to authenticated;

-- ---------------------------------------------------------------------------
-- 1. billing_exempt: accounts with full access and no subscription
-- ---------------------------------------------------------------------------
-- RLS on, NO policies: only the dashboard / service role can add or remove
-- rows. (Same table as the never-run paywall-policies.sql.)
create table if not exists public.billing_exempt (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.billing_exempt enable row level security;

-- Add the exempt accounts (run after the table exists):
--
--   insert into public.billing_exempt (user_id, note)
--   select id, 'Owner' from auth.users where email = 'joe@wattsonelectrical.co.uk'
--   on conflict (user_id) do nothing;
--
--   insert into public.billing_exempt (user_id, note)
--   select id, 'Fentons' from auth.users where email = 'info@fentonselectrical.co.uk'
--   on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 1b. billing_test_accounts: accounts whose TEST-mode subscriptions count
-- ---------------------------------------------------------------------------
-- For testing billing on the Stripe test-mode preview (stripe-plotwire-test)
-- with Stripe's test cards. A test-mode subscription gives access ONLY to the
-- accounts listed here -- and, the database being shared, it does so in
-- production too, so list only accounts made for testing, never a customer's.
-- RLS on, NO policies, no grants for the API roles: only the dashboard /
-- service role can add or remove rows.
create table if not exists public.billing_test_accounts (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.billing_test_accounts enable row level security;
revoke all on table public.billing_test_accounts from anon, authenticated;
grant select, insert, update, delete on table public.billing_test_accounts to service_role;

-- Add a test account once it has signed up:
--
--   insert into public.billing_test_accounts (user_id, note)
--   select id, 'Preview billing test' from auth.users where email = '<test account email>'
--   on conflict (user_id) do nothing;
--
-- When testing is over:   delete from public.billing_test_accounts;

-- ---------------------------------------------------------------------------
-- 2. Access level -- the ONE rule (lib/access.js is an exact copy)
-- ---------------------------------------------------------------------------
-- The past_due grace: how many days after the failed payment a past_due
-- subscription keeps full access. Must match PAST_DUE_GRACE_DAYS in
-- lib/access.js.
create or replace function public.past_due_grace_days()
returns integer language sql immutable as $$ select 7 $$;

-- When a past_due subscription's grace ends: payment_failed_at + 7 days.
-- A row written before payment_failed_at existed counts from the start of the
-- unpaid month instead, current_period_end minus one month (one monthly
-- plan): at a renewal Stripe moves the period on BEFORE it charges, so on a
-- past_due row current_period_end is the END of the month that wasn't paid.
-- Null when the status isn't past_due, or when neither date is known (which
-- makes the row lapsed, not full). The month is a UTC calendar month (pinned
-- below, whatever the session's time zone); lib/access.js does the same.
create or replace function public.past_due_grace_until(
  status text, payment_failed_at timestamptz, current_period_end timestamptz)
returns timestamptz
language sql stable set search_path = '' set timezone = 'UTC'
as $$
  select case when status = 'past_due' then
    coalesce(payment_failed_at, current_period_end - interval '1 month')
      + make_interval(days => public.past_due_grace_days())
  end;
$$;

-- The level ONE subscriptions row gives at the moment as_of. No table reads.
-- lib/access.js subscriptionLevel() is the same rule.
create or replace function public.subscription_access_level(
  status text, payment_failed_at timestamptz, current_period_end timestamptz, as_of timestamptz)
returns text
language sql stable set search_path = ''
as $$
  select case
    when status is null or status in ('incomplete', 'incomplete_expired') then 'try'
    when status in ('active', 'trialing') then 'full'
    when status = 'past_due'
     and as_of <= public.past_due_grace_until(status, payment_failed_at, current_period_end) then 'full'
    else 'lapsed'
  end;
$$;

-- The account's subscriptions rows that count (WHICH SUBSCRIPTION ROW COUNTS,
-- at the top): live-mode rows, plus test-mode ones for billing_test_accounts.
-- Internal, like access_level().
create or replace function public.counted_subscriptions(uid uuid)
returns setof public.subscriptions
language sql stable security definer set search_path = ''
as $$
  select s.*
    from public.subscriptions s
   where s.user_id = uid
     and (s.livemode is true
          or exists (select 1 from public.billing_test_accounts t where t.user_id = uid));
$$;
revoke execute on function public.counted_subscriptions(uuid) from public, anon, authenticated;

-- Internal: takes any user id, so it is NOT callable by clients (it would tell
-- anyone whether another account pays). Policies and triggers reach it through
-- the SECURITY DEFINER wrappers below; the app uses my_access() (section 6).
-- One row per account (subscriptions.user_id is unique); were there ever more,
-- the best level wins.
create or replace function public.access_level(uid uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when uid is null then 'try'
    when exists (select 1 from public.billing_exempt e where e.user_id = uid) then 'full'
    else coalesce((
      select case when bool_or(x.level = 'full') then 'full'
                  when bool_or(x.level = 'lapsed') then 'lapsed' end
        from (select public.subscription_access_level(
                       s.status, s.payment_failed_at, s.current_period_end, now()) as level
                from public.counted_subscriptions(uid) s) x
    ), 'try')
  end;
$$;
revoke execute on function public.access_level(uuid) from public, anon, authenticated;

-- May the signed-in account save drawings, sketches and planner jobs?
create or replace function public.can_save_work()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not public.billing_enforced() or public.access_level(auth.uid()) in ('full', 'try');
$$;
revoke execute on function public.can_save_work() from public, anon;
grant  execute on function public.can_save_work() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Symbols per drawing
-- ---------------------------------------------------------------------------
-- Placed electrical symbols across every sheet (legacy single-sheet drawings
-- keep them at the top level). Furniture, wires and notes are not counted.
-- Same rule as lib/db.js buildPreview().count, but computed here from the
-- drawing itself, never trusted from the client's preview.
create or replace function public.plotwire_symbol_count(d jsonb)
returns integer
language sql immutable set search_path = ''
as $$
  select case
    when jsonb_typeof(d -> 'sheets') = 'array' then
      coalesce((select sum(case when jsonb_typeof(s -> 'placed') = 'array'
                                then jsonb_array_length(s -> 'placed') else 0 end)
                  from jsonb_array_elements(d -> 'sheets') s), 0)::integer
    when jsonb_typeof(d -> 'placed') = 'array' then jsonb_array_length(d -> 'placed')
    else 0
  end;
$$;

-- Stored so totals are a cheap sum. Adding it rewrites the table once.
alter table public.projects
  add column if not exists symbol_count integer
  generated always as (public.plotwire_symbol_count(data)) stored;

create or replace function public.try_symbol_limit()
returns integer language sql immutable as $$ select 25 $$;

-- ---------------------------------------------------------------------------
-- 4. The 25-symbol cap for try accounts
-- ---------------------------------------------------------------------------
-- BEFORE trigger, so the generated column isn't computed yet: count NEW.data
-- directly. A per-account advisory lock stops two tabs saving at once from
-- both squeezing under the limit.
create or replace function public.enforce_try_symbol_cap()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  others  integer;
  mine    integer := public.plotwire_symbol_count(new.data);
begin
  if not public.billing_enforced() then return new; end if;
  if public.access_level(new.user_id) <> 'try' then return new; end if;
  -- Saves that don't add symbols always pass (renames, deletions, tidying).
  if tg_op = 'UPDATE' and mine <= coalesce(old.symbol_count, 0) then return new; end if;

  perform pg_advisory_xact_lock(hashtextextended('plotwire-try:' || new.user_id::text, 0));
  select coalesce(sum(p.symbol_count), 0) into others
    from public.projects p
   where p.user_id = new.user_id and p.id <> new.id;

  if others + mine > public.try_symbol_limit() then
    raise exception 'TRY_SYMBOL_LIMIT'
      using errcode = 'P0001',
            detail  = format('%s of %s trial symbols', others + mine, public.try_symbol_limit()),
            hint    = 'Subscribe to keep going.';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_try_symbol_cap on public.projects;
create trigger projects_try_symbol_cap
  before insert or update of data on public.projects
  for each row execute function public.enforce_try_symbol_cap();

-- ---------------------------------------------------------------------------
-- 5. Write policies (projects, sketches, planner_jobs)
-- ---------------------------------------------------------------------------
-- projects -- live today: one ALL policy "Users manage their own projects".
drop policy if exists "Users manage their own projects" on public.projects;
drop policy if exists "projects select own" on public.projects;
drop policy if exists "projects insert own" on public.projects;
drop policy if exists "projects update own" on public.projects;
drop policy if exists "projects delete own" on public.projects;

create policy "projects select own" on public.projects for select to authenticated
  using (auth.uid() = user_id);
create policy "projects insert own" on public.projects for insert to authenticated
  with check (auth.uid() = user_id and public.can_save_work());
create policy "projects update own" on public.projects for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and public.can_save_work());
create policy "projects delete own" on public.projects for delete to authenticated
  using (auth.uid() = user_id);

-- sketches -- only insert and update are replaced.
drop policy if exists sketches_insert_own on public.sketches;
drop policy if exists sketches_update_own on public.sketches;
create policy sketches_insert_own on public.sketches for insert to authenticated
  with check (auth.uid() = user_id and public.can_save_work());
create policy sketches_update_own on public.sketches for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and public.can_save_work());

-- planner_jobs -- live today: one ALL policy. The public share link is
-- unaffected: planner_shared() is SECURITY DEFINER and only reads. Do NOT add
-- "force row level security".
drop policy if exists "Users manage their own planner jobs" on public.planner_jobs;
drop policy if exists "planner jobs select own" on public.planner_jobs;
drop policy if exists "planner jobs insert own" on public.planner_jobs;
drop policy if exists "planner jobs update own" on public.planner_jobs;
drop policy if exists "planner jobs delete own" on public.planner_jobs;

create policy "planner jobs select own" on public.planner_jobs for select to authenticated
  using (auth.uid() = user_id);
create policy "planner jobs insert own" on public.planner_jobs for insert to authenticated
  with check (auth.uid() = user_id and public.can_save_work());
create policy "planner jobs update own" on public.planner_jobs for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and public.can_save_work());
create policy "planner jobs delete own" on public.planner_jobs for delete to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 6. my_access(): what the app asks on sign-in (and on every refresh)
-- ---------------------------------------------------------------------------
-- The app SHOWS the level this returns (lib/useSubscription.js); it doesn't
-- work its own out. Only ever about the signed-in account (auth.uid()).
--   level        'full' | 'try' | 'lapsed' (access_level, section 2)
--   exempt       billing_exempt
--   test_account billing_test_accounts (its test-mode subscriptions count)
--   row_counts   the account has a subscriptions row and it counts (a row
--                that doesn't count is one the app should ignore)
--   status       that row's Stripe status, else null
--   grace_until  past_due only: when full access ends (past_due_grace_until),
--                so the app can say so and look again then
--   grace_days   past_due_grace_days()
--   enforced     the enforce_billing switch
--   symbols_used / symbol_limit   the Try total, as the database counts it
create or replace function public.my_access()
returns json
language sql stable security definer set search_path = ''
as $$
  with me as (
    select auth.uid() as uid
  ),
  counted as (
    select s.status, s.payment_failed_at, s.current_period_end
      from me, public.counted_subscriptions(me.uid) s
     order by s.updated_at desc nulls last
     limit 1
  )
  select json_build_object(
    'level',        public.access_level(me.uid),
    'exempt',       exists (select 1 from public.billing_exempt e where e.user_id = me.uid),
    'test_account', exists (select 1 from public.billing_test_accounts t where t.user_id = me.uid),
    'row_counts',   exists (select 1 from counted),
    'status',       (select c.status from counted c),
    'grace_until',  (select public.past_due_grace_until(c.status, c.payment_failed_at, c.current_period_end)
                       from counted c),
    'grace_days',   public.past_due_grace_days(),
    'enforced',     public.billing_enforced(),
    'symbols_used', (select coalesce(sum(p.symbol_count), 0) from public.projects p where p.user_id = me.uid),
    'symbol_limit', public.try_symbol_limit()
  )
  from me;
$$;
revoke execute on function public.my_access() from public, anon;
grant  execute on function public.my_access() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Planner share links: full accounts only
-- ---------------------------------------------------------------------------
-- The token lives in planner_settings.data->>'shareToken'. A try or lapsed
-- account can't create or change it; its other settings still save.
create or replace function public.guard_planner_share_token()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.billing_enforced() then return new; end if;
  if public.access_level(new.user_id) = 'full' then return new; end if;
  if (new.data ->> 'shareToken') is distinct from
     (case when tg_op = 'UPDATE' then old.data ->> 'shareToken' else null end)
     and (new.data ->> 'shareToken') is not null then
    raise exception 'SHARE_LINK_LOCKED'
      using errcode = 'P0001', hint = 'Subscribe to share your planner.';
  end if;
  return new;
end;
$$;

drop trigger if exists planner_settings_share_guard on public.planner_settings;
create trigger planner_settings_share_guard
  before insert or update on public.planner_settings
  for each row execute function public.guard_planner_share_token();

-- Links made BEFORE launch by accounts that will be in try mode keep working
-- until revoked. Optional, at launch, AFTER adding billing_exempt rows:
--
--   update public.planner_settings
--      set data = data - 'shareToken'
--    where data ? 'shareToken'
--      and public.access_level(user_id) = 'try';

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- (a) The switch: expect enforce_billing = false until launch.
select key, value, updated_at from public.app_flags;

-- (b) Policies: projects, sketches, planner_jobs -- insert/update with_check
--     includes can_save_work(); select/delete are owner-only.
select tablename, policyname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename in ('projects', 'sketches', 'planner_jobs')
 order by tablename, cmd;

-- (c) Triggers present.
select tgname, tgrelid::regclass from pg_trigger
 where tgname in ('projects_try_symbol_cap', 'planner_settings_share_guard');

-- (d) Symbol counts per account (spot-check against the app's dashboard).
select u.email, count(p.id) as drawings, coalesce(sum(p.symbol_count), 0) as symbols,
       public.access_level(u.id) as level
  from auth.users u left join public.projects p on p.user_id = u.id
 group by u.id, u.email order by u.email;

-- (e) Who is exempt.
select e.user_id, u.email, e.note, e.created_at
  from public.billing_exempt e join auth.users u on u.id = e.user_id
 order by e.created_at;

-- (f) Every subscriptions row: does it count, and the level the account gets.
--     Before launch expect livemode false/null on every row (test rows), and
--     level 'try' for them unless the account is a test account.
select u.email, s.status, s.livemode, s.payment_failed_at,
       public.past_due_grace_until(s.status, s.payment_failed_at, s.current_period_end) as grace_until,
       exists (select 1 from public.billing_test_accounts t where t.user_id = s.user_id) as test_account,
       public.access_level(s.user_id) as level
  from public.subscriptions s join auth.users u on u.id = s.user_id
 order by u.email;

-- ----------------------------------------------------------------------------
-- TEST (switch ON, on a test account in try mode):
--   1. Save drawings totalling 25 symbols: works. A save that makes it 26:
--      "TRY_SYMBOL_LIMIT". Delete a drawing: the freed symbols can be reused.
--   2. Exempt account: saves with any number of symbols.
--   3. A canceled subscription account: opens drawings, cannot save.
--   4. Try account: creating a planner share link fails; a full account's
--      existing /planner/view?t=<token> link still loads signed out.
--   5. past_due: full for 7 days after payment_failed_at, then lapsed. A
--      Stripe test clock moves only Stripe's time, not the database's, so to
--      see day 8 back-date the failure on a test account's past_due row:
--        update public.subscriptions set payment_failed_at = now() - interval '8 days'
--         where user_id = (select id from auth.users where email = '<test account email>');
--      and check straight away: the account is lapsed (my_access().level).
--      The next webhook event for that subscription may set the date back
--      from Stripe's invoice.
--   6. A test-card subscription on an account NOT in billing_test_accounts:
--      level 'try' (the test row is ignored).
-- ----------------------------------------------------------------------------
