// Quote presets with prices: a preset line can hold a unit rate, and a new
// quote starts with it. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import {
  presetRate, templateForEditing, templateForSaving, buildInitialBoq, addMissingLabour,
} from "../lib/boqTemplate.js";

const lineOf = (tpl, key, re) => tpl.find((s) => s.key === key).items.find((i) => re.test(i.item));
// presets as typed in the editor: two prices on Second Fix and one on Labour
function typedPresets() {
  const tpl = templateForEditing(null);
  lineOf(tpl, "secondfix", /^Downlights$/).rate = "14.50";
  lineOf(tpl, "secondfix", /^Double sockets$/).rate = "£6.80";
  lineOf(tpl, "secondfix", /^Pendants$/).rate = "abc";
  lineOf(tpl, "labour", /^First fix labour$/).rate = "280";
  return tpl;
}
const drawing = { meta: {}, sheets: [{ placed: [{ symbolId: "lt_downlight" }, { symbolId: "lt_downlight" }, { symbolId: "sock_dso_ll" }] }] };

test("presetRate reads a price the way the quote does, and only keeps one above 0", () => {
  assert.equal(presetRate("14.50"), 14.5);
  assert.equal(presetRate("£1,250"), 1250);
  assert.equal(presetRate(" 6.8 "), 6.8);
  for (const v of ["", "abc", "0", "-3", null, undefined, NaN, 0]) assert.equal(presetRate(v), 0);
});

test("only real prices are saved with the presets", () => {
  const saved = templateForSaving(typedPresets());
  assert.equal(lineOf(saved, "secondfix", /^Downlights$/).rate, 14.5);
  assert.equal(lineOf(saved, "secondfix", /^Double sockets$/).rate, 6.8);
  assert.equal("rate" in lineOf(saved, "secondfix", /^Pendants$/), false);   // not a number
  assert.equal("rate" in lineOf(saved, "secondfix", /^Fused spurs$/), false); // left blank
  assert.equal(lineOf(saved, "labour", /^First fix labour$/).rate, 280);
});

test("a new quote starts with the preset prices, and the drawing's quantities", () => {
  const boq = buildInitialBoq(drawing, {}, () => null, templateForSaving(typedPresets()), {});
  const dl = lineOf(boq.sections, "secondfix", /^Downlights$/);
  assert.equal(dl.qty, 2); assert.equal(dl.rate, 14.5);
  const ds = lineOf(boq.sections, "secondfix", /^Double sockets$/);
  assert.equal(ds.qty, 1); assert.equal(ds.rate, 6.8);
  assert.equal(lineOf(boq.sections, "secondfix", /^Pendants$/).rate, 0);
  assert.equal(lineOf(boq.sections, "labour", /^First fix labour$/).rate, 280);
});

test("presets saved before prices existed still make a quote at £0", () => {
  const old = templateForSaving(templateForEditing(null)); // no rate anywhere
  const boq = buildInitialBoq(drawing, {}, () => null, old, {});
  for (const sec of boq.sections) for (const it of sec.items) assert.equal(it.rate, 0);
});

test("an older quote given its missing Labour section gets the preset labour prices", () => {
  const boq = { sections: [{ key: "secondfix", title: "Second Fix", items: [] }] };
  const out = addMissingLabour(boq, templateForSaving(typedPresets()));
  assert.equal(lineOf(out.sections, "labour", /^First fix labour$/).rate, 280);
});

test("the preset editor shows a saved price, and blank where there's none", () => {
  const ed = templateForEditing(templateForSaving(typedPresets()));
  assert.equal(lineOf(ed, "secondfix", /^Downlights$/).rate, 14.5);
  assert.equal(lineOf(ed, "secondfix", /^Fused spurs$/).rate, "");
});
