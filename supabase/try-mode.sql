-- ============================================================================
-- "Try Plotwire" mode, enforced in the database
-- ----------------------------------------------------------------------------
-- >>> NOT YET APPLIED. <<<  Replaces supabase/paywall-policies.sql, which was
-- never run (do not run that file).
--
-- RUN ORDER: supabase/RUN-ORDER.md has the exact steps and the checks to run
-- before and after each. In short: supabase/billing-hardening.sql FIRST (it
-- adds the subscriptions.payment_failed_at and .livemode columns the access
-- rule reads), THEN this file, THEN supabase/billing-exempt.sql (the exempt
-- accounts). Run out of order, this file stops at its first statement with
-- "Run supabase/billing-hardening.sql first" and changes nothing. Safe to
-- re-run. Run it at a quiet time: until it finishes, nobody can open, list or
-- save drawings, or upload or download files (plan images, logos). The first
-- run adds projects.symbol_count, which rewrites the projects table once, and
-- the policy changes lock the storage table; the editor holds those locks to
-- the end of the script. That is a few seconds for a small table. If it stops
-- with "canceling statement due to lock timeout", something else was using
-- one of the tables: nothing was applied, so run it again a minute later.
--
-- SAFE TO INSTALL BEFORE LAUNCH: everything below is dormant until the
-- enforce_billing switch (section 0) is set to true. While it is false, every
-- signed-in account can save exactly as today -- previews and production share
-- this database, so that matters. The one exception is billing_test_accounts
-- (section 1b): accounts listed there are enforced straight away, so billing
-- can be tested on the Stripe test-mode preview without the switch (and
-- without touching anyone else). Flip the switch at launch with the go-live
-- block in supabase/RUN-ORDER.md, which first checks the exempt accounts are
-- in place and the test accounts are gone:
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
-- WHAT IS ENFORCED -- only while billing is enforced for the account
-- (billing_enforced_for: enforce_billing = true, or a billing_test_accounts
-- account). Every check is in the database, so calling Supabase directly with
-- the account's own token gets exactly the same answers as the app.
--   * projects / sketches / planner_jobs: insert and update need full or try.
--     These are RESTRICTIVE policies (section 5): Postgres ANDs them with
--     every other policy on the table, so no other policy -- an old one, or
--     one added later in the dashboard -- can let a lapsed account save. A
--     refused save gets SQLSTATE 42501 (lib/writeErrors.js shows "Your
--     subscription isn't active...").
--   * the plan-images storage bucket: uploading or replacing a plan image
--     needs full or try (section 5b). Other buckets are not affected.
--   * projects: a trigger refuses any save that would take a try account over
--     25 placed symbols across ALL its drawings (the current saved total, so
--     deleting a drawing frees its symbols). An existing drawing can always
--     be saved if the save doesn't add symbols; a NEW drawing needs headroom,
--     even an empty one, so an account already over 25 can't start new
--     drawings (the app's TryMode blocksSave does the same). A per-account
--     lock makes a try account's saves queue, so
--     two tabs (or two direct API calls) saving at once can't both squeeze
--     under the limit.
--   * planner_settings: a try or lapsed account can't create or change a
--     planner share token (the share link); its other settings still save.
--     See section 7 for links made before launch.
--   * DELETES are never billing-checked (decision): a lapsed customer can
--     still tidy up and remove their own drawings, sketches, planner jobs and
--     plan images, and a try account can delete a drawing to free symbols.
--     Deleting can't unlock anything.
--
-- NOT RESTRICTED, by design: account and profile tables -- user_settings,
-- company_profile, company_logos (and the company-logos bucket),
-- terms_acceptances -- and planner_settings apart from the share token. They
-- stay editable whatever the billing state.
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
-- Don't stall the app waiting for a lock
-- ---------------------------------------------------------------------------
-- Adding projects.symbol_count and changing policies take exclusive locks on
-- projects, sketches, planner_jobs and storage.objects, held until the script
-- ends. If one of them has to wait behind a long-running query, every request
-- after it would queue too (previews and production share this database). So
-- a lock wait of more than 10 seconds stops the script instead, with
-- "canceling statement due to lock timeout": nothing is applied and it can
-- simply be run again. Reset before the verification row at the end.
set lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 0. The enforcement switch
-- ---------------------------------------------------------------------------
-- RLS on with NO policies, and no table grants for the API roles: only the
-- dashboard / service role can read or change it. The functions below read it
-- as SECURITY DEFINER.
create table if not exists public.app_flags (
  key        text primary key,
  value      boolean not null,
  updated_at timestamptz not null default now()
);
alter table public.app_flags enable row level security;
revoke all on table public.app_flags from anon, authenticated;
grant select, insert, update, delete on table public.app_flags to service_role;

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
-- RLS on, NO policies, no table grants for the API roles: only the dashboard /
-- service role can add or remove rows. (Same table as the never-run
-- paywall-policies.sql.)
create table if not exists public.billing_exempt (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.billing_exempt enable row level security;
revoke all on table public.billing_exempt from anon, authenticated;
grant select, insert, update, delete on table public.billing_exempt to service_role;

-- The rows themselves (joe@wattsonelectrical.co.uk, admin@plotwire.uk,
-- info@fentonselectrical.co.uk) are added by supabase/billing-exempt.sql:
-- run it straight after this file, and again once one of those accounts has
-- signed up and confirmed its email (an account that doesn't exist yet, or
-- isn't confirmed, is skipped).

-- ---------------------------------------------------------------------------
-- 1b. billing_test_accounts: accounts that test billing on the preview
-- ---------------------------------------------------------------------------
-- For testing billing on the Stripe test-mode preview (stripe-plotwire-test)
-- with Stripe's test cards. For an account listed here:
--   * its TEST-mode subscriptions count (section 2), and
--   * billing is enforced for it now, whatever enforce_billing says
--     (billing_enforced_for below): the 25-symbol cap if it is try, read-only
--     if it is lapsed -- so direct Supabase calls can be tested without
--     switching enforcement on for everyone.
-- The database being shared, both apply in production too, so list only
-- accounts made for testing, never a customer's.
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
--   select id, 'Preview billing test' from auth.users
--    where lower(email) = lower('<test account email>')
--   on conflict (user_id) do nothing;
--
-- When testing is over:   delete from public.billing_test_accounts;

-- Is billing enforced for this account? The switch, or a test account.
-- Internal: takes any user id (it would tell anyone whether another account
-- is a test account), so it is NOT callable by clients; the policies and
-- triggers below reach it through SECURITY DEFINER functions.
create or replace function public.billing_enforced_for(uid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.billing_enforced()
      or exists (select 1 from public.billing_test_accounts t where t.user_id = uid);
$$;
revoke execute on function public.billing_enforced_for(uuid) from public, anon, authenticated;

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

-- May the signed-in account save drawings, sketches, planner jobs and plan
-- images? Yes unless billing is enforced for it and it is lapsed.
create or replace function public.can_save_work()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not public.billing_enforced_for(auth.uid())
      or public.access_level(auth.uid()) in ('full', 'try');
$$;
revoke execute on function public.can_save_work() from public, anon;
grant  execute on function public.can_save_work() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Symbols per drawing
-- ---------------------------------------------------------------------------
-- Placed electrical symbols in a drawing, counted the way the editor loads it
-- (components/ElectricalPlanTool.jsx normaliseProject): a drawing whose
-- sheets list is NOT EMPTY counts every sheet's placed symbols; any other
-- drawing (the old single-sheet shape, or an empty sheets list) counts its
-- top-level placed list, which is what the editor then shows. So whatever
-- shape a direct API call writes, every symbol the editor would show is
-- counted. Furniture, wires and notes are not counted. lib/db.js
-- symbolCount() is the same rule (the app's Try counter and dashboard), but
-- this one is computed here from the drawing itself, never trusted from the
-- client. (d -> 'sheets' -> 0) is null for an empty or missing list.
create or replace function public.plotwire_symbol_count(d jsonb)
returns integer
language sql immutable set search_path = ''
as $$
  select case
    when jsonb_typeof(d -> 'sheets') = 'array' and (d -> 'sheets' -> 0) is not null then
      coalesce((select sum(case when jsonb_typeof(s -> 'placed') = 'array'
                                then jsonb_array_length(s -> 'placed') else 0 end)
                  from jsonb_array_elements(d -> 'sheets') s), 0)::integer
    when jsonb_typeof(d -> 'placed') = 'array' then jsonb_array_length(d -> 'placed')
    else 0
  end;
$$;

-- symbol_count is stored, so totals are a cheap sum. A stored generated
-- column is NOT recomputed when the function above is replaced, so on a
-- re-run after the counting rule has changed, any row whose stored count no
-- longer matches is fixed by dropping the column here and adding it back
-- below (this rewrites the projects table, like the first run). On an
-- ordinary re-run nothing is stale and nothing is rewritten.
do $$
declare
  stale boolean;
begin
  if exists (select 1 from pg_catalog.pg_attribute a
              where a.attrelid = 'public.projects'::regclass and a.attname = 'symbol_count'
                and a.attnum > 0 and not a.attisdropped) then
    execute 'select exists (select 1 from public.projects p
                             where p.symbol_count is distinct from public.plotwire_symbol_count(p.data))'
      into stale;
    if stale then
      alter table public.projects drop column symbol_count;
    end if;
  end if;
end;
$$;

alter table public.projects
  add column if not exists symbol_count integer
  generated always as (public.plotwire_symbol_count(data)) stored;

create or replace function public.try_symbol_limit()
returns integer language sql immutable as $$ select 25 $$;

-- ---------------------------------------------------------------------------
-- 4. The 25-symbol cap for try accounts
-- ---------------------------------------------------------------------------
-- BEFORE trigger, so the generated column isn't computed yet: count NEW.data
-- directly. Covers every way of saving symbols: insert, update and upsert,
-- one row or many in one statement (each row sees the rows the same
-- statement saved before it), and moving symbols between drawings (the total
-- is checked on every save that adds symbols).
--
-- Parallel saves: a save that adds symbols first takes a per-account
-- transaction lock, then reads the account's saved total. A second save of
-- the same account waits for that lock until the first one has committed or
-- rolled back, and only then reads the total -- which by then includes the
-- first save (API requests run at READ COMMITTED, so each statement in this
-- function sees what was committed before it started). So two tabs or two
-- direct API calls can't both pass on the same headroom. This function must
-- stay VOLATILE (the default) for that: a STABLE one would read the total
-- from the snapshot taken before it waited.
create or replace function public.enforce_try_symbol_cap()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  others  integer;
  mine    integer := public.plotwire_symbol_count(new.data);
begin
  if not public.billing_enforced_for(new.user_id) then return new; end if;
  if public.access_level(new.user_id) <> 'try' then return new; end if;
  -- Saving an existing drawing without adding symbols always passes (renames,
  -- deletions, tidying). An INSERT has no old count, so a new drawing, even
  -- an empty one, needs headroom (the app's TryMode blocksSave matches).
  -- OLD is this row as it is now: Postgres locks it before this trigger runs.
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
-- 5. Saving needs full or try (projects, sketches, planner_jobs)
-- ---------------------------------------------------------------------------
-- RESTRICTIVE policies: Postgres requires these AND at least one ordinary
-- (permissive) policy to pass, so they hold whatever owner policies the
-- tables already have -- the live owner-only policies are left exactly as
-- they are (projects: "Users manage their own projects"; sketches: the four
-- sketches_*_own policies; planner_jobs: "Users manage their own planner
-- jobs"), and an extra permissive policy added later can't get round them.
-- The update policy's USING is true on purpose: a lapsed account's update
-- must fail with an error (42501, which the app explains), not silently
-- match no rows. Select and delete are not restricted (see WHAT IS
-- ENFORCED). The public planner share link is unaffected: planner_shared() is
-- SECURITY DEFINER and only reads. Do NOT add "force row level security".
drop policy if exists "billing: saving needs full or try (insert)" on public.projects;
create policy "billing: saving needs full or try (insert)" on public.projects
  as restrictive for insert to authenticated
  with check (public.can_save_work());
drop policy if exists "billing: saving needs full or try (update)" on public.projects;
create policy "billing: saving needs full or try (update)" on public.projects
  as restrictive for update to authenticated
  using (true)
  with check (public.can_save_work());

drop policy if exists "billing: saving needs full or try (insert)" on public.sketches;
create policy "billing: saving needs full or try (insert)" on public.sketches
  as restrictive for insert to authenticated
  with check (public.can_save_work());
drop policy if exists "billing: saving needs full or try (update)" on public.sketches;
create policy "billing: saving needs full or try (update)" on public.sketches
  as restrictive for update to authenticated
  using (true)
  with check (public.can_save_work());

drop policy if exists "billing: saving needs full or try (insert)" on public.planner_jobs;
create policy "billing: saving needs full or try (insert)" on public.planner_jobs
  as restrictive for insert to authenticated
  with check (public.can_save_work());
drop policy if exists "billing: saving needs full or try (update)" on public.planner_jobs;
create policy "billing: saving needs full or try (update)" on public.planner_jobs
  as restrictive for update to authenticated
  using (true)
  with check (public.can_save_work());

-- ---------------------------------------------------------------------------
-- 5b. Plan-image uploads need full or try (storage bucket plan-images)
-- ---------------------------------------------------------------------------
-- Same idea on storage.objects, limited to the plan-images bucket so every
-- other bucket (company-logos ...) is untouched. The owner-folder policies
-- from supabase/plan-images-setup.sql stay as they are; reading (signed URLs)
-- and deleting plan images are not restricted.
drop policy if exists "plan-images billing: uploads need full or try (insert)" on storage.objects;
create policy "plan-images billing: uploads need full or try (insert)" on storage.objects
  as restrictive for insert to authenticated
  with check (bucket_id <> 'plan-images' or public.can_save_work());
drop policy if exists "plan-images billing: uploads need full or try (update)" on storage.objects;
create policy "plan-images billing: uploads need full or try (update)" on storage.objects
  as restrictive for update to authenticated
  using (true)
  with check (bucket_id <> 'plan-images' or public.can_save_work());

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
--   enforced     billing is enforced for this account (billing_enforced_for:
--                the enforce_billing switch, or a test account)
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
    'enforced',     public.billing_enforced_for(me.uid),
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
-- account can't create or change it; its other settings still save -- keeping
-- the token it already has, or removing it.
-- The app UPDATEs an existing row and INSERTs only an account's first save,
-- but a direct upsert through the API (insert ... on conflict do update) runs
-- the BEFORE INSERT trigger on the proposed row before Postgres finds the
-- existing one. So an INSERT is compared with the token the account already
-- has, not with nothing; otherwise an upsert that only keeps the link a try
-- or lapsed account already has would be refused.
create or replace function public.guard_planner_share_token()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  before_token text;
begin
  if not public.billing_enforced_for(new.user_id) then return new; end if;
  if public.access_level(new.user_id) = 'full' then return new; end if;
  if tg_op = 'UPDATE' then
    before_token := old.data ->> 'shareToken';
  else
    select ps.data ->> 'shareToken' into before_token
      from public.planner_settings ps where ps.user_id = new.user_id;
  end if;
  if (new.data ->> 'shareToken') is distinct from before_token
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

-- A link that already exists keeps working (planner_shared() only checks the
-- token), including after its owner lapses. At launch, AFTER the
-- billing_exempt rows are in, links of accounts that aren't full can be
-- revoked -- optional, see supabase/RUN-ORDER.md:
--
--   update public.planner_settings
--      set data = data - 'shareToken', updated_at = now()
--    where data ? 'shareToken'
--      and public.access_level(user_id) in ('try', 'lapsed');

-- ---------------------------------------------------------------------------
-- 8. Self-check: stop (applying nothing) unless every safeguard is in place
-- ---------------------------------------------------------------------------
-- Policies are ignored on a table whose row level security is off, and a
-- missing policy or a disabled trigger would silently let saves through, so
-- this raises an error -- which undoes the whole file when it is run in one
-- go -- naming whatever is wrong.
do $$
declare
  problems text[] := '{}';
  t text;
  c text;
begin
  foreach t in array array['public.projects', 'public.sketches', 'public.planner_jobs',
                           'public.planner_settings', 'storage.objects'] loop
    if not coalesce((select k.relrowsecurity from pg_catalog.pg_class k where k.oid = to_regclass(t)), false) then
      problems := problems || format('row level security is off on %s', t);
    end if;
  end loop;
  foreach t in array array['projects', 'sketches', 'planner_jobs'] loop
    foreach c in array array['INSERT', 'UPDATE'] loop
      if not exists (select 1 from pg_catalog.pg_policies p
                      where p.schemaname = 'public' and p.tablename = t
                        and p.permissive = 'RESTRICTIVE' and p.cmd = c
                        and p.with_check like '%can_save_work()%') then
        problems := problems || format('no restrictive %s billing policy on public.%s', c, t);
      end if;
    end loop;
  end loop;
  foreach c in array array['INSERT', 'UPDATE'] loop
    if not exists (select 1 from pg_catalog.pg_policies p
                    where p.schemaname = 'storage' and p.tablename = 'objects'
                      and p.permissive = 'RESTRICTIVE' and p.cmd = c
                      and p.with_check like '%plan-images%' and p.with_check like '%can_save_work()%') then
      problems := problems || format('no restrictive %s billing policy for plan-images on storage.objects', c);
    end if;
  end loop;
  if not exists (select 1 from pg_catalog.pg_trigger g
                  where g.tgrelid = 'public.projects'::regclass
                    and g.tgname = 'projects_try_symbol_cap' and g.tgenabled <> 'D') then
    problems := problems || 'trigger projects_try_symbol_cap missing or disabled';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger g
                  where g.tgrelid = 'public.planner_settings'::regclass
                    and g.tgname = 'planner_settings_share_guard' and g.tgenabled <> 'D') then
    problems := problems || 'trigger planner_settings_share_guard missing or disabled';
  end if;
  if not exists (select 1 from public.app_flags f where f.key = 'enforce_billing') then
    problems := problems || 'app_flags has no enforce_billing row';
  end if;
  if array_length(problems, 1) > 0 then
    raise exception 'try-mode.sql self-check failed: %. Fix it and run the whole file again (it is safe to re-run).',
      array_to_string(problems, '; ');
  end if;
end;
$$;

-- Back to the default for the rest of this connection (set near the top).
reset lock_timeout;

-- ============================================================================
-- VERIFICATION (counts only -- no email addresses or ids are shown)
-- ============================================================================
-- One row. Expect, until launch:
--   enforce_billing false; billing_policies 8 (insert + update on projects,
--   sketches, planner_jobs and plan-images); triggers 2; exempt_accounts 0
--   here and 3 once supabase/billing-exempt.sql has run; test_accounts 0
--   unless testing on the preview; live_rows 0 before launch (every row so far
--   is a preview test row).
select
  (select f.value from public.app_flags f where f.key = 'enforce_billing')            as enforce_billing,
  (select count(*) from pg_catalog.pg_policies p
    where p.permissive = 'RESTRICTIVE' and p.with_check like '%can_save_work()%'
      and ((p.schemaname = 'public' and p.tablename in ('projects', 'sketches', 'planner_jobs'))
           or (p.schemaname = 'storage' and p.tablename = 'objects')))                 as billing_policies,
  (select count(*) from pg_catalog.pg_trigger g
    where g.tgname in ('projects_try_symbol_cap', 'planner_settings_share_guard')
      and g.tgenabled <> 'D')                                                          as triggers,
  (select count(*) from public.billing_exempt)                                         as exempt_accounts,
  (select count(*) from public.billing_test_accounts)                                  as test_accounts,
  (select count(*) from public.subscriptions s where s.livemode is true)               as live_rows,
  (select count(*) from public.subscriptions s where s.livemode is not true)           as test_or_old_rows,
  (select count(*) from public.projects)                                               as drawings,
  (select count(*) from public.projects p where p.symbol_count is null)                as drawings_without_count;

-- More checks, counts only (run any of these on their own):
--
-- Accounts by level, and how many try accounts are already over 25 symbols
-- (they can keep opening and tidying their drawings, but can't add symbols):
--   select x.level, count(*) as accounts,
--          count(*) filter (where x.symbols > public.try_symbol_limit()) as over_25_symbols
--     from (select u.id, public.access_level(u.id) as level,
--                  coalesce((select sum(p.symbol_count) from public.projects p where p.user_id = u.id), 0) as symbols
--             from auth.users u) x
--    group by x.level order by x.level;
--
-- Subscriptions rows: Stripe mode x status, and whether they count:
--   select s.livemode, s.status, count(*) as rows,
--          count(*) filter (where exists (select 1 from public.billing_test_accounts t
--                                          where t.user_id = s.user_id)) as test_account_rows
--     from public.subscriptions s group by s.livemode, s.status order by 1, 2;
--
-- Every policy on the tables billing touches (no personal data):
--   select schemaname, tablename, policyname, permissive, cmd, with_check
--     from pg_policies
--    where (schemaname = 'public' and tablename in ('projects', 'sketches', 'planner_jobs', 'planner_settings'))
--       or (schemaname = 'storage' and tablename = 'objects')
--    order by 1, 2, 5, 3;

-- ----------------------------------------------------------------------------
-- TEST (on the Stripe test-mode preview, with accounts in
-- billing_test_accounts -- enforced for them without the switch):
--   1. Try account: save drawings totalling 25 symbols: works. A save that
--      makes it 26: "TRY_SYMBOL_LIMIT". Delete a drawing: the freed symbols
--      can be reused.
--   2. Exempt account: saves with any number of symbols.
--   3. A canceled-subscription test account: opens drawings, cannot save,
--      cannot upload a plan image; can delete.
--   4. Try account: creating a planner share link fails; a full account's
--      existing /planner/view?t=<token> link still loads signed out.
--   5. past_due: full for 7 days after payment_failed_at, then lapsed. A
--      Stripe test clock moves only Stripe's time, not the database's, so to
--      see day 8 back-date the failure on a test account's past_due row
--      (supabase/RUN-ORDER.md step 5):
--        with backdated as (
--          update public.subscriptions s set payment_failed_at = now() - interval '8 days'
--           where s.user_id = (select id from auth.users where lower(email) = lower('<test account email>'))
--             and s.user_id in (select t.user_id from public.billing_test_accounts t)
--             and s.status = 'past_due'
--             and s.livemode is not true
--          returning 1)
--        select count(*) as rows_backdated from backdated;   -- 1
--      It only changes a past_due test-mode row of an account listed in
--      billing_test_accounts, so a mistyped address can't touch a customer.
--      Then check straight away: the account is lapsed (my_access().level).
--      The next webhook event for that subscription may set the date back
--      from Stripe's invoice.
--   6. A test-card subscription on an account NOT in billing_test_accounts:
--      level 'try' (the test row is ignored), and nothing is enforced for it
--      while enforce_billing is false.
-- ----------------------------------------------------------------------------
