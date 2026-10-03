# Plotwire billing: Monday go-live checklist (Stripe LIVE mode)

Based on branch `prelaunch`. The kept copy is `docs/billing-go-live-checklist.md` in the repo. Work top to bottom. Every step is a tick box. Anything in `code` is an exact value, path or setting name. Updated 3 Oct 2026 with the red-team fixes (M2, M3 and the step-only Low items).

Key facts before you start:
- Previews and production **share one Supabase database**, so every SQL step affects production straight away.
- Stripe test mode and live mode are separate. Nothing you set up in test (product, price, webhook, portal, coupons) carries over to live. Make sure the Dashboard's **Test mode** toggle is **off** for sections 1-4.
- The app only switches billing on for users when `NEXT_PUBLIC_BILLING_ENABLED=true` is built into production. The database only enforces once `app_flags.enforce_billing` is true (RUN-ORDER step 6d). Do the **deploy first, then the database switch**. Rolling back is the reverse: **database switch off first**, then the app (section 9).
- **Set the Production billing variables (section 5) in the same sitting as the `prelaunch` production deploy (section 8 step 2), straight before it.** Between the two, **never Redeploy the current production deployment and don't push to `master`**. Either would build the OLD billing code with the live keys: no double-charge guard, paying customers shown as Try, and leftover test rows counted.

---

## 1. Product and price

- [ ] Stripe > Product catalogue > **Add product**. Name `Plotwire`. Description: one line, for example "Plotwire subscription, one user". Tax code: SaaS / software if you use Stripe Tax.
- [ ] Price: **Recurring**, **£15.00**, currency **GBP**, billing period **Monthly**, flat rate (quantity 1), **no trial**.
  - The checkout sends no trial and quantity 1 (`lib/billing.js`). Try mode replaces the trial.
- [ ] Copy the price id (`price_...`). It goes into `STRIPE_PRICE` (section 5).
  - Only this price gives the plan name `standard`. Reconciliation flags any subscription on another price.
- [ ] Don't create a second price or tier. The portal must not offer plan switching (section 3).
- [ ] Settings > **Payment methods**: allow **Cards** (Apple Pay and Google Pay included) and **Link** only. **Bacs Direct Debit, SEPA Direct Debit and every other delayed method must stay OFF, permanently.** The checkout doesn't pin payment methods, so this Dashboard setting is the only thing stopping a Direct Debit "payment" unlocking the app days before the money clears (or never clears). Check it again after any change to Stripe's payment settings, and in section 8 step 5.
- [ ] Settings > **Business**: public business name, support email `admin@plotwire.uk`, statement descriptor (for example `PLOTWIRE`), UK address, branding (logo, navy and teal colours).

## 2. Webhook endpoint

- [ ] Developers > Webhooks > **Add endpoint** (live mode):
  - URL: `https://app.plotwire.uk/api/billing/webhook`
  - API version: `2026-05-27.dahlia`. This matches the `stripe` 22.2.3 SDK the code uses. The code reads `invoice.parent.subscription_details` and falls back to the old field, but matching versions avoids surprises.
  - Events, **exactly these six**. They are `HANDLED_EVENT_TYPES` in `lib/stripeWebhook.js`. Reconciliation flags any that are missing.
    - [ ] `checkout.session.completed`
    - [ ] `customer.subscription.created`
    - [ ] `customer.subscription.updated`
    - [ ] `customer.subscription.deleted`
    - [ ] `invoice.paid`
    - [ ] `invoice.payment_failed`
- [ ] Reveal the **Signing secret** (`whsec_...`). It goes into `STRIPE_WEBHOOK_SECRET` (Production only).
- [ ] There must be only one enabled live endpoint pointing at `/api/billing/webhook`. A disabled duplicate shows up as a note in the report.
- [ ] Don't point any **test-mode** endpoint at `app.plotwire.uk`. Production ignores test events and raises a Sentry `test-event-in-production` warning. Test endpoints belong on the `stripe-plotwire-test` preview URL only.

## 3. Customer portal

Settings > Billing > **Customer portal** (live mode):

- [ ] Business information:
  - Terms of service: `https://app.plotwire.uk/terms`
  - Privacy policy: `https://app.plotwire.uk/privacy`
  - These are the public pages in `lib/legal.js` (`LEGAL_LINKS`). `/data-processing` is also public if you want to link it.
- [ ] Default redirect link: `https://app.plotwire.uk/`. The code also passes `return_url` itself.
- [ ] **Cancellations: on**, mode **At the end of the billing period**. No immediate cancellation and no prorated refund. Cancellation reason survey is optional.
- [ ] **Payment methods: customers can update** (on). An unpaid or past_due invoice gets paid here.
- [ ] **Invoice history: on**.
- [ ] Customer information: allow updating email, billing address and tax id (optional).
- [ ] **Subscriptions: switching plans OFF** and **updating quantities OFF**. There is one plan and one user per subscription (Terms 3.3).
- [ ] Pause subscriptions: **off**.
- [ ] Save. Open the portal once from the app (the Billing button) after the live test in section 8 to confirm it loads. If it isn't configured, the app returns a 409 "can't open billing" instead.

## 4. Failed payments, customer emails, coupons, Checkout

Settings > Billing > **Subscriptions and emails** (Revenue recovery > Retries), live mode:

- [ ] **Smart Retries: on**, with the retry window set to **1 week**, to match the app's 7-day grace (`PAST_DUE_GRACE_DAYS = 7` in `lib/access.js` and `past_due_grace_days()` in `try-mode.sql`).
- [ ] **If all retries for a payment fail: Cancel the subscription.** Never "leave the subscription past-due". This is what Terms 4.6 promises: retry, tell the user, then read-only. The app already goes read-only 7 days after the first failure whatever this is set to. Cancelling closes the subscription properly so the account shows Lapsed and the person can resubscribe cleanly.
- [ ] Invoice status after all retries: "mark as uncollectible" or "leave as-is" both work. The grace clock counts uncollectible invoices as unpaid.
- [ ] Settings > Business > **Customer emails** (live):
  - [ ] **Successful payments** (receipts): on
  - [ ] **Refunds**: on
  - [ ] **Failed payments**: on. This is the "user told" part of Terms 4.6.
  - [ ] **Expiring cards**: on
  - [ ] Payment-update links: use the **Stripe-hosted page / customer portal** link.
  - [ ] Upcoming renewal reminders: optional (off is fine for monthly).
- [ ] **Trials:** none. Never enable "pause if no payment method at trial end". Paused subscriptions block a new checkout and must be resumed or cancelled by hand.
- [ ] **Promotion codes:** checkout has `allow_promotion_codes: true`. In live, review Product catalogue > Coupons. Archive anything you don't intend customers to use (especially any 100% coupon), and give the ones you keep a max-redemptions limit and/or "first-time customers only".
- [ ] Settings > **Checkout**: if Stripe offers "Limit customers to one subscription", turn it on. The code already enforces one subscription per user (the double-charge guard sends existing subscribers to the portal), so this is a second layer.
- [ ] Anything made by hand in the Dashboard (a customer or a subscription) **must have metadata `user_id` = the Plotwire account id**. Without it the webhook can't map it to anyone, and reconciliation flags it.

## 5. Vercel Production environment variables

Vercel only applies an environment change to **new** deployments. `NEXT_PUBLIC_*` values are **compiled into the build**, so they must be set before the production build runs.

> **Timing (red team M3).** Get the values ready now, but **enter the Production billing variables only in section 8 step 2, straight before the `prelaunch` deploy, in the same sitting.** Until that deploy is live, **don't press Redeploy on the current production deployment and don't push to `master`**. Production would then run the OLD billing code with live keys. Preview-scoped variables (test keys) can be set any time.

Set **live keys for the Production environment only**. Preview (including `stripe-plotwire-test`) keeps the **test** keys. Reconciliation raises `preview-live-key` and `production-test-key` if these get mixed up.

**Build-time (compiled in; change, then redeploy):**

| Variable | Production value | Notes |
|---|---|---|
| `NEXT_PUBLIC_BILLING_ENABLED` | `true` | Turns on the paywall, Try mode, Subscribe, Billing and "Confirming your payment…". Unset means billing is off and everyone is full. |
| `NEXT_PUBLIC_COMING_SOON` | `false` when opening publicly | Unset or anything other than `false`/`0`/`off` keeps the holding page up (`?login` still reaches sign-in). Can be done on a different day. Leave it unset on Preview. |
| `NEXT_PUBLIC_APP_URL` | `https://app.plotwire.uk` | Fallback Stripe return origin (`lib/billing.js`). Also read server-side, but compiled in. |
| `NEXT_PUBLIC_SUPABASE_URL` | existing | Unchanged. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | existing | Unchanged. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key | Cloudflare: allow hostname `app.plotwire.uk`. The **secret** goes in Supabase > Authentication > Bot and Abuse Protection, not in Vercel. |

**Runtime (server-only; still redeploy so new functions pick them up):**

| Variable | Production value | Notes |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_...` (or `rk_live_...`) | Its prefix sets the mode: the webhook accepts live events only and reconciliation compares live rows only. A restricted key needs **write**: Checkout Sessions, Customers, Subscriptions, Invoices, Customer portal sessions; **read**: Events, Webhook endpoints, Refunds, Charges, Invoice payments, Prices. If in doubt, use the standard secret key. |
| `STRIPE_PRICE` | the live `price_...` from section 1 | |
| `STRIPE_WEBHOOK_SECRET` | the live endpoint's `whsec_...` from section 2 | A mismatch shows as Sentry `signature-mismatch`. |
| `SUPABASE_SERVICE_ROLE_KEY` | existing | Server only. Never `NEXT_PUBLIC_`. |
| `CRON_SECRET` | `openssl rand -hex 32` | Required, at least 16 characters, or `/api/admin/reconcile` answers 503 and alerts. Vercel Cron sends it automatically. |
| `RESEND_API_KEY` | Resend API key | Without it the report is built but not emailed. |
| `RECONCILE_EMAIL_TO` | optional | Default `admin@plotwire.uk` (comma-separated list allowed). |
| `RECONCILE_EMAIL_FROM` | optional | Default `Plotwire billing <billing@plotwire.uk>`. Needs the verified domain (section 7). |
| `VERCEL_ENV` | automatic | `production` means live events only. Don't set it. |

- [ ] Preview scope check: Preview has **test** `STRIPE_SECRET_KEY` / `STRIPE_PRICE` / `STRIPE_WEBHOOK_SECRET`, and `NEXT_PUBLIC_BILLING_ENABLED=true` only for the `stripe-plotwire-test` branch if you still want it.
- [ ] Turn on **Deployment Protection** for preview URLs (they reach the shared database). Stripe can't log in to Vercel, so once protection is on, test-mode webhooks to the `stripe-plotwire-test` preview get a 401 unless you add a bypass. Do this **before** (or in the same sitting as) turning protection on:
  - [ ] Vercel > Project > Settings > **Deployment Protection** > **Protection Bypass for Automation** > **Add a secret** (Vercel generates it, or paste a 32-character one). Copy it. Vercel also exposes it to the app as `VERCEL_AUTOMATION_BYPASS_SECRET`; nothing in the code needs it.
  - [ ] Stripe Dashboard, **Test mode on** > Developers > Webhooks > the preview endpoint > **Update details**. Set the URL to
    `https://<stripe-plotwire-test preview host>/api/billing/webhook?x-vercel-protection-bypass=<the secret>`
    Keep the same six events and the same signing secret. The query string doesn't affect Stripe's signature, which covers only the body.
  - [ ] Check: in that endpoint's **Event deliveries**, **Resend** a recent event and confirm **200**, not 401.
  - [ ] Manual reconcile calls on the preview need the same bypass: add `-H "x-vercel-protection-bypass: <the secret>"` to the curl command.
  - [ ] Never add the bypass to the **live** endpoint. Production (`app.plotwire.uk`) isn't behind protection.
- [ ] Vercel > Settings > **Cron Jobs**: after the production deploy, `/api/admin/reconcile` is listed on `0 6 * * *` (runs some time in the 06:00 UTC hour; crons run on production only).

## 6. SQL run order (Supabase SQL Editor)

Full detail and expected values are in `supabase/RUN-ORDER.md`. Every check is **counts only**. Every file is safe to re-run. **Never run `supabase/paywall-policies.sql`** (if pasted, it errors and applies nothing).

Before Monday (can be done any time, users notice nothing):

- [ ] **Backup first.** Database > Backups shows a recent backup, or take one (`supabase db dump`).
- [ ] Authentication > Sign In / Providers > Email: **"Confirm email" is ON**.
- [ ] **Step 0** (read-only check from RUN-ORDER). Expect `rls_on_everywhere = true`, `plan_images_bucket = 1`, **`projects_id_nullable = NO` and `projects_null_ids = 0`** (the 25-symbol cap relies on every drawing having an id; if not, stop and ask). Write down `drawings`, `projects_size` and `subscription_rows`.
- [ ] **Step 1** `supabase/subscriptions-cancel-at.sql`, only if `has_cancel_at = 0`.
- [ ] **Step 2** `supabase/billing-hardening.sql`. It must run **before the prelaunch code is deployed anywhere**. Without it every subscription event gets a 500. Check: `hardening_columns = 2`, `stripe_events_rls = true`, `stripe_events_policies = 0`.
- [ ] **Step 3** `supabase/try-mode.sql`, at a quiet time (it briefly locks drawings and storage). Last result, one row: `enforce_billing false`, `billing_policies 8`, `triggers 2`, `test_accounts 0`, `drawings` = step 0, `drawings_without_count 0`.
- [ ] Owners sign up and **confirm their email**: `joe@wattsonelectrical.co.uk`, `admin@plotwire.uk`, `info@fentonselectrical.co.uk`.
  - [ ] Each signs up at **`https://app.plotwire.uk/?login`**. While Coming Soon is up, the plain address only shows the holding page; `?login` opens the sign-in screen with "Create an account".
  - [ ] Each clicks the link in their confirmation email.
  - [ ] **Each then signs in once with their own password** and sees their own dashboard, before step 4 is run. If an address turns out to be already registered, or an owner can't sign in with the password they chose, **don't run step 4: stop and ask**. Someone else may hold that address.
- [ ] **Step 4** `supabase/billing-exempt.sql`. Expect `expected 3, accounts_found 3, unconfirmed 0, exempt 3`. Re-run after any late sign-up.
- [ ] Supabase Storage > `plan-images` bucket: set a **file size limit** (Try accounts can upload plan images).

Monday, in this order:

- [ ] **6a** `delete from public.billing_test_accounts;`, then check `test_accounts = 0`.
- [ ] **6b** Count test-mode rows: `select livemode, count(*) from public.subscriptions group by livemode;`. They give nobody access once 6a is done. To identify them: `livemode is not true` (false = written by the test preview; null = written before `billing-hardening.sql`). **Deleting them is optional**; if you do, run `delete from public.subscriptions where livemode is not true;` only **after** the first reconciliation email reads "All clear".
- [ ] **6c** Deploy production with `NEXT_PUBLIC_BILLING_ENABLED=true` and the live Stripe variables (section 8, step 2), set in the same sitting, straight before the deploy. Wait until it's live.
- [ ] **6d** Run the guarded go-live block from RUN-ORDER.md. It refuses (`NOT switched on: ...`) unless test accounts are 0 and all 3 exempt accounts are confirmed. Expect `enforce_billing true`, `exempt_accounts 3`, `test_accounts 0`. **This flip is the LAST database step.**
- [ ] **6e** (optional) Revoke share links of `try`/`lapsed` accounts (the update in RUN-ORDER).
- [ ] **6f** Count-only check of accounts per access level (and how many Try accounts are over 25 symbols).

## 7. Sentry alert and Resend sender

Sentry (org `plotwire-uk-ltd`, project `javascript-nextjs`) > Alerts > Create Alert > **Issues**:

- [ ] Name: `Billing: webhook error or reconciliation mismatch`. Environment: **All**.
- [ ] WHEN (any): **a new issue is created**; **the issue changes state from resolved to unresolved**; **the number of events in an issue is more than 10 in 1 hour**.
- [ ] IF (**all**): the event's tags match `area` **starts with** `billing-` (only `billing-webhook` and `billing-reconcile` use that prefix). For production only, add `vercel_env` **equals** `production` in the **same "all" block**. Never use an "any" block with extra filters: it would match every production event.
- [ ] THEN: send a notification to **Member `admin@plotwire.uk`**. Action interval **60 minutes**.
- [ ] `admin@plotwire.uk` is a member of the Sentry org with issue-alert emails on.
- [ ] What it catches (problem tag): webhook `handler-error`, `ledger-error`, `ledger-not-marked`, `unexpected-error`, `not-configured`, `misconfigured`, `signature-mismatch`, `bad-signature`, `test-event-in-production`, `unmapped`, `test-over-live`; reconcile `mismatch` (one issue per day with mismatches), `check-failed`, `email-failed`, `not-configured`, `route-error`.
- [ ] Resolve, or ignore with a reason, each billing issue once explained, so it can alert again. `signature-mismatch` means `STRIPE_WEBHOOK_SECRET` doesn't match the endpoint's signing secret.

Resend:

- [ ] Domain `plotwire.uk` **verified** (SPF and DKIM DNS records), so `billing@plotwire.uk` can send. Otherwise the send fails with 422 and the route answers 502 (and Sentry `email-failed`).
- [ ] API key with sending access, put in `RESEND_API_KEY` (section 5).

## 8. Launch sequence and live £15 test

1. - [ ] Sections 1-4 done, section 5 values **ready but not yet entered in Production** (Preview test values can be in). SQL steps 0-4 done.
2. - [ ] **In one sitting:** enter the section 5 Production variables, then **immediately deploy production** from `prelaunch` (once merged as you decide). Between the two, **don't Redeploy the current production deployment and don't push anything else to `master`**. Check:
   - [ ] the deployment is live and `/api/admin/reconcile` appears under Cron Jobs.
   - [ ] signed in as an exempt account, the app is full and shows no paywall.
3. - [ ] **SQL 6a-6d** (section 6). Check: `enforce_billing true`.
4. - [ ] Manual reconciliation dry run:
   `curl -H "Authorization: Bearer $CRON_SECRET" "https://app.plotwire.uk/api/admin/reconcile?email=0"`
   Expect 200 and `"clean": true`. Any `issues` are listed with a reason; fix them before taking money.
5. - [ ] **Live £15 test.** First re-check Stripe > Settings > Payment methods: **Direct Debit (Bacs/SEPA) still off**, cards and Link only. Sign up a fresh, non-exempt account with a real email you control (not one of the three exempt ones) at `https://app.plotwire.uk/?login` if Coming Soon is still up. Confirm the email. Check it's **Try** (25-symbol cap). Click Subscribe and pay £15 with a real card. Check:
   - [ ] the app shows "Confirming your payment…" and then unlocks (Full) within a minute.
   - [ ] Stripe > Webhooks > the live endpoint: deliveries of `checkout.session.completed`, `customer.subscription.created`/`updated` and `invoice.paid` all return **200**.
   - [ ] row status, count only: `select status, livemode, count(*) from public.subscriptions where livemode group by 1,2;` gives `active / true / 1`.
   - [ ] access level: saving a drawing with more than 25 symbols works.
   - [ ] the Stripe receipt email arrived.
   - [ ] Click Subscribe again (or open Billing). It goes to the **portal**, not a second checkout.
6. - [ ] **Refund and cancel** (always both). Stripe > Payments > the £15 payment > **Refund** in full. Then Subscriptions > that subscription > **Cancel immediately**. Check:
   - [ ] the `customer.subscription.updated`/`deleted` deliveries return 200.
   - [ ] the row status is `canceled`, and the account is **Lapsed** (read-only: opening works, saving is refused with "Your subscription isn't active").
   - [ ] the refund email arrived.
   - Refunding without cancelling leaves the account Full; reconciliation would flag "refunded but still running".
7. - [ ] Optional: from the test account, open Billing to check the portal loads with the Terms and Privacy links.
8. - [ ] When ready to open publicly: set `NEXT_PUBLIC_COMING_SOON=false` (Production only) and **redeploy**. Check: the holding page has gone, and sign-up works (Turnstile check passes).
9. - [ ] **Next morning (after about 07:00 UK):** the email "Plotwire billing: **All clear**" arrives at `admin@plotwire.uk` (subject has no `[Stripe test mode]`). If it says "N issues", the email lists each one. If no email comes, see the cron logs in Vercel (there's no Sentry cron monitor yet). Then, optionally, do the 6b delete.

## 9. Rollback

**Rule: the database switch goes off FIRST, every time.** Never take billing out of the app (unset the variable, redeploy or Instant Rollback) while `enforce_billing` is still true. The app would show no limits while the database keeps refusing Try saves over 25 symbols and every Lapsed save, with no explanation on screen.

1. - [ ] **Database enforcement off.** This lifts every database restriction at once, with nothing else to undo:
   `update public.app_flags set value = false, updated_at = now() where key = 'enforce_billing';`
   Check: `select value from public.app_flags where key = 'enforce_billing';` gives `false`. Often this alone is enough.
2. - [ ] **Then, only if needed, the paywall out of the app:** unset `NEXT_PUBLIC_BILLING_ENABLED` in Production and **redeploy**. Now everyone is full again, exactly as before.
- [ ] **Back to the holding page** (independent of the above): unset `NEXT_PUBLIC_COMING_SOON` (or set it to `true`) and redeploy.
- [ ] **Bad deploy:** **step 1 first**, then Vercel > Deployments > the previous production deployment > **Instant Rollback**. Remember the old build has its own compiled `NEXT_PUBLIC_*` values. If you roll back to a deployment from **before `prelaunch`** while the live keys are set, it runs the OLD billing code with them. So also archive the live price (below) until `prelaunch` is back, then run the reconciliation and fix anything it lists. The SQL from steps 1-4 can stay: with `enforce_billing` false it does nothing, and the old code ignores the new columns and tables.
- [ ] **Stop taking payments without touching the app:** archive the live price so no new checkout can start (checkout then fails with an error instead of charging). Keep the webhook endpoint **enabled**, so renewals and cancellations of existing subscribers still reach the database.
- [ ] **Customers charged during a rollback:** refund and cancel each in Stripe, or leave the subscriptions running and they unlock again when billing is back on. The next reconciliation email lists anyone paying but not unlocked.
