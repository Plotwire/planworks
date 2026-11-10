/* ============================================================================
 * lineTypes.js -- the kinds of line the Wire tool draws between two symbols,
 * and their arrowheads.
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
