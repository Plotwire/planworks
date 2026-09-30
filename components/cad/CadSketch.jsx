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
  T_EXT, T_INT, DOOR_W, WIN_W, ptStr, hyp, segLen, snap, fmtMM,
  nearestWall, hitTest, joinWalls, pocheD, outlinePathD,
} from "@/lib/cad/plan";
import { listSketches, getSketchData, insertSketch, updateSketch, deleteSketch } from "@/lib/cad/sketchStore";
import { insertProject, getProjectData, updateProjectRow } from "@/lib/db";
import { uploadPlanImage, dataUrlToBlob } from "@/lib/planImages";
import { computeFrame, renderModelToPng } from "@/lib/cad/sketchToImage";
import { isTouchDevice } from "@/lib/touch";
import {
  ChevronLeft, FolderOpen, FilePlus, Save, Send, Undo2, Redo2, SlidersHorizontal, Grid3x3, Magnet, Compass,
  Maximize2, Trash2, BrickWall, DoorOpen, Tag as TagIcon, Type, MousePointer2, Hand, PencilRuler,
} from "lucide-react";
import {
  TopBarShell, TbGroup, TbButton, TbBrand, TbProjectPill, TbTrialSlot, TbMenu, TbMenuItem, TbPanelsItem, TbThemeItem,
  SidePanel, CollapsedPanel, Stat, PANEL_LABEL, panelChoice, PANEL_BTN, PANEL_BTN_DANGER,
  FloatingToolbar, WallTypeChooser, ZoomControls, StatusBar, StatusCount, SheetTabs,
} from "@/components/SheetParts";
import { useApp } from "@/components/AppShell";
import { TryPill, useTryUsage } from "@/components/TryMode";

// A composited layer for a canvas this size rasterises at reduced resolution on
// iOS Safari, which is why doing the zoom as an SVG <g> transform here was no
// sharper than the sheet's CSS transform. Off on touch: full resolution beats
// smooth panning on a drawing.
const PROMOTE = isTouchDevice() ? "auto" : "transform";

const SHEET = { x: -6000, y: -6000, w: 28000, h: 28000 };
const SCALE_MIN = 0.02, SCALE_MAX = 0.6;

// ------------------------- node renderers -------------------------
// Every wall drawn as one joined solid: a single poche path, then the outline
// of the union (mitred corners, T-junctions and crossings with no seams). The
// selected wall is outlined on top in the accent colour.
function WallsNode({ joined, selId }) {
  const selPoly = selId ? joined.polys[selId] : null;
  return (
    <g>
      <path d={pocheD(joined.polys)} className="cadv-poche" fillRule="nonzero" stroke="none" />
      <path d={outlinePathD(joined.outline)} className="cadv-ink" fill="none" strokeWidth={1.3}
        strokeLinejoin="miter" strokeMiterlimit={12} strokeLinecap="square" vectorEffect="non-scaling-stroke" />
      {selPoly && (
        <polygon points={ptStr(selPoly)} className="cadv-sel cadv-sel-fill" strokeWidth={2}
          strokeLinejoin="miter" strokeMiterlimit={12} vectorEffect="non-scaling-stroke" />
      )}
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

// Plan glyphs for the toolbar, drawn like lucide icons (24 grid, currentColor)
// so they sit in the shared TbButton next to lucide ones.
const glyph = (body) => function PlanGlyph({ size = 15, className = "" }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      {body}
    </svg>
  );
};
const WindowIcon = glyph(<g><rect x="3" y="7" width="18" height="10" /><path d="M3 12h18" /></g>);
const DimIcon = glyph(<g><path d="M4 12h16M4 8v8M20 8v8" /><path d="M7 10l-3 2 3 2M17 10l3 2-3 2" /></g>);

// Draw tools in the top bar (Select and Pan float on the canvas, as in the
// editor). Walls are one button; External / Internal is chosen beside the
// canvas while it is active.
const DRAW_TOOLS = [
  { id: "wall", icon: BrickWall, label: "Wall", key: "E / I" },
  { id: "door", icon: DoorOpen, label: "Door", key: "D" },
  { id: "window", icon: WindowIcon, label: "Window", key: "W" },
  { id: "dim", icon: DimIcon, label: "Dimension", key: "M" },
  { id: "room", icon: TagIcon, label: "Room label", key: "R" },
  { id: "text", icon: Type, label: "Note", key: "T" },
];
const CANVAS_TOOLS = [
  ["select", { icon: MousePointer2, label: "Select", hint: "V" }],
  ["pan", { icon: Hand, label: "Pan", hint: "H" }],
];
const TOOL_NAME = { select: "Select", pan: "Pan", ext: "External wall", int: "Internal wall", door: "Door", window: "Window", dim: "Dimension", room: "Room label", text: "Note" };

const LAYER_LIST = [
  ["walls", "Walls"],
  ["openings", "Doors & windows"],
  ["dims", "Dimensions"],
  ["rooms", "Rooms & notes"],
  ["stairs", "Stairs & fittings"],
  ["boundary", "Site boundary"],
  ["grid", "Grid"],
];

const SAVE_LABEL = { idle: "NOT SAVED", unsaved: "UNSAVED CHANGES", saving: "SAVING…", saved: "SAVED", error: "SAVE FAILED" };

// The editor's workspace surround and grid (components/SheetParts.jsx).
const SURROUND = "radial-gradient(circle at 50% 50%, #e2e8f0, #cbd5e1 90%)";
const GRID_LINE = "rgba(37,99,235,0.18)";
const GRID_MM = 500;

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
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const [panelsHidden, setPanelsHidden] = useState(false);
  const [inspectorHidden, setInspectorHidden] = useState(false);
  const doSaveRef = useRef(null);

  viewRef.current = view;

  const { theme, toggleTheme, access = {} } = useApp();
  // Try mode: the Trial pill shows the account's symbols across saved drawings
  // (a sketch places none), same pill and Subscribe as the editor.
  const tryUsage = useTryUsage({ enabled: access.isTry, limit: access.symbolLimit, currentProjectId: null, project: null });

  // Undo / redo: every edit goes through change(); opening or starting a
  // sketch clears the history.
  const modelRef = useRef(model);
  modelRef.current = model;
  const histRef = useRef({ past: [], future: [] });
  const [, setHistVer] = useState(0);
  const change = (fn) => {
    const cur = modelRef.current, next = fn(cur);
    if (next === cur) return;
    const h = histRef.current;
    h.past.push(cur); if (h.past.length > 200) h.past.shift();
    h.future = [];
    modelRef.current = next; setModel(next); setHistVer((v) => v + 1);
  };
  const step = (from, to) => {
    const h = histRef.current;
    if (!h[from].length) return;
    const m = h[from].pop();
    h[to].push(modelRef.current);
    modelRef.current = m; setModel(m); setSel(null); setDraftPts([]); setDimP1(null); setHistVer((v) => v + 1);
  };
  const undo = () => step("past", "future");
  const redo = () => step("future", "past");
  const resetHistory = () => { histRef.current = { past: [], future: [] }; setHistVer((v) => v + 1); };

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
      const k = e.key.toLowerCase();
      if (e.metaKey || e.ctrlKey) {
        if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
        else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(); }
        else if (k === "s") { e.preventDefault(); doSaveRef.current && doSaveRef.current(); }
        return;
      }
      if (e.altKey) return;
      const map = { v: "select", e: "ext", i: "int", d: "door", w: "window", m: "dim", r: "room", t: "text", h: "pan" };
      if (map[k]) { setTool(map[k]); setDraftPts([]); setDimP1(null); }
      else if (e.key === "Escape") { setDraftPts([]); setDimP1(null); setSel(null); setTool("select"); }
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
  // Snap to an existing wall end within 12px on screen. Wins over angle lock
  // and grid, so walls (diagonal ones included) can always meet exactly.
  const endpointSnap = (raw) => {
    let best = null, bd = 12 / viewRef.current.s;
    for (const w of model.walls) for (const [x, y] of [[w.x1, w.y1], [w.x2, w.y2]]) {
      const d = hyp(raw.x - x, raw.y - y);
      if (d < bd) { bd = d; best = { x, y, ep: true }; }
    }
    return best;
  };
  const wallPoint = (raw, from) => endpointSnap(raw) || snapPt(raw, from);
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
    const p = isWallTool ? wallPoint(raw, from) : (flags.gridSnap ? { x: snap(raw.x, settings.grid), y: snap(raw.y, settings.grid) } : raw);
    setCur({ x: p.x, y: p.y, sx: e.clientX, sy: e.clientY, on: true, ep: !!p.ep });
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
    change((m) => ({ ...m, walls: m.walls.concat([seg]) }));
  };
  // One action per tool pick: once a wall, door, window, dimension, room label
  // or note is placed, drop back to Select. Pick the tool again for the next one.
  const finishAction = () => { setDraftPts([]); setDimP1(null); setTool("select"); };
  const handleClick = (e) => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    if (panRef.current) return;
    const raw = toWorld(e.clientX, e.clientY);
    if (isWallTool) {
      const from = draftPts.length ? draftPts[draftPts.length - 1] : null;
      const p = wallPoint(raw, from);
      if (!from) { setDraftPts([p]); return; }
      if (p.x === from.x && p.y === from.y) return; // zero length: keep waiting for the end point
      commitWallSeg(from, p);
      finishAction();
      return;
    }
    if (tool === "door" || tool === "window") {
      const nw = nearestWall(model.walls, raw.x, raw.y);
      if (!nw) return;
      const t = nw.seg.type === "external" ? T_EXT : T_INT;
      if (tool === "door") {
        const d = { id: "D" + Date.now(), x: Math.round(nw.cx), y: Math.round(nw.cy), dir: nw.dir, w: settings.doorW, t, hinge: -1, fold: 1, ref: "" };
        change((m) => ({ ...m, doors: m.doors.concat([d]) }));
      } else {
        const wn = { id: "W" + Date.now(), x: Math.round(nw.cx), y: Math.round(nw.cy), dir: nw.dir, w: settings.winW, t, escape: false, ref: "" };
        change((m) => ({ ...m, windows: m.windows.concat([wn]) }));
      }
      finishAction();
      return;
    }
    if (tool === "dim") {
      const pp = flags.gridSnap ? { x: snap(raw.x, settings.grid), y: snap(raw.y, settings.grid) } : raw;
      if (!dimP1) { setDimP1(pp); }
      else {
        const horiz = Math.abs(pp.x - dimP1.x) >= Math.abs(pp.y - dimP1.y);
        const nd = { id: "M" + Date.now(), x1: dimP1.x, y1: dimP1.y, x2: pp.x, y2: pp.y, side: horiz ? "top" : "left", off: 700 };
        change((m) => ({ ...m, dims: m.dims.concat([nd]) }));
        finishAction();
      }
      return;
    }
    if (tool === "room" || tool === "text") {
      const nm = tool === "room" ? (window.prompt("Room name", "New room") || "") : (window.prompt("Note text", "") || "");
      if (!nm) return;
      if (tool === "room") change((m) => ({ ...m, rooms: m.rooms.concat([{ name: nm, area: 0, x: Math.round(raw.x), y: Math.round(raw.y) }]) }));
      else change((m) => ({ ...m, notes: m.notes.concat([{ text: nm, x: Math.round(raw.x), y: Math.round(raw.y) }]) }));
      finishAction();
      return;
    }
    if (tool === "select") {
      const op = openingAt(raw.x, raw.y);
      setSel(op || hitTest(model.walls, raw.x, raw.y));
    }
  };

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
    change((m) => {
      if (sel.kind === "door") return { ...m, doors: m.doors.filter((d) => d.id !== sel.id) };
      if (sel.kind === "window") return { ...m, windows: m.windows.filter((w) => w.id !== sel.id) };
      return { ...m, walls: m.walls.filter((w) => w.id !== sel.id) };
    });
    setSel(null);
  };
  const convertSel = () => {
    if (!sel || sel.kind !== "wall") return;
    change((m) => ({ ...m, walls: m.walls.map((w) => w.id === sel.id ? { ...w, type: w.type === "external" ? "internal" : "external" } : w) }));
  };
  const updDoor = (fn) => {
    if (!sel || sel.kind !== "door") return;
    change((m) => ({ ...m, doors: m.doors.map((d) => d.id === sel.id ? { ...d, ...fn(d) } : d) }));
  };
  const flipSwing = () => updDoor((d) => ({ fold: -d.fold }));
  const flipHinge = () => updDoor((d) => ({ hinge: -d.hinge }));
  const toggleEscape = () => {
    if (!sel || sel.kind !== "window") return;
    change((m) => ({ ...m, windows: m.windows.map((w) => w.id === sel.id ? { ...w, escape: !w.escape } : w) }));
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
    try {
      await persistSketch(); setSaveState("saved");
      setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1400);
    }
    catch (e) { console.error(e); setSaveState("error"); window.alert("Couldn't save: " + (e.message || e)); }
  };
  doSaveRef.current = doSave;
  const refreshList = async () => { try { setSketches(await listSketches()); } catch (e) { console.warn(e); } };
  const doNew = () => {
    skipDirty.current = true;
    setModel(blankModel()); resetHistory();
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
      setModel({ ...blankModel(), ...geo }); resetHistory();
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
      setModel({ ...blankModel(), ...geo }); resetHistory();
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

  const joined = useMemo(() => joinWalls(model.walls), [model.walls]);
  const planEls = useMemo(() => {
    const g = [];
    g.push(<rect key="sheet" x={SHEET.x} y={SHEET.y} width={SHEET.w} height={SHEET.h} fill="none" stroke="#B8C3CF" strokeWidth={1} vectorEffect="non-scaling-stroke" />);
    if (layers.boundary && model.boundary) g.push(<polyline key="bnd" points={ptStr(model.boundary)} className="cadv-boundary" fill="none" strokeWidth={1.4} strokeDasharray="14 10" vectorEffect="non-scaling-stroke" />);
    if (layers.stairs) (model.rooflights || []).forEach((rl) => g.push(
      <g key={rl.ref}>
        <rect x={rl.x} y={rl.y} width={rl.w} height={rl.h} fill="none" className="cadv-ink" strokeWidth={0.8} strokeDasharray="20 14" vectorEffect="non-scaling-stroke" opacity={0.6} />
        <text x={rl.x + rl.w / 2} y={rl.y + rl.h / 2} className="cadv-note" fontSize={150} textAnchor="middle" fontWeight={600}>{rl.ref}</text>
      </g>));
    if (layers.walls) g.push(<WallsNode key="walls" joined={joined} selId={sel && sel.kind === "wall" ? sel.id : null} />);
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
  }, [model, sel, layers, joined]);

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
    if (isWallTool && cur.ep) overlay.push(<rect key="ep" x={cur.x - 9 / view.s} y={cur.y - 9 / view.s} width={18 / view.s} height={18 / view.s} fill="none" className="cadv-active" strokeWidth={2} vectorEffect="non-scaling-stroke" />);
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
    select: "Click a wall, door or window to select it. Shift-drag to pan.",
    ext: draftPts.length ? "Click the end point - Esc to cancel" : "Click the start point of an external wall",
    int: draftPts.length ? "Click the end point - Esc to cancel" : "Click the start point of an internal wall",
    door: "Click on a wall to place a door",
    window: "Click on a wall to place a window",
    dim: dimP1 ? "Click the second measure point" : "Click the first measure point",
    room: "Click inside a space to drop a room label",
    text: "Click to place a note",
    pan: "Drag to pan the sheet",
  }[tool];

  const pickTool = (id) => {
    const t = id === "wall" ? (tool === "int" ? "int" : "ext") : id;
    setTool(t); setDraftPts([]); setDimP1(null);
  };
  const goBack = () => (embedded ? (onClose && onClose()) : router.push("/"));
  const openRename = () => { setRenameDraft(sketchName); setRenameOpen(true); };
  const commitRename = () => {
    const nm = renameDraft.trim();
    if (!nm) return;
    if (nm !== sketchName) { setSketchName(nm); setSaveState((st) => (st === "saving" ? st : "unsaved")); }
    setRenameOpen(false);
  };
  const subscribe = () => { access.openSubscribe && access.openSubscribe(); };
  const canUndo = histRef.current.past.length > 0, canRedo = histRef.current.future.length > 0;

  const svgCursor = tool === "pan" ? "grab" : (drawingTool ? "crosshair" : "default");
  const gridSz = GRID_MM * view.s;
  const sL = view.tx + SHEET.x * view.s, sT = view.ty + SHEET.y * view.s;
  const sR = view.tx + (SHEET.x + SHEET.w) * view.s, sB = view.ty + (SHEET.y + SHEET.h) * view.s;
  const clipRect = `polygon(${sL}px ${sT}px, ${sR}px ${sT}px, ${sR}px ${sB}px, ${sL}px ${sB}px)`;
  // White sheet (like the editor's paper) with the editor's grid over it.
  const gridStyle = {
    backgroundColor: "#FFFFFF",
    backgroundImage: layers.grid
      ? `linear-gradient(to right, ${GRID_LINE} 1px, transparent 1px), linear-gradient(to bottom, ${GRID_LINE} 1px, transparent 1px)`
      : "none",
    backgroundSize: `${gridSz}px ${gridSz}px`,
    backgroundPosition: `${view.tx}px ${view.ty}px`,
    clipPath: clipRect, WebkitClipPath: clipRect,
  };
  const choiceRow = (opts, value, set, fmt = (v) => v) => (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${opts.length}, minmax(0, 1fr))` }}>
      {opts.map((v) => <button key={v} onClick={() => set(v)} className={panelChoice(value === v)}>{fmt(v)}</button>)}
    </div>
  );
  const rule = "pt-3 border-t border-slate-200 dark:border-[#263441]";

  return (
    <div className="cadv absolute inset-0 flex flex-col bg-slate-100 text-slate-900 dark:bg-[#0E141B] dark:text-slate-100 overflow-hidden select-none"
         style={{ fontFamily: "var(--font-inter), ui-sans-serif, system-ui, -apple-system, sans-serif" }}>
      <style>{CSS}</style>

      {/* ==================== TOP BAR (shared with the editor) ==================== */}
      <TopBarShell>
        <TbGroup first>
          <TbButton onClick={goBack} icon={ChevronLeft} label={embedded ? "Drawing" : "Dashboard"} title={embedded ? "Back to the drawing" : "Back to dashboard"} />
          <TbBrand />
          <TbProjectPill label={sketchName || "Untitled sketch"} title="Rename this sketch" onClick={openRename} icon={PencilRuler} />
        </TbGroup>

        <TbGroup label="File">
          <TbMenu icon={FolderOpen} label="Open" title="Open a saved sketch, or start a new one" width="w-72"
            open={openPanel} onOpenChange={(n) => { setOpenPanel(n); if (n) refreshList(); }}>
            {(close) => (
              <>
                <TbMenuItem icon={FilePlus} label="New sketch" onClick={() => { close(); doNew(); }} />
                <div className="my-1 h-px bg-slate-200 dark:bg-[#2A3947]" />
                <div className={`${PANEL_LABEL} px-3 pt-1.5 pb-1`}>Your sketches</div>
                <div className="max-h-72 overflow-y-auto">
                  {sketches.length === 0 ? (
                    <div className="px-3 py-2 text-[12px] text-slate-500 dark:text-slate-400">No saved sketches yet.</div>
                  ) : sketches.map((sk) => (
                    <div key={sk.id} className="flex items-center rounded-lg hover:bg-[#ECF8FA] dark:hover:bg-white/10">
                      <button type="button" role="menuitem" onClick={() => { close(); doLoad(sk.id); }}
                        className="flex-1 min-w-0 flex items-center gap-2 px-3 h-9 text-left">
                        <span className="flex-1 truncate text-[12px] font-medium text-slate-700 dark:text-slate-200">{sk.name}</span>
                        <span className="text-[10px] text-slate-400 tabular-nums" style={{ fontFamily: "var(--font-jetbrains-mono), monospace" }}>{new Date(sk.updatedAt).toLocaleDateString("en-GB")}</span>
                      </button>
                      <button type="button" title="Delete sketch" onClick={(e) => doDelete(sk.id, e)}
                        className="w-7 h-7 mr-1 flex items-center justify-center rounded-md text-slate-400 hover:text-red-500 hover:bg-red-500/10">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </TbMenu>
          <TbButton onClick={doSave} icon={Save} label={saveState === "saving" ? "Saving…" : savedFlash ? "Saved ✓" : "Save"} title="Save (⌘S)" flash={savedFlash} disabled={saveState === "saving"} />
          <TbButton onClick={openUsePlan} icon={Send} label="Use this plan" shortLabel="Use plan" title="Send this plan to the electrical drawing" disabled={!!planBusy} />
        </TbGroup>

        <TbGroup label="Draw">
          {DRAW_TOOLS.map((t) => (
            <TbButton key={t.id} collapse icon={t.icon} label={t.label} title={`${t.label} (${t.key})`}
              active={t.id === "wall" ? isWallTool : tool === t.id} onClick={() => pickTool(t.id)} />
          ))}
        </TbGroup>

        <TbGroup label="Edit">
          <TbButton onClick={undo} icon={Undo2} title="Undo (⌘Z)" iconOnly disabled={!canUndo} />
          <TbButton onClick={redo} icon={Redo2} title="Redo (⌘⇧Z)" iconOnly disabled={!canRedo} />
        </TbGroup>

        <TbGroup label="View">
          <TbMenu icon={SlidersHorizontal} label="View" title="View options">
            <TbMenuItem icon={Grid3x3} label="Grid" checked={layers.grid} onClick={() => setLayers((l) => ({ ...l, grid: !l.grid }))} />
            <TbMenuItem icon={Magnet} label="Snap to grid" checked={flags.gridSnap} onClick={() => setFlags((f) => ({ ...f, gridSnap: !f.gridSnap }))} />
            <TbMenuItem icon={Compass} label="Lock angles (45°)" checked={flags.ortho} onClick={() => setFlags((f) => ({ ...f, ortho: !f.ortho }))} />
            <TbMenuItem icon={Maximize2} label="Zoom to fit" onClick={() => fit()} />
            <TbPanelsItem hidden={panelsHidden} onClick={() => setPanelsHidden((h) => !h)} />
            <TbThemeItem theme={theme} onClick={toggleTheme} />
          </TbMenu>
        </TbGroup>

        <TbTrialSlot>{access.isTry ? <TryPill used={tryUsage.used} limit={tryUsage.limit} onSubscribe={subscribe} /> : null}</TbTrialSlot>
      </TopBarShell>

      <div className="relative z-10 flex-1 flex overflow-hidden">
        {/* ==================== LEFT PANEL ==================== */}
        {!panelsHidden && (
          <SidePanel side="left" title="Floor plan" eyebrow="SKETCH">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div>
                <div className={`${PANEL_LABEL} mb-2`}>Snap grid</div>
                {choiceRow([50, 100, 250], settings.grid, (v) => setSettings((s) => ({ ...s, grid: v })), (v) => v + " mm")}
              </div>
              <div className={rule}>
                <div className={`${PANEL_LABEL} mb-2`}>Drawing aids</div>
                <div className="grid grid-cols-2 gap-1">
                  <button onClick={() => setFlags((f) => ({ ...f, ortho: !f.ortho }))} className={panelChoice(flags.ortho)}>Lock angles</button>
                  <button onClick={() => setFlags((f) => ({ ...f, gridSnap: !f.gridSnap }))} className={panelChoice(flags.gridSnap)}>Snap</button>
                </div>
              </div>
              <div className={rule}>
                <div className={`${PANEL_LABEL} mb-1.5`}>Layers</div>
                <div className="flex flex-col">
                  {LAYER_LIST.map(([id, label]) => (
                    <button key={id} onClick={() => setLayers((l) => ({ ...l, [id]: !l[id] }))}
                      className={`flex items-center gap-2.5 px-2 h-8 rounded-md text-[12px] text-left transition-colors hover:bg-slate-200/60 dark:hover:bg-white/5 ${layers[id] ? "text-slate-800 dark:text-slate-100" : "text-slate-400 dark:text-slate-500"}`}>
                      <span className={`w-2.5 h-2.5 rounded-[3px] shrink-0 ring-1 ${layers[id] ? "bg-[#3FB7C9] ring-[#3FB7C9]" : "bg-transparent ring-slate-300 dark:ring-slate-600"}`} />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="border-t border-slate-200 dark:border-[#263441] px-4 py-3 bg-[#E3EAF3] dark:bg-[#141C24] text-[9px] text-slate-500 leading-relaxed">
              Pick a tool and place it; the tool then goes back to Select. Esc cancels.
            </div>
          </SidePanel>
        )}

        {/* ==================== CANVAS ==================== */}
        <main className="flex-1 relative overflow-hidden bg-slate-200 dark:bg-[#0B1117] flex flex-col">
          <SheetTabs label="Plan" sheets={[{ id: "plan", name: sketchName || "Untitled sketch" }]} activeId="plan"
            onSwitch={() => {}} onDelete={() => {}}
            onRename={(_, nm) => { if (nm !== sketchName) { setSketchName(nm); setSaveState((st) => (st === "saving" ? st : "unsaved")); } }} />
          <div className="relative flex-1 overflow-hidden">
          <div ref={wrapRef} className="absolute inset-0 overflow-hidden" style={{ background: SURROUND }}>
            <div ref={gridRef} style={{ position: "absolute", inset: 0, pointerEvents: "none", transformOrigin: "0 0", willChange: PROMOTE, ...gridStyle }} />
            <svg ref={svgRef} className="cadv__svg" width="100%" height="100%" style={{ cursor: svgCursor, transformOrigin: "0 0", willChange: PROMOTE }}
              onPointerDown={handleDown} onPointerMove={handleMove} onPointerUp={handleUp} onPointerCancel={handleUp}
              onClick={handleClick}
              onPointerLeave={() => setCur((c) => ({ ...c, on: false }))}>
              <g ref={gRef}>
                {planEls}
                {overlay}
              </g>
            </svg>
            {hud}
          </div>

          <FloatingToolbar tool={tool} setTool={pickTool} tools={CANVAS_TOOLS} />
          {isWallTool && (
            <WallTypeChooser className="top-4 left-16" value={tool === "int" ? "internal" : "external"}
              onChange={(t) => pickTool(t === "internal" ? "int" : "ext")}
              hint={draftPts.length ? "click end · Esc cancels" : `click start · click end · ${tool === "int" ? T_INT : T_EXT} mm`} />
          )}
          <ZoomControls zoom={view.s / 0.08} onIn={() => zoomBy(1.2)} onOut={() => zoomBy(1 / 1.2)} onFit={() => fit()} />
          <div className="absolute left-4 bottom-11 z-20 flex items-center gap-3 px-3 h-8 bg-white dark:bg-[#16202B] rounded-xl ring-1 ring-slate-200/70 dark:ring-[#2A3947] shadow-[0_10px_30px_-10px_rgba(16,28,40,0.22)] text-[10px] text-slate-600 dark:text-slate-300"
               style={{ fontFamily: "var(--font-jetbrains-mono), monospace" }}>
            <span className="font-semibold">N &#8593;</span>
            <span className="inline-flex h-1.5 ring-1 ring-slate-400"><i className="w-5 bg-slate-600 dark:bg-slate-300" /><i className="w-5 bg-white dark:bg-[#16202B]" /><i className="w-5 bg-slate-600 dark:bg-slate-300" /></span>
            <span>0 1 2 m</span>
          </div>

          <StatusBar right={<>X {Math.round(cur.x)} Y {Math.round(cur.y)} · GRID {settings.grid}MM · <span className={saveState === "unsaved" || saveState === "error" ? "text-amber-600" : ""}>{SAVE_LABEL[saveState]}</span></>}>
            <StatusCount label="WALLS" value={model.walls.length} />
            <StatusCount label="DOORS" value={model.doors.length} />
            <StatusCount label="WINDOWS" value={model.windows.length} />
            <span>TOOL <span className="text-[#22808F] ml-1">{TOOL_NAME[tool].toUpperCase()}</span></span>
            <span className="text-[#22808F]">{hint}</span>
          </StatusBar>
          </div>
        </main>

        {/* ==================== RIGHT INSPECTOR ==================== */}
        {!panelsHidden && (inspectorHidden ? (
          <CollapsedPanel onExpand={() => setInspectorHidden(false)} />
        ) : (
          <SidePanel side="right" title="Inspector" onCollapse={() => setInspectorHidden(true)}>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {selWall ? (
                <>
                  <div>
                    <div className={`${PANEL_LABEL} mb-2`}>Wall</div>
                    <div className="grid grid-cols-2 gap-2">
                      <Stat label="Length" value={fmtMM(segLen(selWall)) + " mm"} />
                      <Stat label="Thickness" value={(selWall.type === "external" ? T_EXT : T_INT) + " mm"} />
                    </div>
                  </div>
                  <div className={rule}>
                    <div className={`${PANEL_LABEL} mb-2`}>Type</div>
                    <div className="grid grid-cols-2 gap-1">
                      {["external", "internal"].map((t) => (
                        <button key={t} onClick={() => selWall.type !== t && convertSel()} className={panelChoice(selWall.type === t)}>{t === "external" ? "External" : "Internal"}</button>
                      ))}
                    </div>
                  </div>
                  <div className={rule}>
                    <button onClick={deleteSel} className={`w-full ${PANEL_BTN_DANGER}`}><Trash2 size={12} /> Delete wall</button>
                  </div>
                </>
              ) : selDoor ? (
                <>
                  <div>
                    <div className={`${PANEL_LABEL} mb-2`}>Door</div>
                    <div className="grid grid-cols-2 gap-2">
                      <Stat label="Width" value={selDoor.w + " mm"} />
                      <Stat label="Wall" value={selDoor.t === T_EXT ? "External" : "Internal"} />
                    </div>
                  </div>
                  <div className={rule}>
                    <div className={`${PANEL_LABEL} mb-2`}>Swing</div>
                    <div className="flex gap-2">
                      <button onClick={flipSwing} className={`flex-1 ${PANEL_BTN}`}>Flip side</button>
                      <button onClick={flipHinge} className={`flex-1 ${PANEL_BTN}`}>Flip hinge</button>
                    </div>
                    <div className="text-[10px] text-slate-600 dark:text-slate-300 mt-2 leading-relaxed">Flip side swaps which room the door opens into; flip hinge swaps the hinged edge. Between them you get all four swings.</div>
                  </div>
                  <div className={rule}>
                    <button onClick={deleteSel} className={`w-full ${PANEL_BTN_DANGER}`}><Trash2 size={12} /> Delete door</button>
                  </div>
                </>
              ) : selWin ? (
                <>
                  <div>
                    <div className={`${PANEL_LABEL} mb-2`}>Window</div>
                    <div className="grid grid-cols-2 gap-2">
                      <Stat label="Width" value={selWin.w + " mm"} />
                      <Stat label="Wall" value={selWin.t === T_EXT ? "External" : "Internal"} />
                    </div>
                  </div>
                  <div className={rule}>
                    <div className={`${PANEL_LABEL} mb-2`}>Marking</div>
                    <button onClick={toggleEscape} className={`w-full ${panelChoice(selWin.escape)}`}>Escape window</button>
                  </div>
                  <div className={rule}>
                    <button onClick={deleteSel} className={`w-full ${PANEL_BTN_DANGER}`}><Trash2 size={12} /> Delete window</button>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <div className={`${PANEL_LABEL} mb-2`}>Tool</div>
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{TOOL_NAME[tool]}</div>
                    <div className="text-[10px] text-slate-600 dark:text-slate-300 mt-1.5 leading-relaxed">{hint}</div>
                  </div>
                  {isWallTool && (
                    <div className={rule}>
                      <div className={`${PANEL_LABEL} mb-2`}>Wall type</div>
                      <div className="grid grid-cols-2 gap-1">
                        <button onClick={() => pickTool("ext")} className={panelChoice(tool === "ext")}>External · {T_EXT}</button>
                        <button onClick={() => pickTool("int")} className={panelChoice(tool === "int")}>Internal · {T_INT}</button>
                      </div>
                    </div>
                  )}
                  {tool === "door" && (
                    <div className={rule}>
                      <div className={`${PANEL_LABEL} mb-2`}>Door width</div>
                      {choiceRow([760, 850, 960], settings.doorW, (v) => setSettings((s) => ({ ...s, doorW: v })))}
                    </div>
                  )}
                  {tool === "window" && (
                    <div className={rule}>
                      <div className={`${PANEL_LABEL} mb-2`}>Window width</div>
                      {choiceRow([600, 900, 1200], settings.winW, (v) => setSettings((s) => ({ ...s, winW: v })))}
                    </div>
                  )}
                  <div className={rule}>
                    <div className={`${PANEL_LABEL} mb-2`}>Plan</div>
                    <div className="grid grid-cols-3 gap-2">
                      <Stat label="Walls" value={model.walls.length} />
                      <Stat label="Doors" value={model.doors.length} />
                      <Stat label="Windows" value={model.windows.length} />
                    </div>
                  </div>
                </>
              )}
            </div>
          </SidePanel>
        ))}
      </div>

      {(nameGate || renameOpen) && (
        <div className="cadv__modal-bg">
          <div className="cadv__modal">
            <div className="h">{nameGate ? "Name your drawing" : "Rename sketch"}</div>
            <p>{nameGate ? "Give this plan a name so it's easy to find later and saved safely. You can rename it any time." : "The new name is kept when you next save."}</p>
            {nameGate ? (
              <>
                <input className="cadv__gate-input" autoFocus value={sketchName} placeholder="e.g. 24 High Street - First floor" onChange={(e) => setSketchName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && sketchName.trim()) startNamed(); }} />
                <button className="m-btn primary" disabled={!sketchName.trim()} onClick={startNamed}>Start drawing</button>
                <button className="m-cancel" onClick={() => { setNameGate(false); setOpenPanel(true); refreshList(); }}>Open a saved drawing instead</button>
              </>
            ) : (
              <>
                <input className="cadv__gate-input" autoFocus value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenameOpen(false); }} />
                <button className="m-btn primary" disabled={!renameDraft.trim()} onClick={commitRename}>Rename</button>
                <button className="m-cancel" onClick={() => setRenameOpen(false)}>Cancel</button>
              </>
            )}
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

// Only what Tailwind can't reach: the plan's SVG ink classes, the cursor HUD
// and the dialogs. Toolbar, panels, zoom and status bar are the editor's own
// components (components/SheetParts.jsx).
const CSS = `
.cadv *{box-sizing:border-box}
.cadv__svg{position:absolute; inset:0; width:100%; height:100%; display:block; touch-action:none}
.cadv-ink{stroke:#16212B}
.cadv-poche{fill:#C9D0D8}
.cadv-paper{fill:#FFFFFF}
.cadv-sel{stroke:#3FB7C9}
.cadv-sel-fill{fill:rgba(63,183,201,.18)}
.cadv-active{stroke:#3FB7C9}
.cadv-cross{stroke:#2C3E50}
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
.cadv__modal-bg{position:fixed; inset:0; background:rgba(15,23,42,.5); backdrop-filter:blur(3px); display:flex; align-items:center; justify-content:center; z-index:50; padding:16px}
.cadv__modal{width:420px; max-width:100%; background:#fff; border-radius:16px; padding:24px 24px 20px; box-shadow:0 24px 60px -20px rgba(0,0,0,.45); color:#0E141B; user-select:text}
.cadv__modal .h{font-family:var(--font-space-grotesk),sans-serif; font-weight:600; font-size:19px; margin-bottom:8px}
.cadv__modal p{font-size:13.5px; line-height:1.55; color:#3A4654; margin:0 0 16px}
.cadv__modal .m-btn{display:flex; flex-direction:column; align-items:flex-start; width:100%; text-align:left; padding:12px 14px; margin-bottom:10px; border:0; border-radius:10px; background:#F1F5F9; font:inherit; font-size:14px; font-weight:600; color:#1A2530; cursor:pointer}
.cadv__modal .m-btn small{font-weight:500; font-size:12px; opacity:.75; margin-top:3px}
.cadv__modal .m-btn:hover{background:#E2E8F0}
.cadv__modal .m-btn.primary{background:var(--action,#2C97A8); color:var(--action-ink,#1A2530)}
.cadv__modal .m-btn.primary:hover{background:var(--action-hover,#22808F)}
.cadv__modal .m-btn:disabled{opacity:.5; cursor:default}
.cadv__modal .m-cancel{width:100%; height:38px; border:0; background:transparent; font:inherit; font-size:13px; color:#54616E; cursor:pointer; margin-top:2px}
.cadv__modal .m-cancel:hover{color:#0E141B}
.cadv__gate-input{width:100%; height:42px; border:0; box-shadow:inset 0 0 0 1px #CBD5E1; border-radius:10px; padding:0 14px; font:inherit; font-size:15px; color:#0E141B; background:#fff; margin-bottom:14px}
.cadv__gate-input:focus{outline:none; box-shadow:inset 0 0 0 1px #3FB7C9, 0 0 0 3px rgba(63,183,201,.18)}
.cadv__busy{position:fixed; inset:0; background:rgba(15,23,42,.5); backdrop-filter:blur(3px); display:flex; align-items:center; justify-content:center; z-index:60}
.cadv__busy .box{display:flex; align-items:center; gap:12px; background:#fff; padding:16px 22px; border-radius:12px; font-size:14px; color:#0E141B; font-weight:600}
.cadv__busy .spin{width:18px; height:18px; border:2.5px solid rgba(44,62,80,.18); border-top-color:#2C97A8; border-radius:50%; animation:cadvspin .8s linear infinite}
@keyframes cadvspin{to{transform:rotate(360deg)}}
html.dark .cadv__modal, html.dark .cadv__busy .box{background:#16202B; color:#E7EDF3}
html.dark .cadv__modal p{color:#B6C2CE}
html.dark .cadv__modal .m-btn{background:#22303D; color:#E7EDF3}
html.dark .cadv__modal .m-btn:hover{background:#2A3947}
html.dark .cadv__modal .m-btn.primary{background:var(--action,#2C97A8); color:var(--action-ink,#1A2530)}
html.dark .cadv__modal .m-cancel{color:#B6C2CE}
html.dark .cadv__modal .m-cancel:hover{color:#fff}
html.dark .cadv__gate-input{background:#0E141B; color:#E7EDF3; box-shadow:inset 0 0 0 1px #2A3947}
`;
