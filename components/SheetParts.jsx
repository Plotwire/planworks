"use client";

import React, { useMemo, useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Upload, Trash2, Save, FolderOpen, Download, Undo2, Redo2,
  MousePointer2, Cable, BrickWall, RotateCw, ZoomIn, ZoomOut, Maximize2,
  Palette as PaletteIcon, Ruler, Hand, Type, Printer, Settings, Search, Sun, Moon, Mail,
  ChevronRight, ChevronLeft, X, FileText, PanelLeftClose, PanelLeftOpen,
  Grid3x3, ClipboardList, Plus, Clock, LayoutPanelTop, ImagePlus, SlidersHorizontal, Building2,
} from "lucide-react";
import {
  SYMBOLS, SYMBOL_META, CATEGORY_COLOURS, VIEWBOX,
  findSymbol, findCategory, resolveColours,
  getPaletteSymbols, getPaletteGroups,
} from "@/lib/symbols.jsx";
import { findFurniture, FURNITURE, FURNITURE_VIEWBOX, FURNITURE_COLOUR } from "@/lib/furniture.jsx";
import { drawSymbol } from "@/lib/symbolPdf";
import { buildInitialBoq, refreshQuantities, reconcileBoq, newBoqItem, templateForEditing, templateForSaving, newTemplateItem } from "@/lib/boqTemplate";
import { useApp } from "@/components/AppShell";
import { DEFAULT_TITLEBLOCK, resizeImageToDataUrl } from "@/lib/titleBlock";
import { ensurePdfjs } from "@/lib/pdfjs";
import { useEditor } from "@/store/editorStore";
import { Masthead } from "@/components/TitleBlockMasthead";
import { isTouchDevice, supersampleFactor } from "@/lib/touch";

// Per-project title block. The editor publishes the *effective* title block
// (the project's own, falling back to the account default) through this context
// so the on-sheet and print renderers show job-specific branding instead of one
// global block shared by every project.
export const ProjectTitleBlockContext = React.createContext(null);
export function useProjectTitleBlock() {
  return React.useContext(ProjectTitleBlockContext) || DEFAULT_TITLEBLOCK;
}

/* ============================================================================
 * The sheet model
 * Re-declared here so this file is self-contained. Must match the values
 * in ElectricalPlanTool.jsx.
 * ========================================================================= */
const SHEET = {
  width: 1587,
  height: 1123,
  margin: 18,
  legendWidth: 230,
  notesWidth: 280,
  titleHeight: 110,
};

/* Where the plan sits inside the drawing area: scaled to fit (contain) and
 * centred. Returns { x, y, w, h } in CSS px, relative to DRAW's top-left.
 *
 * The editor, the print page and the PDF export all place the plan with this
 * one function. Symbols are positioned in the same DRAW space, so sharing it
 * is what keeps them on the right wall line in all three. */
function planFootprint(DRAW, w, h) {
  const scale = Math.min(DRAW.w / w, DRAW.h / h);
  const fw = w * scale;
  const fh = h * scale;
  return { x: (DRAW.w - fw) / 2, y: (DRAW.h - fh) / 2, w: fw, h: fh };
}

const TOOLS = {
  select: { icon: MousePointer2, label: "Select", hint: "V" },
  pan:    { icon: Hand,          label: "Pan",    hint: "H" },
  wire:   { icon: Cable,         label: "Wire",   hint: "W" },
  wall:   { icon: BrickWall,     label: "Wall",   hint: "" },
  note:   { icon: Type,          label: "Note",   hint: "N" },
};

/* ============================================================================
 * TOP BAR
 * ========================================================================= */
export function TopBar({
  meta, onHome, theme, onToggleTheme, onShowMeta, onImport, onUndo, onRedo, onSave, savedFlash, onShowProjects,
  onExportJSON, onPrint, colourMode, onToggleColour, onNormalise, normaliseFlash,
  snapEnabled, onToggleSnap, onShowBoq, onShowTitleBlock, onShowNotes,
  sidebarHidden, onToggleSidebar,
}) {
  const projectLabel = meta.projectName || "Untitled Project";
  const sheetLabel = meta.sheetName || "Drawing";
  return (
    <header className="relative z-30 flex items-center gap-2 px-3 h-12 bg-white dark:bg-[#16202B] border-b border-slate-200 dark:border-[#263441]">
      <div className="flex items-center gap-2 min-w-0 shrink-0">
        {onHome && (
          <>
            <button onClick={onHome} title="Back to dashboard"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-200 hover:bg-[#2C97A8] hover:text-[#1A2530] dark:hover:bg-[#2C97A8] dark:hover:text-[#1A2530] transition-colors text-[11px] font-semibold">
              <ChevronLeft size={14}/> <span className="hidden lg:inline">Dashboard</span>
            </button>
            <div className="w-px h-5 bg-slate-200 dark:bg-[#2A3947]"/>
          </>
        )}
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[15px] tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Plot<span className="text-[#3FB7C9]">wire</span>
          </span>
        </div>
        <div className="w-px h-5 bg-slate-200 dark:bg-[#2A3947]"/>
        <button
          onClick={onShowMeta}
          title={`${projectLabel} — ${sheetLabel}`}
          className="group flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#3FB7C9] hover:bg-[#52C4D5] text-[#08313a] transition-colors text-[11px] font-semibold shadow-[#3FB7C9]/30 shadow-md min-w-0">
          <FileText size={13} className="text-[#08313a]/70 shrink-0"/>
          <span className="truncate max-w-[110px] sm:max-w-[220px]">{projectLabel}</span>
          <ChevronRight size={12} className="text-[#08313a]/70 shrink-0"/>
        </button>
      </div>

      <div className="flex items-center gap-1 ml-auto min-w-0 overflow-x-auto flex-nowrap [&::-webkit-scrollbar]:hidden" style={{ WebkitOverflowScrolling: "touch" }}>
        {/* History */}
        <ToolbarButton onClick={onUndo} icon={Undo2} label="Undo" hint="⌘Z"/>
        <ToolbarButton onClick={onRedo} icon={Redo2} label="Redo" hint="⌘⇧Z"/>
        <Divider />
        {/* File */}
        <ToolbarButton onClick={onImport} icon={Upload} label="Import"/>
        <ToolbarButton onClick={onSave} icon={Save} label={savedFlash ? "Saved ✓" : "Save"} flash={savedFlash} hint="⌘S"/>
        <ToolbarButton onClick={onPrint} icon={Download} label="Save As"/>
        <Divider />
        {/* View */}
        <ToolbarButton onClick={onToggleSnap} icon={Grid3x3} label="Grid" active={snapEnabled}/>
        <ToolbarButton onClick={onNormalise} icon={Ruler}
          label={normaliseFlash ? "Reset ✓" : "Reset sizes"} flash={normaliseFlash}
          hint="Make all symbols the same size"/>
        <ToolbarButton
          onClick={onToggleColour} icon={PaletteIcon}
          label={colourMode === "navy" ? "Navy" : colourMode === "red" ? "PB Red" : colourMode === "colour" ? "Colour" : "Mono"}
          active={colourMode === "navy"}/>
        <Divider />
        {/* Panels */}
        <ToolbarButton onClick={onShowNotes} icon={Type} label="Installation Notes"/>
        <ToolbarButton onClick={onShowBoq} icon={ClipboardList} label="BOQ"/>
        <ToolbarButton onClick={onShowTitleBlock} icon={LayoutPanelTop} label="Title block"/>
        <Divider />
        {/* On their own */}
        <ToolbarButton
          onClick={onToggleSidebar}
          icon={sidebarHidden ? PanelLeftOpen : PanelLeftClose}
          label={sidebarHidden ? "Show" : "Hide"}
          hint=""/>
        {onToggleTheme && (
          <>
            <Divider />
            <button onClick={onToggleTheme}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="shrink-0 p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white transition-colors">
              {theme === "dark" ? <Sun size={15}/> : <Moon size={15}/>}
            </button>
          </>
        )}
      </div>
    </header>
  );
}

function ToolbarButton({ onClick, icon: Icon, label, primary, active, hint, flash, teal }) {
  return (
    <button onClick={onClick}
      title={hint ? `${label} (${hint})` : label}
      className={`shrink-0 whitespace-nowrap px-3 py-2 text-[11px] uppercase tracking-wide font-semibold flex items-center gap-2 rounded-lg transition-all duration-150 ${
        primary
          ? "bg-[#3FB7C9] text-[#08313a] hover:bg-[#52C4D5] shadow-[#3FB7C9]/30 shadow-md"
          : flash
          ? "bg-emerald-500 text-white"
          : teal
          ? "bg-[#3FB7C9]/15 text-[#1C6E7B] dark:text-[#7fd6e3] ring-[1.5px] ring-[#3FB7C9]/70 hover:bg-[#3FB7C9]/25"
          : active
          ? "bg-[#3FB7C9]/15 text-[#1C6E7B] ring-1 ring-[#3FB7C9]/45"
          : "bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-200 hover:bg-[#2C97A8] hover:text-[#1A2530] dark:hover:bg-[#2C97A8] dark:hover:text-[#1A2530]"
      }`}>
      <Icon size={15} /> <span className="hidden lg:inline">{label}</span>
    </button>
  );
}

function Divider() { return <div className="w-px h-5 bg-slate-200 dark:bg-[#2A3947] mx-1 shrink-0" />; }

/* ============================================================================
 * SHEET TABS — switch between the drawings (floors) in a project
 * ========================================================================= */
export function SheetTabs({ sheets, activeId, onSwitch, onAdd, onRename, onDelete }) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");
  // Escape closes the input, and some browsers fire blur when a focused element
  // is removed -- which would commit the very edit we just cancelled. The flag
  // lets commit() know the edit was abandoned.
  const cancelledRef = useRef(false);
  // Double-TAP detection. A plain <div> doesn't reliably get a dblclick on iOS /
  // Android, so touch gets its own "two taps in a row" check; mouse keeps the
  // native onDoubleClick.
  const lastTapRef = useRef({ id: null, at: 0 });

  const startRename = (s) => { cancelledRef.current = false; setDraft(s.name); setEditingId(s.id); };
  const commit = () => {
    if (cancelledRef.current) { cancelledRef.current = false; setEditingId(null); return; }
    const name = draft.trim();
    if (editingId && name) onRename(editingId, name); // a blank name keeps the old one
    setEditingId(null);
  };
  const cancel = () => { cancelledRef.current = true; setEditingId(null); };

  const onTabPointerUp = (s, e) => {
    if (e.pointerType !== "touch" || editingId === s.id) return;
    const now = Date.now();
    const prev = lastTapRef.current;
    if (prev.id === s.id && now - prev.at < 400) {
      lastTapRef.current = { id: null, at: 0 };
      startRename(s);
    } else {
      lastTapRef.current = { id: s.id, at: now };
    }
  };

  return (
    <div className="flex items-stretch gap-1.5 px-3 h-11 bg-[#2C3E50] border-b border-black/25 shadow-sm shrink-0 overflow-x-auto
                    [&::-webkit-scrollbar]:h-0">
      <div className="flex items-center pr-1 text-[9px] font-medium tracking-wider text-slate-300/75 uppercase shrink-0"
           style={{ fontFamily: "'JetBrains Mono', monospace" }}>
        Drawings
      </div>
      {sheets.map(s => {
        const active = s.id === activeId;
        return (
          <div key={s.id}
            onClick={() => !active && onSwitch(s.id)}
            onDoubleClick={() => startRename(s)}
            onPointerUp={(e) => onTabPointerUp(s, e)}
            title={active ? "Double-click (or double-tap) to rename" : "Click to open - double-click or double-tap to rename"}
            // touch-action: manipulation stops iOS treating the second tap as
            // zoom-the-page, so the double-tap reaches us as a rename.
            style={{ touchAction: "manipulation" }}
            className={`group relative flex items-center gap-2 px-3 my-1.5 rounded-lg cursor-pointer transition-all shrink-0 ${
              active
                ? "bg-white ring-1 ring-[#3FB7C9]/60 shadow-sm text-slate-900"
                : "bg-white/10 hover:bg-white/20 text-slate-200"
            }`}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? "bg-[#3FB7C9]" : "bg-slate-400"}`}/>
            {editingId === s.id ? (
              <input
                autoFocus value={draft}
                // Focusing selects the whole name, so typing replaces it.
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") cancel(); }}
                onClick={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                aria-label="Drawing name"
                // Grows with the name so a longer one stays readable while typing.
                style={{ width: Math.min(260, Math.max(96, (draft.length + 1) * 7.5)) }}
                className="text-[12px] font-medium bg-transparent outline-none border-b border-[#3FB7C9] text-slate-900"/>
            ) : (
              <span className={`text-[12px] whitespace-nowrap select-none ${active ? "font-semibold text-slate-900" : "font-medium"}`}>
                {s.name}
              </span>
            )}
            {sheets.length > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${s.name}"? This removes that drawing and everything on it.`)) onDelete(s.id); }}
                onPointerUp={(e) => e.stopPropagation()}
                title="Delete drawing"
                className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-opacity shrink-0">
                <X size={12}/>
              </button>
            )}
          </div>
        );
      })}
      <button
        onClick={onAdd}
        title="Add another drawing (e.g. First floor)"
        className="flex items-center gap-1 px-2.5 my-1.5 rounded-lg text-[11px] font-medium text-[#5fd0e0] hover:bg-white/10 transition-colors shrink-0">
        <Plus size={13}/> Add floor
      </button>
    </div>
  );
}

/* ============================================================================
 * PALETTE (left sidebar)
 * ========================================================================= */
export function Palette({ onPalettePointerDown, onFurniturePointerDown, symbolScale, setSymbolScale, colourMode }) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("electrical"); // "electrical" | "floor"
  const groups = useMemo(() => getPaletteGroups(), []);
  const all = useMemo(() => getPaletteSymbols(), []);
  const q = query.trim().toLowerCase();
  const matches = ({ sym, meta }) =>
    (meta?.description || sym.name).toLowerCase().includes(q) ||
    sym.name.toLowerCase().includes(q);
  const searchResults = q ? all.filter(matches) : null;

  const Tile = ({ sym, meta }) => {
    const cols = resolveColours(sym.id, colourMode || "colour");
    const label = meta?.description || sym.name;
    return (
      <div
        onPointerDown={(e) => onPalettePointerDown(e, sym.id)}
        style={{ touchAction: "none" }}
        title={label + (meta?.height ? ` · ${meta.height}` : "")}
        className="group relative bg-white dark:bg-[#22303D] hover:bg-slate-50 dark:hover:bg-[#283643] rounded-xl ring-1 ring-slate-200 dark:ring-[#2A3947] hover:ring-[#3FB7C9]/40 hover:shadow-sm
                   cursor-grab active:cursor-grabbing p-3 flex flex-col items-center gap-2 select-none [&>*]:pointer-events-none
                   transition-all duration-200 hover:-translate-y-0.5">
        <svg viewBox={VIEWBOX} width="46" height="46"
             style={{ color: cols.body, "--feeder": cols.feeder, filter: `drop-shadow(0 0 5px ${cols.body}30)`, pointerEvents: "none" }}
             className="relative z-10 transition-transform duration-200 group-hover:scale-110">
          {sym.svg}
        </svg>
        <div className="relative z-10 text-[9px] text-center text-slate-700 dark:text-slate-200 leading-tight font-medium line-clamp-3">{label}</div>
        {meta?.height && (
          <div className="text-[8px] text-slate-500 tabular-nums">{meta.height}</div>
        )}
      </div>
    );
  };

  // Furniture tile (Floor Plan mode). Always navy, no colour modes.
  const FurnTile = ({ item }) => (
    <div
      onPointerDown={(e) => onFurniturePointerDown(e, item.id)}
      style={{ touchAction: "none" }}
      title={item.name}
      className="group relative bg-white dark:bg-[#22303D] hover:bg-slate-50 dark:hover:bg-[#283643] rounded-xl ring-1 ring-slate-200 dark:ring-[#2A3947] hover:ring-[#3FB7C9]/40 hover:shadow-sm
                 cursor-grab active:cursor-grabbing p-3 flex flex-col items-center gap-2 select-none [&>*]:pointer-events-none
                 transition-all duration-200 hover:-translate-y-0.5">
      <svg viewBox={FURNITURE_VIEWBOX} width="46" height="46"
           style={{ color: FURNITURE_COLOUR, pointerEvents: "none" }}
           className="relative z-10 transition-transform duration-200 group-hover:scale-110 dark:invert">
        {item.svg}
      </svg>
      <div className="relative z-10 text-[9px] text-center text-slate-700 dark:text-slate-200 leading-tight font-medium line-clamp-3">{item.name}</div>
    </div>
  );

  const floor = false; // Floor-plan furniture retired: the sketch is now the floor-plan tool
  return (
    <aside className="w-64 bg-[#EBEFF6] dark:bg-[#1A2530] border-r border-slate-200 dark:border-[#263441] flex flex-col">
      <div className="px-4 h-11 flex items-center justify-between bg-[#2C3E50] border-b border-black/25 shadow-sm">
        <div className="text-[15px] font-semibold text-white" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{floor ? "Floor Plan" : "Symbols"}</div>
        <div className="text-[9px] tracking-wider text-slate-300/70 font-medium" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{floor ? "LAYOUT" : "MEP LEGEND"}</div>
      </div>

      {!floor && (
      <div className="px-3 py-3 border-b border-slate-200 dark:border-[#263441]">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search symbols…"
            className="w-full pl-9 pr-8 py-2 text-[12.5px] bg-white dark:bg-[#0E141B] rounded-lg ring-1 ring-slate-300 dark:ring-[#2A3947] focus:ring-[#3FB7C9]/50 focus:outline-none text-slate-900 dark:text-slate-100 placeholder:text-slate-400"/>
          {query && (
            <button onClick={() => setQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
              <X size={13}/>
            </button>
          )}
        </div>
      </div>
      )}

      <div data-palette-scroll className="flex-1 overflow-y-auto px-3 py-3
                      [&::-webkit-scrollbar]:w-1.5
                      [&::-webkit-scrollbar-track]:bg-transparent
                      [&::-webkit-scrollbar-thumb]:bg-slate-300/60
                      [&::-webkit-scrollbar-thumb]:rounded-full">
        {floor ? (
          <>
            <div className="px-0.5 mb-2 text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
              Drag onto the plan to sketch a layout. Not counted as electrical.
            </div>
            {["Furniture", "Openings"].map((grp) => {
              const items = FURNITURE.filter((it) => (it.group || "Furniture") === grp);
              if (!items.length) return null;
              return (
                <section key={grp} className="mb-4 last:mb-1">
                  <div className="px-0.5 mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{grp}</div>
                  <div className="grid grid-cols-2 gap-2.5">
                    {items.map((item) => <FurnTile key={item.id} item={item} />)}
                  </div>
                </section>
              );
            })}
          </>
        ) : searchResults ? (
          searchResults.length ? (
            <div className="grid grid-cols-2 gap-2.5">
              {searchResults.map(({ sym, meta }) => <Tile key={sym.id} sym={sym} meta={meta} />)}
            </div>
          ) : (
            <div className="text-center text-[12px] text-slate-500 py-8">No symbols match “{query}”.</div>
          )
        ) : (
          groups.map((g) => (
            <section key={g.label} className="mb-4 last:mb-1">
              <div className="px-0.5 mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{g.label}</div>
              <div className="grid grid-cols-2 gap-2.5">
                {g.items.map(({ sym, meta }) => <Tile key={sym.id} sym={sym} meta={meta} />)}
              </div>
            </section>
          ))
        )}
      </div>

      {!floor ? (
      <div className="border-t border-slate-200 dark:border-[#263441] px-4 py-3 bg-[#E3EAF3] dark:bg-[#141C24]">
        <div className="flex items-center justify-between mb-1.5">
          <span className="uppercase tracking-wider text-[9px] text-slate-500">Symbol Size</span>
          <span className="tabular-nums text-slate-700 text-[10px]">{Math.round(symbolScale*100)}%</span>
        </div>
        <input type="range" min="0.3" max="2.5" step="0.1" value={symbolScale}
               onChange={(e) => setSymbolScale(parseFloat(e.target.value))}
               className="w-full accent-[#3FB7C9]"/>
      </div>
      ) : (
      <div className="border-t border-slate-200 dark:border-[#263441] px-4 py-3 bg-[#E3EAF3] dark:bg-[#141C24] text-[9px] text-slate-500 leading-relaxed">
        Select a piece on the plan to move, rotate or delete it.
      </div>
      )}
    </aside>
  );
}

/* ============================================================================
 * WORKSPACE — the dark surround + the sheet inside it
 * ========================================================================= */
/* How long the sheet must hold still before the composited layer is released.
   Long enough not to be dropped between two frames of a drag, short enough
   that the re-raster is not noticeable. */
const SETTLE_MS = 180;

export function Workspace({
  viewportRef, drawingAreaRef, sheetTransformRef, pan, zoom,
  meta, notes, updateMeta, updateNotes, onSheetField,
  bgImage, placed, wires, annotations,
  furniture,
  walls, wallDraft, wallCursor, wallThickness,
  legendItems, colourMode, symbolSize,
  wireStart, onWireSelect,
  spacePressed, DRAW, showGrid, gridSize,
  onViewportMouseDown, onViewportMouseMove, onViewportMouseUp, onViewportDoubleClick,
  onDrawingDrop, onDrawingDragOver, onDrawingDragLeave,
  onItemMouseDown, onAnnotationBodyMouseDown, onAnnotationAnchorMouseDown,
  onFurnitureMouseDown, startFurnRotating, startFurnResizing,
  onWallMouseDown,
  startRotating,
}) {
  /* ------------------------------------------------------------------------
   * Symbols went blurry on zoom and never recovered.
   *
   * will-change: transform promotes this whole 1587x1123 subtree to its own
   * composited layer. That is what keeps panning smooth -- but a PERMANENT
   * layer means the compositor scales a CACHED TEXTURE on zoom instead of
   * re-rasterising the vectors, so every symbol softens and stays soft. The
   * print preview renders byte-identical markup and is sharp precisely
   * because nothing in its ancestor chain is promoted.
   *
   * So: promote for the gesture, release once the sheet holds still, and the
   * layer re-rasterises at the new scale. Same settle idea PlanBackground uses
   * for its windowed redraw. Written straight to the node rather than through
   * state, so a gesture does not re-render the sheet on every frame.
   * --------------------------------------------------------------------- */
  /* Supersample factor. 1 everywhere except a touch device with the flag on,
     where it is 2. See lib/touch.js for why, and for the hard cap. */
  const N = supersampleFactor();

  useEffect(() => {
    const el = sheetTransformRef && sheetTransformRef.current;
    if (!el) return;
    // DESKTOP: promote for the gesture, release on settle so the layer
    // re-rasterises at the new scale.
    //
    // TOUCH: iOS keeps the sheet on a composited layer of its own regardless,
    // because pinch mutates the transform continuously, and then stretches
    // that layer's cached raster -- which is why removing the hint fixed
    // desktop but not the iPad, and why CadSketch is soft too even though it
    // zooms via an SVG <g> rather than CSS. So instead of promoting, nudge a
    // paint-affecting property once the gesture settles: that dirties the
    // layer and forces a re-rasterisation at the scale now on screen.
    // Costs one frame, changes no coordinate, and cannot move a symbol.
    if (isTouchDevice()) {
      let raf = 0;
      const id = setTimeout(() => {
        el.style.opacity = "0.999";
        raf = requestAnimationFrame(() => { el.style.opacity = ""; });
      }, SETTLE_MS);
      // Always clear the opacity on the way out: if a new gesture starts
      // between setting it and the frame that resets it, it must not stick.
      return () => { clearTimeout(id); if (raf) cancelAnimationFrame(raf); el.style.opacity = ""; };
    }
    el.style.willChange = "transform";
    const id = setTimeout(() => { el.style.willChange = "auto"; }, SETTLE_MS);
    return () => clearTimeout(id);
  }, [pan.x, pan.y, zoom, sheetTransformRef]);

  return (
    <div
      ref={viewportRef}
      className="absolute inset-0 overflow-hidden"
      style={{
        background: "radial-gradient(circle at 50% 50%, #e2e8f0, #cbd5e1 90%)",
        touchAction: "none",
        WebkitTouchCallout: "none",
      }}
      onPointerDown={onViewportMouseDown}
      onPointerMove={onViewportMouseMove}
      onPointerUp={onViewportMouseUp}
      onPointerCancel={onViewportMouseUp}
      onDoubleClick={onViewportDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Sheet, transformed by pan + zoom. will-change is applied for the
          duration of a gesture only -- see the effect above. */}
      <div ref={sheetTransformRef} style={{
        position: "absolute", top: 0, left: 0,
        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom / N})`,
        transformOrigin: "0 0",
      }}>
        {/* Supersample. CSS zoom scales LAYOUT -- boxes, padding and type
            alike -- so the whole sheet lays out N times larger without a
            single hardcoded size changing, and the wrapper above divides its
            transform by the same N. The mapping from stored coordinates to
            the screen is identical; only the density of the raster changes.
            N is 1 for everyone except a touch device with the flag on. */}
        <div style={N > 1 ? { zoom: N } : undefined}>
        <Sheet
          drawingAreaRef={drawingAreaRef}
          meta={meta} notes={notes}
          updateMeta={updateMeta} updateNotes={updateNotes} onSheetField={onSheetField}
          bgImage={bgImage}
          placed={placed} wires={wires} annotations={annotations}
          furniture={furniture}
          walls={walls} wallDraft={wallDraft} wallCursor={wallCursor} wallThickness={wallThickness}
          legendItems={legendItems}
          colourMode={colourMode}
          symbolSize={symbolSize}
          wireStart={wireStart} onWireSelect={onWireSelect}
          spacePressed={spacePressed}
          DRAW={DRAW}
          showGrid={showGrid} gridSize={gridSize}
          zoom={zoom} pan={pan} viewportRef={viewportRef}
          onDrawingDrop={onDrawingDrop}
          onDrawingDragOver={onDrawingDragOver}
          onDrawingDragLeave={onDrawingDragLeave}
          onItemMouseDown={onItemMouseDown}
          onFurnitureMouseDown={onFurnitureMouseDown}
          startFurnRotating={startFurnRotating}
          startFurnResizing={startFurnResizing}
          onWallMouseDown={onWallMouseDown}
          onAnnotationBodyMouseDown={onAnnotationBodyMouseDown}
          onAnnotationAnchorMouseDown={onAnnotationAnchorMouseDown}
          startRotating={startRotating}
        />
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * THE SHEET ITSELF — white page rendered at SHEET.width × SHEET.height
 * This is what prints. Layout:
 *   ┌────────────────────────────────────────────────────────┐
 *   │ LEGEND  │  DRAWING AREA              │  NOTES           │
 *   │         │                            │                  │
 *   │         │                            │                  │
 *   │         │                            │                  │
 *   ├─────────┴────────────────────────────┴──────────────────┤
 *   │ TITLE BLOCK                                              │
 *   └──────────────────────────────────────────────────────────┘
 * ========================================================================= */
export function Sheet({
  drawingAreaRef,
  meta, notes, updateMeta, updateNotes, onSheetField,
  bgImage, placed, wires, annotations, legendItems,
  furniture,
  walls, wallDraft, wallCursor, wallThickness,
  colourMode, symbolSize, wireStart, onWireSelect,
  spacePressed, DRAW, showGrid, gridSize, zoom, pan, viewportRef,
  onDrawingDrop, onDrawingDragOver, onDrawingDragLeave,
  onItemMouseDown, onAnnotationBodyMouseDown, onAnnotationAnchorMouseDown,
  onFurnitureMouseDown, startFurnRotating, startFurnResizing,
  onWallMouseDown,
  startRotating,
}) {
  return (
    <div
      data-sheet-bg
      style={{
        width: SHEET.width,
        height: SHEET.height,
        background: "#ffffff",
        color: "#0a0a0a",
        position: "relative",
        boxShadow: "0 20px 50px -12px rgba(15,23,42,0.25), 0 0 0 1px rgba(15,23,42,0.08)",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Sheet border */}
      <div style={{
        position: "absolute",
        left: SHEET.margin, top: SHEET.margin,
        width: SHEET.width - SHEET.margin*2,
        height: SHEET.height - SHEET.margin*2,
        border: "1px solid #0a0a0a",
        pointerEvents: "none",
      }}/>

      {/* LEGEND COLUMN */}
      <LegendColumn legendItems={legendItems} colourMode={colourMode} />

      {/* NOTES COLUMN */}
      <NotesColumn notes={notes} updateNotes={updateNotes} />

      {/* DRAWING AREA */}
      <DrawingArea
        drawingAreaRef={drawingAreaRef}
        DRAW={DRAW}
        bgImage={bgImage}
        placed={placed} wires={wires} annotations={annotations}
        furniture={furniture}
        walls={walls} wallDraft={wallDraft} wallCursor={wallCursor} wallThickness={wallThickness}
        colourMode={colourMode} symbolSize={symbolSize}
        wireStart={wireStart} onWireSelect={onWireSelect}
        spacePressed={spacePressed} zoom={zoom} pan={pan} viewportRef={viewportRef}
        showGrid={showGrid} gridSize={gridSize}
        onDrop={onDrawingDrop}
        onDragOver={onDrawingDragOver}
        onDragLeave={onDrawingDragLeave}
        onItemMouseDown={onItemMouseDown}
        onFurnitureMouseDown={onFurnitureMouseDown}
        startFurnRotating={startFurnRotating}
        startFurnResizing={startFurnResizing}
        onWallMouseDown={onWallMouseDown}
        onAnnotationBodyMouseDown={onAnnotationBodyMouseDown}
        onAnnotationAnchorMouseDown={onAnnotationAnchorMouseDown}
        startRotating={startRotating}
      />

      {/* TITLE BLOCK */}
      <TitleBlock meta={meta} updateMeta={updateMeta} onSheetField={onSheetField} />
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * SHEET COLUMN HEADER — a bold teal title bar used at the top of the Legend
 * and Notes columns. Bleeds to the column edges (negative margins) so it reads
 * as a section header. Bodies below stay white.
 * ------------------------------------------------------------------------- */
function SheetColumnHeader({ children, padL = 14, padR = 12, padT = 12 }) {
  return (
    <div style={{
      background: "#3FB7C9",
      color: "#08313a",
      fontSize: 11.5,
      fontWeight: 800,
      letterSpacing: "0.09em",
      textTransform: "uppercase",
      padding: "6px 12px 7px",
      margin: `-${padT}px -${padR}px 10px -${padL}px`,
    }}>{children}</div>
  );
}
// fly (escaped, newlines → <br>).
function notesToHtml(n) {
  if (!n) return "";
  if (/<[a-z!/][\s\S]*>/i.test(n)) return n;
  return n
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

// Wrap the current selection (inside rootEl) in a span carrying inline style.
/* ----------------------------------------------------------------------------
 * LEGEND COLUMN — auto-generated from placed symbols
 * ------------------------------------------------------------------------- */
function LegendColumn({ legendItems, colourMode }) {
  return (
    <div style={{
      position: "absolute",
      left: SHEET.margin,
      top: SHEET.margin,
      width: SHEET.legendWidth,
      height: SHEET.height - SHEET.margin * 2 - SHEET.titleHeight - 8,
      borderRight: "1px solid #0a0a0a",
      padding: "12px 12px 12px 14px",
      overflow: "hidden",
    }}>
      <SheetColumnHeader padL={14} padR={12} padT={12}>Electrical Legend</SheetColumnHeader>
      <div style={{ fontSize: 8.5, color: "#404040", marginBottom: 10, letterSpacing: "0.06em" }}>
        UK ARCHITECTURAL · TO BE READ IN COLOUR
      </div>

      {legendItems.length === 0 ? (
        <div style={{ fontSize: 10, color: "#737373", fontStyle: "italic", marginTop: 14 }}>
          Place symbols on the drawing — they'll be listed here automatically with mounting heights.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {legendItems.map(({ id, symbol, meta }) => {
            const cols = resolveColours(id, colourMode);
            return (
              <div key={id} style={{
                display: "grid",
                gridTemplateColumns: "26px 1fr",
                alignItems: "center",
                gap: 6,
                padding: "3px 0",
                borderBottom: "0.5px solid #e5e5e5",
              }}>
                <svg viewBox={VIEWBOX} width={22} height={22}
                     style={{ color: cols.body, "--feeder": cols.feeder, flexShrink: 0 }}>
                  {symbol.svg}
                </svg>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 9, fontWeight: 600, color: "#171717", lineHeight: 1.2 }}>
                    {meta.description}
                  </div>
                  {meta.height && (
                    <div style={{ fontSize: 8, color: "#525252", marginTop: 1 }}>
                      {meta.height}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * NOTES COLUMN — editable MEP notes
 * ------------------------------------------------------------------------- */
function NotesColumn({ notes }) {
  return (
    <div style={{
      position: "absolute",
      right: SHEET.margin,
      top: SHEET.margin,
      width: SHEET.notesWidth,
      height: SHEET.height - SHEET.margin * 2 - SHEET.titleHeight - 8,
      borderLeft: "1px solid #0a0a0a",
      padding: "12px 14px",
      overflow: "hidden",
      pointerEvents: "none",   // display only — drags pass through to the sheet
    }}>
      <SheetColumnHeader padL={14} padR={14} padT={12}>Installation Notes</SheetColumnHeader>
      <div className="pw-notes" style={{ fontSize: 9, color: "#262626", lineHeight: 1.5 }}
           dangerouslySetInnerHTML={{ __html: notesToHtml(notes) }} />
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * NOTES EDITOR — now a TipTap rich-text editor in its own module. Re-exported
 * here so existing imports from SheetParts keep working unchanged.
 * ------------------------------------------------------------------------- */
export { default as NotesEditor } from "@/components/NotesEditor";

/* ----------------------------------------------------------------------------
 * DRAWING AREA — the main canvas where the plan + symbols + annotations live
 * ------------------------------------------------------------------------- */
// Feature flag for the iPad sharp-plan experiment. Off by default (ships dark).
// Enable per-device without a redeploy by adding ?sharpplan=1 to the URL, or
// globally via the NEXT_PUBLIC_SHARP_PLAN env var.
function sharpPlanEnabled() {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("sharpplan") === "1") return true;
  } catch { /* ignore */ }
  return process.env.NEXT_PUBLIC_SHARP_PLAN === "true";
}

/* ----------------------------------------------------------------------------
 * PLAN SOURCES — a PDF page and a decoded bitmap, behind one interface
 * ----------------------------------------------------------------------------
 * A plan source answers two questions: how big is it in its own coordinates,
 * and draw me this rectangle of it at this scale. A pdf.js page and an <img>
 * both can, and nothing below this line needs to know which one it is holding.
 *
 * That is what lets an imported image get the same treatment as a PDF. The
 * image case used to be a plain <img> element, and that is the bug this fixes:
 * iOS keeps the zoom wrapper on a composited layer and stretches that layer's
 * cached raster, so an <img> went soft on zoom no matter how many pixels the
 * file actually held -- a 4400px PNG imported on a laptop was blurry on an
 * iPad at ordinary magnification. Redrawing the visible window into a canvas
 * at device resolution on every settle sidesteps the cached raster entirely.
 *
 * What it does NOT do is make the two formats equal at extreme zoom: a PDF
 * re-renders from vectors and has no resolution of its own, while a bitmap
 * runs out at its native pixels. It removes the loss that was never the file's
 * fault.
 * ------------------------------------------------------------------------- */
function pdfSource(page) {
  const base = page.getViewport({ scale: 1 });
  return {
    w: base.width, h: base.height,
    draw(ctx, r, scale) {
      return page.render({
        canvasContext: ctx,
        viewport: page.getViewport({ scale }),
        transform: [1, 0, 0, 1, -r.x * scale, -r.y * scale],
      });
    },
  };
}

function bitmapSource(img) {
  return {
    w: img.naturalWidth, h: img.naturalHeight,
    draw(ctx, r, scale, cw, ch) {
      drawRegionSmooth(ctx, img, r, cw, ch);
      // drawImage is synchronous, but the caller waits on a promise and may
      // cancel, so hand back the same shape a pdf.js RenderTask has.
      return { promise: Promise.resolve(), cancel() {} };
    },
  };
}

/* Draw rectangle `r` of `img` into a cw x ch canvas, stepping any large
 * minification down in halves.
 *
 * A single drawImage that shrinks by more than about 3x samples the source too
 * sparsely: the browser takes a fixed number of taps per output pixel, so most
 * source pixels are never read and fine detail aliases into moire instead of
 * averaging away. A floor plan is the worst possible input for that -- hatching,
 * dashed services, hairline grid -- and the ratio is at its highest at
 * fit-to-screen, which is the one zoom level that already looked right. So
 * halve repeatedly until the last step is inside 2x, where the built-in
 * filtering behaves, and only then draw.
 *
 * imageSmoothingQuality = "high" on top: on Safari that selects the better
 * downsampler, and at these sizes it costs nothing worth measuring.
 */
function drawRegionSmooth(ctx, img, r, cw, ch) {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  let src = img, sx = r.x, sy = r.y, sw = r.w, sh = r.h;
  // Counted rather than while(true): a degenerate size must not spin forever.
  for (let step = 0; sw / cw > 3 && step < 6; step++) {
    const tw = Math.max(cw, Math.round(sw / 2));
    const th = Math.max(ch, Math.round(sh / 2));
    const mid = document.createElement("canvas");
    mid.width = tw; mid.height = th;
    const mctx = mid.getContext("2d", { alpha: false });
    // alpha:false starts the canvas opaque BLACK, so a plan with transparency
    // would come through on black instead of white. Same white fill the final
    // offscreen canvas gets, for the same reason.
    mctx.fillStyle = "#ffffff"; mctx.fillRect(0, 0, tw, th);
    mctx.imageSmoothingEnabled = true;
    mctx.imageSmoothingQuality = "high";
    mctx.drawImage(src, sx, sy, sw, sh, 0, 0, tw, th);
    if (src !== img) { src.width = src.height = 0; } // release as we go
    src = mid; sx = 0; sy = 0; sw = tw; sh = th;
  }
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, cw, ch);
  if (src !== img) { src.width = src.height = 0; }
}

function PlanBackground({ bgImage, imageDisplay, viewportRef }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const srcRef = useRef(null);
  const taskRef = useRef(null);
  // Monotonic render id: only the newest completed render may be swapped in.
  const seqRef = useRef(0);
  const [loaded, setLoaded] = useState(0);

  // Load whichever source this sheet has, once per source. A PDF wins when both
  // are present: the raster stored alongside it is only the preview rasterised
  // at import time, and the vector redraws sharper at any zoom.
  const pdfSrc = bgImage?.pdfSrc || null;
  const imgSrc = pdfSrc ? null : (bgImage?.src || null);
  const pdfPage = bgImage?.pdfPage || 1;
  useEffect(() => {
    let dead = false;
    srcRef.current = null;
    if (typeof window === "undefined" || (!pdfSrc && !imgSrc)) return;
    (async () => {
      try {
        if (pdfSrc) {
          const pdfjs = await ensurePdfjs();
          const pdf = await pdfjs.getDocument(pdfSrc).promise;
          const page = await pdf.getPage(pdfPage || 1);
          if (dead) return;
          srcRef.current = pdfSource(page);
        } else {
          // NO crossOrigin, deliberately. bgImage.src is usually a signed
          // Supabase URL, so drawing it taints this canvas -- which is harmless
          // HERE because nothing ever reads this canvas back: the PDF export
          // photographs PrintSheet's own <img> inside #print-root, never this
          // one. Asking for CORS would be the riskier choice, because a storage
          // response without the header fails the load outright and leaves the
          // plan blank. If a readback is ever added to THIS canvas -- a
          // toDataURL, a getImageData, an html2canvas pass over the editor --
          // that trade reverses and this needs crossOrigin plus a non-CORS
          // retry. It will fail silently otherwise.
          const img = new Image();
          // Gate on load, NOT on decode(). img.decode() looks like the tidier
          // wait -- it promises a frame-ready bitmap -- but it does not resolve
          // at all while the tab is in the background: Chrome defers the decode
          // and the promise simply never settles, even with the image fully
          // fetched (complete true, naturalWidth set). Awaiting it meant a plan
          // opened in a backgrounded tab never drew, and stayed blank after the
          // tab came forward because nothing retriggers the load. onload always
          // fires; the decode then happens inside the first drawImage, which is
          // exactly what the old <img> did anyway.
          await new Promise((res, rej) => {
            img.onload = () => res();
            img.onerror = () => rej(new Error("could not load the plan image"));
            img.src = imgSrc;
          });
          if (dead) return;
          srcRef.current = bitmapSource(img);
        }
        setLoaded(n => n + 1);
      } catch (e) { console.warn("PlanBackground load failed:", e?.message); }
    })();
    return () => { dead = true; };
  }, [pdfSrc, imgSrc, pdfPage]);

  // Re-render the visible window whenever the on-screen geometry SETTLES.
  // We watch the wrapper's real screen rect rather than React zoom/pan props,
  // because pinch-zoom on touch devices is written straight to the DOM and does
  // NOT update those props until you lift your fingers — so a prop-based trigger
  // redraws at the stale pre-pinch scale and looks blurry. Watching the actual
  // rect catches every case: wheel zoom, imperative pinch, pan and resize. The
  // on-screen canvas never exceeds the viewport, so memory stays flat at any
  // zoom while redrawing from the source keeps it sharp.
  useEffect(() => {
    if (!imageDisplay) return;

    const renderWindow = () => {
      const src = srcRef.current;
      const wrap = wrapRef.current, cv = canvasRef.current;
      if (!src || !wrap || !cv) return;
      try {
        const pr = wrap.getBoundingClientRect();           // page rect on screen (post-transform)
        if (pr.width < 2 || pr.height < 2) return;
        const vp = viewportRef?.current;
        const vr = vp ? vp.getBoundingClientRect()
                      : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
        const ix0 = Math.max(pr.left, vr.left), iy0 = Math.max(pr.top, vr.top);
        const ix1 = Math.min(pr.right, vr.right), iy1 = Math.min(pr.bottom, vr.bottom);
        if (ix1 - ix0 < 2 || iy1 - iy0 < 2) return;        // page off-screen
        // Overdraw a margin around the viewport so ordinary panning stays
        // inside already-drawn content instead of reaching a hard edge.
        //
        // Order matters here, and it used to be the wrong way round. The old
        // code padded by a fixed 25% a side and applied the pixel caps to the
        // PADDED box, so the margin was paid for out of sharpness. At
        // fit-to-screen the page is smaller than the viewport, the padding
        // clamps away against the page edge, no cap fires, and the render
        // lands at the full supersampled density. Zoomed in the page is larger
        // than the viewport, the full 25% is claimed, 1.5x a side is 2.25x the
        // area, and the caps drag the density back down -- on a 12.9in iPad
        // from 1.6x device pixels to about 1.17x. That is exactly the reported
        // symptom: sharp at fit, progressively softer as you magnify, on the
        // iPad only (desktop is N = 1 at DPR 1 and never reaches a cap).
        //
        // So fix the density FIRST and let the margin have whatever budget is
        // left over. Density is what the user looks at; the margin only shows
        // if you flick faster than the 130ms settle. A soft plan is visible
        // everywhere, a short margin is visible occasionally.
        const SS = 2 / supersampleFactor();                // supersample factor
        const MAX_AREA = 12_000_000;                       // ~12MP visible-window budget
        const MAX_DIM = 4096;                              // iOS-safe per-side limit
        const OVERDRAW_MAX = 0.25;                         // never more than 25% a side
        // Render ABOVE device resolution (supersample) so fine text stays crisp
        // at maximum zoom, then let the device downsample it. SS is divided by
        // the sheet's supersample factor: with that flag on the sheet lays out N
        // times larger, so this canvas's box grows by N too, and stacking the
        // old SS on top multiplied the backing store by N squared -- which blew
        // the caps and cropped a third of the plan off on an iPad. Dividing
        // keeps the total pixel count exactly what it was before the flag.
        const visW = ix1 - ix0, visH = iy1 - iy0;
        let density = Math.min(window.devicePixelRatio || 1, 2) * SS;
        // Density is only ever reduced if the BARE visible window will not fit,
        // which no current device comes close to -- a 12.9in iPad at N = 1.25
        // asks for about 10MP of the 12MP budget. It stays here so a future
        // larger screen degrades gracefully instead of cropping.
        const bareW = visW * density, bareH = visH * density;
        let q = 1;
        if (bareW * bareH > MAX_AREA) q = Math.min(q, Math.sqrt(MAX_AREA / (bareW * bareH)));
        if (Math.max(bareW, bareH) > MAX_DIM) q = Math.min(q, MAX_DIM / Math.max(bareW, bareH));
        density *= q;
        // Whatever headroom is left buys margin. Both caps are checked because
        // either can be the binding one: a wide shallow window hits the per-side
        // limit long before it hits the area limit.
        const uw = visW * density, uh = visH * density;
        const grow = Math.max(1, Math.min(Math.sqrt(MAX_AREA / (uw * uh)),
                                          MAX_DIM / Math.max(uw, uh)));
        const OVERDRAW = Math.max(0, Math.min(OVERDRAW_MAX, (grow - 1) / 2));
        const mx = visW * OVERDRAW, my = visH * OVERDRAW;
        const ox0 = Math.max(pr.left, ix0 - mx), oy0 = Math.max(pr.top, iy0 - my);
        const ox1 = Math.min(pr.right, ix1 + mx), oy1 = Math.min(pr.bottom, iy1 + my);
        const fx0 = (ox0 - pr.left) / pr.width, fy0 = (oy0 - pr.top) / pr.height;
        const fx1 = (ox1 - pr.left) / pr.width, fy1 = (oy1 - pr.top) / pr.height;
        // Source coordinates: PDF points for a page, pixels for a bitmap.
        // The fractions above are what carry the position, so which one it
        // is makes no difference from here down.
        const rpx = fx0 * src.w, rpy = fy0 * src.h;
        const rpw = (fx1 - fx0) * src.w, rph = (fy1 - fy0) * src.h;
        if (rpw < 1 || rph < 1) return;
        // Clamping the padded box against the page edge above can only shrink
        // it, so both caps still hold here by construction -- there is nothing
        // left to clamp a second time.
        const bw = (ox1 - ox0) * density, bh = (oy1 - oy0) * density;
        // Derive ONE scale, from whichever axis is tighter, and size the canvas
        // FROM that scale. The scale used to come from the width alone while the
        // height was set from its own clamped value, so whatever a cap trimmed
        // got drawn past the edge of the buffer and was silently cropped. Taking
        // the minimum and sizing from it renders the whole plan smaller instead:
        // a crop is impossible by construction, and losing part of a drawing is
        // a far worse failure than softness.
        const renderScale = Math.min(bw / rpw, bh / rph); // source units -> bitmap px
        const cw = Math.max(1, Math.round(rpw * renderScale));
        const ch = Math.max(1, Math.round(rph * renderScale));
        // Draw into an OFFSCREEN canvas and swap it in only when it is
        // complete. Sizing the visible canvas clears it, so the old code went
        // blank the moment a redraw started and stayed blank until the render
        // finished -- which is what showed as empty bands when panning into
        // fresh area. Briefly stale and soft beats briefly missing.
        const off = document.createElement("canvas");
        off.width = cw; off.height = ch;
        const octx = off.getContext("2d", { alpha: false });
        octx.fillStyle = "#ffffff"; octx.fillRect(0, 0, cw, ch);
        if (taskRef.current) { try { taskRef.current.cancel(); } catch {} }
        const seq = ++seqRef.current;
        const task = src.draw(octx, { x: rpx, y: rpy, w: rpw, h: rph }, renderScale, cw, ch);
        taskRef.current = task;
        task.promise.then(() => {
          // A newer render started while this one was in flight: its result is
          // the current one, so drop this quietly rather than flashing an
          // older view over it.
          if (seq !== seqRef.current) return;
          const live = canvasRef.current;
          if (!live) return;
          live.width = cw; live.height = ch;
          live.style.left = (fx0 * imageDisplay.w) + "px";
          live.style.top = (fy0 * imageDisplay.h) + "px";
          live.style.width = ((fx1 - fx0) * imageDisplay.w) + "px";
          live.style.height = ((fy1 - fy0) * imageDisplay.h) + "px";
          live.getContext("2d", { alpha: false }).drawImage(off, 0, 0);
        }).catch(() => { /* cancelled or failed: leave what is on screen */ });
      } catch (e) { /* transient during fast moves — next settle re-renders */ }
    };

    // Poll the wrapper's screen rect; redraw once it has held still ~130ms.
    let lastKey = "", changedAt = 0, done = false;
    const tick = () => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const r = wrap.getBoundingClientRect();
      const key = Math.round(r.left) + "|" + Math.round(r.top) + "|" +
                  Math.round(r.width) + "|" + Math.round(r.height);
      if (key !== lastKey) { lastKey = key; changedAt = Date.now(); done = false; }
      else if (!done && Date.now() - changedAt >= 130) { done = true; renderWindow(); }
    };
    const iv = setInterval(tick, 60);
    return () => clearInterval(iv);
  }, [loaded, imageDisplay?.x, imageDisplay?.y, imageDisplay?.w, imageDisplay?.h, viewportRef]);

  if (!imageDisplay) return null;
  return (
    <div ref={wrapRef} style={{
      position: "absolute",
      left: imageDisplay.x, top: imageDisplay.y,
      width: imageDisplay.w, height: imageDisplay.h,
      background: "#ffffff", overflow: "hidden", pointerEvents: "none",
    }}>
      <canvas ref={canvasRef} style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", ...(sharpPlanEnabled() ? { transform: "translateZ(0)", willChange: "transform", backfaceVisibility: "hidden" } : null) }} />
    </div>
  );
}

function DrawingArea({
  drawingAreaRef, DRAW, bgImage, placed, wires, annotations,
  furniture,
  walls, wallDraft, wallCursor, wallThickness,
  colourMode, symbolSize, wireStart, onWireSelect, spacePressed,
  zoom, pan, viewportRef, showGrid, gridSize,
  onDrop, onDragOver, onDragLeave,
  onItemMouseDown, onAnnotationBodyMouseDown, onAnnotationAnchorMouseDown,
  onFurnitureMouseDown, startFurnRotating, startFurnResizing,
  onWallMouseDown,
  startRotating,
}) {
  // tool + selection come straight from the store now — no longer threaded
  // down through Workspace → Sheet → DrawingArea.
  const tool = useEditor(s => s.tool);
  const selection = useEditor(s => s.selection);
  const selectedId = selection?.kind === "symbol" ? selection.id : null;
  const selectedFurnId = selection?.kind === "furniture" ? selection.id : null;
  const selectedWallId = selection?.kind === "wall" ? selection.id : null;
  const selectedAnnoId = selection?.kind === "annotation" ? selection.id : null;
  const selectedWireId = selection?.kind === "wire" ? selection.id : null;
  // Fit the bgImage into the drawing area
  const imageDisplay = useMemo(
    () => (bgImage ? planFootprint(DRAW, bgImage.w, bgImage.h) : null),
    [bgImage, DRAW.w, DRAW.h]
  );

  return (
    <div
      ref={drawingAreaRef}
      data-drawing-bg
      style={{
        position: "absolute",
        left: DRAW.x, top: DRAW.y,
        width: DRAW.w, height: DRAW.h,
        background: "#ffffff",
        border: "1px solid #0a0a0a",
        overflow: "hidden",
      }}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      {!bgImage && !(walls && walls.length) && !(furniture && furniture.length) && tool !== "wall" && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexDirection: "column", gap: 8,
          color: "#a3a3a3", pointerEvents: "none",
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: "#f5f5f5", display: "flex",
            alignItems: "center", justifyContent: "center",
            border: "1px solid #e5e5e5",
          }}>
            <Upload size={18} />
          </div>
          <div style={{ fontSize: 11, color: "#737373", fontWeight: 500 }}>No drawing loaded</div>
          <div style={{ fontSize: 9, color: "#a3a3a3" }}>Click <b>Import</b> or drop a PDF/image here</div>
        </div>
      )}

      {bgImage && imageDisplay && (
        <PlanBackground
          bgImage={bgImage}
          imageDisplay={imageDisplay}
          viewportRef={viewportRef}
        />
      )}

      {/* Grid overlay — drawn above the imported plan, below symbols, so the
          Grid toggle shows alignment lines even when a document is loaded */}
      {showGrid && (
        <div style={{
          position: "absolute", inset: 0,
          pointerEvents: "none",
          backgroundImage:
            `linear-gradient(to right, rgba(37,99,235,0.18) 1px, transparent 1px),` +
            `linear-gradient(to bottom, rgba(37,99,235,0.18) 1px, transparent 1px)`,
          backgroundSize: `${gridSize}px ${gridSize}px`,
        }}/>
      )}

      <svg width={DRAW.w} height={DRAW.h}
           style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", overflow: "visible" }}>
        {/* Wires */}
        {wires.map(w => {
          const a = placed.find(p => p.id === w.fromId);
          const b = placed.find(p => p.id === w.toId);
          if (!a || !b) return null;
          const isSel = w.id === selectedWireId;
          const baseStroke = colourMode === "mono" ? "#0a0a0a" : "#dc2626";
          const selectable = tool === "select";
          return (
            <g key={w.id}>
              {/* Wide invisible hit area so the thin line is easy to click/tap */}
              <line
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke="transparent" strokeWidth={14} strokeLinecap="round"
                style={{ cursor: selectable ? "pointer" : "default", pointerEvents: selectable ? "stroke" : "none" }}
                onPointerDown={(e) => { if (selectable) { e.stopPropagation(); onWireSelect?.(w.id); } }}
              />
              {isSel && (
                <line
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke="#3FB7C9" strokeWidth={5} strokeLinecap="round"
                  opacity={0.55} style={{ pointerEvents: "none" }}
                />
              )}
              <line
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={isSel ? "#22808F" : baseStroke}
                strokeWidth={isSel ? 1.8 : 1.2}
                strokeDasharray="6 4"
                strokeLinecap="round"
                style={{ pointerEvents: "none" }}
              />
            </g>
          );
        })}

        {/* Annotations (leader lines first so they're behind text) */}
        {annotations.map(a => {
          const isSel = a.id === selectedAnnoId;
          const stroke = colourMode === "mono" ? "#0a0a0a" : "#dc2626";
          // Compute leader line endpoints
          const dx = a.anchorX - a.x;
          const dy = a.anchorY - a.y;
          const len = Math.hypot(dx, dy);
          const ux = len > 0 ? dx / len : 0;
          const uy = len > 0 ? dy / len : 0;
          // Start the leader at the edge of the text block
          const startX = a.x + ux * 18;
          const startY = a.y + uy * 6;
          // Arrowhead at the anchor end
          const ah = 6; // size
          const angle = Math.atan2(dy, dx);
          const ax1 = a.anchorX - ah * Math.cos(angle - Math.PI/7);
          const ay1 = a.anchorY - ah * Math.sin(angle - Math.PI/7);
          const ax2 = a.anchorX - ah * Math.cos(angle + Math.PI/7);
          const ay2 = a.anchorY - ah * Math.sin(angle + Math.PI/7);
          return (
            <g key={a.id} style={{ pointerEvents: "none" }}>
              <line x1={startX} y1={startY} x2={a.anchorX} y2={a.anchorY}
                    stroke={stroke} strokeWidth={1.3}/>
              <polygon points={`${a.anchorX},${a.anchorY} ${ax1},${ay1} ${ax2},${ay2}`} fill={stroke}/>
              {isSel && (
                <circle cx={a.anchorX} cy={a.anchorY} r={5}
                        fill="rgba(251,191,36,0.4)" stroke="#d97706" strokeWidth={1}
                        style={{ pointerEvents: "all", cursor: "grab" }}
                        onPointerDown={(e) => onAnnotationAnchorMouseDown(e, a)}/>
              )}
            </g>
          );
        })}

        {/* Walls (floor-plan layer) — the structural shell, drawn beneath
            everything else. Thick navy polylines with mitred corners. */}
        {(walls || []).map(wall => {
          if (!wall.points || wall.points.length < 2) return null;
          const th = (wallThickness && wallThickness[wall.type]) || 12;
          const ptsStr = wall.points.map(p => `${p.x},${p.y}`).join(" ");
          const isSel = wall.id === selectedWallId;
          return (
            <g key={wall.id}>
              {isSel && (
                <polyline points={ptsStr} fill="none" stroke="#3FB7C9" strokeWidth={th + 8}
                          strokeLinejoin="round" strokeLinecap="round" opacity="0.35"
                          style={{ pointerEvents: "none" }}/>
              )}
              <polyline points={ptsStr} fill="none" stroke="#2C3E50" strokeWidth={th}
                        strokeLinejoin="miter" strokeLinecap="square"
                        style={{ pointerEvents: "none" }}/>
              <polyline points={ptsStr} fill="none" stroke="transparent" strokeWidth={Math.max(th, 14)}
                        strokeLinejoin="round" strokeLinecap="round"
                        style={{ pointerEvents: tool === "select" ? "stroke" : "none", cursor: "pointer" }}
                        onPointerDown={(e) => onWallMouseDown(e, wall)}/>
            </g>
          );
        })}

        {/* Furniture (floor-plan layer) — rendered BENEATH the electrical
            symbols so the symbols always sit on top. Never billed/legended. */}
        {(furniture || []).map(item => {
          const fsym = findFurniture(item.furnitureId);
          if (!fsym) return null;
          const isSel = item.id === selectedFurnId;
          const itemScale = item.scale ?? 4;
          const itemSize = symbolSize * itemScale;
          const half = itemSize / 2;
          const hs = Math.min(Math.max(1 / (zoom || 1), 0.6), 6); // keep the rotate handle a steady on-screen size at any zoom
          const handleOffset = half + 20 * hs;
          const hDotR = 9 * hs, hHitR = 26 * hs, hLineW = Math.max(1, 1.6 * hs), hDash = `${3*hs} ${2*hs}`;
          return (
            <g key={item.id}
               transform={`translate(${item.x - half} ${item.y - half}) rotate(${item.rotation} ${half} ${half})`}>
              {isSel && (
                <>
                  <rect x={-6} y={-6} width={itemSize+12} height={itemSize+12} rx={8}
                        fill="rgba(63,183,201,0.10)"/>
                  <rect x={-3} y={-3} width={itemSize+6} height={itemSize+6} rx={6}
                        fill="none" stroke="#2C97A8" strokeWidth={1.2}/>
                </>
              )}
              <rect x={0} y={0} width={itemSize} height={itemSize} fill="transparent"
                    style={{
                      pointerEvents: "all",
                      cursor: (tool === "pan" || spacePressed) ? "grab" : "move",
                    }}
                    onPointerDown={(e) => onFurnitureMouseDown(e, item)}/>
              <svg x={0} y={0} width={itemSize} height={itemSize} viewBox={FURNITURE_VIEWBOX}
                   style={{ color: FURNITURE_COLOUR, overflow: "visible", pointerEvents: "none" }}>
                {fsym.svg}
              </svg>
              {isSel && tool === "select" && !spacePressed && (
                <g style={{ pointerEvents: "all", cursor: "grab", touchAction: "none" }}
                   onPointerDown={(e) => { e.stopPropagation(); try { viewportRef.current?.setPointerCapture?.(e.pointerId); } catch {} startFurnRotating(item.id); }}>
                  {/* enlarged invisible touch target so the handle is easy to grab on iPad */}
                  <circle cx={half} cy={-handleOffset} r={hHitR} fill="transparent" stroke="none"/>
                  <line x1={half} y1={-3} x2={half} y2={-handleOffset+hDotR}
                        stroke="#2C97A8" strokeWidth={hLineW} strokeDasharray={hDash}/>
                  <circle cx={half} cy={-handleOffset} r={hDotR}
                          fill="#3FB7C9" stroke="#fff" strokeWidth={hLineW}/>
                </g>
              )}
              {isSel && tool === "select" && !spacePressed && (
                <g style={{ pointerEvents: "all", cursor: "nwse-resize" }}
                   onPointerDown={(e) => { e.stopPropagation(); startFurnResizing(item.id); }}>
                  <rect x={itemSize-5} y={itemSize-5} width={10} height={10} rx={2}
                        fill="#3FB7C9" stroke="#fff" strokeWidth={1}/>
                  <path d={`M${itemSize-2} ${itemSize+1} L${itemSize+1} ${itemSize-2}`}
                        stroke="#fff" strokeWidth={1} fill="none"/>
                </g>
              )}
            </g>
          );
        })}

        {/* Symbols */}
        {placed.map(item => {
          const sym = findSymbol(item.symbolId);
          if (!sym) return null;
          const isSel = item.id === selectedId;
          const isWireStart = item.id === wireStart;
          const itemScale = item.scale ?? 1;
          const itemSize = symbolSize * itemScale;
          const half = itemSize / 2;
          const cols = resolveColours(item.symbolId, colourMode);
          const hs = Math.min(Math.max(1 / (zoom || 1), 0.6), 6); // keep the rotate handle a steady on-screen size at any zoom
          const handleOffset = half + 20 * hs;
          const hDotR = 9 * hs, hHitR = 26 * hs, hLineW = Math.max(1, 1.6 * hs), hDash = `${3*hs} ${2*hs}`;
          return (
            <g key={item.id}
               transform={`translate(${item.x - half} ${item.y - half}) rotate(${item.rotation} ${half} ${half})`}>
              {(isSel || isWireStart) && (
                <>
                  <rect x={-6} y={-6} width={itemSize+12} height={itemSize+12} rx={8}
                        fill={isWireStart ? "rgba(251,191,36,0.18)" : "rgba(251,191,36,0.10)"}/>
                  <rect x={-3} y={-3} width={itemSize+6} height={itemSize+6} rx={6}
                        fill="none" stroke="#d97706" strokeWidth={1.2}
                        strokeDasharray={isWireStart ? "4 3" : "none"}/>
                </>
              )}
              {/* Transparent hit area — whole symbol box is clickable, not
                  just the painted strokes. Critical for the wire tool. */}
              <rect x={0} y={0} width={itemSize} height={itemSize} fill="transparent"
                    style={{
                      pointerEvents: "all",
                      cursor: tool === "wire" ? "crosshair" : (tool === "pan" || spacePressed) ? "grab" : "move",
                    }}
                    onPointerDown={(e) => onItemMouseDown(e, item)}/>
              <svg x={0} y={0} width={itemSize} height={itemSize} viewBox={VIEWBOX}
                   style={{
                     color: cols.body, "--feeder": cols.feeder,
                     overflow: "visible", pointerEvents: "none",
                     cursor: tool === "wire" ? "crosshair" : (tool === "pan" || spacePressed) ? "grab" : "move",
                   }}>
                {sym.svg}
              </svg>
              {item.label && (
                <text x={half} y={itemSize + 9} fontSize={9} textAnchor="middle"
                      fill="#171717" fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="600"
                      transform={`rotate(${-item.rotation} ${half} ${itemSize + 9})`}>
                  {item.label}
                </text>
              )}
              {isSel && tool === "select" && !spacePressed && (
                <g style={{ pointerEvents: "all", cursor: "grab", touchAction: "none" }}
                   onPointerDown={(e) => { e.stopPropagation(); try { viewportRef.current?.setPointerCapture?.(e.pointerId); } catch {} startRotating(item.id); }}>
                  {/* enlarged invisible touch target so the handle is easy to grab on iPad */}
                  <circle cx={half} cy={-handleOffset} r={hHitR} fill="transparent" stroke="none"/>
                  <line x1={half} y1={-3} x2={half} y2={-handleOffset+hDotR}
                        stroke="#d97706" strokeWidth={hLineW} strokeDasharray={hDash}/>
                  <circle cx={half} cy={-handleOffset} r={hDotR}
                          fill="#fbbf24" stroke="#fff" strokeWidth={hLineW}/>
                </g>
              )}
            </g>
          );
        })}

        {/* Annotation text blocks (rendered last so they're on top) */}
        {annotations.map(a => {
          const isSel = a.id === selectedAnnoId;
          const stroke = colourMode === "mono" ? "#0a0a0a" : "#dc2626";
          // Wrap text by guessing — split on newlines first, then split long lines
          const lines = a.text.split("\n").flatMap(line => wrapText(line, 22));
          const padding = 4;
          const lineHeight = 11;
          const textW = Math.max(60, ...lines.map(l => estimateWidth(l, 8.5)));
          const textH = lines.length * lineHeight + padding * 2 - 2;
          return (
            <g key={a.id + "-text"}
               style={{ pointerEvents: "all", cursor: "move" }}
               onPointerDown={(e) => onAnnotationBodyMouseDown(e, a)}>
              <rect
                x={a.x - textW/2 - padding}
                y={a.y - textH/2}
                width={textW + padding*2}
                height={textH}
                rx={3}
                fill={isSel ? "rgba(255,255,200,0.95)" : "rgba(255,255,255,0.95)"}
                stroke={isSel ? "#d97706" : stroke}
                strokeWidth={isSel ? 1.2 : 1}
                strokeDasharray="4 2.5"
              />
              {lines.map((line, i) => (
                <text
                  key={i}
                  x={a.x}
                  y={a.y - textH/2 + padding + lineHeight * (i + 1) - 2}
                  fontSize={8.5}
                  textAnchor="middle"
                  fill={stroke}
                  fontWeight={600}
                  fontFamily="ui-sans-serif, system-ui, sans-serif"
                  style={{ pointerEvents: "none" }}
                >{line}</text>
              ))}
            </g>
          );
        })}
        {/* Wall draft — the in-progress polyline + rubber-band to the cursor.
            Rendered last so it sits on top while drawing. */}
        {wallDraft && wallDraft.points && wallDraft.points.length > 0 && (() => {
          const pts = wallDraft.points;
          const last = pts[pts.length - 1];
          const th = (wallThickness && wallThickness[wallDraft.type]) || 12;
          const ptsStr = pts.map(p => `${p.x},${p.y}`).join(" ");
          return (
            <g style={{ pointerEvents: "none" }}>
              {pts.length >= 2 && (
                <polyline points={ptsStr} fill="none" stroke="#2C3E50" strokeWidth={th}
                          strokeLinejoin="miter" strokeLinecap="square" opacity="0.45"/>
              )}
              {wallCursor && (
                <line x1={last.x} y1={last.y} x2={wallCursor.x} y2={wallCursor.y}
                      stroke="#3FB7C9" strokeWidth={th} strokeLinecap="square"
                      opacity="0.5" strokeDasharray="7 6"/>
              )}
              {pts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={4.5} fill="#fff" stroke="#3FB7C9" strokeWidth={1.5}/>
              ))}
              {wallCursor && (
                <circle cx={wallCursor.x} cy={wallCursor.y} r={4.5} fill="#3FB7C9" stroke="#fff" strokeWidth={1.5}/>
              )}
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

// Naive text wrapping helpers for SVG annotations
function wrapText(line, maxChars) {
  if (line.length <= maxChars) return [line];
  const words = line.split(" ");
  const out = [];
  let current = "";
  for (const w of words) {
    if ((current + " " + w).trim().length > maxChars) {
      if (current) out.push(current);
      current = w;
    } else {
      current = (current ? current + " " : "") + w;
    }
  }
  if (current) out.push(current);
  return out;
}
function estimateWidth(s, fontSize) {
  return s.length * fontSize * 0.55;
}

/* ----------------------------------------------------------------------------
 * TITLE BLOCK — bottom strip, editable fields
 * ------------------------------------------------------------------------- */
/* ----------------------------------------------------------------------------
 * TITLE BLOCK — the masthead lives in its own module so the sheet, the print
 * sheet and the business screen preview all render the same component.
 * ------------------------------------------------------------------------- */
function MastheadFrame({ children }) {
  return (
    <div style={{
      position: "absolute",
      left: SHEET.margin,
      top: SHEET.height - SHEET.margin - SHEET.titleHeight,
      width: SHEET.width - SHEET.margin * 2,
      height: SHEET.titleHeight,
    }}>{children}</div>
  );
}

function TitleBlock({ meta, updateMeta, onSheetField }) {
  const tb = useProjectTitleBlock() || DEFAULT_TITLEBLOCK;
  return (
    <MastheadFrame>
      <Masthead tb={tb} meta={meta} editable updateMeta={updateMeta} setSheet={onSheetField} />
    </MastheadFrame>
  );
}

/* ============================================================================
 * INSPECTOR (right sidebar)
 * ========================================================================= */
export function Inspector({
  selectedItem, selectedAnno, wireSelected,
  updateLabel, updateAnnoText, setRotation, setItemScale,
  rotateSelected, deleteSelected, placed, onCollapse,
}) {
  return (
    <aside className="w-64 bg-[#EBEFF6] dark:bg-[#1A2530] border-l border-slate-200 dark:border-[#263441] flex flex-col">
      <div className="pl-4 pr-2 h-11 flex items-center justify-between border-b border-slate-200 dark:border-[#263441]">
        <div className="text-[15px] font-semibold text-slate-900 dark:text-slate-100" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Inspector</div>
        {onCollapse && (
          <button onClick={onCollapse} title="Hide inspector"
            className="w-8 h-8 flex items-center justify-center rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/70 dark:hover:bg-[#263441]">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        )}
      </div>

      {selectedItem ? (
        <SymbolInspector
          item={selectedItem}
          updateLabel={updateLabel}
          setRotation={setRotation}
          setItemScale={setItemScale}
          rotateSelected={rotateSelected}
          deleteSelected={deleteSelected}
        />
      ) : selectedAnno ? (
        <AnnoInspector
          anno={selectedAnno}
          updateAnnoText={updateAnnoText}
          deleteSelected={deleteSelected}
        />
      ) : wireSelected ? (
        <WireInspector deleteSelected={deleteSelected} />
      ) : (
        <EmptyInspector placed={placed} />
      )}
    </aside>
  );
}

function SymbolInspector({ item, updateLabel, setRotation, setItemScale, rotateSelected, deleteSelected }) {
  const sym = findSymbol(item.symbolId);
  const meta = SYMBOL_META[item.symbolId];
  const cols = resolveColours(item.symbolId, "colour");
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4
                    [&::-webkit-scrollbar]:w-1.5
                    [&::-webkit-scrollbar-thumb]:bg-white/10
                    [&::-webkit-scrollbar-thumb]:rounded-full">
      <div>
        <div className="text-[9px] tracking-[0.2em] uppercase text-slate-500 dark:text-slate-400 mb-2">Type</div>
        <div className="flex items-center gap-3">
          <svg viewBox={VIEWBOX} width="44" height="44"
               style={{ color: cols.body, "--feeder": cols.feeder, filter: `drop-shadow(0 0 8px ${cols.body}50)` }}
               className="bg-slate-50 dark:bg-[#22303D] rounded-lg ring-1 ring-slate-200 dark:ring-[#2A3947] p-1.5">
            {sym?.svg}
          </svg>
          <div>
            <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{sym?.name}</div>
            {meta?.height && <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{meta.height}</div>}
          </div>
        </div>
        {meta?.description && (
          <div className="text-[10px] text-slate-600 dark:text-slate-300 mt-2 leading-relaxed">{meta.description}</div>
        )}
      </div>

      <div>
        <div className="text-[9px] tracking-[0.2em] uppercase text-slate-500 dark:text-slate-400 mb-1.5">Label / Reference</div>
        <input
          type="text"
          value={item.label}
          onChange={(e) => updateLabel(e.target.value)}
          placeholder="e.g. S1 / K-01"
          className="w-full px-3 py-2 text-xs bg-white dark:bg-[#0E141B] rounded-lg ring-1 ring-slate-200 dark:ring-[#2A3947] focus:ring-[#3FB7C9]/40 focus:bg-white focus:outline-none transition-all text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="X" value={Math.round(item.x)}/>
        <Stat label="Y" value={Math.round(item.y)}/>
        <Stat label="ROT" value={Math.round(item.rotation) + "°"}/>
      </div>

      <div className="pt-3 border-t border-slate-200">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9px] tracking-[0.2em] uppercase text-slate-500 dark:text-slate-400">Rotation</span>
          <span className="tabular-nums text-slate-800 dark:text-slate-200 text-[10px]">{Math.round(item.rotation)}°</span>
        </div>
        <input type="range" min="0" max="359" step="1" value={item.rotation}
               onChange={(e) => setRotation(parseInt(e.target.value))}
               className="w-full accent-[#3FB7C9] mb-2"/>
        <div className="grid grid-cols-4 gap-1">
          {[0, 90, 180, 270].map(deg => (
            <button key={deg} onClick={() => setRotation(deg)}
              className={`px-1 py-1 text-[9px] tracking-wider rounded-md transition-all ${
                Math.round(item.rotation) === deg
                  ? "bg-[#D8F0F4] text-[#22808F] ring-1 ring-[#3FB7C9]/30"
                  : "bg-slate-50 text-slate-600 dark:text-slate-300 ring-1 ring-slate-200 hover:bg-slate-100"
              }`}>{deg}°</button>
          ))}
        </div>
      </div>

      <div className="pt-3 border-t border-slate-200">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9px] tracking-[0.2em] uppercase text-slate-500 dark:text-slate-400">Scale</span>
          <span className="tabular-nums text-slate-800 dark:text-slate-200 text-[10px]">{Math.round((item.scale ?? 1)*100)}%</span>
        </div>
        <input type="range" min="0.4" max="3" step="0.05" value={item.scale ?? 1}
               onChange={(e) => setItemScale(parseFloat(e.target.value))}
               className="w-full accent-[#3FB7C9] mb-2"/>
        <button onClick={() => setItemScale(1)}
          className="w-full px-2 py-1.5 text-[9px] uppercase tracking-wider bg-slate-50 text-slate-600 dark:text-slate-300 ring-1 ring-slate-200 hover:bg-slate-100 rounded-md transition-all">
          Reset to 100%
        </button>
      </div>

      <div className="flex gap-2 pt-3 border-t border-slate-200">
        <button onClick={rotateSelected}
          className="flex-1 px-3 py-2 bg-slate-50 ring-1 ring-slate-200 hover:bg-slate-100 text-slate-800 dark:text-slate-200 rounded-md text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all">
          <RotateCw size={12}/> +15°
        </button>
        <button onClick={deleteSelected}
          className="flex-1 px-3 py-2 bg-slate-50 ring-1 ring-slate-200 hover:bg-red-500/[0.1] hover:text-red-300 text-slate-800 dark:text-slate-200 rounded-md text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all">
          <Trash2 size={12}/> Delete
        </button>
      </div>
    </div>
  );
}

function AnnoInspector({ anno, updateAnnoText, deleteSelected }) {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div>
        <div className="text-[9px] tracking-[0.2em] uppercase text-slate-500 dark:text-slate-400 mb-2">Annotation</div>
        <div className="text-[10px] text-slate-600 dark:text-slate-300 leading-relaxed mb-3">
          Edit the note text below. Drag the box to move it. Drag the amber dot at the arrow tip to point it elsewhere.
        </div>
      </div>
      <div>
        <div className="text-[9px] tracking-[0.2em] uppercase text-slate-500 dark:text-slate-400 mb-1.5">Text</div>
        <textarea
          value={anno.text}
          onChange={(e) => updateAnnoText(e.target.value)}
          rows={5}
          className="w-full px-3 py-2 text-xs bg-white dark:bg-[#0E141B] rounded-lg ring-1 ring-slate-200 dark:ring-[#2A3947] focus:ring-[#3FB7C9]/40 focus:bg-white focus:outline-none transition-all text-slate-900 dark:text-slate-100 resize-none"
        />
      </div>
      <button onClick={deleteSelected}
        className="w-full px-3 py-2 bg-slate-50 ring-1 ring-slate-200 hover:bg-red-500/[0.1] hover:text-red-300 text-slate-800 dark:text-slate-200 rounded-md text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all">
        <Trash2 size={12}/> Delete Annotation
      </button>
    </div>
  );
}

function WireInspector({ deleteSelected }) {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div>
        <div className="text-[9px] tracking-[0.2em] uppercase text-slate-500 dark:text-slate-400 mb-2">Wire</div>
        <div className="text-[10px] text-slate-600 dark:text-slate-300 leading-relaxed mb-3">
          This line connects two symbols. Remove it below, or press Delete / Backspace.
        </div>
      </div>
      <button onClick={deleteSelected}
        className="w-full px-3 py-2 bg-slate-50 ring-1 ring-slate-200 hover:bg-red-500/[0.1] hover:text-red-300 text-slate-800 dark:text-slate-200 rounded-md text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all">
        <Trash2 size={12}/> Delete Wire
      </button>
    </div>
  );
}

function EmptyInspector({ placed }) {
  const counts = {};
  placed.forEach(p => {
    const sym = findSymbol(p.symbolId);
    if (!sym) return;
    counts[sym.name] = (counts[sym.name] || 0) + 1;
  });
  const entries = Object.entries(counts).sort();
  return (
    <div className="flex-1 overflow-y-auto p-4 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed
                    [&::-webkit-scrollbar]:w-1.5
                    [&::-webkit-scrollbar-thumb]:bg-white/10
                    [&::-webkit-scrollbar-thumb]:rounded-full">
      <div className="mb-4 text-slate-600 dark:text-slate-300">Select a symbol or annotation to inspect.</div>
      <div className="text-slate-500 dark:text-slate-400 uppercase tracking-[0.2em] text-[9px] mb-2">Schedule</div>
      {!entries.length ? (
        <div className="text-slate-400 mt-2 text-[10px] italic">No items placed yet.</div>
      ) : (
        <table className="w-full text-[10px] tabular-nums">
          <tbody>
            {entries.map(([name, n]) => (
              <tr key={name} className="border-b border-slate-100">
                <td className="py-1.5 text-slate-700 dark:text-slate-300">{name}</td>
                <td className="py-1.5 text-right text-[#22808F] font-semibold">{n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-slate-50 dark:bg-[#22303D] rounded-lg ring-1 ring-slate-200 dark:ring-[#2A3947] px-2.5 py-2">
      <div className="text-slate-500 dark:text-slate-400 uppercase tracking-wider text-[8.5px] mb-0.5">{label}</div>
      <div className="tabular-nums text-slate-900 dark:text-slate-100 font-medium text-[11px]">{value}</div>
    </div>
  );
}

/* ============================================================================
 * FLOATING TOOLBARS
 * ========================================================================= */
export function FloatingToolbar({ tool, setTool }) {
  return (
    <div className="absolute top-4 left-4 z-20 flex flex-col bg-white dark:bg-[#16202B] rounded-2xl ring-1 ring-slate-200/70 dark:ring-[#2A3947] shadow-[0_10px_30px_-10px_rgba(16,28,40,0.22)] overflow-hidden">
      {Object.entries(TOOLS).filter(([key]) => key === "select" || key === "wire").map(([key, info]) => {
        const Icon = info.icon;
        const active = tool === key;
        return (
          <button key={key}
            onClick={() => setTool(key)}
            title={`${info.label} (${info.hint})`}
            className={`relative p-2.5 transition-colors duration-150 ${
              active ? "text-[#22808F]" : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10"
            }`}>
            {active && <div className="absolute inset-0 bg-[#ECF8FA] dark:bg-[#3FB7C9]/15"/>}
            {active && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-[#3FB7C9] rounded-r-full"/>}
            <Icon size={15} className="relative"/>
          </button>
        );
      })}
    </div>
  );
}

export function ZoomControls({ zoom, onIn, onOut, onFit }) {
  return (
    <div className="absolute top-4 right-4 z-20 flex bg-white dark:bg-[#16202B] rounded-2xl ring-1 ring-slate-200/70 dark:ring-[#2A3947] shadow-[0_10px_30px_-10px_rgba(16,28,40,0.22)] overflow-hidden">
      <button onClick={onOut} className="p-2.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors">
        <ZoomOut size={14}/>
      </button>
      <div className="px-3 self-center text-[11px] text-slate-700 dark:text-slate-200 tabular-nums border-x border-slate-200 dark:border-[#2A3947] min-w-[56px] text-center" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
        {Math.round(zoom*100)}%
      </div>
      <button onClick={onIn} className="p-2.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors">
        <ZoomIn size={14}/>
      </button>
      <button onClick={onFit} title="Fit (0)"
              className="p-2.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors border-l border-slate-200 dark:border-[#2A3947]">
        <Maximize2 size={14}/>
      </button>
    </div>
  );
}

/* ============================================================================
 * PROJECT MANAGER (modal) — save, open, and delete named projects
 * ========================================================================= */
export function ProjectManager({
  projectList, currentProjectId, currentName,
  onSaveAs, onOpen, onDelete, onNew, onClose,
}) {
  const [name, setName] = React.useState(currentName || "");
  const [confirmDelete, setConfirmDelete] = React.useState(null);

  const sorted = [...(projectList || [])].sort((a, b) =>
    (b.updatedAt || "").localeCompare(a.updatedAt || "")
  );

  const fmtDate = (iso) => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    } catch { return ""; }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-6"
         onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
           className="bg-white rounded-2xl ring-1 ring-slate-200 w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <div className="text-[10px] tracking-[0.3em] uppercase text-slate-500">Projects</div>
            <div className="text-base font-semibold mt-0.5 text-slate-900">Save &amp; open jobs</div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md">
            <X size={16}/>
          </button>
        </div>

        {/* Save current as a new project */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="text-[9px] tracking-[0.2em] uppercase text-slate-500 mb-2">Save current drawing as</div>
          <div className="flex gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project name (e.g. Dalton — Plot 7)"
              className="flex-1 px-3 py-2 text-sm bg-white rounded-lg ring-1 ring-slate-200 focus:ring-[#3FB7C9] focus:outline-none transition-all text-slate-900 placeholder:text-slate-400"
            />
            <button
              onClick={() => { if (name.trim()) onSaveAs(name.trim()); }}
              disabled={!name.trim()}
              className="px-4 py-2 bg-[#3FB7C9] text-[#08313a] rounded-lg text-[10px] uppercase tracking-wider font-semibold hover:bg-[#52C4D5] transition disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap">
              Save As
            </button>
          </div>
        </div>

        {/* Saved projects list */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[9px] tracking-[0.2em] uppercase text-slate-500">
              Saved projects ({sorted.length})
            </div>
            <button onClick={onNew}
              className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-800 transition">
              <Plus size={12}/> New blank
            </button>
          </div>

          {sorted.length === 0 ? (
            <div className="text-sm text-slate-500 italic py-8 text-center">
              No saved projects yet. Name your current drawing above and click Save As to keep it.
            </div>
          ) : (
            <div className="space-y-1.5">
              {sorted.map(p => {
                const isCurrent = p.id === currentProjectId;
                return (
                  <div key={p.id}
                       className={`flex items-center gap-3 px-3 py-2.5 rounded-lg ring-1 transition-all ${
                         isCurrent ? "bg-[#ECF8FA] ring-[#9FE1EC]" : "bg-white ring-slate-200 hover:ring-slate-300"
                       }`}>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate flex items-center gap-2">
                        {p.name}
                        {isCurrent && <span className="text-[8px] uppercase tracking-wider text-[#22808F] bg-[#D8F0F4] px-1.5 py-0.5 rounded-full">Open</span>}
                      </div>
                      <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                        <Clock size={9}/> {fmtDate(p.updatedAt)}
                      </div>
                    </div>
                    {confirmDelete === p.id ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-500">Delete?</span>
                        <button onClick={() => { onDelete(p.id); setConfirmDelete(null); }}
                          className="px-2 py-1 bg-red-500 text-white rounded text-[9px] uppercase tracking-wider hover:bg-red-600">Yes</button>
                        <button onClick={() => setConfirmDelete(null)}
                          className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-[9px] uppercase tracking-wider hover:bg-slate-200">No</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => onOpen(p.id)}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md text-[10px] uppercase tracking-wider font-medium">
                          Open
                        </button>
                        <button onClick={() => setConfirmDelete(p.id)}
                          title="Delete"
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md">
                          <Trash2 size={13}/>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-slate-200 text-[10px] text-slate-400">
          Projects are saved in this browser. Use <span className="text-slate-600">JSON</span> export for a portable backup.
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * BILL OF QUANTITIES (modal) — auto-counted schedule of placed symbols
 * ========================================================================= */
// ---- BOQ print layout (paginated A4) ----------------------------------------
const boqGbp = (n) => "£" + (Number(n) || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const boqLine = (it) => (parseFloat(it.qty) || 0) * (parseFloat(it.rate) || 0);
const boqSub = (sec) => sec.items.reduce((s, it) => s + boqLine(it), 0);

// Flow the BOQ into A4 pages. A section that spills onto the next page repeats
// its title (marked "cont.") and the column header, so a heading never gets
// stranded away from its rows.
function paginateBoq(boq) {
  const H = { header: 86, meta: 222, notes: 30 + ((boq.notes || []).length * 20) + 22, title: 42, thead: 26, row: 28, subtotal: 30, totals: 240, gap: 14 };
  const CONTENT = 1010;
  const pages = [];
  let page = { preamble: true, chunks: [], totals: false };
  let used = H.header + H.meta + H.notes;
  const flush = () => { pages.push(page); page = { preamble: false, chunks: [], totals: false }; };

  for (const sec of boq.sections) {
    used += H.gap;
    if (used + H.title + H.thead + H.row > CONTENT) { flush(); used = H.gap; }
    let chunk = { secKey: sec.key, title: sec.title, subtitle: sec.subtitle, continued: false, startIndex: 0, rows: [], subtotal: null };
    used += H.title + H.thead;
    for (let i = 0; i < sec.items.length; i++) {
      if (used + H.row > CONTENT) {
        page.chunks.push(chunk); flush();
        used = H.gap + H.title + H.thead;
        chunk = { secKey: sec.key, title: sec.title, subtitle: sec.subtitle, continued: true, startIndex: i, rows: [], subtotal: null };
      }
      chunk.rows.push(sec.items[i]);
      used += H.row;
    }
    if (used + H.subtotal > CONTENT) {
      page.chunks.push(chunk); flush();
      used = H.gap + H.title + H.thead + H.subtotal;
      chunk = { secKey: sec.key, title: sec.title, subtitle: sec.subtitle, continued: true, startIndex: sec.items.length, rows: [], subtotal: boqSub(sec) };
    } else {
      chunk.subtotal = boqSub(sec);
      used += H.subtotal;
    }
    page.chunks.push(chunk);
  }
  if (used + H.totals > CONTENT) { flush(); }
  page.totals = true;
  pages.push(page);
  return pages;
}

function BoqPrintPages({ boq, projectName, company }) {
  const pages = paginateBoq(boq);
  const m = boq.meta || {};
  const projectTotal = boq.sections.reduce((s, sec) => s + boqSub(sec), 0);
  const vat = projectTotal * (boq.vatRate || 0) / 100;
  const th = { textAlign: "left", padding: "6px", fontSize: 8, letterSpacing: "0.06em", textTransform: "uppercase", color: "#64748b", borderBottom: "1px solid #cbd5e1" };
  const td = { padding: "5px 6px", fontSize: 10, color: "#334155", borderBottom: "1px solid #eef2f6", verticalAlign: "top" };
  const metaRow = (label, val) => (
    <div style={{ display: "flex", borderBottom: "1px solid #eef2f6", padding: "6px 0" }}>
      <div style={{ width: 110, fontSize: 8.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#94a3b8" }}>{label}</div>
      <div style={{ fontSize: 11, color: "#0f172a", fontWeight: 600 }}>{val || "—"}</div>
    </div>
  );
  const ColGroup = () => (
    <colgroup>
      <col style={{ width: 22 }} /><col /><col /><col style={{ width: 44 }} /><col style={{ width: 70 }} /><col style={{ width: 74 }} />
    </colgroup>
  );
  const Thead = () => (
    <thead><tr>
      <th style={{ ...th, width: 22 }}>#</th><th style={th}>Item</th><th style={th}>Specification / Notes</th>
      <th style={{ ...th, textAlign: "right" }}>Qty</th><th style={{ ...th, textAlign: "right" }}>Unit Rate</th><th style={{ ...th, textAlign: "right" }}>Total</th>
    </tr></thead>
  );

  return (
    <>
      {pages.map((pg, pi) => (
        <div key={pi} className="boq-page" style={{ width: 794, height: 1123, background: "#fff", padding: "40px 46px 54px", boxSizing: "border-box", color: "#1e293b", fontFamily: "Inter, system-ui, sans-serif", position: "relative", overflow: "hidden" }}>
          {pg.preamble && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 26 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a" }}>{company || ""}</div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 9, letterSpacing: "0.22em", textTransform: "uppercase", color: "#22808F", fontWeight: 700 }}>Electrical Bill of Quantities</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "#0f172a", marginTop: 2, lineHeight: 1.1 }}>{m.development || projectName || "Project"}</div>
                  <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>Issued for pricing · ex-VAT, GBP</div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 34, marginBottom: 20 }}>
                {metaRow("Development", m.development || projectName)}
                {metaRow("Site address", m.siteAddress)}
                {metaRow("Prepared by", m.preparedBy)}
                {metaRow("Supplier", m.supplier)}
                {metaRow("Drawing no.", m.drawingNo)}
                {metaRow("Date issued", m.dateIssued)}
                {metaRow("Required on site", m.requiredOnSite)}
              </div>
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "12px 16px", marginBottom: 8, background: "#f8fafc" }}>
                <div style={{ fontSize: 8.5, textTransform: "uppercase", letterSpacing: "0.1em", color: "#22808F", fontWeight: 700, marginBottom: 7 }}>Notes to supplier</div>
                {(boq.notes || []).map((n, i) => (
                  <div key={i} style={{ fontSize: 10, color: "#475569", marginBottom: 4, display: "flex", gap: 6 }}><span style={{ color: "#94a3b8" }}>•</span><span>{n}</span></div>
                ))}
              </div>
            </>
          )}

          {pg.chunks.map((ch, ci) => (
            <div key={ci} style={{ marginTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{ch.title}{ch.continued ? <span style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8" }}>  (cont.)</span> : null}</div>
                {ch.subtotal != null && <div style={{ fontSize: 13, fontWeight: 700, color: "#22808F" }}>{boqGbp(ch.subtotal)}</div>}
              </div>
              {!ch.continued && ch.subtitle && <div style={{ fontSize: 9.5, color: "#94a3b8", marginBottom: 4 }}>{ch.subtitle}</div>}
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <ColGroup />
                <Thead />
                <tbody>
                  {ch.rows.map((it, ii) => (
                    <tr key={it.id || ii}>
                      <td style={{ ...td, color: "#94a3b8" }}>{ch.startIndex + ii + 1}</td>
                      <td style={{ ...td, fontWeight: 600, color: "#1e293b" }}>{it.item}</td>
                      <td style={{ ...td, color: "#64748b" }}>{it.spec}</td>
                      <td style={{ ...td, textAlign: "right" }}>{it.qty === "" || it.qty == null ? "—" : it.qty}</td>
                      <td style={{ ...td, textAlign: "right" }}>{Number(it.rate) ? boqGbp(it.rate) : "—"}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 600, color: "#0f172a" }}>{boqLine(it) ? boqGbp(boqLine(it)) : "—"}</td>
                    </tr>
                  ))}
                  {ch.subtotal != null && (
                    <tr>
                      <td colSpan={5} style={{ padding: "6px", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "right", color: "#475569", fontWeight: 700 }}>{ch.title} subtotal</td>
                      <td style={{ padding: "6px", fontSize: 11, textAlign: "right", fontWeight: 700, color: "#0f172a" }}>{boqGbp(ch.subtotal)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ))}

          {pg.totals && (
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "16px 18px", marginTop: 16, background: "#f8fafc" }}>
              <div style={{ fontSize: 8.5, textTransform: "uppercase", letterSpacing: "0.1em", color: "#64748b", fontWeight: 700, marginBottom: 8 }}>Plot total</div>
              {boq.sections.map((sec, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #eef2f6", padding: "5px 0", fontSize: 11 }}>
                  <span style={{ color: "#475569" }}>{sec.title} subtotal</span><span style={{ fontWeight: 600 }}>{boqGbp(boqSub(sec))}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 12, paddingTop: 8, borderTop: "2px solid #1e293b" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>Project total</div>
                  <div style={{ fontSize: 8, textTransform: "uppercase", letterSpacing: "0.08em", color: "#94a3b8" }}>Excluding VAT · Issued for pricing</div>
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "#0f172a" }}>{boqGbp(projectTotal)}</div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 11, marginTop: 4 }}><span style={{ color: "#475569" }}>VAT @ {boq.vatRate}%</span><span>{boqGbp(vat)}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontSize: 11, fontWeight: 700 }}><span>Total inc. VAT</span><span>{boqGbp(projectTotal + vat)}</span></div>
            </div>
          )}

          <div style={{ position: "absolute", bottom: 22, left: 46, right: 46, fontSize: 8.5, color: "#94a3b8", display: "flex", justifyContent: "space-between", borderTop: "1px solid #eef2f6", paddingTop: 8 }}>
            <span>Unit rates and totals to be completed by supplier{company ? ` · ${company}` : ""}</span>
            <span>Page {pi + 1} of {pages.length}</span>
          </div>
        </div>
      ))}
    </>
  );
}

/* ============================================================================
 * BOQ TEMPLATE EDITOR — edit the default items/specs/sections saved per account.
 * ========================================================================= */
export function BoqTemplateEditor({ saved, onSave, onClose }) {
  const [tpl, setTpl] = useState(() => templateForEditing(saved));
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);

  const setItem = (si, id, f, v) => setTpl(t => t.map((sec, i) => i !== si ? sec : ({ ...sec, items: sec.items.map(it => it.id === id ? { ...it, [f]: v } : it) })));
  const addItem = (si) => setTpl(t => t.map((sec, i) => i !== si ? sec : ({ ...sec, items: [...sec.items, newTemplateItem()] })));
  const removeItem = (si, id) => setTpl(t => t.map((sec, i) => i !== si ? sec : ({ ...sec, items: sec.items.filter(it => it.id !== id) })));
  const setTitle = (si, v) => setTpl(t => t.map((sec, i) => i !== si ? sec : ({ ...sec, title: v })));

  const doSave = async () => {
    setBusy(true);
    try {
      await onSave(templateForSaving(tpl));
      setFlash(true); setTimeout(() => setFlash(false), 1800);
    } catch (e) { alert("Couldn't save presets: " + (e?.message || e)); }
    finally { setBusy(false); }
  };

  const cell = "w-full bg-transparent outline-none rounded px-1.5 py-1 focus:bg-[#ECF8FA] focus:ring-1 focus:ring-[#3FB7C9]/40";

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl ring-1 ring-slate-200 w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 h-14 bg-[#2C3E50] shrink-0">
          <div>
            <div className="text-[9px] tracking-[0.3em] uppercase text-[#9fd8e2]">BOQ Presets</div>
            <div className="text-white font-semibold text-[15px] -mt-0.5" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Default items &amp; specifications</div>
          </div>
          <button onClick={onClose} className="text-slate-300 hover:text-white"><X size={18}/></button>
        </div>
        <div className="px-6 py-2.5 bg-[#ECF8FA] border-b border-[#3FB7C9]/30 text-[11px] text-[#22808F]">
          Edit the standard items, specs and section names used every time a new BOQ is created. Items marked <b>auto</b> still pull their quantity from the drawing.
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 text-slate-800">
          {tpl.map((sec, si) => (
            <div key={sec.key || si} className="mb-6">
              <input value={sec.title} onChange={(e) => setTitle(si, e.target.value)}
                className="text-[14px] font-bold text-slate-900 bg-transparent outline-none focus:bg-[#ECF8FA] rounded px-1 mb-1"/>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="text-left text-slate-400 uppercase tracking-wider text-[8.5px] border-b border-slate-200">
                    <th className="py-1.5 w-6">#</th><th className="py-1.5 pr-2">Item</th><th className="py-1.5 pr-2">Specification / Notes</th>
                    <th className="py-1.5 w-12 text-center">Qty</th><th className="w-6"></th>
                  </tr>
                </thead>
                <tbody>
                  {sec.items.map((it, ii) => (
                    <tr key={it.id} className="group border-b border-slate-100">
                      <td className="py-0.5 text-slate-400 tabular-nums text-[11px]">{ii + 1}</td>
                      <td className="py-0.5 pr-1"><input value={it.item} onChange={(e) => setItem(si, it.id, "item", e.target.value)} className={`${cell} text-[12px] font-medium text-slate-800`} placeholder="Item"/></td>
                      <td className="py-0.5 pr-1"><input value={it.spec} onChange={(e) => setItem(si, it.id, "spec", e.target.value)} className={`${cell} text-[11px] text-slate-500`} placeholder="Spec / notes"/></td>
                      <td className="py-0.5 text-center">{it.sf ? <span title="Quantity auto-fills from the drawing" className="text-[8px] uppercase tracking-wider text-[#22808F] bg-[#3FB7C9]/15 rounded px-1.5 py-0.5">auto</span> : <span className="text-slate-300 text-[10px]">—</span>}</td>
                      <td className="py-0.5 text-center"><button onClick={() => removeItem(si, it.id)} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500"><X size={12}/></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={() => addItem(si)} className="mt-2 text-[11px] text-[#22808F] hover:text-[#08313a] font-medium flex items-center gap-1"><Plus size={13}/> Add item to {sec.title}</button>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-200 shrink-0">
          <div className="text-[10px] text-slate-400">Presets apply to every new BOQ.</div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md text-[10px] uppercase tracking-wider">Close</button>
            <button onClick={doSave} disabled={busy} className={`px-4 py-2 rounded-md text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5 ${flash ? "bg-emerald-500 text-white" : "bg-[#3FB7C9] text-[#08313a] hover:bg-[#52C4D5]"}`}>
              {flash ? "Saved ✓" : busy ? "Saving…" : "Save presets"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function BillOfQuantities({ project, updateBoq, onClose }) {
  const { boqTemplate, saveBoqTemplate } = useApp();
  const meta = project.meta || {};
  const [boq, setBoq] = useState(() => {
    const base = project.boq || buildInitialBoq(project, SYMBOL_META, findSymbol, boqTemplate);
    return reconcileBoq(base, project, SYMBOL_META, findSymbol);
  });
  const [showTemplate, setShowTemplate] = useState(false);

  // Persist edits to the project (saved with the project on Save).
  useEffect(() => { updateBoq?.(boq); /* eslint-disable-next-line */ }, [boq]);

  const gbp = (n) => "\u00A3" + (Number(n) || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const lineTotal = (it) => (parseFloat(it.qty) || 0) * (parseFloat(it.rate) || 0);
  const subtotal = (sec) => sec.items.reduce((s, it) => s + lineTotal(it), 0);
  const projectTotal = boq.sections.reduce((s, sec) => s + subtotal(sec), 0);
  const vat = projectTotal * (boq.vatRate || 0) / 100;

  const setMeta = (f, v) => setBoq(b => ({ ...b, meta: { ...b.meta, [f]: v } }));
  const setItem = (si, id, f, v) => setBoq(b => ({ ...b, sections: b.sections.map((sec, i) => i !== si ? sec : ({ ...sec, items: sec.items.map(it => it.id === id ? { ...it, [f]: v } : it) })) }));
  const addItem = (si) => setBoq(b => ({ ...b, sections: b.sections.map((sec, i) => i !== si ? sec : ({ ...sec, items: [...sec.items, newBoqItem()] })) }));
  const removeItem = (si, id) => setBoq(b => ({ ...b, sections: b.sections.map((sec, i) => i !== si ? sec : ({ ...sec, items: sec.items.filter(it => it.id !== id) })) }));
  const setSectionTitle = (si, v) => setBoq(b => ({ ...b, sections: b.sections.map((sec, i) => i !== si ? sec : ({ ...sec, title: v })) }));
  const setNote = (i, v) => setBoq(b => ({ ...b, notes: b.notes.map((n, idx) => idx === i ? v : n) }));
  const addNote = () => setBoq(b => ({ ...b, notes: [...b.notes, ""] }));
  const removeNote = (i) => setBoq(b => ({ ...b, notes: b.notes.filter((_, idx) => idx !== i) }));
  const refresh = () => setBoq(b => refreshQuantities(b, project, SYMBOL_META, findSymbol));
  const resetToTemplate = () => {
    if (!window.confirm("Rebuild this BOQ from your saved presets and the current drawing? Quantities re-pull from the drawing and any rates you've typed will be cleared.")) return;
    setBoq(buildInitialBoq(project, SYMBOL_META, findSymbol, boqTemplate));
  };

  const printRef = useRef(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const fileBase = () => (meta.projectName || "plan").replace(/[^a-z0-9-_]+/gi, "_");

  const downloadPDF = async () => {
    if (!printRef.current) return;
    setPdfBusy(true);
    try {
      const [{ default: jsPDF }, h2cMod] = await Promise.all([import("jspdf"), import("html2canvas")]);
      const html2canvas = h2cMod.default;
      const pages = printRef.current.querySelectorAll(".boq-page");
      if (!pages.length) { setPdfBusy(false); return; }
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const W = pdf.internal.pageSize.getWidth();
      const Hpt = pdf.internal.pageSize.getHeight();
      for (let i = 0; i < pages.length; i++) {
        const canvas = await html2canvas(pages[i], { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false, windowWidth: 794 });
        const img = canvas.toDataURL("image/jpeg", 0.95);
        if (i > 0) pdf.addPage();
        pdf.addImage(img, "JPEG", 0, 0, W, Hpt);
      }
      pdf.save(fileBase() + "_BOQ.pdf");
    } catch (e) {
      alert("PDF export failed: " + (e?.message || e));
    } finally {
      setPdfBusy(false);
    }
  };

  const downloadCSV = () => {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const L = [];
    L.push([esc("Electrical Bill of Quantities"), esc(boq.meta.development || meta.projectName || "")].join(","));
    L.push([esc("Prepared by"), esc(boq.meta.preparedBy)].join(","));
    L.push([esc("Site address"), esc(boq.meta.siteAddress)].join(","));
    L.push([esc("Supplier"), esc(boq.meta.supplier)].join(","));
    L.push([esc("Drawing no."), esc(boq.meta.drawingNo)].join(","));
    L.push([esc("Date issued"), esc(boq.meta.dateIssued)].join(","));
    L.push([esc("Required on site"), esc(boq.meta.requiredOnSite)].join(","));
    L.push("");
    boq.sections.forEach(sec => {
      L.push(esc(sec.title));
      L.push(["#", "Item", "Specification / Notes", "Qty", "Unit Rate", "Total"].map(esc).join(","));
      sec.items.forEach((it, i) => L.push([i + 1, it.item, it.spec, it.qty, it.rate, lineTotal(it).toFixed(2)].map(esc).join(",")));
      L.push([esc(""), esc(sec.title + " subtotal"), esc(""), esc(""), esc(""), esc(subtotal(sec).toFixed(2))].join(","));
      L.push("");
    });
    L.push([esc("Project total (ex VAT)"), esc(""), esc(""), esc(""), esc(""), esc(projectTotal.toFixed(2))].join(","));
    L.push([esc("VAT @ " + boq.vatRate + "%"), esc(""), esc(""), esc(""), esc(""), esc(vat.toFixed(2))].join(","));
    L.push([esc("Total inc VAT"), esc(""), esc(""), esc(""), esc(""), esc((projectTotal + vat).toFixed(2))].join(","));
    const blob = new Blob([L.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = ((meta.projectName || "plan").replace(/[^a-z0-9-_]+/gi, "_")) + "_BOQ.csv";
    a.click();
  };

  const cell = "w-full bg-transparent outline-none rounded px-1.5 py-1 focus:bg-[#ECF8FA] focus:ring-1 focus:ring-[#3FB7C9]/40";

  const MetaField = ({ label, field, strong }) => (
    <div className="flex items-center gap-2 border-b border-slate-100 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-slate-500 w-28 shrink-0">{label}</div>
      <input value={boq.meta[field] || ""} onChange={(e) => setMeta(field, e.target.value)}
        placeholder="—"
        className={`${cell} text-[12px] ${strong ? "font-semibold text-slate-900" : "text-slate-700"}`}/>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl ring-1 ring-slate-200 w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">

        {/* Off-screen print layout captured for PDF export */}
        <div aria-hidden style={{ position: "absolute", left: -10000, top: 0, width: 794, pointerEvents: "none" }}>
          <div ref={printRef}>
            <BoqPrintPages boq={boq} projectName={meta.projectName} company={meta.company || boq.meta.preparedBy} />
          </div>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-6 h-14 bg-[#2C3E50] shrink-0">
          <div>
            <div className="text-[9px] tracking-[0.3em] uppercase text-[#9fd8e2]">Electrical Bill of Quantities</div>
            <div className="text-white font-semibold text-[15px] -mt-0.5" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              {boq.meta.development || meta.projectName || "Untitled Project"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowTemplate(true)} title="Edit the default items/specs used for every BOQ"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] uppercase tracking-wider font-semibold bg-[#3FB7C9]/20 text-[#9fd8e2] ring-1 ring-[#3FB7C9]/50 hover:bg-[#3FB7C9]/30">
              <SlidersHorizontal size={13}/> Presets
            </button>
            <button onClick={onClose} className="text-slate-300 hover:text-white"><X size={18}/></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 text-slate-800">
          {/* Metadata grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 mb-5">
            <MetaField label="Development" field="development" strong/>
            <MetaField label="Site address" field="siteAddress"/>
            <MetaField label="Prepared by" field="preparedBy" strong/>
            <MetaField label="Supplier" field="supplier"/>
            <MetaField label="Drawing no." field="drawingNo"/>
            <MetaField label="Date issued" field="dateIssued"/>
            <MetaField label="Required on site" field="requiredOnSite"/>
          </div>

          {/* Notes to supplier */}
          <div className="rounded-xl ring-1 ring-slate-200 bg-slate-50/60 px-4 py-3 mb-6">
            <div className="text-[9px] uppercase tracking-wider text-[#22808F] font-semibold mb-2">Notes to supplier</div>
            {boq.notes.map((n, i) => (
              <div key={i} className="group flex items-start gap-2 mb-1">
                <span className="text-slate-400 text-[11px] mt-1.5">•</span>
                <input value={n} onChange={(e) => setNote(i, e.target.value)} className={`${cell} text-[11px] text-slate-600`}/>
                <button onClick={() => removeNote(i)} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 mt-1.5"><X size={12}/></button>
              </div>
            ))}
            <button onClick={addNote} className="text-[10px] text-slate-400 hover:text-[#22808F] mt-1 ml-4">+ Add note</button>
          </div>

          {/* Sections */}
          {boq.sections.map((sec, si) => (
            <div key={sec.key || si} className="mb-7">
              <div className="flex items-center justify-between mb-2">
                <input value={sec.title} onChange={(e) => setSectionTitle(si, e.target.value)}
                  className="text-[14px] font-bold text-slate-900 bg-transparent outline-none focus:bg-[#ECF8FA] rounded px-1"/>
                <div className="text-right">
                  <div className="text-[8px] uppercase tracking-wider text-slate-400">Subtotal</div>
                  <div className="text-[14px] font-bold text-[#22808F] tabular-nums">{gbp(subtotal(sec))}</div>
                </div>
              </div>
              {sec.subtitle && <div className="text-[10px] text-slate-400 -mt-1 mb-1.5 px-1">{sec.subtitle}</div>}
              <table className="w-full border-collapse">
                <thead>
                  <tr className="text-left text-slate-400 uppercase tracking-wider text-[8.5px] border-b border-slate-200">
                    <th className="py-1.5 w-6">#</th>
                    <th className="py-1.5 pr-2">Item</th>
                    <th className="py-1.5 pr-2">Specification / Notes</th>
                    <th className="py-1.5 pr-2 w-14 text-right">Qty</th>
                    <th className="py-1.5 pr-2 w-24 text-right">Unit Rate</th>
                    <th className="py-1.5 w-24 text-right">Total</th>
                    <th className="w-6"></th>
                  </tr>
                </thead>
                <tbody>
                  {sec.items.map((it, ii) => (
                    <tr key={it.id} className="group border-b border-slate-100">
                      <td className="py-0.5 text-slate-400 tabular-nums text-[11px] align-middle">{ii + 1}</td>
                      <td className="py-0.5 pr-1"><input value={it.item} onChange={(e) => setItem(si, it.id, "item", e.target.value)} className={`${cell} text-[12px] font-medium text-slate-800`} placeholder="Item"/></td>
                      <td className="py-0.5 pr-1"><input value={it.spec} onChange={(e) => setItem(si, it.id, "spec", e.target.value)} className={`${cell} text-[11px] text-slate-500`} placeholder="Spec / notes"/></td>
                      <td className="py-0.5 pr-1"><input value={it.qty} onChange={(e) => setItem(si, it.id, "qty", e.target.value)} inputMode="decimal" className={`${cell} text-[12px] text-right tabular-nums`} placeholder="—"/></td>
                      <td className="py-0.5 pr-1">
                        <div className="flex items-center justify-end gap-0.5">
                          <span className="text-slate-400 text-[11px]">£</span>
                          <input value={it.rate} onChange={(e) => setItem(si, it.id, "rate", e.target.value)} inputMode="decimal" className={`${cell} text-[12px] text-right tabular-nums`} placeholder="0.00"/>
                        </div>
                      </td>
                      <td className="py-0.5 text-right tabular-nums text-[12px] font-semibold text-slate-900 pr-1">{lineTotal(it) ? gbp(lineTotal(it)) : "\u2014"}</td>
                      <td className="py-0.5 text-center">
                        <button onClick={() => removeItem(si, it.id)} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500"><X size={12}/></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={() => addItem(si)} className="mt-2 text-[11px] text-[#22808F] hover:text-[#08313a] font-medium flex items-center gap-1">
                <Plus size={13}/> Add item to {sec.title}
              </button>
            </div>
          ))}

          {/* Totals */}
          <div className="rounded-xl ring-1 ring-slate-200 bg-slate-50/60 px-5 py-4 mt-2">
            <div className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Plot total</div>
            {boq.sections.map((sec, i) => (
              <div key={i} className="flex justify-between border-b border-slate-100 py-1.5 text-[12px]">
                <span className="text-slate-600">{sec.title} subtotal</span>
                <span className="tabular-nums font-medium">{gbp(subtotal(sec))}</span>
              </div>
            ))}
            <div className="flex items-end justify-between mt-3 pt-2 border-t-2 border-slate-800">
              <div>
                <div className="text-[13px] font-bold text-slate-900">Project total</div>
                <div className="text-[8px] uppercase tracking-wider text-slate-400">Excluding VAT \u00B7 Issued for pricing</div>
              </div>
              <div className="text-[22px] font-bold text-slate-900 tabular-nums">{gbp(projectTotal)}</div>
            </div>
            <div className="flex justify-between py-1 text-[12px] mt-1">
              <span className="text-slate-600">VAT @ {boq.vatRate}%</span>
              <span className="tabular-nums">{gbp(vat)}</span>
            </div>
            <div className="flex justify-between py-1 text-[12px] font-semibold">
              <span className="text-slate-700">Total inc. VAT</span>
              <span className="tabular-nums">{gbp(projectTotal + vat)}</span>
            </div>
          </div>
          <div className="text-[10px] text-slate-400 mt-3">Unit rates and totals to be completed by supplier. This schedule is issued for pricing.</div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-200 shrink-0">
          <div className="flex gap-1">
            <button onClick={refresh} title="Re-pull Second Fix quantities from the current drawing"
              className="px-3 py-2 text-[10px] uppercase tracking-wider text-[#22808F] hover:bg-[#ECF8FA] rounded-md font-semibold flex items-center gap-1.5">
              <RotateCw size={12}/> Refresh from drawing
            </button>
            <button onClick={resetToTemplate} title="Rebuild this BOQ from your saved presets"
              className="px-3 py-2 text-[10px] uppercase tracking-wider text-slate-400 hover:text-[#22808F] hover:bg-[#ECF8FA] rounded-md font-semibold">
              Reset to presets
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md text-[10px] uppercase tracking-wider">Close</button>
            <button onClick={downloadCSV} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5"><Download size={12}/> CSV</button>
            <button onClick={downloadPDF} disabled={pdfBusy} style={pdfBusy ? { opacity: 0.6, cursor: "wait" } : undefined}
              className="px-4 py-2 bg-[#3FB7C9] text-[#08313a] rounded-md text-[10px] uppercase tracking-wider font-semibold hover:bg-[#52C4D5] flex items-center gap-1.5">
              <Download size={12}/> {pdfBusy ? "Building…" : "Download PDF"}
            </button>
          </div>
        </div>
      </div>

      {showTemplate && (
        <BoqTemplateEditor
          saved={boqTemplate}
          onSave={async (tpl) => { await saveBoqTemplate?.(tpl); }}
          onClose={() => setShowTemplate(false)}
        />
      )}
    </div>
  );
}

/* ============================================================================
 * METADATA EDITOR (modal)
 * ========================================================================= */
export function MetaEditor({ meta, updateMeta, onSheetField, onClose }) {
  const setSheet = onSheetField || (() => {});
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center p-6"
         onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
           className="bg-white rounded-2xl ring-1 ring-slate-300 w-full max-w-xl p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="text-[10px] tracking-[0.3em] uppercase text-slate-500">Project Settings</div>
            <div className="text-base font-semibold mt-0.5">Sheet metadata</div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md">
            <X size={16}/>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <MetaField label="Project name"   value={meta.projectName}   onChange={(v) => updateMeta({ projectName: v })} />
          <MetaField label="Plot / address" value={meta.plot}          onChange={(v) => updateMeta({ plot: v })} />
          <MetaField label="Sheet name (this floor)" value={meta.sheetName}     onChange={(v) => setSheet({ name: v })} />
          <MetaField label="Scale"          value={meta.scale}         onChange={(v) => updateMeta({ scale: v })} />
          <MetaField label="Drawing number (this floor)" value={meta.drawingNumber} onChange={(v) => setSheet({ drawingNumber: v })} />
          <MetaField label="Date"           value={meta.date}          onChange={(v) => updateMeta({ date: v })} type="date"/>
          <MetaField label="Revision"       value={meta.revision}      onChange={(v) => updateMeta({ revision: v })} />
          <MetaField label="Revision note"  value={meta.revNote}       onChange={(v) => updateMeta({ revNote: v })} />
          <MetaField label="Company"        value={meta.company}       onChange={(v) => updateMeta({ company: v })} span={2}/>
        </div>

        <div className="mt-4 pt-4 border-t border-slate-200">
          <div className="text-[9px] tracking-[0.25em] uppercase text-slate-400 mb-3">Client — used for emailing drawings</div>
          <div className="grid grid-cols-2 gap-3">
            <MetaField label="Client name"  value={meta.clientName}  onChange={(v) => updateMeta({ clientName: v })} />
            <MetaField label="Client email" value={meta.clientEmail} onChange={(v) => updateMeta({ clientEmail: v })} type="email"/>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button onClick={onClose}
            className="px-4 py-2 bg-[#3FB7C9] text-[#08313a] rounded-md text-[10px] uppercase tracking-wider font-semibold hover:bg-[#52C4D5] transition">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function MetaField({ label, value, onChange, type = "text", span = 1 }) {
  return (
    <div style={{ gridColumn: span === 2 ? "1 / span 2" : "auto" }}>
      <div className="text-[9px] tracking-[0.2em] uppercase text-slate-500 mb-1.5">{label}</div>
      <input
        type={type} value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 text-sm bg-slate-50 rounded-lg ring-1 ring-slate-200 focus:ring-[#3FB7C9]/40 focus:bg-slate-100 focus:outline-none transition-all text-slate-900"
      />
    </div>
  );
}

/* ============================================================================
 * TITLE BLOCK EDITOR  (per-account template: detail lines + logos)
 * Set once here, applied to every drawing and synced via the account.
 * ========================================================================= */
export function TitleBlockEditor({ start, isCustomised, onSaveProject, onSaveDefault, onResetToDefault, onClose }) {
  const base = start || DEFAULT_TITLEBLOCK;
  const [details, setDetails] = React.useState(() =>
    (base.details && base.details.length ? base.details : DEFAULT_TITLEBLOCK.details).map(d => ({ ...d }))
  );
  const [logos, setLogos] = React.useState(() => [...(base.logos || [])]);
  const [alsoDefault, setAlsoDefault] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const fileRef = React.useRef(null);

  const addDetail = () => setDetails(d => [...d, { label: "", value: "" }]);
  const setDetail = (i, key, v) => setDetails(d => d.map((x, j) => (j === i ? { ...x, [key]: v } : x)));
  const removeDetail = (i) => setDetails(d => d.filter((_, j) => j !== i));

  const onPickLogos = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    for (const f of files) {
      try { const url = await resizeImageToDataUrl(f); setLogos(l => [...l, url]); }
      catch { setError("Couldn't read one of those images."); }
    }
  };
  const removeLogo = (i) => setLogos(l => l.filter((_, j) => j !== i));

  const save = async () => {
    setSaving(true); setError("");
    try {
      const tb = { details: details.filter(d => d.label || d.value), logos };
      onSaveProject?.(tb);                 // applies to THIS job only
      if (alsoDefault) await onSaveDefault?.(tb); // optional account default for new jobs
      onClose();
    } catch (err) {
      setError(err.message || "Couldn't save the default. Make sure the user_settings table exists.");
    } finally {
      setSaving(false);
    }
  };

  // The account default IS the company profile now, so what used to read as
  // "reset" is really "adopt my company details here". Drawings carrying their
  // own override predate the profile and cannot otherwise pick it up.
  // Confirmed, because that override may hold details typed for this job alone.
  const useCompanyDetails = () => {
    if (!window.confirm("Use your company details on this drawing? The title block details saved for this job will be replaced.")) return;
    onResetToDefault?.();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
           className="bg-white rounded-2xl ring-1 ring-slate-200 w-full max-w-2xl max-h-[88vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <div className="text-[10px] tracking-[0.3em] uppercase text-slate-500">Title block</div>
            <div className="text-base font-semibold mt-0.5 text-slate-900">This job&rsquo;s title block</div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md"><X size={16}/></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <p className="text-[12px] text-slate-500 -mt-1">These details and logos appear on this drawing and its PDF. They apply to <span className="font-semibold text-slate-700">this job only</span> — other projects keep their own. Project, sheet, scale, date, drawing number and revision stay editable per drawing.</p>

          {/* Only for drawings that carry their own override -- on anything
            * else there is nothing to replace, so it is not shown. */}
          {isCustomised && onResetToDefault && (
            <div className="rounded-xl ring-1 ring-[#2C97A8]/35 bg-[#2C97A8]/10 px-4 py-3.5">
              <div className="text-[12px] font-semibold text-slate-800">This drawing has its own title block</div>
              <div className="text-[11.5px] text-slate-500 mt-0.5 mb-3">It was set for this job, so it ignores the company details on your account.</div>
              <button onClick={useCompanyDetails}
                className="flex items-center gap-2 px-3.5 py-2 rounded-md bg-[#2C97A8] hover:bg-[#35A9BC] text-[#1A2530] text-[10px] uppercase tracking-wider font-semibold transition-colors">
                <Building2 size={14} className="text-[#1A2530] shrink-0"/> Use my company details on this drawing
              </button>
            </div>
          )}

          {/* Logos */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] tracking-[0.2em] uppercase text-slate-500">Logos</div>
              <button onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] uppercase tracking-wide font-semibold rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200">
                <ImagePlus size={13}/> Add logo
              </button>
              <input ref={fileRef} type="file" accept="image/*" multiple onChange={onPickLogos} className="hidden"/>
            </div>
            {logos.length === 0 ? (
              <div className="text-[12px] text-slate-400 italic py-3 px-3 rounded-lg bg-slate-50 ring-1 ring-slate-200">No logos yet — add your company and accreditation logos.</div>
            ) : (
              <div className="flex flex-wrap gap-3">
                {logos.map((src, i) => (
                  <div key={i} className="relative group rounded-lg ring-1 ring-slate-200 bg-slate-50 p-2 flex items-center justify-center" style={{ height: 56 }}>
                    <img src={src} alt="" style={{ height: 40, width: "auto", maxWidth: 120, objectFit: "contain" }}/>
                    <button onClick={() => removeLogo(i)} title="Remove"
                      className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-white ring-1 ring-slate-300 text-slate-500 hover:text-red-600 hover:ring-red-300 flex items-center justify-center shadow-sm">
                      <X size={11}/>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Detail lines */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] tracking-[0.2em] uppercase text-slate-500">Details</div>
              <button onClick={addDetail}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] uppercase tracking-wide font-semibold rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200">
                <Plus size={13}/> Add line
              </button>
            </div>
            <div className="space-y-2">
              {details.map((d, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={d.label} onChange={(e) => setDetail(i, "label", e.target.value)} placeholder="Label (e.g. Tel)"
                    className="w-40 px-3 py-2 text-sm bg-slate-50 rounded-lg ring-1 ring-slate-200 focus:ring-[#3FB7C9]/40 focus:outline-none text-slate-900"/>
                  <input value={d.value} onChange={(e) => setDetail(i, "value", e.target.value)} placeholder="Value"
                    className="flex-1 px-3 py-2 text-sm bg-slate-50 rounded-lg ring-1 ring-slate-200 focus:ring-[#3FB7C9]/40 focus:outline-none text-slate-900"/>
                  <button onClick={() => removeDetail(i)} title="Remove"
                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md shrink-0"><Trash2 size={14}/></button>
                </div>
              ))}
              {details.length === 0 && (
                <div className="text-[12px] text-slate-400 italic">No detail lines — add your company name, address, phone, email, registration…</div>
              )}
            </div>
            <div className="text-[11px] text-slate-400 mt-2">The first line shows largest, as your company name.</div>
          </div>

          {error && <div className="text-[12px] text-red-600 bg-red-50 ring-1 ring-red-200 rounded-lg px-3 py-2">{error}</div>}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-3">
          <label className="flex items-center gap-2 text-[12px] text-slate-600 cursor-pointer select-none mr-auto">
            <input type="checkbox" checked={alsoDefault} onChange={(e) => setAlsoDefault(e.target.checked)}
              className="w-4 h-4 rounded accent-[#3FB7C9]"/>
            Also save as my default for new jobs
          </label>
          <button onClick={onClose} className="px-4 py-2 text-[10px] uppercase tracking-wider font-semibold rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200">Cancel</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 bg-[#3FB7C9] text-[#08313a] rounded-md text-[10px] uppercase tracking-wider font-semibold hover:bg-[#52C4D5] transition disabled:opacity-60">
            {saving ? "Saving…" : "Apply to this job"}
          </button>
        </div>
      </div>
    </div>
  );
}


/* ============================================================================
 * PRINT PREVIEW
 * Renders a clean copy of the sheet at 1:1, full-screen,
 * with the rest of the app hidden via the print stylesheet.
 * ========================================================================= */
// ---------------------------------------------------------------------------
// Vector-symbol export helpers. The print DOM already renders every symbol as
// real SVG (tagged data-sym-glyph); we read its shapes + resolved colours
// straight from the DOM and hand them to the pdf-lib engine, so the export
// never has to rasterise symbols (which is what crashed iPad and shifted them).
// ---------------------------------------------------------------------------
function cssColorToHex(c) {
  if (!c || c === "none" || c === "transparent") return null;
  if (c[0] === "#") return c;
  const m = c.match(/rgba?\(([^)]+)\)/i);
  if (!m) return null;
  const parts = m[1].split(",").map((s) => parseFloat(s));
  if (parts.length >= 4 && parts[3] === 0) return null; // fully transparent
  const [r, g, b] = parts;
  const hx = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

function parseGroupTransform(str) {
  const out = { tx: 0, ty: 0, rot: 0 };
  if (!str) return out;
  const t = str.match(/translate\(\s*([-\d.]+)[ ,]+([-\d.]+)/);
  if (t) { out.tx = parseFloat(t[1]); out.ty = parseFloat(t[2]); }
  const r = str.match(/rotate\(\s*([-\d.]+)/);
  if (r) out.rot = parseFloat(r[1]);
  return out;
}

// Walk a glyph <svg> and turn its primitive children into engine prims.
function glyphToPrims(glyphEl) {
  const prims = [];
  const nodes = glyphEl.querySelectorAll("path, line, rect, circle, polyline, polygon, text");
  nodes.forEach((el) => {
    const cs = window.getComputedStyle(el);
    const fill = cssColorToHex(cs.fill);
    const stroke = cssColorToHex(cs.stroke);
    if (!fill && !stroke) return;
    const strokeWidth = parseFloat(cs.strokeWidth) || 1.5;
    let dash = null;
    if (cs.strokeDasharray && cs.strokeDasharray !== "none") {
      dash = cs.strokeDasharray.split(/[ ,]+/).map((n) => parseFloat(n)).filter((n) => !isNaN(n));
      if (!dash.length) dash = null;
    }
    const tag = el.tagName.toLowerCase();
    const fo = parseFloat(cs.fillOpacity);
    const so = parseFloat(cs.strokeOpacity);
    const base = {
      fill, stroke, strokeWidth, strokeDasharray: dash,
      fillOpacity: Number.isFinite(fo) ? fo : 1,
      strokeOpacity: Number.isFinite(so) ? so : 1,
    };
    const num = (a) => parseFloat(el.getAttribute(a)) || 0;
    if (tag === "path") prims.push({ ...base, kind: "path", d: el.getAttribute("d") || "" });
    else if (tag === "line") prims.push({ ...base, kind: "line", x1: num("x1"), y1: num("y1"), x2: num("x2"), y2: num("y2") });
    else if (tag === "rect") prims.push({ ...base, kind: "rect", x: num("x"), y: num("y"), w: num("width"), h: num("height"), rx: num("rx"), ry: num("ry") });
    else if (tag === "circle") prims.push({ ...base, kind: "circle", cx: num("cx"), cy: num("cy"), r: num("r") });
    else if (tag === "text") {
      // Read the attributes, not the computed style: font-size resolves in the
      // element's own user units here, and the attribute is what the symbol
      // library actually authored. No symbol sets dominant-baseline, so the
      // y attribute is the baseline, which is what pdf-lib wants.
      const weight = parseInt(el.getAttribute("font-weight") || cs.fontWeight, 10) || 400;
      prims.push({
        ...base,
        kind: "text",
        text: el.textContent || "",
        x: num("x"), y: num("y"),
        fontSize: parseFloat(el.getAttribute("font-size")) || parseFloat(cs.fontSize) || 6,
        anchor: el.getAttribute("text-anchor") || cs.textAnchor || "start",
        bold: weight >= 600,
      });
    }
    else if (tag === "polyline" || tag === "polygon") {
      const pts = (el.getAttribute("points") || "").trim().split(/\s+/).map((p) => p.split(",").map(Number)).filter((p) => p.length === 2);
      prims.push({ ...base, kind: tag, points: pts });
    }
  });
  return prims;
}

// Build a placement job (in PDF points) for one glyph element.
function glyphToJob(glyphEl, DRAW, sx, sy, PAGE_H) {
  const size = parseFloat(glyphEl.getAttribute("width")) || 0;
  if (!size) return null;
  const g = glyphEl.parentNode; // the <g> carrying translate()/rotate()
  const { tx, ty, rot } = parseGroupTransform(g && g.getAttribute ? g.getAttribute("transform") : "");
  const half = size / 2;
  const localX = tx + half, localY = ty + half;      // symbol centre in DRAW space
  const cx = (DRAW.x + localX) * sx;                  // → PDF points
  const cy = PAGE_H - (DRAW.y + localY) * sy;         // pdf-lib is bottom-left
  return { prims: glyphToPrims(glyphEl), cx, cy, size: size * sx, rotationDeg: rot };
}

export function PrintPreview({ project, legendItems, colourMode, symbolScale = 1, DRAW, onClose, onPrint }) {
  const { meta, notes } = project;
  const sheets = project.sheets && project.sheets.length
    ? project.sheets
    : [{ id: "legacy", name: meta.sheetName, drawingNumber: meta.drawingNumber,
         bgImage: project.bgImage, placed: project.placed || [], wires: project.wires || [], annotations: project.annotations || [] }];

  const [mounted, setMounted] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [zoom, setZoom] = useState(1);
  const pointers = useRef(new Map());
  const pinch = useRef(null);

  // Fit the large A3 page to the screen width — essential on iPad, where the
  // page is far wider than the viewport. Also reused by the "Fit" button.
  const fitWidth = () => {
    const avail = (typeof window !== "undefined" ? window.innerWidth : SHEET.width) - 28;
    setZoom(Math.min(1, Math.max(0.18, avail / SHEET.width)));
  };
  const adjustZoom = (f) => setZoom(z => Math.min(2, Math.max(0.18, +(z * f).toFixed(3))));

  // Two-finger pinch to zoom the preview (one finger still scrolls).
  const onPagesPointerDown = (e) => {
    if (e.pointerType === "mouse") return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const p = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), zoom };
    }
  };
  const onPagesPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current && pinch.current.dist > 0) {
      const p = [...pointers.current.values()];
      const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      setZoom(Math.min(2, Math.max(0.18, pinch.current.zoom * (d / pinch.current.dist))));
      if (e.cancelable) e.preventDefault();
    }
  };
  const onPagesPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  useEffect(() => { setMounted(true); fitWidth(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fileBase = () => (meta.projectName || meta.plot || "drawing").replace(/[^a-z0-9-_]+/gi, "_");

  // One-click PDF.
  //
  // The plan itself is embedded as TRUE VECTOR — the original imported PDF page,
  // dropped straight into the output — so it stays razor-sharp at any zoom. No
  // raster ceiling, no iOS canvas-size cap (which is why bumping the screenshot
  // scale never helped: Safari silently clamps any canvas over ~16.7MP).
  //
  // Everything the app draws on top (symbols, wires, dimensions, title block,
  // notes, legend, borders) is captured as a TRANSPARENT overlay and laid over
  // the vector plan; the white "paper" is the PDF page itself. A sheet imported
  // as a plain image (no PDF source) falls back to a normal raster so it still
  // exports.
  const downloadPDF = async () => {
    setPdfBusy(true);
    // Declared out here, not inside the try: the finally restores them, and a
    // const scoped to the try block is not in scope there -- every export threw
    // a ReferenceError on the way out.
    let scaleEl = null;
    let savedScaleTransform = null;
    try {
      const [{ PDFDocument, StandardFonts, degrees, rgb }, h2cMod] = await Promise.all([import("pdf-lib"), import("html2canvas")]);
      const html2canvas = h2cMod.default;
      const pageEls = document.querySelectorAll("#print-root .print-page");
      // Preview is scaled to fit the screen (.pp-scale). html2canvas measures the
      // page THROUGH that transform, so at any zoom other than 100% the captured
      // plan lands at a different scale/offset than the symbols (which use
      // zoom-independent transforms). Neutralise it for the export, restore after.
      scaleEl = document.querySelector("#print-root .pp-scale");
      savedScaleTransform = scaleEl ? scaleEl.style.transform : null;
      if (scaleEl) scaleEl.style.transform = "none";
      if (!pageEls.length) { setPdfBusy(false); return; }

      // A3 landscape in PDF points (1mm = 72/25.4 pt). The SHEET fills the page.
      const MM = 72 / 25.4;
      const PAGE_W = 420 * MM; // 1190.55
      const PAGE_H = 297 * MM; // 841.89
      const sx = PAGE_W / SHEET.width;
      const sy = PAGE_H / SHEET.height;

      // The overlay now only carries symbols + app text (the plan is vector), so
      // a modest scale is sharp enough AND stays under the iOS canvas cap.
      const shotScale = isTouchDevice() ? 2 : 3;

      const out = await PDFDocument.create();

      // Embedded ONCE for the whole document, not per symbol. The symbol
      // library sets a generic sans stack and weight 600/700, so Helvetica and
      // Helvetica-Bold are the standard-font equivalents.
      const font = await out.embedFont(StandardFonts.Helvetica);
      const fontBold = await out.embedFont(StandardFonts.HelveticaBold);

      for (let i = 0; i < pageEls.length; i++) {
        const el = pageEls[i];
        const bg = (sheets[i] && sheets[i].bgImage) || null;
        const page = out.addPage([PAGE_W, PAGE_H]);

        // 1. Vector plan underlay — only if we still hold the source PDF.
        let vectorOK = false;
        const sheetLabel = `sheet ${i + 1}` + (sheets[i]?.name ? ` ("${sheets[i].name}")` : "");
        if (bg && bg.pdfSrc && bg.w && bg.h) {
          try {
            const res = await fetch(bg.pdfSrc);
            if (!res.ok) throw new Error(`original PDF download failed (HTTP ${res.status})`);
            const bytes = await res.arrayBuffer();
            const idx = Math.max(0, (bg.pdfPage || 1) - 1);
            const srcDoc = await PDFDocument.load(bytes);
            // Architect PDFs are commonly saved with a /Rotate flag. The on-screen
            // preview honours it, so the export must too — otherwise the plan comes
            // out turned and stretched and the symbols no longer line up.
            const rot = ((srcDoc.getPage(idx).getRotation().angle % 360) + 360) % 360;
            const [embedded] = await out.embedPdf(srcDoc, [idx]);
            // Displayed (rotation-applied) dimensions: what the preview shows and
            // what the symbols were positioned against.
            const swap = rot === 90 || rot === 270;
            const dw = swap ? embedded.height : embedded.width;
            const dh = swap ? embedded.width : embedded.height;
            // Contain inside DRAW, centred — the same helper as the on-screen plan,
            // so the vector underlay lands exactly where the raster preview did.
            const fp = planFootprint(DRAW, dw, dh);
            const pw = fp.w, ph = fp.h;
            const planX = DRAW.x + fp.x;
            const planY = DRAW.y + fp.y;
            const X = planX * sx;
            const Wt = pw * sx;
            const Ht = ph * sy;
            const Yb = PAGE_H - (planY + ph) * sy; // bottom of footprint (pdf-lib is bottom-left)
            // pdf-lib rotates a page about its (x,y) origin, so each /Rotate needs
            // its own origin offset. These four cases are verified against rendered
            // ground truth for 0 / 90 / 180 / 270.
            const place =
              rot === 90  ? { x: X,      y: Yb + Ht, width: Ht, height: Wt, rotate: degrees(-90) } :
              rot === 180 ? { x: X + Wt, y: Yb + Ht, width: Wt, height: Ht, rotate: degrees(180) } :
              rot === 270 ? { x: X + Wt, y: Yb,      width: Ht, height: Wt, rotate: degrees(90) } :
                            { x: X,      y: Yb,      width: Wt, height: Ht, rotate: degrees(0) };
            page.drawPage(embedded, place);
            vectorOK = true;
          } catch (err) {
            vectorOK = false; // any trouble → fall back to raster for this page
            // Say why, so a soft plan can be traced. Never log the URL: signed
            // links carry an access token.
            console.warn(`PDF export: ${sheetLabel} plan not embedded as vector —`, err?.name || "Error", err?.message || String(err));
          }
        } else if (bg) {
          console.warn(`PDF export: ${sheetLabel} has no original PDF (image, CAD sketch or older import), so its plan is exported as an image.`);
        }

        // 2. Overlay capture. When the plan is vector, hide the raster plan image
        //    and make the plan-area + sheet backgrounds transparent so the vector
        //    shows through; restore the DOM straight after.
        const planImg = el.querySelector('img[alt="plan"]');
        const planArea = el.querySelector('[data-plan-area]');
        const sheetRoot = el.firstElementChild;
        const saved = [];
        if (vectorOK) {
          // .print-page gets its white from the stylesheet; an inline override
          // beats it. The other two are inline whites stacked over the plan.
          saved.push([el, "background", el.style.background]); el.style.background = "transparent";
          if (planImg)   { saved.push([planImg, "visibility", planImg.style.visibility]); planImg.style.visibility = "hidden"; }
          if (planArea)  { saved.push([planArea, "background", planArea.style.background]); planArea.style.background = "transparent"; }
          if (sheetRoot) { saved.push([sheetRoot, "background", sheetRoot.style.background]); sheetRoot.style.background = "transparent"; }
        }

        // Symbols → true vector. Read each glyph's shapes + placement from the
        // DOM now, then HIDE the glyphs so html2canvas never rasterises them —
        // that raster of many symbols is what exhausts iOS Safari and crashes
        // the export. The symbols are redrawn as crisp vector below.
        const glyphEls = Array.from(el.querySelectorAll('[data-sym-glyph]'));
        const symbolJobs = [];
        for (const gEl of glyphEls) {
          const job = glyphToJob(gEl, DRAW, sx, sy, PAGE_H);
          if (job) symbolJobs.push(job);
          saved.push([gEl, "visibility", gEl.style.visibility]);
          gEl.style.visibility = "hidden";
        }

        let overlayCanvas;
        try {
          overlayCanvas = await html2canvas(el, {
            scale: shotScale,
            backgroundColor: vectorOK ? null : "#ffffff",
            useCORS: true,
            logging: false,
            width: el.offsetWidth,
            height: el.offsetHeight,
          });
        } finally {
          saved.forEach(([node, prop, val]) => { node.style[prop] = val || ""; });
        }

        const png = await out.embedPng(overlayCanvas.toDataURL("image/png"));
        page.drawImage(png, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });

        // Draw the symbols on top, as vector, exactly where they sit on screen.
        for (const job of symbolJobs) {
          // Never fail the whole export over one glyph -- but say so. This
          // catch silently hid every missing <text> for as long as they were
          // unsupported; the next unhandled tag should be noisy.
          try {
            drawSymbol(page, job, { rgb, degrees, font, fontBold });
          } catch (e) {
            console.warn("PDF export: skipped a symbol —", e && e.message, job && job.prims);
          }
        }
      }

      const bytes = await out.save();
      const blob = new Blob([bytes], { type: "application/pdf" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fileBase() + ".pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    } catch (e) {
      alert("PDF export failed: " + (e?.message || e));
    } finally {
      if (scaleEl) scaleEl.style.transform = savedScaleTransform;
      setPdfBusy(false);
    }
  };

  // Tucked-away backup: download the whole project as a re-importable file.
  const downloadBackup = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileBase() + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const emailClient = () => {
    const greeting = meta.clientName ? `Hi ${meta.clientName},` : "Hi,";
    const what = sheets.length > 1 ? `the electrical drawings (${sheets.length} floors)` : "the electrical drawing";
    const forWhat = meta.plot ? ` for ${meta.plot}` : (meta.projectName ? ` for ${meta.projectName}` : "");
    const body = [
      greeting,
      "",
      `Please find attached ${what}${forWhat}.`,
      "",
      "Any questions, just let me know.",
    ].join("\n");
    const subject = `Electrical drawings — ${meta.projectName || meta.plot || "your project"}`;
    const href = `mailto:${meta.clientEmail || ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = href;
  };

  const legendFor = (placed) => {
    const ids = new Set((placed || []).map(p => p.symbolId));
    return Array.from(ids).map(id => ({
      id, symbol: findSymbol(id),
      meta: SYMBOL_META[id] || { description: findSymbol(id)?.name || id, height: null },
    })).filter(x => x.symbol);
  };

  if (!mounted) return null;

  // Rendered as a direct child of <body> so it's clear of the editor's
  // overflow-hidden / fixed-height shell — that's what lets every sheet
  // print onto its own page instead of just the first.
  return createPortal(
    <div id="print-root">
      <div className="pp-chrome">
        <div>
          <div className="pp-eyebrow">Save / Print</div>
          <div className="pp-title">{meta.projectName || "Project"} · {sheets.length} {sheets.length === 1 ? "drawing" : "drawings"}</div>
        </div>
        <div className="pp-actions">
          <div className="pp-zoom">
            <button onClick={() => adjustZoom(1/1.2)} aria-label="Zoom out">−</button>
            <button onClick={fitWidth} aria-label="Fit to screen">Fit</button>
            <button onClick={() => adjustZoom(1.2)} aria-label="Zoom in">+</button>
          </div>
          <span className="pp-hint">Download the PDF, then attach it to your client email.</span>
          <button onClick={onClose} className="pp-btn pp-btn-ghost">Close</button>
          <button onClick={downloadBackup} className="pp-btn pp-btn-ghost" title="Download a re-importable backup of the whole project (.json)">Backup</button>
          <button onClick={emailClient} className="pp-btn pp-btn-email"><Mail size={12}/> Email client</button>
          <button onClick={onPrint} className="pp-btn pp-btn-email"><Printer size={12}/> Print</button>
          <button onClick={downloadPDF} disabled={pdfBusy} className="pp-btn pp-btn-primary" style={pdfBusy ? { opacity: 0.6, cursor: "wait" } : undefined}>
            <Download size={12}/> {pdfBusy ? "Building…" : "Download PDF"}
          </button>
        </div>
      </div>

      <div className="pp-pages"
           onPointerDown={onPagesPointerDown}
           onPointerMove={onPagesPointerMove}
           onPointerUp={onPagesPointerUp}
           onPointerCancel={onPagesPointerUp}
           style={{ touchAction: "pan-x pan-y" }}>
        <div className="pp-scale" style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}>
          {sheets.map((s) => (
            <div key={s.id} className="print-page">
              <PrintSheet
                meta={{ ...meta, sheetName: s.name, drawingNumber: s.drawingNumber || meta.drawingNumber }}
                notes={s.notes || notes}
                bgImage={s.bgImage}
                placed={s.placed} wires={s.wires} annotations={s.annotations}
                legendItems={legendFor(s.placed)}
                colourMode={colourMode}
                symbolScale={typeof s.symbolScale === "number" ? s.symbolScale : symbolScale}
                DRAW={DRAW}
              />
            </div>
          ))}
        </div>
      </div>

      <style>{`
        #print-root{position:fixed; inset:0; z-index:60; background:rgba(15,23,42,.5); overflow:auto; font-family:'Inter',system-ui,sans-serif}
        #print-root .pp-chrome{position:sticky; top:0; z-index:2; background:#fff; border-bottom:1px solid #e2e8f0; padding:12px 20px; display:flex; align-items:center; justify-content:space-between; gap:16px}
        #print-root .pp-eyebrow{font-size:10px; letter-spacing:.3em; text-transform:uppercase; color:#64748b}
        #print-root .pp-title{font-size:14px; font-weight:600; margin-top:2px; color:#0f172a}
        #print-root .pp-actions{display:flex; align-items:center; gap:12px}
        #print-root .pp-hint{font-size:10px; color:#64748b}
        #print-root .pp-hint b{color:#0f172a}
        /* One treatment for every button in this bar, matching the editor toolbar
           and the dashboard nav: neutral at rest, solid teal with a dark navy
           label on hover. The -ghost / -email / -primary classes are kept on the
           markup but all share this now, so the bar reads as one set. */
        #print-root .pp-btn{display:flex; align-items:center; gap:6px; padding:7px 14px; border-radius:7px; font-size:10px; letter-spacing:.08em; text-transform:uppercase; font-weight:600; border:none; cursor:pointer; background:#f1f5f9; color:#1e293b; transition:background .15s ease, color .15s ease}
        #print-root .pp-btn:hover:not(:disabled){background:#2C97A8; color:#1A2530}
        #print-root .pp-pages{display:flex; flex-direction:column; align-items:center; padding:32px}
        #print-root .pp-scale{display:flex; flex-direction:column; align-items:center; gap:32px; will-change:transform}
        #print-root .pp-zoom{display:flex; align-items:center; gap:2px; background:#f1f5f9; border-radius:7px; padding:2px}
        #print-root .pp-zoom button{min-width:30px; height:28px; border:none; background:transparent; color:#1e293b; font-size:14px; font-weight:700; border-radius:5px; cursor:pointer; padding:0 6px}
        #print-root .pp-zoom button:hover{background:#e2e8f0}
        #print-root .print-page{width:${SHEET.width}px; height:${SHEET.height}px; background:#fff; box-shadow:0 20px 50px -10px rgba(0,0,0,.5); flex:none}

        @media print {
          @page { size: A3 landscape; margin: 0; }
          html, body { background:#fff !important; }
          body > div:not(#print-root){ display:none !important; }
          #print-root{ position:static !important; inset:auto !important; background:#fff !important; overflow:visible !important; }
          #print-root .pp-chrome{ display:none !important; }
          #print-root .pp-pages{ display:block !important; padding:0 !important; gap:0 !important; }
          #print-root .pp-scale{ transform:none !important; display:block !important; gap:0 !important; }
          #print-root .print-page{
            box-shadow:none !important;
            width:${SHEET.width}px !important; height:${SHEET.height}px !important;
            overflow:hidden;
            page-break-after:always; break-after:page;
          }
          #print-root .print-page:last-child{ page-break-after:auto; break-after:auto; }
          #print-root .print-page *{ -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
        }
      `}</style>
    </div>,
    document.body
  );
}

// A non-interactive version of the Sheet used by Print Preview.
function PrintSheet({ meta, notes, bgImage, placed, wires, annotations, legendItems, colourMode, symbolScale = 1, DRAW }) {
  return (
    <div style={{
      width: SHEET.width, height: SHEET.height,
      background: "#ffffff", color: "#0a0a0a",
      position: "relative",
      fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
    }}>
      <div style={{
        position: "absolute",
        left: SHEET.margin, top: SHEET.margin,
        width: SHEET.width - SHEET.margin*2,
        height: SHEET.height - SHEET.margin*2,
        border: "1px solid #0a0a0a",
      }}/>
      <LegendColumnStatic legendItems={legendItems} colourMode={colourMode} />
      <NotesColumnStatic notes={notes} />
      <DrawingAreaStatic
        DRAW={DRAW}
        bgImage={bgImage}
        placed={placed} wires={wires} annotations={annotations}
        colourMode={colourMode}
        symbolScale={symbolScale}
      />
      <TitleBlockStatic meta={meta} />
    </div>
  );
}

function LegendColumnStatic({ legendItems, colourMode }) {
  return (
    <div style={{
      position: "absolute",
      left: SHEET.margin, top: SHEET.margin,
      width: SHEET.legendWidth,
      height: SHEET.height - SHEET.margin * 2 - SHEET.titleHeight - 8,
      borderRight: "1px solid #0a0a0a",
      padding: "12px 12px 12px 14px",
    }}>
      <SheetColumnHeader padL={14} padR={12} padT={12}>Electrical Legend</SheetColumnHeader>
      <div style={{ fontSize: 8.5, color: "#404040", marginBottom: 10, letterSpacing: "0.06em" }}>
        UK ARCHITECTURAL · TO BE READ IN COLOUR
      </div>
      {legendItems.map(({ id, symbol, meta }) => {
        const cols = resolveColours(id, colourMode);
        return (
          <div key={id} style={{
            display: "grid", gridTemplateColumns: "26px 1fr",
            alignItems: "center", gap: 6, padding: "3px 0",
            borderBottom: "0.5px solid #e5e5e5",
          }}>
            <svg viewBox={VIEWBOX} width={22} height={22}
                 style={{ color: cols.body, "--feeder": cols.feeder }}>
              {symbol.svg}
            </svg>
            <div>
              <div style={{ fontSize: 9, fontWeight: 600, color: "#171717", lineHeight: 1.2 }}>
                {meta.description}
              </div>
              {meta.height && <div style={{ fontSize: 8, color: "#525252", marginTop: 1 }}>{meta.height}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function NotesColumnStatic({ notes }) {
  return (
    <div style={{
      position: "absolute",
      right: SHEET.margin, top: SHEET.margin,
      width: SHEET.notesWidth,
      height: SHEET.height - SHEET.margin * 2 - SHEET.titleHeight - 8,
      borderLeft: "1px solid #0a0a0a",
      padding: "12px 14px",
      overflow: "hidden",
    }}>
      <SheetColumnHeader padL={14} padR={14} padT={12}>Installation Notes</SheetColumnHeader>
      <div className="pw-notes" style={{ fontSize: 9, color: "#262626", lineHeight: 1.5 }}
           dangerouslySetInnerHTML={{ __html: notesToHtml(notes) }} />
    </div>
  );
}

function DrawingAreaStatic({ DRAW, bgImage, placed, wires, annotations, colourMode, symbolScale = 1 }) {
  const imageDisplay = useMemo(
    () => (bgImage ? planFootprint(DRAW, bgImage.w, bgImage.h) : null),
    [bgImage, DRAW.w, DRAW.h]
  );

  return (
    <div data-plan-area="" style={{
      position: "absolute",
      left: DRAW.x, top: DRAW.y, width: DRAW.w, height: DRAW.h,
      background: "#ffffff", border: "1px solid #0a0a0a", overflow: "hidden",
    }}>
      {bgImage && imageDisplay && (
        <img src={bgImage.src} alt="plan"
             style={{
               position: "absolute",
               left: imageDisplay.x, top: imageDisplay.y,
               width: imageDisplay.w, height: imageDisplay.h,
               display: "block",
             }}/>
      )}
      <svg width={DRAW.w} height={DRAW.h}
           style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
        {wires.map(w => {
          const a = placed.find(p => p.id === w.fromId);
          const b = placed.find(p => p.id === w.toId);
          if (!a || !b) return null;
          return (
            <line key={w.id}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={colourMode === "mono" ? "#0a0a0a" : "#dc2626"}
              strokeWidth={1.2} strokeDasharray="6 4" strokeLinecap="round"/>
          );
        })}
        {annotations.map(a => {
          const stroke = colourMode === "mono" ? "#0a0a0a" : "#dc2626";
          const dx = a.anchorX - a.x;
          const dy = a.anchorY - a.y;
          const len = Math.hypot(dx, dy);
          const ux = len > 0 ? dx / len : 0;
          const uy = len > 0 ? dy / len : 0;
          const startX = a.x + ux * 18;
          const startY = a.y + uy * 6;
          const ah = 6;
          const angle = Math.atan2(dy, dx);
          const ax1 = a.anchorX - ah * Math.cos(angle - Math.PI/7);
          const ay1 = a.anchorY - ah * Math.sin(angle - Math.PI/7);
          const ax2 = a.anchorX - ah * Math.cos(angle + Math.PI/7);
          const ay2 = a.anchorY - ah * Math.sin(angle + Math.PI/7);
          return (
            <g key={a.id}>
              <line x1={startX} y1={startY} x2={a.anchorX} y2={a.anchorY}
                    stroke={stroke} strokeWidth={1.3}/>
              <polygon points={`${a.anchorX},${a.anchorY} ${ax1},${ay1} ${ax2},${ay2}`} fill={stroke}/>
            </g>
          );
        })}
        {placed.map(item => {
          const sym = findSymbol(item.symbolId);
          if (!sym) return null;
          const itemScale = item.scale ?? 1;
          const itemSize = 48 * symbolScale * itemScale;
          const half = itemSize / 2;
          const cols = resolveColours(item.symbolId, colourMode);
          return (
            <g key={item.id}
               transform={`translate(${item.x - half} ${item.y - half}) rotate(${item.rotation} ${half} ${half})`}>
              <svg data-sym-glyph="" x={0} y={0} width={itemSize} height={itemSize} viewBox={VIEWBOX}
                   style={{ color: cols.body, "--feeder": cols.feeder, overflow: "visible" }}>
                {sym.svg}
              </svg>
              {item.label && (
                <text x={half} y={itemSize + 9} fontSize={9} textAnchor="middle"
                      fill="#171717" fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="600"
                      transform={`rotate(${-item.rotation} ${half} ${itemSize + 9})`}>
                  {item.label}
                </text>
              )}
            </g>
          );
        })}
        {annotations.map(a => {
          const stroke = colourMode === "mono" ? "#0a0a0a" : "#dc2626";
          const lines = a.text.split("\n").flatMap(line => wrapText(line, 22));
          const padding = 4;
          const lineHeight = 11;
          const textW = Math.max(60, ...lines.map(l => estimateWidth(l, 8.5)));
          const textH = lines.length * lineHeight + padding * 2 - 2;
          return (
            <g key={a.id + "-text"}>
              <rect
                x={a.x - textW/2 - padding}
                y={a.y - textH/2}
                width={textW + padding*2}
                height={textH}
                rx={3}
                fill="rgba(255,255,255,0.95)"
                stroke={stroke}
                strokeWidth={1}
                strokeDasharray="4 2.5"
              />
              {lines.map((line, i) => (
                <text
                  key={i}
                  x={a.x}
                  y={a.y - textH/2 + padding + lineHeight * (i + 1) - 2}
                  fontSize={8.5}
                  textAnchor="middle"
                  fill={stroke}
                  fontWeight={600}
                >{line}</text>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* The print sheet. Deliberately the SAME component as the working sheet --
 * html2canvas photographs this DOM for the PDF, so the two must not drift. */
function TitleBlockStatic({ meta }) {
  const tb = useProjectTitleBlock() || DEFAULT_TITLEBLOCK;
  return (
    <MastheadFrame>
      <Masthead tb={tb} meta={meta} />
    </MastheadFrame>
  );
}






