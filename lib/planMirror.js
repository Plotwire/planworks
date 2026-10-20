/* ============================================================================
 * lib/planMirror.js -- Mirror copy: symbols copied across a mirror line
 * ----------------------------------------------------------------------------
 * For a pair of semis: the symbols laid out in one house, copied mirrored
 * into the other across the party wall. Pure values only -- where the copies
 * go and which way they face; what each symbol is never changes.
 *
 * Symbols are drawn turned `rotation` degrees about their centre (SVG
 * rotate, in sheet units with y down), mirrored left-to-right first when
 * `flip` is set (components/SheetParts symbolGlyph). Mirroring one across a
 * line at angle φ gives the same symbol turned 2φ − rotation + 180 with flip
 * the other way: R(2φ)·Fy·R(θ) = R(2φ − θ + 180)·Fx. So a switch beside a
 * door lands on the other side of its door in the other house, and text in a
 * symbol is drawn the right way round (it never reads backwards).
 * ========================================================================== */

// The line from a towards b: straight up-and-down or across (whichever b is
// nearer) unless `free` (any angle).
export function snapLine(a, b, free = false) {
  if (!a || !b) return b;
  if (free) return { x: b.x, y: b.y };
  return Math.abs(b.x - a.x) < Math.abs(b.y - a.y) ? { x: a.x, y: b.y } : { x: b.x, y: a.y };
}

// Long enough to mirror across (sheet units)?
export const MIN_LINE = 8;
export const lineOk = (a, b) => !!a && !!b && Math.hypot(b.x - a.x, b.y - a.y) >= MIN_LINE;

// A point reflected across the line through a and b.
export function reflectPoint(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
  if (!L) return { x: p.x, y: p.y };
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L;
  const fx = a.x + t * dx, fy = a.y + t * dy;
  return { x: 2 * fx - p.x, y: 2 * fy - p.y };
}

const norm = (deg) => {
  let r = Math.round((((deg % 360) + 360) % 360) * 1000) / 1000;
  if (r >= 360) r -= 360;
  return r;
};

// One symbol mirrored across the line through a and b, as a new item.
export function mirroredItem(item, a, b, id) {
  const q = reflectPoint(item, a, b);
  const phi = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  return { ...item, id, x: q.x, y: q.y, rotation: norm(2 * phi - (item.rotation || 0) + 180), flip: !item.flip };
}

/* The copies of `items` (symbols) across the line through a and b, and of the
 * wires joining two of them (so the layout comes with its links), each with
 * a new id. outside: how many copies would land outside the drawing area
 * (draw { w, h }), which the caller doesn't place. */
export function mirrorCopies(items, wires, a, b, draw, newId, newWireId) {
  const ids = new Map();
  const copies = items.map((it) => {
    const id = newId();
    ids.set(it.id, id);
    return mirroredItem(it, a, b, id);
  });
  const linked = (wires || []).filter((w) => w && ids.has(w.fromId) && ids.has(w.toId))
    .map((w) => ({ ...w, id: newWireId(), fromId: ids.get(w.fromId), toId: ids.get(w.toId) }));
  const outside = copies.filter((c) => c.x < 0 || c.y < 0 || c.x > draw.w || c.y > draw.h).length;
  return { copies, wires: linked, outside };
}

// The symbols whose centres lie in the box (two corners, any order).
export function inBox(items, box) {
  const x0 = Math.min(box.x0, box.x1), x1 = Math.max(box.x0, box.x1);
  const y0 = Math.min(box.y0, box.y1), y1 = Math.max(box.y0, box.y1);
  return items.filter((it) => it.x >= x0 && it.x <= x1 && it.y >= y0 && it.y <= y1);
}
