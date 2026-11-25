/* ============================================================================
 * lineTypes.js -- the lines the Wire and Duct tools draw, and their arrowheads.
 *
 * A line is a wire (as always) or a duct: a thicker, longer-dashed line in its
 * own colour. A wire can have an arrowhead at its start, its end, or both; a
 * duct's arrows show which way the air goes (below). These are drawing marks
 * only: nothing here sizes, counts or prices anything, and neither kind adds
 * a line to the quote.
 *
 * Saved on each wire as { type: "duct" } and { arrows: "start" | "end" |
 * "both" }, only when they aren't the default (a wire, no arrows), so wires
 * saved before this draw exactly as before. The editor and the print sheet
 * both draw with lineLook() and lineArrowMarks(), and the PDF overlay is captured
 * from the print sheet, so screen, print and PDF match.
 *
 * Where a line runs: one straight from a symbol to a symbol is saved as it
 * always was, { fromId, toId }. Any other run (starting or ending in open
 * space, or bending on the way) is saved as pts: [{ id } | { x, y }], each a
 * point on a symbol (it follows the symbol) or a free point on the sheet.
 *
 * Ducts (branch duct-one-shot) draw their arrows differently from wires:
 * repeated all along the line, every one pointing the way the air goes
 * (flowArrows), never just at an end. The same arrows field says which way:
 * "start" points back to where the duct was begun, anything else to its end.
 * Wires keep their arrowheads at the start, the end, or both, as before. A
 * duct also snaps horizontal, vertical or 45° (squareSnap), and its ends can
 * be dragged after it's drawn (withEnd).
 * ========================================================================= */
import { wireStyle } from "./wireStrength.js"; // with .js, so node:test can load this file

export const LINE_TYPES = [
  { value: "wire", label: "Wire" },
  { value: "duct", label: "Duct" },
];
export const LINE_ARROWS = [
  { value: "none", label: "None" },
  { value: "start", label: "Start" },
  { value: "end", label: "End" },
  { value: "both", label: "Both" },
];

export const lineType = (w) => (w && w.type === "duct" ? "duct" : "wire");
export const lineArrows = (w) => (w && ["start", "end", "both"].includes(w.arrows) ? w.arrows : "none");

// The fields to save for a line's type and arrows: none for a plain wire.
export function lineFields(type, arrows) {
  return {
    ...(type === "duct" ? { type: "duct" } : {}),
    ...(["start", "end", "both"].includes(arrows) ? { arrows } : {}),
  };
}
// A wire with its type and arrows set, the defaults leaving no field behind.
export function withLine(w, type, arrows) {
  const { type: _t, arrows: _a, ...rest } = w;
  return { ...rest, ...lineFields(type, arrows) };
}

// A duct: blue (black in Mono), 2.2 units wide (0.58 mm), long dashes, so it
// can't be mistaken for a wire at any wire strength.
const DUCT = { width: 2.2, colour: "#2F6FD6", mono: "#3A3A3A", dash: "9 4", hoverWidth: 2.8, hoverColour: "#1D4FA8", monoHover: "#0a0a0a" };

// How a line draws: { width, colour, dash, hoverWidth, hoverColour }.
export function lineLook(w, wireStrength, colourMode) {
  if (lineType(w) === "wire") return wireStyle(wireStrength, colourMode);
  const mono = colourMode === "mono";
  return { width: DUCT.width, colour: mono ? DUCT.mono : DUCT.colour, dash: DUCT.dash, hoverWidth: DUCT.hoverWidth, hoverColour: mono ? DUCT.monoHover : DUCT.hoverColour };
}

// Arrowheads for a line from a to b (sheet units), as polygon point strings.
// Each tip sits at the edge of the symbol it points at (gapA / gapB: how far
// from that symbol's centre), not under it. Sized from the line's width, so a
// duct's arrow is bigger than a wire's.
export function arrowHeads(a, b, arrows, width, gapA = 0, gapB = 0) {
  if (arrows === "none") return [];
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  if (len < 1) return [];
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  const L = Math.max(6, width * 4.2), H = L * 0.45;
  const head = (tx, ty, dirX, dirY) => {
    const bx = tx - dirX * L, by = ty - dirY * L;
    const pts = [[tx, ty], [bx + nx * H, by + ny * H], [bx - nx * H, by - ny * H]];
    return pts.map(([x, y]) => `${+x.toFixed(2)},${+y.toFixed(2)}`).join(" ");
  };
  // keep a short line from being swallowed by its own arrowheads
  const room = Math.max(0, len - L * 1.2);
  const gb = Math.min(gapB, room / 2), ga = Math.min(gapA, room / 2);
  const out = [];
  if (arrows === "end" || arrows === "both") out.push(head(b.x - ux * gb, b.y - uy * gb, ux, uy));
  if (arrows === "start" || arrows === "both") out.push(head(a.x + ux * ga, a.y + uy * ga, -ux, -uy));
  return out;
}

// How far from a symbol's centre its drawing reaches: about a third of its box.
export const symbolGap = (size) => size * 0.36;

// The line kinds a drawing uses, for the legend: [{ type, arrows }] in the
// order wire, duct; arrows: whether any line of that kind has arrowheads.
export function linesUsed(wires) {
  const seen = { wire: null, duct: null };
  for (const w of wires || []) {
    const t = lineType(w);
    seen[t] = (seen[t] || false) || t === "duct" || lineArrows(w) !== "none"; // a duct always has its airflow arrows
  }
  return ["wire", "duct"].filter((t) => seen[t] !== null).map((t) => ({ type: t, arrows: seen[t] }));
}

/* ---------- where a line runs ---------- */

// A line's nodes, in order: { id } on a symbol, { x, y } a free point.
export const lineNodes = (w) => (w && Array.isArray(w.pts) ? w.pts : [{ id: w && w.fromId }, { id: w && w.toId }]);
// The symbols a line is attached to.
export const lineSymbolIds = (w) => lineNodes(w).filter((n) => n && n.id).map((n) => n.id);

// The points to draw a line through, in sheet units: [{ x, y, gap }], gap
// being how far from the point an arrowhead's tip stops (a symbol's edge, 0
// for a free point). byId: placed symbols by id; gapOf(symbol) -> gap. A node
// on a symbol that's gone is left out; under two points, nothing is drawn.
export function linePoints(w, byId, gapOf) {
  const out = [];
  for (const n of lineNodes(w)) {
    if (!n) continue;
    if (n.id) { const s = byId.get(n.id); if (s) out.push({ x: s.x, y: s.y, gap: gapOf(s) }); }
    else if (Number.isFinite(n.x) && Number.isFinite(n.y)) out.push({ x: n.x, y: n.y, gap: 0 });
  }
  return out.length >= 2 ? out : null;
}

// Arrowheads for a run of points: the start one on its first stretch, the end
// one on its last, each tip at its point's gap.
export function runArrowHeads(pts, arrows, width) {
  if (!pts || pts.length < 2 || arrows === "none") return [];
  const [p0, p1] = pts, q0 = pts[pts.length - 2], q1 = pts[pts.length - 1];
  return [
    ...(arrows === "start" || arrows === "both" ? arrowHeads(p0, p1, "start", width, p0.gap, p1.gap) : []),
    ...(arrows === "end" || arrows === "both" ? arrowHeads(q0, q1, "end", width, q0.gap, q1.gap) : []),
  ];
}

const r1 = (v) => Math.round(v * 10) / 10;
// The line to save for the nodes drawn: straight from one symbol to another
// is saved as before ({ fromId, toId }); anything else as pts.
export function lineFromNodes(id, nodes, type, arrows) {
  const two = nodes.length === 2 && nodes[0].id && nodes[1].id;
  const where = two
    ? { fromId: nodes[0].id, toId: nodes[1].id }
    : { pts: nodes.map((n) => (n.id ? { id: n.id } : { x: r1(n.x), y: r1(n.y) })) };
  return { id, ...where, ...lineFields(type, arrows) };
}

// A line with one end (end: "start" | "end") moved to node ({ id } on a
// symbol, or { x, y } a free point), saved the way lineFromNodes saves it:
// straight from one symbol to another as { fromId, toId }, anything else as
// pts. Its id, type and arrows stay; any bends stay where they were.
export function withEnd(w, end, node) {
  const nodes = lineNodes(w).slice();
  nodes[end === "start" ? 0 : nodes.length - 1] = node;
  const { fromId: _f, toId: _t, pts: _p, ...rest } = w;
  const two = nodes.length === 2 && nodes[0].id && nodes[1].id;
  return {
    ...rest,
    ...(two
      ? { fromId: nodes[0].id, toId: nodes[1].id }
      : { pts: nodes.map((n) => (n.id ? { id: n.id } : { x: r1(n.x), y: r1(n.y) })) }),
  };
}

// The lines left when symbols are deleted (gone: a Set of ids; byId: the
// symbols before). A straight symbol-to-symbol line on one goes, as always.
// A run keeps its shape: its point on the deleted symbol becomes a free point
// where the symbol was. A run left with under two points goes.
export function linesAfterDelete(wires, gone, byId) {
  const out = [];
  for (const w of wires || []) {
    if (!w) continue;
    if (!Array.isArray(w.pts)) { if (!gone.has(w.fromId) && !gone.has(w.toId)) out.push(w); continue; }
    const pts = w.pts.map((n) => {
      if (!n || !n.id || !gone.has(n.id)) return n;
      const s = byId.get(n.id);
      return s ? { x: r1(s.x), y: r1(s.y) } : null;
    }).filter(Boolean);
    if (pts.length >= 2) out.push({ ...w, pts });
  }
  return out;
}

/* ---------- ducts: airflow arrows all along the line ---------- */

// Which way a duct's air goes: "end" (from where it was begun to its end, as
// drawn) or "start" (reversed). Kept in the line's arrows field: "start"
// reverses it; anything else (a duct saved with no arrows, an end arrow or
// both) points to the end.
export const DUCT_FLOWS = [
  { value: "end", label: "Start → End" },
  { value: "start", label: "End → Start" },
];
export const ductFlow = (w) => (lineArrows(w) === "start" ? "start" : "end");

// How far apart a duct's arrows are. Printed (and in the PDF, made from the
// print sheet): 48 sheet units, about 13 mm on the A3 sheet (1 unit = 0.26
// mm). On screen: about 40 px at any zoom (screenArrowGap), but never closer
// than 3 arrow lengths, so zoomed right in they don't crowd.
export const DUCT_ARROW_GAP = 48;
export const DUCT_ARROW_PX = 40;
export const screenArrowGap = (zoom) => Math.max(28, DUCT_ARROW_PX / (zoom > 0 ? zoom : 1));

// A duct's arrows: evenly spaced about `spacing` apart over the part of the
// line you can see (from the edge of a symbol at either end), every one
// pointing the way the air goes (flow: "end" | "start"). A short duct gets
// one, in the middle; one too short to hold an arrow gets none. Each arrow is
// a polygon point string, the same size as a wire's arrowhead of that width.
export function flowArrows(pts, flow, width, spacing = DUCT_ARROW_GAP) {
  if (!pts || pts.length < 2) return [];
  const segs = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > 1e-6) segs.push({ a, b, len, from: total });
    total += len;
  }
  const L = Math.max(6, width * 4.2), H = L * 0.45;
  if (!segs.length || total < L * 1.2) return [];
  // the ends under symbols are left clear, as an arrowhead's tip is
  const room = total - L * 1.2;
  const g0 = Math.min(pts[0].gap || 0, room / 2), g1 = Math.min(pts[pts.length - 1].gap || 0, room / 2);
  const seen = total - g0 - g1;
  const n = Math.max(1, Math.round(seen / spacing));
  const sign = flow === "start" ? -1 : 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const at = g0 + ((i + 0.5) * seen) / n;
    const s = segs.find((g) => at <= g.from + g.len) || segs[segs.length - 1];
    const t = (at - s.from) / s.len;
    const ux = ((s.b.x - s.a.x) / s.len) * sign, uy = ((s.b.y - s.a.y) / s.len) * sign;
    const cx = s.a.x + (s.b.x - s.a.x) * t, cy = s.a.y + (s.b.y - s.a.y) * t;
    const tx = cx + (ux * L) / 2, ty = cy + (uy * L) / 2, bx = cx - (ux * L) / 2, by = cy - (uy * L) / 2;
    const p = [[tx, ty], [bx - uy * H, by + ux * H], [bx + uy * H, by - ux * H]];
    out.push(p.map(([x, y]) => `${+x.toFixed(2)},${+y.toFixed(2)}`).join(" "));
  }
  return out;
}

// The arrows a line draws: a duct's airflow arrows all along it (spacing:
// screenArrowGap on screen, DUCT_ARROW_GAP printed); a wire's arrowheads at
// its start, end or both, exactly as before.
export function lineArrowMarks(pts, w, width, spacing = DUCT_ARROW_GAP) {
  return lineType(w) === "duct" ? flowArrows(pts, ductFlow(w), width, spacing) : runArrowHeads(pts, lineArrows(w), width);
}

// Where a line's two ends show (its drag handles): at a symbol's edge, or
// right on a free point. pts as linePoints gives them.
export function visibleEnds(pts) {
  const tip = (p, q) => {
    const d = Math.hypot(q.x - p.x, q.y - p.y), g = Math.min(p.gap || 0, d / 2);
    return d ? { x: p.x + ((q.x - p.x) / d) * g, y: p.y + ((q.y - p.y) / d) * g } : { x: p.x, y: p.y };
  };
  const n = pts.length;
  return { start: tip(pts[0], pts[1]), end: tip(pts[n - 1], pts[n - 2]) };
}

/* ---------- ducts: horizontal, vertical or 45° ---------- */

// A duct's end snaps when the line from its other end is within this many
// degrees of horizontal, vertical or 45°. Shift forces it, however far off.
export const SQUARE_SNAP_DEG = 5;
const S = Math.SQRT1_2;
const DIRS = [[1, 0], [S, S], [0, 1], [-S, S], [-1, 0], [-S, -S], [0, -1], [S, -S]];
export const SQUARE_LABEL = { h: "Horizontal", v: "Vertical", d: "45°" };

// The point b seen from a, straightened: { x, y, dir } (dir "h", "v" or "d"
// for 45°), or null when it isn't close to one (and isn't forced). grid
// rounds a coordinate to the grid; only the coordinate the line is free in is
// rounded, so it stays exactly horizontal, vertical or at 45°.
export function squareSnap(a, b, force = false, grid = (v) => v) {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (Math.hypot(dx, dy) < 1) return null;
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const k = Math.round(deg / 45);
  if (!force && Math.abs(deg - k * 45) > SQUARE_SNAP_DEG) return null;
  const [ux, uy] = DIRS[((k % 8) + 8) % 8];
  if (uy === 0) return { x: grid(b.x), y: a.y, dir: "h" };
  if (ux === 0) return { x: a.x, y: grid(b.y), dir: "v" };
  const x = grid(a.x + (dx * ux + dy * uy) * ux);
  return { x, y: a.y + (x - a.x) * (uy / ux), dir: "d" };
}
