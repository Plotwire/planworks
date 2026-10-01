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
  T_EXT, T_INT, DOOR_W, WIN_W, ptStr, wallStyleOf, hyp, segLen, snap, fmtMM,
  nearestWall, hitTest, joinWalls, pocheD, outlinePathD,
} from "@/lib/cad/plan";
import { findNode, endAt, moveNode, moveWall } from "@/lib/cad/edit";
import { angled, placeOpening, openingHost, slideOpening, planCentre, openingSide } from "@/lib/cad/openings";
import { listSketches, getSketchData, insertSketch, updateSketch, deleteSketch } from "@/lib/cad/sketchStore";
import { insertProject, getProjectData, updateProjectRow } from "@/lib/db";
import { uploadPlanImage, dataUrlToBlob } from "@/lib/planImages";
import { computeFrame, renderModelToPng } from "@/lib/cad/sketchToImage";
import { isTouchDevice } from "@/lib/touch";
import {
  ChevronLeft, FolderOpen, FilePlus, Save, Send, Undo2, Redo2, SlidersHorizontal, Grid3x3, Magnet, Compass,
  Maximize2, Trash2, Eye, EyeOff, BrickWall, DoorOpen, Tag as TagIcon, Type, MousePointer2, Hand, PencilRuler,
} from "lucide-react";
import {
  TopBarShell, TbGroup, TbButton, TbBrand, TbProjectPill, TbTrialSlot, TbMenu, TbMenuItem, TbPanelsItem, TbThemeItem,
  SidePanel, CollapsedPanel, PANEL_LABEL, PANEL_HELP, SectionLabel, ChoiceGroup, ToggleRow, ScheduleRows, PanelAction,
  FloatingToolbar, ZoomControls, StatusBar, StatusCount, SheetTabs,
} from "@/components/SheetParts";
import { useApp } from "@/components/AppShell";
import { TryPill, useTryUsage } from "@/components/TryMode";

// A composited layer for a canvas this size rasterises at reduced resolution on
// iOS Safari, which is why doing the zoom as an SVG <g> transform here was no
// sharper than the sheet's CSS transform. Off on touch: full resolution beats
// smooth panning on a drawing.
const PROMOTE = isTouchDevice() ? "auto" : "transform";

const SCALE_MIN = 0.02, SCALE_MAX = 0.6;

// ------------------------- node renderers -------------------------
// Every wall drawn as one joined solid: a single poche path, then the outline
// of the union (mitred corners, T-junctions and crossings with no seams). The
// selected wall is outlined on top in the accent colour.
function WallsNode({ joined, selId, solid }) {
  const selPoly = selId ? joined.polys[selId] : null;
  return (
    <g>
      <path d={pocheD(joined.polys)} className={solid ? "cadv-poche-solid" : "cadv-poche"} fillRule="nonzero" stroke="none" />
      <path d={outlinePathD(joined.outline)} className="cadv-ink" fill="none" strokeWidth={1.3}
        strokeLinejoin="miter" strokeMiterlimit={12} strokeLinecap="square" vectorEffect="non-scaling-stroke" />
      {selPoly && (
        <polygon points={ptStr(selPoly)} className="cadv-sel cadv-sel-fill" strokeWidth={2}
          strokeLinejoin="miter" strokeMiterlimit={12} vectorEffect="non-scaling-stroke" />
      )}
    </g>
  );
}

// In an angled wall a door / window is its 'h' form drawn about its centre and
// turned with the wall (lib/cad/openings); hinge and fold are in that frame.
const turnedAt = (o) => `translate(${o.x} ${o.y}) rotate(${o.ang})`;

function DoorNode({ d, selected }) {
  if (angled(d)) return <g transform={turnedAt(d)}><DoorNode d={{ ...d, x: 0, y: 0, dir: "h", ang: undefined }} selected={selected} /></g>;
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

// side (angled only, see openingSide): which side of the wall the escape label runs along.
function WindowNode({ wn, selected, side = 1 }) {
  if (angled(wn)) return (
    <g transform={turnedAt(wn)}>
      <WindowNode wn={{ ...wn, x: 0, y: 0, dir: "h", ang: undefined, escape: false }} selected={selected} />
      {wn.escape ? <text x={0} y={side * 620} className="cadv-note" fontSize={150} textAnchor="middle">ESCAPE WINDOW</text> : null}
    </g>
  );
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

// The editor's grid (components/SheetParts.jsx).
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
  // Select tool: a wall end / whole wall / door or window being dragged (see armDrag).
  const dragRef = useRef(null);
  const [dragUi, setDragUi] = useState(null);

  // New sketches start with Solid walls; saved ones keep what they have (see wallStyleOf).
  const [model, setModel] = useState(() => ({ EXTENT: { w: 8400, h: 8800, margin: 2600 }, walls: [], doors: [], windows: [], dims: [], rooms: [], notes: [], boundary: null, rooflights: [], stairs: null, wallStyle: "solid" }));
  const [tool, setTool] = useState("select");
  const [view, setView] = useState({ s: 0.08, tx: 200, ty: 200 });
  const [draftPts, setDraftPts] = useState([]);
  // Exact wall length typed while a wall is in progress (digits, mm).
  const [typedLen, setTypedLen] = useState("");
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
  const shownRef = useRef(model); // the model last rendered (modelRef runs ahead of it mid-drag)
  shownRef.current = model;
  const histRef = useRef({ past: [], future: [] });
  const openedModelRef = useRef(model); // the model as opened, for Back to drawing
  const [, setHistVer] = useState(0);
  const pushPast = (m) => {
    const h = histRef.current;
    h.past.push(m); if (h.past.length > 200) h.past.shift();
    h.future = [];
  };
  const change = (fn) => {
    const cur = modelRef.current, next = fn(cur);
    if (next === cur) return;
    pushPast(cur);
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
      // A wall drag (or a press that may become one) owns the keyboard: Esc
      // puts the walls back, nothing else applies until release.
      if (dragRef.current) { if (e.key === "Escape") { e.preventDefault(); cancelDrag(); } return; }
      const k = e.key.toLowerCase();
      if (e.metaKey || e.ctrlKey) {
        if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
        else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(); }
        else if (k === "s") { e.preventDefault(); doSaveRef.current && doSaveRef.current(); }
        return;
      }
      if (e.altKey) return;
      const map = { v: "select", e: "ext", i: "int", d: "door", w: "window", m: "dim", r: "room", t: "text", h: "pan" };
      // Typed wall length: digits build the number, Backspace edits it, Enter
      // places the wall that long towards the mouse.
      if (isWallTool && draftPts.length) {
        if (/^[0-9]$/.test(e.key)) { e.preventDefault(); setTypedLen((t) => (t.length < 6 ? (t === "0" ? "" : t) + e.key : t)); return; }
        if (e.key === "Backspace" && typedLen) { e.preventDefault(); setTypedLen((t) => t.slice(0, -1)); return; }
        if (e.key === "Enter") { e.preventDefault(); placeTypedWall(); return; }
      }
      if (map[k]) { setTool(map[k]); setDraftPts([]); setDimP1(null); }
      else if (e.key === "Escape") {
        // First Esc cancels the item in progress; with nothing in progress it
        // leaves the tool (back to Select).
        if (draftPts.length || dimP1) { setDraftPts([]); setDimP1(null); }
        else { setSel(null); setTool("select"); }
      }
      else if (e.key === "Delete" || e.key === "Backspace") { deleteSel(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel, draftPts, dimP1, typedLen, cur, flags, tool]); // eslint-disable-line react-hooks/exhaustive-deps

  // A typed length belongs to the wall in progress; it goes when that does.
  useEffect(() => { if (!draftPts.length) setTypedLen(""); }, [draftPts]);

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
  // skip: "id:end" keys of ends to ignore (the ones being dragged).
  const endpointSnap = (raw, skip = null, walls = model.walls) => {
    let best = null, bd = 12 / viewRef.current.s;
    for (const w of walls) for (const [x, y, k] of [[w.x1, w.y1, 0], [w.x2, w.y2, 1]]) {
      if (skip && skip.has(w.id + ":" + k)) continue;
      const d = hyp(raw.x - x, raw.y - y);
      if (d < bd) { bd = d; best = { x, y, ep: true }; }
    }
    return best;
  };
  const wallPoint = (raw, from) => endpointSnap(raw) || snapPt(raw, from);
  // proj (dragging a corner): the pointer's distance along the locked
  // direction rather than its straight-line distance from `from`.
  const snapPt = (raw, from, proj = false) => {
    let x = raw.x, y = raw.y;
    if (flags.ortho && from) {
      const dx = x - from.x, dy = y - from.y;
      const step = Math.PI / 4;
      const ang = Math.round(Math.atan2(dy, dx) / step) * step;
      let dist = proj ? Math.max(0, dx * Math.cos(ang) + dy * Math.sin(ang)) : Math.hypot(dx, dy);
      if (flags.gridSnap) dist = Math.round(dist / settings.grid) * settings.grid;
      return { x: from.x + Math.cos(ang) * dist, y: from.y + Math.sin(ang) * dist };
    }
    if (flags.gridSnap) { x = snap(x, settings.grid); y = snap(y, settings.grid); }
    return { x, y };
  };

  const isWallTool = tool === "ext" || tool === "int";
  const drawingTool = tool !== "select" && tool !== "pan";

  // ---- Select tool: drag a wall end (the whole corner), a whole wall, or a
  // door / window along its wall ----
  // A press on a wall end (10px), else a door / window, else a wall arms a
  // drag; it starts once the pointer has moved 4px (10px for touch / pen), so
  // a press without moving is still a click. Each move previews from the
  // pre-drag model (lib/cad/edit, lib/cad/openings); release commits it as
  // ONE undo step. Esc, a pinch or a cancelled pointer puts it back.
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const armDrag = (e, raw) => {
    const base = modelRef.current, ws = base.walls;
    const selId = sel && sel.kind === "wall" ? sel.id : null;
    const hit = layers.walls && endAt(ws, raw.x, raw.y, 10 / viewRef.current.s, selId);
    const op = !hit && layers.openings && openingAt(raw.x, raw.y); // a hidden one: the wall under it drags
    let d = null;
    if (hit) {
      // Every end at that corner moves. Angle lock works from the far end of
      // one of the walls there (see dragMove): fars lists them, the grabbed
      // wall (the selected one if it's there, else the nearest) first.
      const ends = findNode(ws, hit.x, hit.y), mine = ws.filter((w) => ends.some((n) => n.id === w.id));
      const g = mine.find((w) => w.id === selId) || nearestWall(mine, raw.x, raw.y).seg;
      const fars = [g, ...mine.filter((w) => w !== g)].map((w) => (ends.find((n) => n.id === w.id).end === 0 ? { id: w.id, x: w.x2, y: w.y2 } : { id: w.id, x: w.x1, y: w.y1 }));
      // No end snap to the corner itself, nor to those far corners (that would
      // shrink a wall to nothing, which is never allowed).
      const skip = new Set([...ends, ...fars.flatMap((f) => findNode(ws, f.x, f.y))].map((n) => n.id + ":" + n.end));
      d = { kind: "node", id: g.id, ends, home: { x: hit.x, y: hit.y }, skip, fars };
    } else if (op) {
      // A door / window slides along the wall it sits in now, never onto another.
      const o = (op.kind === "door" ? base.doors : base.windows).find((x) => x.id === op.id), host = o && openingHost(ws, o);
      if (host) d = { kind: "opening", okind: op.kind, id: op.id, src: o, host };
    } else if (layers.walls) {
      const h = hitTest(ws, raw.x, raw.y), w = h && ws.find((o) => o.id === h.id);
      if (w) { const L = segLen(w) || 1; d = { kind: "wall", id: w.id, src: w, n: [-(w.y2 - w.y1) / L, (w.x2 - w.x1) / L] }; }
    }
    if (!d) return;
    // Capture now, so the release (or a cancel) always comes back here.
    try { svgRef.current.setPointerCapture(e.pointerId); } catch {}
    dragRef.current = { ...d, base, pid: e.pointerId, mx: e.clientX, my: e.clientY, w0: raw, moved: false, slop: e.pointerType === "mouse" ? 4 : 10 };
  };
  const dragMove = (e) => {
    const d = dragRef.current;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.mx, e.clientY - d.my) <= d.slop) return;
      d.moved = true; d.save = saveState;
      setSel({ kind: d.okind || "wall", id: d.id }); setDragUi({ kind: d.kind, id: d.id, off: 0, gap: 0 });
    }
    const raw = toWorld(e.clientX, e.clientY);
    // Each preview is worked out from the pre-drag model; the last one shown
    // (modelRef) lets lib/cad/edit judge the step from there.
    let next, ui, at;
    if (d.kind === "node") {
      // Back over its own spot puts it back exactly; another wall end wins
      // next; else angle lock along whichever wall at the corner the pointer
      // fits best (the grabbed one on a tie), then grid.
      const home = hyp(raw.x - d.home.x, raw.y - d.home.y) <= 12 / viewRef.current.s;
      const ep = !home && endpointSnap(raw, d.skip, d.base.walls);
      let p = home ? d.home : ep, f = d.fars[0];
      if (!p) for (const o of flags.ortho ? d.fars : [f]) {
        const q = snapPt(raw, o, true);
        if (!p || hyp(q.x - raw.x, q.y - raw.y) < hyp(p.x - raw.x, p.y - raw.y) - 1e-6) { p = q; f = o; }
      }
      at = home || ep ? { x: p.x, y: p.y } : { x: Math.abs(p.x - f.x) < 1e-6 ? f.x : r3(p.x), y: Math.abs(p.y - f.y) < 1e-6 ? f.y : r3(p.y) };
      next = home ? d.base : moveNode(d.base, d.ends, at, modelRef.current);
      ui = { kind: "node", id: f.id, ep: !!ep, x: at.x, y: at.y };
    } else if (d.kind === "opening") {
      // Moves along its wall as far as the pointer has (wherever it was
      // grabbed), kept inside the wall; Snap to grid steps its gap to the
      // nearer wall end.
      const r = slideOpening(d.base, d.okind, d.id, d.host, d.src.x + raw.x - d.w0.x, d.src.y + raw.y - d.w0.y, flags.gridSnap ? settings.grid : 0);
      next = r.model; ui = { kind: "opening", id: d.id, gap: r.gap };
      at = raw;
    } else {
      // Lock angles: only square to the wall, so its neighbours keep their run.
      let dx = raw.x - d.w0.x, dy = raw.y - d.w0.y, off = null;
      if (flags.ortho) {
        off = dx * d.n[0] + dy * d.n[1];
        if (flags.gridSnap) off = snap(off, settings.grid);
        dx = d.n[0] * off; dy = d.n[1] * off;
      } else if (flags.gridSnap) { dx = snap(dx, settings.grid); dy = snap(dy, settings.grid); }
      dx = r3(dx); dy = r3(dy);
      next = moveWall(d.base, d.id, dx, dy, modelRef.current);
      // How far the wall really went (its ends may slide along walls they end on).
      const a = d.src, b = next && next.walls.find((o) => o.id === d.id);
      const mx = b ? (b.x1 + b.x2 - a.x1 - a.x2) / 2 : 0, my = b ? (b.y1 + b.y2 - a.y1 - a.y2) / 2 : 0;
      ui = { kind: "wall", id: d.id, off: flags.ortho ? Math.abs(mx * d.n[0] + my * d.n[1]) : hyp(mx, my) };
      at = raw;
    }
    if (next) { modelRef.current = next; setModel(next); setDragUi(ui); } // null: not allowed (see lib/cad/edit), keep the last good one
    setCur({ x: at.x, y: at.y, rx: raw.x, ry: raw.y, sx: e.clientX, sy: e.clientY, on: true, ep: false });
  };
  // Back to the pre-drag model and save state: skip the "unsaved" mark if a
  // preview was shown, and never restore a stale "Saving…".
  const putBack = (d) => {
    skipDirty.current = shownRef.current !== d.base;
    if (modelRef.current !== d.base) { modelRef.current = d.base; setModel(d.base); }
    setSaveState((st) => (st === "unsaved" && d.save !== "saving" ? d.save : st));
  };
  const endDrag = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || !d.moved) return false;
    setDragUi(null);
    if (modelRef.current !== d.base) { pushPast(d.base); setHistVer((v) => v + 1); }
    else putBack(d); // dropped where it started: nothing to undo or save
    return true;
  };
  const cancelDrag = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || !d.moved) return;
    setDragUi(null); suppressClickRef.current = true;
    putBack(d);
  };

  const handleMove = (e) => {
    if (pinchActiveRef.current) { if (dragRef.current) cancelDrag(); return; }
    if (panRef.current) {
      setView({ s: viewRef.current.s, tx: panRef.current.tx + (e.clientX - panRef.current.mx), ty: panRef.current.ty + (e.clientY - panRef.current.my) });
      return;
    }
    if (dragRef.current) {
      if (e.pointerId !== dragRef.current.pid) return;
      if (e.buttons) { dragMove(e); return; }
      endDrag(); // the release was missed (outside the window): keep what was shown
    }
    const raw = toWorld(e.clientX, e.clientY);
    const from = draftPts.length ? draftPts[draftPts.length - 1] : null;
    const p = isWallTool ? wallPoint(raw, from) : (flags.gridSnap ? { x: snap(raw.x, settings.grid), y: snap(raw.y, settings.grid) } : raw);
    const hov = tool === "select" && layers.walls && !!endAt(model.walls, raw.x, raw.y, 10 / viewRef.current.s);
    setCur({ x: p.x, y: p.y, rx: raw.x, ry: raw.y, sx: e.clientX, sy: e.clientY, on: true, ep: !!p.ep, hov });
  };
  const handleDown = (e) => {
    if (pinchActiveRef.current) { cancelDrag(); return; }
    suppressClickRef.current = false;
    if (tool === "pan" || e.button === 1 || e.shiftKey) {
      panRef.current = { mx: e.clientX, my: e.clientY, tx: view.tx, ty: view.ty };
      e.preventDefault();
      return;
    }
    if (tool === "select" && e.button === 0 && !dragRef.current) armDrag(e, toWorld(e.clientX, e.clientY));
  };
  // After a real drag the click that follows must not change the selection.
  const handleUp = (e) => {
    panRef.current = null;
    if (dragRef.current && e.pointerId === dragRef.current.pid && endDrag()) suppressClickRef.current = true;
  };
  const handleCancel = (e) => { panRef.current = null; if (dragRef.current && e.pointerId === dragRef.current.pid) cancelDrag(); };

  const commitWallSeg = (a, b) => {
    if (a.x === b.x && a.y === b.y) return;
    const seg = { id: "w" + Date.now() + Math.round(Math.random() * 1e4), type: tool === "ext" ? "external" : "internal", x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    change((m) => ({ ...m, walls: m.walls.concat([seg]) }));
  };
  // A tool stays active until Esc (with nothing in progress) or Select. Each
  // item is complete on its own: after a wall's end click the next click starts
  // a NEW wall where you click, never chained from the last wall's end.
  const finishAction = () => { setDraftPts([]); setDimP1(null); };
  // End point for a typed length: from the start point towards the mouse
  // (raw position, so endpoint/grid snap can't skew it), on a 45deg step when
  // angles are locked. Rounded to 0.001mm so straight walls stay exactly square.
  const typedEnd = () => {
    const from = draftPts[draftPts.length - 1], L = parseInt(typedLen, 10);
    if (!from || !(L > 0) || cur.rx == null) return null;
    const dx = cur.rx - from.x, dy = cur.ry - from.y;
    if (!dx && !dy) return null;
    let ang = Math.atan2(dy, dx);
    if (flags.ortho) { const st = Math.PI / 4; ang = Math.round(ang / st) * st; }
    const r3 = (v) => Math.round(v * 1000) / 1000;
    return { x: r3(from.x + Math.cos(ang) * L), y: r3(from.y + Math.sin(ang) * L) };
  };
  const placeTypedWall = () => {
    const end = typedEnd();
    if (!end) return;
    commitWallSeg(draftPts[draftPts.length - 1], end);
    finishAction();
  };
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
      // On the nearest wall, kept inside it and clear of the walls joined at its
      // ends: { x, y, dir } in a square wall as always, plus ang (turned with
      // the wall) in an angled one.
      const nw = nearestWall(model.walls, raw.x, raw.y);
      if (!nw) return;
      const t = nw.seg.type === "external" ? T_EXT : T_INT;
      if (tool === "door") {
        const d = { id: "D" + Date.now(), ...placeOpening(nw.seg, raw.x, raw.y, settings.doorW, model.walls), w: settings.doorW, t, hinge: -1, fold: 1, ref: "" };
        change((m) => ({ ...m, doors: m.doors.concat([d]) }));
      } else {
        const wn = { id: "W" + Date.now(), ...placeOpening(nw.seg, raw.x, raw.y, settings.winW, model.walls), w: settings.winW, t, escape: false, ref: "" };
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

  const blankModel = () => ({ EXTENT: { w: 8400, h: 8800, margin: 2600 }, walls: [], doors: [], windows: [], dims: [], rooms: [], notes: [], boundary: null, rooflights: [], stairs: null, wallStyle: "solid" });
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
      setModel({ ...blankModel(), wallStyle: "light", ...geo }); resetHistory();
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
        onApplyPlan({ path: up.path, w: png.w, h: png.h, dataUrl: png.dataUrl, sketchId: skId, sheetId: linkSheetId });
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
    // Opened from a drawing: it can only mean "update that drawing", so no question.
    if (embedded && onApplyPlan) { runUsePlan("apply"); return; }
    setPlanModal(true);
  };
  // Back to drawing (opened from the editor): unchanged -> just close; changed
  // -> update that same drawing and sheet, then close. A sketch with no walls
  // left is saved but not sent, so the sheet keeps its plan.
  const backToDrawing = async () => {
    if (modelRef.current === openedModelRef.current) { onClose && onClose(); return; }
    if (!modelRef.current.walls.length) {
      try { await persistSketch(); } catch (e) { console.warn(e); }
      onClose && onClose(); return;
    }
    runUsePlan("apply");
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
      const loaded = { ...blankModel(), wallStyle: "light", ...geo };
      setModel(loaded); resetHistory();
      openedModelRef.current = loaded;
      // Opened from a drawing: that drawing and sheet are the ones to update.
      setLinkProjectId((embedded && linkProject) || _link?.projectId || linkProject || null);
      setLinkSheetId((embedded && linkSheet) || _link?.sheetId || linkSheet || null);
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
    const g = [], c = planCentre(model.walls);
    if (layers.boundary && model.boundary) g.push(<polyline key="bnd" points={ptStr(model.boundary)} className="cadv-boundary" fill="none" strokeWidth={1.4} strokeDasharray="14 10" vectorEffect="non-scaling-stroke" />);
    if (layers.stairs) (model.rooflights || []).forEach((rl) => g.push(
      <g key={rl.ref}>
        <rect x={rl.x} y={rl.y} width={rl.w} height={rl.h} fill="none" className="cadv-ink" strokeWidth={0.8} strokeDasharray="20 14" vectorEffect="non-scaling-stroke" opacity={0.6} />
        <text x={rl.x + rl.w / 2} y={rl.y + rl.h / 2} className="cadv-note" fontSize={150} textAnchor="middle" fontWeight={600}>{rl.ref}</text>
      </g>));
    if (layers.walls) g.push(<WallsNode key="walls" joined={joined} solid={wallStyleOf(model) === "solid"} selId={sel && sel.kind === "wall" ? sel.id : null} />);
    if (layers.openings) {
      g.push(<g key="doors">{model.doors.map((d) => <DoorNode key={d.id} d={d} selected={sel && sel.kind === "door" && sel.id === d.id} />)}</g>);
      g.push(<g key="wins">{model.windows.map((wn) => <WindowNode key={wn.id} wn={wn} side={openingSide(wn, c)} selected={sel && sel.kind === "window" && sel.id === wn.id} />)}</g>);
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
      // An angled opening's tag sits where an 'h' one's would, in its turned
      // frame: a door's on its swing side, a window's on the side facing the
      // middle of the plan (openingSide).
      const tags = [];
      model.doors.forEach((d) => { if (d.ref) tags.push(angled(d)
        ? <g key={"tg" + d.id} transform={turnedAt(d)}><Tag refTxt={d.ref} x={0} y={d.fold * 430} /></g>
        : <Tag key={"tg" + d.id} refTxt={d.ref} x={d.x + (d.dir === "h" ? 0 : d.fold * 430)} y={d.y + (d.dir === "h" ? d.fold * 430 : 0)} />); });
      model.windows.forEach((w) => { if (w.ref) tags.push(angled(w)
        ? <g key={"tg" + w.id} transform={turnedAt(w)}><Tag refTxt={w.ref} x={0} y={openingSide(w, c) * 360} /></g>
        : <Tag key={"tg" + w.id} refTxt={w.ref} x={w.x + (w.dir === "h" ? 0 : (w.x < 1000 ? 430 : -430))} y={w.y + (w.dir === "h" ? (w.y < 1000 ? 360 : -360) : 0)} />); });
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
    const tEnd = typedLen ? typedEnd() : null;
    overlay.push(<line key="rb" x1={last.x} y1={last.y} x2={tEnd ? tEnd.x : cur.x} y2={tEnd ? tEnd.y : cur.y} className="cadv-active" strokeWidth={1.6} strokeDasharray="8 6" vectorEffect="non-scaling-stroke" />);
    draftPts.forEach((p, k) => overlay.push(<rect key={"v" + k} x={p.x - 90} y={p.y - 90} width={180} height={180} className="cadv-active" fill="#fff" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />));
  }
  if (tool === "dim" && dimP1) {
    overlay.push(<line key="dimrb" x1={dimP1.x} y1={dimP1.y} x2={cur.x} y2={cur.y} className="cadv-active" strokeWidth={1.2} strokeDasharray="8 6" vectorEffect="non-scaling-stroke" />);
  }
  if (drawingTool && cur.on) {
    overlay.push(<line key="chx" x1={-1e6} y1={cur.y} x2={1e6} y2={cur.y} className="cadv-cross" strokeWidth={0.9} opacity={0.6} vectorEffect="non-scaling-stroke" />);
    overlay.push(<line key="chy" x1={cur.x} y1={-1e6} x2={cur.x} y2={1e6} className="cadv-cross" strokeWidth={0.9} opacity={0.6} vectorEffect="non-scaling-stroke" />);
    overlay.push(<circle key="cdot" cx={cur.x} cy={cur.y} r={70} className="cadv-active" fill="#fff" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />);
    if (isWallTool && cur.ep) overlay.push(<rect key="ep" x={cur.x - 9 / view.s} y={cur.y - 9 / view.s} width={18 / view.s} height={18 / view.s} fill="none" className="cadv-active" strokeWidth={2} vectorEffect="non-scaling-stroke" />);
  }
  // Select: drag handles at the selected wall's ends (screen-constant size);
  // a dragged corner shows the end-snap square when it lands on another end.
  const selWall = sel && sel.kind === "wall" ? model.walls.find((w) => w.id === sel.id) : null;
  if (tool === "select" && layers.walls && selWall) [[selWall.x1, selWall.y1], [selWall.x2, selWall.y2]].forEach(([x, y], k) =>
    overlay.push(<rect key={"hd" + k} x={x - 4.5 / view.s} y={y - 4.5 / view.s} width={9 / view.s} height={9 / view.s} className="cadv-handle" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />));
  if (dragUi && dragUi.ep) overlay.push(<rect key="dep" x={dragUi.x - 9 / view.s} y={dragUi.y - 9 / view.s} width={18 / view.s} height={18 / view.s} fill="none" className="cadv-active" strokeWidth={2} vectorEffect="non-scaling-stroke" />);

  // length HUD (DOM, at cursor)
  let hud = null;
  if (isWallTool && draftPts.length && cur.on) {
    const lp = draftPts[draftPts.length - 1];
    const L = Math.round(hyp(cur.x - lp.x, cur.y - lp.y));
    const wr = wrapRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
    hud = typedLen
      ? <div className="cadv__hud cadv__hud--typed" style={{ left: cur.sx - wr.left, top: cur.sy - wr.top }}>Length <b>{typedLen}<i className="cadv__caret" /> mm</b> <span>Enter to place</span></div>
      : <div className="cadv__hud" style={{ left: cur.sx - wr.left, top: cur.sy - wr.top }}>Length <b>{fmtMM(L)} mm</b></div>;
  } else if (tool === "dim" && dimP1 && cur.on) {
    const L2 = Math.round(hyp(cur.x - dimP1.x, cur.y - dimP1.y));
    const wr = wrapRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
    hud = <div className="cadv__hud" style={{ left: cur.sx - wr.left, top: cur.sy - wr.top }}><b>{fmtMM(L2)} mm</b></div>;
  } else if (dragUi && dragUi.kind === "opening") {
    // Gap from the opening's nearer edge to the nearer end of its wall.
    const wr = wrapRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
    hud = <div className="cadv__hud" style={{ left: cur.sx - wr.left, top: cur.sy - wr.top }}>To wall end <b>{fmtMM(dragUi.gap)} mm</b></div>;
  } else if (dragUi) {
    const gw = model.walls.find((w) => w.id === dragUi.id);
    const wr = wrapRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
    if (gw) hud = <div className="cadv__hud" style={{ left: cur.sx - wr.left, top: cur.sy - wr.top }}>Length <b>{fmtMM(segLen(gw))} mm</b>{dragUi.kind === "wall" ? <span className="sub">moved {fmtMM(dragUi.off)} mm</span> : null}</div>;
  }

  const selDoor = sel && sel.kind === "door" ? model.doors.find((d) => d.id === sel.id) : null;
  const selWin = sel && sel.kind === "window" ? model.windows.find((w) => w.id === sel.id) : null;
  const hint = dragUi ? "Release to place it - Esc to put it back" : {
    select: "Click to select. Drag a wall, wall end, door or window to move it. Shift-drag to pan.",
    ext: draftPts.length ? "Click the end point, or type a length in mm and press Enter - Esc to cancel" : "Click the start point of an external wall - Esc to exit",
    int: draftPts.length ? "Click the end point, or type a length in mm and press Enter - Esc to cancel" : "Click the start point of an internal wall - Esc to exit",
    door: "Click on a wall to place a door - Esc to exit",
    window: "Click on a wall to place a window - Esc to exit",
    dim: dimP1 ? "Click the second measure point - Esc to cancel" : "Click the first measure point - Esc to exit",
    room: "Click inside a space to drop a room label - Esc to exit",
    text: "Click to place a note - Esc to exit",
    pan: "Drag to pan the sheet",
  }[tool];

  const pickTool = (id) => {
    const t = id === "wall" ? (tool === "int" ? "int" : "ext") : id;
    setTool(t); setDraftPts([]); setDimP1(null);
  };
  const goBack = () => (embedded ? backToDrawing() : router.push("/"));
  const openRename = () => { setRenameDraft(sketchName); setRenameOpen(true); };
  const commitRename = () => {
    const nm = renameDraft.trim();
    if (!nm) return;
    if (nm !== sketchName) { setSketchName(nm); setSaveState((st) => (st === "saving" ? st : "unsaved")); }
    setRenameOpen(false);
  };
  const subscribe = () => { access.openSubscribe && access.openSubscribe(); };
  const canUndo = histRef.current.past.length > 0, canRedo = histRef.current.future.length > 0;

  const svgCursor = tool === "pan" ? "grab" : drawingTool ? "crosshair" : (dragUi || cur.hov ? "move" : "default");
  const gridSz = GRID_MM * view.s;
  // White paper with the editor's grid over it, edge to edge.
  const gridStyle = {
    backgroundColor: "#FFFFFF",
    backgroundImage: layers.grid
      ? `linear-gradient(to right, ${GRID_LINE} 1px, transparent 1px), linear-gradient(to bottom, ${GRID_LINE} 1px, transparent 1px)`
      : "none",
    backgroundSize: `${gridSz}px ${gridSz}px`,
    backgroundPosition: `${view.tx}px ${view.ty}px`,
  };
  return (
    <div className="cadv absolute inset-0 flex flex-col bg-slate-100 text-slate-900 dark:bg-[#0E141B] dark:text-slate-100 overflow-hidden select-none"
         style={{ fontFamily: "var(--font-inter), ui-sans-serif, system-ui, -apple-system, sans-serif" }}>
      <style>{CSS}</style>

      {/* ==================== TOP BAR (shared with the editor) ==================== */}
      <TopBarShell>
        <TbGroup first>
          <TbButton onClick={goBack} icon={ChevronLeft} label={embedded ? "Back to drawing" : "Dashboard"} shortLabel={embedded ? "Drawing" : undefined} title={embedded ? "Back to the drawing (updates its plan if you changed anything)" : "Back to dashboard"} disabled={!!planBusy} />
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
            <div className="flex-1 overflow-y-auto px-3 py-3">
              <section className="mb-5">
                <SectionLabel>Wall style</SectionLabel>
                <ChoiceGroup label="Wall style" value={wallStyleOf(model)}
                  onChange={(v) => v !== wallStyleOf(model) && change((m) => ({ ...m, wallStyle: v }))}
                  options={[{ value: "solid", label: "Solid" }, { value: "light", label: "Light" }]} />
              </section>
              <section className="mb-5">
                <SectionLabel>Snap grid</SectionLabel>
                <ChoiceGroup label="Snap grid" value={settings.grid} onChange={(v) => setSettings((s) => ({ ...s, grid: v }))}
                  options={[50, 100, 250].map((v) => ({ value: v, label: v + " mm" }))} />
              </section>
              <section className="mb-5">
                <SectionLabel className="mb-1">Drawing aids</SectionLabel>
                <ToggleRow label="Lock angles" hint="Walls run at 0°, 45° or 90°" checked={flags.ortho}
                  onChange={(v) => setFlags((f) => ({ ...f, ortho: v }))} />
                <ToggleRow label="Snap to grid" hint={`Points land on the ${settings.grid} mm grid`} checked={flags.gridSnap}
                  onChange={(v) => setFlags((f) => ({ ...f, gridSnap: v }))} />
              </section>
              <section>
                <SectionLabel className="mb-1">Layers</SectionLabel>
                {LAYER_LIST.map(([id, label]) => {
                  const on = layers[id];
                  return (
                    <button key={id} type="button" role="switch" aria-checked={on} title={on ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
                      onClick={() => setLayers((l) => ({ ...l, [id]: !l[id] }))}
                      className="w-full flex items-center gap-2.5 px-1.5 h-9 rounded-lg text-left hover:bg-slate-200/60 dark:hover:bg-white/5 transition-colors">
                      <span className={`flex-1 text-[13px] font-medium ${on ? "text-slate-800 dark:text-slate-100" : "text-slate-500 dark:text-slate-400 line-through decoration-slate-400/60"}`}>{label}</span>
                      {on ? <Eye size={17} className="shrink-0 text-[#1C6F7C] dark:text-[#5FD0E0]" /> : <EyeOff size={17} className="shrink-0 text-slate-500 dark:text-slate-400" />}
                    </button>
                  );
                })}
              </section>
            </div>
          </SidePanel>
        )}

        {/* ==================== CANVAS ==================== */}
        <main className="flex-1 relative overflow-hidden bg-slate-200 dark:bg-[#0B1117] flex flex-col">
          <SheetTabs label="Plan" sheets={[{ id: "plan", name: sketchName || "Untitled sketch" }]} activeId="plan"
            onSwitch={() => {}} onDelete={() => {}}
            onRename={(_, nm) => { if (nm !== sketchName) { setSketchName(nm); setSaveState((st) => (st === "saving" ? st : "unsaved")); } }} />
          <div className="relative flex-1 overflow-hidden">
          <div ref={wrapRef} className="absolute inset-0 overflow-hidden bg-white">
            <div ref={gridRef} style={{ position: "absolute", inset: 0, pointerEvents: "none", transformOrigin: "0 0", willChange: PROMOTE, ...gridStyle }} />
            <svg ref={svgRef} className="cadv__svg" width="100%" height="100%" style={{ cursor: svgCursor, transformOrigin: "0 0", willChange: PROMOTE }}
              onPointerDown={handleDown} onPointerMove={handleMove} onPointerUp={handleUp} onPointerCancel={handleCancel}
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
          <ZoomControls zoom={view.s / 0.08} onIn={() => zoomBy(1.2)} onOut={() => zoomBy(1 / 1.2)} onFit={() => fit()} />
          <div className="absolute left-4 bottom-11 z-20 flex items-center gap-3 px-3 h-8 bg-white dark:bg-[#16202B] rounded-xl ring-1 ring-slate-200/70 dark:ring-[#2A3947] shadow-[0_10px_30px_-10px_rgba(16,28,40,0.22)] text-[11px] text-slate-700 dark:text-slate-200"
               style={{ fontFamily: "var(--font-jetbrains-mono), monospace" }}>
            <span className="font-semibold">N &#8593;</span>
            <span className="inline-flex h-1.5 ring-1 ring-slate-400"><i className="w-5 bg-slate-600 dark:bg-slate-300" /><i className="w-5 bg-white dark:bg-[#16202B]" /><i className="w-5 bg-slate-600 dark:bg-slate-300" /></span>
            <span>0 1 2 m</span>
          </div>

          <StatusBar right={<>X {Math.round(cur.x)} Y {Math.round(cur.y)} · GRID {settings.grid}MM · <span className={saveState === "unsaved" || saveState === "error" ? "text-amber-600" : ""}>{SAVE_LABEL[saveState]}</span></>}>
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
            <div className="flex-1 overflow-y-auto p-4">
              {selWall ? (
                <>
                  <div className="text-[15px] font-semibold text-slate-900 dark:text-slate-100" style={{ fontFamily: "var(--font-space-grotesk), sans-serif" }}>Wall</div>
                  <div className={`mt-1 mb-4 ${PANEL_HELP}`}>Drag it, or its end squares, on the plan to move it. Change its type, or delete it.</div>
                  <ScheduleRows rows={[["Length", fmtMM(segLen(selWall)) + " mm"], ["Thickness", (selWall.type === "external" ? T_EXT : T_INT) + " mm"]]} />
                  <SectionLabel className="mt-5 mb-2">Wall type</SectionLabel>
                  <ChoiceGroup label="Wall type" value={selWall.type} onChange={(t) => selWall.type !== t && convertSel()}
                    options={[{ value: "external", label: "External" }, { value: "internal", label: "Internal" }]} />
                  <PanelAction danger onClick={deleteSel} className="w-full mt-5"><Trash2 size={14} /> Delete wall</PanelAction>
                </>
              ) : selDoor ? (
                <>
                  <div className="text-[15px] font-semibold text-slate-900 dark:text-slate-100" style={{ fontFamily: "var(--font-space-grotesk), sans-serif" }}>Door</div>
                  <div className={`mt-1 mb-4 ${PANEL_HELP}`}>Drag it along its wall on the plan to move it. Flip side swaps which room it opens into; flip hinge swaps the hinged edge.</div>
                  <ScheduleRows rows={[["Width", selDoor.w + " mm"], ["Wall", selDoor.t === T_EXT ? "External" : "Internal"]]} />
                  <SectionLabel className="mt-5 mb-2">Swing</SectionLabel>
                  <div className="grid grid-cols-2 gap-1.5">
                    <PanelAction onClick={flipSwing}>Flip side</PanelAction>
                    <PanelAction onClick={flipHinge}>Flip hinge</PanelAction>
                  </div>
                  <PanelAction danger onClick={deleteSel} className="w-full mt-5"><Trash2 size={14} /> Delete door</PanelAction>
                </>
              ) : selWin ? (
                <>
                  <div className="text-[15px] font-semibold text-slate-900 dark:text-slate-100" style={{ fontFamily: "var(--font-space-grotesk), sans-serif" }}>Window</div>
                  <div className={`mt-1 mb-4 ${PANEL_HELP}`}>Drag it along its wall on the plan to move it. Mark it as an escape window if it's the fire escape route.</div>
                  <ScheduleRows rows={[["Width", selWin.w + " mm"], ["Wall", selWin.t === T_EXT ? "External" : "Internal"]]} />
                  <div className="mt-4"><ToggleRow label="Escape window" checked={!!selWin.escape} onChange={() => toggleEscape()} /></div>
                  <PanelAction danger onClick={deleteSel} className="w-full mt-5"><Trash2 size={14} /> Delete window</PanelAction>
                </>
              ) : (
                <>
                  <div className="text-[15px] font-semibold text-slate-900 dark:text-slate-100" style={{ fontFamily: "var(--font-space-grotesk), sans-serif" }}>{TOOL_NAME[tool]}</div>
                  <div className={`mt-1 ${PANEL_HELP}`}>{hint}</div>
                  {isWallTool && (
                    <>
                      <SectionLabel className="mt-5 mb-2">Wall type</SectionLabel>
                      <ChoiceGroup label="Wall type" value={tool === "int" ? "int" : "ext"} onChange={pickTool}
                        options={[{ value: "ext", label: `External ${T_EXT}` }, { value: "int", label: `Internal ${T_INT}` }]} />
                    </>
                  )}
                  {tool === "door" && (
                    <>
                      <SectionLabel className="mt-5 mb-2">Door width</SectionLabel>
                      <ChoiceGroup label="Door width" value={settings.doorW} onChange={(v) => setSettings((s) => ({ ...s, doorW: v }))}
                        options={[760, 850, 960].map((v) => ({ value: v, label: String(v) }))} />
                    </>
                  )}
                  {tool === "window" && (
                    <>
                      <SectionLabel className="mt-5 mb-2">Window width</SectionLabel>
                      <ChoiceGroup label="Window width" value={settings.winW} onChange={(v) => setSettings((s) => ({ ...s, winW: v }))}
                        options={[600, 900, 1200].map((v) => ({ value: v, label: String(v) }))} />
                    </>
                  )}
                  <SectionLabel className="mt-6 mb-1">Plan</SectionLabel>
                  <ScheduleRows rows={[["Walls", model.walls.length], ["Doors", model.doors.length], ["Windows", model.windows.length], ["Rooms", model.rooms.length], ["Dimensions", model.dims.length]]} />
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
.cadv-poche-solid{fill:#27313C}
.cadv-paper{fill:#FFFFFF}
.cadv-sel{stroke:#3FB7C9}
.cadv-sel-fill{fill:rgba(63,183,201,.18)}
.cadv-active{stroke:#3FB7C9}
.cadv-handle{fill:#3FB7C9; stroke:#FFFFFF}
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
.cadv__hud .sub{color:#8FA3B3; margin-left:6px}
.cadv__hud--typed{outline:1.5px solid #2C97A8}
.cadv__hud--typed span{color:#8FA3B3; margin-left:6px}
.cadv__caret{display:inline-block; width:1px; height:11px; margin-left:1px; vertical-align:-1px; background:#3FB7C9; animation:cadvCaret 1s steps(1) infinite}
@keyframes cadvCaret{50%{opacity:0}}
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
