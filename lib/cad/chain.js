/* ============================================================================
 * lib/cad/chain.js — Plotwire CAD floor-plan: drawing walls as a chain.
 *
 * Pure functions only — no React, no DOM. With Chain walls on, each wall
 * starts exactly where the last one ended (the same numbers, so every corner
 * joins seamlessly) until the run is closed on its first point or ended with
 * Esc. Off, every wall stands alone: the next click starts a new one.
 * ========================================================================= */

import { hyp } from "@/lib/cad/plan";

export const CLOSE_TOL = 1;   // mm: an end this close to the run's first point closes it
export const CLOSE_MIN = 2;   // walls a run needs before the next can close it (a shape has 3+)

/** A new run of walls from p (the first click of a wall): { start, walls }. */
export function startRun(p) { return { start: { x: p.x, y: p.y }, walls: 0 }; }

/**
 * The end point to use for the next wall of `run`, ending at p, with Chain
 * walls on (chain): the run's first point itself when p is within CLOSE_TOL of
 * it and the run already has CLOSE_MIN walls (that wall closes the shape), else p.
 */
export function runEnd(chain, run, p) {
  const s = chain && run && run.walls >= CLOSE_MIN ? run.start : null;
  return s && p && hyp(p.x - s.x, p.y - s.y) <= CLOSE_TOL ? s : p;
}

/**
 * True when an end at p would take the wall in progress straight back over
 * the run's last wall (onto its start): a wall on top of a wall, never meant,
 * and the end snap invites it. Only a chained wall has `prev`, so a wall
 * drawn on its own is never affected.
 */
export function retraces(run, p) {
  const q = run && run.prev;
  return !!(q && p && hyp(p.x - q.x, p.y - q.y) <= CLOSE_TOL);
}

/**
 * After a wall from a to b is placed: { draft, run, closed }. Chain walls on
 * (chain): the next wall starts at b, the same numbers (draft [b]), unless b
 * is the run's first point, which closes the run. Off, or closed: draft [],
 * so the next click starts a new wall wherever it is.
 */
export function afterWall(chain, run, a, b) {
  const r = run || startRun(a);
  const closed = !!chain && r.walls >= CLOSE_MIN && b.x === r.start.x && b.y === r.start.y;
  if (!chain || closed) return { draft: [], run: null, closed };
  return { draft: [{ x: b.x, y: b.y }], run: { start: r.start, walls: r.walls + 1, prev: { x: a.x, y: a.y } }, closed: false };
}
