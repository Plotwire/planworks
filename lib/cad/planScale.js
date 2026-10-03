/* ============================================================================
 * lib/cad/planScale.js - the sketch's plan on the A3 sheet, at a true scale.
 *
 * Pure functions only - no React, no DOM. The one place that decides where a
 * sketch goes on the electrical drawing: used by the sketch's drawing-area
 * outline and Scale control, all three ways a plan is sent (Back to drawing /
 * Use this plan, Update existing drawing, Create a new drawing) and the
 * editor's re-map of what is placed on the sheet.
 *
 *  - The plan is drawn at a standard scale (SCALES). Auto takes the largest
 *    (smallest 1:n), from 1:50 up (AUTO_MIN_SCALE), at which everything drawn
 *    fits the drawing area with MARGIN_MM of paper clear all round; or the
 *    scale picked in the sketch
 *    (model.sheetScale, saved only once one is picked: absent = Auto).
 *  - The export frame (plan mm) is the whole drawing area at that scale -
 *    exactly its shape - centred on the plan, so the image fills the area
 *    and prints true to scale. The title block's Scale says which (scaleLabel).
 *  - Sent again at the same scale with the plan still inside the frame it was
 *    last sent with (margin included): that frame is kept and nothing moves.
 *    Otherwise (scale changed, the plan outgrew it, or a plan sent before
 *    scales: a link with a frame and no scale) a new frame, and everything
 *    placed on that sheet moves with the plan (remapSheet), so each item
 *    stays on the same spot of it. Symbols keep their size and rotation.
 * ========================================================================= */

import { computeFrame } from "@/lib/cad/sketchToImage";
import { hyp, fmtMM, joinWalls } from "@/lib/cad/plan";
import { angled, planCentre, openingSide } from "@/lib/cad/openings";
import { isAuto, spacesOf, spaceBoxAt } from "@/lib/cad/rooms";
import { SHEET, PAPER_MM, DRAW, planFootprint } from "@/lib/cad/sheet";
import { printStyle, roomLabelLayout } from "@/lib/cad/printStyle";

export const SCALES = [20, 50, 100, 200, 500];
// Paper (mm) kept clear between the plan and the drawing area's edge.
export const MARGIN_MM = 10;

export const isScale = (v) => SCALES.includes(v);
// The sketch's Scale choice: one of SCALES, or "auto".
export const scalePrefOf = (model) => (model && isScale(model.sheetScale) ? model.sheetScale : "auto");
// The title block's Scale field.
export const scaleLabel = (scale) => `1:${scale} @ A3`;

// The drawing area on paper (mm). One sheet-units-per-mm figure (the sheet's
// width over A3's) for both axes, so a frame this shape x the scale has
// exactly the drawing area's shape.
export function drawPaperMm() {
  return { w: DRAW.w * PAPER_MM.w / SHEET.width, h: DRAW.h * PAPER_MM.w / SHEET.width };
}

// Long edge (px) of a sent plan image (renderModelToPng). Plans sent before
// scales used 2200 too, and applyPlanToSheet's size check relies on that.
export const PLAN_PX = 2200;
// The image size renderModelToPng gives a frame.
export function planPx(frame, long = PLAN_PX) {
  const ar = frame.w / frame.h;
  return ar >= 1 ? { w: long, h: Math.round(long / ar) } : { w: Math.round(long * ar), h: long };
}

// Monospace text: about 0.6 em a character. Walls keep 250 mm clear round
// their mitred outline, as computeFrame does.
const EM = 0.6, WALL_CLEAR = 250;

/* Everything drawn (mm): the box the plan image must show, measured as
 * lib/cad/sketchToImage's buildPlanSvg draws it - text by its length (notes,
 * room names and areas, dimension figures, escape-window, stair and rooflight
 * labels), dimensions out to their ticks and figures. An empty sketch gets
 * computeFrame's default. polys: the walls' joinWalls polys, when already
 * worked out. scale: measure at 1:scale, with walls and room labels at the
 * size they print at there (lib/cad/printStyle); without it, as before. */
export function contentBox(model, polys = null, scale = null) {
  const m = model || {};
  const ps = scale ? printStyle(m, scale) : null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  };
  // A line of text anchored middle at (x, y): fs font size, ls letter-spacing
  // (mm); up: turned -90 degrees, reading upwards.
  const text = (x, y, s, fs, ls = 0, up = false) => {
    const half = String(s == null ? "" : s).length * (EM * fs + ls) / 2, a = 0.8 * fs, d = 0.25 * fs;
    if (up) { add(x - a, y - half); add(x + d, y + half); } else { add(x - half, y - a); add(x + half, y + d); }
  };
  (m.walls || []).forEach((w) => { add(w.x1, w.y1); add(w.x2, w.y2); });
  const wallPolys = ps ? joinWalls(m.walls || [], ps.tf).polys : (polys || joinWalls(m.walls || []).polys);
  Object.values(wallPolys).forEach((poly) => poly.forEach(([x, y]) => {
    add(x - WALL_CLEAR, y - WALL_CLEAR); add(x + WALL_CLEAR, y + WALL_CLEAR);
  }));
  // Doors to their swing (an angled one's leaf reaches a little further).
  (m.doors || []).forEach((d) => { const r = d.w * (angled(d) ? 1.12 : 1); add(d.x - r, d.y - r); add(d.x + r, d.y + r); });
  const c = planCentre(m.walls || []);
  (m.windows || []).forEach((w) => {
    add(w.x - w.w / 2, w.y - w.w / 2); add(w.x + w.w / 2, w.y + w.w / 2);
    if (!w.escape) return;
    const lab = "ESCAPE WINDOW", fs = 150;
    if (angled(w)) {
      // The label's box in the window's own axes, turned with it.
      const ly = openingSide(w, c) * 620, half = lab.length * EM * fs / 2, r = (w.ang * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
      [[-half, ly - 0.8 * fs], [half, ly - 0.8 * fs], [-half, ly + 0.25 * fs], [half, ly + 0.25 * fs]]
        .forEach(([lx, yy]) => add(w.x + lx * cs - yy * sn, w.y + lx * sn + yy * cs));
    } else if (w.dir === "h") text(w.x, w.y < 1000 ? w.y + 620 : w.y - 620, lab, fs);
    else text(w.x + (w.x < 1000 ? 700 : -700), w.y, lab, fs);
  });
  // Dimensions: the points, the line with its ticks and the extension lines'
  // overshoot (165), and the figure (185, set 70 off the line).
  (m.dims || []).forEach((d) => {
    const fig = fmtMM(Math.round(hyp(d.x2 - d.x1, d.y2 - d.y1))), off = d.off || 0;
    add(d.x1, d.y1); add(d.x2, d.y2);
    if (d.side === "top" || d.side === "bottom") {
      const dy = d.side === "top" ? Math.min(d.y1, d.y2) - off : Math.max(d.y1, d.y2) + off;
      add(Math.min(d.x1, d.x2) - 140, dy - 165); add(Math.max(d.x1, d.x2) + 140, dy + 165);
      text((d.x1 + d.x2) / 2, dy - 70, fig, 185);
    } else {
      const dx = d.side === "left" ? Math.min(d.x1, d.x2) - off : Math.max(d.x1, d.x2) + off;
      add(dx - 165, Math.min(d.y1, d.y2) - 140); add(dx + 165, Math.max(d.y1, d.y2) + 140);
      text(dx - 70, (d.y1 + d.y2) / 2, fig, 185, 0, true);
    }
  });
  // At a scale: each label as lib/cad/sketchToImage lays it out (roomLabelLayout).
  const sp = ps && (m.rooms || []).length ? spacesOf(m.walls || []) : null;
  (m.rooms || []).forEach((r) => {
    const areaText = isAuto(r) || r.area ? (isAuto(r) ? "000.0 m²" : `${Number(r.area).toFixed(1)} m²`) : null;
    if (ps) {
      const L = roomLabelLayout(r.name, areaText, ps, spaceBoxAt(sp, r.x, r.y));
      add(r.x - L.width / 2, r.y + L.top); add(r.x + L.width / 2, r.y + L.bottom);
      return;
    }
    text(r.x, r.y, (r.name || "").toUpperCase(), 230, 18);
    if (areaText) text(r.x, r.y + 300, areaText, 165);
  });
  (m.notes || []).forEach((t) => text(t.x, t.y, t.text, 165));
  (m.boundary || []).forEach((p) => { add(p[0] - 13, p[1] - 13); add(p[0] + 13, p[1] + 13); });
  if (m.stairs) {
    const s = m.stairs;
    add(s.x, s.y); add(s.x + s.w, s.y + s.h);
    text(s.x + s.w / 2 + 360, s.y + s.h / 2, `UP  ${s.treads} RISERS`, 165, 0, true);
  }
  (m.rooflights || []).forEach((r) => { add(r.x, r.y); add(r.x + r.w, r.y + r.h); text(r.x + r.w / 2, r.y + r.h / 2, r.ref, 150); });
  if (x0 > x1) return computeFrame(m, 0);
  const x = Math.floor(x0), y = Math.floor(y0);
  return { x, y, w: Math.ceil(x1) - x, h: Math.ceil(y1) - y };
}

// Does a box (mm) fit the drawing area at 1:scale with the margin all round?
export function fitsAt(box, scale) {
  const p = drawPaperMm(), m = 2 * MARGIN_MM, eps = 1e-9;
  return box.w / scale <= p.w - m + eps && box.h / scale <= p.h - m + eps;
}

// box: a box, or a function of the scale giving the box measured there
// (labels and walls print at a fixed paper size, so the box grows as the
// scale gets smaller).
const boxAtFn = (box) => (typeof box === "function" ? box : () => box);

// The largest standard scale from AUTO_MIN_SCALE (1:50) up that the box fits
// at; tooBig when not even 1:500.
// Auto starts here: an empty or small sketch is shown, and sent, at 1:50 and
// Auto only steps up (1:100, 1:200...) as the drawing outgrows the sheet.
// 1:20 is there to pick by hand.
export const AUTO_MIN_SCALE = 50;

export function chooseScale(box) {
  const at = boxAtFn(box);
  for (const s of SCALES) if (s >= AUTO_MIN_SCALE && fitsAt(at(s), s)) return { scale: s, tooBig: false };
  return { scale: SCALES[SCALES.length - 1], tooBig: true };
}

// Past 1:500 (Auto only): the next 1:n in hundreds that fits, so Auto never
// cuts the plan off.
export function beyondScale(box) {
  const at = boxAtFn(box), p = drawPaperMm(), m = 2 * MARGIN_MM;
  const b0 = at(SCALES[SCALES.length - 1]);
  let s = Math.max(SCALES[SCALES.length - 1] + 100, Math.ceil(Math.max(b0.w / (p.w - m), b0.h / (p.h - m)) / 100) * 100);
  while (!fitsAt(at(s), s)) s += 100;
  return s;
}

// The drawing area at 1:scale (mm), centred on the box; x / y in whole mm.
export function frameFor(box, scale) {
  const p = drawPaperMm(), w = p.w * scale, h = p.h * scale;
  return { x: Math.round(box.x + box.w / 2 - w / 2), y: Math.round(box.y + box.h / 2 - h / 2), w, h };
}

export const validFrame = (f) => !!f && [f.x, f.y, f.w, f.h].every(Number.isFinite) && f.w > 0 && f.h > 0;
const sameFrame = (a, b) => a.x === b.x && a.y === b.y && Math.abs(a.w - b.w) < 1e-6 && Math.abs(a.h - b.h) < 1e-6;
// A frame frameFor made at this scale (its size), with the box inside it and
// the margin clear.
function holds(f, box, scale) {
  const p = drawPaperMm(), m = MARGIN_MM * scale - 1e-6;
  return Math.abs(f.w - p.w * scale) < 0.5 && Math.abs(f.h - p.h * scale) < 0.5 &&
    box.x >= f.x + m && box.y >= f.y + m && box.x + box.w <= f.x + f.w - m && box.y + box.h <= f.y + f.h - m;
}

// Is part of the box outside the frame (cut off the drawing)? Half a mm
// allowed for the frame's whole-mm x / y.
export const cutOff = (box, f) => box.x < f.x - 0.5 || box.y < f.y - 0.5 ||
  box.x + box.w > f.x + f.w + 0.5 || box.y + box.h > f.y + f.h + 0.5;

/* Where the sketch goes on the sheet when it is sent.
 *  scalePref: model.sheetScale (scalePrefOf), "auto" or one of SCALES.
 *  link: { frame, scale } the plan was last sent to this drawing with, or
 *        null (never sent, or a new drawing). A frame with no scale is a
 *        plan sent before scales.
 * -> { box, scale, autoScale, manual, tooBig, fits, cut, frame, keepOld, remap }
 *  fits: the plan fits at the scale with the margin Auto keeps - false only
 *        for a picked scale; cut: part of the plan is outside the frame, so
 *        it would be cut off (a picked scale only); tooBig: not even 1:500
 *        fits (Auto then goes past it).
 *  keepOld: the frame is the link's own (nothing moves); remap: else, with a
 *        link, { oldFrame, newFrame } to move what is placed on the sheet. */
export function planSheetFrame(model, { scalePref = "auto", link = null, polys = null } = {}) {
  // Measured at each scale tried: walls and labels print at a fixed size.
  const boxAt = (s) => contentBox(model, polys, s), auto = chooseScale(boxAt);
  const autoScale = auto.tooBig ? beyondScale(boxAt) : auto.scale;
  const manual = isScale(scalePref) ? scalePref : null, scale = manual || autoScale;
  const box = boxAt(scale);
  const base = { box, scale, autoScale, manual: !!manual, tooBig: auto.tooBig };
  const old = link && validFrame(link.frame) ? link.frame : null;
  if (old && link.scale === scale && holds(old, box, scale)) return { ...base, fits: true, cut: false, frame: old, keepOld: true, remap: null };
  const frame = frameFor(box, scale), fits = fitsAt(box, scale), cut = !fits && cutOff(box, frame);
  if (old && sameFrame(old, frame)) return { ...base, fits, cut, frame: old, keepOld: true, remap: null };
  return { ...base, fits, cut, frame, keepOld: false, remap: old ? { oldFrame: old, newFrame: frame } : null };
}

/* The frame plans were sent at before scales, for the sheets (drawings) that
 * still show one: a link with a frame and no scale is that frame; once sent
 * at a scale the link keeps it as legacyFrame. A Save As copy of such a
 * drawing still has that plan, so its next send moves its symbols from it. */
export function legacyFrameOf(link) {
  if (!link) return null;
  if (validFrame(link.legacyFrame)) return link.legacyFrame;
  return !link.scale && validFrame(link.frame) ? link.frame : null;
}

/* How a plan image of `frame` (mm), w x h px, lies in the drawing area: the
 * frame drawn into the image to fit, centred (SVG's default "meet", see
 * lib/cad/sketchToImage), and the image into the area the same way
 * (planFootprint). k: sheet units per plan mm; (ox, oy): where the frame's
 * centre (cx, cy) is, in DRAW space. Plans sent before scales are letterboxed
 * in the area; this places them exactly too. */
export function planMap(frame, w, h) {
  const fp = planFootprint(DRAW, w, h);
  return {
    k: (fp.w / w) * Math.min(w / frame.w, h / frame.h),
    cx: frame.x + frame.w / 2, cy: frame.y + frame.h / 2,
    ox: fp.x + fp.w / 2, oy: fp.y + fp.h / 2,
  };
}
export const toPlan = (m, x, y) => ({ x: m.cx + (x - m.ox) / m.k, y: m.cy + (y - m.oy) / m.k });
export const toSheet = (m, x, y) => ({ x: m.ox + (x - m.cx) * m.k, y: m.oy + (y - m.cy) * m.k });

/* Move what is placed on a sheet from a plan image of oldFrame (oldW x oldH
 * px) to one of newFrame (newW x newH), each item to the same spot of the
 * plan: symbols and furniture (x, y), notes (text x, y and leader point
 * anchorX, anchorY) and the editor's walls (points). Wires follow their
 * symbols (fromId / toId). Symbols keep their size; rotations, labels and ids
 * are untouched. Furniture (the floor-plan layer: beds, baths, doors - drawn
 * to the plan's size, like the editor's walls) is resized with the plan.
 * Nothing is pushed in: an item that lands outside the drawing area (the
 * plan cut off at a picked scale, or drawn larger) is hidden there (the area
 * clips; the PDF leaves out a symbol wholly outside it), still on its
 * spot of the plan, and comes back when the plan is sent at a scale that
 * shows it.
 * -> { sheet, outside }: the new sheet, and how many items are now outside. */
export function remapSheet(sheet, { oldFrame, oldW, oldH, newFrame, newW, newH }) {
  const a = planMap(oldFrame, oldW, oldH), b = planMap(newFrame, newW, newH);
  // Furniture's size change: none at all unless the plan's own size changed.
  const fk = b.k / a.k, furn = Math.abs(fk - 1) > 1e-9;
  let outside = 0, out = false;
  const mv = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const p = toPlan(a, x, y), q = toSheet(b, p.x, p.y);
    if (q.x < 0 || q.y < 0 || q.x > DRAW.w || q.y > DRAW.h) out = true;
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
  const res = { ...sheet };
  if (Array.isArray(sheet.placed)) res.placed = sheet.placed.map((o) => item(o, XY));
  // Furniture's scale as drawn (SheetParts: item.scale, else 4).
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

/* Put a sent plan on a sheet: the new image ({ path, w, h }, plus src when
 * given), the sketch it came from, and the frame / scale it was drawn at
 * (bgImage.planFrame / planScale, so the next send knows exactly where this
 * image put the plan). When the sheet's plan already came from this sketch
 * and the frame or image changed, everything placed on it moves with the
 * plan (remapSheet) from the frame its image was drawn at: its own planFrame,
 * else (sent before scales) the sketch's pre-scales frame (legacyFrame,
 * legacyFrameOf: kept by the link after it moves on, so a Save As copy of an
 * older drawing still lines up), else oldFrame, the frame the sketch's link
 * kept - each only when the image is exactly the size that frame renders
 * to, so a link frame from another drawing (a sketch re-linked by Create a
 * new drawing) or from a send whose drawing never saved can't move anything
 * wrongly. The sheet's plan came from this sketch when it carries its
 * sketchId - or, for a sheet an older version saved without one, when it is
 * the sheet the sketch's link names (linked) and its plan is not an import.
 * -> { sheet, remapped, outside } */
export function applyPlanToSheet(sheet, { path, w, h, src = null, sketchId = null, frame = null, scale = null, oldFrame = null, legacyFrame = null, linked = false }) {
  const bg = sheet.bgImage, nf = validFrame(frame) ? frame : null;
  const drawnAt = (f) => { const p = planPx(f); return p.w === bg.w && p.h === bg.h; };
  const cand = !bg || !(bg.w > 0 && bg.h > 0) ? null
    : validFrame(bg.planFrame) ? bg.planFrame
    : [legacyFrame, oldFrame].find((f) => validFrame(f) && drawnAt(f)) || null;
  const own = !!cand && !!sketchId && (sheet.sketchId === sketchId ||
    (linked && !sheet.sketchId && !bg.pdfPath && !bg.pdfSrc && drawnAt(cand)));
  const from = own ? cand : null;
  let next = sheet, outside = 0, remapped = false;
  if (from && nf && !(sameFrame(from, nf) && bg.w === w && bg.h === h)) {
    const r = remapSheet(sheet, { oldFrame: from, oldW: bg.w, oldH: bg.h, newFrame: nf, newW: w, newH: h });
    next = r.sheet; outside = r.outside; remapped = true;
  }
  const bgImage = { path, w, h, ...(src ? { src } : {}), ...(nf ? { planFrame: nf } : {}), ...(nf && scale ? { planScale: scale } : {}) };
  return { sheet: { ...next, bgImage, sketchId }, remapped, outside };
}

// After a re-map that left placed items outside the drawing area. manual: the
// scale was picked in the sketch (else Auto chose it, so sending again on
// Auto brings nothing back: only a smaller scale, picked, does).
export function outsideNote(n, scale, manual = false) {
  const one = n === 1, next = SCALES.find((s) => s > scale);
  const keep = `${one ? "It keeps its" : "They keep their"} place on the plan`;
  const back = manual ? `${keep} and ${one ? "comes" : "come"} back if you send the plan again at a smaller scale, or on Auto.`
    : next ? `${keep}. To bring ${one ? "it" : "them"} back, pick a smaller scale (such as 1:${next}) in the sketch's Scale section and send the plan again.`
    : `${keep} and ${one ? "comes" : "come"} back when the plan is sent at a scale that shows that part of it.`;
  return `The plan is now drawn at 1:${scale}${manual ? "" : " (Auto)"}. ${one ? "1 placed item is" : `${n} placed items are`} now outside the drawing area, so ${one ? "it is" : "they are"} hidden. ` +
    `${back} Hidden symbols still count in the legend and the quote.`;
}
