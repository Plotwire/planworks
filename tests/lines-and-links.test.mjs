// Line types (wire or duct), arrowheads, and floor links staying off the
// quote. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { lineFields, withLine, lineType, lineArrows, lineLook, arrowHeads, linesUsed } from "../lib/lineTypes.js";
import { wireStyle } from "../lib/wireStrength.js";
import { buildInitialBoq, reconcileBoq, NOT_QUOTED } from "../lib/boqTemplate.js";

test("a plain wire saves no new fields, so old drawings are unchanged", () => {
  assert.deepEqual(lineFields("wire", "none"), {});
  assert.deepEqual(lineFields("duct", "end"), { type: "duct", arrows: "end" });
  assert.deepEqual(lineFields("wire", "both"), { arrows: "both" });
  assert.deepEqual(lineFields("wire", "sideways"), {});
  const w = { id: "w1", fromId: "a", toId: "b" };
  assert.deepEqual(withLine(withLine(w, "duct", "start"), "wire", "none"), w);
});

test("a wire saved before this reads as a wire with no arrows", () => {
  assert.equal(lineType({ id: "w", fromId: "a", toId: "b" }), "wire");
  assert.equal(lineArrows({ id: "w", fromId: "a", toId: "b" }), "none");
  assert.equal(lineType({ type: "duct" }), "duct");
});

test("a wire looks exactly as before; a duct is thicker, its own colour and dash", () => {
  for (const s of ["light", "standard", "bold"]) for (const m of ["red", "mono", "colour"])
    assert.deepEqual(lineLook({}, s, m), wireStyle(s, m));
  const duct = lineLook({ type: "duct" }, "standard", "colour"), wire = lineLook({}, "bold", "colour");
  assert.ok(duct.width > wire.width);
  assert.notEqual(duct.colour, wire.colour);
  assert.notEqual(duct.dash, wire.dash);
  assert.equal(lineLook({ type: "duct" }, "standard", "mono").colour, "#3A3A3A");
});

test("arrowheads: none, start, end or both, with the tips at the symbols' edges", () => {
  const a = { x: 0, y: 0 }, b = { x: 100, y: 0 };
  assert.equal(arrowHeads(a, b, "none", 1).length, 0);
  assert.equal(arrowHeads(a, b, "start", 1).length, 1);
  assert.equal(arrowHeads(a, b, "both", 1).length, 2);
  const [end] = arrowHeads(a, b, "end", 1, 10, 10);
  assert.equal(end.split(" ")[0], "90,0"); // the tip, 10 short of b
  const [start] = arrowHeads(a, b, "start", 1, 10, 10);
  assert.equal(start.split(" ")[0], "10,0");
  assert.equal(arrowHeads(a, { x: 0, y: 0.5 }, "end", 1).length, 0); // too short to draw
});

test("the legend lists each line kind used, once, wire first", () => {
  assert.deepEqual(linesUsed([]), []);
  assert.deepEqual(linesUsed([{ type: "duct", arrows: "end" }, {}, {}]), [{ type: "wire", arrows: false }, { type: "duct", arrows: true }]);
  assert.deepEqual(linesUsed([{ arrows: "start" }]), [{ type: "wire", arrows: true }]);
});

test("floor links never add a line to the quote", () => {
  assert.ok(NOT_QUOTED.has("mk_floor_up") && NOT_QUOTED.has("mk_floor_down"));
  const drawing = { meta: {}, sheets: [
    { placed: [{ symbolId: "mk_floor_up" }, { symbolId: "lt_downlight" }] },
    { placed: [{ symbolId: "mk_floor_down" }] },
  ] };
  const meta = { mk_floor_up: { description: "Up to floor above" }, mk_floor_down: { description: "Down to floor below" } };
  const boq = buildInitialBoq(drawing, meta, () => null, null, {});
  const items = boq.sections.flatMap((s) => s.items);
  assert.equal(items.some((i) => /floor (above|below)/i.test(i.item)), false);
  assert.equal(items.find((i) => i.item === "Downlights").qty, 1);
  const again = reconcileBoq(boq, drawing, meta, () => null);
  assert.equal(again.sections.flatMap((s) => s.items).some((i) => /floor (above|below)/i.test(i.item)), false);
});
