# Test plan: Line types and floor links

Branch **lines-and-links** (built on **preset-prices**, which is built on
**stamp-mode**), on the **stripe-plotwire-test** link once it's pushed. Use
the **test account** and **test drawings only** (name them `TEST …`), and
delete them at the end. About 25 minutes: Part A on the **laptop** (Edge),
Part B on the **iPad** (Safari).

**Before you start:** close every Plotwire tab that was open before the test
link was updated, then open it fresh (or press **Ctrl+F5**). On the iPad,
close the Safari tab and open the link again.

## What's new, in plain English

- **The Wire tool draws two kinds of line.** Press **Wire**: a bar at the
  bottom of the drawing has **Wire | Duct** and **Arrows: None | Start | End |
  Both**. The next lines you draw take those settings.
  - **Wire** looks exactly as before (and follows View → Wire lines).
  - **Duct** is a thicker, long-dashed **blue** line (black in Mono).
- **Arrowheads on any line**, at the start (the symbol you tapped first), the
  end, or both. The tips stop at the edge of the symbol, not under it. On a
  duct, the arrow shows which way the air goes.
- **Change a line later:** tap it with **Select**. The inspector on the right
  has **Line: Wire | Duct** and **Arrowheads: None | Start | End | Both**.
- **The legend** lists **Wire** and **Duct** under the symbols, when the
  drawing uses them, with a sample line (and "Arrow shows the direction" /
  "Arrow shows the airflow direction" when arrows are used).
- **Floor links:** two new symbols at the bottom of the Symbols list, under
  **Floor links** (or search "floor"):
  - **Up to floor above** (circle, arrow up) and **Down to floor below**
    (circle, arrow down).
  - A new one is labelled with the floor it points to, e.g. **"To First
    floor"**. Change it in the inspector's **Label / Reference**, e.g. "To FF
    landing switch". The label prints under the symbol.
  - Placing one asks **"Put the matching ↓ on First floor, in the same
    spot?"**. **Place it** puts the partner there, labelled back ("To Ground
    floor"). Up links pair with the next floor tab, down links with the one
    before. With no floor there, it says so.
- **Drawing marks only.** Ducts and floor links aren't counted on the quote
  or the materials list (add a line by hand if you want one). Nothing sizes,
  calculates or suggests anything.
- Lines and floor links save, print and export to the PDF like everything
  else. Mirror copy copies a line's type and arrows. Drawings made before
  this look exactly as they did, except that the legend now lists **Wire**
  when a drawing has wires.

## Part A: laptop (Edge)

1. Sign in to the **test account**. Open a `TEST` drawing with **two floors**
   (Ground floor and First floor tabs) and some symbols on the ground floor.
   If you need one, make a drawing, add a floor, and drop a few downlights.
2. **The chooser:** press **Wire**. At the bottom of the drawing:
   **Wire | Duct**, **Arrows: None | Start | End | Both**, "click a symbol,
   then another". Nothing hides behind the zoom buttons.
3. **A duct with an airflow arrow:** choose **Duct** and **End**. Click one
   symbol, then another. A thick blue dashed line joins them, with an
   arrowhead at the second symbol, its tip at the symbol's edge.
4. **A wire with arrows both ends:** choose **Wire** and **Both**. Link two
   other symbols: the usual red dashed line, with an arrowhead at each end.
5. **A plain wire:** choose **None**, link two more. Exactly the old line.
6. **Change one:** press **Select** (or **Esc**), click the duct (on an empty
   part of it). The inspector says **Duct**, with **Line** and
   **Arrowheads**. Press **Start**: the arrow moves to the first symbol.
   Press **Wire**: it becomes a red dashed wire. Press **Duct** again.
   **Ctrl+Z** undoes each change.
7. **The legend** (left of the sheet): under the symbols, **Wire** (with
   "Arrow shows the direction") and **Duct** (with "Arrow shows the airflow
   direction"), each with a little sample line.
8. **View → Colours** to **Mono**: the duct turns black, still thick and
   long-dashed. Back to your usual colours.
9. **Floor link:** search `floor` (or scroll to **Floor links** at the
   bottom). Drag **Up to floor above** onto the ground floor.
   - Under the symbol: **"To First floor"**. The inspector's Label /
     Reference says the same.
   - A light blue bar: **"Put the matching ↓ on First floor, in the same
     spot?"** Press **Place it**.
10. Open the **First floor** tab: a **Down to floor below** sits in the same
    spot, labelled **"To Ground floor"**.
11. **No floor below:** on the Ground floor, drag **Down to floor below** on.
    The bar says there's no floor below yet. Press **OK**, then delete it.
12. **Change a label:** select the up link, type `To FF landing switch` in
    Label / Reference. It shows under the symbol.
13. **The quote:** press **Quote**. There's **no** line for floor links or
    ducts (wires and ducts were never counted). Close it.
14. **Save and the PDF:** **Save** (green tick), **Download**, **Download
    PDF**. In the PDF: the duct (blue, thick), the arrowheads, both floor
    links with their labels on the right pages, and Wire / Duct in each
    page's legend where used.
15. **Mirror copy:** Select several, pick the symbols joined by the duct,
    Mirror copy across a line, Place. The copies are joined by a duct with
    the same arrowhead.
16. **An old drawing:** open a drawing from before this test. It looks the
    same, apart from **Wire** now listed in its legend if it has wires.

## Part B: iPad (Safari, landscape)

1. Open the `TEST` drawing. Tap **Wire**: the chooser is at the bottom,
   clear of everything. Choose **Duct**, **End**, tap two symbols.
2. Tap **Select**, tap the duct: the inspector shows Line and Arrowheads.
   Tap **Both**.
3. Drag **Up to floor above** in from **Floor links**, tap **Place it**.
   Check the First floor tab.
4. **Save**. Delete the `TEST` drawings at the end.

## If something's wrong

Note the step number and what you saw (a screenshot helps). Lines and floor
links are saved inside the drawing; no database change was needed.
