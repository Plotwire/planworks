# Test plan: Timesheets invites, old weeks, worker privacy notice

Branch **timesheets-invites**. About 30 minutes: the **laptop** (you, the boss)
and a **phone** (the worker).

## Where to test

The test link stays on test-nov16 for now. Test this on the branch's own
preview: **planworks-git-timesheets-invites-plotwire.vercel.app**. Or tell me
when you're done with test-nov16 and I'll move the test link here.

- **Signing in as you:** add that preview address to the Cloudflare Turnstile
  hostnames, as for the other branch previews, or sign-in fails there. The
  worker's invite page doesn't need it: it signs them in without the sign-in
  form.
- **Invite emails** need `RESEND_API_KEY` on the preview, as well as on
  production. If **Invite** says *"Invite emails aren't set up on this site
  yet"*, add it to Vercel's Preview environment and redeploy.
- The invite link in the email points at the site it was sent from. From
  the preview, the worker's phone must be signed in to Vercel (like your
  iPad), or the link stops at Vercel's sign-in.

## First: the database (about 5 minutes)

The live app keeps working with this change. Nothing it uses is removed,
renamed or changed, and the new parts can only be reached from Plotwire's
server.

1. **Optional, to see nothing is lost:** note the numbers from
   `select count(*) as entries from public.timesheet_entries;` and
   `select count(*) as workers from public.timesheet_operatives;`.
2. Run **`supabase/timesheets-invites.sql`**. It ends with one row:
   - `invites_table` 1, `worker_login_rule` 1, `rules` 18, `functions` 25,
     `waiting_invites` 0;
   - `entries` and `workers`: the same as in step 1.

   If it stops with "already been run", "self-check failed" or "a worker is
   linked to a login that isn't marked", nothing was changed. Send me the
   message.
3. Run **`supabase/timesheets-invites-test.sql`**. Expect a red
   **"TEST FINISHED: … passed, 0 failed."**, and everything it made is undone.
   It checks:
   - the app can't reach any of it;
   - inviting and sending again, with the old link stopping;
   - refusals: a customer's email, your own, another company's worker, and
     no add-on;
   - a link that has run out;
   - only a worker login for the invited email can accept;
   - the notice version is recorded;
   - cancelling, and removing with hours kept;
   - inviting the same email again, and the daily limit.
4. **If something goes wrong later:** `supabase/timesheets-invites-undo.sql`
   takes out exactly what step 2 added, and nothing else.

## Part A: remove the two test workers (laptop)

1. Sign in as you on the branch preview → **Timesheets** → **Workers**.
2. On **Test Worker One**'s card, press **Remove**. It asks: "Remove Test from
   your team? They won't be able to sign in. Their hours stay in your
   records." Press **Remove**.
   - A green line says they're off your team. Their card goes.
   - Go back to a week they had hours in: the card is still there, marked
     **Removed**, with the hours.
3. Do the same for **Test Worker Two**.
4. On the phone, try signing in at `/time` as admin+worker1: it's refused, as
   their login has gone. The email can now be invited properly (Part B).

## Part B: invite a worker (laptop)

1. **Workers → Invite worker**. Name `Test Worker One`, email
   `admin+worker1@plotwire.uk`. Press **Send invite**.
   - It says "Invite sent to admin+worker1@plotwire.uk."
   - **Invites waiting** shows them with "Sent …", **Resend** and **Cancel**.
2. **The email** (check admin@plotwire.uk's inbox):
   - from **"<your business name> via Plotwire"**;
   - subject "<your business name> has invited you to Plotwire Timesheets";
   - a teal **Set up my timesheet** button, and the link written out;
   - "works for 7 days". Reply-to is your email.
3. Press **Resend** straight away: "only just sent. Wait a minute". A minute
   later, Resend works and a new email comes. **The first email's link
   stops working** (try it in Part E).
4. **Cancel**: invite `admin+worker3@plotwire.uk`, then **Cancel** it →
   "Cancel …'s invite?" → **Cancel invite**. It goes from the list, and its
   link says "doesn't work".

## Part C: refusals (laptop)

Each one shows a clear message in the Invite box, and nobody is added:

1. **Your own email**: "That's your own email…".
2. **An email with its own Plotwire customer account** (any test customer
   login you have): "That email already has its own Plotwire customer account,
   and a customer can't also be someone's worker…".
3. **Not an email** (e.g. `dave`): "Enter a full email address…".

## Part D: the worker joins (phone)

1. On the phone, open the **newest** invite email and tap **Set up my
   timesheet**.
   - It opens **"<your business name> has invited you"** and the email they'll
     sign in with.
   - No Coming Soon page, terms page or company set-up.
2. **Continue** → **Set your password**. A short one gets "Use a password of at
   least 8 characters." Enter a proper one, then **Save and open my
   timesheet**.
3. **The privacy notice** appears first: "Your timesheet and your privacy",
   your wording with your business name filled in. Tap **I understand**.
4. Their **week** appears. At the bottom, a small **Privacy** link shows the
   notice again, with **Close**.
5. Sign out (top right). At `/time`, sign in with the email and the new
   password: straight to the week, with no notice this time.
6. On the laptop, **Workers**: they've left **Invites waiting** and have a
   card.

## Part E: links that can't be used (phone)

1. Tap the link in the **first** email (the one replaced by Resend):
   "This invite link doesn't work" with **Sign in**.
2. Tap the link you just used in Part D again: the same message.
3. A link that has run out (7 days) can't be tested quickly. The database
   test covers it ("This invite has run out. Ask … to send it again.").

## Part F: in-app browsers (Android phone)

1. Invite `admin+worker2@plotwire.uk`. On an **Android** phone, open the link
   in Chrome, then add `&inapp=instagram` to the end of the address. That
   makes the page behave as if it's inside Instagram.
   - A small **Open in Chrome** button appears above Continue. On an iPhone
     there's no button (an iPhone can't do it).
2. Continue and set a password. Under the button: "Tip: you're in Instagram's
   own browser. Next time, open …/time in Chrome or Safari and sign in
   there."
3. **If you can:** send the invite link to yourself in Instagram or Facebook
   Messenger on Android and tap it there. The same button shows, and it opens
   the page in Chrome.

## Part G: remove a worker who's joined (laptop + phone)

1. Have the worker from Part D record an hour on today.
2. On the laptop, **Remove** them.
   - On the phone, refresh: "Your login isn't on a team yet". They can't sign
     in again.
   - On the laptop, their hours for today are still there (card marked
     **Removed**), and in the Excel and CSV exports.

## Part H: look back at old weeks (laptop)

1. **Workers**: the arrows go back week by week. The right arrow stops at this
   week.
2. **Go to date**: pick a date in October. It shows that week (Monday to
   Sunday), and **This week** appears to come back.
3. Each worker's card shows that week's hours. Nothing can be changed here.
   A submitted week can be **reopened** for the worker to change.

## Part I: the live site still works (after step 2 of the database)

On **app.plotwire.uk** (master, without this branch):
- Timesheets, Workers, Jobs and Work types load as before;
- a worker's week screen loads.

## Clean up

- **Remove** any test workers you invited, and **Cancel** any waiting
  invites.
- The **test** label on any existing worker is replaced the next time they
  sign in and see the notice.
