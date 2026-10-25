# Test plan: First-drawing guide

Branch **first-drawing**, on the **stripe-plotwire-test** link once it's
pushed. About 45 minutes: Parts A to C each need a **brand-new test account**
(an account with no drawings at all), Part D uses an **existing account**
with drawings, Part E is the iPad and no signal. Name anything you keep
`TEST …` and delete the test drawings at the end.

**Before you start:** close every Plotwire tab that was open before the test
link was updated, then open it fresh (or press **Ctrl+F5**). On the iPad,
close the Safari tab and open the link again.

**Brand-new accounts:** sign up with an email address you can open (many
mail services let you add `+test1`, `+test2` and so on before the `@`, and
still deliver to you). The test link has billing switched on, so a new
account starts in **try mode**: downloading and printing are locked, as now.
That changes step 4 (see Part A, step 9).

## What's new, in plain English

- **A new account's dashboard.** With no drawings yet, the dashboard is one
  big panel: **"Let's do your first drawing"** and three big choices:
  - **Upload a plan**: a PDF, or a photo of the builder's drawing. Tapping it
    opens the file picker straight away.
  - **Draw a floor plan**: opens the Floor Plan tool.
  - **Try a sample house**: a ready-made two-bed bungalow, saved to your
    account as a drawing of your own (and as a floor plan you can edit with
    **Floor plan**). Plan only: you place the sockets and lights.
  The top bar, the try-mode banner and the offline/sync notices are as
  before. As soon as the account has a drawing, the usual dashboard comes
  back, unchanged.
- **A checklist in the drawing editor**, bottom left of the drawing area,
  until it's done or hidden:
  1. Add your plan
  2. Place your first socket or light
  3. Open the quote and see it filled in from the drawing
  4. Download or print your drawing
  Each step ticks itself when you do it. **Hide guide** puts it away for
  good. It never stops you doing anything, in any order.
- **One small hint at a time**, with its own cross: next to the symbol list
  when step 2 is next ("Drag a socket or light from here onto your plan."),
  and under the **Quote** button when step 3 is next ("Open Quote:
  everything you've placed is already counted in."). No hint while the
  quote, Download or another window is open over the drawing.
- **When all four are ticked**: "Done: that's your first drawing and
  quote." with a **Start a real job** button (back to the dashboard) and a
  cross to close it. No confetti.
- **Try mode:** pressing **Download** shows the usual "Exports come with a
  subscription" message, unchanged, and that ticks step 4.
- **Joe's drop-off counts:** each step is recorded with its time in the
  account's settings (no database change). `supabase/first-drawing-funnel.sql`
  is a **read-only** query that returns one row of counts (no names or
  emails): signed up, saw the first-drawing page, added a plan, placed a
  symbol, opened the quote, downloaded or printed, pressed Download in try
  mode, finished, hid the guide, have a saved drawing, paying now. Paste it
  into the Supabase SQL Editor and press Run; change the date at the top to
  count only accounts made since then.

## Part A: Try a sample house (laptop, new account 1)

1. Sign up as **new account 1**, accept the terms, and skip (or fill in) the
   company details.
   - The dashboard shows **"Let's do your first drawing"** with the three
     choices, and **no** "All drawings" list or greeting panel.
2. Click **Try a sample house**.
   - It says "Setting up the sample house…" for a moment, then the editor
     opens on **Sample house**: a two-bed bungalow (Living, Bed 1, Bed 2,
     Kitchen, Hall, Bath), scale **1:50** in the title block.
   - The checklist (bottom left) shows **1 of 4**, with **Add your plan**
     ticked.
   - A dark hint sits next to the symbol list, just under the tool buttons:
     "Drag a socket or light from here onto your plan."
3. Drag a **double socket** onto a wall.
   - Step 2 ticks (**2 of 4**). The symbol-list hint goes, and a hint
     appears under **Quote**.
4. Open **Quote**.
   - Step 3 ticks (**3 of 4**). The socket is in the quote. No hint shows
     over the quote. Close it.
5. (Try this on another account, or skip it.) Click a hint's **cross**: that
   hint goes and doesn't come back; the next step's hint still appears when
   its turn comes.
6. Check nothing is blocked: move, turn and delete a symbol, open Notes,
   Title and Floor plan with the checklist showing.
7. Press **Download**. In try mode (as on the test link): the usual
   "Exports come with a subscription" message, unchanged. Press **Not now**.
   - Step 4 is ticked, and the checklist has turned into **"Done: that's
     your first drawing and quote."** with **Start a real job**.
   - (On an account that can download: Download opens the Save / Print
     screen as now, and **Download PDF** or **Print** ticks step 4.)
8. Click **Start a real job**.
   - Back on the dashboard, which is now the **usual one**, with Sample house
     in All drawings.
9. Open Sample house again: no checklist (it's done).
10. Click **Floor plan** on Sample house: the bungalow opens in the Floor
    Plan tool, to edit.

## Part B: Upload a plan (laptop, new account 2)

1. Sign up as **new account 2**; on the first-drawing dashboard click
   **Upload a plan**. The file picker opens.
2. Pick a builder's PDF (or a photo of a drawing).
   - The editor opens with the usual **Import plan** window on your file.
     Crop if you like and press **Use whole page** / **Use this area**.
   - **Add your plan** ticks; the symbol-list hint appears.
3. Carry on with a light switch or downlight, Quote and Download as in Part
   A, steps 3 to 7: the same ticks and hints.
4. Press **Cancel** in the Import plan window instead (on a fresh try if you
   want to see it): the editor stays open on a blank sheet with step 1 not
   ticked, and **Import** on the toolbar works as always.

## Part C: Draw a floor plan (laptop, new account 3)

1. Sign up as **new account 3**; click **Draw a floor plan**.
   - The Floor Plan tool opens as it does today.
2. Draw a room or two and send it to a drawing as usual (**Use this plan**).
   - The drawing opens with **Add your plan** ticked and the symbol-list
     hint showing.
3. Click **Hide guide**.
   - The checklist and hint go. Reopen the drawing: they stay gone.

## Part D: Existing account (laptop)

1. Sign in to an account that **already has drawings** (your own is fine).
   - The dashboard is exactly as before: greeting panel, Start something
     new, All drawings. No first-drawing panel.
2. Open a drawing and a new drawing.
   - No checklist and no hints. Everything works as before.

## Part E: iPad (Safari, landscape) and no signal

1. On the iPad, sign up as **new account 4** (or use account 2 or 3 if they
   still have no drawings) and open the dashboard in landscape.
   - The panel and its three choices fit the screen; each choice is a big
     tap target. Turn to portrait: the usual "please rotate" screen.
2. Tap **Upload a plan**: the iPad's file picker opens straight away (Photos,
   Files or the camera). Cancel it.
3. Turn on **Airplane mode**, then tap **Try a sample house**.
   - The sample house still opens (it's kept on the iPad and uploads later).
   - Place a symbol with your finger (drag right, onto the plan): step 2
     ticks. Open Quote: step 3 ticks.
4. Turn Airplane mode **off**. After a few seconds, go back to the dashboard:
   Sample house shows as synced. Open the drawing on the **laptop** with the
   same account: the checklist shows the same ticks.
5. Each hint and the checklist sit clear of the tool buttons and the zoom
   controls on the iPad.

## Clean up

Delete the `TEST` and Sample house drawings from the test accounts. Nothing
else to undo: the guide's ticks are part of the account's settings.

## Under the hood (for reference)

- Progress: `user_settings.data.firstDrawing` (the same record as the Symbol
  Library ticks, quote presets and Recent symbols). **No new table, column
  or database change.** Each step keeps the time it was first done, so the
  laptop's and iPad's progress combine rather than overwrite.
- The guide only starts for an account the server says has no drawings,
  checked twice, with nothing waiting to upload: someone with drawings never
  sees it.
- `supabase/first-drawing-funnel.sql`: read-only counts for each step.
