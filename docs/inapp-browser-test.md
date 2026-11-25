# In-app browser and sign-in messages: test steps

Branch: `inapp-browser`, on the test link through `test-nov16` (testing
only). Steps 1 to 4 work on any copy of this branch. The rest need the real
sign-in (the test link).

## What changed

- **No banner.** People in Instagram, Facebook, Messenger or TikTok's
  built-in browser see the normal sign-in and sign-up pages, with no warning
  up front.
- **"Open in Chrome" on Android.** In Instagram, Facebook or Messenger on an
  Android phone, the sign-in page has one small teal **Open in Chrome**
  button under "New to Plotwire?". One tap opens the sign-in page in Chrome
  (if Chrome isn't there, the phone's usual browser). No instructions text.
  Not on iPhones (a page can't open Safari) and **not in TikTok**: its
  built-in browser doesn't reliably let a page open another app, so it gets
  no button rather than one that might do nothing.
- **A tip only when it's needed.** For in-app browser users only, one line
  *"Tip: if the link opens in a different app, log in there instead."* under
  *"Email not confirmed yet…"* (the Resend button is still there) and on the
  *Check your email* screen after signing up.
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

## No banner (any browser)

1. On a laptop, open the site with `?login=1&inapp=instagram` on the end of the
   address (this pretends to be Instagram). The normal sign-in page, no
   banner, and no Open in Chrome button (a laptop isn't Android).
2. Press **Create an account**: the normal sign-up page, no banner.
3. Take `&inapp=instagram` off the address and reload: the same page.
4. On an ordinary phone browser (Chrome or Safari): no Open in Chrome button.

## Open in Chrome (Android phone)

5. Send yourself the sign-in link in an Instagram message and tap it, so it
   opens inside Instagram. The normal sign-in page, with one small teal
   **Open in Chrome** button under "New to Plotwire?".
6. Tap **Open in Chrome**: the sign-in page opens in Chrome in one tap.
7. If you can, repeat in Facebook or Messenger (same button) and in TikTok
   (no button, by design). On an iPhone, in Instagram: no button.

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
12a. **The tip, only in an app's browser:** in steps 9 and 12 in an ordinary
    browser, there's no tip. Do steps 9 and 12 again inside Instagram's
    browser (open the sign-in link from an Instagram message), or on a laptop
    with `&inapp=instagram` on the address: under *Email not confirmed yet…*
    and on *Check your email* there's one extra line, *Tip: if the link opens
    in a different app, log in there instead.*, and Resend is still there.
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
  TikTok are spotted and ordinary browsers aren't; Open in Chrome only on
  Android in Instagram, Facebook and Messenger, as an intent:// link to the
  sign-in page; the tip only for in-app browsers, in its two places;
  Plotwire's own postMessage errors still reach Sentry).
- `npm run build` (the build gate) and `node scripts/symbol-library/check.cjs`
  (the symbol check).
- In a local copy at phone size, pretending to be Instagram on Android: the
  normal sign-in page, no banner, the Open in Chrome button with the right
  link; no button when pretending to be TikTok, or in an ordinary browser.
- **Not checked:** tapping Open in Chrome on a real Android phone inside
  Instagram or Facebook (that needs the phone: steps 5 to 7), and the tip on
  a real "Email not confirmed" (needs the real sign-in: step 12a).

## Login 400 counts

Claude can't reach Sentry or Supabase's logs. The queries in
`docs/inapp-browser-login-400-counts.sql` are for you to run in Supabase's
Logs Explorer: counts only, by browser type and by reason.
