// Turn a symbol's React drawing into the shape list ("prims") the PDF export
// draws with lib/symbolPdf.js -- the same thing SheetParts' glyphToPrims reads
// from the browser, worked out from the elements and attributes instead.
// Also reports anything the export can't reproduce (lint()).
const React = require("react");

const SHAPES = new Set(["path", "line", "rect", "circle", "polyline", "polygon", "text"]);
const ALLOWED = new Set([...SHAPES, "g"]);

function colourOf(v, cols) {
  if (v == null) return undefined;
  if (v === "none" || v === "transparent") return null;
  if (v === "currentColor") return cols.body;
  if (v === "var(--feeder)") return cols.feeder;
  if (v === "white") return "#ffffff";
  if (v === "black") return "#000000";
  return v;
}

const textOf = (children) => React.Children.toArray(children).map((c) => (typeof c === "string" || typeof c === "number" ? String(c) : textOf(c?.props?.children))).join("");

// "scale(s) translate(x y)" and friends -> a function on points + a length scale.
function parseTransform(str) {
  let fx = (x, y) => [x, y], k = 1;
  const ops = [...String(str).matchAll(/(\w+)\(([^)]*)\)/g)].map((m) => [m[1], m[2].split(/[\s,]+/).filter(Boolean).map(Number)]);
  // SVG applies the list right to left to the coordinates.
  for (const [op, a] of ops.reverse()) {
    const prev = fx;
    if (op === "translate") fx = (x, y) => { const [px, py] = prev(x, y); return [px + a[0], py + (a[1] || 0)]; };
    else if (op === "scale") { const s = a[0]; k *= s; fx = (x, y) => { const [px, py] = prev(x, y); return [px * s, py * (a[1] ?? s)]; }; }
    else throw new Error("unsupported transform " + op);
  }
  return { fx, k };
}

// Apply a uniform transform to path data (absolute and relative commands).
function transformD(d, { fx, k }) {
  const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  const out = [];
  let i = 0, cmd = "";
  const n = () => Number(toks[i++]);
  const pt = (rel) => { const x = n(), y = n(); if (rel) return [x * k, y * k]; return fx(x, y); };
  const counts = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7, Z: 0 };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) { cmd = toks[i++]; out.push(cmd); if (cmd.toUpperCase() === "Z") continue; }
    const C = cmd.toUpperCase(), rel = cmd !== C;
    if (C === "H") { const x = n(); out.push(rel ? x * k : fx(x, 0)[0]); }
    else if (C === "V") { const y = n(); out.push(rel ? y * k : fx(0, y)[1]); }
    else if (C === "A") { const rx = n(), ry = n(), rot = n(), la = n(), sw = n(); out.push(rx * k, ry * k, rot, la, sw, ...pt(rel)); }
    else { for (let j = 0; j < counts[C] / 2; j++) out.push(...pt(rel)); }
  }
  return out.join(" ");
}

function walk(node, ctx, out, issues) {
  if (node == null || typeof node === "boolean") return;
  if (Array.isArray(node)) { node.forEach((n) => walk(n, ctx, out, issues)); return; }
  if (typeof node === "string" || typeof node === "number") return;
  const { type, props = {} } = node;
  if (type === React.Fragment) { walk(props.children, ctx, out, issues); return; }
  if (typeof type === "function") { walk(type(props), ctx, out, issues); return; }
  if (!ALLOWED.has(type)) issues.push(`<${type}> is not read by the PDF export`);
  for (const bad of ["opacity", "fillOpacity", "strokeOpacity", "style", "className", "letterSpacing", "dominantBaseline"]) {
    if (props[bad] != null) issues.push(`${bad} on <${type}> (the PDF export ignores it)`);
  }
  let tf = ctx.tf;
  if (props.transform) {
    issues.push(`transform on <${type}> (the PDF export ignores transforms)`);
    const t = parseTransform(props.transform);
    tf = tf ? { fx: (x, y) => tf.fx(...t.fx(x, y)), k: tf.k * t.k } : t;
  }
  const c = {
    ...ctx, tf,
    fill: props.fill !== undefined ? colourOf(props.fill, ctx.cols) : ctx.fill,
    stroke: props.stroke !== undefined ? colourOf(props.stroke, ctx.cols) : ctx.stroke,
    strokeWidth: props.strokeWidth != null ? Number(props.strokeWidth) : ctx.strokeWidth,
    dash: props.strokeDasharray != null ? String(props.strokeDasharray).split(/[\s,]+/).map(Number) : ctx.dash,
  };
  if (type === "g" || type === "svg") { walk(props.children, c, out, issues); return; }
  if (!SHAPES.has(type)) return;

  const k = tf ? tf.k : 1;
  const P = (x, y) => (tf ? tf.fx(x, y) : [x, y]);
  const base = {
    fill: c.fill === undefined ? "#000000" : c.fill,
    stroke: c.stroke || null,
    strokeWidth: (c.strokeWidth ?? 1) * k,
    strokeDasharray: c.dash ? c.dash.map((v) => v * k) : null,
    fillOpacity: 1, strokeOpacity: 1,
  };
  if (!base.fill && !base.stroke) return;
  const num = (v) => Number(v) || 0;
  if (type === "path") out.push({ ...base, kind: "path", d: tf ? transformD(props.d, tf) : props.d });
  else if (type === "line") { const [x1, y1] = P(num(props.x1), num(props.y1)); const [x2, y2] = P(num(props.x2), num(props.y2)); out.push({ ...base, kind: "line", x1, y1, x2, y2 }); }
  else if (type === "rect") { const [x, y] = P(num(props.x), num(props.y)); out.push({ ...base, kind: "rect", x, y, w: num(props.width) * k, h: num(props.height) * k, rx: num(props.rx) * k, ry: num(props.ry) * k }); }
  else if (type === "circle") { const [cx, cy] = P(num(props.cx), num(props.cy)); out.push({ ...base, kind: "circle", cx, cy, r: num(props.r) * k }); }
  else if (type === "polyline" || type === "polygon") {
    const raw = String(props.points || "").trim();
    if (!/^(-?[\d.]+,-?[\d.]+)(\s+-?[\d.]+,-?[\d.]+)*$/.test(raw)) issues.push(`<${type}> points must be "x,y x,y" (got "${raw.slice(0, 30)}")`);
    const pts = raw.split(/\s+/).map((p) => p.split(",").map(Number)).filter((p) => p.length === 2).map(([x, y]) => P(x, y));
    out.push({ ...base, kind: type, points: pts });
  } else if (type === "text") {
    for (const a of ["fontSize", "textAnchor", "fontWeight"]) if (props[a] == null) issues.push(`<text> without ${a}`);
    const [x, y] = P(num(props.x), num(props.y));
    out.push({ ...base, stroke: null, kind: "text", text: textOf(props.children), x, y, fontSize: num(props.fontSize || 6) * k, anchor: props.textAnchor || "start", bold: (parseInt(props.fontWeight, 10) || 400) >= 600 });
  }
}

// Shapes for one symbol, in the colours it draws in.
function toPrims(svg, cols) {
  const out = [], issues = [];
  walk(svg, { cols, fill: undefined, stroke: undefined, strokeWidth: undefined, dash: null, tf: null }, out, issues);
  return { prims: out, issues };
}

// Rough extent of the drawing (to catch shapes outside the 48-unit box).
function extent(prims) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y, pad = 0) => { x0 = Math.min(x0, x - pad); y0 = Math.min(y0, y - pad); x1 = Math.max(x1, x + pad); y1 = Math.max(y1, y + pad); };
  for (const p of prims) {
    const pad = p.stroke ? (p.strokeWidth || 1) / 2 : 0;
    if (p.kind === "line") { add(p.x1, p.y1, pad); add(p.x2, p.y2, pad); }
    else if (p.kind === "rect") { add(p.x, p.y, pad); add(p.x + p.w, p.y + p.h, pad); }
    else if (p.kind === "circle") { add(p.cx - p.r, p.cy - p.r, pad); add(p.cx + p.r, p.cy + p.r, pad); }
    else if (p.kind === "polyline" || p.kind === "polygon") p.points.forEach(([x, y]) => add(x, y, pad));
    else if (p.kind === "text") { const w = p.text.length * p.fontSize * 0.6; const left = p.anchor === "middle" ? p.x - w / 2 : p.anchor === "end" ? p.x - w : p.x; add(left, p.y - p.fontSize * 0.75); add(left + w, p.y + p.fontSize * 0.2); }
    else if (p.kind === "path") { const nums = (p.d.match(/-?\d*\.?\d+/g) || []).map(Number); for (let i = 0; i + 1 < nums.length; i += 2) add(nums[i], nums[i + 1], pad); }
  }
  return { x0, y0, x1, y1 };
}

module.exports = { toPrims, extent };
