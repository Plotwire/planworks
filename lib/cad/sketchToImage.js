"use client";

/* ============================================================================
 * lib/cad/sketchToImage.js
 *
 * Renders a CAD sketch model to a flat PNG image, for handing to the electrical
 * editor as a plan background (the same kind of background a PDF import yields).
 *
 *  - computeFrame(model)        -> the mm-space box round everything drawn, +
 *                                  a margin. The frame actually rendered is the
 *                                  A3 drawing area at a true scale, centred on
 *                                  it (lib/cad/planScale).
 *  - buildPlanSvg(model, frame, pxW, pxH) -> standalone SVG string. Plan
 *                                  linework only: walls, doors, windows, dims,
 *                                  rooms, notes, stairs, boundary, rooflights.
 *                                  White background, NO grid, NO desk. Inline
 *                                  styles + generic fonts so rasterising never
 *                                  depends on a web font being loaded.
 *  - renderModelToPng(model, frame, longEdgePx) -> { dataUrl, w, h } (browser).
 *
 * Pure geometry mirrors lib/cad/plan + the on-screen renderer exactly, so the
 * image matches what the user drew.
 * ========================================================================= */

import { ptStr, hyp, fmtMM, joinWalls, pocheD, outlinePathD, wallStyleOf } from "@/lib/cad/plan";
import { angled, planCentre, openingSide } from "@/lib/cad/openings";
import { isAuto, areaAt, spacesOf, spaceBoxAt } from "@/lib/cad/rooms";
import { printStyle, printScaleOf, roomLabelLayout } from "@/lib/cad/printStyle";
import { flightsOf, stairDrawing, stairWeights } from "@/lib/cad/stairs";

const INK = "#16212B", POCHE = "#C9D0D8", POCHE_SOLID = "#27313C", DIM = "#2C3E50", CRIT = "#C4564B",
  BND = "#38B24A", NOTE = "#54616E", ROOM = "#2C3E50";

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const n = (v) => Math.round(v * 100) / 100;

// ----- bounding box of everything drawn, + margin. With margin 0 it is the
// plan's content box (lib/cad/planScale), which sets the export frame.
// polys: the walls' joinWalls polys, when the caller already has them.
export function computeFrame(model, margin = 700, polys = null) {
  const xs = [], ys = [];
  const add = (x, y) => { if (isFinite(x) && isFinite(y)) { xs.push(x); ys.push(y); } };
  (model.walls || []).forEach((w) => { add(w.x1, w.y1); add(w.x2, w.y2); });
  (model.doors || []).forEach((d) => { add(d.x - d.w, d.y - d.w); add(d.x + d.w, d.y + d.w); });
  (model.windows || []).forEach((w) => { add(w.x - w.w / 2, w.y - w.w / 2); add(w.x + w.w / 2, w.y + w.w / 2); });
  (model.dims || []).forEach((d) => {
    const o = (d.off || 0) + 400;
    add(Math.min(d.x1, d.x2) - o, Math.min(d.y1, d.y2) - o);
    add(Math.max(d.x1, d.x2) + o, Math.max(d.y1, d.y2) + o);
  });
  (model.rooms || []).forEach((r) => { add(r.x - 400, r.y - 400); add(r.x + 400, r.y + 500); });
  (model.notes || []).forEach((t) => { add(t.x - 400, t.y - 200); add(t.x + 400, t.y + 200); });
  (model.boundary || []).forEach((p) => add(p[0], p[1]));
  if (model.stairs) { const s = model.stairs; add(s.x, s.y); add(s.x + s.w, s.y + s.h); }
  flightsOf(model).forEach((f) => { add(f.x, f.y); add(f.x + f.w, f.y + f.h); });
  (model.rooflights || []).forEach((r) => { add(r.x, r.y); add(r.x + r.w, r.y + r.h); });

  if (!xs.length) return { x: -700, y: -700, w: 9800, h: 10200 };
  let minX = Math.min(...xs) - margin, minY = Math.min(...ys) - margin, maxX = Math.max(...xs) + margin, maxY = Math.max(...ys) + margin;
  // Keep 250mm clear round the mitred wall outline. Only a very sharp corner's
  // point reaches past the normal margin, so ordinary plans come out exactly
  // as before.
  Object.values(polys || joinWalls(model.walls || []).polys).forEach((poly) => poly.forEach(([x, y]) => {
    minX = Math.min(minX, x - 250); minY = Math.min(minY, y - 250);
    maxX = Math.max(maxX, x + 250); maxY = Math.max(maxY, y + 250);
  }));
  return {
    x: Math.round(minX), y: Math.round(minY),
    w: Math.round(maxX - minX), h: Math.round(maxY - minY),
  };
}

// ----- string emitters (mirror the on-screen node renderers) -----
// All walls as one joined solid: mitred corners, T-junctions and crossings
// resolved, outline = the outline of the union (see joinWalls in lib/cad/plan).
// ps (lib/cad/printStyle): walls drawn at least their minimum printed thickness.
function emitWalls(walls, style, ps) {
  if (!walls || !walls.length) return "";
  const { polys, outline } = joinWalls(walls, ps.tf);
  return `<path d="${pocheD(polys, n)}" fill="${style === "solid" ? POCHE_SOLID : POCHE}" fill-rule="nonzero" stroke="none"/>` +
    `<path d="${outlinePathD(outline, n)}" fill="none" stroke="${INK}" stroke-width="${n(ps.outline)}" stroke-linejoin="miter" stroke-miterlimit="12" stroke-linecap="square"/>`;
}

// In an angled wall: the 'h' form about its centre, turned with the wall.
const turned = (o) => `<g transform="translate(${n(o.x)} ${n(o.y)}) rotate(${n(o.ang)})">`;

// ps: the opening is cut to the thickness its wall is drawn at.
function emitDoor(d, ps) {
  if (angled(d)) return turned(d) + emitDoor({ ...d, x: 0, y: 0, dir: "h", ang: undefined }, ps) + `</g>`;
  const { x, y, w } = d, t = ps.opening(d.t), dw = 16;
  let o = "";
  if (d.dir === "h") {
    o += `<rect x="${n(x - w / 2)}" y="${n(y - t / 2)}" width="${n(w)}" height="${n(t)}" fill="#fff" stroke="none"/>`;
    o += `<line x1="${n(x - w / 2)}" y1="${n(y - t / 2)}" x2="${n(x - w / 2)}" y2="${n(y + t / 2)}" stroke="${INK}" stroke-width="${dw}"/>`;
    o += `<line x1="${n(x + w / 2)}" y1="${n(y - t / 2)}" x2="${n(x + w / 2)}" y2="${n(y + t / 2)}" stroke="${INK}" stroke-width="${dw}"/>`;
    const hx = x + d.hinge * w / 2, ey = y + d.fold * w, lx = x - d.hinge * w / 2;
    o += `<line x1="${n(hx)}" y1="${n(y)}" x2="${n(hx)}" y2="${n(ey)}" stroke="${INK}" stroke-width="${dw}"/>`;
    const sweep = (d.hinge * d.fold > 0) ? 1 : 0;
    o += `<path d="M${n(hx)} ${n(ey)} A${n(w)} ${n(w)} 0 0 ${sweep} ${n(lx)} ${n(y)}" fill="none" stroke="${INK}" stroke-width="13" opacity="0.85"/>`;
  } else {
    o += `<rect x="${n(x - t / 2)}" y="${n(y - w / 2)}" width="${n(t)}" height="${n(w)}" fill="#fff" stroke="none"/>`;
    o += `<line x1="${n(x - t / 2)}" y1="${n(y - w / 2)}" x2="${n(x + t / 2)}" y2="${n(y - w / 2)}" stroke="${INK}" stroke-width="${dw}"/>`;
    o += `<line x1="${n(x - t / 2)}" y1="${n(y + w / 2)}" x2="${n(x + t / 2)}" y2="${n(y + w / 2)}" stroke="${INK}" stroke-width="${dw}"/>`;
    const hy = y + d.hinge * w / 2, ex = x + d.fold * w, ly = y - d.hinge * w / 2;
    o += `<line x1="${n(x)}" y1="${n(hy)}" x2="${n(ex)}" y2="${n(hy)}" stroke="${INK}" stroke-width="${dw}"/>`;
    const sweep = (d.hinge * d.fold > 0) ? 0 : 1;
    o += `<path d="M${n(ex)} ${n(hy)} A${n(w)} ${n(w)} 0 0 ${sweep} ${n(x)} ${n(ly)}" fill="none" stroke="${INK}" stroke-width="13" opacity="0.85"/>`;
  }
  return o;
}

// c: planCentre — an angled window's escape label goes on the side facing it.
function emitWindow(wn, c, ps) {
  if (angled(wn)) {
    let o = turned(wn) + emitWindow({ ...wn, x: 0, y: 0, dir: "h", ang: undefined, escape: false }, c, ps);
    if (wn.escape) o += `<text x="0" y="${openingSide(wn, c) * 620}" font-family="monospace" font-size="150" fill="${NOTE}" text-anchor="middle">ESCAPE WINDOW</text>`;
    return o + `</g>`;
  }
  const { x, y, w } = wn, t = ps.opening(wn.t), g6 = t / 6, dw = 16;
  let o = "";
  if (wn.dir === "h") {
    o += `<rect x="${n(x - w / 2)}" y="${n(y - t / 2)}" width="${n(w)}" height="${n(t)}" fill="#fff" stroke="none"/>`;
    [-t / 2, -g6, g6, t / 2].forEach((oy, i) => {
      o += `<line x1="${n(x - w / 2)}" y1="${n(y + oy)}" x2="${n(x + w / 2)}" y2="${n(y + oy)}" stroke="${INK}" stroke-width="${i === 0 || i === 3 ? dw : 11}"/>`;
    });
    o += `<line x1="${n(x - w / 2)}" y1="${n(y - t / 2)}" x2="${n(x - w / 2)}" y2="${n(y + t / 2)}" stroke="${INK}" stroke-width="${dw}"/>`;
    o += `<line x1="${n(x + w / 2)}" y1="${n(y - t / 2)}" x2="${n(x + w / 2)}" y2="${n(y + t / 2)}" stroke="${INK}" stroke-width="${dw}"/>`;
  } else {
    o += `<rect x="${n(x - t / 2)}" y="${n(y - w / 2)}" width="${n(t)}" height="${n(w)}" fill="#fff" stroke="none"/>`;
    [-t / 2, -g6, g6, t / 2].forEach((ox, i) => {
      o += `<line x1="${n(x + ox)}" y1="${n(y - w / 2)}" x2="${n(x + ox)}" y2="${n(y + w / 2)}" stroke="${INK}" stroke-width="${i === 0 || i === 3 ? dw : 11}"/>`;
    });
    o += `<line x1="${n(x - t / 2)}" y1="${n(y - w / 2)}" x2="${n(x + t / 2)}" y2="${n(y - w / 2)}" stroke="${INK}" stroke-width="${dw}"/>`;
    o += `<line x1="${n(x - t / 2)}" y1="${n(y + w / 2)}" x2="${n(x + t / 2)}" y2="${n(y + w / 2)}" stroke="${INK}" stroke-width="${dw}"/>`;
  }
  if (wn.escape) {
    const ty = wn.dir === "h" ? (y < 1000 ? y + 620 : y - 620) : y;
    const tx = wn.dir === "h" ? x : x + (x < 1000 ? 700 : -700);
    o += `<text x="${n(tx)}" y="${n(ty)}" font-family="monospace" font-size="150" fill="${NOTE}" text-anchor="middle">ESCAPE WINDOW</text>`;
  }
  return o;
}

function emitDim(d) {
  const col = d.critical ? CRIT : DIM;
  const len = Math.round(hyp(d.x2 - d.x1, d.y2 - d.y1));
  const gap = 120, over = 160, tick = 130, fs = 185;
  let o = "";
  if (d.side === "top" || d.side === "bottom") {
    const dy = d.side === "top" ? Math.min(d.y1, d.y2) - d.off : Math.max(d.y1, d.y2) + d.off;
    o += `<line x1="${n(d.x1)}" y1="${n(d.y1 + (d.side === "top" ? -gap : gap))}" x2="${n(d.x1)}" y2="${n(dy + (d.side === "top" ? -over : over))}" stroke="${col}" stroke-width="8"/>`;
    o += `<line x1="${n(d.x2)}" y1="${n(d.y2 + (d.side === "top" ? -gap : gap))}" x2="${n(d.x2)}" y2="${n(dy + (d.side === "top" ? -over : over))}" stroke="${col}" stroke-width="8"/>`;
    o += `<line x1="${n(d.x1)}" y1="${n(dy)}" x2="${n(d.x2)}" y2="${n(dy)}" stroke="${col}" stroke-width="11"/>`;
    [d.x1, d.x2].forEach((px) => { o += `<line x1="${n(px - tick)}" y1="${n(dy + tick)}" x2="${n(px + tick)}" y2="${n(dy - tick)}" stroke="${col}" stroke-width="11"/>`; });
    o += `<text x="${n((d.x1 + d.x2) / 2)}" y="${n(dy - 70)}" font-family="monospace" font-size="${fs}" fill="${col}" text-anchor="middle">${esc(fmtMM(len))}</text>`;
  } else {
    const dx = d.side === "left" ? Math.min(d.x1, d.x2) - d.off : Math.max(d.x1, d.x2) + d.off;
    o += `<line x1="${n(d.x1 + (d.side === "left" ? -gap : gap))}" y1="${n(d.y1)}" x2="${n(dx + (d.side === "left" ? -over : over))}" y2="${n(d.y1)}" stroke="${col}" stroke-width="8"/>`;
    o += `<line x1="${n(d.x2 + (d.side === "left" ? -gap : gap))}" y1="${n(d.y2)}" x2="${n(dx + (d.side === "left" ? -over : over))}" y2="${n(d.y2)}" stroke="${col}" stroke-width="8"/>`;
    o += `<line x1="${n(dx)}" y1="${n(d.y1)}" x2="${n(dx)}" y2="${n(d.y2)}" stroke="${col}" stroke-width="11"/>`;
    [d.y1, d.y2].forEach((py) => { o += `<line x1="${n(dx - tick)}" y1="${n(py + tick)}" x2="${n(dx + tick)}" y2="${n(py - tick)}" stroke="${col}" stroke-width="11"/>`; });
    const mx = dx - 70, my = (d.y1 + d.y2) / 2;
    o += `<text x="${n(mx)}" y="${n(my)}" font-family="monospace" font-size="${fs}" fill="${col}" text-anchor="middle" transform="rotate(-90 ${n(mx)} ${n(my)})">${esc(fmtMM(len))}</text>`;
  }
  return o;
}

function emitStair(s) {
  const step = s.h / s.treads, cx = s.x + s.w / 2;
  let o = `<rect x="${n(s.x)}" y="${n(s.y)}" width="${n(s.w)}" height="${n(s.h)}" fill="none" stroke="${INK}" stroke-width="13"/>`;
  for (let k = 1; k < s.treads; k++) o += `<line x1="${n(s.x)}" y1="${n(s.y + k * step)}" x2="${n(s.x + s.w)}" y2="${n(s.y + k * step)}" stroke="${INK}" stroke-width="8" opacity="0.8"/>`;
  o += `<line x1="${n(cx)}" y1="${n(s.y + s.h - 250)}" x2="${n(cx)}" y2="${n(s.y + 250)}" stroke="${INK}" stroke-width="12"/>`;
  o += `<path d="M${n(cx - 140)} ${n(s.y + 520)} L${n(cx)} ${n(s.y + 250)} L${n(cx + 140)} ${n(s.y + 520)}" fill="none" stroke="${INK}" stroke-width="12"/>`;
  o += `<text x="${n(cx + 360)}" y="${n(s.y + s.h / 2)}" font-family="monospace" font-size="165" fill="${NOTE}" text-anchor="middle" transform="rotate(-90 ${n(cx + 360)} ${n(s.y + s.h / 2)})">UP  ${s.treads} RISERS</text>`;
  return o;
}

// Stairs and voids (lib/cad/stairs): the same drawing as on screen, at the
// plan's scale - lines never thinner on paper than at 1:50, the label's
// capitals never under 3 mm.
function emitFlight(f, scale) {
  const d = stairDrawing(f, scale), wt = stairWeights(scale);
  let o = "";
  d.lines.forEach((l) => { o += `<line x1="${n(l.x1)}" y1="${n(l.y1)}" x2="${n(l.x2)}" y2="${n(l.y2)}" stroke="${INK}" stroke-width="${n(wt[l.wt])}" stroke-linecap="square"${l.op ? ` opacity="${l.op}"` : ""}/>`; });
  if (d.head) o += `<path d="M${n(d.head[0][0])} ${n(d.head[0][1])} L${n(d.head[1][0])} ${n(d.head[1][1])} L${n(d.head[2][0])} ${n(d.head[2][1])}" fill="none" stroke="${INK}" stroke-width="${n(wt.arrow)}"/>`;
  if (d.label) { const L = d.label; o += `<text x="${n(L.x)}" y="${n(L.y)}" font-family="monospace" font-size="${n(L.fs)}" fill="${NOTE}" text-anchor="middle" transform="rotate(${n(L.angle)} ${n(L.x)} ${n(L.y)})">${esc(L.text)}</text>`; }
  return o;
}

// scale: the plan's 1:n on the sheet; by default the scale the frame prints at.
export function buildPlanSvg(model, frame, pxW, pxH, { scale = null } = {}) {
  const ps = printStyle(model, scale || printScaleOf(frame));
  let body = "";
  if (model.boundary) body += `<polyline points="${ptStr(model.boundary)}" fill="none" stroke="${BND}" stroke-width="26" stroke-dasharray="150 110"/>`;
  (model.rooflights || []).forEach((rl) => {
    body += `<rect x="${n(rl.x)}" y="${n(rl.y)}" width="${n(rl.w)}" height="${n(rl.h)}" fill="none" stroke="${INK}" stroke-width="10" stroke-dasharray="200 140" opacity="0.6"/>`;
    body += `<text x="${n(rl.x + rl.w / 2)}" y="${n(rl.y + rl.h / 2)}" font-family="monospace" font-size="150" fill="${NOTE}" text-anchor="middle" font-weight="600">${esc(rl.ref)}</text>`;
  });
  body += emitWalls(model.walls, wallStyleOf(model), ps);
  (model.doors || []).forEach((d) => { body += emitDoor(d, ps); });
  const c = planCentre(model.walls);
  (model.windows || []).forEach((w) => { body += emitWindow(w, c, ps); });
  if (model.stairs) body += emitStair(model.stairs);
  flightsOf(model).forEach((f) => { body += emitFlight(f, ps.scale); });
  (model.dims || []).forEach((d) => { body += emitDim(d); });
  // Rooms with auto: true show the area worked out from the walls (lib/cad/rooms), as on screen.
  // Room spaces: auto areas, and how wide each room is for its label.
  const sp = (model.rooms || []).length ? spacesOf(model.walls || []) : null;
  // Names and areas at their printed size (Label size, never under 3 mm
  // capitals), wrapped / stepped down to fit the room (roomLabelLayout).
  (model.rooms || []).forEach((r) => {
    const a = isAuto(r) ? areaAt(sp, r.x, r.y) : r.area ? Number(r.area) : null;
    const L = roomLabelLayout(r.name, a != null ? `${a.toFixed(1)} m\u00B2` : null, ps, spaceBoxAt(sp, r.x, r.y));
    L.lines.forEach((l) => {
      body += `<text x="${n(r.x)}" y="${n(r.y + l.dy)}" font-family="monospace" font-size="${n(L.nameFs)}" fill="${ROOM}" text-anchor="middle" font-weight="600" letter-spacing="${n(L.nameLs)}">${esc(l.text)}</text>`;
    });
    if (L.area) L.area.lines.forEach((l) => {
      body += `<text x="${n(r.x)}" y="${n(r.y + l.dy)}" font-family="monospace" font-size="${n(L.area.fs)}" fill="${NOTE}" text-anchor="middle">${esc(l.text)}</text>`;
    });
  });
  (model.notes || []).forEach((t) => { body += `<text x="${n(t.x)}" y="${n(t.y)}" font-family="monospace" font-size="165" fill="${NOTE}" text-anchor="middle">${esc(t.text)}</text>`; });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pxW}" height="${pxH}" viewBox="${frame.x} ${frame.y} ${frame.w} ${frame.h}">` +
    `<rect x="${frame.x}" y="${frame.y}" width="${frame.w}" height="${frame.h}" fill="#ffffff"/>` +
    body + `</svg>`;
}

// Rasterise to a PNG data URL (browser only).
export function renderModelToPng(model, frame, longEdgePx = 2200, opts = {}) {
  const ar = frame.w / frame.h;
  const pxW = ar >= 1 ? longEdgePx : Math.round(longEdgePx * ar);
  const pxH = ar >= 1 ? Math.round(longEdgePx / ar) : longEdgePx;
  const svg = buildPlanSvg(model, frame, pxW, pxH, opts);
  return new Promise((resolve, reject) => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = pxW; c.height = pxH;
          const ctx = c.getContext("2d");
          ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, pxW, pxH);
          ctx.drawImage(img, 0, 0, pxW, pxH);
          resolve({ dataUrl: c.toDataURL("image/png"), w: pxW, h: pxH });
        } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error("Could not rasterise the plan."));
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    } catch (e) { reject(e); }
  });
}
