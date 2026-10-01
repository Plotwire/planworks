/* ============================================================================
 * lib/cad/openings.js — Plotwire CAD floor-plan: doors and windows in walls.
 *
 * Pure functions only — no React, no DOM. An opening in a wall within
 * SQUARE_TOL of horizontal / vertical has today's shape ({ dir: 'h'|'v' }).
 * In an angled wall it is the 'h' form drawn about its centre and turned by
 * `ang` (degrees, -90..90], so its hinge / fold are in the wall's own frame.
 * Nothing here touches an opening that isn't being placed or edited.
 * ========================================================================= */

import { hyp, snap, thicknessFor, resolveEnd } from "@/lib/cad/plan";

export const SQUARE_TOL = 0.5;  // deg: a wall this close to h / v takes square openings

const RAD = Math.PI / 180;
const r3 = (v) => Math.round(v * 1000) / 1000;
const dot = (p, q) => p[0] * q[0] + p[1] * q[1];

/** Is this opening drawn turned (it has an angle)? */
export function angled(o) { return !!o && typeof o.ang === "number" && isFinite(o.ang); }

/** An angle in degrees normalised to (-90, 90] and rounded to 0.01deg. */
export function normAng(deg) {
  let a = deg % 180;
  if (a > 90) a -= 180; else if (a <= -90) a += 180;
  a = Math.round(a * 100) / 100;
  if (a <= -90) a += 180;
  return a + 0; // never -0
}

/** A wall's direction in degrees (x1,y1 -> x2,y2; +y down). */
export function wallDeg(w) { return Math.atan2(w.y2 - w.y1, w.x2 - w.x1) / RAD; }

/** 'h' / 'v' for a wall within SQUARE_TOL of horizontal / vertical, else null (angled). */
export function squareAxis(w) {
  const a = ((wallDeg(w) % 180) + 180) % 180;
  if (a <= SQUARE_TOL || a >= 180 - SQUARE_TOL) return "h";
  return Math.abs(a - 90) <= SQUARE_TOL ? "v" : null;
}

/** How an opening sits in wall w: { dir } in a square wall, { dir: 'h', ang } in an angled one. */
export function openingShape(w) {
  const ax = squareAxis(w);
  return ax ? { dir: ax } : { dir: "h", ang: normAng(wallDeg(w)) };
}

/**
 * Where an opening of width ow sits along wall w for the point (px,py): its
 * centre's distance s from (x1,y1), clamped so the whole opening stays in
 * the wall, clear of the walls joined at its ends (ins, from endInsets);
 * centred in what's left when that is shorter. grid > 0 snaps the gap to the
 * nearer end to that step. -> { s, L, gap } (gap: nearer edge to that end).
 */
export function alongWall(w, px, py, ow, grid = 0, ins = null) {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1, L = hyp(dx, dy), half = (ow || 0) / 2;
  const a = (ins ? ins[0] : 0) + half, b = L - (ins ? ins[1] : 0) - half; // where the centre may go
  if (b <= a || L < 1e-9) return { s: Math.max(0, Math.min(L, (a + b) / 2)), L, gap: 0 };
  const fit = (v) => Math.max(a, Math.min(b, v));
  let s = fit(((px - w.x1) * dx + (py - w.y1) * dy) / L);
  if (grid > 0) {
    const g1 = s - a, g2 = b - s;
    s = fit(g1 <= g2 ? a + snap(g1, grid) : b - snap(g2, grid));
  }
  return { s, L, gap: Math.min(s - a, b - s) };
}

/**
 * How far in from each end of wall w an opening must stay so it doesn't cut
 * into the walls joined there: at a corner, past both of the wall's mitred
 * face corners (lib/cad/plan resolveEnd, exactly as drawn); at a T, past the
 * face of the wall it ends on; a free end, 0. -> [from (x1,y1), from (x2,y2)] in mm.
 */
export function endInsets(walls, w) {
  const L = hyp(w.x2 - w.x1, w.y2 - w.y1), e = thicknessFor(w.type) / 2;
  if (!walls || L < 1) return [0, 0];
  return [0, 1].map((end) => {
    const P = end === 0 ? [w.x1, w.y1] : [w.x2, w.y2], k = end === 0 ? 1 / L : -1 / L;
    const u = [(w.x2 - w.x1) * k, (w.y2 - w.y1) * k], n = [-u[1], u[0]]; // u: from this end into the wall
    const r = resolveEnd(w, end, walls), along = (p) => (p[0] - P[0]) * u[0] + (p[1] - P[1]) * u[1];
    if (r.node) return Math.max(0, along(r.plus), along(r.minus));
    let h = null, hd = Infinity;
    for (const o of walls) {
      if (o === w || o.id === w.id) continue;
      const dx = o.x2 - o.x1, dy = o.y2 - o.y1, l2 = dx * dx + dy * dy;
      if (l2 < 1) continue;
      const tt = ((P[0] - o.x1) * dx + (P[1] - o.y1) * dy) / l2, d = Math.abs((P[0] - o.x1) * dy - (P[1] - o.y1) * dx) / Math.sqrt(l2);
      if (tt >= 0 && tt <= 1 && d <= thicknessFor(o.type) / 2 + 2 && d < hd) { hd = d; h = o; }
    }
    if (!h) return 0;
    const hl = hyp(h.x2 - h.x1, h.y2 - h.y1), N = [-(h.y2 - h.y1) / hl, (h.x2 - h.x1) / hl], un = dot(u, N);
    if (Math.abs(un) < 0.1) return 0;
    // This wall's faces (P + u*s +- n*e) reach the host's face on this wall's side.
    const f = thicknessFor(h.type) / 2, side = un > 0 ? f : -f, dP = (P[0] - h.x1) * N[0] + (P[1] - h.y1) * N[1], nn = dot(n, N);
    const x = Math.max((side - dP - e * nn) / un, (side - dP + e * nn) / un);
    return Math.max(0, Math.min(x, 6 * Math.max(e, f) + hd));
  });
}

// The point s along wall w, rounded as a placed opening is: whole mm in a
// square wall (as placement always did), 0.001mm in an angled one.
function pointAt(w, s, square) {
  const L = hyp(w.x2 - w.x1, w.y2 - w.y1) || 1;
  const x = w.x1 + (w.x2 - w.x1) * s / L, y = w.y1 + (w.y2 - w.y1) * s / L;
  return square ? [Math.round(x), Math.round(y)] : [r3(x), r3(y)];
}

/**
 * A new opening of width ow in wall w, nearest (px,py) and clear of the walls
 * joined at its ends (walls: the plan's walls, see endInsets):
 * { x, y, dir } or { x, y, dir: 'h', ang }.
 */
export function placeOpening(w, px, py, ow, walls = null) {
  const sh = openingShape(w), [x, y] = pointAt(w, alongWall(w, px, py, ow, 0, endInsets(walls, w)).s, !angled(sh));
  return { x, y, ...sh };
}

// An opening's axes on the page: H along the wall (hinge), F across it (fold).
function axes(o) {
  if (angled(o)) { const a = o.ang * RAD; return [[Math.cos(a), Math.sin(a)], [-Math.sin(a), Math.cos(a)]]; }
  return o.dir === "h" ? [[1, 0], [0, 1]] : [[0, 1], [1, 0]];
}

/**
 * The wall an opening sits in: the nearest one whose centre line it lies on
 * (within the wall's length and half its thickness + 20mm). null if none.
 * Walls within 1mm of the nearest (an old door centred on a corner) are a
 * tie: the one the opening is turned along wins, then one as thick as it.
 */
export function openingHost(walls, o) {
  const H = axes(o)[0], c = [];
  for (const w of walls) {
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1, l2 = dx * dx + dy * dy;
    if (l2 < 1) continue;
    const tt = ((o.x - w.x1) * dx + (o.y - w.y1) * dy) / l2;
    if (tt < 0 || tt > 1) continue;
    const t = thicknessFor(w.type), L = Math.sqrt(l2), d = Math.abs((o.x - w.x1) * dy - (o.y - w.y1) * dx) / L;
    if (d <= t / 2 + 20) c.push({ w, d, off: Math.abs(H[0] * dy - H[1] * dx) / L, thin: t === o.t ? 0 : 1 });
  }
  if (!c.length) return null;
  const dm = Math.min(...c.map((k) => k.d));
  let b = null;
  for (const k of c) {
    if (k.d > dm + 1) continue;
    if (!b || k.off < b.off - 0.02 || (Math.abs(k.off - b.off) <= 0.02 && (k.thin < b.thin || (k.thin === b.thin && k.d < b.d)))) b = k;
  }
  return b.w;
}

/**
 * Opening o given shape sh ({ dir } or { dir, ang }) after its wall turned
 * rot degrees: a door's hinge and fold are flipped as needed so it keeps its
 * hinged end and opens into the same room. Returns o itself if nothing changes.
 */
export function reorient(o, sh, rot = 0) {
  const [H0, F0] = axes(o), [H1, F1] = axes(sh), c = Math.cos(rot * RAD), s = Math.sin(rot * RAD);
  const side = (v, n, k) => (typeof k === "number" && dot([v[0] * c - v[1] * s, v[0] * s + v[1] * c], n) < -1e-9 ? -k : k);
  const hinge = side(H0, H1, o.hinge), fold = side(F0, F1, o.fold), ang = angled(sh) ? sh.ang : undefined;
  if (sh.dir === o.dir && ang === o.ang && hinge === o.hinge && fold === o.fold) return o;
  const out = { ...o, dir: sh.dir };
  if (ang === undefined) delete out.ang; else out.ang = ang;
  if ("hinge" in o) out.hinge = hinge;
  if ("fold" in o) out.fold = fold;
  return out;
}

/**
 * Slide opening `id` (kind 'door' | 'window') along wall `host` to the point
 * nearest (px,py), kept inside the wall and clear of the walls joined at its
 * ends; grid > 0 snaps its gap to the nearer end. It takes the wall's shape
 * (hinge / fold kept on the same sides). (px,py) no further along the wall
 * than the opening (under 0.5mm) leaves it exactly as it is. -> { model, gap };
 * model is the same object when nothing changed.
 */
export function slideOpening(model, kind, id, host, px, py, grid = 0) {
  const key = kind === "door" ? "doors" : "windows", list = model[key] || [], i = list.findIndex((o) => o.id === id);
  if (i < 0) return { model, gap: 0 };
  const o = list[i], ins = endInsets(model.walls, host), L = hyp(host.x2 - host.x1, host.y2 - host.y1) || 1;
  if (Math.abs(((px - o.x) * (host.x2 - host.x1) + (py - o.y) * (host.y2 - host.y1)) / L) < 0.5) return { model, gap: alongWall(host, o.x, o.y, o.w, 0, ins).gap };
  const sh = openingShape(host), r = alongWall(host, px, py, o.w, grid, ins);
  const [x, y] = pointAt(host, r.s, !angled(sh)), o2 = reorient(o, sh), gap = alongWall(host, x, y, o.w, 0, ins).gap; // gap where it really lands
  if (x === o.x && y === o.y && o2 === o) return { model, gap };
  const next = list.slice();
  next[i] = { ...o2, x, y };
  return { model: { ...model, [key]: next }, gap };
}

/** Middle of the walls' extents (angled openings label towards it), or null. */
export function planCentre(walls) {
  if (!walls || !walls.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const w of walls) {
    x0 = Math.min(x0, w.x1, w.x2); y0 = Math.min(y0, w.y1, w.y2);
    x1 = Math.max(x1, w.x1, w.x2); y1 = Math.max(y1, w.y1, w.y2);
  }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

/**
 * Side of an angled window its escape label and tag go: +1 = its local +y
 * (below the wall for the 'h' form), -1 = local -y. The side facing c
 * (planCentre), so they read inside the building; +1 if c is on the line.
 */
export function openingSide(o, c) {
  if (!c || !angled(o)) return 1;
  const a = o.ang * RAD;
  return (c.x - o.x) * -Math.sin(a) + (c.y - o.y) * Math.cos(a) < -1 ? -1 : 1;
}
