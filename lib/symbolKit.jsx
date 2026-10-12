/* ============================================================================
 * symbolKit.jsx -- the drawing kit for the Symbol Library's newer symbols.
 *
 * Same 48-unit box, line weights and lettering as lib/symbols.jsx:
 *   - outlines STROKE (1.5), feeder lines and inner detail FEEDER (1.0);
 *   - colour from currentColor (the symbol's body colour) and var(--feeder);
 *   - bold sans lettering for codes.
 *
 * Print safety: the PDF export (components/SheetParts.jsx glyphToPrims) reads
 * only path, line, rect, circle, polyline and polygon shapes plus text, takes
 * each element's own attributes, and ignores transforms and opacity. So these
 * pieces use nothing else: no transform, no ellipse, no opacity, no tspan,
 * and polyline / polygon points are written "x,y x,y". A symbol built from
 * them shows, prints and exports the same; scripts/symbol-library/check.cjs
 * checks every symbol against these rules.
 * ========================================================================= */

"use client";

import React from "react";

export const STROKE = 1.5;
export const FEEDER = 1.0;
export const FONT = "ui-sans-serif, system-ui, sans-serif";

const ink = "currentColor";
const feed = "var(--feeder)";

// Lettering. y is the baseline (no dominant-baseline, as the PDF export expects).
export const Txt = ({ x = 24, y, s = 7, a = "middle", w = 700, fill = ink, children }) => (
  <text x={x} y={y} fontSize={s} textAnchor={a} fill={fill} fontFamily={FONT} fontWeight={w}>{children}</text>
);

// Outline circle.
export const Ring = ({ cx = 24, cy = 24, r = 11, w = STROKE, dash, feeder = false }) => (
  <circle cx={cx} cy={cy} r={r} fill="none" stroke={feeder ? feed : ink} strokeWidth={w} strokeDasharray={dash}/>
);

// Filled circle.
export const Dot = ({ cx = 24, cy = 24, r = 1.6, fill = ink }) => (
  <circle cx={cx} cy={cy} r={r} fill={fill}/>
);

// Rectangle: outline by default, solid with `solid`.
export const Box = ({ x, y, w, h, r = 2.5, sw = STROKE, solid = false, fill, dash, feeder = false }) => (
  solid
    ? <rect x={x} y={y} width={w} height={h} rx={r} fill={fill || ink}/>
    : <rect x={x} y={y} width={w} height={h} rx={r} fill="none" stroke={feeder ? feed : ink} strokeWidth={sw} strokeLinejoin="round" strokeDasharray={dash}/>
);

// Straight line (feeder weight by default).
export const Line = ({ x1, y1, x2, y2, w = FEEDER, feeder = false, dash, fill }) => (
  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={fill || (feeder ? feed : ink)} strokeWidth={w} strokeLinecap="round" strokeDasharray={dash}/>
);

// Path: outline by default, solid with `solid`.
export const Path = ({ d, w = STROKE, solid = false, fill, feeder = false, dash }) => (
  solid
    ? <path d={d} fill={fill || ink}/>
    : <path d={d} fill="none" stroke={feeder ? feed : ink} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash}/>
);

// Open or closed run of straight segments. pts: "x,y x,y ...".
export const Poly = ({ pts, w = STROKE, closed = false, solid = false, fill }) => (
  closed
    ? (solid
      ? <polygon points={pts} fill={fill || ink}/>
      : <polygon points={pts} fill="none" stroke={ink} strokeWidth={w} strokeLinejoin="round"/>)
    : <polyline points={pts} fill="none" stroke={ink} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"/>
);

/* ---- Recurring parts ---------------------------------------------------- */

// Socket outlet: a half disc standing on its flat side at y = base.
export const SocketHalf = ({ cx = 24, base = 28, r = 10, outline = false }) => {
  const d = `M ${cx - r} ${base} A ${r} ${r} 0 0 1 ${cx + r} ${base} Z`;
  return outline ? <Path d={d}/> : <Path d={d} solid/>;
};

// The short feeder stem above a socket.
export const Stem = ({ x = 24, y1 = 20, y2 = 12 }) => <Line x1={x} y1={y1} x2={x} y2={y2} feeder/>;

// Switch: pivot dot and lever, as lib/symbols.jsx draws its switches.
export const Lever = ({ x = 14, y = 28, x2 = 32, y2 = 14, r = 2.6 }) => (
  <g>
    <Dot cx={x} cy={y} r={r}/>
    <Line x1={x} y1={y} x2={x2} y2={y2} w={STROKE}/>
  </g>
);

// Left half of a circle filled: the emergency-luminaire mark.
export const HalfDisc = ({ cx = 24, cy = 24, r = 11 }) => (
  <Path d={`M ${cx} ${cy - r} A ${r} ${r} 0 0 0 ${cx} ${cy + r} Z`} solid/>
);

// A small key (bow, shaft, two teeth) with its bow centred on (x, y).
export const KeyMark = ({ x, y, s = 1 }) => (
  <g>
    <Ring cx={x} cy={y} r={2.2 * s} w={FEEDER}/>
    <Line x1={x + 2.2 * s} y1={y} x2={x + 9 * s} y2={y}/>
    <Line x1={x + 6.5 * s} y1={y} x2={x + 6.5 * s} y2={y + 2.2 * s}/>
    <Line x1={x + 8.8 * s} y1={y} x2={x + 8.8 * s} y2={y + 2.6 * s}/>
  </g>
);

// Arrow from (x1, y1) to (x2, y2) with an open head of length h.
export const Arrow = ({ x1, y1, x2, y2, h = 3, w = FEEDER }) => {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const l = [x2 - h * Math.cos(a - 0.5), y2 - h * Math.sin(a - 0.5)];
  const r = [x2 - h * Math.cos(a + 0.5), y2 - h * Math.sin(a + 0.5)];
  const f = (n) => Math.round(n * 100) / 100;
  return (
    <g>
      <Line x1={x1} y1={y1} x2={x2} y2={y2} w={w}/>
      <Poly pts={`${f(l[0])},${f(l[1])} ${x2},${y2} ${f(r[0])},${f(r[1])}`} w={w}/>
    </g>
  );
};

// Short lines radiating from (cx, cy) between radii r1 and r2, at the given angles (degrees).
export const Rays = ({ cx = 24, cy = 24, r1, r2, angles, w = FEEDER }) => (
  <g>
    {angles.map((deg) => {
      const t = (deg * Math.PI) / 180;
      const f = (n) => Math.round(n * 100) / 100;
      return <Line key={deg} x1={f(cx + r1 * Math.cos(t))} y1={f(cy + r1 * Math.sin(t))} x2={f(cx + r2 * Math.cos(t))} y2={f(cy + r2 * Math.sin(t))} w={w}/>;
    })}
  </g>
);

// Linear luminaire body: a long box with the end bars of the BS lamp mark.
export const LinearBody = ({ x = 4, y = 20, w = 40, h = 8 }) => (
  <g>
    <Box x={x} y={y} w={w} h={h} r={1}/>
    <Line x1={x + 3} y1={y} x2={x + 3} y2={y + h}/>
    <Line x1={x + w - 3} y1={y} x2={x + w - 3} y2={y + h}/>
  </g>
);

// Bulkhead: a pill-shaped body with a bar across it.
export const BulkheadBody = ({ x = 8, y = 15, w = 32, h = 18 }) => (
  <g>
    <Box x={x} y={y} w={w} h={h} r={h / 2}/>
    <Line x1={x + 5} y1={y + h / 2} x2={x + w - 5} y2={y + h / 2} w={STROKE}/>
  </g>
);

// Running-man pictogram for exit signs, about 12 x 16, feet at (x, y).
export const RunningMan = ({ x, y }) => (
  <g>
    <Dot cx={x + 7} cy={y - 14} r={1.9}/>
    <Poly pts={`${x + 6.5},${y - 11.5} ${x + 4.5},${y - 6} ${x + 7.5},${y - 3} ${x + 6.5},${y}`} w={STROKE}/>
    <Poly pts={`${x + 4.5},${y - 6} ${x + 1.5},${y - 3.5} ${x},${y}`} w={STROKE}/>
    <Poly pts={`${x + 2},${y - 9} ${x + 6.5},${y - 11.5} ${x + 10},${y - 8.5}`} w={STROKE}/>
  </g>
);

// Speaker cone: a small box with a flared front, facing right.
export const Speaker = ({ x = 14, y = 18 }) => (
  <g>
    <Box x={x} y={y + 3} w={5} h={6} r={0.5}/>
    <Poly pts={`${x + 5},${y + 3} ${x + 12},${y - 2} ${x + 12},${y + 14} ${x + 5},${y + 9}`} closed/>
  </g>
);

// Wi-fi arcs above a dot at (cx, cy).
export const WifiArcs = ({ cx = 24, cy = 30 }) => (
  <g>
    <Dot cx={cx} cy={cy} r={1.8}/>
    {[5, 9, 13].map((r) => (
      <Path key={r} d={`M ${cx - r * 0.7} ${cy - r * 0.7} A ${r} ${r} 0 0 1 ${cx + r * 0.7} ${cy - r * 0.7}`} w={FEEDER + 0.3}/>
    ))}
  </g>
);

// Small fan: a ring with three blades.
export const Fan = ({ cx = 24, cy = 24, r = 7 }) => (
  <g>
    <Ring cx={cx} cy={cy} r={r} w={FEEDER}/>
    <Dot cx={cx} cy={cy} r={1.2}/>
    {[-90, 30, 150].map((deg) => {
      const t = (deg * Math.PI) / 180, u = ((deg + 50) * Math.PI) / 180;
      const f = (n) => Math.round(n * 100) / 100;
      return <Path key={deg} d={`M ${cx} ${cy} L ${f(cx + (r - 1.2) * Math.cos(t))} ${f(cy + (r - 1.2) * Math.sin(t))} L ${f(cx + (r - 2.5) * Math.cos(u))} ${f(cy + (r - 2.5) * Math.sin(u))} Z`} solid/>;
    })}
  </g>
);

// Lightning flash (for SPDs, rapid charge, etc.), top at (x, y), about 6 x 12.
export const Flash = ({ x, y, s = 1 }) => (
  <Poly pts={`${x + 3.5 * s},${y} ${x},${y + 6.5 * s} ${x + 3 * s},${y + 6.5 * s} ${x + 1.5 * s},${y + 12 * s}`} w={STROKE}/>
);

// Earth mark: a stem and three shortening bars, stem top at (x, y).
export const EarthMark = ({ x = 24, y = 10, s = 1 }) => (
  <g>
    <Line x1={x} y1={y} x2={x} y2={y + 10 * s} w={STROKE}/>
    <Line x1={x - 8 * s} y1={y + 10 * s} x2={x + 8 * s} y2={y + 10 * s} w={STROKE}/>
    <Line x1={x - 5 * s} y1={y + 13.5 * s} x2={x + 5 * s} y2={y + 13.5 * s} w={STROKE}/>
    <Line x1={x - 2 * s} y1={y + 17 * s} x2={x + 2 * s} y2={y + 17 * s} w={STROKE}/>
  </g>
);

// Waves (three short arcs) to the right of (x, y): radio, sound, vibration.
export const Waves = ({ x, y, n = 3, gap = 3 }) => (
  <g>
    {Array.from({ length: n }, (_, i) => {
      const r = 3 + i * gap;
      return <Path key={i} d={`M ${x + r * 0.5} ${y - r * 0.85} A ${r} ${r} 0 0 1 ${x + r * 0.5} ${y + r * 0.85}`} w={FEEDER}/>;
    })}
  </g>
);
