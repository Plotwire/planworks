# Test plan: quotes keep what you type

Branch **quote-save**, on the **stripe-plotwire-test** link once it's pushed.
Use the **test account** and **test drawings only** (name them `TEST …`), and
delete them at the end. About 30 minutes: Part A to D on the **laptop**
(Edge), Part E on the **iPad** (Safari).

**Before you start:** close every Plotwire tab that was open before the test
link was updated, then open it fresh (or press **Ctrl+F5**). A tab left open
keeps running the version it was opened with.

## What was wrong, in plain English

- **Quote presets** (Quote → **Presets**) only kept your typing if you pressed
  **Save presets**. Pressing **X**, **Close** or clicking outside the box threw
  it away without a word, and clicking outside also closed the quote window
  behind it. That's the "keeps dropping out and forgets what I typed".
- **The quote itself** is part of the drawing, and was only stored when the
  drawing was saved. Refreshing, or closing the tab before saving, lost it,
  and the crash backup was only offered back if it had more symbols, so quote
  typing never came back.
- Neither said whether anything had saved.

This was the same before the crop and scale update (checked on the old
master, 7636bdc): it's not new.

## What's different now

- **Presets save as you type**, and whenever the box closes, however it
  closes. Clicking outside closes just the presets, not the quote. A light at
  the bottom says **Saving…**, **Saved**, **Saved on this device, will upload
  when signal returns**, or in red **Not uploaded / Couldn't save** with why.
- **The quote saves the drawing by itself** a moment after you stop typing,
  and when you close the quote. A light by **Close** says **Saving…**, then the
  same words as the status bar (**Synced**, **Saved on this device,
  uploading…**, and so on), or in red **Couldn't save** with **Try again**.
- **A drawing that's never been saved** says **Not saved yet** in the quote,
  with a **Save drawing** button. Going back to the dashboard asks first.
- **Closing the tab or refreshing straight after typing:** the save is
  started, the browser may ask "Leave site?", and a backup is kept on the
  device. If the save didn't finish, reopening the drawing shows **Recovered
  unsaved work** with **Restore**, and Restore brings your typing back.
- A quote is a copy of your presets made when it's first opened, so changing
  presets doesn't change quotes already made. The presets box now says so:
  change the wording in the quote itself, or use **Reset to presets** there.

## Part A: presets (laptop)

**A1.** Open a TEST drawing → **Quote** → **Presets**. Change the
**Spec / notes** of the first item. Watch the light at the bottom: **Saving…**
then **Saved**.

**A2.** Click outside the presets box. The presets close; **the quote window
stays open**. Press **Presets** again: your text is there.

**A3.** Change it again and press **X** straight away. Reopen: it's there.
Again with **Close**: it's there.

**A4.** Refresh the page (F5), open the quote, **Presets**: still there.

**A5.** Start a **new** quote on a different TEST drawing (one that's never had
a quote): its lines use your new spec.

## Part B: the quote (laptop)

**B1.** In the quote, type a **Spec / notes** on a line, the **Client name**,
change a **supplier note**, a **quantity** and a **rate**. The light by **Close**
says **Saving…**, then **Synced**.

**B2.** Click outside the quote window (it closes), reopen: all there.

**B3.** Type something new and refresh the page **at once** (within a second).
If Edge asks "Leave site?", choose **Leave**. Reopen the quote: it's there,
or the drawing shows **Recovered unsaved work** → **Restore** brings it back.

**B4.** Type something new and close the **whole tab** at once. Open the
drawing again from the dashboard: as B3.

**B5.** On a drawing-linked line (Qty marked from the drawing), type your own
quantity. Close and reopen the quote: your quantity stays. **Refresh from
drawing** asks before replacing it.

**B6.** Make a **new drawing**, put a symbol on it, don't save, open
**Quote**. It says **Not saved yet** with **Save drawing**. Press it: the light
goes to **Synced**.

## Part C: no signal (laptop)

**C1.** Turn **Wi-Fi off**. Type in the quote and in **Presets**. Both lights
say **Saved on this device, will upload when signal returns**.

**C2.** Turn Wi-Fi back on and wait a minute. The lights go to **Synced** /
**Saved**. Open the drawing on the iPad: the quote and presets have it.

## Part D: a slow connection (laptop, optional)

If you're somewhere with weak signal: type, close the quote at once, close
the tab. Reopen the drawing: it's all there (or **Restore** brings it back).

## Part E: iPad (Safari)

**E1.** Do **A1–A3** with your finger: tapping outside the presets keeps your
typing and leaves the quote open.

**E2.** Type in the quote, then **swipe Safari away** (close it from the app
switcher) straight after. Open it again and the drawing: the typing is there,
or **Restore** brings it back.

**E3.** **Airplane Mode** on: type in the quote; the light says **Saved on this
device, will upload when signal returns**. Airplane Mode off: it goes to
**Synced**.

## Audit: every quote field, how it saves, and what it survives

All the quote's own fields are part of the drawing (its saved data, `boq`).
"Before" is master 8a4a2f9 (the same as 7636bdc); "now" is this branch.

| Field | Saved how (before) | Saved how (now) | Refresh | Close mid-edit | Slow / offline |
|---|---|---|---|---|---|
| Job details: Development, Site address, Prepared by, Supplier, Drawing no., Date issued, Required on site | With the drawing, only on Save or going to the dashboard | Saves itself 1.2 s after typing stops, and on closing the quote | Before ✗ / now ✓ | Before ✗ / now ✓ | ✓ (saved on the device, uploads later) |
| Client details: Client name, Client address, Quote reference, Valid until | Same | Same | ✗ / ✓ | ✗ / ✓ | ✓ |
| Line items: Item and Spec / notes, every section | Same | Same | ✗ / ✓ | ✗ / ✓ | ✓ |
| Quantities, including your own number on a drawing-linked line (kept as a manual override; Refresh from drawing asks before replacing) | Same | Same | ✗ / ✓ | ✗ / ✓ | ✓ |
| Rates / prices per line | Same | Same | ✗ / ✓ | ✗ / ✓ | ✓ |
| Labour lines (days × rate) | Same | Same | ✗ / ✓ | ✗ / ✓ | ✓ |
| On-quote ticks, added and deleted lines, lines added for symbols (and ones you deleted) | Same | Same | ✗ / ✓ | ✗ / ✓ | ✓ |
| Section titles, supplier notes | Same | Same | ✗ / ✓ | ✗ / ✓ | ✓ |
| VAT on/off, output choice (materials list or client quote, what the client sees) | Same | Same | ✗ / ✓ | ✗ / ✓ | ✓ |
| Markup | There's no markup field: prices are the rates on each line | — | — | — | — |
| **Presets**: default items, specs, section names, Charge VAT | Your account settings, only on **Save presets** | Saves itself 0.6 s after typing stops and on every way out | ✓ once saved / ✓ | ✗ (X, Close, click outside threw it away) / ✓ | ✓ (device first, then uploads; a refusal is shown in red) |
| Remembered "what the client sees" choice for your next new quote | Your account settings, when ticked | Unchanged | ✓ | ✓ | ✓, but a failure there is only logged, not shown (a remembered preference, not typing) |

Business information (the company name, logo and contact lines on the quote)
lives on its own screen and wasn't part of this change.

**Database:** no change needed. The settings table lets every account write its
own settings whatever its billing state (supabase/user_settings.sql), so no SQL
file comes with this.

**Known limits:** a brand-new drawing that has a quote but no symbols and has
never been saved isn't offered back after a crash (it asks before you leave,
and says **Not saved yet** in the quote). If the browser or iPad crashes
within about a second of typing, before the backup is written, that last
second can be lost.
