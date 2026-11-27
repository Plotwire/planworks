# Test plan: email confirmation removed from the customer journey

Branch **remove-email-check** (27 Nov 2026), merged to master. Use **test
accounts only**. About 10 minutes, on **app.plotwire.uk** (or the test link).

**Before you start:** close every Plotwire tab that was open before, then open
it fresh (or press **Ctrl+F5**).

## What changed, in plain English

Plotwire's confirmation emails didn't reliably arrive, and people couldn't pay
without one. So confirming an email address is no longer part of the journey:

- **Subscribe goes straight to Stripe**, whether or not the email address has
  ever been confirmed. The server no longer checks either.
- **No "Please confirm your email" note** on the dashboard.
- **Plotwire sends no confirmation emails** any more.
- **Left in place, unused:** the two database tables and the confirm page.
  Links people were already sent still open and say "Email confirmed"; they
  just don't change anything. **No SQL to run.**
- **Unchanged:** the security check (Turnstile) on sign-up and password reset,
  worker invites, password reset emails, and the switch-over (accounts that
  were stuck can still sign in).

Sign-up only goes straight in while Supabase's **"Confirm email"** is **OFF**
(Authentication > Sign In / Providers > Email), as set at the switch-over. If
it's ever turned back on, new sign-ups wait for Supabase's email again.

## Steps

1. **A not-confirmed account reaches Stripe:** sign in to a test account that
   never confirmed its email (for example one made after the switch-over, or
   one reset with `supabase/signup-straight-in-test-account.sql`). The
   dashboard has **no** "Please confirm your email" note.
2. Press **Subscribe** (on the Try note or the Trial pill). The Subscribe
   screen shows the **Subscribe** button, with no confirm message and no
   Resend link. Press it: **Stripe's checkout opens**. Back out without paying
   (the browser's back button).
3. **New sign-up:** in a private window, open `https://app.plotwire.uk/?login`
   and create an account with a fresh address. It goes straight in (company
   details first, as now, then the dashboard in Try mode). No note, and **no
   email from Plotwire** arrives. **Subscribe** opens Stripe's checkout. Don't
   pay. Delete the account afterwards (Supabase > Authentication > Users).
4. **An old link:** if you still have a "Confirm your email for Plotwire"
   email, tap its button: the page opens (signed out is fine) and says
   **"Email confirmed"** or **"This link has run out"**. Nothing else happens.
5. **Nothing else moved:** sign in to your own account: no note, Subscribe or
   Billing as before. A **worker** login at `/time`: as before. **Forgot
   password** on the sign-in screen: the security check runs and the reset
   email arrives as before.

## If something's wrong

Note the step number and what you saw (a screenshot helps). To go back, revert
the merge on master; nothing in the database needs undoing.
