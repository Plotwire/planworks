/* ============================================================================
 * lib/cad/printStyle.js - how big room labels and walls print on the A3 sheet.
 *
 * Pure functions only - no React, no DOM. A sent plan is drawn at a true
 * scale (lib/cad/planScale), so anything drawn at a fixed size in plan mm
 * prints smaller the smaller the scale: at 1:200 a 300 mm wall prints 1.5 mm
 * and a 230 mm room name about 1 mm tall. Here each is sized for the paper
 * instead, then turned back into plan mm for the export's scale:
 *  - Room names and areas: a printed cap height from the sketch's Label size
 *    (Small / Medium / Large), never under MIN_CAP_MM.
 *  - Walls: drawn at exactly the Wall thickness choice's printed thickness
 *    (Thin / Standard / Bold, WALL_WEIGHTS; external / internal) at any
 *    scale, on the sketch canvas and the sent plan alike.
 * lib/cad/sketchToImage draws with these and lib/cad/planScale measures with
 * them, so the plan picked to fit really does fit.
 * ========================================================================= */

import { T_EXT, T_INT } from "@/lib/cad/plan";
import { SHEET, PAPER_MM, DRAW } from "@/lib/cad/sheet";

// Printed cap height (mm) of a room name for each Label size.
export const LABEL_SIZES = { small: 3, medium: 4, large: 5.5 };
export const LABEL_SIZE_NAMES = { small: "Small", medium: "Medium", large: "Large" };
// No room name or area prints with capitals shorter than this.
export const MIN_CAP_MM = 3;
// Thinnest a wall prints (mm on paper), by the sketch's Wall thickness
// choice: exactly this at any scale (a weight, as an architect's line weight -
// not the wall's real thickness, which snapping and dimensions still use).
export const WALL_WEIGHTS = {
  thin: { external: 3, internal: 2 },
  standard: { external: 4.5, internal: 3 },
  bold: { external: 6, internal: 4 },
};
export const WALL_WEIGHT_NAMES = { thin: "Thin", standard: "Standard", bold: "Bold" };
// The default (and what sketches saved before the choice get).
export const MIN_WALL_MM = WALL_WEIGHTS.standard;
// The sketch's Wall thickness; sketches saved before the choice are Standard.
export const wallWeightOf = (model) => (model && WALL_WEIGHTS[model.wallWeight] ? model.wallWeight : "standard");
// Capital height as a share of the font size when it can't be measured
// (fontMetrics). The export draws text in the browser's generic monospace
// (Consolas ~0.64, Courier ~0.57); 0.56 is under both, so printed capitals
// are never shorter than asked.
export const CAP_RATIO = 0.56;

// The sketch's Label size; sketches saved before the choice are Medium.
export const labelSizeOf = (model) => (model && LABEL_SIZES[model.labelSize] ? model.labelSize : "medium");

// The drawing area on paper (mm), as lib/cad/planScale drawPaperMm.
const paper = () => ({ w: DRAW.w * PAPER_MM.w / SHEET.width, h: DRAW.h * PAPER_MM.w / SHEET.width });

// Plan mm per paper mm for an export frame: the frame is fitted into the
// drawing area (contain), so a true-scale frame gives exactly its 1:n, and a
// frame from before scales gives the scale it actually printed at.
export function printScaleOf(frame) {
  const p = paper();
  return Math.max(frame.w / p.w, frame.h / p.h);
}

// The generic monospace the plan is drawn in, measured once in the browser
// that draws it (the export rasterises there, so the sizes it prints are
// these): capital height and character width as a share of the font size.
// Outside a browser, or if measuring fails: CAP_RATIO and 0.6, which are on
// the safe side for every common monospace.
let metrics = null;
export function fontMetrics() {
  if (metrics) return metrics;
  let cap = CAP_RATIO, em = 0.6;
  try {
    if (typeof document !== "undefined") {
      const c = document.createElement("canvas").getContext("2d");
      c.font = "600 100px monospace";
      const a = c.measureText("E").actualBoundingBoxAscent / 100;
      const w = c.measureText("MMMMMMMMMM").width / 1000;
      if (a > 0.45 && a < 0.85) cap = a;
      if (w > 0.45 && w < 0.75) em = w;
    }
  } catch { /* keep the safe defaults */ }
  return (metrics = { cap, em });
}

// The name's letter-spacing is 18/230 em, as always.
const nameLsOf = (fs) => fs * (18 / 230);
const nameWidth = (s, fs) => s.length * (fontMetrics().em * fs + nameLsOf(fs));
const plainWidth = (s, fs) => s.length * fontMetrics().em * fs;

// Words onto as few lines as fit `avail` (a word longer than that gets a line
// of its own and is left to overflow).
function wrapWords(words, fs, avail) {
  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? cur + " " + w : w;
    if (!cur || nameWidth(next, fs) <= avail) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// A narrow room's last resort before going under MIN_CAP_MM: the shorter
// name, and then at most this small (that room only).
export const TIGHT_CAP_MM = 2.5;
const ABBREVIATIONS = [
  [/\bLIVING ROOM\b/g, "LIVING"],
  [/\bBEDROOM\b/g, "BED"],
  [/\bBATHROOM\b/g, "BATH"],
  [/\bKITCHEN\b/g, "KIT"],
  [/\bUTILITY\b/g, "UTIL"],
];
// The usual short form of a room name (any number is kept: BEDROOM 1 -> BED 1).
export function abbreviateRoomName(upper) {
  return ABBREVIATIONS.reduce((s, [re, to]) => s.replace(re, to), upper);
}

// The largest size from fs0 down to minFs at which the words wrap (up to 3
// lines) within avail; minFs and fits: false when even that is too wide.
function fitWords(words, fs0, minFs, avail) {
  let fs = Math.max(fs0, minFs);
  for (;;) {
    const lines = wrapWords(words, fs, avail);
    const fits = lines.length <= 3 && lines.every((l) => nameWidth(l, fs) <= avail);
    if (fits || fs <= minFs + 1e-6) return { fs, lines, fits };
    fs = Math.max(minFs, fs * 0.9);
  }
}

/* A room label laid out to fit its room on the printed plan.
 *  name / areaText: the text; ps: printStyle(...); box: the room's space
 *  [x0, y0, x1, y1] (lib/cad/rooms spaceBoxAt), or null when not enclosed.
 * Starts at the Label size; when a line is wider than the room, the name
 * wraps onto more lines (up to 3), then the text comes down a step at a time
 * to MIN_CAP_MM capitals. Still too wide there: the usual short form of the
 * name (abbreviateRoomName), from the Label size down again; and only then,
 * for that room, down to TIGHT_CAP_MM. A room too narrow even for that gets
 * the smallest and overflow: true.
 * -> { lines: [{ text, dy }], nameFs, nameLs, area: { fs, lines: [{ text, dy }] } | null,
 *      width, top, bottom, overflow, abbreviated, tight } (dy: baseline below
 *      the label point; the name block is centred on it, as one line always was). */
export function roomLabelLayout(name, areaText, ps, box = null) {
  // The space as drawn: walls print thicker than they are, eating into it.
  const avail = box ? Math.max(0, (box[2] - box[0]) - (ps.tInt - T_INT)) * 0.92 : Infinity;
  const toFs = (capMm) => (capMm / fontMetrics().cap) * ps.scale;
  const split = (s) => s.split(/\s+/).filter(Boolean);
  const full = String(name || "").toUpperCase(), short = abbreviateRoomName(full);
  let text = full, abbreviated = false, tight = false;
  let fit = fitWords(split(text), ps.nameFs, toFs(MIN_CAP_MM), avail);
  if (!fit.fits && short !== full) {
    text = short; abbreviated = true;
    fit = fitWords(split(text), ps.nameFs, toFs(MIN_CAP_MM), avail);
  }
  if (!fit.fits) {
    tight = true;
    fit = fitWords(split(text), toFs(MIN_CAP_MM), toFs(TIGHT_CAP_MM), avail);
  }
  const { fs, lines } = fit;
  // The area follows the room: down to TIGHT_CAP_MM only in a tight room.
  const minFs = toFs(tight ? TIGHT_CAP_MM : MIN_CAP_MM);
  let afs = Math.min(ps.areaFs, Math.max(minFs, fs * 0.8));
  if (areaText) while (plainWidth(areaText, afs) > avail && afs > minFs + 1e-6) afs = Math.max(minFs, afs * 0.9);
  const lh = fs * 1.15, top = -((Math.max(lines.length, 1) - 1) * lh) / 2;
  const out = lines.map((text, i) => ({ text, dy: top + i * lh }));
  const lastDy = out.length ? out[out.length - 1].dy : 0;
  // An area still too wide at the minimum goes on two lines: figure, then unit.
  const areaParts = !areaText ? [] : plainWidth(areaText, afs) > avail && areaText.includes(" ")
    ? [areaText.slice(0, areaText.lastIndexOf(" ")), areaText.slice(areaText.lastIndexOf(" ") + 1)] : [areaText];
  const a0 = lastDy + fs * (300 / 230);
  const area = areaText ? { fs: afs, lines: areaParts.map((text, i) => ({ text, dy: a0 + i * afs * 1.15 })) } : null;
  const width = Math.max(0, ...lines.map((l) => nameWidth(l, fs)), ...areaParts.map((t) => plainWidth(t, afs)));
  const areaEnd = area ? area.lines[area.lines.length - 1].dy : 0;
  return {
    lines: out, nameFs: fs, nameLs: nameLsOf(fs), area, width,
    top: top - 0.8 * fs, bottom: (area ? areaEnd + 0.25 * afs : lastDy + 0.25 * fs),
    overflow: width > avail + 1e-6, abbreviated, tight,
  };
}

/* Sizes in plan mm at 1:scale.
 *  nameFs / areaFs: font sizes; nameLs: letter-spacing; areaDy: the area's
 *  baseline below the name's; tExt / tInt: wall thickness drawn; tf: that as
 *  a function of wall type (lib/cad/plan joinWalls); outline: the walls'
 *  outline stroke; opening(t): the thickness an opening on a wall of real
 *  thickness t is drawn at. */
export function printStyle(model, scale) {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 50;
  const nameCap = Math.max(MIN_CAP_MM, LABEL_SIZES[labelSizeOf(model)]);
  const areaCap = Math.max(MIN_CAP_MM, nameCap * 0.8);
  const cap = fontMetrics().cap;
  const nameFs = (nameCap / cap) * s, areaFs = (areaCap / cap) * s;
  const wall = WALL_WEIGHTS[wallWeightOf(model)];
  const tExt = wall.external * s, tInt = wall.internal * s;
  const tf = (type) => (type === "external" ? tExt : tInt);
  return {
    scale: s, nameFs, areaFs,
    // Same proportions as before (230 / 18 spacing, area 300 below a 230 name).
    nameLs: nameFs * (18 / 230), areaDy: nameFs * (300 / 230),
    tExt, tInt, tf,
    outline: Math.max(28, 0.3 * s),
    opening: (t) => (t >= T_EXT ? tExt : t <= T_INT ? tInt : Math.max(t, tInt)),
  };
}
