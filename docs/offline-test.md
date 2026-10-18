# Weekend test plan: weak signal and full offline

This covers both branches in one go: **site-speed** (fast on a weak signal)
and **offline** (a whole day with no signal), which is built on top of it.
The **stripe-plotwire-test** link runs the offline branch, so everything
below is on that link.

Use the **test account** and **test drawings only** (name them `TEST …`).
Part A is in **Edge on the laptop** (about an hour and three quarters). Part
B is **a full working day on the iPad in Airplane Mode**. Part C lists what
doesn't work without signal, by design. Delete the TEST drawings at the end,
including any **(copy)** ones. A14 also needs a **Try test account** (one
that has never subscribed).

Write down anything that surprises you, with the time and a screenshot.
That's what I need on Monday.

## What's new, in one paragraph

Plotwire now keeps everything on the device:
- the app itself;
- **every** drawing on the account, with their plan images and PDFs;
- every floor plan sketch;
- your company details, logos and quote rates.

It fills this "offline library" in the background whenever there's signal,
and shows its progress on the dashboard. With no signal you can open any
drawing and work on it. You can also save, start new drawings, import
plans, sketch, quote and make PDFs. Everything you save goes to the device
first and uploads by itself when there's signal. The editor's status bar
(bottom right) says **SAVED ON THIS DEVICE**, **SYNCED** or **WAITING FOR
SIGNAL**. The drawing-safety rules are unchanged: a save never replaces a
newer version made elsewhere, it's kept as **"… (copy)"**. Signing out wipes
everything from the device.

**New since the last round (offline polish):**
- **The work planner** opens with no signal, showing the planner as last
  saved, with a small **Offline: showing last saved** note. It can't be
  changed until there's signal (see Part C for why).
- **Try mode's 25 symbols** are checked with no signal exactly as with
  signal, so nothing saved offline can be refused later for being over the
  limit. If a save is ever refused anyway (another device used up the
  trial symbols meanwhile), it stays on the device and both the editor and
  the dashboard say so plainly. It is never lost or left stuck.
- **The Home Screen pop-up is gone.** The same advice is now under
  **Help** (the **?** in the dashboard's left menu) → **Using Plotwire
  offline on iPad**.

---

## Part A: Edge on the laptop

### A0. Setting up (once)

1. Open the stripe-plotwire-test link in Edge and sign in.
2. Have at least four TEST drawings, including:
   - **TEST plan A**, with an imported plan image;
   - **TEST plan B**, made with **Sketch a floor plan**;
   - **TEST PDF**, with an imported PDF plan.
3. Press **F12** for DevTools and click **Network**. The drop-down that says
   **No throttling** is where you pick **Slow 3G** or **Offline**. Leave
   **Disable cache** unticked. DevTools only affects **the tab it's open in**,
   and keeps doing so when you reload that tab.

### A1. The offline library fills itself

1. With normal signal, go to the dashboard. Under **All drawings** there's a
   new line. It goes from *"Keeping your drawings on this device… 3 of 9"*
   to **"All 9 drawings and their plans are on this device, ready for working
   without signal."** with a teal dot.
2. Tap **Storage** on that line. Check the details:
   - **Kept for working without signal:** how many drawings and plan files,
     and their size.
   - **All Plotwire keeps in this browser:** used, out of what the browser
     allows.
   - **Safe from automatic clearing:** Yes or No.
   - **Last brought up to date:** when.
   - An **Update now** button.
3. Wait 20 seconds on the dashboard. In the background it also fetches the
   code that offline work needs: the editor, the sketch tool, the PDF and
   quote makers, and pdf.js. It also keeps the work planner.
4. Tap the **?** in the left menu (above the cog). A small **Help** menu
   opens with **Using Plotwire offline on iPad**. Tap it: a short note with
   three steps. **Got it** closes it. No pop-up appears on the dashboard by
   itself any more.

### A2. No signal at all

1. Network → **Offline**. Reload (**Ctrl+R**).
   - **Before:** Edge's "You're not connected" page.
   - **Now:** the dashboard, with thumbnails, and a **No signal** bar.
2. Open a TEST drawing you have **not** opened on this laptop before.
   - **Before (site-speed only):** **This drawing didn't open**.
   - **Now:** it opens at once with its plan. The status bar says **SYNCED**.
3. Open **TEST PDF**. The plan shows. If pdf.js couldn't be fetched, it
   shows the plan's stored image instead, never a blank sheet.

Stay **Offline** for A3 to A7.

### A3. Working and saving with no signal

1. In a TEST drawing, place, move and delete symbols. All of it is instant.
2. Tap **Save**. The status bar shows **WAITING FOR SIGNAL** (amber dot).
3. Back on the dashboard, an amber bar says **1 save is waiting for signal**
   and the card says **Waiting for signal**.
4. Reload (still Offline) and open the drawing: your changes are there.

### A4. New drawings and imports with no signal

1. **Blank A3 sheet** → place 3 symbols → **Save**. It saves straight away
   (**WAITING FOR SIGNAL**), and its card is on the dashboard.
2. **Import a PDF plan** → pick a PDF. It imports with no signal. Place a
   symbol and **Save**.
3. **Blank A3 sheet** → **Import** → a plan image (PNG or JPG) → **Save**.

### A5. Sketching with no signal

1. **Sketch a floor plan** → name it `TEST offline sketch` → draw four
   outline walls → **Save**. It saves (no "Couldn't save").
2. **Use plan** → **Create a new drawing**. The editor opens the new drawing
   with the plan on it (**WAITING FOR SIGNAL**).
   - **Before:** "Couldn't send the plan to the editor".
3. Open **TEST plan B** → **Edit floor plan**. It opens from the device.
   Move a wall, then **Use plan**. The drawing updates with the new plan.
4. In the sketch tool, **Open** lists your sketches with no signal.

### A6. Quote and PDFs with no signal

1. Open a TEST drawing → **Quote**. Your company name, address and logo are
   there, and so are your own rates and items from your presets.
   - **Before:** no company details, and the built-in rates instead of
     yours.
2. **Download PDF** (materials list, then client quote). Both download.
3. **Download** (the drawing) → **Download PDF**. It downloads with the plan
   on it.
4. In **Quote** → **Presets**, change a rate, then **Save presets**. It saves
   (no error) and is used straight away.

### A7. Signal back: everything uploads

1. Network → **No throttling**. Within a few seconds:
   - the amber bar goes;
   - every drawing from A3 to A5 shows **SYNCED**;
   - the sketch, the new drawings and the rate change are all on the
     account.
2. Check on another device (or an Edge InPrivate window): the new drawings
   are there with their plans, and the new rate is in **Presets**.

### A8. Weak signal (Slow 3G)

1. Network → **Slow 3G**. Reload the dashboard: cards and thumbnails appear
   at once.
2. Open any drawing: it's on screen at once. Save: **SAVED ON THIS DEVICE**,
   then **SYNCED** a few seconds later. Tap **Dashboard** straight after
   Save: no waiting.

### A9. Drawing safety (nothing may ever be overwritten)

**a. Another device saved first.**
1. Laptop: open **TEST plan A**, Network → **Offline**, place 1 symbol,
   **Save**.
2. iPad or InPrivate window: open **TEST plan A**, place 5 symbols, **Save**.
3. Laptop: **No throttling**.

**Now:** a message says your work was saved as **"TEST plan A (copy)"**.
**TEST plan A** has the other device's 5 symbols, and the copy has the
laptop's 1.

**b. The same drawing in two tabs.**
1. Open **TEST plan B** in two tabs, both with DevTools **Offline**.
2. Tab 1: 1 symbol, **Save**. Tab 2: 2 symbols, **Save**.

**Now:** tab 2 says its work was saved as **"TEST plan B (copy)"**. With
**No throttling** in both tabs, the original has tab 1's symbol and the copy
has tab 2's.

### A10. Signed in for hours with no signal

The sign-in renews itself every hour, which needs signal.

1. Network → **Offline** in a tab on the dashboard. Leave the laptop for
   **over an hour** (lunch).
2. Come back and reload (still Offline).
   - **Before:** the sign-in page, after up to a minute's wait.
   - **Now:** straight into the dashboard. Open a drawing, change it, and
     **Save**: **WAITING FOR SIGNAL**.
3. **No throttling**: the save uploads (**SYNCED**). You stay signed in.

### A11. Signing out, and a second account

1. Network → **Offline**. Make a save so it's waiting. Tap **sign out**.
   - **Now:** a warning that **1 save is still on this device, not uploaded
     yet**, and would be lost. Tap **Cancel**.
2. **No throttling**. Wait for the amber bar to go, then sign out.
   **Application** → **IndexedDB** → **plotwire-device**: every store is empty
   (right-click → Refresh).
3. Sign in with a second test account if you have one. Only its own
   drawings appear, also with **Offline**.

### A12. Kill switch

As **test 11** in `docs/site-speed-test.md`. Setting `NEXT_PUBLIC_SW_OFF=1`
on the preview and redeploying removes the cached app from every device.
Saves waiting for signal are kept and still upload. Remove the variable to
turn it back on.

### A13. The work planner with no signal

1. With signal, open the **Work planner** and add a job called `TEST
   offline job` on today. Go back to the dashboard.
2. Network → **Offline**. Reload, then open the **Work planner**.
   - **Before:** an empty planner with "Operative 1 … 8".
   - **Now:** your planner as last saved, with your own operatives and
     `TEST offline job`, and a small amber note: **Offline: showing last
     saved (the date and time). Changes need signal.**
3. Try to change it: drag a job, tap a job, double-click a space.
   - Nothing moves, and a message at the bottom says **No signal, so the
     planner can't be changed right now. You can still look at it.**
   - The **+ add job** buttons are hidden. Week tabs, **Day** view and
     **Share this week as image** still work.
4. Network → **No throttling**. Within a few seconds the note goes (or tap
   **Try again** on it). Drag `TEST offline job` to tomorrow: it saves as
   normal.
5. Signal going while it's open: with the planner open, Network →
   **Offline**. The note appears straight away and the planner stops taking
   changes. Back to **No throttling**: the note goes.
6. A device that has never had the planner: in a fresh **InPrivate**
   window, sign in, then straight away Network → **Offline** and open the
   planner (before the dashboard has had 20 seconds).
   - **Now:** a panel, **The planner isn't on this device yet**, with
     **Dashboard** and **Try again**. Never an empty planner.
7. Delete `TEST offline job` at the end.

### A14. Try mode with no signal (Try test account)

Sign in with the **Try test account**. The **Trial · N of 25 symbols** pill
is at the top of the dashboard and the editor.

**a. The limit holds offline.**
1. With signal, make two TEST drawings with **10 symbols each**, and let
   them sync. The pill says **20 of 25**.
2. Network → **Offline**. Reload. Open the first TEST drawing and place
   symbols. After **5** more the pill says **25 of 25**, and the next one
   brings up **Subscribe to keep going**: the same as with signal.
3. **Blank A3 sheet** → try to place a symbol: the same message. Saving the
   drawing (5 more, **WAITING FOR SIGNAL**) is allowed, because it fits.
4. **No throttling**: it uploads (**SYNCED**). Nothing is refused.

**b. A save refused anyway is kept, with a clear message.**
This needs a second device to use up the trial meanwhile.
1. Start from **15** symbols used (delete 10 from a TEST drawing if
   needed, and let it sync).
2. Laptop: Network → **Offline**. Open **TEST drawing 1**, place **5**
   symbols, **Save** (**WAITING FOR SIGNAL**).
3. InPrivate window (with signal), same account: open **TEST drawing 2**,
   place **10** symbols, **Save**. The account is now at 25.
4. Laptop: **No throttling**. The laptop's save no longer fits.
   - **Now:** the editor says **Over the trial limit: not uploaded**:
     *kept safe on this device. Subscribe and it uploads by itself, or
     remove some symbols and save again.* The status bar says **NOT
     UPLOADED** (red dot); tapping it says the same again.
   - Dashboard: a pink bar, **1 save is over the trial limit, so not
     uploaded**, with **Subscribe**, and the card says **Not uploaded**.
   - Reload: all of it is still there. Sign out warns that the save would
     be lost (tap **Cancel**).
5. Open **TEST drawing 1**, remove **5** symbols, **Save**. It uploads
   (**SYNCED**) and the pink bar goes.

---

## Part B: a full day on the iPad in Airplane Mode

### B0. The evening before, on Wi-Fi

1. Open the stripe-plotwire-test link in **Safari** and sign in. No tip
   pops up any more. Tap the **?** in the left menu → **Using Plotwire
   offline on iPad**, and follow it: tap **Share** → **Add to Home
   Screen**.
2. Open **Plotwire from the Home Screen icon** (teal, with the bolt). It
   opens full screen. **Sign in again there**: the Home Screen app keeps its
   own copy of everything, separate from Safari.
3. Stay on its dashboard until the line under **All drawings** says **All N
   drawings and their plans are on this device**. Then tap **Storage** and
   note what **Safe from automatic clearing** says. iPadOS decides that;
   Home Screen apps are the safest place either way.
4. Open two or three drawings, a quote, **Edit floor plan** and the **Work
   planner** once each, so you've seen them working with signal.

### B1. On site: Airplane Mode all day

Turn on **Airplane Mode** (and make sure Wi-Fi is off). Work as on a normal
day, from the **Home Screen icon**:

1. Open several jobs, including ones you haven't opened this week.
2. Place, move and delete symbols. Draw wires. Add notes. **Save** often:
   **WAITING FOR SIGNAL**.
3. Start a **new drawing**. **Import** a plan from the camera roll, and a PDF
   plan from Files.
4. **Sketch a floor plan**, **Use plan** → new drawing. On another drawing,
   **Edit floor plan** → **Use plan**.
5. **Quote** a job, change a rate in **Presets**, and **Download PDF**. It goes
   to Files.
6. **Download** a drawing as a PDF.
7. Open the **Work planner** to check the day's jobs: it shows as last
   saved, with the **Offline** note, and can't be changed.

### B2. During the day

1. At lunchtime, **close Plotwire completely** (swipe it away in the app
   switcher) and lock the iPad for **over an hour**.
2. Open it again from the Home Screen. Check:
   - It opens straight into the dashboard. No sign-in page.
   - The amber bar still counts the waiting saves.
   - Your morning's work is all there.

### B3. End of the day

1. Turn **Airplane Mode off**. Within a minute or so the amber bar goes and
   the editor says **SYNCED**. Tap **Try now** if you don't want to wait.
2. On the laptop, check:
   - every drawing you changed has the day's changes;
   - the new drawings and sketches are there with their plans;
   - the rate change is in **Presets**;
   - there's no unexpected **(copy)**.

### B4. Things to note for me

- Anything that didn't open, or said no signal when you didn't expect it.
- Anything slow.
- The figures under **Storage** at the end of the day.
- Whether any drawing showed **Couldn't sync** or **Not uploaded** (red
  dot), and what the dashboard said about it.

---

## Part C: what still needs signal (by design)

- **Signing in** for the first time on a device, and **signing out**.
- **Opening the app on a device that has never opened it with signal.**
- **Email and share:** the email button, share links, the planner's share.
- **Changing the work planner.** With no signal it shows as last saved, to
  look at. A planner change saves the whole job with no check of what's
  there now, so a change kept on the device for hours could quietly undo
  one the office made meanwhile, and there's no safe "(copy)" of a booked
  job the way there is of a drawing. So changes wait until there's signal.
- **Changing the business information** (company details and logos). The
  saved details are used offline; changing them needs signal.
- **Subscribe and Billing.**
- **Try mode, after another device:** offline, the trial limit is checked
  against what this device knows. If another device used trial symbols
  meanwhile, a save can still be refused when it uploads. It's kept on the
  device with a clear message (A14b), never lost.
- **A PDF imported with no signal** keeps its plan image. The original PDF,
  used only for the sharpest export, uploads only if Plotwire is still open
  when signal returns. Otherwise that drawing exports from the plan image,
  which is slightly softer.
