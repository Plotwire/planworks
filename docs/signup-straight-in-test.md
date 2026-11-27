# Test plan: Sign-up straight in, email confirmed before paying

> **Update, 27 Nov 2026 (branch remove-email-check):** the confirm-before-
> paying part has been taken out. Subscribe now goes straight to Stripe,
> there's no dashboard note, and Plotwire sends no confirmation emails. The
> tables and the confirm page stay in place, unused. Steps:
> `docs/remove-email-check-test.md`. The switch-over below still stands.

Branch **signup-straight-in**, on the **stripe-plotwire-test** link. Use
**test accounts only**. About 30 minutes for Part A (laptop and phone).
Part B is after the merge and the switch-over.

**Before you start:** close every Plotwire tab that was open before the test
link was updated, then open it fresh (or press **Ctrl+F5**).

## What's new, in plain English

- **Straight in.** Once Supabase's "Confirm email" is turned off (the
  switch-over, below), someone who signs up lands straight in Plotwire, in
  Try mode, as now. No "Check your email" screen, no link to click first.
  Turnstile still runs on the sign-up form.
- **A calm note on the dashboard** while their email isn't confirmed:
  **"Please confirm your email — we've sent a link to [email]."**, with
  **Resend**, **Change email** and a cross. Not a pop-up. The cross hides it
  until the browser is closed. Everything else works as normal.
- **Confirm before paying.** On the Subscribe screen, until the email is
  confirmed, the Subscribe button is replaced by **"Confirm your email
  address before you subscribe."**, where the link went, and **Resend
  link**. The server checks too, so Stripe is never reached without it. Once
  they click the link (on any device), the screen moves on by itself within
  about 15 seconds, or as soon as they come back to the tab.
- **The link works anywhere.** It opens a Plotwire page that just says
  **"Email confirmed"**. No need to be signed in, or to use the same browser
  or phone (good for Instagram and Facebook's built-in browsers). Links last
  7 days. Resend: once a minute, at most 10 a day.
- **The email** comes from **Plotwire <accounts@plotwire.uk>** (replies go to
  admin@plotwire.uk), subject **"Confirm your email for Plotwire"**. It's sent
  through Resend directly, not through Supabase.
- **Change email** (for a typo at sign-up): the account's sign-in address
  changes straight away and a new link goes to the new address. Only before
  the email is confirmed.
- **Everyone who has already confirmed** (every account from before the
  switch-over that clicked Supabase's link) sees nothing new and subscribes
  as before.
- **Worker logins (Timesheets)** see nothing new.

## Before Part A (Supabase SQL editor)

The emails need `RESEND_API_KEY` on the preview, as for worker invites (it's
already there if invites worked on the test link). `ACCOUNT_EMAIL_ADDRESS` is
optional (default `accounts@plotwire.uk`).

1. Run **`supabase/signup-straight-in.sql`**. It only adds two empty tables,
   used by nothing live, so it's safe now. Expect `new_tables 2`, `rls_on 2`,
   `rules 0`, `rows 0`.
2. Run **`supabase/signup-straight-in-test.sql`**. Expect a red message
   **"TEST FINISHED: 11 passed, 0 failed…"**. Nothing is saved.
3. On the test link, sign up a **new test account** (for example
   `admin+confirm1@plotwire.uk`) and confirm it with Supabase's email, as
   today ("Confirm email" is still on). Sign in once, then sign out.
4. In **`supabase/signup-straight-in-test-account.sql`**, replace
   `TEST_EMAIL_HERE` with that test address everywhere it appears, and run it.
   Expect `accounts_found 1`, `not_confirmed_yet 1`. That account now behaves
   like a brand-new sign-up after the switch-over. Don't change the file in
   the repo.

## Part A: test link (laptop, plus your phone)

1. **The note:** sign in to the test account. On the dashboard, at the top:
   the amber clock and **"Please confirm your email — we've sent a link to
   admin+confirm1@plotwire.uk."**, with **Resend**, **Change email** and
   **×**. A confirmation email has arrived (check junk too), from
   **Plotwire**, subject **"Confirm your email for Plotwire"**.
2. **Resend:** press **Resend**: "Sent. Check your inbox…", and a second email
   arrives. Press it again straight away: **"We sent a link a moment ago.
   Wait a minute, then try again."**
3. **Hide it:** press **×**: the note goes. Reload the page: still gone.
   Open the test link in a new **private window** and sign in: it's back
   there.
4. **Subscribe waits:** press **Subscribe** (on the Try note or the Trial
   pill). The Subscribe screen shows **"Confirm your email address before you
   subscribe."**, the address, and **Resend link**, with no Subscribe button.
   Everything else in the app still works (draw a few symbols, open the
   quote).
5. **Confirm on another device:** on your **phone**, open the **first**
   email (from step 1, not the resent one: older links still work) and tap
   **Confirm my email**. Don't sign in on the phone. It shows **"Email
   confirmed"**. Tap it again: **"Email already confirmed"**.
6. **Back on the laptop**, still on the Subscribe screen: within about 15
   seconds (or as soon as you click back into the window) the **Subscribe**
   button is back. Press it: Stripe's **test** checkout opens. Back out
   without paying (the browser's back button). The dashboard note has gone.
7. **Reset:** run the test-account SQL again (same address). It also forgets
   the old links, so they now say **"This link doesn't work"**. Reload the
   dashboard: the note is back, and a fresh email arrives.
8. **Change email** (a minute or more after the last email, as each change
   sends one): press **Change email**, type a second test address you
   can read (for example `admin+confirm2@plotwire.uk`), press **Save**. The
   note now names the new address, and an email arrives **there**. Try
   **Change email** with an address that already has a Plotwire account
   (yours): **"That email already has a Plotwire account. Use a different
   one."**
9. **Sign in with the new address:** sign out, then sign in with
   `admin+confirm2@plotwire.uk` and the same password. It works; the note is
   there. Tap the link from step 7 (sent to the **first** address): **"This
   link is for an old address"**. Tap the link sent to the **new** address:
   **"Email confirmed"**, and the note goes.
10. **Instagram / Facebook browser (Android or iPhone):** reset the account
    with the test-account SQL, this time with the **confirm2** address, and
    reload the dashboard so a new link is sent. Send yourself that link in an
    Instagram or Messenger chat and tap it there: it says **"Email
    confirmed"** in the built-in browser, no sign-in.
11. **Nothing new for everyone else:** sign in to an account that confirmed
    long ago (yours): no note, and **Subscribe** (if it isn't exempt) goes to
    Stripe as before. Sign in to a **worker** login at `/time`: no note,
    nothing changed.
12. **Tidy up:** delete the test accounts in Supabase > Authentication >
    Users (their rows go with them).

## Switching over (after the merge to master, in this order)

Nobody is locked out at any point: before step 3 sign-up works exactly as
today; after it, sign-up goes straight in.

1. **`supabase/signup-straight-in.sql`** has been run (Part A, step 1).
2. **Merge** signup-straight-in to master and wait until **production is
   Ready**.
3. Run **`supabase/signup-straight-in-switch.sql`**. It lets every account
   stuck "waiting for verification" sign in with the password they chose,
   and records them as **not confirmed yet** (so they get the note, a link,
   and can't subscribe until they click it). Expect
   `still_waiting_in_supabase 0`.
4. **Straight away:** Supabase > **Authentication** > **Sign In / Providers**
   > **Email** > turn **"Confirm email" OFF** > **Save**. Change nothing
   else on that page ("Secure email change" stays as it is).
5. Run **`supabase/signup-straight-in-switch.sql` once more**. It picks up
   anyone who signed up between steps 3 and 4. Expect
   `still_waiting_in_supabase 0`.

Never run the switch file, or turn "Confirm email" off, before step 2: the
live app would let people in without the confirm-email note or the check
before paying.

## Part B: production, after the switch-over

1. Open **`https://app.plotwire.uk/?login`** in a private window and create
   an account with a fresh address you control. It goes **straight in**
   (company details first, as now, then the dashboard in Try mode) with the
   note at the top. The email arrives from Plotwire.
2. Press **Subscribe**: the confirm message and **Resend link**. Tap the link
   on your phone: **"Email confirmed"**. The Subscribe button comes back.
   Don't pay. Delete the account afterwards.
3. Count check (counts only):
   `select count(*) filter (where confirmed_at is null) as waiting, count(*) filter (where confirmed_at is not null) as confirmed from public.email_confirmations;`

## If something's wrong

Note the step number and what you saw (a screenshot helps).

- **To go back before the switch-over:** just don't merge;
  `supabase/signup-straight-in-undo.sql` removes the two tables.
- **To go back after it:** turn "Confirm email" back **ON** first, put master
  back to before the merge, then run the undo file. People let in by the
  switch file stay able to sign in.
