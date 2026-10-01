/* ============================================================================
 * lib/cad/plan.js — Plotwire CAD floor-plan: data model + geometry helpers.
 *
 * Framework-agnostic. Pure functions only — no React, no DOM. This is the
 * single source of truth for the sketch model and the maths the renderer and
 * tools build on. Ported from the design handoff (cad-plan.js).
 *
 * Model space is in MILLIMETRES. Origin top-left, +x right, +y down.
 * ========================================================================= */

// -- Wall thicknesses (mm) --
export const T_EXT = 300;
export const T_INT = 100;

// Default opening widths (mm)
export const DOOR_W = 850;
export const WIN_W = 1200;

/** A new, empty drawing. */
export function emptyDrawing() {
  return { walls: [], doors: [], windows: [], dims: [], rooms: [], notes: [] };
}

// --------------------------- geometry helpers ---------------------------

export function hyp(dx, dy) { return Math.sqrt(dx * dx + dy * dy); }
export function segLen(s) { return hyp(s.x2 - s.x1, s.y2 - s.y1); }
export function snap(v, g) { return Math.round(v / g) * g; }
export function fmtMM(n) { return Math.round(n).toLocaleString("en-GB"); }

/**
 * Wall rectangle polygon, extended by t/2 at each end so perpendicular walls
 * overlap and corners close. Returned as an array of [x,y] points.
 */
export function wallPoly(s, t) {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1, len = hyp(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux, e = t / 2;
  const ax = s.x1 - ux * e, ay = s.y1 - uy * e, bx = s.x2 + ux * e, by = s.y2 + uy * e;
  return [
    [ax + nx * e, ay + ny * e], [bx + nx * e, by + ny * e],
    [bx - nx * e, by - ny * e], [ax - nx * e, ay - ny * e],
  ];
}

/**
 * The two long faces of a wall (parallel offset lines, NO end caps) — drawing
 * only these makes runs read as continuous double lines and corners auto-close.
 * Returns [[a,b],[a,b]] (two segments, each two [x,y] points).
 */
export function wallFaces(s, t) {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1, len = hyp(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux, e = t / 2;
  const ax = s.x1 - ux * e, ay = s.y1 - uy * e, bx = s.x2 + ux * e, by = s.y2 + uy * e;
  return [
    [[ax + nx * e, ay + ny * e], [bx + nx * e, by + ny * e]],
    [[ax - nx * e, ay - ny * e], [bx - nx * e, by - ny * e]],
  ];
}

// --------------------------- joined wall geometry ---------------------------
// Walls are saved as plain centre-line segments. For drawing, each end is
// resolved against its neighbours so the whole wall network renders as ONE
// solid: corners (any angle) are mitred, a wall ending on another wall's side
// is cut to that wall's centre line, and the visible outline is the outline of
// the union of every wall (pieces of an edge hidden inside another wall are
// dropped). Nothing here changes the saved model.

export const NODE_TOL = 12;   // wall ends closer than this (mm) share a corner
const EPS = 0.4;       // outward probe for "is this edge inside another wall"

function lineX(p, d, q, e) {
  // intersection of p + s*d and q + r*e -> point or null when parallel
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-9) return null;
  const s = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + d[0] * s, p[1] + d[1] * s];
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Resolve one end of wall w. `end` 0 = (x1,y1), 1 = (x2,y2).
// Returns { plus, minus, node } where plus/minus are the face corners on the
// +n / -n side (n = u rotated +90deg, u pointing from this end into the wall).
function resolveEnd(w, end, walls) {
  const P = end === 0 ? [w.x1, w.y1] : [w.x2, w.y2];
  const Q = end === 0 ? [w.x2, w.y2] : [w.x1, w.y1];
  const len = hyp(Q[0] - P[0], Q[1] - P[1]) || 1;
  const u = [(Q[0] - P[0]) / len, (Q[1] - P[1]) / len], n = [-u[1], u[0]];
  const e = thicknessFor(w.type) / 2;
  const faceP = [P[0] + n[0] * e, P[1] + n[1] * e], faceM = [P[0] - n[0] * e, P[1] - n[1] * e];
  const flat = { plus: faceP, minus: faceM, node: false };

  // other walls with an end at this point
  const nb = [];
  for (const o of walls) {
    if (o === w) continue;
    for (const oe of [0, 1]) {
      const op = oe === 0 ? [o.x1, o.y1] : [o.x2, o.y2];
      if (hyp(op[0] - P[0], op[1] - P[1]) > NODE_TOL) continue;
      const oq = oe === 0 ? [o.x2, o.y2] : [o.x1, o.y1];
      const ol = hyp(oq[0] - op[0], oq[1] - op[1]);
      if (ol < 1) continue;
      const v = [(oq[0] - op[0]) / ol, (oq[1] - op[1]) / ol];
      nb.push({ p: op, v, m: [-v[1], v[0]], f: thicknessFor(o.type) / 2 });
    }
  }

  if (nb.length) {
    const a0 = Math.atan2(u[1], u[0]), TAU = Math.PI * 2;
    let bestP = null, dP = Infinity, bestM = null, dM = Infinity;
    for (const o of nb) {
      const ai = Math.atan2(o.v[1], o.v[0]);
      const ccw = ((ai - a0) % TAU + TAU) % TAU, cw = ((a0 - ai) % TAU + TAU) % TAU;
      if (ccw > 1e-3 && ccw < dP) { dP = ccw; bestP = o; }
      if (cw > 1e-3 && cw < dM) { dM = cw; bestM = o; }
    }
    const lim = 12 * Math.max(e, ...nb.map((o) => o.f)); // ~10deg before falling back to flat
    const mitre = (face, o, sign, delta) => {
      if (!o || Math.abs(delta - Math.PI) < 1e-3) return face; // straight run: flat
      const q = [o.p[0] + sign * o.m[0] * o.f, o.p[1] + sign * o.m[1] * o.f];
      const x = lineX(face, u, q, o.v);
      if (!x || hyp(x[0] - P[0], x[1] - P[1]) > lim) return face;
      return x;
    };
    // +n face meets the next wall anticlockwise on its -m face; -n meets +m clockwise.
    return { plus: mitre(faceP, bestP, -1, dP), minus: mitre(faceM, bestM, 1, dM), node: true, P };
  }

  // T-junction: this end sits on (or within the thickness of) another wall's body
  let host = null, hd = Infinity;
  for (const o of walls) {
    if (o === w) continue;
    const dx = o.x2 - o.x1, dy = o.y2 - o.y1, l2 = dx * dx + dy * dy;
    if (l2 < 1) continue;
    const tt = ((P[0] - o.x1) * dx + (P[1] - o.y1) * dy) / l2;
    if (tt < 0 || tt > 1) continue;
    const d = Math.abs((P[0] - o.x1) * dy - (P[1] - o.y1) * dx) / Math.sqrt(l2);
    if (d <= thicknessFor(o.type) / 2 + 2 && d < hd) { hd = d; host = o; }
  }
  if (host) {
    const hdv = [host.x2 - host.x1, host.y2 - host.y1];
    const a = lineX(faceP, u, [host.x1, host.y1], hdv), b = lineX(faceM, u, [host.x1, host.y1], hdv);
    const lim = 6 * Math.max(e, thicknessFor(host.type) / 2) + hd;
    if (a && b && hyp(a[0] - P[0], a[1] - P[1]) < lim && hyp(b[0] - P[0], b[1] - P[1]) < lim) return { plus: a, minus: b, node: false };
  }
  return flat;
}

/** Mitred outline polygon for every wall: { [id]: [[x,y],...] }. */
export function joinedWallPolys(walls) {
  const out = {};
  for (const w of walls) {
    if (hyp(w.x2 - w.x1, w.y2 - w.y1) < 1) continue;
    const a = resolveEnd(w, 0, walls), b = resolveEnd(w, 1, walls);
    // n at end 1 is the reverse of n at end 0, so a.plus pairs with b.minus.
    const pts = [a.plus, b.minus];
    if (b.node) pts.push(b.P);
    pts.push(b.plus, a.minus);
    if (a.node) pts.push(a.P);
    out[w.id] = pts;
  }
  return out;
}

/**
 * Outline of the union of all wall polygons, as polylines ready to stroke with
 * mitred joins: [{ pts: [[x,y],...], closed: bool }].
 */
export function wallOutline(polys) {
  const list = Object.values(polys);
  const pieces = [];
  list.forEach((A, ai) => {
    // orientation, so we know which side of each edge is "outside"
    let area = 0;
    for (let i = 0; i < A.length; i++) { const p = A[i], q = A[(i + 1) % A.length]; area += p[0] * q[1] - q[0] * p[1]; }
    const sgn = area > 0 ? 1 : -1;
    for (let i = 0; i < A.length; i++) {
      const p = A[i], q = A[(i + 1) % A.length];
      const d = [q[0] - p[0], q[1] - p[1]], L = hyp(d[0], d[1]);
      if (L < 1e-6) continue;
      const out = [sgn * d[1] / L, -sgn * d[0] / L];
      const ts = [0, 1];
      list.forEach((B, bi) => {
        if (bi === ai) return;
        for (let j = 0; j < B.length; j++) {
          const r = B[j], s = B[(j + 1) % B.length], e = [s[0] - r[0], s[1] - r[1]];
          const den = d[0] * e[1] - d[1] * e[0];
          if (Math.abs(den) < 1e-9) continue;
          const t = ((r[0] - p[0]) * e[1] - (r[1] - p[1]) * e[0]) / den;
          const v = ((r[0] - p[0]) * d[1] - (r[1] - p[1]) * d[0]) / den;
          if (t > 1e-9 && t < 1 - 1e-9 && v >= -1e-9 && v <= 1 + 1e-9) ts.push(t);
        }
      });
      ts.sort((x, y) => x - y);
      for (let k = 0; k < ts.length - 1; k++) {
        if (ts[k + 1] - ts[k] < 1e-7) continue;
        const tm = (ts[k] + ts[k + 1]) / 2;
        const mx = p[0] + d[0] * tm + out[0] * EPS, my = p[1] + d[1] * tm + out[1] * EPS;
        if (list.some((B, bi) => bi !== ai && pointInPoly(mx, my, B))) continue;
        pieces.push([[p[0] + d[0] * ts[k], p[1] + d[1] * ts[k]], [p[0] + d[0] * ts[k + 1], p[1] + d[1] * ts[k + 1]]]);
      }
    }
  });

  // weld piece ends that coincide, then chain into polylines
  const verts = [];
  const vid = (pt) => {
    for (let i = 0; i < verts.length; i++) if (Math.abs(verts[i][0] - pt[0]) < 0.3 && Math.abs(verts[i][1] - pt[1]) < 0.3) return i;
    verts.push(pt); return verts.length - 1;
  };
  const segs = pieces.map(([a, b]) => [vid(a), vid(b)]).filter(([a, b]) => a !== b);
  const at = new Map();
  segs.forEach(([a, b], i) => { [a, b].forEach((v) => { if (!at.has(v)) at.set(v, []); at.get(v).push(i); }); });
  const used = new Array(segs.length).fill(false);
  const next = (v) => (at.get(v) || []).find((i) => !used[i]);
  const paths = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const chain = [segs[i][0], segs[i][1]];
    for (let j; (j = next(chain[chain.length - 1])) !== undefined;) {
      used[j] = true; const [a, b] = segs[j]; chain.push(a === chain[chain.length - 1] ? b : a);
    }
    for (let j; (j = next(chain[0])) !== undefined;) {
      used[j] = true; const [a, b] = segs[j]; chain.unshift(a === chain[0] ? b : a);
    }
    const closed = chain.length > 2 && chain[0] === chain[chain.length - 1];
    if (closed) chain.pop();
    // drop collinear midpoints so joins are only at real corners
    const pts = chain.map((k) => verts[k]).filter((p, k, arr) => {
      if (!closed && (k === 0 || k === arr.length - 1)) return true;
      const a = arr[(k - 1 + arr.length) % arr.length], c = arr[(k + 1) % arr.length];
      return Math.abs((p[0] - a[0]) * (c[1] - p[1]) - (p[1] - a[1]) * (c[0] - p[0])) > 1e-3 * hyp(p[0] - a[0], p[1] - a[1]) * hyp(c[0] - p[0], c[1] - p[1]);
    });
    if (pts.length >= 2) paths.push({ pts, closed });
  }
  return paths;
}

/** SVG path data for wallOutline() output. */
export function outlinePathD(paths, r = (v) => v) {
  return paths.map(({ pts, closed }) => "M" + pts.map((p) => r(p[0]) + " " + r(p[1])).join("L") + (closed ? "Z" : "")).join("");
}

/**
 * All wall polygons as ONE path, every ring wound the same way so overlaps
 * fill under the nonzero rule. One path means no anti-aliasing hairlines
 * where neighbouring walls touch.
 */
export function pocheD(polys, r = (v) => v) {
  return Object.values(polys).map((pts) => {
    let a = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
    const ring = a < 0 ? pts.slice().reverse() : pts;
    return "M" + ring.map((p) => r(p[0]) + " " + r(p[1])).join("L") + "Z";
  }).join("");
}

/** Joined wall polygons + union outline in one call. */
export function joinWalls(walls) {
  const polys = joinedWallPolys(walls || []);
  return { polys, outline: wallOutline(polys) };
}

/**
 * Wall fill style saved with a sketch: "solid" (dark fill) or "light" (grey).
 * Sketches saved before the choice existed have none and stay "light".
 */
export function wallStyleOf(model) { return model && model.wallStyle === "solid" ? "solid" : "light"; }

/** Serialise a list of [x,y] points to an SVG points string. */
export function ptStr(pts) { return pts.map((p) => p[0] + "," + p[1]).join(" "); }

/** Wall thickness for a type. */
export function thicknessFor(type) { return type === "external" ? T_EXT : T_INT; }

/**
 * Nearest wall segment to a world point (mm) — for select hit-testing and for
 * door/window placement. Returns { seg, cx, cy, dist, dir } or null.
 */
export function nearestWall(walls, px, py) {
  let best = null, bestD = Infinity;
  for (const s of walls) {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1, len2 = dx * dx + dy * dy || 1;
    let tt = ((px - s.x1) * dx + (py - s.y1) * dy) / len2;
    tt = Math.max(0, Math.min(1, tt));
    const cx = s.x1 + tt * dx, cy = s.y1 + tt * dy;
    const d = hyp(px - cx, py - cy);
    if (d < bestD) {
      bestD = d;
      best = { seg: s, cx, cy, dist: d, dir: Math.abs(dx) >= Math.abs(dy) ? "h" : "v" };
    }
  }
  return best;
}

/**
 * Select hit-test: the nearest wall counts as a hit if within max(thickness,220mm).
 * Returns { kind:'wall', id } | null.
 */
export function hitTest(walls, px, py) {
  const n = nearestWall(walls, px, py);
  if (!n) return null;
  const tol = Math.max(thicknessFor(n.seg.type), 220);
  return n.dist <= tol ? { kind: "wall", id: n.seg.id } : null;
}

// --------------------------- worked sample (seed / fixture) ---------------------------
// A complete first-floor plan -- kept as a demo seed and as the fidelity fixture
// to check the renderer against reference-floorplan.png.

const EXT = { x0: 150, y0: 150, x1: 8250, y1: 8650 };

export const SAMPLE_PLAN = {
  EXT,
  EXTENT: { w: 8400, h: 8800, margin: 2600 },
  walls: [
    { id: "EW-N", type: "external", x1: EXT.x0, y1: EXT.y0, x2: EXT.x1, y2: EXT.y0 },
    { id: "EW-E", type: "external", x1: EXT.x1, y1: EXT.y0, x2: EXT.x1, y2: EXT.y1 },
    { id: "EW-S", type: "external", x1: EXT.x0, y1: EXT.y1, x2: EXT.x1, y2: EXT.y1 },
    { id: "EW-W", type: "external", x1: EXT.x0, y1: EXT.y0, x2: EXT.x0, y2: EXT.y1 },
    { id: "IW-spine", type: "internal", x1: 4200, y1: 150, x2: 4200, y2: 8650 },
    { id: "IW-L1", type: "internal", x1: 150, y1: 2900, x2: 4200, y2: 2900 },
    { id: "IW-L2", type: "internal", x1: 150, y1: 4150, x2: 4200, y2: 4150 },
    { id: "IW-L3", type: "internal", x1: 150, y1: 5400, x2: 4200, y2: 5400 },
    { id: "IW-R1", type: "internal", x1: 4200, y1: 2600, x2: 8250, y2: 2600 },
    { id: "IW-RV", type: "internal", x1: 6200, y1: 150, x2: 6200, y2: 2600 },
    { id: "IW-R2", type: "internal", x1: 4200, y1: 6100, x2: 8250, y2: 6100 },
  ],
  doors: [
    { id: "DF.01", x: 1100, y: 2900, dir: "h", w: 850, t: T_INT, hinge: -1, fold: 1, ref: "DF.01" },
    { id: "DF.02", x: 1100, y: 4150, dir: "h", w: 850, t: T_INT, hinge: -1, fold: 1, ref: "DF.02" },
    { id: "DF.03", x: 4200, y: 3500, dir: "v", w: 850, t: T_INT, hinge: -1, fold: -1, ref: "DF.03" },
    { id: "DF.04", x: 4200, y: 6800, dir: "v", w: 900, t: T_INT, hinge: 1, fold: -1, ref: "DF.04" },
    { id: "DF.05", x: 5300, y: 2600, dir: "h", w: 800, t: T_INT, hinge: -1, fold: -1, ref: "DF.05" },
    { id: "DF.06", x: 6900, y: 2600, dir: "h", w: 850, t: T_INT, hinge: 1, fold: -1, ref: "DF.06" },
    { id: "DF.07", x: 5100, y: 6100, dir: "h", w: 850, t: T_INT, hinge: -1, fold: 1, ref: "DF.07" },
  ],
  windows: [
    { id: "FW.03", x: 2050, y: 150, dir: "h", w: 1500, t: T_EXT, escape: true, ref: "FW.03" },
    { id: "W-L1", x: 150, y: 1450, dir: "v", w: 1200, t: T_EXT, escape: false, ref: "" },
    { id: "FW.01", x: 2050, y: 8650, dir: "h", w: 1500, t: T_EXT, escape: true, ref: "FW.01" },
    { id: "W-L2", x: 150, y: 6900, dir: "v", w: 1200, t: T_EXT, escape: false, ref: "" },
    { id: "W-R1", x: 8250, y: 1300, dir: "v", w: 1200, t: T_EXT, escape: false, ref: "" },
    { id: "W-R2", x: 8250, y: 7400, dir: "v", w: 1400, t: T_EXT, escape: false, ref: "" },
    { id: "W-S1", x: 6400, y: 8650, dir: "h", w: 1200, t: T_EXT, escape: false, ref: "" },
  ],
  dims: [
    { id: "d-topA", x1: 150, y1: 150, x2: 4200, y2: 150, side: "top", off: 1100 },
    { id: "d-topB", x1: 4200, y1: 150, x2: 8250, y2: 150, side: "top", off: 1100 },
    { id: "d-topAll", x1: 150, y1: 150, x2: 8250, y2: 150, side: "top", off: 1900 },
    { id: "d-leftA", x1: 150, y1: 150, x2: 150, y2: 2900, side: "left", off: 1100 },
    { id: "d-leftB", x1: 150, y1: 2900, x2: 150, y2: 5400, side: "left", off: 1100 },
    { id: "d-leftC", x1: 150, y1: 5400, x2: 150, y2: 8650, side: "left", off: 1100 },
    { id: "d-leftAll", x1: 150, y1: 150, x2: 150, y2: 8650, side: "left", off: 1900 },
    { id: "d-crit", x1: 8250, y1: 150, x2: 8250, y2: 2600, side: "right", off: 700, critical: true },
  ],
  rooms: [
    { name: "Bed 1", area: 11.2, x: 2175, y: 1525 },
    { name: "Dressing", area: 4.7, x: 2750, y: 3450 },
    { name: "En-suite", area: 4.4, x: 2750, y: 4780 },
    { name: "Bed 2", area: 12.8, x: 2175, y: 7025 },
    { name: "Bath", area: 5.6, x: 5200, y: 1375 },
    { name: "Bed 4", area: 6.1, x: 7225, y: 1375 },
    { name: "Landing", area: 9.4, x: 6900, y: 4500 },
    { name: "Bed 3", area: 13.5, x: 6225, y: 7375 },
  ],
  notes: [],
  rooflights: [
    { ref: "RL.01", x: 6450, y: 2820, w: 820, h: 1150, note: "Flat glass roof light" },
    { ref: "RL.02", x: 7380, y: 2820, w: 820, h: 1150, note: "Flat glass roof light" },
  ],
  stairs: { x: 4550, y: 2900, w: 1500, h: 3100, treads: 13, up: "up" },
  boundary: [[60, 60], [4260, 60], [4260, 8740], [60, 8740], [60, 60]],
};
