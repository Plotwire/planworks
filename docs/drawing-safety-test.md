# Drawing safety: test steps (branch drawing-safety)

Run these on the **stripe-plotwire-test** link, signed in with the test account,
using **test drawings only** (name them `TEST …`). Desktop Chrome is easiest:
the network throttling and request blocking below are in DevTools, which an
iPad doesn't have. Delete the test drawings afterwards.

Each test says what used to happen and what you should see now.

---

## 1. Stale tab overwrites a newer save (the most likely cause of the 4 Oct loss)

No throttling needed. This is a tab or device still showing an older copy of a
drawing. Saving there, or just tapping the Dashboard arrow (which saves an
existing drawing on the way out), used to write that older copy over the newer
one.

1. **Tab A:** Dashboard → New drawing. Place **1** symbol. In **Details**,
   set the Project name to `TEST stale`. Tap **Save**. The address becomes
   `/drawing?id=…`.
2. Copy that address and open it in **Tab B**. Place **5** more symbols
   (6 in all). Tap **Save**, then the Dashboard arrow. The card shows 6 items.
3. Go back to **Tab A**. Don't reload: it still shows 1 symbol. Place 1 more
   (2 in all) and tap the **Dashboard** arrow.

**Before:** the drawing now held Tab A's 2 symbols. Tab B's work was gone.
It was the same card with the same created date and a new "updated" time:
exactly the 4 Oct record.

**Now:** a message says the drawing was changed somewhere else after it was
opened here, so your work was saved as a new drawing, "TEST stale (copy)",
and the other drawing hasn't been changed. The dashboard shows the original
with **6** items and a separate **(copy)** card with **2**.

Repeat step 3 with **Save** instead of the arrow. You get the same message, and
Tab A carries on in the copy (its address changes to the copy's id).

---

## 2. Slow open: "Opening drawing…", nothing editable until it arrives

1. DevTools → Network → throttling **Slow 3G** (keep DevTools open).
2. From the dashboard, open a TEST drawing that has symbols.

**Before:** a blank sheet you could draw on for several seconds. Symbols
dragged in while it loaded could replace the drawing's own when it arrived.

**Now:** a full-screen **Opening drawing…** until the drawing appears.
Nothing can be dragged, typed or saved meanwhile.

3. Open TEST drawing **A**. While **Opening drawing…** is showing, press the
   browser **Back** button, then open TEST drawing **B**. When B appears, wait
   30 seconds.

**Now:** it stays B. A's late answer is ignored. Go back to the dashboard and
open A and B: both unchanged.

Set throttling back to **No throttling**.

---

## 3. Failed open: Retry and Back; failed list: Retry

1. Load the dashboard normally.
2. DevTools → ⋮ → More tools → **Network request blocking**. Tick **Enable
   network request blocking** and add the pattern `*rest/v1/projects*`.
3. Click a TEST drawing's card.

**Before:** a blank sheet and an "Open failed." alert. The blank sheet looked
like the drawing had been emptied.

**Now:** **This drawing didn't open**, with **Back** and **Retry**. Nothing
has been changed.

4. Tap **Back**. The dashboard shows **Your drawings couldn't be loaded** with
   **Retry**. Before, it said "No saved drawings yet — start a blank sheet".
   The stats show dashes, not 0.
5. Turn blocking off and tap **Retry**: the drawings come back. Open the TEST
   drawing again and it opens normally.
6. Go to `/drawing?id=00000000-0000-0000-0000-000000000000`:
   **This drawing can't be found**, with Back and Retry.

---

## 4. Back or Forward to a new drawing's address

1. Dashboard → New drawing. Place 2 symbols. Tap **Save**. The address becomes
   `/drawing?id=…`.
2. Tap the **Dashboard** arrow, then press the browser **Back** button.

**Before:** a blank new drawing at that drawing's address, which looked as if
the drawing had gone.

**Now:** **Opening drawing…**, then the drawing with its 2 symbols.

---

## 5. Unsaved-work backups only go back where they came from

**a. An unsaved new drawing never goes into a saved one**

1. Dashboard → New drawing. Place **5** symbols, wait 2 seconds, and **don't
   save**. Tap the Dashboard arrow → **OK** on "Leave without saving?".
2. Set **Slow 3G**, then open a saved TEST drawing.

**Before:** an amber bar, **Recovered unsaved work · 5 symbols — Restore**.
Restore put the 5 symbols into the drawing you'd opened, and the next save
overwrote it.

**Now:** once it has opened, the bar says **Unsaved new drawing found on this
device · Drawing … · 5 symbols**, with **Open as a new drawing** and **Not
now**. There's no Restore.

3. Tap **Open as a new drawing**: a new drawing with the 5 symbols (address
   `/new?restore=1`). Tap **Save** to get a new card. The TEST drawing you'd
   opened is unchanged.

**b. A drawing's own backup still restores into it**

1. Open a TEST drawing. Place 3 symbols, wait 2 seconds, and close the tab
   **without saving**.
2. Open the drawing again.

**Now:** **Recovered unsaved work · N symbols** with **Restore**. Restore,
then Save: it saves over the same drawing, with no copy and no message.

---

## 6. Dashboard: names, search, All drawings

- **Names.** Dashboard → New drawing. The top bar shows
  `Drawing 16 Oct 2026, 09:20` (today's date and time) instead of "Untitled".
  Save: the card has that name.
- **Search by client and quote reference.** Open a TEST drawing. In
  **Details**, set Client name `Smithson`. In **Quote**, set Quote reference
  `Q-TEST-42`. Save, then go to the dashboard. Searching `smithson`, and
  separately `q-test-42`, each finds it.
- **All drawings.** Type something in search. Then tap the **folder icon**
  (All drawings) in the left rail. The search clears and the list, now headed
  **All drawings · N saved · newest first**, scrolls into view.

---

Delete the TEST drawings when done.
