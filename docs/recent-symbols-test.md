# Test plan: Recent symbols

Branch **recent-symbols**, on the **stripe-plotwire-test** link once it's
pushed. Use the **test account** and **test drawings only** (name them
`TEST …`), and delete them at the end. About 20 minutes: Part A on the
**laptop** (Edge), Part B on the **iPad** (Safari), Part C with no signal.

**Before you start:** close every Plotwire tab that was open before the test
link was updated, then open it fresh (or press **Ctrl+F5**). On the iPad,
close the Safari tab and open the link again.

## What's new, in plain English

- A **Recent** row at the top of the Symbols list on the left, under the
  search box: the **last 8 symbols you placed**, the newest first, each once.
  Four to a row, **two rows at most**. It stays in view while you scroll the
  list, so the symbol you just used is always one drag away.
- Drag a symbol from Recent onto the drawing exactly as you would from the
  list. Placing a symbol (from Recent or the list) **moves it to the front**
  of Recent; it never appears twice.
- Hover over a Recent symbol (laptop) to see its name and mounting height.
- Recent belongs to **your account**: the laptop and the iPad show the same
  row. With no signal it still updates on that device, and joins your
  account when the signal comes back. Symbols placed on both devices while
  apart are combined (newest first), not lost.
- A new account with nothing placed yet has **no Recent row at all**: the
  list looks exactly as before. While you're typing in the search box, Recent
  hides so the results have the room.
- Only placing a symbol from the palette counts: moving, copying, mirror copy
  and undo don't change Recent. The drawing, its symbol counts and its quote
  are exactly as before (Recent isn't saved in the drawing).
- Below Recent, the full list is unchanged: same headings, same order.

## Part A: laptop (Edge, a normal-size window)

1. Sign in to the **test account**. If it has been used to place symbols
   since this went on the test link, the Recent row may already be there;
   that's fine, carry on from step 3.
2. **New account, no history:** if you have a brand-new test account, open a
   drawing: there's **no Recent row**, and no gap between the search box and
   the first heading.
3. Open (or start) a `TEST Recent` drawing. Drag three different symbols onto
   it from the list, say a **Double Socket Low Level**, then a **Light
   Switch**, then a **Ceiling mounted downlight**.
   - A **Recent** row appears under the search box with the three, the
     downlight first, then the switch, then the socket.
4. Drag the **Light Switch** from the **Recent row** onto the drawing.
   - It's placed like any other symbol (selected, in the Inspector).
   - Recent now reads switch, downlight, socket: it moved to the front, and
     it's there **once**.
5. Place the downlight again from the list (scroll down to Lighting).
   - It moves to the front of Recent; still three symbols, no duplicates.
6. Place **six more different symbols** (any).
   - Recent shows **8**, in **two rows of four**, the newest top left. The
     oldest ones have dropped off the end.
   - Scroll the list down: Recent stays where it is, above the list.
7. Hover over a Recent symbol: its name and height show.
8. Type `socket` in the search box: Recent hides while the results show.
   Clear the search: Recent is back.
9. Look at the status bar: **SYMBOLS** went up by exactly the number you
   placed. Open **Quote**: the counts are the symbols on the drawing, as
   before. Select a few symbols, **Ctrl+C / Ctrl+V** or mirror copy them, and
   undo: Recent doesn't change.
10. **Save** the drawing, go back to the dashboard, open it again: Recent is
    the same.
11. Leave the laptop on this drawing.

## Part B: iPad (Safari, landscape)

1. Open the test link on the iPad, sign in to the **same test account**, and
   open any `TEST` drawing.
   - The **Recent** row shows the **same 8 symbols in the same order** as
     on the laptop.
2. Drag a symbol from Recent onto the drawing with your finger (drag to the
   right, towards the drawing).
   - It's placed, and moves to the front of Recent.
   - Each Recent tile is easy to hit with a fingertip (as big as the
     toolbar buttons are tall).
3. Place a symbol that **isn't** in Recent yet, from the list: it appears at
   the front, the eighth drops off.
4. Swipe the main list up and down: it scrolls as before; Recent stays put.
5. Turn the iPad to portrait: the app asks you to rotate back, as before.
6. On the **laptop**, go back to the dashboard and open the drawing again:
   Recent now matches the **iPad's** (the symbols you placed on the iPad are
   at the front). It also catches up if you just switch back to the laptop's
   Plotwire tab (from another tab or app) after a few seconds.

## Part C: no signal

1. On the iPad, turn on **Airplane mode** (the editor's status shows it).
2. Place two different symbols that aren't at the front of Recent.
   - Recent updates **straight away**, as normal.
3. Close Safari completely and open the test link again (still in Airplane
   mode), open the same drawing: Recent still has those two at the front.
4. Meanwhile, on the **laptop** (with signal), place a different symbol.
5. Turn Airplane mode **off** on the iPad. Wait a few seconds, then go back to
   the dashboard and open the drawing again.
   - Recent has the iPad's two **and** the laptop's one, newest first.
6. On the laptop, open the drawing again: the same row.
7. **Signing out** with no signal shouldn't warn about unsent changes just
   because of Recent (a drawing that hasn't been sent will still warn, as
   before).

## Clean up

Delete the `TEST` drawings. Nothing else to undo: Recent is just a list on
the account.

## What's under the hood (for reference)

- Kept in the account's settings (`user_settings.data.recentSymbols`, the
  same record as the Symbol Library ticks and quote presets): **no new table,
  column or database change**, nothing for Joe to run.
- Each symbol is kept with when it was last placed, so two devices' lists
  combine by time when either uploads (lib/recentSymbols.js, lib/db.js).
- Saved on the device at once and sent up a moment after the last placement
  (one upload for a run of placements); with no signal it waits on the
  device like other settings changes.
- Read from the account again whenever a drawing opens and when the app
  comes back into view, so the other device's latest symbols show without
  reloading the page.
