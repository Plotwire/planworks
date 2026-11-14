# In-app browser and sign-in messages: test steps

Branch: `inapp-browser` (from master ed182a7). Not on the test link yet: the
test link stays on `lines-and-links` until that's done. Steps 1 to 4 work on
any copy of this branch. The rest need the real sign-in (the test link, or a
preview where the security check works).

## What changed

- **Banner inside Instagram, Facebook, Messenger and TikTok.** On the sign-in,
  sign-up, "Check your email", email-link and terms pages, a yellow banner says
  *"For the best experience, open Plotwire in your phone's browser"*, with two
  steps (three dots at the top right, then Open in browser) and a teal **Copy
  link** button. **Not now** hides it until the page is next opened.
- **Plain messages for every sign-in and sign-up refusal.** Supabase's own
  wording ("Invalid login credentials", "Email not confirmed") never shows.
- **Resend confirmation email.** Shown under "Email not confirmed yet…" when
  signing in, and on the "Check your email" screen after creating an account.
- **Sentry.** Errors thrown by those apps' own scripts ("Java object is gone"
  and similar) are no longer reported. Every report carries an
  `in_app_browser` tag (`instagram`, `facebook`, `messenger`, `tiktok` or
  `no`), and failed sign-ins leave a line in the report's trail saying why
  (for example `signin refused: email_not_confirmed`, never the email).
- **Sentry reports for failed sign-ins.** A report of its own (a warning,
  titled like *Sign-in screen: signin refused (email_not_confirmed)*) for
  three things only: email not confirmed, no connection, and any error the
  screen has no plain message for. Never for a wrong password. Tagged
  `auth_reason` (the reason), `auth_step` (signin, signup, reset, resend or
  newpassword) and `in_app_browser`. One Sentry issue per step and reason.
  The email typed in is never sent; an unmapped error's own message is,
  with any email address in it replaced by `[email]`.
- **Coming Soon page.** Headline now reads *Electrical layouts & quoting,
  built for electricians.* (was *Electrical design & quoting…*).
- **Google sign-in.** Plotwire doesn't offer it, so there's nothing to hide.
- **Phones.** The sign-in page now scrolls if it's taller than the screen.

## Banner (any copy of the branch)

1. On a laptop, open the site with `?login=1&inapp=instagram` on the end of the
   address. The yellow banner shows above **Sign in** and says *You're in
   Instagram's built-in browser*.
2. Tap **Copy link**. It says *Link copied*. Paste it somewhere: it's the
   site's address with `/?login=1`.
3. Tap **Not now**. The banner goes. Reload: it's back.
4. Take `&inapp=instagram` off the address and reload. No banner.

## Banner on your phone

5. Send yourself the link in an Instagram message and tap it. The banner
   shows. On Android, step 2 says *It may say Open in Chrome*; on an iPhone,
   *Open in Safari*.
6. Follow the two steps. Plotwire opens in the phone's own browser with no
   banner.
7. If you can, repeat with Facebook or Messenger, and TikTok.

## Messages (real sign-in needed)

Use a spare email address you own for a new account.

8. Sign in with a wrong password. Red box: *That email and password don't
   match. Check them and try again, or tap "Forgot password?" to set a new one.*
9. Create an account with the spare address, but don't open the email yet.
   The *Check your email* screen now has *No email after a minute?*, the
   security check and a teal **Resend confirmation email** button.
10. Tap **Resend confirmation email**. It says *We've sent the confirmation
    email again.* A second email arrives.
11. Tap it again straight away. It says *We've only just sent an email to this
    address. Wait a minute before asking for another…*
12. Tap **Back to sign in** and sign in with the spare account. Yellow box
    with a clock: *Email not confirmed yet. Check your inbox and tap the link,
    then come back here.* with a **Resend confirmation email** button under
    it. Tap it: you're taken to *Check your email*.
13. Open the link in the email. You're signed in.
14. On your phone, turn on flight mode, then tap **Sign in**. It says
    *Couldn't reach Plotwire. Check your signal or Wi-Fi, then try again.*
15. Afterwards, delete the spare test account in Supabase (Authentication >
    Users) if you don't want to keep it.

## Sentry

16. After step 8 (wrong password): no new Sentry issue.
17. After step 12 (email not confirmed): a new warning issue *Sign-in
    screen: signin refused (email_not_confirmed)*, tagged
    `auth_reason: email_not_confirmed`, `auth_step: signin` and
    `in_app_browser` (`no` on a normal browser). The spare email address
    appears nowhere in it.
18. After step 14 (flight mode): *Sign-in screen: signin refused (network)*.
    It's sent when the signal comes back, so it may take a moment.
19. New reports from the site have an `in_app_browser` tag.
20. No new "Java object is gone" reports arrive. The old issue can be marked
    resolved.

## Coming Soon page

21. Open the site signed out, without `?login=1`, while the Coming Soon page
    is on. The headline reads *Electrical layouts & quoting, built for
    electricians.*

## Checks already run

- `npm test`: all tests pass, including `tests/inapp-browser.test.mjs`
  (every refusal gets a plain message; Instagram, Facebook, Messenger and
  TikTok are spotted and ordinary browsers aren't; Plotwire's own postMessage
  errors still reach Sentry).
- `npm run build` (the build gate) and `node scripts/symbol-library/check.cjs`
  (the symbol check).
- In the browser at phone size: banner, numbered steps, Copy link, Not now, no
  banner in an ordinary browser, sign-up form scrolls to the bottom, desktop
  sign-in looks as before, no console errors.

## Login 400 counts

Claude can't reach Sentry or Supabase's logs. The queries in
`docs/inapp-browser-login-400-counts.sql` are for you to run in Supabase's
Logs Explorer: counts only, by browser type and by reason.
