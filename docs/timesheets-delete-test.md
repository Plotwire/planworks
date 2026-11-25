# Test plan: Timesheets delete tools

Branch **timesheets-delete**, on the **stripe-plotwire-test** link (via
test-nov16). About 20 minutes on the **laptop**, signed in as you.

**Before you start:** close any Plotwire tabs that were open before the test
link was updated, then open it fresh (or press **Ctrl+F5**).

## First: the database (about 3 minutes)

The live app keeps working with this change. It only **adds** three
functions; nothing the app uses is removed or changed, and running it deletes
nothing.

1. Run **`supabase/timesheets-delete.sql`**. It ends with one row:
   - `delete_functions` 3;
   - `jobs`, `work_types`, `workers` and `entries`: how many there are now,
     the same as before you ran it.

   If it stops with "already been run" or "self-check failed", nothing was
   changed. Send me the message.
2. Run **`supabase/timesheets-delete-test.sql`**. Expect a red **"TEST
   FINISHED: … passed, 0 failed."** Everything it made is undone. It checks:
   - signed-out visitors, workers and another company can't use the delete;
   - what each delete takes: entries, hours, workers, and jobs that use a
     work type;
   - deleting a job, a work type, a removed worker's record and one entry
     takes exactly that, with its history;
   - someone still on the team can't be deleted;
   - a worker can still delete their own entry in an open week, and nothing
     else;
   - the other company's data never changes.
3. **If something goes wrong later:** `supabase/timesheets-delete-undo.sql`
   takes the three functions out again. It can't bring back anything already
   deleted.

## Set up some test data

Use test names you'll delete, e.g. job **990** `TEST delete me`.

1. **Jobs → Add job** 990 `TEST delete me`.
2. On a worker's phone (or a test worker), record **2 hours** on job 990
   today.
3. Add a work type `TEST type`, and record **1 hour** with it.

## Part A: jobs and work types (laptop)

1. **Jobs**: archived jobs aren't listed. Underneath is an **ARCHIVED JOBS**
   row with a count, folded shut. Click it: they open below. Click again:
   shut.
2. Each job, active or archived, has **Edit**, **Archive / Restore** and a
   **bin** button.
3. Press the **bin** on job 990:
   - **"Delete job 990 – TEST delete me?"**
   - **"This job has 2 hours from 1 worker. Deleting it deletes those hours
     permanently."** and **"This can't be undone."**
   - **Download Excel first** downloads a file ending `-before-delete.xlsx`
     with exactly those hours.
   - **Delete permanently** stays greyed until you type your password.
4. Type a **wrong password**, then **Delete permanently**: "That password
   isn't right." Nothing is deleted.
5. Type your **real password**, then **Delete permanently**. The job goes
   from the list, and on the **Workers** tab those 2 hours have gone.
6. **Add job** 990 again. It's accepted: the number is free.
7. A job with no hours: the warning says "No hours have been recorded against
   this job."
8. **Work types**: the same. Archived ones are folded away under **ARCHIVED
   WORK TYPES**. Delete `TEST type`: "This work type is on 1 hour from 1
   worker…". If a job has it as its default, it also says that job will be
   left with no default. After deleting, that job shows "No default".

## Part B: workers and entries (laptop)

1. **Remove** a test worker who has hours (as before).
2. In a week they have hours, their card now shows a clear grey **Removed**
   badge (instead of Submitted / Not submitted), and a **Delete record**
   button.
3. **Delete record**: "<name>'s record has … hours. Deleting it deletes those
   hours permanently." **Download Excel first** gives just their hours. Delete
   with your password: the card and their hours go.
4. Someone still on the team has **Remove** but no Delete record. A worker
   must be removed first.
5. **Show entries** on any worker: each entry has a small **bin**. "This
   deletes 8 hours 30 minutes on Mon 23 Nov 2026 for <name>, permanently."
   Delete with your password: that entry goes, and the day and week totals
   update.

## Part C: workers can't delete anything new (phone)

1. As a worker, in this week (not submitted): they can still remove their own
   entry, as before.
2. In a submitted week, or another worker's hours: no way to delete. The
   database test above proves a worker can't use the boss's delete at all.

## Clean up

Delete any `TEST` jobs, work types and entries you made.
