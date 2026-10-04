/* ============================================================================
 * lib/cad/snap.js — Plotwire CAD floor-plan: Snap to walls.
 *
 * Pure functions only — no React, no DOM. Where a wall point is placed (a
 * wall's start or end, or a dragged corner) it can land on another wall's
 * long face, where a wall ending there makes a seamless T-junction (SIDE; see
 * fits, and resolveEnd in lib/cad/plan), or on an alignment guide: the 0, 90
 * or 45deg line through a nearby wall end or the wall's own start point
 * (GUIDE; where two guides cross, on the crossing). The caller's wall-end
 * snap comes first, then a side, then a guide crossing, then one guide; with
 * none in reach the caller's angle lock / grid apply as before. Guides are
 * only drawn, never saved.
 * ========================================================================= */

import { hyp, snap, thicknessFor, NODE_TOL } from "@/lib/cad/plan";

export const SIDE_PX = 10;   // screen px: a point this close to a wall's long face lands on it
export const GUIDE_PX = 8;   // screen px: ... this close to a guide lands on it
export const TRACK_N = 6;    // the nearest wall ends (one per spot) that give guides
export const CLEAR = 1;      // mm: a wall on a side stays this far clear of the host's ends (see fits)

const r3 = (v) => Math.round(v * 1000) / 1000;
// Guides through a tracking point: 0deg, 90deg, 45deg both ways (+y down).
const GUIDE_DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
// Lock angles: the 45deg steps from +x, in atan2 order.
const LOCK_DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

/**
 * Where line p + s*d meets line q + r*e (p, q: {x,y}; d, e: [dx,dy]) ->
 * { x, y, s, r }, or null when they're parallel. A line square to the page
 * keeps its constant coordinate exactly; the rest is rounded to 0.001mm.
 */
export function meet(p, d, q, e) {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-9 * hyp(d[0], d[1]) * hyp(e[0], e[1])) return null;
  const wx = q.x - p.x, wy = q.y - p.y, s = (wx * e[1] - wy * e[0]) / den, r = (wx * d[1] - wy * d[0]) / den;
  let x = r3(p.x + d[0] * s), y = r3(p.y + d[1] * s);
  if (!d[1]) y = p.y; else if (!e[1]) y = q.y;
  if (!d[0]) x = p.x; else if (!e[0]) x = q.x;
  return { x, y, s, r };
}

/** Lock angles from `from` towards raw: the 45deg step snapPt picks, as [dx, dy] (exact, not unit length). */
export function lockDir(from, raw) {
  const k = Math.round(Math.atan2(raw.y - from.y, raw.x - from.x) / (Math.PI / 4));
  return LOCK_DIRS[(k + 8) % 8];
}

/**
 * Is p on wall w's body as resolveEnd (lib/cad/plan) sees a T-junction:
 * between its ends and within half its thickness + 2mm of its centre line?
 */
export function onSide(w, p) {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1, l2 = dx * dx + dy * dy;
  if (l2 < 1) return false;
  const tt = ((p.x - w.x1) * dx + (p.y - w.y1) * dy) / l2;
  return tt >= 0 && tt <= 1 && Math.abs((p.x - w.x1) * dy - (p.y - w.y1) * dx) / Math.sqrt(l2) <= thicknessFor(w.type) / 2 + 2;
}

// Wall w's face on side sg (+1: along n = u turned +90deg): { w, sg, L, q, fd }
// — a point on it level with (x1,y1), and its direction (the wall's, L long).
function face(w, sg) {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1, L = hyp(dx, dy), e = sg * thicknessFor(w.type) / 2;
  return { w, sg, L, q: { x: w.x1 - (dy / L) * e, y: w.y1 + (dx / L) * e }, fd: [dx, dy] };
}

// a with lo <= b0 + a*b1 <= hi -> [from, to] (to < from: none).
function solve(b0, b1, lo, hi) {
  if (Math.abs(b1) < 1e-9) return b0 >= lo - 1e-6 && b0 <= hi + 1e-6 ? [-Infinity, Infinity] : [1, 0];
  const a = (lo - b0) / b1, b = (hi - b0) / b1;
  return a < b ? [a, b] : [b, a];
}

/**
 * How far from wall w's end k (0 = x1,y1) its face on side sg lies hidden
 * inside the walls joined there (another wall's end at that corner, or the
 * wall that end sits on): mm along w, 0 when the face runs right to the end.
 */
export function covered(walls, w, k, sg) {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1, L = hyp(dx, dy), e = sg * thicknessFor(w.type) / 2;
  const P = k ? { x: w.x2, y: w.y2 } : { x: w.x1, y: w.y1 }, ux = (k ? -dx : dx) / L, uy = (k ? -dy : dy) / L;
  const fx = P.x - (dy / L) * e, fy = P.y + (dx / L) * e; // the face at that end; a mm in: + a*u
  let h = 0;
  for (const o of walls) {
    if (o === w) continue;
    const ox = o.x2 - o.x1, oy = o.y2 - o.y1, oL = hyp(ox, oy);
    if (oL < 1 || !(hyp(o.x1 - P.x, o.y1 - P.y) <= NODE_TOL || hyp(o.x2 - P.x, o.y2 - P.y) <= NODE_TOL || onSide(o, P))) continue;
    // The stretch of the face inside o: between o's ends, within t/2 of its centre line.
    const vx = ox / oL, vy = oy / oL, bx = fx - o.x1, by = fy - o.y1, t = thicknessFor(o.type) / 2;
    const A = solve(bx * vx + by * vy, ux * vx + uy * vy, 0, oL), B = solve(bx * vy - by * vx, ux * vy - uy * vx, -t, t);
    const lo = Math.max(A[0], B[0]), hi = Math.min(A[1], B[1]);
    if (hi >= lo && lo <= 1e-6 && hi > h) h = hi;
  }
  return h;
}

// Face f's open stretch, worked out once per face: f.c0 / f.c1, covered at
// each end (see covered), and f.bk, [from, to] along the wall where another
// wall already ends on this face (its footprint there).
function openFace(walls, f) {
  const w = f.w, dx = f.fd[0] / f.L, dy = f.fd[1] / f.L, eh = thicknessFor(w.type) / 2;
  f.c0 = covered(walls, w, 0, f.sg); f.c1 = covered(walls, w, 1, f.sg); f.bk = [];
  for (const o of walls) {
    if (o === w) continue;
    const ox = o.x2 - o.x1, oy = o.y2 - o.y1, oL = hyp(ox, oy);
    if (oL < 1) continue;
    for (let k = 0; k < 2; k++) {
      const E = k ? { x: o.x2, y: o.y2 } : { x: o.x1, y: o.y1 };
      if (!onSide(w, E)) continue;
      const vx = (k ? -ox : ox) / oL, vy = (k ? -oy : oy) / oL, vn = (dx * vy - dy * vx) * f.sg; // vn > 0: o leaves by this face
      if (vn < 1e-6) continue;
      const ea = (E.x - w.x1) * dx + (E.y - w.y1) * dy, ec = ((E.y - w.y1) * dx - (E.x - w.x1) * dy) * f.sg;
      const a = ea + ((eh - ec) / vn) * (vx * dx + vy * dy), m = thicknessFor(o.type) / 2 / vn;
      f.bk.push([a - m, a + m]);
    }
  }
}

/**
 * Can a wall `half` thick each side of its centre line, drawn from `from`
 * when known, end at X on face f as a clean T-junction? It must come from the
 * side the face looks out to (not through the host), and not so shallow that
 * resolveEnd (lib/cad/plan) can't cut it to the host's centre line. Its sides
 * must cross the face on its open stretch (clear of the host's ends, the walls
 * joined there and any wall already ending on it) and the centre line within
 * the host, by CLEAR: never flush, as the outline (wallOutline) can't merge
 * edges that nearly meet. walls: without the walls being moved.
 */
export function fits(walls, f, X, half = 0, from = null) {
  const w = f.w, dx = f.fd[0], dy = f.fd[1], L = f.L, eh = thicknessFor(w.type) / 2;
  const along = ((X.x - w.x1) * dx + (X.y - w.y1) * dy) / L;
  let m = half, c = 0, k = CLEAR;
  if (from) {
    const gx = X.x - from.x, gy = X.y - from.y, gl = hyp(gx, gy);
    if ((gx * dy - gy * dx) * f.sg <= 0) return false; // from behind the face: through the host
    const sn = Math.abs(gx * dy - gy * dx) / (gl * L), cs = (gx * dx + gy * dy) / (gl * L);
    // resolveEnd's reach for the cut: 6x the larger half thickness, + the offset (eh).
    if (sn < 1e-6 || hyp(half, (eh + half * Math.abs(cs)) / sn) >= 6 * Math.max(half, eh) + eh - 1) return false;
    m = half / sn; // its sides cross the face this far either side of X,
    c = (eh * cs) / sn; // and the host's centre line this far on from there
    k = CLEAR / sn;
  }
  m += k;
  if (along < m || along > L - m || along + c < m || along + c > L - m) return false;
  if (f.c0 === undefined) openFace(walls, f);
  if (along < m + f.c0 || along > L - m - f.c1) return false;
  for (const b of f.bk) if (along + m > b[0] && along - m < b[1]) return false;
  return true;
}

/**
 * The wall face nearest p within tol (mm): a long face, t/2 either side of
 * the centre line, between the wall's ends, where a wall `half` thick (from
 * `from`) fits (see fits). Not the faces of a wall `from` sits on: a wall
 * from there would lie along or through it. -> { w, sg, L, q, fd } | null.
 */
export function nearFace(walls, p, tol, skipWalls = null, from = null, half = 0) {
  let best = null, bd = tol + 1e-9;
  for (const w of walls) {
    if (skipWalls && skipWalls.has(w.id)) continue;
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1, L = hyp(dx, dy);
    if (L < 1) continue;
    const ax = p.x - w.x1, ay = p.y - w.y1, along = (ax * dx + ay * dy) / L;
    if (along < 0 || along > L) continue;
    const across = (ay * dx - ax * dy) / L, e = thicknessFor(w.type) / 2;
    for (let sg = 1; sg >= -1; sg -= 2) {
      const d = Math.abs(across - sg * e);
      if (d >= bd || (from && onSide(w, from))) continue;
      const f = face(w, sg);
      if (fits(walls, f, { x: f.q.x + (dx / L) * along, y: f.q.y + (dy / L) * along }, half, from)) { bd = d; best = f; }
    }
  }
  return best;
}

/**
 * Tracking points for guides near p: the TRACK_N nearest wall ends (one per
 * spot, nearest first), leaving out the ends in skipEnds ("id:end", end 0 =
 * x1,y1), plus `extra` (the wall's start point) when given. -> [{x,y}].
 */
export function trackPts(walls, p, skipEnds = null, extra = null) {
  const pts = [], ds = [];
  const add = (x, y, cap) => {
    for (let i = 0; i < pts.length; i++) if (Math.abs(pts[i].x - x) < 0.5 && Math.abs(pts[i].y - y) < 0.5) return;
    const d = (x - p.x) * (x - p.x) + (y - p.y) * (y - p.y), full = pts.length >= cap;
    if (full && d >= ds[pts.length - 1]) return;
    let i = full ? pts.length - 1 : pts.length;
    for (; i > 0 && ds[i - 1] > d; i--) { pts[i] = pts[i - 1]; ds[i] = ds[i - 1]; }
    pts[i] = { x, y }; ds[i] = d;
  };
  for (const w of walls) {
    if (!skipEnds || !skipEnds.has(w.id + ":0")) add(w.x1, w.y1, TRACK_N);
    if (!skipEnds || !skipEnds.has(w.id + ":1")) add(w.x2, w.y2, TRACK_N);
  }
  if (extra) add(extra.x, extra.y, TRACK_N + 1); // always in, in its place
  return pts;
}

/** The guides within tol (mm) of p from tracking points pts, nearest first: [{ P, g, d }]. */
export function guidesNear(pts, p, tol) {
  const out = [];
  for (const P of pts) for (const g of GUIDE_DIRS) {
    const d = Math.abs((p.x - P.x) * g[1] - (p.y - P.y) * g[0]) / (g[0] && g[1] ? Math.SQRT2 : 1);
    if (d <= tol) out.push({ P, g, d });
  }
  return out.sort((a, b) => a.d - b.d); // stable: on a tie the nearer tracking point stays first
}

/**
 * p's foot on the line through P along g. grid > 0: stepped along a level,
 * upright or 45deg line so its free coordinate is on the grid (y on an
 * upright line, else x); a line at any other angle is left as it is.
 */
export function footOn(P, g, p, grid = 0) {
  const X = meet(P, g, p, [-g[1], g[0]]);
  if (!grid || !X) return X;
  const ax = Math.abs(g[0]), ay = Math.abs(g[1]);
  if (ax <= ay * 1e-9) { const y = snap(X.y, grid); return { x: g[0] ? r3(P.x + (y - P.y) * g[0] / g[1]) : X.x, y }; }
  if (ay > ax * 1e-9 && Math.abs(ax - ay) > ax * 1e-9) return X;
  const x = snap(X.x, grid);
  return { x, y: g[1] ? r3(P.y + (x - P.x) * g[1] / g[0]) : X.y };
}

/**
 * Snap to walls for a wall point at raw (mm): onto a wall's long face (SIDE),
 * else where two guides cross, else onto one guide (GUIDE). null when none is
 * in reach: the caller's angle lock / grid then apply. Its wall-end snap
 * comes before all of this. o = {
 *   scale: screen px per mm (sets the reach: SIDE_PX, GUIDE_PX),
 *   from: the wall's start point (null for a first point); a tracking point,
 *   lock: Lock angles: the point stays on the 45deg ray from `from` (as
 *     snapPt), at the face / guide where the ray meets it nearest the ray point,
 *   proj: the ray point is raw's foot on the ray (a dragged corner) rather
 *     than raw's distance along it (drawing), as snapPt,
 *   grid: Snap to grid step, 0 = off (along a square face or a guide),
 *   half: half the thickness of the wall being drawn (a side point leaves
 *     room for it on the open face, see fits),
 *   skipWalls: Set of wall ids whose faces don't count,
 *   skipEnds: Set of "id:end" ends that give no guides }.
 * The faces of a wall `from` sits on never count (see nearFace).
 * -> { x, y, kind: 'side' | 'guide', guides: [{x,y}] (tracking points of the
 * guides used, to draw), id (side: that wall) }.
 */
export function wallSnap(walls, raw, o = {}) {
  const sc = o.scale || 1, stol = SIDE_PX / sc, gtol = GUIDE_PX / sc, grid = o.grid || 0, from = o.from || null, half = o.half || 0;
  // Never back on the wall's own start point (a wall of no length).
  const atStart = (X) => !!from && Math.abs(X.x - from.x) < 1 && Math.abs(X.y - from.y) < 1;
  // The walls whose faces count, and that can be in the way of a side point.
  const ws = o.skipWalls ? walls.filter((w) => !o.skipWalls.has(w.id)) : walls;
  if (o.lock && from) {
    const dir = lockDir(from, raw), dl = hyp(dir[0], dir[1]), ux = dir[0] / dl, uy = dir[1] / dl;
    const rx = raw.x - from.x, ry = raw.y - from.y, t = o.proj ? Math.max(0, rx * ux + ry * uy) : hyp(rx, ry);
    const ref = { x: from.x + ux * t, y: from.y + uy * t };
    // A face the ray meets (ahead of the start, between that wall's ends, room
    // for the wall there) nearest the ray point...
    let best = null, bd = stol;
    for (const w of ws) {
      if (hyp(w.x2 - w.x1, w.y2 - w.y1) < 1 || onSide(w, from)) continue;
      for (let sg = 1; sg >= -1; sg -= 2) {
        const f = face(w, sg), X = meet(from, dir, f.q, f.fd);
        if (!X || X.r < 0 || X.r > 1 || X.s * dl <= 1) continue;
        const d = hyp(X.x - ref.x, X.y - ref.y);
        if (d < bd && onSide(w, X) && fits(ws, f, X, half, from)) { bd = d; best = { x: X.x, y: X.y, kind: "side", id: w.id, guides: [] }; }
      }
    }
    if (best) return best;
    // ...else a guide it crosses.
    bd = gtol;
    for (const P of trackPts(walls, ref, o.skipEnds, from)) for (const g of GUIDE_DIRS) {
      const X = meet(from, dir, P, g);
      if (!X || X.s * dl <= 1) continue;
      const d = hyp(X.x - ref.x, X.y - ref.y);
      if (d < bd) { bd = d; best = { x: X.x, y: X.y, kind: "guide", guides: [P] }; }
    }
    return best;
  }
  const gs = guidesNear(trackPts(walls, raw, o.skipEnds, from), raw, gtol);
  const f = nearFace(ws, raw, stol, null, from, half);
  if (f) {
    // On the face: where a guide crosses it (near raw), else raw's foot on it.
    const ok = (X) => !!X && !atStart(X) && onSide(f.w, X) && fits(ws, f, X, half, from);
    let X = null, P = null, bd = 3 * gtol;
    for (const c of gs) {
      const Y = meet(f.q, f.fd, c.P, c.g);
      if (!Y || Y.s < 0 || Y.s > 1) continue;
      const d = hyp(Y.x - raw.x, Y.y - raw.y);
      if (d < bd && ok(Y)) { bd = d; X = Y; P = c.P; }
    }
    if (X) return { x: X.x, y: X.y, kind: "side", id: f.w.id, guides: [P] };
    X = footOn(f.q, f.fd, raw, grid);
    if (!ok(X)) X = footOn(f.q, f.fd, raw); // the grid step left the open face: as it is
    if (ok(X)) return { x: X.x, y: X.y, kind: "side", id: f.w.id, guides: [] };
  }
  // Two guides from different points crossing near raw: on the crossing.
  let best = null, bd = 3 * gtol;
  for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) {
    const a = gs[i], b = gs[j];
    if (a.P === b.P) continue;
    const X = meet(a.P, a.g, b.P, b.g);
    if (!X || atStart(X)) continue;
    const d = hyp(X.x - raw.x, X.y - raw.y);
    if (d < bd) { bd = d; best = { x: X.x, y: X.y, kind: "guide", guides: [a.P, b.P] }; }
  }
  if (best) return best;
  // Else the nearest guide.
  for (const c of gs) {
    const X = footOn(c.P, c.g, raw, grid);
    if (X && !atStart(X)) return { x: X.x, y: X.y, kind: "guide", guides: [c.P] };
  }
  return null;
}
