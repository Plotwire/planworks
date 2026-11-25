// Ducts (branch duct-one-shot): airflow arrows repeated all along the line,
// snapping horizontal, vertical or 45° (Shift forces it), and dragging an end
// after it's drawn. Wire is unchanged. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  flowArrows, lineArrowMarks, runArrowHeads, ductFlow, DUCT_FLOWS, DUCT_ARROW_GAP, screenArrowGap,
  squareSnap, SQUARE_SNAP_DEG, withEnd, visibleEnds, lineFromNodes, linesUsed, lineLook,
} from "../lib/lineTypes.js";

// An arrow's tip and the middle of its base, from its polygon points.
const tipAndBase = (poly) => {
  const [[tx, ty], [ax, ay], [bx, by]] = poly.split(" ").map((p) => p.split(",").map(Number));
  return { tip: { x: tx, y: ty }, base: { x: (ax + bx) / 2, y: (ay + by) / 2 } };
};
const duct = lineLook({ type: "duct" }, "standard", "colour");
const straight = (len, gapA = 0, gapB = 0) => [{ x: 0, y: 0, gap: gapA }, { x: len, y: 0, gap: gapB }];

test("a duct's arrows repeat along its whole length, evenly, all pointing the same way", () => {
  const arrows = flowArrows(straight(480), "end", duct.width);
  assert.equal(arrows.length, 480 / DUCT_ARROW_GAP); // 10, about 48 units apart
  const mids = arrows.map((a) => { const { tip, base } = tipAndBase(a); return (tip.x + base.x) / 2; });
  const steps = mids.slice(1).map((m, i) => +(m - mids[i]).toFixed(6));
  assert.ok(steps.every((s) => s === steps[0]), "evenly spaced");
  assert.equal(steps[0], 48);
  for (const a of arrows) { const { tip, base } = tipAndBase(a); assert.ok(tip.x > base.x, "points to the end"); }
  // the first and last are well inside the line, not at its ends
  assert.ok(mids[0] > 10 && mids[mids.length - 1] < 470);
});

test("End → Start reverses every arrow; a duct saved with no arrows, End or Both points to its end", () => {
  for (const a of flowArrows(straight(300), "start", duct.width)) { const { tip, base } = tipAndBase(a); assert.ok(tip.x < base.x); }
  assert.equal(ductFlow({ type: "duct", arrows: "start" }), "start");
  for (const arrows of [undefined, "none", "end", "both"]) assert.equal(ductFlow({ type: "duct", arrows }), "end");
  assert.deepEqual(DUCT_FLOWS.map((f) => f.value), ["end", "start"]);
  // drawn as Start → End, a duct is saved with arrows "end"; reversed, "start"
  assert.equal(lineFromNodes("d", [{ x: 0, y: 0 }, { x: 99, y: 0 }], "duct", "end").arrows, "end");
  assert.equal(lineFromNodes("d", [{ x: 0, y: 0 }, { x: 99, y: 0 }], "duct", "start").arrows, "start");
});

test("a short duct gets one arrow in the middle; one too short to hold an arrow gets none", () => {
  const one = flowArrows(straight(40), "end", duct.width);
  assert.equal(one.length, 1);
  const { tip, base } = tipAndBase(one[0]);
  assert.equal(+((tip.x + base.x) / 2).toFixed(6), 20);
  assert.deepEqual(flowArrows(straight(8), "end", duct.width), []);
});

test("arrows stay off the symbols at the ends, and follow the line round a bend", () => {
  const arrows = flowArrows(straight(200, 20, 20), "end", duct.width);
  for (const a of arrows) { const { tip, base } = tipAndBase(a); assert.ok(base.x >= 20 && tip.x <= 180); }
  const bent = flowArrows([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }], "end", duct.width);
  const down = bent.map(tipAndBase).filter(({ tip, base }) => tip.x === base.x && tip.y > base.y);
  const across = bent.map(tipAndBase).filter(({ tip, base }) => tip.y === base.y && tip.x > base.x);
  assert.ok(down.length >= 3 && across.length >= 3);
});

test("Wire is unchanged: its arrowheads are only at the start, the end, or both", () => {
  const pts = straight(480);
  for (const arrows of ["none", "start", "end", "both"])
    assert.deepEqual(lineArrowMarks(pts, { arrows }, 1), runArrowHeads(pts, arrows, 1));
  assert.equal(lineArrowMarks(pts, { arrows: "end" }, 1).length, 1);
  assert.equal(lineArrowMarks(pts, { type: "duct", arrows: "end" }, duct.width).length, 10);
});

test("the legend shows a duct's arrows always, a wire's only when it has them", () => {
  assert.deepEqual(linesUsed([{ type: "duct" }]), [{ type: "duct", arrows: true }]);
  assert.deepEqual(linesUsed([{}]), [{ type: "wire", arrows: false }]);
});

test("within a few degrees of horizontal, vertical or 45°, a duct's end snaps exactly onto it", () => {
  const a = { x: 100, y: 100 };
  assert.equal(SQUARE_SNAP_DEG, 5);
  const off = (deg, len = 200) => ({ x: a.x + len * Math.cos((deg * Math.PI) / 180), y: a.y + len * Math.sin((deg * Math.PI) / 180) });
  assert.deepEqual({ ...squareSnap(a, off(4)), x: 0 }, { x: 0, y: 100, dir: "h" });
  assert.equal(squareSnap(a, off(-94)).x, 100); // vertical, upwards
  assert.equal(squareSnap(a, off(-94)).dir, "v");
  const d = squareSnap(a, off(130)); // 45° down-left (y is down)
  assert.equal(d.dir, "d");
  assert.ok(Math.abs(Math.abs(d.x - a.x) - Math.abs(d.y - a.y)) < 1e-9);
  assert.ok(d.x < a.x && d.y > a.y);
  // not close to one: left where it is
  assert.equal(squareSnap(a, off(20)), null);
  assert.equal(squareSnap(a, off(6)), null);
  // too close to the other end to say
  assert.equal(squareSnap(a, { x: 100.5, y: 100 }), null);
});

test("Shift forces the snap to the nearest of horizontal, vertical or 45°", () => {
  const a = { x: 0, y: 0 };
  assert.equal(squareSnap(a, { x: 100, y: 20 }, true).dir, "h");   // 11°
  assert.equal(squareSnap(a, { x: 100, y: 80 }, true).dir, "d");   // 39°
  assert.equal(squareSnap(a, { x: 30, y: 100 }, true).dir, "v");   // 73°
});

test("on the grid, a snapped end stays exactly horizontal, vertical or at 45°", () => {
  const grid = (v) => Math.round(v / 12) * 12;
  const a = { x: 101, y: 103 }; // a symbol's centre, off the grid
  const h = squareSnap(a, { x: 297, y: 110 }, false, grid);
  assert.deepEqual(h, { x: 300, y: 103, dir: "h" });
  const v = squareSnap(a, { x: 95, y: 290 }, false, grid);
  assert.deepEqual(v, { x: 101, y: 288, dir: "v" });
  const d = squareSnap(a, { x: 200, y: 205 }, false, grid);
  assert.equal(d.x % 12, 0);
  assert.equal(d.y - a.y, d.x - a.x);
});

test("dragging an end moves just that end, and saves the line as drawing it would", () => {
  const between = { id: "d1", fromId: "fan", toId: "vent", type: "duct", arrows: "start" };
  const freed = withEnd(between, "end", { x: 300.04, y: 120 });
  assert.deepEqual(freed, { id: "d1", type: "duct", arrows: "start", pts: [{ id: "fan" }, { x: 300, y: 120 }] });
  // back onto a symbol: symbol to symbol again, saved as before
  assert.deepEqual(withEnd(freed, "end", { id: "vent" }), between);
  const run = { id: "d2", pts: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }], type: "duct" };
  assert.deepEqual(withEnd(run, "start", { x: 10, y: 0 }).pts, [{ x: 10, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }]);
});

test("the end handles sit where the line shows: a symbol's edge, or right on a free point", () => {
  assert.deepEqual(visibleEnds([{ x: 0, y: 0, gap: 12 }, { x: 100, y: 0, gap: 0 }]), { start: { x: 12, y: 0 }, end: { x: 100, y: 0 } });
});

// The editor and sheet need a browser, so these check their source.
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const editor = read("components/ElectricalPlanTool.jsx");
const sheet = read("components/SheetParts.jsx");

test("on screen a duct's arrows are about 40 px apart at any zoom; printed, about 13 mm", () => {
  assert.equal(DUCT_ARROW_GAP, 48); // sheet units: 48 × 0.26 mm
  assert.equal(screenArrowGap(1), 40);
  assert.equal(screenArrowGap(0.5), 80); // zoomed out: further apart on the sheet, still 40 px on screen
  assert.equal(screenArrowGap(4), 28);   // zoomed right in: never closer than 3 arrow lengths
  assert.equal(flowArrows(straight(800), "end", duct.width, screenArrowGap(0.5)).length, 10);
});

test("screen, print and PDF draw a line's arrows the same way", () => {
  assert.match(sheet, /function LineMark\(\{ pts, w, look, stroke, width, spacing = DUCT_ARROW_GAP \}\) \{\s*const heads = lineArrowMarks\(pts, w, look\.width, spacing\);/);
  // the editor spaces them for the zoom; the print sheet (which the PDF is
  // made from) draws lines with LineMark too, at the printed spacing
  assert.match(sheet, /<LineMark pts=\{pts\} w=\{w\} look=\{look\} spacing=\{screenArrowGap\(zoom\)\}/);
  const print = sheet.slice(sheet.indexOf('data-plan-area=""'));
  assert.match(print, /<LineMark pts=\{pts\} w=\{w\} look=\{look\} stroke=\{look\.colour\} width=\{look\.width\}\/>/);
  // the guide and the end handles are editor only, never printed
  assert.equal(print.includes("data-square-guide"), false);
  assert.equal(print.includes("data-duct-end"), false);
});

test("only ducts snap, show a guide and get end handles; Wire's clicks and choices are as before", () => {
  const tapNode = editor.slice(editor.indexOf("const lineTapNode = "), editor.indexOf("const addLinePoint = "));
  assert.match(tapNode, /if \(!d \|\| d\.type !== "duct" \|\| !d\.nodes\.length\) return lineNodeAt\(at\);/);
  assert.match(sheet, /if \(!w \|\| lineType\(w\) !== "duct"\) return null;/);
  const endDown = editor.slice(editor.indexOf("const onLineEndDown = "), editor.indexOf("const onLineEndDown = ") + 600);
  assert.match(endDown, /if \(!w \|\| lineType\(w\) !== "duct"\) return;/);
  // Wire's bar still offers None | Start | End | Both arrowheads
  assert.match(editor, /\[\["none", "None"\], \["start", "Start"\], \["end", "End"\], \["both", "Both"\]\]\.map/);
  // a wire is saved with the bar's arrowheads; a duct with its airflow
  assert.match(editor, /draft\.type === "duct" \? ductFlowChoice : lineEnds/);
});

test("Shift forces the snap while drawing a duct and while dragging its end", () => {
  assert.match(editor, /addLinePoint\(lineTapNode\(tap\.at, e\.shiftKey\)\)/);
  assert.match(editor, /const \{ node, guide \} = ductEndAt\(at, from, e\.shiftKey\);/);
  assert.match(editor, /const end = ductEndAt\(cursor, pts\[pts\.length - 1\], shiftDown\);/);
});
