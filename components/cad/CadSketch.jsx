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
import { startRun, runEnd, retraces, afterWall } from "@/lib/cad/chain";
import { isAuto, roomSpaces, areaAt, roomAt, onWall } from "@/lib/cad/rooms";
import { wallSnap } from "@/lib/cad/snap";
import { listSketches, getSketchData, insertSketch, updateSketch, deleteSketch } from "@/lib/cad/sketchStore";
import { insertProject, getProjectData, updateProjectRow } from "@/lib/db";
import { uploadPlanImage, dataUrlToBlob } from "@/lib/planImages";
import { computeFrame, renderModelToPng } from "@/lib/cad/sketchToImage";
import { SCALES, MARGIN_MM, PLAN_PX, scalePrefOf, scaleLabel, planSheetFrame, applyPlanToSheet, outsideNote, legacyFrameOf } from "@/lib/cad/planScale";
import { isTouchDevice } from "@/lib/touch";
import {
  ChevronLeft, FolderOpen, FilePlus, Save, Send, Undo2, Redo2, SlidersHorizontal, Grid3x3, Magnet, Compass,
  Maximize2, Trash2, Eye, EyeOff, BrickWall, DoorOpen, Tag as TagIcon, Type, MousePointer2, Hand, PencilRuler, Link2, Crosshair,
} from "lucide-react";
import {
  TopBarShell, TbGroup, TbButton, TbBrand, TbProjectPill, TbTrialSlot, TbMenu, TbMenuItem, TbPanelsItem, TbThemeItem,
  SidePanel, CollapsedPanel, PANEL_LABEL, PANEL_HELP, SectionLabel, ChoiceGroup, ToggleRow, ScheduleRows, PanelAction,
  FloatingToolbar, ZoomControls, StatusBar, StatusCount, SheetTabs, TbShortcutsButton,
} from "@/components/SheetParts";
import { ShortcutsCard, ShortcutsTip, StatusHint, useOnceTip, TOUCH } from "@/components/Shortcuts";
import { useApp } from "@/components/AppShell";
import { TryPill, useTryUsage } from "@/components/TryMode";

// A composited layer for a canvas this size rasterises at reduced resolution on
// iOS Safari, which is why doing the zoom as an SVG <g> transform here was no
// sharper than the sheet's CSS transform. Off on touch: full resolution beats
// smooth panning on a drawing.
const PROMOTE = isTouchDevice() ? "auto" : "transform";

// Zoom limits (screen px per mm). Out far enough to see a big plan's whole A3
// drawing-area outline (54 m across for a 36.5 m house at 1:200).
const SCALE_MIN = 0.005, SCALE_MAX = 0.6;

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

// Is (px,py) on door / window o itself: its width along the wall and the
// wall's thickness across, + mg (mm)?
function onOpening(o, px, py, mg) {
  const a = angled(o) ? o.ang * Math.PI / 180 : o.dir === "v" ? Math.PI / 2 : 0, c = Math.cos(a), s = Math.sin(a);
  const dx = px - o.x, dy = py - o.y;
  return Math.abs(dx * c + dy * s) <= o.w / 2 + mg && Math.abs(dy * c - dx * s) <= (o.t || T_EXT) / 2 + mg;
}

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

// Inspector text field: commits on Enter or on leaving it, Esc puts it back;
// left empty it keeps the old value. Only a real edit saves: stray spaces
// round an old name are left as they are.
function NameField({ value, onCommit, label }) {
  const cur = value == null ? "" : String(value);
  const [v, setV] = useState(cur);
  const escRef = useRef(false);
  useEffect(() => { setV(cur); }, [cur]);
  const done = () => {
    const t = v.trim();
    if (!escRef.current && t && t !== cur.trim()) onCommit(t); else setV(cur);
    escRef.current = false;
  };
  return (
    <input type="text" aria-label={label} value={v} onChange={(e) => setV(e.target.value)} onBlur={done}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") { escRef.current = e.key === "Escape"; e.currentTarget.blur(); } }}
      className="w-full h-9 px-3 text-[13px] font-medium bg-white dark:bg-[#0E141B] rounded-lg ring-1 ring-slate-300 dark:ring-[#2A3947] focus:ring-[#3FB7C9] focus:outline-none text-slate-900 dark:text-slate-100 select-text" />
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
// kbd: the key (see the keyboard handler), badged on the button; Wall's
// tooltip names both of its keys.
const DRAW_TOOLS = [
  { id: "wall", icon: BrickWall, label: "Wall", kbd: "e", kbdTip: "E external, I internal" },
  { id: "door", icon: DoorOpen, label: "Door", kbd: "d" },
  { id: "window", icon: WindowIcon, label: "Window", kbd: "w" },
  { id: "dim", icon: DimIcon, label: "Dimension", kbd: "m" },
  { id: "room", icon: TagIcon, label: "Room label", kbd: "r" },
  { id: "text", icon: Type, label: "Note", kbd: "t" },
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
// The layer each selectable kind is on: hiding it drops that selection, so
// nothing hidden can be edited or deleted.
const SEL_LAYER = { wall: "walls", door: "openings", window: "openings", room: "rooms" };

// The Scale section's warning (the plan would be cut off, or is too big for A3).
const SCALE_WARN = "mt-2 rounded-lg px-2.5 py-2 text-[12px] leading-snug font-medium bg-red-50 text-red-800 ring-1 ring-red-200 dark:bg-red-500/10 dark:text-red-200 dark:ring-red-400/30";
const SAVE_LABEL = { idle: "NOT SAVED", unsaved: "UNSAVED CHANGES", saving: "SAVING…", saved: "SAVED", error: "SAVE FAILED" };
// The snap a wall point is on (Snap to walls), shown by the cursor.
const SNAP_LABEL = { end: "END", side: "SIDE", guide: "GUIDE" };

// The editor's grid (components/SheetParts.jsx).
const GRID_LINE = "rgba(37,99,235,0.18)";
const GRID_MM = 500;

// The shortcuts card (components/Shortcuts.jsx, "?" or the Shortcuts button):
// every key the keyboard handler in CadSketch below takes, and the touch
// gestures its canvas handles. Keep them in step with the handlers.
const SHORTCUTS = [
  { title: "Draw", items: [
    ["External wall", ["e"]],
    ["Internal wall", ["i"]],
    ["Door", ["d"]],
    ["Window", ["w"]],
    ["Dimension", ["m"]],
    ["Room label", ["r"]],
    ["Note", ["t"]],
    ["Type a wall length (mm) while drawing a wall", ["digits"]],
    ["Place the wall at the typed length", ["enter"]],
    ["Correct the typed length", ["backspace"]],
    ["Cancel the wall or dimension in progress (ends a chained run)", ["esc"]],
  ] },
  { title: "Edit", items: [
    ["Select tool", ["v"]],
    ["Delete the selected wall, door, window or room label", ["del", "backspace"]],
    ["Put back what you are dragging", ["esc"]],
    ["Clear the selection, back to Select", ["esc"]],
    ["Undo", ["mod+z"]],
    ["Redo", ["mod+shift+z", "mod+y"]],
    ["Save", ["mod+s"]],
  ] },
  { title: "View", items: [
    ["Keyboard shortcuts (this card)", ["?"]],
    ["Close this card", ["esc"]],
  ] },
  { title: "Navigate", items: [
    ["Pan tool", ["h"]],
    ["Pan with any tool", ["shift+drag", "mdrag"]],
    ["Zoom in or out at the pointer", ["wheel"]],
  ] },
];
const TOUCH_GESTURES = [
  { title: "Draw", items: [
    ["Pick a tool", "Tap it in the top bar"],
    ["Wall", "Tap the start, then the end"],
    ["Door or window", "Tap on a wall"],
    ["Dimension", "Tap the two points"],
    ["Room label or note", "Tap where it goes"],
    ["End a run of chained walls", "Tap Finish run in the inspector"],
  ] },
  { title: "Edit", items: [
    ["Select", "With Select, tap a wall, door, window or label"],
    ["Move a wall, corner, door, window or label", "With Select, drag it with one finger"],
    ["Delete", "Tap Delete in the inspector"],
    ["Undo or redo", "Tap the arrows in the top bar"],
    ["Rename the sketch", "Tap its name in the top bar, or double-tap its tab"],
  ] },
  { title: "View", items: [
    ["Zoom", "Pinch with two fingers"],
    ["Zoom in, out or to fit", "The buttons at the top right"],
  ] },
  { title: "Navigate", items: [
    ["Pan", "Drag with two fingers"],
    ["Pan with one finger", "Pick the hand tool, then drag"],
  ] },
];

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
  // The run of walls the wall in progress belongs to (lib/cad/chain): its
  // first point and how many walls it has. Set by every wall's first click,
  // so it is only read while draftPts has a point.
  const [run, setRun] = useState(null);
  const [cur, setCur] = useState({ x: 0, y: 0, sx: -99, sy: -99, on: false });
  const [sel, setSel] = useState(null);
  const [dimP1, setDimP1] = useState(null);
  const [settings, setSettings] = useState({ grid: 100, doorW: DOOR_W, winW: WIN_W });
  const [flags, setFlags] = useState({ ortho: true, gridSnap: true, chain: false, wallSnap: true });
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
  // The plan frame (mm) and scale the plan was last sent with (_link): null
  // scale = sent before scales (lib/cad/planScale converts it on the next send).
  const [frame, setFrame] = useState(null);
  const [linkScale, setLinkScale] = useState(null);
  // The frame plans were sent at before scales (legacyFrameOf), kept once the
  // link moves on, for a Save As copy of an older drawing that still has one.
  const [legacyFrame, setLegacyFrame] = useState(null);
  const [planModal, setPlanModal] = useState(false);
  const [planBusy, setPlanBusy] = useState(null);
  const [nameGate, setNameGate] = useState(!(openSketchId || linkProject || embedded));
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const [panelsHidden, setPanelsHidden] = useState(false);
  const [inspectorHidden, setInspectorHidden] = useState(false);
  // The shortcuts card, and the first-run tip pointing to it (once per device).
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [tipShow, dismissTip] = useOnceTip("plotwire.sketch.shortcutsTip");
  const openShortcuts = () => { setShortcutsOpen(true); dismissTip(); };
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

  // keyboard shortcuts (listed for the shortcuts card in SHORTCUTS, above)
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      // A wall drag (or a press that may become one) owns the keyboard: Esc
      // puts the walls back, nothing else applies until release.
      if (dragRef.current) { if (e.key === "Escape") { e.preventDefault(); cancelDrag(); } return; }
      // "?" opens the shortcuts card (not over a dialog). While it is open the
      // card takes every key first (components/Shortcuts.jsx), so none of
      // these reach here.
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!e.repeat && !e.target.isContentEditable && !nameGate && !renameOpen && !planModal && !planBusy) { e.preventDefault(); openShortcuts(); }
        return;
      }
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
  }, [sel, draftPts, dimP1, typedLen, cur, flags, tool, run, nameGate, renameOpen, planModal, planBusy]); // eslint-disable-line react-hooks/exhaustive-deps

  // A typed length belongs to the wall in progress; it goes when that does.
  useEffect(() => { if (!draftPts.length) setTypedLen(""); }, [draftPts]);
  // Snap to walls markers belong to the pointer's last move: a click, Esc, a
  // tool change or an edit clears them until the next move works them out again.
  useEffect(() => { setCur((c) => (c.snap || c.guides ? { ...c, snap: null, guides: null } : c)); }, [draftPts, tool, model.walls]);

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
  // Snap to walls (lib/cad/snap): after a wall end, a wall's side or an
  // alignment guide, before angle lock and grid. Off: exactly as before.
  // half: the drawn wall's half thickness, so a side point leaves it room.
  const snapWalls = (raw, from, o = null, walls = model.walls) => wallSnap(walls, raw, { scale: viewRef.current.s, from, lock: flags.ortho && !!from, grid: flags.gridSnap ? settings.grid : 0, half: (tool === "ext" ? T_EXT : T_INT) / 2, ...o });
  const wallPoint = (raw, from) => endpointSnap(raw) || (flags.wallSnap && snapWalls(raw, from)) || snapPt(raw, from);
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

  // ---- Select tool: drag a wall end (the whole corner), a whole wall, a
  // door / window along its wall, or a room label ----
  // What a press or a click takes (pickAt): a wall end (10px), else a door /
  // window or a room label, else a wall. Where a label and an opening's pick
  // circle overlap, the label wins unless the point is on the opening itself
  // (in its wall, + 6px). A label's text gives way to a wall under the press
  // (in it, + 4px); its point (300mm round) never does. Nothing on a hidden
  // layer is taken: the wall under a hidden opening or label is. A press arms
  // a drag; it starts once the pointer has moved 4px (10px for touch / pen),
  // so a press without moving is still a click. Each move previews from the
  // pre-drag model (lib/cad/edit, lib/cad/openings); release commits it as ONE
  // undo step. Esc, a pinch or a cancelled pointer puts it back.
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const pickAt = (m, raw, selId = null) => {
    const end = layers.walls && endAt(m.walls, raw.x, raw.y, 10 / viewRef.current.s, selId);
    if (end) return { end, op: null, ri: -1 };
    let op = layers.openings ? openingAt(raw.x, raw.y) : null, ri = layers.rooms ? roomAt(m.rooms, raw.x, raw.y) : -1;
    if (op && ri >= 0) {
      const o = (op.kind === "door" ? m.doors : m.windows).find((x) => x.id === op.id);
      if (o && onOpening(o, raw.x, raw.y, 6 / viewRef.current.s)) ri = -1; else op = null;
    }
    if (ri >= 0 && layers.walls && (Math.abs(raw.x - m.rooms[ri].x) > 300 || Math.abs(raw.y - m.rooms[ri].y) > 300)) {
      const nw = nearestWall(m.walls, raw.x, raw.y);
      if (nw && nw.dist <= (nw.seg.type === "external" ? T_EXT : T_INT) / 2 + 4 / viewRef.current.s) ri = -1;
    }
    return { end: null, op, ri };
  };
  // The ends at a picked corner, their walls, and the wall a press there takes
  // (the selected one if it's there, else the nearest): a click selects it, a
  // drag moves the corner from it.
  const nodeAt = (ws, hit, raw, selId) => {
    const ends = findNode(ws, hit.x, hit.y), mine = ws.filter((w) => ends.some((n) => n.id === w.id));
    return { ends, mine, g: mine.find((w) => w.id === selId) || nearestWall(mine, raw.x, raw.y).seg };
  };
  const armDrag = (e, raw) => {
    const base = modelRef.current, ws = base.walls;
    const selId = sel && sel.kind === "wall" ? sel.id : null;
    const { end: hit, op, ri } = pickAt(base, raw, selId);
    let d = null;
    if (hit) {
      // Every end at that corner moves. Angle lock works from the far end of
      // one of the walls there (see dragMove): fars lists them, the grabbed
      // wall (nodeAt) first.
      const { ends, mine, g } = nodeAt(ws, hit, raw, selId);
      const fars = [g, ...mine.filter((w) => w !== g)].map((w) => (ends.find((n) => n.id === w.id).end === 0 ? { id: w.id, x: w.x2, y: w.y2 } : { id: w.id, x: w.x1, y: w.y1 }));
      // No end snap to the corner itself, nor to those far corners (that would
      // shrink a wall to nothing, which is never allowed).
      const skip = new Set([...ends, ...fars.flatMap((f) => findNode(ws, f.x, f.y))].map((n) => n.id + ":" + n.end));
      // Snap to walls: no guides from the corner's own ends, no sides of its own
      // walls; a side point leaves room for the thickest wall there.
      const own = { skipEnds: new Set(ends.map((n) => n.id + ":" + n.end)), skipWalls: new Set(mine.map((w) => w.id)),
        half: (mine.some((w) => w.type === "external") ? T_EXT : T_INT) / 2 };
      d = { kind: "node", id: g.id, ends, home: { x: hit.x, y: hit.y }, skip, fars, own };
    } else if (op) {
      // A door / window slides along the wall it sits in now, never onto another.
      const o = (op.kind === "door" ? base.doors : base.windows).find((x) => x.id === op.id), host = o && openingHost(ws, o);
      if (host) d = { kind: "opening", okind: op.kind, id: op.id, src: o, host };
    } else if (ri >= 0) {
      d = { kind: "room", index: ri, src: base.rooms[ri] };
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
      // The model changed under the press (an edit saved since): drop it
      // rather than drag a stale copy over that edit.
      if (modelRef.current !== d.base) { dragRef.current = null; return; }
      d.moved = true; d.save = saveState;
      setSel(d.kind === "room" ? { kind: "room", index: d.index } : { kind: d.okind || "wall", id: d.id });
      setDragUi({ kind: d.kind, id: d.id, index: d.index, off: 0, gap: 0 });
    }
    const raw = toWorld(e.clientX, e.clientY);
    // Each preview is worked out from the pre-drag model; the last one shown
    // (modelRef) lets lib/cad/edit judge the step from there.
    let next, ui, at;
    if (d.kind === "node") {
      // Back over its own spot puts it back exactly; another wall end wins
      // next; else angle lock along whichever wall at the corner the pointer
      // fits best (the grabbed one on a tie), then grid. Snap to walls comes
      // in before angle lock: a wall's side or a guide, on that wall's locked
      // line when angles are locked.
      const home = hyp(raw.x - d.home.x, raw.y - d.home.y) <= 12 / viewRef.current.s;
      const ep = !home && endpointSnap(raw, d.skip, d.base.walls);
      let p = home ? d.home : ep, f = d.fars[0];
      if (!p) for (const o of flags.ortho ? d.fars : [f]) {
        const q = snapPt(raw, o, true);
        if (!p || hyp(q.x - raw.x, q.y - raw.y) < hyp(p.x - raw.x, p.y - raw.y) - 1e-6) { p = q; f = o; }
      }
      const sw = !home && !ep && flags.wallSnap ? snapWalls(raw, f, { lock: flags.ortho, proj: true, ...d.own }, d.base.walls) : null;
      if (sw) p = sw;
      at = home || ep || sw ? { x: p.x, y: p.y } : { x: Math.abs(p.x - f.x) < 1e-6 ? f.x : r3(p.x), y: Math.abs(p.y - f.y) < 1e-6 ? f.y : r3(p.y) };
      next = home ? d.base : moveNode(d.base, d.ends, at, modelRef.current);
      ui = { kind: "node", id: f.id, ep: !!ep, snap: ep ? "end" : sw ? sw.kind : null, guides: sw ? sw.guides : null, x: at.x, y: at.y };
    } else if (d.kind === "opening") {
      // Moves along its wall as far as the pointer has (wherever it was
      // grabbed), kept inside the wall; Snap to grid steps its gap to the
      // nearer wall end.
      const r = slideOpening(d.base, d.okind, d.id, d.host, d.src.x + raw.x - d.w0.x, d.src.y + raw.y - d.w0.y, flags.gridSnap ? settings.grid : 0);
      next = r.model; ui = { kind: "opening", id: d.id, gap: r.gap };
      at = raw;
    } else if (d.kind === "room") {
      // By whole mm, as a label is placed (no grid); its area follows live.
      const dx = Math.round(raw.x - d.w0.x), dy = Math.round(raw.y - d.w0.y);
      next = !dx && !dy ? d.base : { ...d.base, rooms: d.base.rooms.map((r, i) => (i === d.index ? { ...r, x: d.src.x + dx, y: d.src.y + dy } : r)) };
      ui = { kind: "room", index: d.index };
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
    const pk = tool === "select" ? pickAt(model, raw) : null, hov = !!pk && (!!pk.end || pk.ri >= 0); // a wall end or a room label
    setCur({ x: p.x, y: p.y, rx: raw.x, ry: raw.y, sx: e.clientX, sy: e.clientY, on: true, ep: !!p.ep, snap: p.ep ? "end" : p.kind || null, guides: p.guides || null, hov });
  };
  const handleDown = (e) => {
    if (pinchActiveRef.current) { cancelDrag(); return; }
    suppressClickRef.current = false;
    if (tool === "pan" || e.button === 1 || e.shiftKey) {
      panRef.current = { mx: e.clientX, my: e.clientY, tx: view.tx, ty: view.ty };
      e.preventDefault();
      return;
    }
    if (tool === "select" && e.button === 0 && !dragRef.current) {
      // An Inspector field being edited saves as it loses focus (via change()):
      // blur it now, so the press starts from the edited model, not on the
      // mousedown that follows.
      const ae = document.activeElement;
      if (ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName)) ae.blur();
      armDrag(e, toWorld(e.clientX, e.clientY));
    }
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
  // a NEW wall where you click - unless Chain walls is on (placeWall).
  const finishAction = () => { setDraftPts([]); setDimP1(null); };
  // Place the wall a -> b. Chain walls on: the next wall starts at b, the same
  // numbers so the corner joins seamlessly, until a wall ends on the run's
  // first point (closing the shape) or Esc. Off, or turned off mid-run, the
  // tool waits for a new start point as always.
  const placeWall = (a, b) => {
    commitWallSeg(a, b);
    const nx = afterWall(flags.chain, run, a, b);
    if (!nx.draft.length) { finishAction(); return; }
    setDraftPts(nx.draft); setRun(nx.run); setTypedLen("");
  };
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
    if (!end || retraces(run, end)) return; // straight back over the last wall: keep waiting
    placeWall(draftPts[draftPts.length - 1], runEnd(flags.chain, run, end));
  };
  const handleClick = (e) => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    if (panRef.current) return;
    const raw = toWorld(e.clientX, e.clientY);
    if (isWallTool) {
      const from = draftPts.length ? draftPts[draftPts.length - 1] : null;
      const p = wallPoint(raw, from);
      if (!from) { setDraftPts([p]); setRun(startRun(p)); return; }
      const end = runEnd(flags.chain, run, p); // on the run's first point: exactly there
      if (end.x === from.x && end.y === from.y) return; // zero length: keep waiting for the end point
      if (retraces(run, end)) return; // chained: straight back over the last wall - keep waiting
      placeWall(from, end);
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
      // A new room label works its area out from the walls round it (auto).
      if (tool === "room") change((m) => ({ ...m, rooms: m.rooms.concat([{ name: nm, area: 0, x: Math.round(raw.x), y: Math.round(raw.y), auto: true }]) }));
      else change((m) => ({ ...m, notes: m.notes.concat([{ text: nm, x: Math.round(raw.x), y: Math.round(raw.y) }]) }));
      finishAction();
      return;
    }
    if (tool === "select") {
      // Rooms have no ids: selected by index (rooms are only ever added to the
      // end or removed, and undo / redo clear the selection). Same order as a
      // press (pickAt); a wall end selects the wall a drag there would move.
      const selId = sel && sel.kind === "wall" ? sel.id : null;
      const { end, op, ri } = pickAt(model, raw, selId);
      setSel(end ? { kind: "wall", id: nodeAt(model.walls, end, raw, selId).g.id }
        : op || (ri >= 0 ? { kind: "room", index: ri } : hitTest(model.walls, raw.x, raw.y)));
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
      if (sel.kind === "room") return sel.index < m.rooms.length ? { ...m, rooms: m.rooms.filter((_, i) => i !== sel.index) } : m;
      return { ...m, walls: m.walls.filter((w) => w.id !== sel.id) };
    });
    setSel(null);
  };
  // Room label edits (name, Automatic area): explicit, so only this room changes.
  const updRoom = (patch) => {
    if (!sel || sel.kind !== "room") return;
    change((m) => ({ ...m, rooms: m.rooms.map((r, i) => (i === sel.index ? { ...r, ...patch } : r)) }));
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
  // Old sketches keep their link as it was ({ projectId, sheetId, frame }) until a send.
  const keptLegacy = () => (legacyFrame ? { legacyFrame } : {});
  const currentLink = () => (linkProjectId ? { projectId: linkProjectId, sheetId: linkSheetId, frame, ...(linkScale ? { scale: linkScale, ...keptLegacy() } : {}) } : null);
  // id: the sketch's id when it was saved earlier in the same send.
  const persistSketch = async (link, knownId = sketchId) => {
    const lk = link === undefined ? currentLink() : link;
    const data = { ...model, _link: lk };
    if (knownId) { await updateSketch(knownId, sketchName, data); return knownId; }
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
    setLinkProjectId(null); setLinkSheetId(null); setFrame(null); setLinkScale(null); setLegacyFrame(null);
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
      setFrame(_link?.frame || null); setLinkScale(_link?.scale || null); setLegacyFrame(legacyFrameOf(_link));
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

  // A new drawing with this plan. ps: where it goes on the sheet and at what
  // scale (planSheetFrame), which the title block's Scale says.
  const createDrawing = async (path, w, h, ps) => {
    setPlanBusy("Creating drawing");
    const sheetId = "s_" + Math.random().toString(36).slice(2, 9);
    const today = new Date().toISOString().slice(0, 10);
    const name = sketchName || "Untitled drawing";
    const data = {
      meta: { projectName: name, drawingNumber: "", date: today, revision: "A", revNote: "First Issue", company: "", clientName: "", clientEmail: "", scale: scaleLabel(ps.scale) },
      boq: null, titleBlock: null, colourMode: "red",
      notes: "", // blank Installation Notes, like any new drawing
      sheets: [{ id: sheetId, name, drawingNumber: "", bgImage: { path, w, h, planFrame: ps.frame, planScale: ps.scale }, placed: [], furniture: [], walls: [], wires: [], annotations: [], notes: "", symbolScale: 1 }],
      activeSheetId: sheetId,
    };
    const newId = await insertProject(name, data);
    setLinkProjectId(newId); setLinkSheetId(sheetId); setFrame(ps.frame); setLinkScale(ps.scale);
    const skId = await persistSketch({ projectId: newId, sheetId, frame: ps.frame, scale: ps.scale, ...keptLegacy() });
    try { await updateProjectRow(newId, name, { ...data, sheets: data.sheets.map((s) => s.id === sheetId ? { ...s, sketchId: skId } : s) }); } catch (e) { console.warn(e); }
    setPlanBusy(null);
    router.push("/drawing?id=" + newId);
  };
  // Where the plan goes on the A3 sheet and at what scale (lib/cad/planScale).
  // withLink: this send updates the drawing it was last sent to, so the frame
  // and scale it went with then decide whether anything moves.
  const sheetPlanOf = (m, withLink, polys = null) => planSheetFrame(m, { scalePref: scalePrefOf(m), link: withLink && frame ? { frame, scale: linkScale } : null, polys });
  // A picked scale the plan doesn't fit at: what to choose instead. Too big
  // for every standard scale, only Auto (past 1:500) shows all of it.
  const scaleCure = (p) => (p.tooBig ? `choose Auto (1:${p.autoScale}) so none of it is cut off` : "choose a smaller scale or Auto");
  const runUsePlan = async (mode) => {
    setPlanModal(false);
    const embed = !!(embedded && onApplyPlan);
    const ps = sheetPlanOf(model, embed || mode === "update");
    // Only a picked scale can cut the plan off (Auto never does): ask first.
    if (ps.cut && !window.confirm(`The plan doesn't fit A3 at 1:${ps.scale}, so part of it will be cut off the drawing, and anything placed on that part will be hidden.\n\nSend it anyway? Cancel to ${scaleCure(ps)}.`)) return;
    setPlanBusy("Preparing plan");
    try {
      const png = await renderModelToPng(model, ps.frame, PLAN_PX);
      setPlanBusy("Uploading plan");
      const { path } = await uploadPlanImage(dataUrlToBlob(png.dataUrl));
      const lk = { projectId: linkProjectId, sheetId: linkSheetId, frame: ps.frame, scale: ps.scale, ...keptLegacy() };
      // Sending to a drawing it updates: the sketch is saved first with the
      // link it has, so its edits are safe whatever happens next, and its
      // link moves on to the new frame and scale only once the drawing is
      // saved with them - a failed save can't leave the link naming a frame
      // the drawing's plan isn't drawn at.
      if (embed) {
        // The editor puts it on the sheet, moving what is placed there with
        // the plan when the frame changed, saves, then calls onSaved
        // (applyFloorPlan).
        const skId = await persistSketch(currentLink());
        setFrame(ps.frame); setLinkScale(ps.scale); setPlanBusy(null);
        const onSaved = () => persistSketch(lk, skId).catch((e) => console.warn(e));
        onApplyPlan({ path, w: png.w, h: png.h, dataUrl: png.dataUrl, sketchId: skId, sheetId: linkSheetId, scale: ps.scale, frame: ps.frame, remap: ps.remap, legacyFrame, manual: ps.manual, onSaved });
        onClose && onClose();
        return;
      }
      if (mode === "update" && linkProjectId) {
        setPlanBusy("Updating drawing");
        let proj = null;
        try { proj = await getProjectData(linkProjectId); } catch { proj = null; }
        if (!proj) { await createDrawing(path, png.w, png.h, ps); return; }
        const skId = await persistSketch(currentLink());
        // The linked sheet; if it has gone, the drawing's active (else first) one.
        const sheets = proj.sheets || [];
        const tid = sheets.some((s) => s.id === linkSheetId) ? linkSheetId
          : !sheets.length ? null : proj.activeSheetId && sheets.some((s) => s.id === proj.activeSheetId) ? proj.activeSheetId : sheets[0].id;
        const plan = { path, w: png.w, h: png.h, sketchId: skId, frame: ps.frame, scale: ps.scale, oldFrame: ps.remap && ps.remap.oldFrame, legacyFrame, linked: tid === linkSheetId };
        let outside = 0;
        const newSheets = sheets.map((s) => {
          if (s.id !== tid) return s;
          const r = applyPlanToSheet(s, plan);
          outside = r.outside;
          return r.sheet;
        });
        const meta = tid ? { meta: { ...(proj.meta || {}), scale: scaleLabel(ps.scale) } } : {};
        await updateProjectRow(linkProjectId, proj.meta?.projectName || sketchName, { ...proj, ...meta, sheets: newSheets });
        // The drawing has it now. Should this last write fail, the sketch's
        // edits are already saved and the sheet's own planFrame says where
        // its plan is, which the next send goes by.
        try { await persistSketch(lk, skId); } catch (e) { console.warn(e); }
        setFrame(ps.frame); setLinkScale(ps.scale); setPlanBusy(null);
        if (outside) window.alert(outsideNote(outside, ps.scale, ps.manual));
        router.push("/drawing?id=" + linkProjectId);
        return;
      }
      await createDrawing(path, png.w, png.h, ps);
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
      setFrame(_link?.frame || null); setLinkScale(_link?.scale || null); setLegacyFrame(legacyFrameOf(_link));
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
  // The spaces the walls enclose, for room labels with Automatic area
  // (lib/cad/rooms); only worked out when there is such a label.
  const anyAuto = model.rooms.some(isAuto);
  const spaces = useMemo(() => (anyAuto ? roomSpaces(model.walls, joined.polys) : null), [model.walls, joined, anyAuto]);
  // Where the plan will go on the A3 sheet if sent now (as runUsePlan: the
  // frame it was last sent with when opened from, or linked to, a drawing):
  // the drawing-area outline on the canvas and the Scale section.
  const sheetPlan = useMemo(() => sheetPlanOf(model, embedded || !!linkProjectId, joined.polys),
    [model, joined, frame, linkScale, embedded, linkProjectId]); // eslint-disable-line react-hooks/exhaustive-deps
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
      // Automatic area: worked out from the walls, none when not enclosed.
      // Older labels show the area typed in, as always.
      g.push(<g key="rooms">{model.rooms.map((r, i) => {
        const a = isAuto(r) ? areaAt(spaces, r.x, r.y) : null;
        return (
          <g key={"room" + i} className={sel && sel.kind === "room" && sel.index === i ? "cadv-room sel" : "cadv-room"}>
            <text x={r.x} y={r.y} className="nm" fontSize={230} textAnchor="middle">{r.name.toUpperCase()}</text>
            {isAuto(r) ? (a != null ? <text x={r.x} y={r.y + 300} className="ar" fontSize={165} textAnchor="middle">{a.toFixed(1) + " m\u00B2"}</text> : null)
              : r.area ? <text x={r.x} y={r.y + 300} className="ar" fontSize={165} textAnchor="middle">{r.area.toFixed(1) + " m\u00B2"}</text> : null}
          </g>
        );
      })}</g>);
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
  }, [model, sel, layers, joined, spaces]);

  // Snap to walls markers (screen-constant): a diamond where a point lands on
  // a wall's side, a ring on a guide; each guide dashed from its tracking
  // point (a small x there) through the point. Wall ends keep their square.
  const snapMarks = (k, p) => {
    const s = view.s, out = [];
    if (p.snap === "side") out.push(<polygon key={k + "sd"} points={ptStr([[p.x, p.y - 10 / s], [p.x + 10 / s, p.y], [p.x, p.y + 10 / s], [p.x - 10 / s, p.y]])} fill="none" className="cadv-active" strokeWidth={2} vectorEffect="non-scaling-stroke" />);
    if (p.snap === "guide") out.push(<circle key={k + "gd"} cx={p.x} cy={p.y} r={8 / s} fill="none" className="cadv-active" strokeWidth={2} vectorEffect="non-scaling-stroke" />);
    if (p.snap !== "end") (p.guides || []).forEach((g, i) => {
      const L = hyp(p.x - g.x, p.y - g.y), m = 5 / s;
      if (L < 1e-6) return;
      out.push(<line key={k + "gl" + i} x1={g.x} y1={g.y} x2={p.x + (p.x - g.x) / L * 60 / s} y2={p.y + (p.y - g.y) / L * 60 / s} className="cadv-guide" strokeWidth={1} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />);
      out.push(<path key={k + "gx" + i} d={`M${g.x - m} ${g.y - m}L${g.x + m} ${g.y + m}M${g.x - m} ${g.y + m}L${g.x + m} ${g.y - m}`} className="cadv-guide" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />);
    });
    return out;
  };

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
    if (isWallTool && flags.wallSnap && !typedLen) overlay.push(...snapMarks("c", cur)); // a typed length isn't snapped
  }
  // Select: drag handles at the selected wall's ends (screen-constant size);
  // a dragged corner shows the end-snap square when it lands on another end.
  const selWall = sel && sel.kind === "wall" ? model.walls.find((w) => w.id === sel.id) : null;
  if (tool === "select" && layers.walls && selWall) [[selWall.x1, selWall.y1], [selWall.x2, selWall.y2]].forEach(([x, y], k) =>
    overlay.push(<rect key={"hd" + k} x={x - 4.5 / view.s} y={y - 4.5 / view.s} width={9 / view.s} height={9 / view.s} className="cadv-handle" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />));
  if (dragUi && dragUi.ep) overlay.push(<rect key="dep" x={dragUi.x - 9 / view.s} y={dragUi.y - 9 / view.s} width={18 / view.s} height={18 / view.s} fill="none" className="cadv-active" strokeWidth={2} vectorEffect="non-scaling-stroke" />);
  if (dragUi && dragUi.kind === "node" && flags.wallSnap) overlay.push(...snapMarks("d", dragUi));
  // The A3 drawing area at the plan's scale, where sending it will put it
  // (sheetPlan): faint and dashed under the plan, red when a picked scale
  // cuts the plan off; its label over the plan, haloed, so walls never hide
  // it. Only once there are walls. On screen only - never in the plan image.
  const sf = sheetPlan.frame, hasWalls = model.walls.length > 0, sheetCls = sheetPlan.cut ? "cadv-sheet over" : "cadv-sheet";
  // The label at the outline's top-left corner, kept in sight (screen px):
  // below the canvas top when that edge is above it, and clear of the tool
  // palette (top left) - along the edge, inside the outline.
  const fx0 = sf.x * view.s + view.tx, fy0 = sf.y * view.s + view.ty;
  const lyS = Math.max(fy0 - 7, Math.min(18, (sf.y + sf.h) * view.s + view.ty - 6));
  const lxS = Math.max(fx0, Math.min(lyS < 104 ? 64 : 8, (sf.x + sf.w) * view.s + view.tx - 40));
  const sheetOutline = hasWalls && (
    <g className={sheetCls} pointerEvents="none">
      <rect x={sf.x} y={sf.y} width={sf.w} height={sf.h} fill="none" strokeWidth={1.2} strokeDasharray="10 7" vectorEffect="non-scaling-stroke" />
    </g>
  );
  const sheetLabel = hasWalls && (
    <g className={sheetCls} pointerEvents="none">
      <text x={(lxS - view.tx) / view.s} y={(lyS - view.ty) / view.s} fontSize={11 / view.s} stroke="#FFFFFF" strokeWidth={3 / view.s} strokeLinejoin="round" paintOrder="stroke">
        {`A3 · 1:${sheetPlan.scale}${sheetPlan.cut ? " · PLAN DOESN'T FIT" : ""}`}
      </text>
    </g>
  );

  // length HUD (DOM, at cursor). With Snap to walls on it also names the
  // snap in use: END, SIDE or GUIDE.
  const snapTag = (k) => (flags.wallSnap && SNAP_LABEL[k] ? <span className="snap">{SNAP_LABEL[k]}</span> : null);
  let hud = null;
  if (isWallTool && !draftPts.length && cur.on && snapTag(cur.snap)) {
    const wr = wrapRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
    hud = <div className="cadv__hud" style={{ left: cur.sx - wr.left, top: cur.sy - wr.top }}>{snapTag(cur.snap)}</div>;
  } else if (isWallTool && draftPts.length && cur.on) {
    const lp = draftPts[draftPts.length - 1];
    const L = Math.round(hyp(cur.x - lp.x, cur.y - lp.y));
    const wr = wrapRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
    // Chain walls: this wall would end on the run's first point, closing the shape.
    const closing = flags.chain && run && runEnd(true, run, typedLen ? typedEnd() : cur) === run.start;
    hud = typedLen
      ? <div className="cadv__hud cadv__hud--typed" style={{ left: cur.sx - wr.left, top: cur.sy - wr.top }}>Length <b>{typedLen}<i className="cadv__caret" /> mm</b> <span>{closing ? "Enter to close" : "Enter to place"}</span></div>
      : <div className="cadv__hud" style={{ left: cur.sx - wr.left, top: cur.sy - wr.top }}>Length <b>{fmtMM(L)} mm</b>{closing ? <span className="sub">closes the shape</span> : null}{snapTag(cur.snap)}</div>;
  } else if (tool === "dim" && dimP1 && cur.on) {
    const L2 = Math.round(hyp(cur.x - dimP1.x, cur.y - dimP1.y));
    const wr = wrapRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
    hud = <div className="cadv__hud" style={{ left: cur.sx - wr.left, top: cur.sy - wr.top }}><b>{fmtMM(L2)} mm</b></div>;
  } else if (dragUi && dragUi.kind === "opening") {
    // Gap from the opening's nearer edge to the nearer end of its wall.
    const wr = wrapRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
    hud = <div className="cadv__hud" style={{ left: cur.sx - wr.left, top: cur.sy - wr.top }}>To wall end <b>{fmtMM(dragUi.gap)} mm</b></div>;
  } else if (dragUi && dragUi.kind === "room") {
    // The area the label will show where it is now.
    const r = model.rooms[dragUi.index], a = r ? (isAuto(r) ? areaAt(spaces, r.x, r.y) : r.area || null) : null;
    const wr = wrapRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
    if (r && (a != null || isAuto(r))) hud = <div className="cadv__hud" style={{ left: cur.sx - wr.left, top: cur.sy - wr.top }}>{a != null ? <>Area <b>{a.toFixed(1)} m&#178;</b></> : onWall(spaces, r.x, r.y) ? "On a wall" : "Not enclosed"}</div>;
  } else if (dragUi) {
    const gw = model.walls.find((w) => w.id === dragUi.id);
    const wr = wrapRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
    if (gw) hud = <div className="cadv__hud" style={{ left: cur.sx - wr.left, top: cur.sy - wr.top }}>Length <b>{fmtMM(segLen(gw))} mm</b>{dragUi.kind === "wall" ? <span className="sub">moved {fmtMM(dragUi.off)} mm</span> : snapTag(dragUi.snap)}</div>;
  }

  const selDoor = sel && sel.kind === "door" ? model.doors.find((d) => d.id === sel.id) : null;
  const selWin = sel && sel.kind === "window" ? model.windows.find((w) => w.id === sel.id) : null;
  const selRoom = sel && sel.kind === "room" ? model.rooms[sel.index] || null : null;
  const selArea = selRoom ? (isAuto(selRoom) ? areaAt(spaces, selRoom.x, selRoom.y) : selRoom.area || null) : null;
  const selOnWall = !!selRoom && isAuto(selRoom) && selArea == null && onWall(spaces, selRoom.x, selRoom.y);
  // Chain walls on: a run of walls, each from the last one's end, until Esc.
  const wallHint = (kind) => !draftPts.length
    ? (flags.chain ? `Click the start point of a run of ${kind} walls - Esc to exit` : `Click the start point of an ${kind} wall - Esc to exit`)
    : flags.chain && run && run.walls > 0 ? "Click the next point, or type a length in mm and press Enter - Esc to finish"
    : "Click the end point, or type a length in mm and press Enter - Esc to cancel";
  const hint = dragUi ? "Release to place it - Esc to put it back" : {
    select: "Click to select. Drag a wall, end, opening or label to move it. Shift-drag to pan.",
    ext: wallHint("external"),
    int: wallHint("internal"),
    door: "Click on a wall to place a door - Esc to exit",
    window: "Click on a wall to place a window - Esc to exit",
    dim: dimP1 ? "Click the second measure point - Esc to cancel" : "Click the first measure point - Esc to exit",
    room: "Click inside a space to drop a room label (area from the walls) - Esc to exit",
    text: "Click to place a note - Esc to exit",
    pan: "Drag to pan the sheet",
  }[tool];
  // Status bar: the keys for what is happening now, as key caps
  // (components/Shortcuts.jsx StatusHint); on touch, what to tap or drag.
  const typedCloses = !!typedLen && flags.chain && run && runEnd(true, run, typedEnd()) === run.start;
  const chained = flags.chain && run && run.walls > 0;
  const act = TOUCH ? "Tap" : "Click";
  const moveSel = !sel ? null : sel.kind === "wall" ? "Drag the wall or a corner" : sel.kind === "room" ? "Drag the label" : "Drag it along its wall";
  const statusParts = dragUi ? (TOUCH ? ["Lift your finger to place it"] : ["Release to place it", ["esc", "put it back"]])
    : isWallTool && draftPts.length && typedLen ? [`Length ${typedLen} mm`, ["enter", typedCloses ? "close the shape" : "place"], ["backspace", "edit"], ["esc", "cancel"]]
    : isWallTool && draftPts.length ? (TOUCH ? [chained ? "Tap the next point" : "Tap the end point", chained ? "Finish run in the inspector ends it" : null]
      : [chained ? "Next point, or type a length" : "Type a length", ["enter", "to place"], ["esc", chained ? "to finish the run" : "to cancel"]])
    : isWallTool ? [flags.chain ? `${act} the start of a run of walls` : `${act} the start point`, !TOUCH && [tool === "int" ? "e" : "i", tool === "int" ? "external" : "internal"], !TOUCH && ["esc", "exit"]]
    : tool === "door" || tool === "window" ? [`${act} a wall to place a ${tool}`, !TOUCH && ["esc", "exit"]]
    : tool === "dim" ? [dimP1 ? `${act} the second point` : `${act} the first point`, !TOUCH && ["esc", dimP1 ? "cancel" : "exit"]]
    : tool === "room" ? [`${act} inside a space to drop a room label`, !TOUCH && ["esc", "exit"]]
    : tool === "text" ? [`${act} to place a note`, !TOUCH && ["esc", "exit"]]
    : tool === "pan" ? (TOUCH ? ["Drag to pan", "pinch to zoom"] : ["Drag to pan", ["wheel", "to zoom"], ["v", "select"]])
    : moveSel ? (TOUCH ? [moveSel + " to move it", "Delete is in the inspector"] : [moveSel, ["del", "to delete"], ["mod+z", "undo"], ["esc", "deselect"]])
    : TOUCH ? ["Tap to select, drag to move", "pinch to zoom", "two fingers to pan"]
    : ["Click to select, drag to move", ["shift+drag", "to pan"], ["mod+z", "undo"]];

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
  // Zoomed far out, the grid steps up tenfold rather than packing its lines tighter than 8px.
  let gridMm = GRID_MM;
  while (gridMm * view.s < 8) gridMm *= 10;
  const gridSz = gridMm * view.s;
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
          <TbButton onClick={goBack} icon={ChevronLeft} label={embedded ? "Back to drawing" : "Dashboard"} shortLabel={embedded ? "Drawing" : undefined} title={embedded ? "Back to the drawing (updates its plan if you changed anything)" : "Back to dashboard"} disabled={!!planBusy} fit="back" />
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
          <TbButton onClick={doSave} icon={Save} label={saveState === "saving" ? "Saving…" : savedFlash ? "Saved ✓" : "Save"} title="Save" kbd="mod+s" flash={savedFlash} disabled={saveState === "saving"} />
          <TbButton onClick={openUsePlan} icon={Send} label="Use this plan" shortLabel="Use plan" title="Send this plan to the electrical drawing" disabled={!!planBusy} />
        </TbGroup>

        <TbGroup label="Draw">
          {DRAW_TOOLS.map((t) => (
            <TbButton key={t.id} collapse fit="draw" icon={t.icon} label={t.label} kbd={t.kbd} kbdTip={t.kbdTip}
              active={t.id === "wall" ? isWallTool : tool === t.id} onClick={() => pickTool(t.id)} />
          ))}
        </TbGroup>

        <TbGroup label="Edit">
          <TbButton onClick={undo} icon={Undo2} title="Undo" kbd="mod+z" iconOnly disabled={!canUndo} />
          <TbButton onClick={redo} icon={Redo2} title="Redo" kbd="mod+shift+z" iconOnly disabled={!canRedo} />
        </TbGroup>

        <TbGroup label="View">
          <TbMenu icon={SlidersHorizontal} label="View" title="View options">
            <TbMenuItem icon={Grid3x3} label="Grid" checked={layers.grid} onClick={() => setLayers((l) => ({ ...l, grid: !l.grid }))} />
            <TbMenuItem icon={Magnet} label="Snap to grid" checked={flags.gridSnap} onClick={() => setFlags((f) => ({ ...f, gridSnap: !f.gridSnap }))} />
            <TbMenuItem icon={Compass} label="Lock angles (45°)" checked={flags.ortho} onClick={() => setFlags((f) => ({ ...f, ortho: !f.ortho }))} />
            <TbMenuItem icon={Crosshair} label="Snap to walls" checked={flags.wallSnap} onClick={() => setFlags((f) => ({ ...f, wallSnap: !f.wallSnap }))} />
            <TbMenuItem icon={Link2} label="Chain walls" checked={flags.chain} onClick={() => setFlags((f) => ({ ...f, chain: !f.chain }))} />
            <TbMenuItem icon={Maximize2} label="Zoom to fit" onClick={() => fit()} />
            <TbPanelsItem hidden={panelsHidden} onClick={() => setPanelsHidden((h) => !h)} />
            <TbThemeItem theme={theme} onClick={toggleTheme} />
          </TbMenu>
          <TbShortcutsButton onClick={openShortcuts} open={shortcutsOpen} />
        </TbGroup>

        <TbTrialSlot>{access.isTry ? <TryPill used={tryUsage.used} limit={tryUsage.limit} onSubscribe={subscribe} /> : null}</TbTrialSlot>
      </TopBarShell>

      <div className="relative z-10 flex-1 flex overflow-hidden">
        {/* ==================== LEFT PANEL ==================== */}
        {!panelsHidden && (
          <SidePanel side="left" title="Floor plan" eyebrow="SKETCH">
            <div className="flex-1 overflow-y-auto px-3 py-3">
              {/* The scale the plan goes on the A3 sheet at (lib/cad/planScale):
                  Auto, or a picked one saved with the sketch (undoable). */}
              <section className="mb-5">
                <SectionLabel>Scale</SectionLabel>
                <ChoiceGroup label="Scale" columns={3} value={scalePrefOf(model)}
                  onChange={(v) => v !== scalePrefOf(model) && change((m) => ({ ...m, sheetScale: v }))}
                  options={[{ value: "auto", label: "Auto" }, ...SCALES.map((s) => ({ value: s, label: "1:" + s }))]} />
                {!hasWalls ? (
                  <div className={`mt-2 ${PANEL_HELP}`}>Draw the walls to see the scale and the A3 drawing area.</div>
                ) : sheetPlan.cut ? (
                  <div role="alert" className={SCALE_WARN}>The plan doesn&apos;t fit A3 at 1:{sheetPlan.scale} - {scaleCure(sheetPlan)}.</div>
                ) : !sheetPlan.manual && sheetPlan.tooBig ? (
                  <div role="alert" className={SCALE_WARN}>Too big for A3 even at 1:500 - Auto draws it at 1:{sheetPlan.scale} so none of it is cut off.</div>
                ) : (
                  <div className={`mt-2 ${PANEL_HELP}`}>
                    {!sheetPlan.manual ? `Auto - 1:${sheetPlan.scale}, the largest scale that fits A3.`
                      : sheetPlan.fits ? `1:${sheetPlan.scale} fits the A3 drawing area.`
                      : `1:${sheetPlan.scale} fits, but closer to the edge than the ${MARGIN_MM} mm margin Auto keeps.`} The dashed outline shows the drawing area.
                  </div>
                )}
              </section>
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
                <ToggleRow label="Snap to walls" hint="Wall sides and alignment guides" checked={flags.wallSnap}
                  onChange={(v) => setFlags((f) => ({ ...f, wallSnap: v }))} />
                <ToggleRow label="Chain walls" hint="Each wall starts where the last one ended" checked={flags.chain}
                  onChange={(v) => setFlags((f) => ({ ...f, chain: v }))} />
              </section>
              <section>
                <SectionLabel className="mb-1">Layers</SectionLabel>
                {LAYER_LIST.map(([id, label]) => {
                  const on = layers[id];
                  return (
                    <button key={id} type="button" role="switch" aria-checked={on} title={on ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
                      onClick={() => { if (on && sel && SEL_LAYER[sel.kind] === id) setSel(null); setLayers((l) => ({ ...l, [id]: !l[id] })); }}
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
                {sheetOutline}
                {planEls}
                {sheetLabel}
                {overlay}
              </g>
            </svg>
            {hud}
          </div>

          <FloatingToolbar tool={tool} setTool={pickTool} tools={CANVAS_TOOLS} />
          <ZoomControls zoom={view.s / 0.08} onIn={() => zoomBy(1.2)} onOut={() => zoomBy(1 / 1.2)} onFit={() => fit()} keys={false} />
          <div className="absolute left-4 bottom-11 z-20 flex items-center gap-3 px-3 h-8 bg-white dark:bg-[#16202B] rounded-xl ring-1 ring-slate-200/70 dark:ring-[#2A3947] shadow-[0_10px_30px_-10px_rgba(16,28,40,0.22)] text-[11px] text-slate-700 dark:text-slate-200"
               style={{ fontFamily: "var(--font-jetbrains-mono), monospace" }}>
            <span className="font-semibold">N &#8593;</span>
            <span className="inline-flex h-1.5 ring-1 ring-slate-400"><i className="w-5 bg-slate-600 dark:bg-slate-300" /><i className="w-5 bg-white dark:bg-[#16202B]" /><i className="w-5 bg-slate-600 dark:bg-slate-300" /></span>
            <span>0 1 2 m</span>
          </div>
          {/* First visit on this device: where the shortcuts are (after the name gate). */}
          {tipShow && !nameGate && !renameOpen && !planModal && !planBusy && !shortcutsOpen && (
            <ShortcutsTip className="left-4 bottom-[84px]" onDismiss={dismissTip} onOpen={openShortcuts} />
          )}

          {/* Under 1300px the grid size (it is in the panel) gives way to the hint. */}
          <StatusBar right={<>X {Math.round(cur.x)} Y {Math.round(cur.y)} · <span className="hidden min-[1300px]:inline">GRID {settings.grid}MM · </span><span className={saveState === "unsaved" || saveState === "error" ? "text-amber-600" : ""}>{SAVE_LABEL[saveState]}</span></>}>
            <span>TOOL <span className="text-[#22808F] ml-1">{TOOL_NAME[tool].toUpperCase()}</span></span>
            <StatusHint parts={statusParts} />
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
              ) : selRoom ? (
                <>
                  <div className="text-[15px] font-semibold text-slate-900 dark:text-slate-100" style={{ fontFamily: "var(--font-space-grotesk), sans-serif" }}>Room</div>
                  <div className={`mt-1 mb-4 ${PANEL_HELP}`}>Drag the label on the plan to move it. With Automatic area on, the area is worked out from the walls round it.</div>
                  <SectionLabel>Name</SectionLabel>
                  <NameField key={sel.index} label="Room name" value={selRoom.name} onCommit={(nm) => updRoom({ name: nm })} />
                  <div className="mt-4"><ScheduleRows rows={[["Area", selArea != null ? selArea.toFixed(1) + " m\u00B2" : selOnWall ? "On a wall" : isAuto(selRoom) ? "Not enclosed" : "None"]]} /></div>
                  {isAuto(selRoom) && selArea == null && <div className={`mt-1 ${PANEL_HELP}`}>{selOnWall ? "On a wall - move the label into a room to get an area." : "Not enclosed - close the walls to get an area."}</div>}
                  <div className="mt-3"><ToggleRow label="Automatic area" hint="Worked out from the walls round it" checked={isAuto(selRoom)} onChange={(v) => updRoom({ auto: v })} /></div>
                  <PanelAction danger onClick={deleteSel} className="w-full mt-5"><Trash2 size={14} /> Delete room</PanelAction>
                </>
              ) : (
                <>
                  <div className="text-[15px] font-semibold text-slate-900 dark:text-slate-100" style={{ fontFamily: "var(--font-space-grotesk), sans-serif" }}>{TOOL_NAME[tool]}</div>
                  <div className={`mt-1 ${PANEL_HELP}`}>{hint}</div>
                  {isWallTool && flags.chain && <div className={`mt-2 ${PANEL_HELP}`}>Chain walls is on: each wall starts where the last one ended. Click the first point again to close the shape.</div>}
                  {/* No Esc key on touch: this ends an open run (the walls stay). */}
                  {isWallTool && flags.chain && draftPts.length > 0 && run && run.walls > 0 && (
                    <PanelAction primary onClick={finishAction} className="w-full mt-3">Finish run</PanelAction>
                  )}
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
                <button className="m-btn primary" onClick={() => runUsePlan("apply")}>Add to this drawing<small>Keeps your placed symbols on the same spots of the plan</small></button>
              </>
            ) : linkProjectId ? (
              <>
                <p>This sketch is already linked to an electrical drawing. Update that drawing with your latest plan and keep every symbol you have placed, or start a brand-new drawing.</p>
                <button className="m-btn primary" onClick={() => runUsePlan("update")}>Update existing drawing<small>Keeps your placed symbols on the same spots of the plan</small></button>
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
      <ShortcutsCard open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} subtitle="Sketch a plan"
        groups={SHORTCUTS} touchGroups={TOUCH_GESTURES} />
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
.cadv-guide{stroke:#2C97A8; fill:none; opacity:.85}
.cadv-cross{stroke:#2C3E50}
.cadv-dim{stroke:#2C3E50}
.cadv-dim-crit{stroke:#C4564B}
.cadv-boundary{stroke:#38B24A}
.cadv-dim-txt{font-family:var(--font-jetbrains-mono),monospace; fill:#2C3E50}
.cadv-dim-txt.crit{fill:#C4564B}
.cadv-room{font-family:var(--font-jetbrains-mono),monospace; fill:#2C3E50}
.cadv-room .nm{font-weight:600; letter-spacing:.08em}
.cadv-room .ar{fill:#6E7B88}
.cadv-room.sel, .cadv-room.sel .ar{fill:#3FB7C9}
.cadv-tag-txt{font-family:var(--font-jetbrains-mono),monospace; fill:#16212B}
.cadv-note{font-family:var(--font-jetbrains-mono),monospace; fill:#54616E}
.cadv-sheet rect{stroke:#2C97A8; opacity:.6}
.cadv-sheet text{fill:#22808F; font-family:var(--font-jetbrains-mono),monospace; font-weight:600; letter-spacing:.06em; opacity:.85}
.cadv-sheet.over rect{stroke:#C4564B; opacity:.95}
.cadv-sheet.over text{fill:#C4564B; opacity:1}
.cadv__hud{position:absolute; z-index:8; pointer-events:none; background:#1A2733; color:#EAF1F6; font-family:var(--font-jetbrains-mono),monospace; font-size:11.5px; padding:4px 8px; border-radius:6px; white-space:nowrap; transform:translate(14px,14px)}
.cadv__hud b{color:#3FB7C9; font-weight:600}
.cadv__hud .sub{color:#8FA3B3; margin-left:6px}
.cadv__hud .snap{display:inline-block; margin-left:8px; padding:0 4px; border-radius:3px; background:#2C97A8; color:#0E141B; font-size:10px; font-weight:600; letter-spacing:.06em; line-height:15px}
.cadv__hud .snap:first-child{margin-left:0}
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
