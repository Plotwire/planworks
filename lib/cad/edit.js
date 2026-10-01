/* ============================================================================
 * lib/cad/edit.js — Plotwire CAD floor-plan: editing walls by dragging.
 *
 * Pure functions only — no React, no DOM. Drag a wall END (the whole corner:
 * every wall end within NODE_TOL of it moves together) or a WHOLE wall, and
 * whatever is joined to it follows so every join stays seamless: ends at the
 * moved corners, walls ending on a moved wall's side (T-junctions) and the
 * doors and windows in a moved wall. Every call returns a NEW model; items it
 * doesn't touch keep their identity, and a no-op returns the model itself.
 * ========================================================================= */

import { hyp, thicknessFor, NODE_TOL } from "@/lib/cad/plan";

export const MIN_WALL = 50;   // an edit may not leave a wall shorter than this (mm)

const r3 = (v) => Math.round(v * 1000) / 1000;
// A moved coordinate rounded to 0.001mm; one that hasn't really moved keeps its exact value.
const fix = (v0, v1) => (Math.abs(v1 - v0) < 1e-6 ? v0 : r3(v1));
const endPt = (w, end) => (end === 0 ? [w.x1, w.y1] : [w.x2, w.y2]);
const key = (id, end) => id + ":" + end;
const wlen = (w) => hyp(w.x2 - w.x1, w.y2 - w.y1);
// A wall's main axis for its openings: "h" / "v", or null when it runs (about) 45deg.
const axis = (w) => { const d = Math.abs(w.x2 - w.x1) - Math.abs(w.y2 - w.y1); return d > 0.01 ? "h" : d < -0.01 ? "v" : null; };

/** Every wall end within tol of (x,y) — one corner: [{ id, end }] (end 0 = x1,y1). */
export function findNode(walls, x, y, tol = NODE_TOL) {
  const out = [];
  for (const w of walls) for (const end of [0, 1]) {
    const [px, py] = endPt(w, end);
    if (hyp(px - x, py - y) <= tol) out.push({ id: w.id, end });
  }
  return out;
}

/** Nearest wall end within tol of (x,y), wall preferId's own ends first: { id, end, x, y } | null. */
export function endAt(walls, x, y, tol, preferId = null) {
  let best = null, bd = Infinity, pref = null, pd = Infinity;
  for (const w of walls) for (const end of [0, 1]) {
    const [px, py] = endPt(w, end), d = hyp(px - x, py - y);
    if (d > tol) continue;
    if (d < bd) { bd = d; best = { id: w.id, end, x: px, y: py }; }
    if (w.id === preferId && d < pd) { pd = d; pref = { id: w.id, end, x: px, y: py }; }
  }
  return pref || best;
}

// The wall whose side end `end` of wall w sits on — the T-junction test in
// resolveEnd (lib/cad/plan): within the segment and within half the host's
// thickness + 2mm of its centre line. A wall with its own end there is a
// corner, not a host; so is one w already shares a corner with at its other
// end (a short wall lying inside that wall's thickness).
function teeHost(walls, w, end) {
  const P = endPt(w, end), Q = endPt(w, 1 - end);
  let host = null, hd = Infinity;
  for (const o of walls) {
    if (o === w) continue;
    const dx = o.x2 - o.x1, dy = o.y2 - o.y1, l2 = dx * dx + dy * dy;
    if (l2 < 1) continue;
    const tt = ((P[0] - o.x1) * dx + (P[1] - o.y1) * dy) / l2;
    if (tt < 0 || tt > 1) continue;
    if (hyp(P[0] - o.x1, P[1] - o.y1) <= NODE_TOL || hyp(P[0] - o.x2, P[1] - o.y2) <= NODE_TOL) continue;
    if (hyp(Q[0] - o.x1, Q[1] - o.y1) <= NODE_TOL || hyp(Q[0] - o.x2, Q[1] - o.y2) <= NODE_TOL) continue;
    const d = Math.abs((P[0] - o.x1) * dy - (P[1] - o.y1) * dx) / Math.sqrt(l2);
    if (d <= thicknessFor(o.type) / 2 + 2 && d < hd) { hd = d; host = o; }
  }
  return host;
}

// Is q still a T on wall h: within its length and clear of both its ends
// (closer than NODE_TOL it would turn into a corner there).
function onHost(h, q) {
  const dx = h.x2 - h.x1, dy = h.y2 - h.y1, tt = ((q[0] - h.x1) * dx + (q[1] - h.y1) * dy) / (dx * dx + dy * dy);
  return tt >= 0 && tt <= 1 && hyp(q[0] - h.x1, q[1] - h.y1) > NODE_TOL && hyp(q[0] - h.x2, q[1] - h.y2) > NODE_TOL;
}

// The wall a door/window sits in: the nearest one whose centre line it lies
// on — within the wall's length and within half its thickness + 20mm.
function openingHost(walls, o) {
  let host = null, hd = Infinity;
  for (const w of walls) {
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1, l2 = dx * dx + dy * dy;
    if (l2 < 1) continue;
    const tt = ((o.x - w.x1) * dx + (o.y - w.y1) * dy) / l2;
    if (tt < 0 || tt > 1) continue;
    const d = Math.abs((o.x - w.x1) * dy - (o.y - w.y1) * dx) / Math.sqrt(l2);
    if (d <= thicknessFor(w.type) / 2 + 20 && d < hd) { hd = d; host = w; }
  }
  return host;
}

// Carry point p from wall a (before) to wall b (after) -> [x, y, shifted]. A
// plain shift moves it by the same amount (shifted = true). Otherwise it keeps
// its distance along the wall from the end that stayed put (its share of the
// length when both ends moved) and its offset across the wall; fit(s, L)
// clamps that distance on the new wall.
function carry(a, b, p, fit) {
  const sx = b.x1 - a.x1, sy = b.y1 - a.y1, ex = b.x2 - a.x2, ey = b.y2 - a.y2;
  if (Math.abs(sx - ex) < 2e-3 && Math.abs(sy - ey) < 2e-3) return [p[0] + sx, p[1] + sy, true];
  const m1 = !!(sx || sy), m2 = !!(ex || ey), flip = m1 && !m2; // measure from the fixed end
  const A0 = flip ? [a.x2, a.y2] : [a.x1, a.y1], B0 = flip ? [a.x1, a.y1] : [a.x2, a.y2];
  const A1 = flip ? [b.x2, b.y2] : [b.x1, b.y1], B1 = flip ? [b.x1, b.y1] : [b.x2, b.y2];
  const L0 = hyp(B0[0] - A0[0], B0[1] - A0[1]) || 1, L1 = hyp(B1[0] - A1[0], B1[1] - A1[1]) || 1;
  const u0 = [(B0[0] - A0[0]) / L0, (B0[1] - A0[1]) / L0], u1 = [(B1[0] - A1[0]) / L1, (B1[1] - A1[1]) / L1];
  const qx = p[0] - A0[0], qy = p[1] - A0[1];
  let s = qx * u0[0] + qy * u0[1];
  const c = qy * u0[0] - qx * u0[1];        // across: along n = u rotated +90deg
  if (m1 && m2) s *= L1 / L0;
  s = fit(s, L1);
  return [A1[0] + u1[0] * s - u1[1] * c, A1[1] + u1[1] * s + u1[0] * c, false];
}

/**
 * Doors / windows carried with the walls they sit in. walls0 = the walls
 * before the edit; changed = Map id -> [before, after] for every wall that
 * moved. An opening keeps its distance from its wall's fixed end (moves with
 * it on a plain shift), clamped so it stays inside the wall; dir ('h'/'v')
 * changes only when the wall's main axis really does. Openings in unmoved
 * walls keep identity.
 */
export function rehostOpenings(list, walls0, changed) {
  if (!list || !list.length || !changed.size) return list;
  let any = false;
  const out = list.map((o) => {
    const h = openingHost(walls0, o);
    if (!h || !changed.has(h.id)) return o;
    const [a, b] = changed.get(h.id), half = (o.w || 0) / 2;
    const q = carry(a, b, [o.x, o.y], (s, L) => Math.max(0, Math.min(s, Math.max(L - half, L / 2))));
    const x = fix(o.x, q[0]), y = fix(o.y, q[1]);
    const ax = q[2] ? null : axis(b), dir = ax && ax !== axis(a) ? ax : o.dir;
    if (x === o.x && y === o.y && dir === o.dir) return o;
    any = true;
    return { ...o, x, y, dir };
  });
  return any ? out : list;
}

const cr = (p, q) => p[0] * q[1] - p[1] * q[0];
const dt = (p, q) => p[0] * q[0] + p[1] * q[1];
const vec = (w, end) => (end === 1 ? [w.x1 - w.x2, w.y1 - w.y2] : [w.x2 - w.x1, w.y2 - w.y1]); // from end `end` to the other
const moved = (a, b) => a.x1 !== b.x1 || a.y1 !== b.y1 || a.x2 !== b.x2 || a.y2 !== b.y2;

// Shortest a wall gets as it goes straight from vector p to q (|p + t(q-p)|, t 0..1).
function sweepMin(p, q) {
  const d = [q[0] - p[0], q[1] - p[1]], l2 = dt(d, d), t = l2 ? Math.max(0, Math.min(1, -dt(p, d) / l2)) : 0;
  return hyp(p[0] + d[0] * t, p[1] + d[1] * t);
}

// Two walls meeting at a corner (a, b: from the corner to each far end; 0 =
// before, 1 = after, going straight between): do they fold flat onto each
// other on the way (in line while pointing the same way), or end up within
// MIN_WALL of it (the shorter one's far end that close to the other's line)?
// Going through a straight line (180deg) is fine.
function folds(a0, b0, a1, b1) {
  const da = [a1[0] - a0[0], a1[1] - a0[1]], db = [b1[0] - b0[0], b1[1] - b0[1]];
  const A = cr(da, db), B = cr(a0, db) + cr(da, b0), C = cr(a0, b0), sc = Math.max(Math.abs(A), Math.abs(B), Math.abs(C)) * 1e-12;
  let ts = [];
  if (Math.abs(A) > sc) { const D = B * B - 4 * A * C; if (D >= 0) ts = [(-B - Math.sqrt(D)) / (2 * A), (-B + Math.sqrt(D)) / (2 * A)]; }
  else if (Math.abs(B) > sc) ts = [-C / B];
  for (const t of ts) if (t > 1e-6 && t <= 1 && dt([a0[0] + da[0] * t, a0[1] + da[1] * t], [b0[0] + db[0] * t, b0[1] + db[1] * t]) > 0) return true;
  const gap = (a, b) => Math.abs(cr(a, b)) / (Math.max(hyp(a[0], a[1]), hyp(b[0], b[1])) || 1), g1 = gap(a1, b1);
  return dt(a1, b1) > 0 && g1 < MIN_WALL && g1 < gap(a0, b0) - 1e-6;
}

// Move wall ends (moves: Map "id:end" -> [x,y]), then carry what hangs off
// every wall that changed: T-junction ends (level after level, so a wall that
// tilts takes its own T-walls with it) and doors/windows. null (ignore the
// move) when that would push a T-end off the end of the wall it sits on, or
// when, on the way from `prev` (the drag's last accepted result, else the
// model itself), a wall would get shorter than MIN_WALL (passing through its
// own far end) or fold flat onto a wall it shares a corner with (a room
// pushed inside out). Measuring from `prev` lets a wall swing round its far
// end step by step without that counting as passing through it.
function applyEnds(model, moves, prev) {
  const walls0 = model.walls;
  const set = (w, p1, p2) => {
    const c1 = p1 && (p1[0] !== w.x1 || p1[1] !== w.y1), c2 = p2 && (p2[0] !== w.x2 || p2[1] !== w.y2);
    if (!c1 && !c2) return w;
    return { ...w, ...(c1 ? { x1: p1[0], y1: p1[1] } : null), ...(c2 ? { x2: p2[0], y2: p2[1] } : null) };
  };
  let walls1 = walls0.map((w) => set(w, moves.get(key(w.id, 0)), moves.get(key(w.id, 1))));
  const diff = () => {
    const m = new Map();
    walls0.forEach((w, i) => { if (walls1[i] !== w) m.set(w.id, [w, walls1[i]]); });
    return m;
  };
  if (!diff().size) return model;
  // Walls ending on a changed wall's side stay on it. Repeated until nothing
  // more changes (capped, in case two walls each end on the other).
  const tees = [];
  walls0.forEach((w) => [0, 1].forEach((end) => {
    if (moves.has(key(w.id, end))) return;
    const h = teeHost(walls0, w, end);
    if (h) tees.push({ w, end, P: endPt(w, end), h });
  }));
  for (let pass = 0; tees.length && pass < 8; pass++) {
    const ch = diff(), upd = new Map();
    for (const t of tees) {
      if (!ch.has(t.h.id)) continue;
      const [a, b] = ch.get(t.h.id), q = carry(a, b, t.P, (s) => s);
      if (!onHost(b, q)) return null;
      upd.set(key(t.w.id, t.end), [fix(t.P[0], q[0]), fix(t.P[1], q[1])]);
    }
    const next = walls1.map((w) => set(w, upd.get(key(w.id, 0)), upd.get(key(w.id, 1))));
    if (next.every((w, i) => w === walls1[i])) break;
    walls1 = next;
  }
  const pw = prev && prev.walls && prev.walls.length === walls0.length ? prev.walls : walls0;
  const at = new Map(walls0.map((w, i) => [w.id, i]));
  for (let i = 0; i < walls0.length; i++) {
    const w0 = walls0[i], wp = pw[i], w1 = walls1[i];
    if (!moved(wp, w1)) continue;
    const d = sweepMin(vec(wp, 0), vec(w1, 0));
    if (d < MIN_WALL && d < wlen(w0) - 1e-6) return null;
    for (const end of [0, 1]) for (const n of findNode(walls0, ...endPt(w0, end))) {
      const j = at.get(n.id);
      if (j === i || j == null) continue;
      const together = (ws) => { const p = endPt(ws[i], end), q = endPt(ws[j], n.end); return hyp(p[0] - q[0], p[1] - q[1]) <= NODE_TOL; };
      if (together(pw) && together(walls1) && folds(vec(wp, end), vec(pw[j], n.end), vec(w1, end), vec(walls1[j], n.end))) return null;
    }
  }
  const changed = diff();
  return {
    ...model, walls: walls1,
    doors: rehostOpenings(model.doors, walls0, changed),
    windows: rehostOpenings(model.windows, walls0, changed),
  };
}

/**
 * Drag a corner: every wall end in `ends` (from findNode) moves to `to`
 * ({x,y}, already snapped / rounded by the caller), so the corner moves as
 * one, and dropping it on another wall end makes one seamless corner there.
 * Returns the new model, the same model if nothing moved, or null if the
 * move isn't allowed (see applyEnds; prev = this drag's last result).
 */
export function moveNode(model, ends, to, prev) {
  return applyEnds(model, new Map(ends.map((e) => [key(e.id, e.end), [to.x, to.y]])), prev);
}

/**
 * Drag a whole wall by (dx, dy): its ends and every wall end at either of its
 * corners move by the same amount, so the walls joined there stretch to
 * follow; walls ending on its side and its doors/windows shift with it. An
 * end of it that sits on another wall's side (a T) slides along that wall
 * instead — to where the moved wall's line crosses it — so the T stays put;
 * other walls ending at that same point on that wall (a cross) stay where
 * they are. Returns the new model, the same model for a zero move, or null
 * (applyEnds; prev = this drag's last result).
 */
export function moveWall(model, id, dx, dy, prev) {
  const w = model.walls.find((o) => o.id === id);
  if (!w || (!dx && !dy)) return model;
  const ws = model.walls, byId = new Map(ws.map((o) => [o.id, o])), moves = new Map();
  for (const end of [0, 1]) {
    const P = endPt(w, end), node = findNode(ws, P[0], P[1]), t = teeHost(ws, w, end);
    const h = t && node.every((e) => e.id === id || teeHost(ws, byId.get(e.id), e.end) === t) ? t : null;
    if (h) {
      // P + d + u*s meets the host's line through P (same offset across it);
      // a wall lying along its host just shifts.
      const ux = w.x2 - w.x1, uy = w.y2 - w.y1, vx = h.x2 - h.x1, vy = h.y2 - h.y1, den = ux * vy - uy * vx;
      const cross = Math.abs(den) > 1e-9 * hyp(ux, uy) * hyp(vx, vy), s = cross ? -(dx * vy - dy * vx) / den : 0;
      const q = [P[0] + dx + ux * s, P[1] + dy + uy * s];
      if (cross && !onHost(h, q)) return null;
      moves.set(key(id, end), [fix(P[0], q[0]), fix(P[1], q[1])]);
      continue;
    }
    for (const e of node) {
      const [px, py] = endPt(byId.get(e.id), e.end);
      moves.set(key(e.id, e.end), [fix(px, px + dx), fix(py, py + dy)]);
    }
  }
  return applyEnds(model, moves, prev);
}
