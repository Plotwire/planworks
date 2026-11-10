# Test plan: Preset prices

Branch **preset-prices** (built on **stamp-mode**), on the
**stripe-plotwire-test** link once it's pushed. Use the **test account** and
**test drawings only** (name them `TEST …`), and delete them at the end.
About 15 minutes on the **laptop** (Edge); a quick look on the iPad at the end.

**Before you start:** close every Plotwire tab that was open before the test
link was updated, then open it fresh (or press **Ctrl+F5**).

## What's new, in plain English

- **Quote presets can hold a price on each line.** Open a quote, press
  **Presets**: there's a new **Unit rate** column, with a £ box on every line.
  Type your usual selling price (before VAT). Leave it blank for no price.
- **New quotes start with your prices filled in.** The quantities still come
  off the drawing, so most of the quote is done when it opens.
- **Quotes you've already started keep their own prices.** Changing a preset
  price never changes a quote you've begun. You can still change any price on
  any quote.
- **Reset to presets** (bottom of the quote) rebuilds the quote with your
  current preset prices.
- Labour lines can have preset prices too (e.g. your day rate).
- The heading now says **Default items, specs & prices**, and the notes say
  what the prices do.
- A price that isn't a number is outlined amber and isn't saved.

**Known limit:** a symbol that isn't on your preset list (it appears on the
quote as its own line, e.g. "Ceiling Mounted Extract") starts at £0, as now.

## Steps (laptop, Edge)

1. Sign in to the **test account**. Open any `TEST` drawing with some
   downlights and double sockets on it (or make one: stamp a few, see the
   stamp mode test). **Save**.
2. Press **Quote**. Note the Downlights and Double sockets lines show **0** in
   Unit rate (no preset prices yet).
3. Press **Presets**. Check:
   - the heading says **Default items, specs & prices**;
   - the blue note ends **"keep their own wording and prices"**;
   - every line has a **Unit rate** box with a **£**, showing **—** when empty.
4. Type prices: **Downlights 14.50**, **Double sockets 6.80**, and under
   Labour, **First fix labour 280**. The light at the bottom goes **Saving…**
   then a green **Saved**.
5. Type **abc** in the Pendants price: it's outlined amber. Clear it again.
6. Press **Close**. The quote says **"Presets saved. This quote is
   unchanged."** and the lines still show **0**. (This quote was started
   before the prices, so it keeps its own.)
7. Press **Reset to presets** at the bottom and read the question: it says
   every price goes back to your preset price. Press **OK**. Downlights now
   show **14.50**, Double sockets **6.80**, First fix labour **280**, with the
   totals worked out.
8. Change the Downlights price on this quote to **16**. Close the quote and
   open **Presets** again from another quote: the preset still says **14.5**.
9. **A new quote:** make a new `TEST` drawing, put a few downlights and
   double sockets on it, **Save**, press **Quote**. The prices are already
   there: **14.5** and **6.8**, and **280** on First fix labour. Lines with no
   preset price show **0**.
10. **An old quote stays as it was:** open a drawing whose quote you priced
    before this test. Its prices are exactly as you left them.
11. **Back to how it was:** in Presets, clear the three prices (blank) so the
    test account is as before. New quotes start at 0 again.
12. **iPad:** open Presets once and tap a Unit rate box: the number keyboard
    comes up, and a price saves the same way.
13. Delete the `TEST` drawings.

## If something's wrong

Note the step number and what you saw (a screenshot helps). The prices are
saved with the account's presets (the same place as the items and specs);
no database change was needed.
