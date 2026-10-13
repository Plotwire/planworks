// Symbol Library checks. Run from the project folder:
//   node scripts/symbol-library/check.cjs
// Checks the catalogue (ids, codes, categories), that every symbol uses only
// what the PDF export can draw, that the original symbols are exactly as they
// were before the Symbol Library (BASELINE: drawing, colours, legend text),
// that the Domestic starter is the picker exactly as it was, that no new
// symbol reaches a picker unticked, and that presets and BOQ links name real
// symbols.
// Exits non-zero on any error.
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const L = require("./load.cjs");
const { toPrims, extent } = require("./prims.cjs");

const S = L.symbols();
const Lib = L.library();
const { SECONDFIX_SYMBOLS } = L.boq();

// Master as it was just before the Symbol Library was merged (13 Oct 2026).
// Pinned rather than "master": master now holds the library, so comparing
// with it would prove nothing (and its symbols.jsx can't load on its own).
const BASELINE = "53de999f57b360326052e6f48b090942d46d2df7";

const errors = [], warnings = [];
const err = (m) => errors.push(m), warn = (m) => warnings.push(m);

const cat = S.CATALOGUE;
const originalIds = new Set(Object.values(S.SYMBOLS).flatMap((g) => g.items.map((i) => i.id)));
const newer = cat.filter((s) => !originalIds.has(s.id));

// 1. Ids and codes
const ids = new Set(), codes = new Map();
for (const s of cat) {
  if (ids.has(s.id)) err(`duplicate id ${s.id}`);
  ids.add(s.id);
  const k = String(s.code || "").toUpperCase();
  if (!k) err(`${s.id}: no legend code`);
  if (codes.has(k)) err(`legend code ${k} used by ${codes.get(k)} and ${s.id}`);
  codes.set(k, s.id);
  if (!S.LIBRARY_CATEGORIES.some((c) => c.key === s.category)) err(`${s.id}: unknown category ${s.category}`);
  if (!S.MATERIALS_GROUPS.includes(s.materials)) err(`${s.id}: unknown materials group ${s.materials}`);
  if (!s.name) err(`${s.id}: no name`);
  if (!S.CATEGORY_COLOURS[s.colour]) err(`${s.id}: no colour (${s.colour})`);
}
for (const id of originalIds) {
  const s = S.findSymbol(id);
  if (!s) { err(`original ${id} missing from the catalogue`); continue; }
  if (s.code === id.toUpperCase()) err(`original ${id} has no ORIGINAL_INFO entry`);
  if (s.draft) err(`original ${id} is marked draft`);
}
for (const s of newer) {
  if (!/^[a-z]{2}_[a-z0-9_]+$/.test(s.id)) warn(`${s.id}: id style`);
  if (!s.height) warn(`${s.id}: no mounting height`);
}

// 2. Print safety and extent
for (const s of cat) {
  const { prims, issues } = toPrims(s.svg, { body: "#123456", feeder: "#abcdef" });
  if (!prims.length) err(`${s.id}: draws nothing`);
  const isOrig = originalIds.has(s.id);
  for (const i of issues) (isOrig ? warn : err)(`${s.id}: ${i}${isOrig ? " (original, unchanged)" : ""}`);
  const e = extent(prims.filter((p) => p.kind !== "path"));
  if (e.x0 < -1 || e.y0 < -1 || e.x1 > 49 || e.y1 > 49) (isOrig ? warn : err)(`${s.id}: drawing leaves the 48-unit box (${[e.x0, e.y0, e.x1, e.y1].map((n) => n.toFixed(1)).join(", ")})`);
}

// 3. Originals exactly as before the library (BASELINE)
const tmp = fs.mkdtempSync(path.join(L.ROOT, "Claude outputs", ".symcheck-"));
try {
  const baseSrc = execFileSync("git", ["show", `${BASELINE}:lib/symbols.jsx`], { cwd: L.ROOT, encoding: "utf8", maxBuffer: 1 << 24 });
  const f = path.join(tmp, "symbols.baseline.jsx");
  fs.writeFileSync(f, baseSrc);
  const M = require(f);
  const markup = (sym) => renderToStaticMarkup(React.createElement("svg", { viewBox: M.VIEWBOX }, sym.svg));
  for (const g of Object.values(M.SYMBOLS)) for (const old of g.items) {
    const now = S.findSymbol(old.id);
    if (!now) { err(`baseline symbol ${old.id} missing`); continue; }
    if (markup(old) !== markup(now)) err(`${old.id}: drawing differs from the baseline`);
    if (old.name !== now.name) err(`${old.id}: name differs from the baseline`);
    if ((old.forceColor || null) !== (now.forceColor || null)) err(`${old.id}: forceColor differs`);
    for (const mode of ["colour", "mono", "red"]) {
      if (JSON.stringify(M.resolveColours(old.id, mode)) !== JSON.stringify(S.resolveColours(old.id, mode))) err(`${old.id}: ${mode} colours differ from the baseline`);
    }
    if (JSON.stringify(M.SYMBOL_META[old.id]) !== JSON.stringify(S.SYMBOL_META[old.id])) err(`${old.id}: legend text/height differs from the baseline`);
    if (M.findCategory(old.id) !== S.findCategory(old.id)) err(`${old.id}: colour category differs`);
  }
  for (const alias of ["sock_sso", "sock_dso", "sock_usbc", "sock_sso_2a", "sock_cat5", "sw_pir", "lt_ceiling", "det_alarm_panel", "det_pir_intruder", "fx_camera"]) {
    if (M.findSymbol(alias)?.id !== S.findSymbol(alias)?.id) err(`legacy alias ${alias} resolves differently`);
  }
  // 4. The Domestic starter is the picker as it was.
  const was = M.getPaletteGroups().map((g) => ({ label: g.label, ids: g.items.map((i) => i.sym.id) }));
  const now = Lib.pickerGroups(Lib.DOMESTIC_STARTER).map((g) => ({ label: g.label, ids: g.items.map((i) => i.sym.id) }));
  if (JSON.stringify(was) !== JSON.stringify(now)) err("picker with the Domestic starter differs from the baseline picker");
  const never = Lib.pickerGroups(Lib.picksFromSettings(undefined)).map((g) => ({ label: g.label, ids: g.items.map((i) => i.sym.id) }));
  if (JSON.stringify(was) !== JSON.stringify(never)) err("an account with no saved picks doesn't get the baseline picker");
  if (Lib.DOMESTIC_STARTER.length !== 34) err(`Domestic starter has ${Lib.DOMESTIC_STARTER.length} symbols, expected 34`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 5. Presets, picks, BOQ links
for (const p of Lib.PRESETS) for (const id of p.ids) if (!S.findSymbol(id)) err(`preset ${p.key} names unknown symbol ${id}`);
for (const [k, list] of Object.entries(SECONDFIX_SYMBOLS)) for (const id of list) if (!S.findSymbol(id)) err(`BOQ line ${k} names unknown symbol ${id}`);
if (Lib.allPicks().some((id) => S.findSymbol(id).draft)) err("a draft symbol can be ticked");
if (Lib.pickerGroups(cat.filter((s) => s.draft).map((s) => s.id)).length) err("draft symbols reach the picker");
if (Lib.picksFromSettings(undefined).some((id) => !originalIds.has(id))) err("a new symbol reaches the picker of an account that hasn't ticked it");
for (const s of cat) if (s.isNew && (s.draft || originalIds.has(s.id))) err(`${s.id}: New badge on a ${s.draft ? "draft" : "original"} symbol`);
if (Lib.picksFromSettings({ picks: ["nope", "sw_light", "sw_light"] }).join() !== "sw_light") err("picksFromSettings doesn't clean saved picks");
if (Lib.picksFromSettings({ picks: [] }).length !== 0) err("an empty saved selection isn't kept empty");

// Report
const byCat = Object.fromEntries(S.LIBRARY_CATEGORIES.map((c) => [c.label, [0, 0]]));
for (const s of cat) byCat[S.LIBRARY_CATEGORIES.find((c) => c.key === s.category).label][originalIds.has(s.id) ? 0 : 1]++;
console.log(`Catalogue: ${cat.length} symbols (${originalIds.size} original, ${newer.length} new, ${cat.filter((s) => s.draft).length} draft, ${cat.filter((s) => s.isNew).length} badged New)`);
for (const [k, [o, n]] of Object.entries(byCat)) console.log(`  ${k.padEnd(24)} ${String(o).padStart(3)} original  ${String(n).padStart(3)} new`);
for (const p of Lib.PRESETS) console.log(`Preset ${p.label}: ${p.ids.length} named, ${Lib.presetPicks(p.key).length} tickable now`);
if (warnings.length) { console.log(`\n${warnings.length} warning(s):`); warnings.forEach((w) => console.log("  - " + w)); }
if (errors.length) { console.log(`\n${errors.length} ERROR(S):`); errors.forEach((e) => console.log("  - " + e)); process.exit(1); }
console.log("\nAll checks passed.");
