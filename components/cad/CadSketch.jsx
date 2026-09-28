"use client";

/* ============================================================================
 * components/cad/CadSketch.jsx - CAD floor-plan sketch screen.
 *
 * Stage 3 (chunk 1): tool rail + external/internal WALL drawing with ortho
 * lock, grid snap, live length read-out and snap cursor; plus select / delete /
 * convert and the contextual inspector + status bar. Built on the verified
 * engine (lib/cad/plan) and renderer. Still its own isolated /sketch screen.
 * ========================================================================= */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  T_EXT, T_INT, DOOR_W, WIN_W, wallPoly, wallFaces, ptStr, hyp, segLen, snap, fmtMM,
  nearestWall, hitTest, SAMPLE_PLAN,
} from "@/lib/cad/plan";
import { listSketches, getSketchData, insertSketch, updateSketch, deleteSketch } from "@/lib/cad/sketchStore";
import { insertProject, getProjectData, updateProjectRow } from "@/lib/db";
import { uploadPlanImage, dataUrlToBlob } from "@/lib/planImages";
import { computeFrame, renderModelToPng } from "@/lib/cad/sketchToImage";
import { isTouchDevice } from "@/lib/touch";

// A composited layer for a canvas this size rasterises at reduced resolution on
// iOS Safari, which is why doing the zoom as an SVG <g> transform here was no
// sharper than the sheet's CSS transform. Off on touch: full resolution beats
// smooth panning on a drawing.
const PROMOTE = isTouchDevice() ? "auto" : "transform";

const SHEET = { x: -6000, y: -6000, w: 28000, h: 28000 };
const SCALE_MIN = 0.02, SCALE_MAX = 0.6;

// ------------------------- node renderers -------------------------
function WallNode({ s, selected }) {
  const t = s.type === "external" ? T_EXT : T_INT;
  const cls = selected ? "cadv-sel" : "cadv-ink";
  const sw = selected ? 2 : (s.type === "external" ? 1.4 : 1.1);
  return (
    <g>
      <polygon points={ptStr(wallPoly(s, t))} className="cadv-poche" stroke="none" />
      {wallFaces(s, t).map((f, i) => (
        <line key={i} x1={f[0][0]} y1={f[0][1]} x2={f[1][0]} y2={f[1][1]}
          className={cls} strokeWidth={sw} vectorEffect="non-scaling-stroke" strokeLinecap="square" />
      ))}
    </g>
  );
}

function DoorNode({ d, selected }) {
  const { x, y, w, t } = d;
  const ink = selected ? "cadv-sel" : "cadv-ink";
  const els = [];
  if (d.dir === "h") {
    els.push(<rect key="e" x={x - w / 2} y={y - t / 2} width={w} height={t} className="cadv-paper" stroke="none" />);
    els.push(<line key="j1" x1={x - w / 2} y1={y - t / 2} x2={x - w / 2} y2={y + t / 2} className={ink} strokeWidth={1.1} vectorEffect="non-scaling-stroke" />);
    els.push(<line key="j2" x1={x + w / 2} y1={y - t / 2} x2={x + w / 2} y2={y + t / 2} className={ink} strokeWidth={1.1} vectorEffect="non-scaling-stroke" />);
    const hx = x + d.hinge * w / 2, ex = hx, ey = y + d.fold * w, lx = x - d.hinge * w / 2;
    els.push(<line key="lf" x1={hx} y1={y} x2={ex} y2={ey} className={ink} strokeWidth={1.1} vectorEffect="non-scaling-stroke" />);
    const sweep = (d.hinge * d.fold > 0) ? 1 : 0;
    els.push(<path key="ar" d={`M${ex} ${ey} A${w} ${w} 0 0 ${sweep} ${lx} ${y}`} className={ink} fill="none" strokeWidth={0.9} vectorEffect="non-scaling-stroke" opacity={0.85} />);
  } else {
    els.push(<rect key="e" x={x - t / 2} y={y - w / 2} width={t} height={w} className="cadv-paper" stroke="none" />);
    els.push(<line key="j1" x1={x - t / 2} y1={y - w / 2} x2={x + t / 2} y2={y - w / 2} className={ink} strokeWidth={1.1} vectorEffect="non-scaling-stroke" />);
    els.push(<line key="j2" x1={x - t / 2} y1={y + w / 2} x2={x + t / 2} y2={y + w / 2} className={ink} strokeWidth={1.1} vectorEffect="non-scaling-stroke" />);
    const hy = y + d.hinge * w / 2, ey2 = hy, ex2 = x + d.fold * w, ly = y - d.hinge * w / 2;
    els.push(<line key="lf" x1={x} y1={hy} x2={ex2} y2={ey2} className={ink} strokeWidth={1.1} vectorEffect="non-scaling-stroke" />);
    const sweep2 = (d.hinge * d.fold > 0) ? 0 : 1;
    els.push(<path key="ar" d={`M${ex2} ${ey2} A${w} ${w} 0 0 ${sweep2} ${x} ${ly}`} className={ink} fill="none" strokeWidth={0.9} vectorEffect="non-scaling-stroke" opacity={0.85} />);
  }
  return <g>{els}</g>;
}

function WindowNode({ wn, selected }) {
  const { x, y, w, t } = wn, g6 = t / 6, els = [];
  const ink = selected ? "cadv-sel" : "cadv-ink";
  if (wn.dir === "h") {
    els.push(<rect key="e" x={x - w / 2} y={y - t / 2} width={w} height={t} className="cadv-paper" stroke="none" />);
    [-t / 2, -g6, g6, t / 2].forEach((oy, i) =>
      els.push(<line key={"g" + i} x1={x - w / 2} y1={y + oy} x2={x + w / 2} y2={y + oy} className={ink} strokeWidth={i === 0 || i === 3 ? 1.1 : 0.8} vectorEffect="non-scaling-stroke" />));
    els.push(<line key="j1" x1={x - w / 2} y1={y - t / 2} x2={x - w / 2} y2={y + t / 2} className={ink} strokeWidth={1.1} vectorEffect="non-scaling-stroke" />);
    els.push(<line key="j2" x1={x + w / 2} y1={y - t / 2} x2={x + w / 2} y2={y + t / 2} className={ink} strokeWidth={1.1} vectorEffect="non-scaling-stroke" />);
  } else {
    els.push(<rect key="e" x={x - t / 2} y={y - w / 2} width={t} height={w} className="cadv-paper" stroke="none" />);
    [-t / 2, -g6, g6, t / 2].forEach((ox, i) =>
      els.push(<line key={"g" + i} x1={x + ox} y1={y - w / 2} x2={x + ox} y2={y + w / 2} className={ink} strokeWidth={i === 0 || i === 3 ? 1.1 : 0.8} vectorEffect="non-scaling-stroke" />));
    els.push(<line key="j1" x1={x - t / 2} y1={y - w / 2} x2={x + t / 2} y2={y - w / 2} className={ink} strokeWidth={1.1} vectorEffect="non-scaling-stroke" />);
    els.push(<line key="j2" x1={x - t / 2} y1={y + w / 2} x2={x + t / 2} y2={y + w / 2} className={ink} strokeWidth={1.1} vectorEffect="non-scaling-stroke" />);
  }
  if (wn.escape) {
    const ty = wn.dir === "h" ? (y < 1000 ? y + 620 : y - 620) : y;
    els.push(<text key="esc" x={wn.dir === "h" ? x : x + (x < 1000 ? 700 : -700)} y={ty} className="cadv-note" fontSize={150} textAnchor="middle">ESCAPE WINDOW</text>);
  }
  return <g>{els}</g>;
}

function DimNode({ d }) {
  const crit = d.critical, lineCls = crit ? "cadv-dim-crit" : "cadv-dim";
  const txtCls = "cadv-dim-txt" + (crit ? " crit" : "");
  const len = Math.round(hyp(d.x2 - d.x1, d.y2 - d.y1));
  const gap = 120, over = 160, tick = 130, fs = 185, els = [];
  if (d.side === "top" || d.side === "bottom") {
    const dy = d.side === "top" ? Math.min(d.y1, d.y2) - d.off : Math.max(d.y1, d.y2) + d.off;
    els.push(<line key="e1" x1={d.x1} y1={d.y1 + (d.side === "top" ? -gap : gap)} x2={d.x1} y2={dy + (d.side === "top" ? -over : over)} className={lineCls} strokeWidth={0.7} vectorEffect="non-scaling-stroke" />);
    els.push(<line key="e2" x1={d.x2} y1={d.y2 + (d.side === "top" ? -gap : gap)} x2={d.x2} y2={dy + (d.side === "top" ? -over : over)} className={lineCls} strokeWidth={0.7} vectorEffect="non-scaling-stroke" />);
    els.push(<line key="dl" x1={d.x1} y1={dy} x2={d.x2} y2={dy} className={lineCls} strokeWidth={0.9} vectorEffect="non-scaling-stroke" />);
    [d.x1, d.x2].forEach((px, k) =>
      els.push(<line key={"t" + k} x1={px - tick} y1={dy + tick} x2={px + tick} y2={dy - tick} className={lineCls} strokeWidth={0.9} vectorEffect="non-scaling-stroke" />));
    els.push(<text key="tx" x={(d.x1 + d.x2) / 2} y={dy - 70} className={txtCls} fontSize={fs} textAnchor="middle">{fmtMM(len)}</text>);
  } else {
    const dx = d.side === "left" ? Math.min(d.x1, d.x2) - d.off : Math.max(d.x1, d.x2) + d.off;
    els.push(<line key="e1" x1={d.x1 + (d.side === "left" ? -gap : gap)} y1={d.y1} x2={dx + (d.side === "left" ? -over : over)} y2={d.y1} className={lineCls} strokeWidth={0.7} vectorEffect="non-scaling-stroke" />);
    els.push(<line key="e2" x1={d.x2 + (d.side === "left" ? -gap : gap)} y1={d.y2} x2={dx + (d.side === "left" ? -over : over)} y2={d.y2} className={lineCls} strokeWidth={0.7} vectorEffect="non-scaling-stroke" />);
    els.push(<line key="dl" x1={dx} y1={d.y1} x2={dx} y2={d.y2} className={lineCls} strokeWidth={0.9} vectorEffect="non-scaling-stroke" />);
    [d.y1, d.y2].forEach((py, k) =>
      els.push(<line key={"t" + k} x1={dx - tick} y1={py + tick} x2={dx + tick} y2={py - tick} className={lineCls} strokeWidth={0.9} vectorEffect="non-scaling-stroke" />));
    els.push(<text key="tx" x={dx - 70} y={(d.y1 + d.y2) / 2} className={txtCls} fontSize={fs} textAnchor="middle" transform={`rotate(-90 ${dx - 70} ${(d.y1 + d.y2) / 2})`}>{fmtMM(len)}</text>);
  }
  return <g>{els}</g>;
}

function StairNode({ s }) {
  const els = [], step = s.h / s.treads, cx = s.x + s.w / 2;
  els.push(<rect key="box" x={s.x} y={s.y} width={s.w} height={s.h} fill="none" className="cadv-ink" strokeWidth={1} vectorEffect="non-scaling-stroke" />);
  for (let k = 1; k < s.treads; k++)
    els.push(<line key={"tr" + k} x1={s.x} y1={s.y + k * step} x2={s.x + s.w} y2={s.y + k * step} className="cadv-ink" strokeWidth={0.7} vectorEffect="non-scaling-stroke" opacity={0.8} />);
  els.push(<line key="al" x1={cx} y1={s.y + s.h - 250} x2={cx} y2={s.y + 250} className="cadv-ink" strokeWidth={1} vectorEffect="non-scaling-stroke" />);
  els.push(<path key="ah" d={`M${cx - 140} ${s.y + 520} L${cx} ${s.y + 250} L${cx + 140} ${s.y + 520}`} fill="none" className="cadv-ink" strokeWidth={1} vectorEffect="non-scaling-stroke" />);
  els.push(<text key="up" x={cx + 360} y={s.y + s.h / 2} className="cadv-note" fontSize={165} textAnchor="middle" transform={`rotate(-90 ${cx + 360} ${s.y + s.h / 2})`}>{"UP  " + s.treads + " RISERS"}</text>);
  return <g>{els}</g>;
}

function Tag({ refTxt, x, y }) {
  return (
    <g>
      <rect x={x - 195} y={y - 130} width={390} height={250} rx={26} fill="#FFFFFF" className="cadv-ink" strokeWidth={0.8} vectorEffect="non-scaling-stroke" opacity={0.92} />
      <text x={x} y={y + 50} className="cadv-tag-txt" fontSize={145} textAnchor="middle" fontWeight={600}>{refTxt}</text>
    </g>
  );
}

// tool rail glyphs
function Glyph({ name }) {
  const paths = {
    select: <path d="M5 4l14 6-6 2-2 6z" />,
    ext: <g><path d="M4 8h16M4 16h16" /></g>,
    int: <g><path d="M4 9h16M4 15h16" /></g>,
    door: <g><path d="M5 20V5h7" /><path d="M12 5a8 8 0 0 1 8 8" /></g>,
    window: <g><rect x="4" y="7" width="16" height="10" /><path d="M4 12h16M12 7v10" /></g>,
    dim: <g><path d="M4 12h16M4 9v6M20 9v6" /></g>,
    room: <path d="M4 8h11l4 4-4 4H4z" />,
    text: <g><path d="M5 6h14M12 6v12" /></g>,
    pan: <path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V10m0-1.5a1.5 1.5 0 0 1 3 0V11m0-.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-2.5-4a1.6 1.6 0 0 1 2.7-1.6L9 14" />,
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === "ext" ? 2.4 : name === "int" ? 1.4 : 1.7} strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}>
      {paths[name]}
    </svg>
  );
}

const TOOLS = [
  ["select", "Select", "V"],
  ["ext", "External wall", "E"],
  ["int", "Internal wall", "I"],
  ["door", "Door", "D"],
  ["window", "Window", "W"],
  ["dim", "Dimension", "M"],
  ["room", "Room label", "R"],
  ["text", "Note", "T"],
  ["pan", "Pan", "H"],
];

const LAYER_LIST = [
  ["walls", "Walls"],
  ["openings", "Doors & windows"],
  ["dims", "Dimensions"],
  ["rooms", "Rooms & notes"],
  ["stairs", "Stairs & fittings"],
  ["boundary", "Site boundary"],
  ["grid", "Grid"],
];

const SAVE_LABEL = { idle: "Not saved", unsaved: "Unsaved changes", saving: "Saving...", saved: "Saved", error: "Save failed" };

// ------------------------- main screen -------------------------
export default function CadSketch({ title = "Maple House \u2014 First floor", ref: codeRef = "PW-0247", openSketchId = null, linkProject = null, linkSheet = null, linkName = null, embedded = false, onClose = null, onApplyPlan = null }) {
  const router = useRouter();
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const gridRef = useRef(null);
  const panRef = useRef(null);
  const viewRef = useRef(null);
  const gRef = useRef(null);
  const pointersRef = useRef(new Map());
  const pinchRef = useRef(null);
  const pinchActiveRef = useRef(false);
  const livePinchRef = useRef(null);
  const suppressClickRef = useRef(false);

  const [model, setModel] = useState(() => ({ EXTENT: { w: 8400, h: 8800, margin: 2600 }, walls: [], doors: [], windows: [], dims: [], rooms: [], notes: [], boundary: null, rooflights: [], stairs: null }));
  const [tool, setTool] = useState("select");
  const [view, setView] = useState({ s: 0.08, tx: 200, ty: 200 });
  const [draftPts, setDraftPts] = useState([]);
  const [cur, setCur] = useState({ x: 0, y: 0, sx: -99, sy: -99, on: false });
  const [sel, setSel] = useState(null);
  const [dimP1, setDimP1] = useState(null);
  const [settings, setSettings] = useState({ grid: 100, doorW: DOOR_W, winW: WIN_W });
  const [flags, setFlags] = useState({ ortho: true, gridSnap: true });
  const [layers, setLayers] = useState({ walls: true, openings: true, dims: true, rooms: true, stairs: true, boundary: true, grid: true });
  const [size, setSize] = useState({ w: 900, h: 600 });
  const [sketchId, setSketchId] = useState(null);
  const [sketchName, setSketchName] = useState(linkName || "");
  const [saveState, setSaveState] = useState("idle");
  const [sketches, setSketches] = useState([]);
  const [openPanel, setOpenPanel] = useState(false);
  const skipDirty = useRef(true);
  const [linkProjectId, setLinkProjectId] = useState(linkProject || null);
  const [linkSheetId, setLinkSheetId] = useState(linkSheet || null);
  const [frame, setFrame] = useState(null);
  const [planModal, setPlanModal] = useState(false);
  const [planBusy, setPlanBusy] = useState(null);
  const [nameGate, setNameGate] = useState(!(openSketchId || linkProject || embedded));

  viewRef.current = view;

  const fitExtent = useCallback((extent, sz) => {
    sz = sz || size;
    const pad = 80, planX0 = -2300, planY0 = -2300;
    const planW = (extent?.w || 8400) + 3400, planH = (extent?.h || 8800) + 3000;
    const s = Math.min((sz.w - pad * 2) / planW, (sz.h - pad * 2) / planH);
    setView({ s, tx: (sz.w - planW * s) / 2 - planX0 * s, ty: (sz.h - planH * s) / 2 - planY0 * s });
  }, [size]);
  const DEFAULT_FRAME = { x: -2300, y: -2300, w: 11800, h: 11800 };
  const fitFrame = useCallback((frame, sz) => {
    sz = sz || size;
    const pad = 90;
    const s = Math.max(SCALE_MIN, Math.min(SCALE_MAX, Math.min((sz.w - pad * 2) / frame.w, (sz.h - pad * 2) / frame.h)));
    setView({ s, tx: sz.w / 2 - (frame.x + frame.w / 2) * s, ty: sz.h / 2 - (frame.y + frame.h / 2) * s });
  }, [size]);
  const fit = useCallback((sz) => fitFrame((model.walls && model.walls.length) ? computeFrame(model, 900) : DEFAULT_FRAME, sz), [fitFrame, model]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => { const r = el.getBoundingClientRect(); const sz = { w: r.width, h: r.height }; setSize(sz); return sz; };
    fit(measure());
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      const map = { v: "select", e: "ext", i: "int", d: "door", w: "window", m: "dim", r: "room", t: "text", h: "pan" };
      const k = e.key.toLowerCase();
      if (map[k]) { setTool(map[k]); setDraftPts([]); setDimP1(null); }
      else if (e.key === "Escape") { setDraftPts([]); setDimP1(null); setSel(null); }
      else if (e.key === "Enter") { setDraftPts([]); }
      else if (e.key === "Delete" || e.key === "Backspace") { deleteSel(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  // wheel zoom toward cursor (native, non-passive)
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      setView((v) => {
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const ns = Math.max(SCALE_MIN, Math.min(SCALE_MAX, v.s * factor));
        const cxp = e.clientX - r.left, cyp = e.clientY - r.top;
        const wx = (cxp - v.tx) / v.s, wy = (cyp - v.ty) / v.s;
        return { s: ns, tx: cxp - wx * ns, ty: cyp - wy * ns };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  // Two-finger pinch-to-zoom and two-finger pan (touch). Capture-phase listeners,
  // decoupled from the drawing handlers; the transform is driven straight on the
  // <g> node during the gesture and committed to state once on release.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const pts = pointersRef.current;
    const onDown = (e) => {
      if (e.pointerType !== "touch") return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const ids = [...pts.keys()];
        const a = pts.get(ids[0]), b = pts.get(ids[1]);
        const rect = el.getBoundingClientRect();
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const midX = (a.x + b.x) / 2 - rect.left;
        const midY = (a.y + b.y) / 2 - rect.top;
        const v = viewRef.current;
        pinchRef.current = {
          idA: ids[0], idB: ids[1],
          startDist: dist, startS: v.s, startTx: v.tx, startTy: v.ty,
          worldX: (midX - v.tx) / v.s, worldY: (midY - v.ty) / v.s,
          rectLeft: rect.left, rectTop: rect.top,
        };
        pinchActiveRef.current = true;
        suppressClickRef.current = true;
        panRef.current = null;
        try { el.setPointerCapture(e.pointerId); } catch {}
      }
    };
    const onMove = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinchRef.current) {
        const a = pts.get(pinchRef.current.idA), b = pts.get(pinchRef.current.idB);
        if (!a || !b) return;
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const { startDist, startS, startTx, startTy, worldX, worldY, rectLeft, rectTop } = pinchRef.current;
        const newS = Math.max(SCALE_MIN, Math.min(SCALE_MAX, startS * (dist / startDist)));
        const midX = (a.x + b.x) / 2 - rectLeft;
        const midY = (a.y + b.y) / 2 - rectTop;
        const tx = midX - worldX * newS;
        const ty = midY - worldY * newS;
        livePinchRef.current = { s: newS, tx, ty };
        // GPU-composited CSS transform on the SVG element (relative to the committed
        // view) so the vectors aren't repainted each frame; the sharp <g> transform
        // is restored from state on release.
        const cs = newS / startS;
        const tf = `translate(${tx - startTx * cs}px, ${ty - startTy * cs}px) scale(${cs})`;
        if (svgRef.current) svgRef.current.style.transform = tf;
        if (gridRef.current) gridRef.current.style.transform = tf;
        e.preventDefault();
      }
    };
    const onUp = (e) => {
      const pr = pinchRef.current;
      pts.delete(e.pointerId);
      if (pr && (e.pointerId === pr.idA || e.pointerId === pr.idB)) {
        if (livePinchRef.current) {
          const lp = livePinchRef.current;
          livePinchRef.current = null;
          setView({ s: lp.s, tx: lp.tx, ty: lp.ty });
        } else if (el) {
          el.style.transform = "";
          if (gridRef.current) gridRef.current.style.transform = "";
        }
        pinchRef.current = null;
        pinchActiveRef.current = false;
      }
    };
    el.addEventListener("pointerdown", onDown, { capture: true });
    el.addEventListener("pointermove", onMove, { capture: true });
    el.addEventListener("pointerup", onUp, { capture: true });
    el.addEventListener("pointercancel", onUp, { capture: true });
    return () => {
      el.removeEventListener("pointerdown", onDown, { capture: true });
      el.removeEventListener("pointermove", onMove, { capture: true });
      el.removeEventListener("pointerup", onUp, { capture: true });
      el.removeEventListener("pointercancel", onUp, { capture: true });
    };
  }, []);

  // Apply the committed view transform straight to the <g> node. Runs only when
  // `view` changes, so unrelated re-renders (e.g. the snap cursor) never revert the
  // transform, and it stays out of the way of the imperative pinch updates.
  useLayoutEffect(() => {
    const n = gRef.current;
    if (n) n.setAttribute("transform", `translate(${view.tx} ${view.ty}) scale(${view.s})`);
    if (svgRef.current) svgRef.current.style.transform = "";
    if (gridRef.current) gridRef.current.style.transform = "";
  }, [view]);

  // mark unsaved when the drawing changes (skips initial mount, load and new)
  useEffect(() => {
    if (skipDirty.current) { skipDirty.current = false; return; }
    setSaveState((st) => (st === "saving" ? st : "unsaved"));
  }, [model]);

  const toWorld = (clientX, clientY) => {
    const r = svgRef.current.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.tx) / v.s, y: (clientY - r.top - v.ty) / v.s };
  };
  const snapPt = (raw, from) => {
    let x = raw.x, y = raw.y;
    if (flags.ortho && from) {
      const dx = x - from.x, dy = y - from.y;
      const step = Math.PI / 4;
      const ang = Math.round(Math.atan2(dy, dx) / step) * step;
      let dist = Math.hypot(dx, dy);
      if (flags.gridSnap) dist = Math.round(dist / settings.grid) * settings.grid;
      return { x: from.x + Math.cos(ang) * dist, y: from.y + Math.sin(ang) * dist };
    }
    if (flags.gridSnap) { x = snap(x, settings.grid); y = snap(y, settings.grid); }
    return { x, y };
  };

  const isWallTool = tool === "ext" || tool === "int";
  const drawingTool = tool !== "select" && tool !== "pan";

  const handleMove = (e) => {
    if (pinchActiveRef.current) return;
    if (panRef.current) {
      setView({ s: viewRef.current.s, tx: panRef.current.tx + (e.clientX - panRef.current.mx), ty: panRef.current.ty + (e.clientY - panRef.current.my) });
      return;
    }
    const raw = toWorld(e.clientX, e.clientY);
    const from = draftPts.length ? draftPts[draftPts.length - 1] : null;
    const p = isWallTool ? snapPt(raw, from) : (flags.gridSnap ? { x: snap(raw.x, settings.grid), y: snap(raw.y, settings.grid) } : raw);
    setCur({ x: p.x, y: p.y, sx: e.clientX, sy: e.clientY, on: true });
  };
  const handleDown = (e) => {
    if (pinchActiveRef.current) return;
    suppressClickRef.current = false;
    if (tool === "pan" || e.button === 1 || e.shiftKey) {
      panRef.current = { mx: e.clientX, my: e.clientY, tx: view.tx, ty: view.ty };
      e.preventDefault();
    }
  };
  const handleUp = () => { panRef.current = null; };

  const commitWallSeg = (a, b) => {
    if (a.x === b.x && a.y === b.y) return;
    const seg = { id: "w" + Date.now() + Math.round(Math.random() * 1e4), type: tool === "ext" ? "external" : "internal", x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    setModel((m) => ({ ...m, walls: m.walls.concat([seg]) }));
  };
  const handleClick = (e) => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    if (panRef.current) return;
    const raw = toWorld(e.clientX, e.clientY);
    if (isWallTool) {
      const from = draftPts.length ? draftPts[draftPts.length - 1] : null;
      const p = snapPt(raw, from);
      if (draftPts.length) commitWallSeg(draftPts[draftPts.length - 1], p);
      setDraftPts(draftPts.concat([p]));
      return;
    }
    if (tool === "door" || tool === "window") {
      const nw = nearestWall(model.walls, raw.x, raw.y);
      if (!nw) return;
      const t = nw.seg.type === "external" ? T_EXT : T_INT;
      if (tool === "door") {
        const d = { id: "D" + Date.now(), x: Math.round(nw.cx), y: Math.round(nw.cy), dir: nw.dir, w: settings.doorW, t, hinge: -1, fold: 1, ref: "" };
        setModel((m) => ({ ...m, doors: m.doors.concat([d]) }));
      } else {
        const wn = { id: "W" + Date.now(), x: Math.round(nw.cx), y: Math.round(nw.cy), dir: nw.dir, w: settings.winW, t, escape: false, ref: "" };
        setModel((m) => ({ ...m, windows: m.windows.concat([wn]) }));
      }
      return;
    }
    if (tool === "dim") {
      const pp = flags.gridSnap ? { x: snap(raw.x, settings.grid), y: snap(raw.y, settings.grid) } : raw;
      if (!dimP1) { setDimP1(pp); }
      else {
        const horiz = Math.abs(pp.x - dimP1.x) >= Math.abs(pp.y - dimP1.y);
        const nd = { id: "M" + Date.now(), x1: dimP1.x, y1: dimP1.y, x2: pp.x, y2: pp.y, side: horiz ? "top" : "left", off: 700 };
        setModel((m) => ({ ...m, dims: m.dims.concat([nd]) }));
        setDimP1(null);
      }
      return;
    }
    if (tool === "room" || tool === "text") {
      const nm = tool === "room" ? (window.prompt("Room name", "New room") || "") : (window.prompt("Note text", "") || "");
      if (!nm) return;
      if (tool === "room") setModel((m) => ({ ...m, rooms: m.rooms.concat([{ name: nm, area: 0, x: Math.round(raw.x), y: Math.round(raw.y) }]) }));
      else setModel((m) => ({ ...m, notes: m.notes.concat([{ text: nm, x: Math.round(raw.x), y: Math.round(raw.y) }]) }));
      return;
    }
    if (tool === "select") {
      const op = openingAt(raw.x, raw.y);
      setSel(op || hitTest(model.walls, raw.x, raw.y));
    }
  };
  const handleDouble = () => { if (draftPts.length) setDraftPts([]); };

  const openingAt = (px, py) => {
    let best = null, bd = Infinity;
    const scan = (arr, kind) => arr.forEach((o) => {
      const rr = Math.max(o.w / 2, 350);
      const d = hyp(px - o.x, py - o.y);
      if (d < rr && d < bd) { bd = d; best = { kind, id: o.id }; }
    });
    scan(model.doors, "door");
    scan(model.windows, "window");
    return best;
  };
  const deleteSel = () => {
    if (!sel) return;
    setModel((m) => {
      if (sel.kind === "door") return { ...m, doors: m.doors.filter((d) => d.id !== sel.id) };
      if (sel.kind === "window") return { ...m, windows: m.windows.filter((w) => w.id !== sel.id) };
      return { ...m, walls: m.walls.filter((w) => w.id !== sel.id) };
    });
    setSel(null);
  };
  const convertSel = () => {
    if (!sel || sel.kind !== "wall") return;
    setModel((m) => ({ ...m, walls: m.walls.map((w) => w.id === sel.id ? { ...w, type: w.type === "external" ? "internal" : "external" } : w) }));
  };
  const updDoor = (fn) => {
    if (!sel || sel.kind !== "door") return;
    setModel((m) => ({ ...m, doors: m.doors.map((d) => d.id === sel.id ? { ...d, ...fn(d) } : d) }));
  };
  const flipSwing = () => updDoor((d) => ({ fold: -d.fold }));
  const flipHinge = () => updDoor((d) => ({ hinge: -d.hinge }));
  const toggleEscape = () => {
    if (!sel || sel.kind !== "window") return;
    setModel((m) => ({ ...m, windows: m.windows.map((w) => w.id === sel.id ? { ...w, escape: !w.escape } : w) }));
  };
  const zoomBy = (factor) => setView((v) => {
    const ns = Math.max(SCALE_MIN, Math.min(SCALE_MAX, v.s * factor));
    const cxp = size.w / 2, cyp = size.h / 2;
    const wx = (cxp - v.tx) / v.s, wy = (cyp - v.ty) / v.s;
    return { s: ns, tx: cxp - wx * ns, ty: cyp - wy * ns };
  });

  const blankModel = () => ({ EXTENT: { w: 8400, h: 8800, margin: 2600 }, walls: [], doors: [], windows: [], dims: [], rooms: [], notes: [], boundary: null, rooflights: [], stairs: null });
  const currentLink = () => (linkProjectId ? { projectId: linkProjectId, sheetId: linkSheetId, frame } : null);
  const persistSketch = async (link) => {
    const lk = link === undefined ? currentLink() : link;
    const data = { ...model, _link: lk };
    if (sketchId) { await updateSketch(sketchId, sketchName, data); return sketchId; }
    const id = await insertSketch(sketchName, data); setSketchId(id); return id;
  };
  const doSave = async () => {
    setSaveState("saving");
    try { await persistSketch(); setSaveState("saved"); }
    catch (e) { console.error(e); setSaveState("error"); window.alert("Couldn't save: " + (e.message || e)); }
  };
  const refreshList = async () => { try { setSketches(await listSketches()); } catch (e) { console.warn(e); } };
  const toggleOpen = () => { const n = !openPanel; setOpenPanel(n); if (n) refreshList(); };
  const doNew = () => {
    skipDirty.current = true;
    setModel(blankModel());
    setSketchId(null); setSketchName("");
    setLinkProjectId(null); setLinkSheetId(null); setFrame(null);
    setSel(null); setDraftPts([]); setDimP1(null); setTool("select"); setSaveState("idle");
    setNameGate(true);
    setTimeout(() => fitFrame(DEFAULT_FRAME), 0);
  };
  const doLoad = async (id) => {
    try {
      const data = await getSketchData(id);
      if (!data) return;
      const meta = sketches.find((sk) => sk.id === id);
      const { _link, ...geo } = data;
      skipDirty.current = true;
      setModel({ ...blankModel(), ...geo });
      setLinkProjectId(_link?.projectId || null);
      setLinkSheetId(_link?.sheetId || null);
      setFrame(_link?.frame || null);
      setSketchId(id); setSketchName(meta?.name || "Untitled sketch");
      setSel(null); setDraftPts([]); setDimP1(null); setTool("select");
      fitFrame((geo.walls && geo.walls.length) ? computeFrame(geo, 900) : DEFAULT_FRAME);
      setSaveState("saved"); setOpenPanel(false); setNameGate(false);
    } catch (e) { console.error(e); window.alert("Couldn't open: " + (e.message || e)); }
  };
  const doDelete = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm("Delete this sketch? This can't be undone.")) return;
    try {
      await deleteSketch(id);
      if (id === sketchId) doNew();
      refreshList();
    } catch (err) { console.error(err); window.alert("Couldn't delete: " + (err.message || err)); }
  };

  const createDrawing = async (path, w, h, fr) => {
    setPlanBusy("Creating drawing");
    const sheetId = "s_" + Math.random().toString(36).slice(2, 9);
    const today = new Date().toISOString().slice(0, 10);
    const name = sketchName || "Untitled drawing";
    const data = {
      meta: { projectName: name, drawingNumber: "", date: today, revision: "A", revNote: "First Issue", company: "", clientName: "", clientEmail: "" },
      boq: null, titleBlock: null, colourMode: "red",
      notes: "", // blank Installation Notes, like any new drawing
      sheets: [{ id: sheetId, name, drawingNumber: "", bgImage: { path, w, h }, placed: [], furniture: [], walls: [], wires: [], annotations: [], notes: "", symbolScale: 1 }],
      activeSheetId: sheetId,
    };
    const newId = await insertProject(name, data);
    setLinkProjectId(newId); setLinkSheetId(sheetId); setFrame(fr);
    const skId = await persistSketch({ projectId: newId, sheetId, frame: fr });
    try { await updateProjectRow(newId, name, { ...data, sheets: data.sheets.map((s) => s.id === sheetId ? { ...s, sketchId: skId } : s) }); } catch (e) { console.warn(e); }
    setPlanBusy(null);
    router.push("/drawing?id=" + newId);
  };
  const runUsePlan = async (mode) => {
    setPlanModal(false);
    setPlanBusy("Preparing plan");
    try {
      if (embedded && onApplyPlan) {
        const efr = frame || computeFrame(model);
        const png = await renderModelToPng(model, efr, 2200);
        setPlanBusy("Uploading plan");
        const up = await uploadPlanImage(dataUrlToBlob(png.dataUrl));
        const skId = await persistSketch({ projectId: linkProjectId, sheetId: linkSheetId, frame: efr });
        setFrame(efr); setPlanBusy(null);
        onApplyPlan({ path: up.path, w: png.w, h: png.h, dataUrl: png.dataUrl, sketchId: skId });
        onClose && onClose();
        return;
      }
      const fr = (mode === "update" && frame) ? frame : computeFrame(model);
      const { dataUrl, w, h } = await renderModelToPng(model, fr, 2200);
      setPlanBusy("Uploading plan");
      const { path } = await uploadPlanImage(dataUrlToBlob(dataUrl));
      if (mode === "update" && linkProjectId) {
        setPlanBusy("Updating drawing");
        let proj = null;
        try { proj = await getProjectData(linkProjectId); } catch { proj = null; }
        if (!proj) { await createDrawing(path, w, h, fr); return; }
        const skId = await persistSketch({ projectId: linkProjectId, sheetId: linkSheetId, frame: fr });
        const newSheets = (proj.sheets || []).map((s) => s.id === linkSheetId ? { ...s, bgImage: { path, w, h }, sketchId: skId } : s);
        const matched = (proj.sheets || []).some((s) => s.id === linkSheetId);
        if (!matched && newSheets.length) {
          const aid = (proj.activeSheetId && newSheets.find((s) => s.id === proj.activeSheetId)) ? proj.activeSheetId : newSheets[0].id;
          for (let i = 0; i < newSheets.length; i++) if (newSheets[i].id === aid) newSheets[i] = { ...newSheets[i], bgImage: { path, w, h }, sketchId: skId };
        }
        await updateProjectRow(linkProjectId, proj.meta?.projectName || sketchName, { ...proj, sheets: newSheets });
        setFrame(fr); setPlanBusy(null);
        router.push("/drawing?id=" + linkProjectId);
        return;
      }
      await createDrawing(path, w, h, fr);
    } catch (e) {
      console.error(e); setPlanBusy(null);
      window.alert("Couldn't send the plan to the editor: " + (e.message || e));
    }
  };
  const openUsePlan = () => {
    if (!model.walls || !model.walls.length) { window.alert("Draw at least the outline walls before sending the plan to the editor."); return; }
    setPlanModal(true);
  };
  const startNamed = async () => {
    const nm = sketchName.trim();
    if (!nm) return;
    setSketchName(nm);
    setNameGate(false);
    setSaveState("saving");
    try { await persistSketch(null); setSaveState("saved"); }
    catch (e) { console.error(e); setSaveState("idle"); }
  };

  const openLinkedSketch = async (id) => {
    setPlanBusy("Opening floor plan");
    try {
      const data = await getSketchData(id);
      if (!data) { setNameGate(false); setSaveState("idle"); setPlanBusy(null); return; }
      const { _link, ...geo } = data;
      skipDirty.current = true;
      setModel({ ...blankModel(), ...geo });
      setLinkProjectId(_link?.projectId || linkProject || null);
      setLinkSheetId(_link?.sheetId || linkSheet || null);
      setFrame(_link?.frame || null);
      setSketchId(id);
      setSketchName(linkName || "Floor plan");
      setSel(null); setDraftPts([]); setDimP1(null); setTool("select");
      fitFrame((geo.walls && geo.walls.length) ? computeFrame(geo, 900) : DEFAULT_FRAME);
      setSaveState("saved"); setNameGate(false);
    } catch (e) { console.error(e); setNameGate(false); setSaveState("idle"); }
    setPlanBusy(null);
  };
  useEffect(() => {
    if (openSketchId) openLinkedSketch(openSketchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const planEls = useMemo(() => {
    const g = [];
    g.push(<rect key="sheet" x={SHEET.x} y={SHEET.y} width={SHEET.w} height={SHEET.h} fill="none" stroke="#2C97A8" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />);
    if (layers.boundary && model.boundary) g.push(<polyline key="bnd" points={ptStr(model.boundary)} className="cadv-boundary" fill="none" strokeWidth={1.4} strokeDasharray="14 10" vectorEffect="non-scaling-stroke" />);
    if (layers.stairs) (model.rooflights || []).forEach((rl) => g.push(
      <g key={rl.ref}>
        <rect x={rl.x} y={rl.y} width={rl.w} height={rl.h} fill="none" className="cadv-ink" strokeWidth={0.8} strokeDasharray="20 14" vectorEffect="non-scaling-stroke" opacity={0.6} />
        <text x={rl.x + rl.w / 2} y={rl.y + rl.h / 2} className="cadv-note" fontSize={150} textAnchor="middle" fontWeight={600}>{rl.ref}</text>
      </g>));
    if (layers.walls) g.push(<g key="walls">{model.walls.map((s) => <WallNode key={s.id} s={s} selected={sel && sel.kind === "wall" && sel.id === s.id} />)}</g>);
    if (layers.openings) {
      g.push(<g key="doors">{model.doors.map((d) => <DoorNode key={d.id} d={d} selected={sel && sel.kind === "door" && sel.id === d.id} />)}</g>);
      g.push(<g key="wins">{model.windows.map((wn) => <WindowNode key={wn.id} wn={wn} selected={sel && sel.kind === "window" && sel.id === wn.id} />)}</g>);
    }
    if (layers.stairs && model.stairs) g.push(<StairNode key="stairs" s={model.stairs} />);
    if (layers.dims) g.push(<g key="dims">{model.dims.map((d) => <DimNode key={d.id} d={d} />)}</g>);
    if (layers.rooms) {
      g.push(<g key="rooms">{model.rooms.map((r, i) => (
        <g key={"room" + i} className="cadv-room">
          <text x={r.x} y={r.y} className="nm" fontSize={230} textAnchor="middle">{r.name.toUpperCase()}</text>
          {r.area ? <text x={r.x} y={r.y + 300} className="ar" fontSize={165} textAnchor="middle">{r.area.toFixed(1) + " m\u00B2"}</text> : null}
        </g>))}</g>);
      g.push(<g key="notes">{model.notes.map((n, i) => (
        <text key={"n" + i} x={n.x} y={n.y} className="cadv-note" fontSize={165} textAnchor="middle">{n.text}</text>))}</g>);
    }
    if (layers.openings) {
      const tags = [];
      model.doors.forEach((d) => { if (d.ref) tags.push(<Tag key={"tg" + d.id} refTxt={d.ref} x={d.x + (d.dir === "h" ? 0 : d.fold * 430)} y={d.y + (d.dir === "h" ? d.fold * 430 : 0)} />); });
      model.windows.forEach((w) => { if (w.ref) tags.push(<Tag key={"tg" + w.id} refTxt={w.ref} x={w.x + (w.dir === "h" ? 0 : (w.x < 1000 ? 430 : -430))} y={w.y + (w.dir === "h" ? (w.y < 1000 ? 360 : -360) : 0)} />); });
      g.push(<g key="tags">{tags}</g>);
    }
    return g;
  }, [model, sel, layers]);

  // overlay: draft + rubber-band + vertices + crosshair + snap dot
  const overlay = [];
  if (isWallTool && draftPts.length) {
    for (let i = 0; i < draftPts.length - 1; i++)
      overlay.push(<line key={"dp" + i} x1={draftPts[i].x} y1={draftPts[i].y} x2={draftPts[i + 1].x} y2={draftPts[i + 1].y} className="cadv-active" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />);
    const last = draftPts[draftPts.length - 1];
    overlay.push(<line key="rb" x1={last.x} y1={last.y} x2={cur.x} y2={cur.y} className="cadv-active" strokeWidth={1.6} strokeDasharray="8 6" vectorEffect="non-scaling-stroke" />);
    draftPts.forEach((p, k) => overlay.push(<rect key={"v" + k} x={p.x - 90} y={p.y - 90} width={180} height={180} className="cadv-active" fill="#fff" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />));
  }
  if (tool === "dim" && dimP1) {
    overlay.push(<line key="dimrb" x1={dimP1.x} y1={dimP1.y} x2={cur.x} y2={cur.y} className="cadv-active" strokeWidth={1.2} strokeDasharray="8 6" vectorEffect="non-scaling-stroke" />);
  }
  if (drawingTool && cur.on) {
    overlay.push(<line key="chx" x1={SHEET.x} y1={cur.y} x2={SHEET.x + SHEET.w} y2={cur.y} className="cadv-cross" strokeWidth={0.9} opacity={0.6} vectorEffect="non-scaling-stroke" />);
    overlay.push(<line key="chy" x1={cur.x} y1={SHEET.y} x2={cur.x} y2={SHEET.y + SHEET.h} className="cadv-cross" strokeWidth={0.9} opacity={0.6} vectorEffect="non-scaling-stroke" />);
    overlay.push(<circle key="cdot" cx={cur.x} cy={cur.y} r={70} className="cadv-active" fill="#fff" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />);
  }

  // length HUD (DOM, at cursor)
  let hud = null;
  if (isWallTool && draftPts.length && cur.on) {
    const lp = draftPts[draftPts.length - 1];
    const L = Math.round(hyp(cur.x - lp.x, cur.y - lp.y));
    const wr = wrapRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
    hud = <div className="cadv__hud" style={{ left: cur.sx - wr.left, top: cur.sy - wr.top }}>Length <b>{fmtMM(L)} mm</b></div>;
  } else if (tool === "dim" && dimP1 && cur.on) {
    const L2 = Math.round(hyp(cur.x - dimP1.x, cur.y - dimP1.y));
    const wr = wrapRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
    hud = <div className="cadv__hud" style={{ left: cur.sx - wr.left, top: cur.sy - wr.top }}><b>{fmtMM(L2)} mm</b></div>;
  }

  const selWall = sel && sel.kind === "wall" ? model.walls.find((w) => w.id === sel.id) : null;
  const selDoor = sel && sel.kind === "door" ? model.doors.find((d) => d.id === sel.id) : null;
  const selWin = sel && sel.kind === "window" ? model.windows.find((w) => w.id === sel.id) : null;
  const hint = {
    select: "Click a wall to select. Hold Shift and drag to pan.",
    ext: draftPts.length ? "Click the next corner - double-click or Esc to finish" : "Click the start point of an external wall",
    int: draftPts.length ? "Click the next corner - double-click or Esc to finish" : "Click the start point of an internal wall",
    door: "Click on a wall to place a door",
    window: "Click on a wall to place a window",
    dim: dimP1 ? "Click the second measure point" : "Click the first measure point",
    room: "Click inside a space to drop a room label",
    text: "Click to place a note",
    pan: "Drag to pan the sheet",
  }[tool];

  const svgCursor = tool === "pan" ? "grab" : (drawingTool ? "crosshair" : "default");
  const minorSz = 500 * view.s, majorSz = 1000 * view.s;
  const sL = view.tx + SHEET.x * view.s, sT = view.ty + SHEET.y * view.s;
  const sR = view.tx + (SHEET.x + SHEET.w) * view.s, sB = view.ty + (SHEET.y + SHEET.h) * view.s;
  const clipRect = `polygon(${sL}px ${sT}px, ${sR}px ${sT}px, ${sR}px ${sB}px, ${sL}px ${sB}px)`;
  const gridStyle = layers.grid ? {
    backgroundImage:
      `linear-gradient(to right, rgba(132,174,186,0.55) 1px, transparent 1px),` +
      `linear-gradient(to bottom, rgba(132,174,186,0.55) 1px, transparent 1px),` +
      `linear-gradient(to right, rgba(170,198,206,0.45) 1px, transparent 1px),` +
      `linear-gradient(to bottom, rgba(170,198,206,0.45) 1px, transparent 1px)`,
    backgroundSize: `${majorSz}px ${majorSz}px, ${majorSz}px ${majorSz}px, ${minorSz}px ${minorSz}px, ${minorSz}px ${minorSz}px`,
    backgroundPosition: `${view.tx}px ${view.ty}px`,
    clipPath: clipRect, WebkitClipPath: clipRect,
  } : { display: "none" };

  return (
    <div className="cadv">
      <style>{CSS}</style>
      <div className="cadv__top">
        <button className="cadv__back" onClick={() => (embedded ? (onClose && onClose()) : router.push("/"))} title={embedded ? "Back to symbols" : "Back to dashboard"}>&#8249;</button>
        <input className="cadv__name" value={sketchName} onChange={(e) => setSketchName(e.target.value)} spellCheck={false} aria-label="Sketch name" />
        <span className={"cadv__save cadv__save--" + saveState}>{SAVE_LABEL[saveState]}</span>
        <span className="cadv__grow" />
        <div className="cadv__acts">
          <button onClick={doNew}>New</button>
          <button onClick={toggleOpen}>Open</button>
          <button onClick={doSave} disabled={saveState === "saving"}>Save</button>
          <button className="accent" onClick={openUsePlan} disabled={!!planBusy}>Use this plan</button>
        </div>
        {openPanel && (
          <div className="cadv__open">
            <div className="cadv__open-head">Your sketches</div>
            {sketches.length === 0 ? (
              <div className="cadv__open-empty">No saved sketches yet.</div>
            ) : sketches.map((sk) => (
              <button key={sk.id} className="cadv__open-row" onClick={() => doLoad(sk.id)}>
                <span className="nm">{sk.name}</span>
                <span className="dt">{new Date(sk.updatedAt).toLocaleDateString("en-GB")}</span>
                <span className="del" title="Delete" onClick={(e) => doDelete(sk.id, e)}>&#215;</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="cadv__body">
        <div className="cadv__rail">
          {TOOLS.map(([id, label, key]) => (
            <button key={id} className={"cadv__tool" + (tool === id ? " on" : "")} title={label + " (" + key + ")"}
              onClick={() => { setTool(id); setDraftPts([]); setDimP1(null); }}>
              <Glyph name={id} />
              <span className="key">{key}</span>
            </button>
          ))}
        </div>

        <div className="cadv__workspace" ref={wrapRef}>
          <div ref={gridRef} className="cadv__grid" style={{ position: "absolute", inset: 0, pointerEvents: "none", transformOrigin: "0 0", willChange: PROMOTE, ...gridStyle }} />
          <svg ref={svgRef} className="cadv__svg" width="100%" height="100%" style={{ cursor: svgCursor, transformOrigin: "0 0", willChange: PROMOTE }}
            onPointerDown={handleDown} onPointerMove={handleMove} onPointerUp={handleUp} onPointerCancel={handleUp}
            onClick={handleClick} onDoubleClick={handleDouble}
            onPointerLeave={() => setCur((c) => ({ ...c, on: false }))}>
            <g ref={gRef}>
              {planEls}
              {overlay}
            </g>
          </svg>
          {hud}
          <div className="cadv__zoom">
            <button onClick={() => zoomBy(1.2)} title="Zoom in">+</button>
            <button onClick={() => zoomBy(1 / 1.2)} title="Zoom out">&#8722;</button>
            <button onClick={() => fit()} title="Zoom to fit">&#10530;</button>
          </div>
          <div className="cadv__chip">
            <span className="north">N &#8593;</span>
            <span className="bar"><i /><i className="alt" /><i /></span>
            <span>0 1 2 m</span>
          </div>
        </div>

        <div className="cadv__inspector">
          {selWall ? (
            <div>
              <div className="cadv__sect first">Selected wall</div>
              <div className="cadv-prop"><span className="k">Length</span><span className="v mono">{fmtMM(segLen(selWall))} mm</span></div>
              <div className="cadv-prop"><span className="k">Type</span><span className="v">{selWall.type === "external" ? "External" : "Internal"}</span></div>
              <div className="cadv-prop"><span className="k">Thickness</span><span className="v mono">{selWall.type === "external" ? T_EXT : T_INT} mm</span></div>
              <div className="cadv__row">
                <button className="cadv-btn" onClick={convertSel}>Make {selWall.type === "external" ? "internal" : "external"}</button>
                <button className="cadv-btn danger" onClick={deleteSel}>Delete</button>
              </div>
            </div>
          ) : selDoor ? (
            <div>
              <div className="cadv__sect first">Selected door</div>
              <div className="cadv-prop"><span className="k">Width</span><span className="v mono">{selDoor.w} mm</span></div>
              <div className="cadv-prop"><span className="k">On</span><span className="v">{selDoor.t === T_EXT ? "External wall" : "Internal wall"}</span></div>
              <div className="cadv__sect">Swing</div>
              <div className="cadv-seg">
                <button onClick={flipSwing}>Flip side</button>
                <button onClick={flipHinge}>Flip hinge</button>
              </div>
              <div className="cadv-hint">Flip side swaps which room the door opens into; flip hinge swaps the hinged edge. Between them you get all four swings.</div>
              <div className="cadv__row">
                <button className="cadv-btn danger" onClick={deleteSel}>Delete door</button>
              </div>
            </div>
          ) : selWin ? (
            <div>
              <div className="cadv__sect first">Selected window</div>
              <div className="cadv-prop"><span className="k">Width</span><span className="v mono">{selWin.w} mm</span></div>
              <div className="cadv-prop"><span className="k">On</span><span className="v">{selWin.t === T_EXT ? "External wall" : "Internal wall"}</span></div>
              <div className="cadv__sect">Marking</div>
              <div className="cadv-seg">
                <button className={selWin.escape ? "on" : ""} onClick={toggleEscape}>Escape window</button>
              </div>
              <div className="cadv__row">
                <button className="cadv-btn danger" onClick={deleteSel}>Delete window</button>
              </div>
            </div>
          ) : (
            <div>
              <div className="cadv__sect first">Active tool</div>
              <div className="cadv-prop"><span className="k">Tool</span><span className="v">{TOOLS.find((t) => t[0] === tool)?.[1]}</span></div>
              {isWallTool && (
                <>
                  <div className="cadv__sect">Wall type</div>
                  <div className="cadv-seg">
                    <button className={tool === "ext" ? "on" : ""} onClick={() => { setTool("ext"); setDraftPts([]); }}>External &middot; {T_EXT}</button>
                    <button className={tool === "int" ? "on" : ""} onClick={() => { setTool("int"); setDraftPts([]); }}>Internal &middot; {T_INT}</button>
                  </div>
                </>
              )}
              {tool === "door" && (
                <>
                  <div className="cadv__sect">Door width</div>
                  <div className="cadv-seg">
                    {[760, 850, 960].map((wv) => (
                      <button key={wv} className={settings.doorW === wv ? "on" : ""} onClick={() => setSettings((s) => ({ ...s, doorW: wv }))}>{wv}</button>
                    ))}
                  </div>
                </>
              )}
              {tool === "window" && (
                <>
                  <div className="cadv__sect">Window width</div>
                  <div className="cadv-seg">
                    {[600, 900, 1200].map((wv) => (
                      <button key={wv} className={settings.winW === wv ? "on" : ""} onClick={() => setSettings((s) => ({ ...s, winW: wv }))}>{wv}</button>
                    ))}
                  </div>
                </>
              )}
              <div className="cadv__sect">Snap grid</div>
              <div className="cadv-seg">
                {[50, 100, 250].map((gv) => (
                  <button key={gv} className={settings.grid === gv ? "on" : ""} onClick={() => setSettings((s) => ({ ...s, grid: gv }))}>{gv}mm</button>
                ))}
              </div>
              <div className="cadv__sect">Drawing aids</div>
              <div className="cadv-seg">
                <button className={flags.ortho ? "on" : ""} onClick={() => setFlags((f) => ({ ...f, ortho: !f.ortho }))}>Angle</button>
                <button className={flags.gridSnap ? "on" : ""} onClick={() => setFlags((f) => ({ ...f, gridSnap: !f.gridSnap }))}>Snap</button>
              </div>
              <div className="cadv-hint">{hint}</div>
              <div className="cadv__sect">Layers</div>
              <div className="cadv-layers">
                {LAYER_LIST.map(([id, label]) => (
                  <button key={id} className={"cadv-layer" + (layers[id] ? " on" : "")} onClick={() => setLayers((l) => ({ ...l, [id]: !l[id] }))}>
                    <span className="dot" />{label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="cadv__status">
        <span className="cell xy">X <b>{Math.round(cur.x)}</b> Y <b>{Math.round(cur.y)}</b></span>
        <span className="cell cmd">{hint}</span>
        <span className="spacer" />
        <span className={"cell toggle" + (flags.ortho ? " on" : "")} onClick={() => setFlags((f) => ({ ...f, ortho: !f.ortho }))}>ANGLE</span>
        <span className={"cell toggle" + (flags.gridSnap ? " on" : "")} onClick={() => setFlags((f) => ({ ...f, gridSnap: !f.gridSnap }))}>GRID</span>
        <span className="cell">GRID {settings.grid}mm</span>
        <span className="cell">{Math.round(view.s / 0.08 * 100)}%</span>
      </div>

      {nameGate && (
        <div className="cadv__modal-bg">
          <div className="cadv__modal">
            <div className="h">Name your drawing</div>
            <p>Give this plan a name so it's easy to find later and saved safely. You can rename it any time.</p>
            <input className="cadv__gate-input" autoFocus value={sketchName} placeholder="e.g. 24 High Street - First floor" onChange={(e) => setSketchName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && sketchName.trim()) startNamed(); }} />
            <button className="m-btn primary" disabled={!sketchName.trim()} onClick={startNamed}>Start drawing</button>
            <button className="m-cancel" onClick={() => { setNameGate(false); toggleOpen(); }}>Open a saved drawing instead</button>
          </div>
        </div>
      )}
      {planModal && (
        <div className="cadv__modal-bg" onClick={() => setPlanModal(false)}>
          <div className="cadv__modal" onClick={(e) => e.stopPropagation()}>
            <div className="h">Send plan to the editor</div>
            {embedded ? (
              <>
                <p>Add this plan to your drawing as the background, behind your electrical symbols.</p>
                <button className="m-btn primary" onClick={() => runUsePlan("apply")}>Add to this drawing<small>Keeps your placed symbols in position</small></button>
              </>
            ) : linkProjectId ? (
              <>
                <p>This sketch is already linked to an electrical drawing. Update that drawing with your latest plan and keep every symbol you have placed, or start a brand-new drawing.</p>
                <button className="m-btn primary" onClick={() => runUsePlan("update")}>Update existing drawing<small>Keeps your placed symbols in position</small></button>
                <button className="m-btn" onClick={() => runUsePlan("new")}>Create a new drawing<small>A fresh drawing with no symbols yet</small></button>
              </>
            ) : (
              <>
                <p>This creates a new electrical drawing on your dashboard using this plan as the background, then opens it so you can start placing symbols.</p>
                <button className="m-btn primary" onClick={() => runUsePlan("new")}>Create electrical drawing</button>
              </>
            )}
            <button className="m-cancel" onClick={() => setPlanModal(false)}>Cancel</button>
          </div>
        </div>
      )}
      {planBusy && (
        <div className="cadv__busy"><div className="box"><span className="spin" />{planBusy}&#8230;</div></div>
      )}
    </div>
  );
}

const CSS = `
.cadv{position:absolute; inset:0; display:flex; flex-direction:column; background:#fff; font-family:var(--font-inter),system-ui,sans-serif; overflow:hidden}
.cadv *{box-sizing:border-box}
.cadv__top{position:relative; display:flex; align-items:center; gap:10px; padding:0 14px; height:56px; border-bottom:1px solid rgba(44,62,80,.1); flex:0 0 auto; background:#fff}
.cadv__back{width:36px; height:36px; border:1px solid rgba(44,62,80,.12); background:#fff; border-radius:9px; font-size:20px; line-height:1; color:#3E4C59; cursor:pointer}
.cadv__back:hover{background:#F4F6F9}
.cadv__title .name{font-family:var(--font-space-grotesk),sans-serif; font-weight:600; font-size:15px; color:#18222D}
.cadv__title .sub{font-family:var(--font-jetbrains-mono),monospace; font-size:11px; color:#6E7B88}
.cadv__body{flex:1; display:flex; min-height:0}
.cadv__rail{flex:0 0 60px; width:60px; background:#F4F6F9; border-right:1px solid rgba(44,62,80,.1); display:flex; flex-direction:column; align-items:center; gap:4px; padding:10px 0}
.cadv__tool{position:relative; width:42px; height:42px; border:1px solid transparent; border-radius:10px; background:transparent; color:#2C97A8; display:flex; align-items:center; justify-content:center; cursor:pointer; transition:background .14s,color .14s,border-color .14s}
.cadv__tool:hover{background:#fff; color:#1C6F7C; border-color:rgba(44,62,80,.12)}
.cadv__tool.on{background:#2C3E50; color:#3FB7C9; border-color:#2C3E50}
.cadv__tool .key{position:absolute; right:4px; bottom:2px; font-family:var(--font-jetbrains-mono),monospace; font-size:8.5px; opacity:.55}
.cadv__workspace{flex:1; position:relative; min-width:0; overflow:hidden; background:#FFFFFF}
.cadv__svg{position:absolute; inset:0; width:100%; height:100%; display:block; touch-action:none}
.cadv-ink{stroke:#16212B}
.cadv-poche{fill:#C9D0D8}
.cadv-paper{fill:#FFFFFF}
.cadv-sel{stroke:#3FB7C9}
.cadv-active{stroke:#3FB7C9}
.cadv-cross{stroke:#2C3E50}
.cadv-grid-minor{stroke:#AAC6CE; opacity:.4}
.cadv-grid-major{stroke:#84AEBA; opacity:.55}
.cadv-dim{stroke:#2C3E50}
.cadv-dim-crit{stroke:#C4564B}
.cadv-boundary{stroke:#38B24A}
.cadv-dim-txt{font-family:var(--font-jetbrains-mono),monospace; fill:#2C3E50}
.cadv-dim-txt.crit{fill:#C4564B}
.cadv-room{font-family:var(--font-jetbrains-mono),monospace; fill:#2C3E50}
.cadv-room .nm{font-weight:600; letter-spacing:.08em}
.cadv-room .ar{fill:#6E7B88}
.cadv-tag-txt{font-family:var(--font-jetbrains-mono),monospace; fill:#16212B}
.cadv-note{font-family:var(--font-jetbrains-mono),monospace; fill:#54616E}
.cadv__hud{position:absolute; z-index:8; pointer-events:none; background:#1A2733; color:#EAF1F6; font-family:var(--font-jetbrains-mono),monospace; font-size:11.5px; padding:4px 8px; border-radius:6px; white-space:nowrap; transform:translate(14px,14px)}
.cadv__hud b{color:#3FB7C9; font-weight:600}
.cadv__zoom{position:absolute; right:16px; bottom:16px; display:flex; flex-direction:column; background:#fff; border:1px solid rgba(44,62,80,.1); border-radius:12px; overflow:hidden; box-shadow:0 6px 16px rgba(20,33,46,.09)}
.cadv__zoom button{width:38px; height:38px; border:0; background:#fff; color:#3E4C59; font-size:17px; cursor:pointer}
.cadv__zoom button:hover{background:#F4F6F9; color:#18222D}
.cadv__zoom button+button{border-top:1px solid rgba(44,62,80,.1)}
.cadv__chip{position:absolute; left:16px; bottom:16px; display:flex; align-items:center; gap:12px; background:rgba(255,255,255,.92); border:1px solid rgba(44,62,80,.1); border-radius:10px; padding:8px 12px; font-family:var(--font-jetbrains-mono),monospace; font-size:11px; color:#54616E}
.cadv__chip .north{color:#3E4C59; font-weight:600}
.cadv__chip .bar{display:inline-flex; height:6px; border:1px solid #6E7B88}
.cadv__chip .bar i{width:20px; height:100%; background:#3E4C59}
.cadv__chip .bar i.alt{background:#fff}
.cadv__inspector{flex:0 0 278px; width:278px; background:#fff; border-left:1px solid rgba(44,62,80,.1); overflow-y:auto}
.cadv__sect{padding:14px 16px 4px; font-family:var(--font-jetbrains-mono),monospace; font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:#8C97A3}
.cadv__sect.first{padding-top:16px}
.cadv-prop{display:flex; align-items:center; justify-content:space-between; gap:10px; padding:7px 16px}
.cadv-prop .k{font-size:12.5px; color:#54616E}
.cadv-prop .v{font-size:12.5px; color:#18222D; font-weight:540}
.cadv-prop .v.mono{font-family:var(--font-jetbrains-mono),monospace}
.cadv-seg{display:flex; gap:4px; padding:4px 16px 8px}
.cadv-seg button{flex:1; height:34px; border:1px solid rgba(44,62,80,.12); border-radius:9px; background:#fff; font:inherit; font-size:11.5px; font-weight:540; color:#54616E; cursor:pointer; transition:all .14s}
.cadv-seg button:hover{border-color:rgba(44,62,80,.22); color:#18222D}
.cadv-seg button.on{background:#2C3E50; border-color:#2C3E50; color:#EAF1F6}
.cadv__row{display:flex; gap:8px; padding:10px 16px}
.cadv-btn{flex:1; height:36px; border:1px solid rgba(44,62,80,.12); border-radius:9px; background:#fff; font:inherit; font-size:12.5px; font-weight:540; color:#3E4C59; cursor:pointer}
.cadv-btn:hover{background:#F4F6F9; color:#18222D}
.cadv-btn.danger{color:#C4564B; border-color:rgba(196,86,75,.3)}
.cadv-btn.danger:hover{background:rgba(196,86,75,.08)}
.cadv-hint{margin:8px 16px 14px; padding:11px 12px; border-radius:10px; background:rgba(63,183,201,.12); border:1px solid rgba(63,183,201,.2); font-size:12px; line-height:1.45; color:#1C6F7C}
.cadv__status{flex:0 0 auto; height:34px; display:flex; align-items:center; padding:0 6px; border-top:1px solid rgba(44,62,80,.1); background:#F4F6F9; font-family:var(--font-jetbrains-mono),monospace; font-size:11px; color:#6E7B88}
.cadv__status .cell{padding:0 12px; display:flex; align-items:center; gap:7px; height:100%}
.cadv__status .cell+.cell{border-left:1px solid rgba(44,62,80,.1)}
.cadv__status .cmd{color:#3E4C59}
.cadv__status .xy b{color:#283643}
.cadv__status .spacer{flex:1; border:0}
.cadv__status .toggle{cursor:pointer; color:#8C97A3}
.cadv__status .toggle.on{color:#1C6F7C; background:rgba(63,183,201,.1)}
.cadv-layers{padding:2px 12px 14px; display:flex; flex-direction:column; gap:1px}
.cadv-layer{display:flex; align-items:center; gap:9px; width:100%; text-align:left; padding:7px 8px; border:0; border-radius:8px; background:transparent; font:inherit; font-size:12.5px; color:#8C97A3; cursor:pointer}
.cadv-layer:hover{background:#F4F6F9}
.cadv-layer .dot{width:9px; height:9px; border-radius:3px; border:1.5px solid #B5BEC7; background:transparent; flex:0 0 auto}
.cadv-layer.on{color:#283643}
.cadv-layer.on .dot{background:#3FB7C9; border-color:#3FB7C9}
.cadv__name{flex:0 1 260px; min-width:120px; height:34px; border:1px solid transparent; border-radius:8px; padding:0 10px; font-family:var(--font-space-grotesk),sans-serif; font-weight:600; font-size:15px; color:#18222D; background:transparent}
.cadv__name:hover{border-color:rgba(44,62,80,.12); background:#F8FAFB}
.cadv__name:focus{outline:none; border-color:#3FB7C9; background:#fff}
.cadv__save{font-family:var(--font-jetbrains-mono),monospace; font-size:10.5px; letter-spacing:.04em; color:#8C97A3; white-space:nowrap}
.cadv__save--saved{color:#1C6F7C}
.cadv__save--saving{color:#3E4C59}
.cadv__save--unsaved{color:#B06A1E}
.cadv__save--error{color:#C4564B}
.cadv__grow{flex:1}
.cadv__acts{display:flex; gap:8px}
.cadv__acts button{height:34px; padding:0 14px; border:1px solid rgba(44,62,80,.14); border-radius:9px; background:#fff; font:inherit; font-size:12.5px; font-weight:540; color:#3E4C59; cursor:pointer}
.cadv__acts button:hover{background:#F4F6F9; color:#18222D}
.cadv__acts button.primary{background:#2C3E50; border-color:#2C3E50; color:#fff}
.cadv__acts button.primary:hover{background:#22303d}
.cadv__acts button:disabled{opacity:.5; cursor:default}
.cadv__open{position:absolute; top:54px; right:14px; width:300px; max-height:340px; overflow-y:auto; background:#fff; border:1px solid rgba(44,62,80,.14); border-radius:12px; box-shadow:0 12px 30px rgba(20,33,46,.16); z-index:20; padding:6px}
.cadv__open-head{padding:8px 10px 6px; font-family:var(--font-jetbrains-mono),monospace; font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:#8C97A3}
.cadv__open-empty{padding:10px; font-size:12.5px; color:#6E7B88}
.cadv__open-row{display:flex; align-items:center; gap:8px; width:100%; text-align:left; padding:8px 10px; border:0; border-radius:8px; background:transparent; font:inherit; cursor:pointer}
.cadv__open-row:hover{background:#F4F6F9}
.cadv__open-row .nm{flex:1; font-size:13px; color:#18222D; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.cadv__open-row .dt{font-family:var(--font-jetbrains-mono),monospace; font-size:10.5px; color:#8C97A3}
.cadv__open-row .del{width:20px; height:20px; display:flex; align-items:center; justify-content:center; border-radius:6px; color:#A6AEB6; font-size:15px}
.cadv__open-row .del:hover{background:rgba(196,86,75,.12); color:#C4564B}
.cadv__acts button.accent{background:#2C97A8; border-color:#2C97A8; color:#fff}
.cadv__acts button.accent:hover{background:#23808e}
.cadv__acts button.accent:disabled{opacity:.5; cursor:default}
.cadv__modal-bg{position:fixed; inset:0; background:rgba(16,24,32,.5); display:flex; align-items:center; justify-content:center; z-index:50}
.cadv__modal{width:420px; max-width:92vw; background:#fff; border-radius:16px; padding:22px; box-shadow:0 24px 60px rgba(16,24,32,.3)}
.cadv__modal .h{font-family:var(--font-space-grotesk),sans-serif; font-weight:600; font-size:18px; color:#18222D; margin-bottom:8px}
.cadv__modal p{font-size:13.5px; line-height:1.5; color:#54616E; margin:0 0 16px}
.cadv__modal .m-btn{display:flex; flex-direction:column; align-items:flex-start; width:100%; text-align:left; padding:12px 14px; margin-bottom:10px; border:1px solid rgba(44,62,80,.16); border-radius:11px; background:#fff; font:inherit; font-size:14px; font-weight:600; color:#18222D; cursor:pointer}
.cadv__modal .m-btn small{font-weight:400; font-size:12px; color:#8C97A3; margin-top:3px}
.cadv__modal .m-btn:hover{background:#F4F6F9}
.cadv__modal .m-btn.primary{background:#2C97A8; border-color:#2C97A8; color:#fff}
.cadv__modal .m-btn.primary small{color:rgba(255,255,255,.85)}
.cadv__modal .m-btn.primary:hover{background:#23808e}
.cadv__modal .m-cancel{width:100%; height:38px; border:0; background:transparent; font:inherit; font-size:13px; color:#6E7B88; cursor:pointer; margin-top:2px}
.cadv__modal .m-cancel:hover{color:#18222D}
.cadv__modal .m-btn:disabled{opacity:.5; cursor:default}
.cadv__gate-input{width:100%; height:42px; border:1px solid rgba(44,62,80,.18); border-radius:11px; padding:0 14px; font:inherit; font-size:15px; color:#18222D; margin-bottom:14px}
.cadv__gate-input:focus{outline:none; border-color:#3FB7C9; box-shadow:0 0 0 3px rgba(63,183,201,.18)}
.cadv__busy{position:fixed; inset:0; background:rgba(16,24,32,.55); display:flex; align-items:center; justify-content:center; z-index:60}
.cadv__busy .box{display:flex; align-items:center; gap:12px; background:#fff; padding:16px 22px; border-radius:12px; font-size:14px; color:#18222D; font-weight:540}
.cadv__busy .spin{width:18px; height:18px; border:2.5px solid rgba(44,62,80,.18); border-top-color:#2C97A8; border-radius:50%; animation:cadvspin .8s linear infinite}
@keyframes cadvspin{to{transform:rotate(360deg)}}
`;

