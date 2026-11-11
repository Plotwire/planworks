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

// ---- runs: lines that start, bend and end anywhere ----
import { lineFromNodes, linePoints, runArrowHeads, linesAfterDelete, lineSymbolIds } from "../lib/lineTypes.js";
import { mirrorCopies } from "../lib/planMirror.js";

test("a straight symbol-to-symbol line is saved exactly as before; anything else as a run", () => {
  assert.deepEqual(lineFromNodes("w1", [{ id: "a" }, { id: "b" }], "wire", "none"), { id: "w1", fromId: "a", toId: "b" });
  const duct = lineFromNodes("w2", [{ id: "fan" }, { x: 10.04, y: 20 }], "duct", "end");
  assert.deepEqual(duct, { id: "w2", pts: [{ id: "fan" }, { x: 10, y: 20 }], type: "duct", arrows: "end" });
  const bent = lineFromNodes("w3", [{ id: "a" }, { x: 5, y: 5 }, { id: "b" }], "wire", "none");
  assert.deepEqual(bent.pts.length, 3);
  assert.deepEqual(lineSymbolIds(bent), ["a", "b"]);
});

test("a run's points follow its symbols, free points stay put; arrowheads on free ends touch the point", () => {
  const byId = new Map([["sw", { id: "sw", x: 0, y: 0 }]]);
  const run = { id: "w", pts: [{ id: "sw" }, { x: 100, y: 0 }, { x: 100, y: 50 }], arrows: "end" };
  const pts = linePoints(run, byId, () => 10);
  assert.deepEqual(pts, [{ x: 0, y: 0, gap: 10 }, { x: 100, y: 0, gap: 0 }, { x: 100, y: 50, gap: 0 }]);
  const [end] = runArrowHeads(pts, "end", 1);
  assert.equal(end.split(" ")[0], "100,50"); // the tip right on the free end
  const [start] = runArrowHeads(pts, "start", 1);
  assert.equal(start.split(" ")[0], "10,0"); // stops at the switch's edge
  assert.equal(linePoints({ pts: [{ id: "gone" }, { x: 1, y: 1 }] }, byId, () => 0), null);
});

test("deleting a symbol: a straight line on it goes, as always; a run keeps its shape", () => {
  const byId = new Map([["a", { id: "a", x: 10, y: 20 }], ["b", { id: "b", x: 30, y: 40 }]]);
  const wires = [{ id: "w1", fromId: "a", toId: "b" }, { id: "w2", pts: [{ id: "a" }, { x: 50, y: 50 }] }, { id: "w3", pts: [{ id: "b" }, { x: 5, y: 5 }] }];
  const left = linesAfterDelete(wires, new Set(["a"]), byId);
  assert.deepEqual(left.map((w) => w.id), ["w2", "w3"]);
  assert.deepEqual(left[0].pts, [{ x: 10, y: 20 }, { x: 50, y: 50 }]);
});

test("Mirror copy takes a run whose symbols are all copied, its free points mirrored", () => {
  const items = [{ id: "fan", x: 10, y: 10, rotation: 0 }];
  const wires = [{ id: "d", pts: [{ id: "fan" }, { x: 2, y: 10 }], type: "duct", arrows: "end" }, { id: "x", pts: [{ id: "other" }, { x: 0, y: 0 }] }];
  let n = 0;
  const out = mirrorCopies(items, wires, { x: 20, y: 0 }, { x: 20, y: 100 }, { w: 500, h: 500 }, () => "c" + n++, () => "cw" + n++);
  assert.equal(out.wires.length, 1);
  assert.equal(out.wires[0].pts[0].id, out.copies[0].id);
  assert.deepEqual(out.wires[0].pts[1], { x: 38, y: 10 });
  assert.equal(out.wires[0].type, "duct");
});
