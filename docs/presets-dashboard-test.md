# Test plan: Presets page and the left rail

Branch **presets-dashboard** (from master 3862ccc). On the test link through
**test-nov16** (testing only). Use the **test account** and **test drawings
only** (name them `TEST …`), and delete them at the end. About 20 minutes on
the **laptop** (Edge); a quick look on the iPad.

**Before you start:** close every Plotwire tab that was open before the test
link was updated, then open it fresh (or press **Ctrl+F5**).

## What's new, in plain English

- **The left rail on the dashboard:** every button is solid teal (the app's
  button colour) all the time, with a short label under its icon:
  **Dashboard, Drawings, Presets, Symbols, Planner** (and **Timesheets** for
  accounts with it), then **Help** and **Business** at the bottom. The page
  you're on (Dashboard) is navy with a teal ring.
- **Presets** in the rail opens the Presets page: all your items, specs and
  prices, in bigger text than before. Changes save as you type (the light at
  the top right says **Saved**). **Dashboard** takes you back. There's no
  presets section on the dashboard itself.
- **Each new drawing keeps the presets it was started with.** Change a price
  on the Presets page and only drawings started **after** that get it. A
  drawing you've already started keeps the prices it started with, even if
  you haven't opened its quote yet. A quote you've already started never
  changes.
- **Inside a drawing**, the quote no longer has a Presets button. It says
  **"Prices here are for this job only"**: change any price on that quote and
  only that job changes.
- **Reset to presets** (bottom of a quote) still rebuilds that one quote from
  your **current** presets, but only when you press it and say OK.
- **Nothing is lost:** the page edits the same saved presets as before, so
  everything you'd already set is there.

**Known limits**
- A drawing made **before this update** whose quote has never been opened has
  no copy of the presets (they didn't exist then). The first time its quote
  opens, it takes your presets as they are at that moment, as it always did.
- If a drawing is started with no signal and its presets have never been
  downloaded to that device, it can't keep a copy. Its quote then works as
  in the line above.

## Steps (laptop, Edge)

1. Sign in to the **test account** and look at the dashboard's **left rail**.
   Every button is teal with a label: Dashboard (navy, with a teal ring:
   you're on it), Drawings, Presets, Symbols, Planner, and Help and Business at
   the bottom. Hover one: it goes a darker teal. There's no big presets
   section between "Start something new" and "All drawings".
2. **Nothing lost:** press **Presets** in the rail. Every item, spec and price
   you'd set before (in the quote's old Presets box) is there. Write down a
   few prices, to put back in step 13.
3. Look at the page: dark bar at the top with **Dashboard**, the title
   **"Your starting items, specs & prices"** and the save light; a blue note
   that starts **"These are the starting point for every new drawing."**;
   each section in its own white card; **Charge VAT (20%) on new quotes** and
   **Save presets** at the bottom.
4. Set **Downlights** to **10** and **First fix labour** to **250**. The light
   goes **Saving…** then **Saved**. Press **Dashboard**, then **Presets**
   again: they're still 10 and 250.
5. **Drawing A:** press **New drawing**, put **2 downlights** on, **Save**.
   Don't open the quote. Go back to the dashboard.
6. **Change the presets:** Presets, set **Downlights** to **25**. Saved.
7. **Drawing A keeps its prices:** open drawing A, press **Quote**. Downlights
   show **2** at **10.00**, First fix labour **250.00**. (It was started
   before step 6.)
8. **The quote:** there's **no Presets button** at the top; instead it says
   **"Prices here are for this job only"**. Change Downlights on this quote to
   **12**. Close the quote. Open **Presets** from the dashboard rail:
   Downlights still says **25**.
9. **Drawing B:** New drawing, **2 downlights**, **Save**, press **Quote**.
   Downlights show **25.00**.
10. **A quote from before today:** open a drawing whose quote you priced
    before this test. Every price is exactly as you left it.
11. **Reset to presets:** in drawing A's quote, press **Reset to presets**.
    The question says it uses your **current Presets & pricing (on the
    dashboard)** and that **only this job's quote changes**. Press **OK**:
    Downlights go to **25.00**. Open drawing B: unchanged.
12. **VAT:** on the Presets page untick **Charge VAT**. New drawing C, a
    downlight, Save, Quote: no VAT line. Drawing B's quote still has VAT.
    Tick it back on.
13. **Back to how it was:** on the Presets page, put the prices back to what
    you wrote down in step 2.
14. **A sketch:** press **Sketch a plan**, draw a quick room, and make it a
    drawing. Change a preset price, then open that drawing's quote: it shows
    the price from **before** your change.

## iPad (Safari)

1. The rail's labels are readable and each button is easy to tap.
2. On the Presets page, tap a **Unit rate** box: the number keyboard comes
   up, and the price saves the same way. The rows are big enough to tap
   without zooming.
3. Delete the `TEST` drawings.

## If something's wrong

Note the step number and what you saw (a screenshot helps). Presets are kept
in the account's settings, as before; each new drawing's copy is kept inside
the drawing. No database change was needed.

## Checks already run

- `npm test`: all tests pass, including `tests/presets-dashboard.test.mjs`
  (a drawing keeps the presets it started with after they change; a new one
  gets the new ones; a started quote is never rebuilt on opening; the page
  edits the same saved presets; every rail button has its label and is teal).
- `npm run build` (the build gate) and `node scripts/symbol-library/check.cjs`
  (the symbol check).
- Looked at in a local copy with a stand-in for the database: the rail (all
  teal, labelled, Dashboard ringed), no presets section on the dashboard, the
  Presets button opening the Presets page, and both fitting a phone screen
  (375 px) with no sideways scrolling.
