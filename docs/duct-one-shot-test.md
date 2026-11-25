# Test plan: Duct fixes (arrows, level and square, moving the ends)

Branch **duct-one-shot**, on the **stripe-plotwire-test** link. Use the
**test account** and a **test drawing only** (name it `TEST duct`), and
delete it at the end. About 20 minutes: Part A on the **laptop** (Edge, with
a mouse), Part B on the **iPad** (Safari).

**Before you start:** close every Plotwire tab that was open before the test
link was updated, then open it fresh (or press **Ctrl+F5**). On the iPad,
close the Safari tab and open the link again.

**Wire is unchanged.** Everything below is about **Duct** only.

## What's new, in plain English

- **Arrows all along a duct.** A duct now shows small arrows repeated along
  its whole length, evenly spaced, all pointing the way the air goes, instead
  of one arrowhead at an end. On screen they sit about 40 px apart whatever
  the zoom (zoom in and they spread out on the sheet; zoom out and there are
  fewer). Printed and in the PDF they're about 13 mm apart. A short duct gets
  one arrow in the middle.
- **Which way:** the arrows point from where you started the duct to where
  you ended it. To reverse them, pick **End → Start**: in the amber bar while
  drawing (**Airflow: Start → End | End → Start**), or later in the
  inspector (**Airflow**). Ducts don't have None or Both any more.
- **Ducts drawn before this:** ones with **Start** arrows point back to
  their start; every other duct (no arrows, End, or Both) now shows arrows
  pointing to its end.
- **Level and square while drawing.** After the first click, if the duct is
  within about **5°** of horizontal, vertical or 45°, it snaps exactly onto
  it. A faint dashed guide runs across the drawing and a small label says
  **Horizontal**, **Vertical** or **45°**. Hold **Shift** to force the snap
  (it goes to the nearest of the three, however far off). A click on or next
  to a symbol still joins the symbol, as before; with Shift held it doesn't.
- **Move a duct's ends.** Click a duct with **Select**: a round amber dot
  appears at each end. Drag one to move that end. It snaps the same way
  (5°, or Shift to force it), and it joins a symbol if you let go on one.
  Each drag is one **Ctrl+Z**.
- **The legend** sample for Duct shows an arrow and says **"Arrows show the
  airflow direction"**.
- Drawing marks only: nothing here sizes or checks a duct.

## Part A: laptop (Edge, with a mouse)

1. Sign in to the **test account**. Make a new drawing, name it `TEST duct`.
   Drop an **extractor fan** on the left of the plan.
2. **The bar:** press **Duct**. The amber bar says **"Drawing: Duct. Click
   the start, then the end. Duct then switches off. It snaps straight when
   it's close to horizontal, vertical or 45°."** Next to it: **Airflow:
   Start → End | End → Start** (Start → End chosen) and **Done**. There's
   no None / Start / End / Both on the duct bar.
3. **Arrows while drawing:** click the **fan**, then move the mouse slowly
   to the right. The duct follows the mouse with little arrows along it,
   all pointing away from the fan.
4. **Snap horizontal:** keep the mouse roughly level with the fan (a little
   above or below). The line jumps to exactly level, a faint dashed guide runs
   across the drawing, and **Horizontal** shows by the mouse. Move the mouse
   well up (about 20°): the guide goes and the line follows the mouse
   freely. Bring it back near level and click. The duct is drawn dead level,
   with arrows all along it pointing away from the fan, and Duct switches
   off.
5. **Evenly spaced:** look along the duct. The arrows are evenly spaced
   (roughly a finger-width apart on screen) from near the fan to near the
   end, not just one at the end. Zoom in (**+** a few times): there are more
   arrows, still about the same distance apart on screen. Zoom out: fewer.
   Press **0** to fit.
6. **Vertical and 45°:** press **D**, click empty plan, then click roughly
   straight below it: a vertical duct, **Vertical** shown just before the
   click. Press **D** again, click empty plan, then click at roughly 45°
   down-right: a 45° duct, **45°** shown before the click.
7. **Shift forces it:** press **D**, click empty plan, then move the mouse to
   about 20° off level: no guide. Hold **Shift**: the line jumps to level
   and the guide shows. Click with Shift still held: the duct is level. Let
   go of Shift.
8. **Reverse:** press **D**, choose **End → Start** in the bar, then draw a
   duct from left to right. Its arrows all point **left**, back to where you
   started. Choose **Start → End** again for the next steps.
9. **Select a duct:** press **Esc**, then click the step 4 duct (on the line
   itself). An amber dot at each end. The inspector says **Duct**, with
   **Line: Wire | Duct** and **Airflow: Start → End | End → Start**, and
   the hint "Drag the dot at either end to move that end". The bar at the
   bottom says **Drag the dot at either end to move it**, with **Shift
   keep it straight**.
10. **Reverse a placed duct:** press **End → Start** in the inspector: every
    arrow on it turns round. **Ctrl+Z**: they turn back.
11. **Drag an end:** drag the dot at the far end of the duct (not the fan
    end) a little up or down and along. While you drag, it stays level and
    the guide and **Horizontal** show, until you go well off level; then it
    follows the mouse freely. Let go somewhere near level: it's dead level.
    The guide goes when you let go.
12. **Shift while dragging:** drag the same dot to about 20° off level with
    **Shift** held: it stays level. Let go.
13. **Onto a symbol:** drop a second symbol (any) somewhere. Select the duct
    and drag its end dot onto that symbol, then let go: the duct now joins
    the symbol's edge. Drag the symbol: the duct's end follows it. **Ctrl+Z**
    to put the symbol back.
14. **Off a symbol:** drag the fan-end dot away from the fan into empty plan:
    that end is now a free point. **Ctrl+Z** puts it back on the fan (one
    Ctrl+Z per drag).
15. **Wire is unchanged:** press **Wire**. The bar still has **Arrows: None |
    Start | End | Both**. Choose **End**, click a point, then double-click
    almost (but not quite) level with it: the wire is **not** straightened,
    there's no guide, and it has **one** arrowhead, at its end. Select it: no
    amber end dots, and the inspector still has **Arrowheads**. Press **Esc**.
16. **The legend:** the Duct row's sample shows an arrow and reads **"Arrows
    show the airflow direction"**.
17. **Print and PDF:** **Save** (green tick), then **Download**. In the
    preview, each duct has arrows all along it, all one way (the reversed
    one pointing back to its start); no guide and no amber dots. **Download
    PDF** and open it: the same arrows on every duct, evenly spaced, about
    13 mm apart. The wire still has its single arrowhead.
18. **An old drawing:** open a drawing with ducts made before this. Each duct
    now has arrows along it: pointing back to the start on ducts that had a
    **Start** arrow, otherwise pointing to the end.

## Part B: iPad (Safari, landscape)

1. Open `TEST duct`. Tap **Duct**: the bar shows **Airflow: Start → End |
   End → Start** and **Done**.
2. Tap empty plan, then tap roughly level with it: the duct is dead level,
   with arrows along it.
3. Tap the duct: amber dots at both ends, easy to grab with a finger. Drag
   one: the end moves, snapping level near level. Let go.
4. In the inspector tap **End → Start**: the arrows turn round.
5. A pinch to zoom still works while the duct is selected.
6. Delete the `TEST duct` drawing at the end.

## If something's wrong

Note the step number and what you saw (a screenshot helps). Ducts are saved
inside the drawing; no database change was needed.
