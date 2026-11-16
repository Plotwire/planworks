/* ============================================================================
 * lineTypes.js -- the lines the Wire and Duct tools draw, and their arrowheads.
 *
 * A line is a wire (as always) or a duct: a thicker, longer-dashed line in its
 * own colour. Either can have an arrowhead at its start, its end, or both (on
 * a duct, the arrow shows which way the air goes). These are drawing marks
 * only: nothing here sizes, counts or prices anything, and neither kind adds
 * a line to the quote.
 *
 * Saved on each wire as { type: "duct" } and { arrows: "start" | "end" |
 * "both" }, only when they aren't the default (a wire, no arrows), so wires
 * saved before this draw exactly as before. The editor and the print sheet
 * both draw with lineLook() and arrowHeads(), and the PDF overlay is captured
 * from the print sheet, so screen, print and PDF match.
 *
 * Where a line runs: one straight from a symbol to a symbol is saved as it
 * always was, { fromId, toId }. Any other run (starting or ending in open
 * space, or bending on the way) is saved as pts: [{ id } | { x, y }], each a
 * point on a symbol (it follows the symbol) or a free point on the sheet.
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
    seen[t] = (seen[t] || false) || lineArrows(w) !== "none";
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
