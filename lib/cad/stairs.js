/* ============================================================================
 * lib/cad/stairs.js - Plotwire CAD floor-plan: stairs and stair voids.
 *
 * Pure functions only - no React, no DOM. One drawing for the sketch canvas
 * (components/cad/CadSketch), the plan image (lib/cad/sketchToImage) and the
 * sheet fit (lib/cad/planScale), so all three always match.
 *
 * A flight is drawn exactly as the sample plan's stairs always were (and the
 * promo plans): a box with evenly spaced tread lines, a centre line along
 * the flight with an arrowhead at the far end, and "UP  13 RISERS" along the
 * centre line. A void is a box with an X through it, as on upstairs plans.
 *
 * Saved in model.flights (a sketch without it has none, so older sketches open
 * exactly as they were):
 *   { id, kind: "flight" | "void", x, y, w, h,     - the box on the plan (mm)
 *     risers, dir: "up" | "down", rot: 0|90|180|270 } - flights only
 * rot is where the arrow points with dir "up": 0 up the page (-y), 90 right,
 * 180 down, 270 left. "down" is the same flight with the arrow (and label)
 * the other way.
 *
 * Printed sizes follow lib/cad/printStyle: line weights never print thinner
 * than at 1:50, and the label never has capitals under MIN_CAP_MM (3 mm),
 * stepping to a shorter form ("UP 13R", then "UP") and then TIGHT_CAP_MM when
 * a flight is too short for it at 1:100 / 1:200.
 *
 * Stairs are drawing only: never symbols, never in the materials list.
 * ========================================================================= */

import { T_EXT, T_INT, snap as roundTo } from "@/lib/cad/plan";
import { MIN_CAP_MM, TIGHT_CAP_MM, fontMetrics } from "@/lib/cad/printStyle";

export const STAIR_W = 900;         // default flight width (mm)
export const STAIR_RISERS = 13;     // default risers
export const STAIR_RUN = 3000;      // a flight placed with a click (no drag)
export const VOID_SIZE = { w: 1000, h: 3000 };
export const RISERS_MIN = 2, RISERS_MAX = 30;
export const STAIR_MIN = 300;       // smallest side of a flight / void (mm)
// A drag narrower than this across is a line along the flight (width STAIR_W).
const LINE_DRAG = 450;

export const flightsOf = (m) => (m && Array.isArray(m.flights) ? m.flights : []);
const turned = (f) => f.kind === "flight" && (f.rot === 90 || f.rot === 270);
/** Width across the flight and its length along it (mm). */
export const stairWidth = (f) => (turned(f) ? f.h : f.w);
export const stairLength = (f) => (turned(f) ? f.w : f.h);

/* Line weights (plan mm) at 1:scale: the sample plan's at 1:50, and never
 * thinner on paper than that at smaller scales. */
export function stairWeights(scale = 50) {
  const k = Math.max(1, (Number.isFinite(scale) && scale > 0 ? scale : 50) / 50);
  return { box: 13 * k, tread: 8 * k, arrow: 12 * k };
}

const rotPt = (cx, cy, deg, u, v) => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [cx + u * c - v * s, cy + u * s + v * c];
};
const textWidth = (t, fs) => t.length * fontMetrics().em * fs;

/* The label for a flight W wide and L long at 1:scale: the full text at
 * 3 mm capitals if it fits along the flight (and the gap beside the centre
 * line), else a shorter form, else smaller to 2.5 mm. */
function fitLabel(word, risers, W, L, scale) {
  const cap = fontMetrics().cap, toFs = (mm) => (mm / cap) * scale;
  const avail = L * 0.9, across = Math.max(0, W / 2 - 40);
  const texts = [`${word}  ${risers} RISERS`, `${word} ${risers}R`, word];
  for (const capMm of [MIN_CAP_MM, TIGHT_CAP_MM]) {
    const fs = toFs(capMm);
    if (fs * cap > across) continue;
    const t = texts.find((s) => textWidth(s, fs) <= avail);
    if (t) return { text: t, fs };
  }
  const fs = toFs(TIGHT_CAP_MM);
  return { text: word, fs, overflow: true };
}

/* Everything one stair item draws, in plan mm at 1:scale:
 * -> { kind, box: {x, y, w, h},
 *      lines: [{ x1, y1, x2, y2, wt: "box" | "tread" | "arrow", op }],
 *      head: [[x, y] x3] | null (the arrowhead, an open V),
 *      label: { text, x, y, fs, angle } | null (text-anchor middle) } */
export function stairDrawing(f, scale = 50) {
  const box = { x: f.x, y: f.y, w: f.w, h: f.h };
  const lines = [];
  const edge = (x1, y1, x2, y2, wt, op) => lines.push({ x1, y1, x2, y2, wt, ...(op ? { op } : {}) });
  const outline = () => {
    edge(f.x, f.y, f.x + f.w, f.y, "box"); edge(f.x + f.w, f.y, f.x + f.w, f.y + f.h, "box");
    edge(f.x + f.w, f.y + f.h, f.x, f.y + f.h, "box"); edge(f.x, f.y + f.h, f.x, f.y, "box");
  };
  if (f.kind === "void") {
    edge(f.x, f.y, f.x + f.w, f.y + f.h, "tread");
    edge(f.x + f.w, f.y, f.x, f.y + f.h, "tread");
    outline();
    return { kind: "void", box, lines, head: null, label: null };
  }
  // The flight in its own frame: u across (-W/2..W/2), v along (-L/2..L/2),
  // the arrow at v = -L/2 - turned by e onto the plan about the box centre.
  const W = stairWidth(f), L = stairLength(f), n = Math.max(1, Math.round(f.risers || STAIR_RISERS));
  const e = ((f.rot || 0) + (f.dir === "down" ? 180 : 0)) % 360;
  const cx = f.x + f.w / 2, cy = f.y + f.h / 2, P = (u, v) => rotPt(cx, cy, e, u, v);
  const step = L / n;
  for (let k = 1; k < n; k++) { const [a, b] = [P(-W / 2, -L / 2 + k * step), P(W / 2, -L / 2 + k * step)]; edge(a[0], a[1], b[0], b[1], "tread", 0.8); }
  // As the sample plan: the line 250 in from each end, the head 270 long and
  // 280 across - kept inside a small flight.
  const inset = Math.min(250, L * 0.08), hh = Math.min(270, L * 0.2), hw = Math.min(140, W * 0.3);
  const t0 = P(0, L / 2 - inset), t1 = P(0, -L / 2 + inset);
  edge(t0[0], t0[1], t1[0], t1[1], "arrow");
  const head = [P(-hw, -L / 2 + inset + hh), t1, P(hw, -L / 2 + inset + hh)];
  // The label along the centre line, in the gap between it and the side,
  // reading from the bottom or the right of the sheet (never upside down).
  const lab = fitLabel(f.dir === "down" ? "DOWN" : "UP", n, W, L, scale);
  const cap = lab.fs * fontMetrics().cap;
  let ang = e - 90, flip = false;
  const norm = ((ang % 360) + 540) % 360 - 180; // -180..180
  if (norm > 90 || norm < -90) { flip = true; ang += 180; }
  const ub = W / 4 + (flip ? -cap / 2 : cap / 2);
  const [lx, ly] = P(ub, 0);
  const label = { text: lab.text, x: lx, y: ly, fs: lab.fs, angle: ((ang % 360) + 360) % 360 };
  outline(); // last, so it is on top of the treads' ends
  return { kind: "flight", box, lines, head, label };
}

/* The corners of a drawing's label box (for the sheet fit). */
export function labelCorners(lb) {
  if (!lb) return [];
  const half = textWidth(lb.text, lb.fs) / 2, top = -0.8 * lb.fs, bot = 0.25 * lb.fs;
  return [[-half, top], [half, top], [-half, bot], [half, bot]].map(([a, b]) => rotPt(lb.x, lb.y, lb.angle, a, b));
}

/* The plan boxes of every stair in a model - the new ones and the sample
 * plan's single `stairs` - for the drawing editor's "On stairs" warning. */
export function stairBoxes(model) {
  const out = flightsOf(model).map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h }));
  const s = model && model.stairs;
  if (s && [s.x, s.y, s.w, s.h].every(Number.isFinite)) out.push({ x: s.x, y: s.y, w: s.w, h: s.h });
  return out.map((b) => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) }));
}

export const inBox = (b, x, y, mg = 0) => x >= b.x - mg && x <= b.x + b.w + mg && y >= b.y - mg && y <= b.y + b.h + mg;

/** The stair item at (x, y) - the last drawn (on top) wins - or null. */
export function stairAt(model, x, y) {
  const fl = flightsOf(model);
  for (let i = fl.length - 1; i >= 0; i--) if (inBox(fl[i], x, y)) return fl[i];
  return null;
}

/* Snap a stair point: each of x and y lands on a square wall's face (its
 * real thickness) within tol mm, if the point is alongside that wall; else on
 * the grid. side.x / side.y: which way the wall's body is from the face
 * (+1 / -1), so a flight drawn along it can sit on the room side. */
export function stairSnap(walls, raw, tol, grid = 0) {
  const best = { x: null, y: null };
  for (const w of walls || []) {
    const t = (w.type === "external" ? T_EXT : T_INT) / 2;
    if (Math.abs(w.x1 - w.x2) < 1e-6) { // vertical wall: faces at x = cx +/- t
      const lo = Math.min(w.y1, w.y2) - t, hi = Math.max(w.y1, w.y2) + t;
      if (raw.y < lo - tol || raw.y > hi + tol) continue;
      for (const s of [-1, 1]) {
        const fx = w.x1 + s * t, d = Math.abs(raw.x - fx);
        if (d <= tol && (!best.x || d < best.x.d)) best.x = { v: fx, d, side: -s };
      }
    } else if (Math.abs(w.y1 - w.y2) < 1e-6) { // horizontal wall: faces at y = cy +/- t
      const lo = Math.min(w.x1, w.x2) - t, hi = Math.max(w.x1, w.x2) + t;
      if (raw.x < lo - tol || raw.x > hi + tol) continue;
      for (const s of [-1, 1]) {
        const fy = w.y1 + s * t, d = Math.abs(raw.y - fy);
        if (d <= tol && (!best.y || d < best.y.d)) best.y = { v: fy, d, side: -s };
      }
    }
  }
  const g = (v) => (grid > 0 ? roundTo(v, grid) : Math.round(v));
  return {
    x: best.x ? best.x.v : g(raw.x), y: best.y ? best.y.v : g(raw.y),
    side: { x: best.x ? best.x.side : 0, y: best.y ? best.y.side : 0 },
    snapped: !!(best.x || best.y),
  };
}

/* The stair a drag from a to b places (a, b from stairSnap).
 * A flight runs along the drag's longer way, the arrow pointing the way it
 * was dragged. Dragged as a line (under LINE_DRAG across) it is STAIR_W wide,
 * on the room side of a wall face the start snapped to, else centred on the
 * line; dragged as a box it fills the box. A click (no drag) puts a
 * STAIR_W x STAIR_RUN flight, or a VOID_SIZE void, centred there.
 * A void fills the dragged box. -> the item, without its id. */
export function stairFromDrag(kind, a, b, { risers = STAIR_RISERS, width = STAIR_W } = {}) {
  const dx = b.x - a.x, dy = b.y - a.y, adx = Math.abs(dx), ady = Math.abs(dy);
  const r = (o) => ({ ...o, x: Math.round(o.x), y: Math.round(o.y), w: Math.max(STAIR_MIN, Math.round(o.w)), h: Math.max(STAIR_MIN, Math.round(o.h)) });
  if (kind === "void") {
    if (adx < STAIR_MIN && ady < STAIR_MIN) return r({ kind, x: a.x - VOID_SIZE.w / 2, y: a.y - VOID_SIZE.h / 2, ...VOID_SIZE });
    return r({ kind, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(adx, STAIR_MIN), h: Math.max(ady, STAIR_MIN) });
  }
  const base = { kind: "flight", risers, dir: "up" };
  if (adx < STAIR_MIN && ady < STAIR_MIN) return r({ ...base, rot: 0, x: a.x - width / 2, y: a.y - STAIR_RUN / 2, w: width, h: STAIR_RUN });
  // across: the start's coordinate across the flight, and which way the wall is.
  const place = (acrossA, acrossB, side, spanAcross) => {
    if (spanAcross >= LINE_DRAG) return { lo: Math.min(acrossA, acrossB), size: spanAcross };
    if (side > 0) return { lo: acrossA - width, size: width }; // wall beyond: the flight on this side
    if (side < 0) return { lo: acrossA, size: width };
    return { lo: acrossA - width / 2, size: width };
  };
  if (adx >= ady) {
    const c = place(a.y, b.y, (a.side && a.side.y) || 0, ady);
    return r({ ...base, rot: dx >= 0 ? 90 : 270, x: Math.min(a.x, b.x), y: c.lo, w: Math.max(adx, STAIR_MIN), h: c.size });
  }
  const c = place(a.x, b.x, (a.side && a.side.x) || 0, adx);
  return r({ ...base, rot: dy <= 0 ? 0 : 180, x: c.lo, y: Math.min(a.y, b.y), w: c.size, h: Math.max(ady, STAIR_MIN) });
}

/* Inspector edits, each about the box's centre. */
const aboutCentre = (f, w, h) => ({ ...f, x: Math.round(f.x + f.w / 2 - w / 2), y: Math.round(f.y + f.h / 2 - h / 2), w: Math.round(w), h: Math.round(h) });
export const clampMm = (v) => Math.max(STAIR_MIN, Math.min(20000, Math.round(v)));
/** Width across the flight (a void: its w). */
export const setStairWidth = (f, v) => (turned(f) ? aboutCentre(f, f.w, clampMm(v)) : aboutCentre(f, clampMm(v), f.h));
/** Length along the flight (a void: its h). */
export const setStairLength = (f, v) => (turned(f) ? aboutCentre(f, clampMm(v), f.h) : aboutCentre(f, f.w, clampMm(v)));
export const setRisers = (f, v) => ({ ...f, risers: Math.max(RISERS_MIN, Math.min(RISERS_MAX, Math.round(v) || STAIR_RISERS)) });
/** A quarter turn clockwise about its centre (a void swaps its sides). */
export function rotateStair(f) {
  const g = aboutCentre(f, f.h, f.w);
  return f.kind === "flight" ? { ...g, rot: ((f.rot || 0) + 90) % 360 } : g;
}
