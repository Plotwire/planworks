/* ============================================================================
 * lib/cad/rooms.js — Plotwire CAD floor-plan: room labels and their areas.
 *
 * Pure functions only — no React, no DOM. A room label with auto: true shows
 * the net floor area of the space it sits in: bounded by the inner faces of
 * the walls exactly as drawn (joinedWallPolys: mitred corners, T-junctions,
 * crossings), less any free-standing walls inside it. A label that isn't in a
 * fully closed space (a gap in the walls, outside the building, on a wall)
 * has none. Labels without auto keep the area that was typed in.
 * ========================================================================= */

import { hyp, joinedWallPolys } from "@/lib/cad/plan";

const EPS = 0.4;    // outward probe for "is this edge inside another wall" (as wallOutline)
const WELD = 0.3;   // mm: outline points this close are one point (as wallOutline)
const TINY = 1;     // mm²: a face smaller than this is a slip of the arithmetic

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Signed area (mm²): positive for a ring the faces below are traced round.
function ringArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

function boxOf(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
}
const inBox = (b, x, y) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

/** Does this room label work its area out from the walls? (Older labels have no auto.) */
export function isAuto(r) { return !!r && r.auto === true; }

/**
 * Every space the walls enclose, for areaAt. The outline of the walls' union
 * (as wallOutline in lib/cad/plan, but also split where walls overlap end to
 * end, and with any piece drawn twice kept once) is made into a planar graph
 * and each face traced round, so walls touching at a point, crossings and
 * free-standing walls inside a room all come out right. A face's net area has
 * the free-standing walls inside it taken off. Work it out once per walls array;
 * joined: joinedWallPolys(walls), if already worked out (as joinWalls' polys).
 * -> { polys, faces: [{ ring, area, net, box }] } (mm, mm²).
 */
export function roomSpaces(walls, joined = null) {
  const polys = Object.values(joined || joinedWallPolys(walls || []));

  // 1. Pieces of the union outline: each wall edge, split where another
  // wall's edge crosses it or ends on it, keeping the pieces not inside
  // another wall.
  const segs = [];
  polys.forEach((A, ai) => {
    const sgn = ringArea(A) > 0 ? 1 : -1;
    for (let i = 0; i < A.length; i++) {
      const p = A[i], q = A[(i + 1) % A.length];
      const d = [q[0] - p[0], q[1] - p[1]], L = hyp(d[0], d[1]);
      if (L < 1e-6) continue;
      const out = [sgn * d[1] / L, -sgn * d[0] / L];
      const ts = [0, 1];
      polys.forEach((B, bi) => {
        if (bi === ai) return;
        for (let j = 0; j < B.length; j++) {
          const r = B[j], s = B[(j + 1) % B.length], e = [s[0] - r[0], s[1] - r[1]];
          const den = d[0] * e[1] - d[1] * e[0];
          if (Math.abs(den) >= 1e-9) {
            const t = ((r[0] - p[0]) * e[1] - (r[1] - p[1]) * e[0]) / den;
            const v = ((r[0] - p[0]) * d[1] - (r[1] - p[1]) * d[0]) / den;
            if (t > 1e-9 && t < 1 - 1e-9 && v >= -1e-9 && v <= 1 + 1e-9) ts.push(t);
          }
          // B's corner r lying on this edge: walls overlapping end to end, or touching
          const t2 = ((r[0] - p[0]) * d[0] + (r[1] - p[1]) * d[1]) / (L * L);
          if (t2 > 1e-9 && t2 < 1 - 1e-9 && Math.abs((r[0] - p[0]) * d[1] - (r[1] - p[1]) * d[0]) / L < WELD) ts.push(t2);
        }
      });
      ts.sort((x, y) => x - y);
      for (let k = 0; k < ts.length - 1; k++) {
        if (ts[k + 1] - ts[k] < 1e-7) continue;
        const tm = (ts[k] + ts[k + 1]) / 2;
        const mx = p[0] + d[0] * tm + out[0] * EPS, my = p[1] + d[1] * tm + out[1] * EPS;
        if (polys.some((B, bi) => bi !== ai && inPoly(mx, my, B))) continue;
        segs.push([p[0] + d[0] * ts[k], p[1] + d[1] * ts[k], p[0] + d[0] * ts[k + 1], p[1] + d[1] * ts[k + 1]]);
      }
    }
  });

  // 2. Weld the piece ends into points (a 1mm bucket grid) and keep each edge once.
  const vx = [], vy = [], grid = new Map();
  const vid = (x, y) => {
    const gx = Math.round(x), gy = Math.round(y);
    for (let a = gx - 1; a <= gx + 1; a++) for (let b = gy - 1; b <= gy + 1; b++) {
      const l = grid.get(a + "," + b);
      if (l) for (const i of l) if (Math.abs(vx[i] - x) < WELD && Math.abs(vy[i] - y) < WELD) return i;
    }
    const i = vx.length, k = gx + "," + gy;
    vx.push(x); vy.push(y);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
    return i;
  };
  const nb = [], seen = new Set();
  for (const [x1, y1, x2, y2] of segs) {
    const i = vid(x1, y1), j = vid(x2, y2);
    if (i === j) continue;
    const k = i < j ? i + ":" + j : j + ":" + i;
    if (seen.has(k)) continue;
    seen.add(k);
    (nb[i] = nb[i] || []).push(j); (nb[j] = nb[j] || []).push(i);
  }
  const N = vx.length;

  // Connected pieces of outline (a free-standing wall is its own).
  const par = vx.map((_, i) => i);
  const find = (i) => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
  nb.forEach((l, i) => { if (l) l.forEach((j) => { par[find(i)] = find(j); }); });

  // 3. Trace every face: leave each point by the edge just before the one
  // back (by angle), so a bounded face comes out with positive area and the
  // outside of each connected piece negative.
  const ang = (i, j) => Math.atan2(vy[j] - vy[i], vx[j] - vx[i]);
  const order = [], at = new Map();
  for (let i = 0; i < N; i++) {
    const l = (nb[i] || []).map((j) => [j, ang(i, j)]).sort((a, b) => a[1] - b[1]).map((a) => a[0]);
    order.push(l);
    l.forEach((j, k) => at.set(i * N + j, k));
  }
  const used = new Set(), rings = [];
  for (let s = 0; s < N; s++) for (const t of order[s]) {
    if (used.has(s * N + t)) continue;
    const ring = [];
    let u = s, v = t;
    while (!used.has(u * N + v)) {
      used.add(u * N + v); ring.push([vx[u], vy[u]]);
      const o = order[v], w = o[(at.get(v * N + u) - 1 + o.length) % o.length];
      u = v; v = w;
    }
    rings.push({ ring, area: ringArea(ring), comp: find(s) });
  }

  // 4. Each connected piece's outside ring is a hole in the smallest face of
  // another piece round it (a free-standing wall, or a closed box, in a room).
  const faces = rings.filter((f) => f.area > TINY);
  faces.forEach((f) => { f.net = f.area; f.box = boxOf(f.ring); });
  for (const h of rings) {
    if (h.area >= -TINY) continue;
    const [x, y] = h.ring[0];
    let best = null;
    for (const f of faces) if (f.comp !== h.comp && (!best || f.area < best.area) && inBox(f.box, x, y) && inPoly(x, y, f.ring)) best = f;
    if (best) best.net += h.area;
  }
  return { polys, faces: faces.map(({ ring, area, net, box }) => ({ ring, area, net, box })) };
}

/**
 * Net floor area (m²) of the closed space round (x, y), from roomSpaces; null
 * when the point isn't in one (a gap in the walls, outside, or on a wall).
 */
export function areaAt(sp, x, y) {
  if (!sp || !isFinite(x) || !isFinite(y)) return null;
  if (sp.polys.some((P) => inPoly(x, y, P))) return null;
  let best = null;
  for (const f of sp.faces) if ((!best || f.area < best.area) && inBox(f.box, x, y) && inPoly(x, y, f.ring)) best = f;
  return best && best.net > TINY ? best.net / 1e6 : null;
}

/**
 * The bounding box [x0, y0, x1, y1] (mm) of the closed space round (x, y),
 * from roomSpaces, or null: how much room a label there has.
 */
export function spaceBoxAt(sp, x, y) {
  if (!sp || !isFinite(x) || !isFinite(y)) return null;
  let best = null;
  for (const f of sp.faces) if ((!best || f.area < best.area) && inBox(f.box, x, y) && inPoly(x, y, f.ring)) best = f;
  return best ? best.box : null;
}

/** Is (x, y) on a wall (inside one's outline), from roomSpaces? A label there has no area. */
export function onWall(sp, x, y) { return !!sp && sp.polys.some((P) => inPoly(x, y, P)); }

const cache = new WeakMap(); // walls array -> roomSpaces (models are never changed in place)

/** roomSpaces(walls), cached per walls array. */
export function spacesOf(walls) {
  if (!walls) return null;
  let sp = cache.get(walls);
  if (!sp) { sp = roomSpaces(walls); cache.set(walls, sp); }
  return sp;
}

/** Net floor area (m²) of the closed space round (x, y), or null. Cached per walls array. */
export function roomAreaAt(walls, x, y) {
  if (!walls) return null;
  return areaAt(spacesOf(walls), x, y);
}

/**
 * The room label at (x, y): within 300mm of its point, or over its text (a
 * name in 230mm monospace with .08em spacing is about 156mm a letter; the area
 * line sits 300mm below). The nearest wins. -> index into rooms, or -1.
 */
export function roomAt(rooms, x, y) {
  let best = -1, bd = Infinity;
  (rooms || []).forEach((r, i) => {
    const dx = Math.abs(x - r.x), dy = y - r.y, hw = Math.max(300, String(r.name || "").length * 78 + 60);
    if (!(dx <= hw && dy >= -300 && dy <= 400)) return;
    const d = hyp(dx, dy);
    if (d <= bd) { bd = d; best = i; }
  });
  return best;
}
