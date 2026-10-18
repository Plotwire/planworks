# Test plan: crop on import and true scale

Branch **crop-scale**, on the **stripe-plotwire-test** link once it's pushed.
Use the **test account** and **test drawings only** (name them `TEST …`), and
delete them at the end, including any **(copy)** ones. About 45 minutes:
Part A on the **laptop** (Edge), Part B on the **iPad** (Safari).

You need an architect's PDF with a title block, ideally the customer's kind:
**A3 at 1:50**. The Hook ground floor PDF is fine. If you have an A1, bring
that too. Also a **screenshot** or photo of a plan.

Write down anything that surprises you, with a screenshot.

## What's new, in one paragraph

Importing a plan now opens a **crop step**: drag the corners or edges to keep
just the floor plan (leave out the title block and the architect's margins),
drag inside to move the box, or drag across the page to draw a new one.
**Use whole page** keeps everything. For a **PDF** you can also give the
**Original drawing scale** (for example 1:50, as on the architect's title
block). Plotwire reads the PDF's real paper size and places the plan on our
A3 sheet at the **largest standard scale that fits** (1:20, 1:25, 1:50, 1:75,
1:100, 1:125, 1:200, 1:250 or 1:500), **sized exactly to that scale**, not
stretched. The title block shows it (for example **1:100 @ A3**) and a **scale
bar** appears in the bottom-left corner of the drawing area with **Print at
100% / actual size**. You can pick a smaller scale from **Prints on this
sheet at** if you want. No scale, or a picture: it's fitted as before and the
title block says **NTS**. The original PDF is kept untouched, so the plan
stays pin-sharp when zoomed (Safari included) and in the PDF download.

**Crop & scale** (top bar, beside Import) changes the crop or scale of the
plan already on a drawing. Symbols, notes, walls and furniture **move with the
plan** so they stay on the same spot of the building. If any of them would end
up outside the drawing area, nothing changes and it says so.

## Part A: laptop (Edge)

**A1. Crop and true scale.** New drawing → **Import** → the A3 1:50 PDF.
- The crop step opens showing the page, with **Paper: A3 · 420 × 297 mm**.
- Drag the corners so only the floor plan (and its dimensions) is inside the
  box; the title block and the architect's scale bar should be outside.
- **Original drawing scale: 1:50.** Check **Prints on this sheet at** shows the
  largest that fits (the exact one depends on the crop) and the line **Area
  kept is about … m on site** looks right for the building.
- **Use this area.** The plan appears without the title block, centred, at
  that scale. The bottom bar and the title block say **1:… @ A3**. A scale bar
  is bottom-left of the drawing area.

**A2. The scale is true on paper.** Download the PDF and print it at
**100% / actual size** on A3 (not "fit to page").
- Measure the scale bar with a ruler: at 1:100, 5 m should be **50 mm**.
- Measure a wall or dimension you know from the architect's drawing and
  check it against the scale (a 5 m wall at 1:100 = 50 mm; at 1:75 = 66.7 mm).
- (In my tests the exported PDF measured 50.02 mm for 5 m at 1:100, 40.01 mm
  at 1:125 and 66.67 mm at 1:75.)

**A3. Sharp when zoomed.** Zoom to 500% on small text. It should be crisp,
like before.

**A4. Save and reopen.** Save, go to the dashboard (the card shows the
cropped plan), reopen. Same crop, same scale, same scale bar.

**A5. Pick another scale.** **Crop & scale** → **Prints on this sheet at** →
a smaller one (bigger number) → **Use this area**. The plan gets smaller, the
title block and scale bar follow.

**A6. No scale.** Import the PDF again on a new drawing, crop it, leave
**Original drawing scale** as **Not known** → the plan fills the area as
before and the title block says **NTS**, with no scale bar.

**A7. A picture.** New drawing → import the screenshot/photo → crop it →
**Use this area**. Only the cropped part shows, sharp, and it says **NTS**
(there's no scale option for pictures).

**A8. Use whole page.** Import the PDF → **Use whole page** → it imports as it
did before this change.

**A9. Existing work moves with the plan (the important one).**
- Import the PDF **whole page**, no scale. Put about **five symbols** on clear
  features (corners of rooms, a door), a **note**, a **wall** and a **bed**.
  Save. Take a screenshot.
- **Crop & scale** → crop to the floor plan → **1:50** → a scale → **Use this
  area**. Every symbol, the note's arrow, the wall and the bed should sit on
  exactly the same spot of the building as in your screenshot (the bed gets
  bigger or smaller with the plan; symbols keep their size).
- **Crop & scale** again and drag the box so it cuts off some of your symbols
  → **Use this area**. It should refuse in red ("… would end up outside the
  drawing area, so nothing has changed") and change nothing. **Cancel**.
- **Undo** after a crop/scale change does nothing to the symbols (undo starts
  afresh there, so it can't pull them off the plan).

**A10. Older drawings open unchanged.** Open two or three drawings made before
this change. They look exactly as before; the title block scale is what it
was (NTS for ones nobody set).

**A11. Floor Plan drawings.** Open a drawing made with the Floor Plan tool and
press **Crop & scale**: it explains that the Floor Plan tool sets its own
scale, and changes nothing.

## Part B: iPad (Safari)

**B1.** Import the A3 PDF: the crop step opens. Drag the corner handles and
the box itself with your finger; it should follow your finger smoothly.
Set **1:50**, **Use this area**.

**B2.** Pinch-zoom to 240% and 500% on small text: crisp, same as the laptop.

**B3.** Save, close, reopen: same crop and scale. Turn on **Airplane Mode**,
open the drawing again: the plan, crop and scale are still there.
Download the PDF with no signal; it should still come out at the right scale.

**B4.** Do **A9** on the iPad (symbols move with the plan).

**B5.** Import a photo from the camera roll, crop it: works, says NTS.

## What it doesn't do (by design)

- It never changes the design or anything electrical: it only decides what
  part of the architect's page shows and how big it prints.
- No "click two points to set the scale" (that's version 2).
- A picture can be cropped smaller later, not bigger (only a PDF's original is
  kept). Re-import the picture to start again.
- Only page 1 of a PDF is used, as before.
- A typed "1:50 @ A3" on a drawing with no true scale still shows NTS (from the
  honest-scale change); setting the scale here is what makes it true.
