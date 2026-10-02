# Billing SQL: run order and checks

**Nothing in this list has been run yet.** Previews and production share one
Supabase database, so every step below changes production too.

How to run a file: open it in the Supabase dashboard (SQL Editor), paste the
whole file and press Run. Every file is safe to run again. `try-mode.sql` and
`billing-exempt.sql` stop with a clear error, and change nothing, if the file
they need hasn't been run first. Every check below shows counts only, never
an email address or an account id.

| File | Status |
|---|---|
| `subscriptions.sql`, `sketches.sql`, `user_settings.sql`, `2026-09-24-audit-tidy.sql` | Records of the live database. Already applied, so don't run them. |
| `planner-rls-setup.sql`, `plan-images-setup.sql`, `terms-acceptance.sql`, `company-*.sql` | Believed applied, because the live app depends on them, but not checked against the database. They aren't part of billing, so don't re-run them without checking first. Step 0 checks the parts billing needs (the planner tables and the plan-images bucket). |
| `plan-images-orphans.sql` | A report only. It isn't part of billing. |
| `projects-rls-setup.sql` | Use it to check only. Live has its own policy; see that file. |
| `paywall-policies.sql` | **Never run it.** `try-mode.sql` replaces it. It is now a record only: pasted into the editor, it stops with an error and changes nothing. |
| `subscriptions-cancel-at.sql` | Step 1, only if it hasn't been run. |
| `billing-hardening.sql` | Step 2 |
| `try-mode.sql` | Step 3 |
| `billing-exempt.sql` | Step 4. Run it again whenever one of the three accounts signs up. |

---

## Step 0: check what's there (read-only)

```sql
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'subscriptions' and column_name = 'cancel_at')        as has_cancel_at,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'subscriptions'
      and column_name in ('payment_failed_at', 'livemode'))                                              as hardening_columns,
  to_regclass('public.app_flags') is not null                                                            as try_mode_installed,
  (select bool_and(c.relrowsecurity) from pg_class c
    where c.oid in ('public.projects'::regclass, 'public.sketches'::regclass, 'public.planner_jobs'::regclass,
                    'public.planner_settings'::regclass, 'storage.objects'::regclass))                   as rls_on_everywhere,
  (select count(*) from storage.buckets where id = 'plan-images')                                        as plan_images_bucket,
  (select count(*) from public.projects)                                                                 as drawings,
  pg_size_pretty(pg_total_relation_size('public.projects'))                                              as projects_size,
  (select count(*) from public.subscriptions)                                                            as subscription_rows;
```

If this stops with "relation ... does not exist", a file the app depends on
hasn't been applied (`planner_settings` and `planner_jobs` come from
`planner-rls-setup.sql`). Stop here and ask.

Expect:
- `rls_on_everywhere` true and `plan_images_bucket` 1. **If either is wrong, stop here and ask.**
- `hardening_columns` 0 and `try_mode_installed` false the first time. If they already show 2 and true, the later steps have run before; running them again is safe.
- `has_cancel_at` 1 means step 1 has already been done.

Write down `drawings`, `projects_size` and `subscription_rows` so you can compare them afterwards. Nothing below adds or removes drawings or subscription rows.

Also check, in the Supabase dashboard:
- **A recent backup exists** (Database > Backups). If none is listed, take one before step 3, for example with the Supabase CLI's `supabase db dump`.
- **"Confirm email" is ON** (Authentication > Sign In / Providers > Email). Step 4 depends on it.

## Step 1: `subscriptions-cancel-at.sql`

Run it only if `has_cancel_at` was 0. Running it again is harmless.

## Step 2: `billing-hardening.sql`

Run it **before the prelaunch code is deployed anywhere**, including the
Stripe test preview. The new webhook writes `subscriptions.livemode`; until this
file has run, every subscription event gets a 500 and Stripe keeps retrying.

Check:

```sql
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'subscriptions'
      and column_name in ('payment_failed_at', 'livemode'))                         as hardening_columns,       -- 2
  (select c.relrowsecurity from pg_class c where c.oid = 'public.stripe_events'::regclass) as stripe_events_rls, -- true
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'stripe_events') as stripe_events_policies; -- 0
```

## Step 3: `try-mode.sql`

Check the backup from step 0 first. Run it at a quiet time: **until it
finishes, nobody can open, list or save drawings, or upload or download files**
(plan images, logos). The first run adds `projects.symbol_count`, which
rewrites the projects table once, and the policy changes lock the storage
table; the editor holds those locks until the whole script has run. That takes
a few seconds for a small table; if `projects_size` in step 0 was over about
1 GB (drawings with embedded plan images), run it outside working hours. A
later re-run doesn't rewrite the table, so it is over in a second or two.

The file sets a 10-second lock timeout, so it never sits in a queue holding
everyone else up.

- If you see **"Run supabase/billing-hardening.sql first"**, go back to step 2. Nothing was applied.
- If you see **"canceling statement due to lock timeout"**, something else was using one of the tables. Nothing was applied: run the file again a minute later.
- If you see **"try-mode.sql self-check failed: …"**, a safeguard couldn't be put in place (for example, row level security is off on one of the tables). The message names the problem. Stop and ask. Run as one script, the editor rolls the whole file back, so nothing is applied; either way, once the cause is fixed, running the file again is safe.

Nobody is enforced yet: `enforce_billing` starts **false**, so users notice no
difference. The only exception is accounts in `billing_test_accounts`, which
starts empty.

Check: the file's last result is one row. Expect:

| column | expect |
|---|---|
| `enforce_billing` | false |
| `billing_policies` | 8 |
| `triggers` | 2 |
| `exempt_accounts` | 0 (3 after step 4) |
| `test_accounts` | 0 |
| `live_rows` | 0 before launch |
| `test_or_old_rows` | the preview's test rows (they give nobody access) |
| `drawings` | the same as step 0 |
| `drawings_without_count` | 0 |

## Step 4: `billing-exempt.sql`

This makes joe@wattsonelectrical.co.uk, admin@plotwire.uk and
info@fentonselectrical.co.uk exempt (full access with no subscription).

Only accounts whose email address has been **confirmed** are made exempt, so a
stranger who registers one of these addresses first gets nothing. This only
works with "Confirm email" ON (step 0): with it off, Supabase marks every
sign-up as confirmed at once. Before running this file, have each of the three
owners sign up on plotwire.uk and click the link in the confirmation email.

Check: the last result should read `expected 3, accounts_found 3, unconfirmed 0, exempt 3`.
- `accounts_found` below 3: one of those accounts hasn't signed up yet.
- `unconfirmed` above 0: an owner signed up but hasn't confirmed yet.

Either way, **run this file again once the owner tells you they have signed up
and confirmed.** If you didn't expect an account to exist yet (nobody you know
signed it up), don't re-run: ask first. The go-live block in step 6 won't
switch billing on until all three are confirmed and exempt.

## Step 5 (preview test day only): billing test accounts

Sign up the test accounts on the Stripe test preview first, then add each one:

```sql
insert into public.billing_test_accounts (user_id, note)
select id, 'Preview billing test' from auth.users
 where lower(email) = lower('<test account email>')
on conflict (user_id) do nothing;

select count(*) as test_accounts from public.billing_test_accounts;
```

For a listed account, Stripe test-card subscriptions count, and billing is
**enforced for it straight away**, without the global switch. If it has never
paid, it gets the 25-symbol cap. If its subscription has ended, it is
read-only. So the "direct Supabase call" tests in try-mode.sql's TEST section
can run without affecting anyone else. The database is shared, so this also
applies in production: list only accounts made for testing.

To test the 7-day past_due rule, back-date the failure on a test account's row
and check straight away. A Stripe test clock moves only Stripe's time, not the
database's.

```sql
with backdated as (
  update public.subscriptions s set payment_failed_at = now() - interval '8 days'
   where s.user_id = (select id from auth.users where lower(email) = lower('<test account email>'))
     and s.user_id in (select t.user_id from public.billing_test_accounts t)
     and s.status = 'past_due'
     and s.livemode is not true
  returning 1)
select count(*) as rows_backdated from backdated;   -- 1
```

It only changes a past_due, test-mode row of an account listed in
`billing_test_accounts`, so a mistyped address can't touch a real customer.
If `rows_backdated` is 0, check the address, that the account is listed, and
that its subscription is past_due (subscribe with 4242 4242 4242 4242, change
the card to 4000 0000 0000 0341 in the billing portal, then advance the
subscription's test clock past the renewal date).

## Step 6: go-live (Monday)

Do these in order.

**6a. Remove the test accounts.** Their test-mode subscriptions would otherwise count in production.

```sql
delete from public.billing_test_accounts;
select count(*) as test_accounts from public.billing_test_accounts;   -- 0
```

**6b. Test rows left in `subscriptions`.** With 6a done they give nobody
access, and a real (live) subscription replaces them. Count them:

```sql
select livemode, count(*) as rows from public.subscriptions group by livemode order by 1;
```

Deleting them is optional. If you want to, do it after the reconciliation
report reads "All clear":
`delete from public.subscriptions where livemode is not true;`

**6c. Deploy first.** Deploy production with `NEXT_PUBLIC_BILLING_ENABLED=true`
and the live Stripe settings, and wait until the deploy is live. Doing it the
other way round, with the database switch on while the app still shows
everyone as full, would refuse some saves with no explanation on screen.

**6d. Switch enforcement on.** This block first checks that 6a is done and that
the three exempt accounts are in place and confirmed:

```sql
do $$
begin
  if exists (select 1 from public.billing_test_accounts) then
    raise exception 'NOT switched on: billing_test_accounts still has rows, and their test-card subscriptions would count in production. Run 6a first, then run this again.';
  end if;
  if (select count(distinct lower(u.email)) from public.billing_exempt e join auth.users u on u.id = e.user_id
       where lower(u.email) in ('joe@wattsonelectrical.co.uk', 'admin@plotwire.uk', 'info@fentonselectrical.co.uk')
         and u.email_confirmed_at is not null) < 3 then
    raise exception 'NOT switched on: fewer than 3 exempt accounts. Run supabase/billing-exempt.sql (after the missing account has signed up and confirmed its email), then run this again.';
  end if;
  update public.app_flags set value = true, updated_at = now() where key = 'enforce_billing';
end;
$$;

select (select value from public.app_flags where key = 'enforce_billing')   as enforce_billing,  -- true
       (select count(*) from public.billing_exempt)                         as exempt_accounts,  -- 3
       (select count(*) from public.billing_test_accounts)                  as test_accounts;    -- 0
```

**6e. Optional: revoke share links of accounts that aren't paying.** The
database only checks the token, so a link made before launch keeps working
until it is revoked. That includes a link made by someone who never paid, or
whose subscription has since ended. Run this after 6d if you want those links
to stop:

```sql
update public.planner_settings
   set data = data - 'shareToken'
 where data ? 'shareToken'
   and public.access_level(user_id) in ('try', 'lapsed');
```

**6f. Check.** These are counts only. Every account without a live
subscription or an exemption is `try` until it subscribes.

```sql
select x.level, count(*) as accounts,
       count(*) filter (where x.symbols > public.try_symbol_limit()) as over_25_symbols
  from (select u.id, public.access_level(u.id) as level,
               coalesce((select sum(p.symbol_count) from public.projects p where p.user_id = u.id), 0) as symbols
          from auth.users u) x
 group by x.level order by x.level;
```

Try accounts already over 25 symbols can still open their drawings, save
changes that don't add symbols, and delete drawings. They can't add symbols,
or start a new drawing (even an empty one), until they subscribe or delete
enough to get back under 25. The app applies the same rule. Then do the live
£15 test (see the go-live checklist): subscribe, check that saving works,
refund, cancel.

## Rollback

```sql
update public.app_flags set value = false, updated_at = now() where key = 'enforce_billing';
```

This lifts every database restriction at once. Nothing else needs undoing,
because the tables, functions, policies and triggers do nothing while the
switch is off, except for any accounts still in `billing_test_accounts`. To
take the paywall out of the app as well, unset `NEXT_PUBLIC_BILLING_ENABLED`
and redeploy.

## What the database does and doesn't enforce

While enforcement is on for an account:
- **Try:** at most 25 placed symbols across all its drawings. This holds for insert, update and upsert, for several drawings saved in one request, for symbols moved between drawings, and for saves made in parallel (a per-account lock). Deleting a drawing frees its symbols.
- **Lapsed:** no insert or update on drawings, sketches or planner jobs, no plan-image uploads, and no new or changed share link. Lapsed accounts can still read, export and **delete** their own work (a recorded decision).
- **Unchanged:** account and profile tables (`user_settings`, `company_profile`, `company_logos` and the company-logos bucket, `terms_acceptances`) and planner settings other than the share token. These stay editable by design.

The database **can't** enforce these:
- Outputs made in the browser: PDF, print, CSV, the Save As file and the planner image. The app locks them for Try accounts.
- A share link that already exists, until it is revoked (6e). `planner_shared()` checks only the token. It is not recorded in this repo, so it was left untouched. This is listed in `docs/post-launch-tidy-up.md`.
