/* ============================================================================
 * lib/planCrop.js -- cropping an imported plan, and its true scale
 * ----------------------------------------------------------------------------
 * Pure values only. Presentation only: what part of the architect's page is
 * shown, and at what scale -- nothing about the design itself.
 *
 * A plan's crop is stored on its bgImage in the original page's own units:
 * PDF points as pdf.js shows page 1 (rotation applied, top-left origin) for a
 * PDF, pixels for a picture. The plan picture is made from the cropped area,
 * and the original PDF is kept untouched, so the sharp redraw and the PDF
 * download draw just that area from it.
 *
 *   crop          { x, y, w, h } the area kept (none: the whole page)
 *   cropBox       { left, bottom, right, top } the same area in the PDF's own
 *                 space, for the PDF download (pdf-lib embedPage)
 *   pageMm        { w, h } the PDF page's paper size
 *   cropMm        { w, h } the area kept, in mm of that paper
 *   drawingScale  n, for 1:n -- the scale the original drawing is at
 *   sheetScale    n -- the scale it is placed at on this A3 sheet
 *
 * With both scales the plan is sized exactly (lib/cad/sheet planBox) and the
 * title block shows 1:n @ A3; without, it is fitted and shows NTS.
 * ========================================================================== */

import { DRAW, SHEET_PX_PER_MM, planBox } from "./cad/sheet";

// The scales a plan can be placed at on the sheet, largest first.
export const SHEET_SCALES = [20, 25, 50, 75, 100, 125, 200, 250, 500];
// The scales an architect's drawing is commonly at, for the import's choice.
export const DRAWING_SCALES = [1, 2, 5, 10, 20, 25, 50, 75, 100, 125, 200, 250, 500, 1000, 1250, 2500];

export const ptToMm = (pt) => (pt * 25.4) / 72;

// The drawing area on paper, mm.
export const DRAW_MM = { w: DRAW.w / SHEET_PX_PER_MM.x, h: DRAW.h / SHEET_PX_PER_MM.y };

const ISO = { A0: [841, 1189], A1: [594, 841], A2: [420, 594], A3: [297, 420], A4: [210, 297], A5: [148, 210] };
// "A3" for a page of that size either way round (within 1.5%), else null.
export function paperName(mm) {
  if (!mm || !(mm.w > 0) || !(mm.h > 0)) return null;
  const s = Math.min(mm.w, mm.h), l = Math.max(mm.w, mm.h);
  for (const [name, [a, b]] of Object.entries(ISO)) {
    if (Math.abs(s - a) / a < 0.015 && Math.abs(l - b) / b < 0.015) return name;
  }
  return null;
}

export const validRect = (r) => !!r && [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0;

// The area kept, in mm of the original paper. pageW/pageH: the page in its
// own units (PDF points), so a crop in those units scales with it.
export function cropMmOf(crop, pageW, pageH, pageMm) {
  const r = validRect(crop) ? crop : { x: 0, y: 0, w: pageW, h: pageH };
  return { w: (r.w / pageW) * pageMm.w, h: (r.h / pageH) * pageMm.h };
}

// The real-world size of the area kept, metres, at the drawing's scale.
export const realSizeM = (cropMm, drawingScale) => ({ w: (cropMm.w * drawingScale) / 1000, h: (cropMm.h * drawingScale) / 1000 });

// The sheet scales the area fits the drawing area at, largest first; the
// first is the one to use unless the user picks another.
export function fittingScales(cropMm, drawingScale) {
  if (!cropMm || !(drawingScale > 0)) return [];
  return SHEET_SCALES.filter((s) => (cropMm.w * drawingScale) / s <= DRAW_MM.w + 0.01 && (cropMm.h * drawingScale) / s <= DRAW_MM.h + 0.01);
}

export const hasTrueScale = (bg) => !!(bg && bg.cropMm && bg.drawingScale > 0 && bg.sheetScale > 0);

/* How a plan maps between the drawing area (sheet units from DRAW's corner)
 * and its source (page units: PDF points, or picture pixels). region: the
 * part of the source the plan shows. bg: what places it (planBox). */
export function planMapping(bg, region) {
  const fp = planBox(DRAW, bg);
  return {
    fp, region,
    k: fp.w / region.w, // sheet units per source unit
    toSource: (x, y) => ({ u: region.x + ((x - fp.x) / fp.w) * region.w, v: region.y + ((y - fp.y) / fp.h) * region.h }),
    toDraw: (u, v) => ({ x: fp.x + ((u - region.x) / region.w) * fp.w, y: fp.y + ((v - region.y) / region.h) * fp.h }),
  };
}

/* Everything placed on a sheet, moved from one plan mapping to another so it
 * stays where it was on the building -- the same rule as the Floor Plan
 * tool's resend (lib/cad/planScale remapSheet): symbols, notes and their
 * anchors, and wall points move; furniture also scales with the plan;
 * symbols keep their printed size; wires join symbols, so they follow.
 * -> { sheet, outside }: outside counts the items that would leave the
 * drawing area, and the caller doesn't apply a change with any. */
export function remapToPlan(sheet, from, to) {
  const fk = to.k / from.k, furn = Math.abs(fk - 1) > 1e-9;
  let outside = 0, out = false;
  const mv = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const p = from.toSource(x, y), q = to.toDraw(p.u, p.v);
    if (q.x < -0.5 || q.y < -0.5 || q.x > DRAW.w + 0.5 || q.y > DRAW.h + 0.5) out = true;
    return q;
  };
  const item = (o, keys) => {
    if (!o || typeof o !== "object") return o;
    out = false;
    let n = o;
    for (const [kx, ky] of keys) { const q = mv(o[kx], o[ky]); if (q) n = { ...n, [kx]: q.x, [ky]: q.y }; }
    if (out) outside++;
    return n;
  };
  const XY = [["x", "y"]];
  const res = {};
  if (Array.isArray(sheet.placed)) res.placed = sheet.placed.map((o) => item(o, XY));
  if (Array.isArray(sheet.furniture)) res.furniture = sheet.furniture.map((o) => {
    const n = item(o, XY);
    return furn && n && typeof n === "object" ? { ...n, scale: (Number.isFinite(n.scale) ? n.scale : 4) * fk } : n;
  });
  if (Array.isArray(sheet.annotations)) res.annotations = sheet.annotations.map((o) => item(o, [["x", "y"], ["anchorX", "anchorY"]]));
  if (Array.isArray(sheet.walls)) res.walls = sheet.walls.map((w) => {
    if (!w || !Array.isArray(w.points)) return w;
    out = false;
    const points = w.points.map((p) => { const q = p && mv(p.x, p.y); return q ? { ...p, x: q.x, y: q.y } : p; });
    if (out) outside++;
    return { ...w, points };
  });
  return { sheet: res, outside };
}

// Has anything been put on this sheet that a crop or scale change must move?
export const hasWork = (sheet) => !!sheet && ["placed", "furniture", "annotations", "walls"].some((k) => Array.isArray(sheet[k]) && sheet[k].length > 0);

/* The work that sits on the plan now, in the page's own units (the units of
 * a crop): each symbol, note arrow tip, wall point and piece of furniture
 * inside the plan's box. Work off the plan (in the sheet's blank margin)
 * isn't on any part of the building, so no crop can cut it off.
 * -> { marks: [{ id, kind, u, v }], wires: [[fromId, toId]] } */
export function workMarks(sheet, from) {
  const fp = from.fp, marks = [];
  const on = (x, y) => Number.isFinite(x) && Number.isFinite(y) && x >= fp.x - 0.5 && y >= fp.y - 0.5 && x <= fp.x + fp.w + 0.5 && y <= fp.y + fp.h + 0.5;
  const add = (id, kind, x, y) => { if (on(x, y)) { const s = from.toSource(x, y); marks.push({ id, kind, u: s.u, v: s.v }); } };
  for (const o of sheet?.placed || []) if (o) add(o.id, "symbol", o.x, o.y);
  for (const a of sheet?.annotations || []) if (a) add(a.id, "note", a.anchorX, a.anchorY);
  for (const o of sheet?.furniture || []) if (o) add(o.id, "furniture", o.x, o.y);
  for (const w of sheet?.walls || []) if (w && Array.isArray(w.points)) for (const pt of w.points) if (pt) add(w.id, "wall", pt.x, pt.y);
  const wires = (sheet?.wires || []).filter((w) => w && w.fromId && w.toId).map((w) => [w.fromId, w.toId]);
  return { marks, wires };
}

// Is a mark outside an area of the page?
export const outsideArea = (m, r) => {
  const e = 1e-6 * Math.max(r.w, r.h);
  return m.u < r.x - e || m.v < r.y - e || m.u > r.x + r.w + e || m.v > r.y + r.h + e;
};

/* What keeping just `region` of the page would cut off, by kind: a wall once
 * however many of its points, and a wire when a symbol it joins is cut off.
 * -> { symbols, notes, wires, walls, furniture, total } */
export function cutBy(work, region) {
  const c = { symbols: 0, notes: 0, wires: 0, walls: 0, furniture: 0, total: 0 };
  if (!work || !validRect(region)) return c;
  const ids = { symbol: new Set(), note: new Set(), wall: new Set(), furniture: new Set() };
  for (const m of work.marks) if (outsideArea(m, region)) ids[m.kind].add(m.id);
  c.symbols = ids.symbol.size; c.notes = ids.note.size; c.walls = ids.wall.size; c.furniture = ids.furniture.size;
  c.wires = work.wires.filter(([a, b]) => ids.symbol.has(a) || ids.symbol.has(b)).length;
  c.total = c.symbols + c.notes + c.wires + c.walls + c.furniture;
  return c;
}

// "2 symbols and 2 wires would be outside the crop. ..."
export function cutMessage(c) {
  const parts = [[c.symbols, "symbol"], [c.notes, "note"], [c.wires, "wire"], [c.walls, "wall"], [c.furniture, "piece of furniture", "pieces of furniture"]]
    .filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many || one + "s"}`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  return `${list} would be outside the crop. Adjust the crop or move ${c.total === 1 ? "it" : "them"} first.`;
}

// The sheet's symbol size (the Symbol size slider): its limits, and a size
// made to suit a plan drawn `factor` times bigger or smaller.
export const SYMBOL_SCALE = { min: 0.3, max: 2.5 };
export const symbolScaleFor = (scale, factor) => Math.min(SYMBOL_SCALE.max, Math.max(SYMBOL_SCALE.min, (Number.isFinite(scale) ? scale : 1) * factor));

/* The scale bar for a sheet scale: a round length between about 30 and 90 mm
 * on paper. -> { metres, mm, step } (step: metres between labelled ticks). */
export function scaleBarFor(sheetScale) {
  const lengths = [1, 2, 5, 10, 20, 25, 50, 100, 200];
  const mmOf = (m) => (m * 1000) / sheetScale;
  const pick = lengths.find((m) => mmOf(m) >= 30 && mmOf(m) <= 90) || lengths.reduce((a, b) => (Math.abs(mmOf(b) - 50) < Math.abs(mmOf(a) - 50) ? b : a));
  const step = pick <= 5 ? 1 : pick <= 10 ? 2 : pick <= 25 ? 5 : pick <= 50 ? 10 : pick / 5;
  return { metres: pick, mm: mmOf(pick), step };
}
