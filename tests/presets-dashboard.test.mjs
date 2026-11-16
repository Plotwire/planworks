// Presets & pricing on the dashboard: presets are edited on their own page,
// each new drawing keeps a copy of them as they were when it was started, and
// changing them later never reaches a drawing already started or a quote
// already begun. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  templateForEditing, templateForSaving, buildInitialBoq,
  presetsSnapshot, quoteStartPresets, summarisePresets,
} from "../lib/boqTemplate.js";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const lineOf = (tpl, key, re) => tpl.find((s) => s.key === key).items.find((i) => re.test(i.item));

// Saved presets with a Downlights price (as the account stores them).
function presetsWith(downlights, firstFixLabour) {
  const tpl = templateForEditing(null);
  lineOf(tpl, "secondfix", /^Downlights$/).rate = String(downlights);
  if (firstFixLabour) lineOf(tpl, "labour", /^First fix labour$/).rate = String(firstFixLabour);
  return templateForSaving(tpl);
}
const placed = [{ symbolId: "lt_downlight" }, { symbolId: "lt_downlight" }];
// The quote a drawing gets the first time its Quote screen opens, as
// components/SheetParts.jsx BillOfQuantities builds it.
const firstQuote = (drawing, accountTpl, accountPrefs) => {
  const start = quoteStartPresets(drawing, accountTpl, accountPrefs);
  return buildInitialBoq(drawing, {}, () => null, start.template, start.prefs);
};

test("a new drawing keeps the presets it was started with, whatever changes later", () => {
  const monday = presetsWith(14.5, 280);
  const drawing = { meta: {}, sheets: [{ placed }], quotePresets: presetsSnapshot(monday, { vatOn: true }) };
  // Tuesday: the presets change on the dashboard (price up, VAT off).
  const tuesday = presetsWith(20, 300);
  const boq = firstQuote(drawing, tuesday, { vatOn: false });
  assert.equal(lineOf(boq.sections, "secondfix", /^Downlights$/).rate, 14.5);
  assert.equal(lineOf(boq.sections, "secondfix", /^Downlights$/).qty, 2);
  assert.equal(lineOf(boq.sections, "labour", /^First fix labour$/).rate, 280);
  assert.equal(boq.vatOn, true);
});

test("a drawing started after the change gets the new presets", () => {
  const tuesday = presetsWith(20, 300);
  const drawing = { meta: {}, sheets: [{ placed }], quotePresets: presetsSnapshot(tuesday, { vatOn: false }) };
  const boq = firstQuote(drawing, tuesday, { vatOn: false });
  assert.equal(lineOf(boq.sections, "secondfix", /^Downlights$/).rate, 20);
  assert.equal(boq.vatOn, false);
});

test("the copy is a copy: editing the presets afterwards can't reach into it", () => {
  const tpl = presetsWith(14.5);
  const copy = presetsSnapshot(tpl, null);
  lineOf(tpl, "secondfix", /^Downlights$/).rate = 99;
  assert.equal(lineOf(copy.template, "secondfix", /^Downlights$/).rate, 14.5);
  assert.equal(copy.vatOn, true);                 // VAT on unless switched off
  assert.match(copy.at, /^\d{4}-\d{2}-\d{2}T/);
});

test("an account still on the built-in presets: the copy says so, and stays so", () => {
  const copy = presetsSnapshot(null, { vatOn: false });
  assert.equal(copy.template, null);
  assert.equal(copy.vatOn, false);
  const drawing = { meta: {}, sheets: [{ placed }], quotePresets: copy };
  const boq = firstQuote(drawing, presetsWith(20), { vatOn: true });
  assert.equal(lineOf(boq.sections, "secondfix", /^Downlights$/).rate, 0); // built-in: no prices
  assert.equal(boq.vatOn, false);
});

test("a drawing from before copies existed takes the presets of the moment, as before", () => {
  const drawing = { meta: {}, sheets: [{ placed }] };
  const boq = firstQuote(drawing, presetsWith(20), { vatOn: true });
  assert.equal(lineOf(boq.sections, "secondfix", /^Downlights$/).rate, 20);
});

test("the account's last export choice still applies to a drawing with its own copy", () => {
  const drawing = { quotePresets: presetsSnapshot(null, { vatOn: true }) };
  const start = quoteStartPresets(drawing, null, { vatOn: false, quote: { preset: "summary" } });
  assert.deepEqual(start.prefs, { vatOn: true, quote: { preset: "summary" } });
});

test("a started quote is the drawing's own: never rebuilt from presets on opening", () => {
  const src = read("components/SheetParts.jsx");
  const open = src.slice(src.indexOf("const [boq, setBoq] = useState(() => {"), src.indexOf("return reconcileBoq(base, project"));
  assert.match(open, /project\.boq\s*\?\s*addMissingLabour\(project\.boq,/);
  assert.match(open, /buildInitialBoq\(project, SYMBOL_META, findSymbol, start\.template, start\.prefs\)/);
});

test("the dashboard summary counts lines, prices and VAT", () => {
  const s = summarisePresets(presetsWith(14.5, 280), { vatOn: false });
  assert.equal(s.priced, 2);
  assert.equal(s.vatOn, false);
  assert.ok(s.items > 10 && s.sections >= 3);
  assert.deepEqual(s.sample.map((x) => x.rate).sort(), [14.5, 280]);
  const none = summarisePresets(null, null);
  assert.equal(none.priced, 0);
  assert.equal(none.vatOn, true);
});

test("the editor keeps each drawing's copy when it loads, and makes one only for new drawings", () => {
  const src = read("components/ElectricalPlanTool.jsx");
  assert.equal((src.match(/\.\.\.presetsField\(p\.quotePresets\)/g) || []).length, 2); // both drawing shapes
  const stamp = src.slice(src.indexOf("// A new drawing keeps a copy of the account's Presets"), src.indexOf("// ---- Crash recovery"));
  assert.match(stamp, /if \(!startedNew \|\| !presetsReady \|\| readOnly\) return;/);
  assert.match(stamp, /if \(!project \|\| project\.quotePresets \|\| project\.boq\) return;/);
  assert.match(src, /const openProjectById = async[^\n]*\n\s*setStartedNew\(false\);/);
  // A drawing made from a floor-plan sketch gets its copy too.
  assert.match(read("components/cad/CadSketch.jsx"), /\.\.\.\(presetsReady \? \{ quotePresets: presetsSnapshot\(accountPresets, accountPresetPrefs\) \} : \{\}\)/);
});

test("presets are edited on the dashboard's page, not inside a drawing's quote", () => {
  const quote = read("components/SheetParts.jsx");
  const boqPart = quote.slice(quote.indexOf("export function BillOfQuantities"));
  assert.doesNotMatch(boqPart, /<BoqTemplateEditor/);
  assert.doesNotMatch(boqPart, /setShowTemplate/);
  assert.match(boqPart, /Prices here are for this job only/);
  assert.ok(existsSync(new URL("../app/presets/page.jsx", import.meta.url)));
  const home = read("components/HomeScreen.jsx");
  assert.match(home, /<h2>Presets &amp; pricing<\/h2>/);
  assert.match(home, /title="Presets & pricing" onClick=\{onPresets\}/);
  assert.match(read("app/page.jsx"), /onPresets=\{\(\) => router\.push\("\/presets"\)\}/);
});

test("the page edits the same saved presets, so everything already set carries over", () => {
  const page = read("components/PresetsPage.jsx");
  assert.match(page, /saved=\{boqTemplate\}/);
  assert.match(page, /savedPrefs=\{boqPrefs\}/);
  assert.match(page, /saveBoqTemplate\?\.\(tpl, prefs\)/);
  // Never shown before the account's presets are known.
  assert.match(page, /if \(!presetsReady\) \{/);
  const shell = read("components/AppShell.jsx");
  assert.match(shell, /presetsReady: settingsFrom === "device" \|\| settingsFrom === "server"/);
});
