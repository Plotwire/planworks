# Test plan: Stamp mode

Branch **stamp-mode**, on the **stripe-plotwire-test** link once it's pushed.
Use the **test account** and **test drawings only** (name them `TEST …`), and
delete them at the end. About 15 minutes: Part A on the **laptop** (Edge),
Part B on the **iPad** (Safari).

**Before you start:** close every Plotwire tab that was open before the test
link was updated, then open it fresh (or press **Ctrl+F5**). On the iPad,
close the Safari tab and open the link again.

## What's new, in plain English

- **Double-click a symbol in the Symbols list** (double-tap on the iPad) and
  it stays on your finger: every click or tap on the drawing places another
  one. No more dragging from the list for each of 20 downlights.
- While stamping:
  - an **amber bar** above the drawing says what you're stamping, with a big
    **Done** button;
  - that symbol's tile in the list has a **thick teal ring** (in Recent too);
  - the status bar at the bottom says **TOOL STAMP**.
- **Dragging** on the drawing still moves it around, so you can stamp, move
  along, and stamp again. Two fingers still zoom on the iPad.
- Each new one **turns the way the last one was turned**. Place a socket,
  tap 90°, and the next sockets along that wall come out at 90° too.
- Each one is its **own undo step**, counted in the quote and added to Recent
  like any other symbol.
- **To stop:** tap the ringed tile again, press **Done**, pick another tool
  (Wire, Select several…), or press **Esc**.
- A single tap on a tile does nothing new. Dragging from the list works
  exactly as before.
- Try accounts: stamping stops placing at the 25-symbol limit, with the usual
  message.

## Part A: laptop (Edge, a normal-size window)

1. Sign in to the **test account**. Make a new drawing, name it `TEST stamp`.
2. **Start:** search `downl` and **double-click** the downlight tile.
   - The amber bar says **"Stamping Ceiling mounted downlight. Click the
     drawing to place each one."** with **Done** on the right.
   - The tile has a thick teal ring. The status bar says **TOOL STAMP**, and
     the pointer over the drawing is the copy arrow.
3. **Stamp:** click the drawing **six times** in different places. Six
   downlights appear where you clicked; **SYMBOLS 6**.
4. **Move along:** drag an empty part of the drawing. It moves; **no**
   downlight is added. Click again: one more appears (**SYMBOLS 7**).
5. **Undo:** press **Ctrl+Z**. The last one goes (**SYMBOLS 6**) and you're
   still stamping.
6. **Stop with the tile:** click the ringed downlight tile **once**. The bar
   goes, the ring goes, the status bar says **TOOL SELECT**. Click the
   drawing: nothing is added.
7. **Turned sockets:** search `double socket low`, double-click its tile,
   click once on a wall. In the inspector on the right, press **90°**. Click
   twice more along the same wall: both new sockets come out **at 90°**
   (the inspector shows **ROT 90°**).
8. **Stop with Done:** press **Done** in the amber bar. Stamping stops.
9. **Stop with Esc:** double-click a tile again, then press **Esc**. It stops.
10. **Stop with another tool:** double-click a tile, then press **Wire**.
    The bar goes; the Wire tool works as before.
11. **One click does nothing new:** click a tile once, then click the
    drawing. Nothing is placed (drag from the list as usual to add one).
12. **Drag as usual:** drag a symbol from the list onto the drawing. It's
    placed as before.
13. **The help card:** press **?**. Under Draw: **"Stamp: a symbol in the
    palette, then click the drawing for each one"** with **double-click**.
14. **Quote and save:** press **Save** (green tick), open **Quote**. The
    downlights and sockets you stamped are counted.

## Part B: iPad (Safari, landscape)

1. Open `TEST stamp`. Search `smoke` and **double-tap** the smoke detector
   tile. The amber bar says **Tap the drawing to place each one**.
2. **Tap** the drawing four times: four smoke detectors.
3. **Drag with one finger** on an empty part: the drawing moves, nothing is
   added. **Pinch** to zoom: nothing is added.
4. Tap the ringed tile again: stamping stops.
5. Press the keyboard button at the top right (Touch gestures): under Draw,
   **"Add the same symbol again and again: Double-tap it in the palette,
   then tap the drawing for each one."**
6. **Save**, then delete `TEST stamp` from the dashboard.

## If something's wrong

Note the step number and what you saw (a screenshot helps). Nothing here
changes saved drawings, quotes or the database: stamped symbols are ordinary
placed symbols.
