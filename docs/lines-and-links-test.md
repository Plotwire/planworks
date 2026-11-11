# Test plan: Line types and floor links

Branch **lines-and-links** (built on **preset-prices**, which is built on
**stamp-mode**), on the **stripe-plotwire-test** link once it's pushed. Use
the **test account** and **test drawings only** (name them `TEST …`), and
delete them at the end. About 30 minutes: Part A on the **laptop** (Edge,
with a mouse), Part B on the **iPad** (Safari).

**Before you start:** close every Plotwire tab that was open before the test
link was updated, then open it fresh (or press **Ctrl+F5**). On the iPad,
close the Safari tab and open the link again.

## What's new, in plain English

- **Fast stamping never loses a click.** In stamp mode, a click or tap that
  wobbles a little (up to about 10 px with a mouse, 16 px on touch) always
  places a symbol, however fast you go. Only a clear drag moves the drawing.
- **Wire and Duct are two buttons** in the left toolbar, one under the
  other, both big and labelled. Keyboard: **W** for Wire, **D** for Duct.
- **A top bar while you draw**, in the same amber style as the Mirror copy
  bar: **"Drawing: Duct. Click points to draw the run, double-click to
  finish."** (Tap / double-tap on the iPad), with **Arrows: None | Start |
  End | Both** and **Done**. The drawing gets shorter to make room, so
  nothing hides behind it or the zoom buttons. The old bar at the bottom has
  gone.
- **Lines start and end anywhere.** The first click can be on a symbol or on
  empty plan. Every click after that adds a bend. To finish: double-click
  (double-tap), press **Enter**, or press **Done**. A click near a symbol
  snaps to it. **Backspace** takes off the last point; **Esc** throws the
  line away. Picking another tool finishes the line.
- **What the lines look like:**
  - **Wire** looks exactly as before (and follows View → Wire lines).
  - **Duct** is a thicker, long-dashed **blue** line (black in Mono).
  - **Arrowheads** go at the start (where you began), the end, or both. On a
    symbol, the tip stops at its edge; on a free end, the tip is right on the
    point. On a duct, the arrow shows which way the air goes.
- **Moving and deleting:** points on symbols follow the symbol when it moves;
  free points stay where they are. Deleting a symbol removes a straight
  symbol-to-symbol line on it (as always), but a line with bends or free
  ends keeps its shape. To reshape a line, delete it and draw it again.
- **Change a line later:** click it with **Select**. The inspector on the
  right has **Line: Wire | Duct** and **Arrowheads: None | Start | End |
  Both**.
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
  else. Mirror copy copies a line when all of its symbols are copied, free
  points mirrored too. Drawings made before this look exactly as they did,
  except that the legend now lists **Wire** when a drawing has wires.

## Part A: laptop (Edge, with a mouse)

1. Sign in to the **test account**. Open a `TEST` drawing with **two floors**
   (Ground floor and First floor tabs). On the ground floor, put down an
   **extractor fan**, a **light switch** and a few downlights. If you need
   a drawing, make one, add a floor, and drop them on.
2. **Fast stamping:** click the **Downlight** tile (stamp mode). Click the
   drawing as fast as you can, 10 times in about 2 seconds, without trying to
   hold the mouse still. **10 downlights** appear (SYMBOLS at the bottom goes
   up by 10). Now press and drag a good distance: the drawing moves and
   nothing is placed. **Ctrl+Z** away the extra downlights. Press **Done**.
3. **The buttons:** in the left toolbar, **Wire** and, under it, **Duct**,
   both the same big teal labelled buttons.
4. **The top bar:** press **Duct**. An amber bar across the top of the
   drawing: **"Drawing: Duct. Click points to draw the run, double-click to
   finish."**, then **Arrows: None | Start | End | Both** and **Done**. The
   zoom buttons are below it, not covered. There's no bar at the bottom.
5. **Duct, fan to the outside wall:** choose **End**. Click the **extractor
   fan**, then double-click on the **outside wall** (or just outside it). A
   thick blue dashed line from the fan to the wall, with an arrowhead at the
   **wall** end, its tip on the point you clicked. Back at the fan, the line
   starts at the fan's edge.
6. **Wire, switch to beside a floor link:** drag **Up to floor above** onto
   the plan (press **Place it** or **OK** on the blue bar). Press **Wire**,
   choose **End**. Click the **switch**, then double-click on empty plan
   just **beside** the up link (not on it). A red dashed wire with an
   arrowhead at the empty end.
7. **A wire with bends:** still on Wire, choose **None**. Click empty plan,
   click two or three more places, then press **Enter**. A wire with bends at
   each click. Start another: click twice, press **Backspace** (the last
   point goes), then **Esc** (the whole line goes).
8. **Snap:** start a wire on empty plan and click just off a downlight (not
   quite on it). The line joins the downlight's centre. Double-click to
   finish.
9. **Done:** start a duct with two clicks, then press **Done**. The duct is
   kept, and the tool goes back to **Select**.
10. **Lines follow their symbols:** with **Select**, drag the fan
    somewhere else. The duct's fan end follows it; the wall end stays put.
    **Ctrl+Z**.
11. **Change one:** click the duct (on the line itself). The inspector says
    **Duct**, with **Line** and **Arrowheads**. Press **Start**: the arrow
    moves to the fan end. Press **Wire**: it becomes a red dashed wire.
    Press **Duct** and **End** again. **Ctrl+Z** undoes each change.
12. **The legend** (left of the sheet): under the symbols, **Wire** (with
    "Arrow shows the direction") and **Duct** (with "Arrow shows the airflow
    direction"), each with a little sample line.
13. **View → Colours** to **Mono**: the duct turns black, still thick and
    long-dashed. Back to your usual colours.
14. **Floor links:** open the **First floor** tab. If you pressed Place it
    in step 6, a **Down to floor below** sits in the same spot, labelled
    **"To Ground floor"**. Back on the Ground floor, drag **Down to floor
    below** on: the bar says there's no floor below yet. Press **OK**, then
    delete it.
15. **Change a label:** select the up link, type `To FF landing switch` in
    Label / Reference. It shows under the symbol.
16. **Delete a symbol:** with **Wire**, click one downlight and double-click
    another (a straight wire). With **Select**, click the first downlight and
    press Delete: the wire goes with it. **Ctrl+Z**. Now delete the downlight
    the step 8 wire ends on: that wire stays where it was. **Ctrl+Z**.
17. **The quote:** press **Quote**. There's **no** line for floor links or
    ducts (wires and ducts were never counted). Close it.
18. **Save and the PDF:** **Save** (green tick), **Download**, **Download
    PDF**. In the PDF: the duct from the fan to the wall with its arrow at
    the wall, the switch wire with its arrow beside the up link, the bent
    wire, both floor links with their labels on the right pages, and
    Wire / Duct in each page's legend where used.
19. **Mirror copy:** Select several, pick the fan (and anything else), Mirror
    copy across a line, Place. The copied fan has its own duct, with the
    wall end mirrored and the same arrowhead.
20. **An old drawing:** open a drawing from before this test. It looks the
    same, apart from **Wire** now listed in its legend if it has wires.

## Part B: iPad (Safari, landscape)

1. Open the `TEST` drawing. **Fast stamping:** tap a symbol tile, then tap
   the drawing quickly, 8 times or so. Every tap places one. A swipe moves
   the drawing and places nothing. Undo the extras, tap **Done**.
2. Tap **Duct**: the amber bar is at the top, clear of the zoom buttons and
   everything else. Tap **End**, tap the fan, then double-tap just outside
   the wall. The duct is drawn with its arrow at the wall.
3. Tap **Wire**, tap a symbol, tap two empty places, then tap **Done**. A
   wire with a bend, and the tool is back on Select.
4. Tap the duct: the inspector shows Line and Arrowheads. Tap **Both**.
5. **Save**. Delete the `TEST` drawings at the end.

## If something's wrong

Note the step number and what you saw (a screenshot helps). Lines and floor
links are saved inside the drawing; no database change was needed.
