# Test plan: Mirror copy (semis)

Branch **mirror-copy**, on the **stripe-plotwire-test** link once it's pushed.
Use the **test account** and **test drawings only** (name them `TEST …`), and
delete them at the end. About 30 minutes: Part A on the **laptop** (Edge),
Part B on the **iPad** (Safari).

**Before you start:** close every Plotwire tab that was open before the test
link was updated, then open it fresh (or press **Ctrl+F5**).

You need a plan of a **pair of semis** (or any two mirror-image houses on one
plan) as a PDF or picture. If you don't have one, any plan with a clear line
to mirror across will do.

## What's new, in plain English

- **Select several** (the dashed-box button under the Select and Wire tools on
  the left): drag a box round symbols, or tap symbols one by one to add or
  take them out. **Select all on this floor** (or **Ctrl+A**) picks every
  symbol on the floor you're on. **Shift+click** with the normal Select tool
  adds symbols too.
- While you're picking and mirroring, a **bright yellow bar** sits above the
  drawing (the drawing moves down to make room: the bar never covers it). It
  says in one line what to do next, with big buttons and a **Cancel**.
- **Mirror copy** (in that bar): **click two points on the party wall** (on
  its centre line, anywhere along it) to set the mirror line. The line shows
  as you move, and **faint copies** show where everything will land. The line
  snaps **straight up-and-down or across**; untick **Straight line** for any
  angle. **Place N copies** puts them down and ends mirror copy (the bar
  goes); **Redraw line** starts the line again; **Cancel** (or **Esc**) stops
  and the bar goes.
- The copies are **mirrored**: a switch beside a door in one house sits beside
  the matching door in the other, facing the other way. Text in a symbol
  (the "2" on a 2-gang switch, "USB-C", "S") is never back to front. The
  originals don't change.
- **Wires** between two picked symbols are copied too.
- The copies are ordinary symbols: the **quote counts them**, and **one undo
  (Ctrl+Z) removes the whole mirror copy**.
- Copies that would land off the drawing area are shown **in red**, the bar
  says how many, and **Place** stays off until you redraw the line.

## Part A: laptop (Edge)

**A1. Set up the left house.** New TEST drawing → **Import** the semis plan
(whole page, or cropped). In the **left house only**, place a typical
layout, including:
- a **light switch beside the front door** (on the latch side),
- a **2-gang switch** beside the living room door, turned to suit the wall,
- **sockets on the walls** (flat side against the wall), one with **USB-C**,
- a **downlight** and a **pendant**, a **smoke alarm** in the hall,
- a **wire** from a switch to its light.
Save. Open **Quote** and note a few quantities (sockets, switches, lights).

**A2. Pick the left house.** Press the **Select several** button (dashed box).
The yellow bar appears above the drawing: "Pick the symbols to copy…". Drag
a box round the left house's symbols. The bar says e.g. **"9 symbols
picked"** and each picked symbol has an amber box. Tap one to take it out, tap
it again to put it back. Check every button in the bar is easy to hit and
nothing of the drawing is hidden behind it.

**A3. The mirror line.** Press **Mirror copy**. Zoom in on the party wall if
you like (for the best accuracy). Click a point on the **centre of the party
wall**, move the pointer down the wall (the line follows, straight), and
click a second point further down. Faint copies appear in the right house.
Check they line up with the right house's walls and doors **before placing**.

**A4. Place.** Press **Place N copies**: the yellow bar goes. Check, zoomed in:
- every copy sits on the **matching spot of the right house** (sockets' flat
  backs on the matching walls, switches beside the matching doors),
- switches **face the other way**, as the doors do,
- the **2** on the 2-gang switch, **USB-C** and **S** read normally (never
  backwards),
- the **wire** was copied between the copied switch and light,
- the left house hasn't changed.

**A5. The quote counts double.** Open **Quote**: each quantity you noted is
now **twice** what it was.

**A6. One undo.** **Ctrl+Z** once: every copy (and its wire) goes, nothing
else. **Ctrl+Y** brings them back.

**A7. Save, reopen, print.** Save, go to the dashboard, reopen: the copies are
there, still mirrored. **Download** the PDF: the copies are mirrored there
too, with readable text.

**A8. Off the edge.** **Select all on this floor** → **Mirror copy**, and put
the line near the edge of the sheet. Copies off the drawing area show in
**red**, the bar says how many, and **Place** is greyed out. **Redraw line**,
or **Cancel**.

**A9. Any angle.** Pick a couple of symbols, **Mirror copy**, untick
**Straight line**, and draw a slanted line. The faint copies follow the slant.
Place, then **Ctrl+Z**.

**A10. Other floors and Floor Plan drawings.** Add a floor (or open a drawing
made with the **Floor Plan** tool) and do A2–A6 there: it works the same, and
only touches the floor you're on.

**A11. No signal.** Turn Wi-Fi off, do a mirror copy, **Save**: the status says
**"Saved on this device, will upload when signal returns"**. Wi-Fi on: it goes
to **Synced**.

## Part B: iPad (Safari)

**B1.** Open your TEST drawing. Tap **Select several**, then drag a box round
the left house **with one finger** (or tap symbols one by one).

**B2.** Tap **Mirror copy**, then **tap two points on the party wall's centre
line** (anywhere along it: it doesn't have to be the ends). Check the faint
copies, tap **Place N copies**.

**B3.** Check A4 by eye (pinch to zoom in), then **undo** once: they all go.

**B4.** Start again and press **Cancel** in the yellow bar: it goes, nothing
changes. The bar never covers the drawing (the drawing sits below it), and its
buttons are big enough for a finger.

## Notes

- How exactly the copies line up depends on where the line is clicked: zoom
  in on the party wall's centre line for the best result. Snapping keeps the
  line exactly upright, so only its position across matters.
- Mirror copy only changes where symbols are and which way they face. It
  never changes what they are.
- In my tests (practice copy, sample data): a pair of semis at 1:50 with 8
  symbols (switches, sockets, USB-C, lights, smoke) and 2 wires; every copy
  landed exactly on the mirrored spot (0 mm off), mirrored, text readable,
  wires copied, quote doubled, one undo, saved and reopened, PDF right.
  Also: a Floor Plan drawing (57 symbols), lines across and at an angle,
  off-the-edge refusal, no signal, Edge, Safari's engine and a finger at iPad
  size. Not yet on a real iPad or Mac.
