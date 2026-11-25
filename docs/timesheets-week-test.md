# Test plan: Timesheets week

Branch **timesheets-week**, on the **stripe-plotwire-test** link (via
test-nov16). About 30 minutes. You'll need:

- the **laptop**, signed in as **you** (the boss);
- a **phone** for test worker one (signed in to Vercel, same as the iPad, so
  the test link opens);
- a **private window** on the laptop (or a second phone) for test worker two.

**Before you start:** close every Plotwire tab that was open before the test
link was updated, then open it fresh (or press **Ctrl+F5**). On the phone,
close the tab and open the link again.

**Already ran the SQL in steps 1 to 4 below?** You don't need to again. For
this round, only run the new **`supabase/timesheets-addon-test.sql`** (Part J),
then go straight to **Parts G to J** at the end. Parts A to F still work as a
full re-test.

## First: the database (about 5 minutes)

The new screens need three SQL files, run **in this order** in the Supabase SQL
editor. Previews and the live site share the database, so step 1 goes live as
soon as it's run. The live app keeps working with it: nothing it uses is
removed or renamed, and no existing entry changes.

1. **Optional, to see nothing is lost:** run
   `select count(*) as entries from public.timesheet_entries;` and note the
   number.
2. Run **`supabase/timesheets-week.sql`**. It ends with one row of counts:
   - `weeks_table` 1, `rules` 18, `functions` 18, `note_optional` true,
     `submitted_weeks` 0;
   - `entries`: the same number as in step 1.

   If it stops with "Timesheets week self-check failed" or "already been
   run", nothing was changed. Send me the message.
3. Run **`supabase/timesheets-week-test.sql`**. It's meant to end in a red
   error, **"TEST FINISHED: … passed, 0 failed."** Everything it made is undone
   at the end. It checks, with three fake logins at two fake firms:
   - a worker can't read, change, delete or add another worker's hours;
   - a worker can't read drawings, quotes, settings, the company profile,
     billing or the work planner tables;
   - the other firm sees nothing of yours;
   - submit locks the week;
   - only the owner can reopen it, and a reopened week can be edited again,
     even when it's older.

   If it says anything other than **0 failed**, stop and send me the
   message.
4. **Two test logins.**
   - Sign up two new Plotwire accounts with email addresses you own (not a
     customer's), and confirm each one from its email.
   - Sign them out again.
   - Open **`supabase/timesheets-week-test-workers.sql`** and use find and
     replace to swap every placeholder: **YOUR LOGIN EMAIL**, **FIRST TEST
     LOGIN EMAIL** and **SECOND TEST LOGIN EMAIL**.
   - Run it. Expect `test_workers` 2 (more if you already have workers) and
     `workers_marked` 2.

   Only sign in as the test logins **after** this, so they come up as
   workers.

## What's new, in plain English

**The lads (phone first):**

- One screen: **this week, Monday to Sunday, as day cards**. Use the arrows
  for last week. You can't go past this week.
- **Add hours** on a day fills in the last day's job, work type and times, so
  a normal day is one tap.
  - Change the **job** (shown as "001 – Smith, Driffield"), **work type**,
    **start** or **finish**.
  - Hours are worked out for them.
  - The **note** is optional.
- **It saves itself.** There's no Save button: a green tick and **Saved**
  appear a moment after each change.
- A saved job folds into one tidy row: job number chip, job name, work type,
  times and hours. **Tap the row** to change it; tap the **tick** to fold it
  up again.
- **Add another job** for a second site. It starts when the last one
  finished, on the same work type, with the job left to pick.
- The **week total** and **Submit week** stay at the bottom.
  - Once submitted, the week is **locked**: green "Submitted … only *your
    company* can reopen it".
  - The database enforces the lock too, not just the screen.
- As before, they can change this week (and last week, on a Monday only), and
  nothing in the future.

**You (laptop):**

- Timesheets opens on a new **Workers** tab. For each worker you see:
  - their week, hours per day and per job;
  - **Submitted** (green) or **Not submitted / Reopened** (amber);
  - **Show entries** for the detail;
  - **Reopen week** for a submitted week.
- **Export hours**: pick dates (they follow the week shown), then **Download
  Excel** or **Download CSV**.
  - Excel: an "Entries" sheet (one row per entry) and a "Summary" sheet
    (hours per job, per worker, and per job per worker, with totals).
  - CSV: one row per entry: worker, date, job number, job name, work type,
    start, finish, hours, note.
- **Jobs** and **Work types** work as before, in the Plotwire look.
- Hours only. Nothing about pay, costs or profit.

## Part A: set up (laptop, signed in as you)

1. Open the test link, sign in, and click **Timesheets** in the left rail.
   - It should look like the rest of Plotwire: same fonts, rounded cards and
     teal buttons with dark icons.
   - The top card says **"Your team's hours"**, with counts of workers,
     active jobs and work types.
2. **Jobs** tab: **Add job** twice. Use numbers you don't already have:
   - **901**, name `TEST Smith, Driffield`, any site address, default work
     type **Price work**;
   - **902**, name `TEST Jones, Beverley`, no default work type.
3. **Edit** job 902 and add a site address. It saves and shows in the list.
4. **Work types** tab: **Price work** and **Day work** are active.
   - The lads' work type list shows every active work type.
   - If you only want those two, archive the others here. They stay on any
     old hours that used them.
5. **Workers** tab: **Test Worker One** and **Test Worker Two** are both
   there, amber **Not submitted**, 0h.

## Part B: worker one (phone)

1. Open the test link and sign in as the **first test login**.
   - It goes straight to the week: a navy bar with the worker's name and your
     company, and a sign-out button.
   - There's no rail, no drawings, quotes or billing.
2. The week reads **23 – 29 Nov 2026**. Wednesday has a **Today** chip, and
   Thursday to Sunday say **Not yet**. The right arrow is greyed out.
3. **Monday → Add hours.** Pick **901 – TEST Smith, Driffield**.
   - The work type becomes **Price work** (the job's own).
   - Set **07:30** to **16:00**. Hours show **8h 30m**.
   - After a second, a green tick and **Saved** appear.
4. **Tuesday → Add hours.** It fills in 901, Price work, 07:30 to 16:00, and
   saves itself (one tap).
5. Still Tuesday:
   - change that entry's finish to **12:00** (**4h 30m**, Saved);
   - then **Add another job**: it starts at **12:00**, with the job blank;
   - pick **902 – TEST Jones, Beverley**, **Day work**, **12:30** to **16:30**;
   - add the note `Moved to Beverley for the board`.
6. Tuesday → **Add another job** again, and leave the job blank.
   - **Submit week** is greyed out, with "Finish or remove the job you're
     adding, then submit."
   - Tap the **bin** on that blank one: it goes straight away (nothing was
     saved).
7. **Remove** check: tap the bin on Tuesday's second entry (if it's folded
   into a row, tap the row first).
   - It asks first (**Remove** / **Keep**). Tap **Keep**.
8. **Week total** at the bottom: **17h** (Mon 8h 30m + Tue 4h 30m + 4h).
9. **Left arrow** to last week (16 – 22 Nov):
   - it's read-only, with amber **"Not submitted yet."**;
   - there's no Add hours (today isn't a Monday).

   Come back with the right arrow.
10. **Submit week**. The box says "23 – 29 Nov 2026: **17h**…". Tap **Submit
    week**.
    - A green **Submitted** banner appears; the entries are read-only and the
      Add buttons have gone.
11. Close the browser and open the link again: still signed in, and the week
    is still submitted.

## Part C: worker two (private window on the laptop)

1. Sign in as the **second test login**. This week is **empty**: none of
   worker one's hours.
2. **Monday → Add hours**: **902**, **Day work**, **08:00** to **16:30**.
   Saved. **Don't submit.**
3. In the address bar, try the test link with `/dashboard` and then
   `/billing` on the end. Each one goes back to the week screen, or says it
   isn't available on this login. No drawings, quotes or billing show.

(The database test in step 3 at the top already proved the rest with real
database rules: worker two can't see, change or delete worker one's hours,
and neither can see anything else in Plotwire.)

## Part D: you again (laptop)

1. Timesheets → **Workers** (refresh the page).
   - **Test Worker One**: green **Submitted**, **17h**. Mon 8h 30m, Tue 8h 30m.
     Per job: 901 **13h**, 902 **4h**.
   - **Test Worker Two**: amber **Not submitted**, **8h 30m**.
2. **Show 3 entries** on worker one: each shows job, work type, start, finish,
   hours and note.
3. **Reopen week** on worker one.
   - It asks "Reopen so … can change it?". Tap **Reopen**.
   - The pill turns amber: **Reopened** with today's date and time.
4. **Export hours.**
   - From and To show 23 Nov and 29 Nov. **Download CSV** and open it in
     Excel. (The Excel download is checked in Part I.)
   - The columns are **Worker, Date, Job number, Job name, Work type, Start,
     Finish, Hours, Note**.
   - There are **4 rows** (3 for worker one, 1 for worker two), with hours as
     decimals (8.50).
5. Change **From** to a date a few weeks back and download again. Older hours
   are in it too.

## Part E: worker one again (phone)

1. Refresh. There's an amber **"Reopened by** *your company***. Make your
   changes, then submit the week again."**, and the entries can be changed
   again.
2. Tap Tuesday's first row, change its note and wait for **Saved**.
3. **Submit week** again: it's locked again. On the laptop (refresh) worker one
   shows **Submitted** again.

## Part F: older hours carried over

1. The `entries` number after step 2 at the top matched the one before.
2. On **Workers**, use the left arrow to go back to weeks with older hours.
   They show with the same hours as before (any break already taken off)
   and their notes.
   - Older "Other" hours show as **Other – *what it was for***.
   - A worker who has since been removed still shows in any week they have
     hours in.
3. Export a date range that covers them: one row each, nothing missing.

## Phone look

- The day cards fit the screen, with no sideways scrolling.
- The job and work type lists, and the time pickers, are the phone's own.
- The buttons are easy to hit with a thumb.
- The week total and Submit week stay at the bottom while you scroll.

## Part G: the new look, worker (phone)

1. Each day is a card with a **navy strip**: day and date in white (e.g.
   **MON 23 NOV**), the day's hours on the right. The card body is white.
2. **Today's** strip is **teal with dark writing**, with a **TODAY** tag, and
   the card has a teal outline.
3. A saved job is a **white row with a teal bar** down its left:
   - job number in a small teal chip (e.g. **901**) and the job name;
   - the work type as a small grey tag, then the times;
   - the hours in bold on the right, with a small teal pencil button.

   Tap the row: it opens to change. Tap the **tick**: it folds up again.
4. An empty day has a **light teal "Add hours"** button. A day with jobs has a
   light teal **"Add another job"**.
5. The bottom bar is **solid navy**: **WEEK TOTAL** in large white numbers,
   and a teal **Submit week** button with dark writing.
6. After **Submit week**:
   - a green banner with a **padlock** at the top;
   - a padlock on each day's strip;
   - a light green **Submitted** badge with a padlock in the bottom bar.

   Nothing should look like a greyed-out, disabled screen.
7. It should be easy to read outdoors: white on navy, dark on teal.
8. Future days (Thursday onwards today) are faded, with **Not yet**.

## Part H: the new look, boss (laptop)

1. In Timesheets, the **Workers**, **Jobs**, **Work types** and **Export
   hours** cards each have a **navy header strip** with white writing.
2. **Workers**: one card per worker. Its navy strip shows:
   - the name;
   - a green **Submitted** badge with a padlock, or amber **Not submitted** /
     **Reopened**;
   - the **week total** in large white numbers.

   Below: Monday to Sunday cells (light teal where there are hours), then each
   job with its number chip and hours.
3. **Show entries**: each entry has the day, job chip and name, and hours,
   then the work type tag and times, then the note.
4. **Jobs**: job numbers in teal chips, a teal bar down the left of each
   active job, and the default work type as a tag. **Work types** have the
   same teal bar.
5. Switch to dark mode (moon button, top right): still easy to read.

## Part I: the Excel download (laptop)

1. **Workers → Export hours**, week 23 – 29 Nov → **Download Excel**.
   - The file is called `plotwire-timesheets-2026-11-23-to-2026-11-29.xlsx`.
   - It opens in Excel with no "repair" message.
2. Sheet **Entries**:
   - the columns are Worker, Day, Date, Job number, Job name, Work type,
     Start, Finish, Hours, Note;
   - the header row is bold and **stays at the top** when you scroll down;
   - dates look like 24/11/2026, times like 07:30, and hours like 8.50;
   - there's one row per entry, and the columns are wide enough to read.
3. Sheet **Summary**: a title and the dates, then:
   - **Hours per job**, with a Total;
   - **Hours per worker**, with a Total;
   - **Hours per job per worker**: a grid with jobs down the side, workers
     across, and totals on the right and the bottom.

   The totals match the Workers tab. There's no money anywhere.
4. Pick dates with no hours and download again: the Summary says **"No hours
   in these dates."**
5. **Download CSV** still works as before.

## Part J: an account WITHOUT the add-on

**Database first:** run **`supabase/timesheets-addon-test.sql`**.
- **Expect** a red message: "TEST FINISHED: … passed, **0 failed**.
  Paid-subscription account: tested (or skipped). Failed checks: none."
- **What it tries:** four accounts, one after another: an ordinary one (Try
  mode), a billing-exempt one, a paid one (if it can make one here), and one
  whose add-on has ended.
- **What each should find:**
  - the app is told the add-on is off;
  - it sees none of another account's Timesheets;
  - it can add, change and delete nothing;
  - it can't read the add-on list or switch the add-on on;
  - every Timesheets function refuses.
- Everything it makes is undone at the end.

**In the app:**

1. Use an ordinary test account **without** the add-on: any test login you
   have that isn't a worker, or a third new sign-up with an address you own.
2. Signed in as that account on the test link, the **left rail has no
   Timesheets button**.
3. Put `/timesheets` on the end of the test link address. It should show a
   short page, **"Timesheets is an add-on. Contact admin@plotwire.uk to find
   out more."**, with a **Back to dashboard** button. There's no pop-up, and
   nothing else of Timesheets (no rail, team, jobs or hours).
4. **Back to dashboard** goes back.
5. Put `/time` on the end of the address: it goes straight to the dashboard.
6. **Your own login** (add-on on): the Timesheets button is in the rail and
   everything works as above.
7. **A worker's login** still only ever shows their own week, whatever
   address is typed.

## Clean up

1. Run the **UNDO** lines at the end of
   `supabase/timesheets-week-test-workers.sql`, with the same placeholders
   replaced.
   - The test logins go back to ordinary logins.
   - Their test hours stay in your records under Test Worker One and Two (as
     removed workers). If you'd rather those went too, tell me and I'll write
     the SQL.
2. **Jobs** tab: **Archive** jobs 901 and 902.
