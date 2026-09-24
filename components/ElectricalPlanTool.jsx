"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Upload, Trash2, Save, FolderOpen, Download, Undo2, Redo2,
  MousePointer2, Cable, RotateCw, ZoomIn, ZoomOut, Maximize2,
  Palette, Ruler, Hand, Sparkles, Type, Printer, Settings,
  ChevronRight, X, FileText, Eye, EyeOff, Layers,
} from "lucide-react";
import { listProjects, getProjectData, insertProject, updateProjectRow, deleteProjectRow } from "@/lib/db";
import { uploadPlanImage, signPlanImages, deletePlanImages, dataUrlToBlob, blobToDataUrl } from "@/lib/planImages";
import { ensurePdfjs } from "@/lib/pdfjs";
import {
  SYMBOLS, SYMBOL_META, CATEGORY_COLOURS, VIEWBOX,
  findSymbol, findCategory, resolveColours,
} from "@/lib/symbols.jsx";
import { findFurniture, furnitureScale, FURNITURE_VIEWBOX, FURNITURE_COLOUR } from "@/lib/furniture.jsx";
import {
  TopBar, Palette as PalettePanel, Workspace, Inspector,
  FloatingToolbar, ZoomControls, MetaEditor, PrintPreview, BillOfQuantities,
  ProjectManager, SheetTabs, TitleBlockEditor, NotesEditor,
  ProjectTitleBlockContext,
} from "@/components/SheetParts";
import { useApp } from "@/components/AppShell";
import { DEFAULT_TITLEBLOCK } from "@/lib/titleBlock";
import dynamic from "next/dynamic";
const CadSketchPanel = dynamic(() => import("@/components/cad/CadSketch"), { ssr: false });
import { useEditor } from "@/store/editorStore";

/* ============================================================================
 * PLOTWIRE — Drawing production tool
 *
 * Sheet-based architecture: the workspace IS an A3 landscape drawing sheet.
 * The sheet contains:
 *   - Title block (project name, plot, sheet, scale, date, revision)
 *   - Legend column (auto-generated from symbols actually placed)
 *   - Notes panel (free-text MEP notes)
 *   - Drawing area (imported floor plan + symbols + annotations)
 *
 * Print/export uses the browser's native print-to-PDF for full fidelity.
 * ========================================================================= */

// Sheet dimensions — A3 landscape at 96 DPI (web standard)
const SHEET = {
  width: 1587,   // 420mm at 96dpi  (≈ 16.5")
  height: 1123,  // 297mm at 96dpi
  margin: 18,
  legendWidth: 230,
  notesWidth: 280,
  titleHeight: 110,
};

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 5;
const ZOOM_WHEEL_SPEED = 0.0015;

const DEFAULT_META = {
  projectName: "",
  plot: "",
  sheetName: "Ground Floor MEP Plan",
  scale: "1:50 @ A3",
  drawingNumber: "",
  date: new Date().toISOString().slice(0, 10),
  revision: "A",
  revNote: "First Issue",
  company: "",
  clientName: "",
  clientEmail: "",
};

const DEFAULT_NOTES_TEXT =
`FIXING HEIGHTS & LOCATION
Refer to Building Regulations Approved Document M for equipment mounting heights in all instances.

All switches & sockets in kitchen areas to be installed minimum 300mm clear of any adjacent sink, drainer or hob.

FIRE & SMOKE DETECTION
Dwelling to be provided with a fire detection and alarm system to Grade D2 Category LD3 standard, in accordance with BS 5839-6 (alarms in hallways and landings — circulation spaces and escape routes), plus alarms in kitchen and living room (high risk areas). Heat detection in kitchens and smoke detectors in circulation spaces.

IMPORTANT NOTE
The electrical layout provided is indicative only and to show locations of client required electrical items. Contractor to confirm all locations, runs and products with the client prior to purchase or installation of goods. All electrical works are to be carried out by a certified electrician and provide completion certificates. All works to be completed in accordance with BS 7671.`;

// Notes are a single free-text block per drawing. Convert any older saved
// format (array of {heading, body} sections) into plain text.
function notesToText(n) {
  if (typeof n === "string") return n;
  if (Array.isArray(n)) return n.map(s => [s.heading, s.body].filter(Boolean).join("\n")).join("\n\n");
  return DEFAULT_NOTES_TEXT;
}

const sid = () => "s_" + Math.random().toString(36).slice(2, 9);

// A sheet holds one drawing (one floor). bgImage = imported plan. Each sheet
// has its OWN editable free-text notes.
function freshSheet(name = "Ground floor") {
  return { id: sid(), name, drawingNumber: "", bgImage: null, placed: [], furniture: [], walls: [], wires: [], annotations: [], notes: DEFAULT_NOTES_TEXT, symbolScale: 1 };
}

// A project holds meta + drawings (sheets); notes live on each sheet.
function freshProject() {
  const sheet = freshSheet("Ground floor");
  return {
    meta: { ...DEFAULT_META, date: new Date().toISOString().slice(0, 10) },
    notes: DEFAULT_NOTES_TEXT,
    boq: null,
    titleBlock: null, // null = use the account default; set = job-specific
    colourMode: "red",     // new drawings start on PB Red; the toolbar palette
                           // button still cycles red -> mono -> navy -> colour
    sheets: [sheet],
    activeSheetId: sheet.id,
  };
}

// Bring any saved project (including old single-drawing ones) up to the
// multi-sheet shape without losing data.
function normaliseProject(p) {
  if (!p) return freshProject();
  const meta = { ...DEFAULT_META, ...(p.meta || {}) };
  const projNotesText = notesToText(p.notes);
  const seedNotes = (sn) => (sn != null && sn !== "" ? notesToText(sn) : projNotesText);
  if (Array.isArray(p.sheets) && p.sheets.length) {
    const sheets = p.sheets.map(s => ({
      id: s.id || sid(),
      name: s.name || "Drawing",
      drawingNumber: s.drawingNumber || "",
      bgImage: s.bgImage || null,
      placed: s.placed || [],
      furniture: s.furniture || [],
      walls: s.walls || [],
      wires: s.wires || [],
      annotations: s.annotations || [],
      notes: seedNotes(s.notes),
      symbolScale: typeof s.symbolScale === "number" ? s.symbolScale : 1,
    }));
    return { meta, notes: projNotesText, boq: p.boq || null, titleBlock: p.titleBlock || null, colourMode: p.colourMode || "colour", sheets, activeSheetId: sheets.find(s => s.id === p.activeSheetId) ? p.activeSheetId : sheets[0].id };
  }
  // Legacy flat project → wrap its drawing into a single sheet.
  const sheet = {
    id: sid(),
    name: meta.sheetName || "Ground floor",
    drawingNumber: meta.drawingNumber || "",
    bgImage: p.bgImage || null,
    placed: p.placed || [],
    furniture: p.furniture || [],
    walls: p.walls || [],
    wires: p.wires || [],
    annotations: p.annotations || [],
    notes: seedNotes(null),
    symbolScale: typeof p.symbolScale === "number" ? p.symbolScale : 1,
  };
  return { meta, notes: projNotesText, boq: p.boq || null, titleBlock: p.titleBlock || null, colourMode: p.colourMode || "colour", sheets: [sheet], activeSheetId: sheet.id };
}

// ---- Plan-image storage helpers --------------------------------------------
// The render source for a plan is always `bgImage.src`. Post-migration that src
// is a TRANSIENT signed/object URL; the durable reference is `bgImage.path`.
// These helpers keep base64 out of anything we persist (DB rows + local draft).

// All Storage paths referenced by a project (one per sheet that has an image).
function collectImagePaths(p) {
  return (p?.sheets || []).flatMap(s => [s?.bgImage?.path, s?.bgImage?.pdfPath]).filter(Boolean);
}

// JSON-safe copy for persistence: drop the transient `src` whenever the image
// lives in Storage (has a path). Legacy/offline base64 (no path) is kept so the
// plan is never lost — it migrates to Storage on the next successful save.
function stripTransientImages(p) {
  if (!p) return p;
  return {
    ...p,
    sheets: (p.sheets || []).map(s => {
      const bg = s.bgImage;
      if (bg && bg.path) { const { src, pdfSrc, ...rest } = bg; return { ...s, bgImage: rest }; }
      return s;
    }),
  };
}

// Mint signed URLs for every stored image and attach them as `src` for render.
async function hydrateImages(p) {
  const paths = collectImagePaths(p);
  if (!paths.length) return p;
  let urls;
  try { urls = await signPlanImages(paths); } catch { return p; }
  return {
    ...p,
    sheets: (p.sheets || []).map(s => {
      const bg = s.bgImage;
      if (!bg) return s;
      let nbg = bg;
      if (bg.path && urls.get(bg.path)) nbg = { ...nbg, src: urls.get(bg.path) };
      if (bg.pdfPath && urls.get(bg.pdfPath)) nbg = { ...nbg, pdfSrc: urls.get(bg.pdfPath) };
      return nbg === bg ? s : { ...s, bgImage: nbg };
    }),
  };
}

// If a sheet's original PDF exists only as a blob: link in this tab (its
// background upload failed), store it now so the plan can still export as
// vector. Best effort: the raster plan is what must not be lost.
async function storeTabOnlyPdf(bg) {
  if (bg.pdfPath || typeof bg.pdfSrc !== "string" || !bg.pdfSrc.startsWith("blob:")) return {};
  try {
    const pdf = await (await fetch(bg.pdfSrc)).blob();
    const { path: pdfPath } = await uploadPlanImage(pdf);
    return { pdfPath, pdfPage: bg.pdfPage || 1 };
  } catch (err) {
    console.warn("original PDF store on save failed (plan kept as image):", err?.message);
    return {};
  }
}

// Make a project safe to persist: migrate any legacy base64 image into Storage,
// then drop transient src. Returns the persist-ready project.
async function prepareProjectForSave(p) {
  const sheets = await Promise.all((p?.sheets || []).map(async (s) => {
    const bg = s.bgImage;
    if (!bg) return s;
    if (bg.path) { const { src, pdfSrc, ...rest } = bg; return { ...s, bgImage: rest }; }
    if (typeof bg.src === "string" && bg.src.startsWith("data:")) {
      try {
        const { path } = await uploadPlanImage(dataUrlToBlob(bg.src));
        return { ...s, bgImage: { path, w: bg.w, h: bg.h, ...(await storeTabOnlyPdf(bg)) } };
      } catch (err) {
        console.warn("image migrate-on-save failed; keeping inline:", err?.message);
        return s; // keep base64 rather than lose the plan
      }
    }
    // A blob: URL with no path means the background upload never succeeded (the
    // caller has already waited for it). The blob is still readable in this
    // tab, so store it now. If even that fails, refuse the save: storing the
    // drawing without its plan would lose the plan for good on reopen.
    if (typeof bg.src === "string" && bg.src.startsWith("blob:")) {
      try {
        const blob = await (await fetch(bg.src)).blob();
        const { path } = await uploadPlanImage(blob);
        return { ...s, bgImage: { path, w: bg.w, h: bg.h, ...(await storeTabOnlyPdf(bg)) } };
      } catch (err) {
        console.warn("plan upload on save failed:", err?.message);
        throw new Error("The plan image couldn't be stored, so the drawing wasn't saved. Check your connection and try again.");
      }
    }
    return s;
  }));
  return { ...p, sheets };
}

// After a save, copy any newly-minted paths back onto in-memory sheets while
// keeping their working display `src`, so subsequent saves/drafts stay tiny.
function mergeSavedPaths(current, safe) {
  const byId = new Map((safe?.sheets || []).map(s => [s.id, s.bgImage]));
  return {
    ...current,
    sheets: (current?.sheets || []).map(s => {
      const safeBg = byId.get(s.id);
      if (safeBg && safeBg.path && s.bgImage && !s.bgImage.path) {
        const pdf = safeBg.pdfPath && !s.bgImage.pdfPath ? { pdfPath: safeBg.pdfPath, pdfPage: safeBg.pdfPage } : {};
        return { ...s, bgImage: { ...s.bgImage, path: safeBg.path, ...pdf } };
      }
      return s;
    }),
  };
}

// For the local crash-recovery draft: ALWAYS drop the heavy image bytes
// (base64 / blob / signed url), keeping only lightweight metadata (path + size).
// The draft only needs to preserve WORK — placed items, notes, walls, lines —
// so it must stay a few KB and never blow the browser's localStorage quota.
// (A freshly-imported plan has no `path` yet, so stripTransientImages above
// wouldn't strip it — which silently broke the whole safety net.)
function stripImagesForDraft(p) {
  if (!p) return p;
  return {
    ...p,
    sheets: (p.sheets || []).map(s => {
      if (!s.bgImage) return s;
      const { src, pdfSrc, ...rest } = s.bgImage;
      return { ...s, bgImage: rest };
    }),
  };
}

// Tool definitions
const TOOLS = {
  select: { icon: MousePointer2, label: "Select", hint: "V" },
  pan:    { icon: Hand,          label: "Pan",    hint: "H" },
  wire:   { icon: Cable,         label: "Wire",   hint: "W" },
  note:   { icon: Type,          label: "Note",   hint: "N" },
};

// ============================================================================
export default function ElectricalPlanTool({ initialTarget = null, onHome = null, theme = "light", onToggleTheme = null, onProjectId = null, onOpenFloorPlan = null }) {
  // Project state
  const project = useEditor(s => s.project);
  const setProject = useEditor(s => s.setProject);
  const { meta, sheets, activeSheetId } = project;
  const activeSheet = sheets.find(s => s.id === activeSheetId) || sheets[0];
  const { bgImage, placed, wires, annotations, notes } = activeSheet;
  const furniture = activeSheet.furniture || [];
  const walls = activeSheet.walls || [];
  // Refs so async image uploads target the right sheet even if the user has
  // since switched floors.
  const activeSheetIdRef = useRef(project.activeSheetId);
  activeSheetIdRef.current = project.activeSheetId;
  const sheetsRef = useRef(project.sheets);
  sheetsRef.current = project.sheets;

  // Title block: per-project, falling back to the account default for new jobs.
  const { titleBlock: accountTitleBlock, saveTitleBlock } = useApp();
  const effectiveTitleBlock = project.titleBlock || accountTitleBlock || DEFAULT_TITLEBLOCK;

  // Drawing-level fields live on the active sheet; everything else on the project.
  const DRAW_FIELDS = ["bgImage", "placed", "furniture", "walls", "wires", "annotations", "notes"];
  // Patch the project. Any drawing fields in the patch are routed into the
  // currently active sheet, so all existing handlers keep working unchanged.
  const updateProject = useCallback((patch) => {
    setProject(p => {
      const sheetPatch = {}; const projPatch = {};
      for (const k in patch) {
        if (DRAW_FIELDS.includes(k)) sheetPatch[k] = patch[k];
        else projPatch[k] = patch[k];
      }
      let next = { ...p, ...projPatch };
      if (Object.keys(sheetPatch).length) {
        next.sheets = p.sheets.map(s => s.id === p.activeSheetId ? { ...s, ...sheetPatch } : s);
      }
      return next;
    });
  }, []);
  const updateMeta = useCallback((patch) => {
    setProject(p => ({ ...p, meta: { ...p.meta, ...patch } }));
  }, []);
  // Patch a specific sheet by id (used by async image uploads that must land on
  // the sheet they started on, not whichever is active when they finish).
  const patchSheetById = useCallback((id, patch) => {
    setProject(p => ({ ...p, sheets: p.sheets.map(s => s.id === id ? { ...s, ...patch } : s) }));
  }, []);

  // Plan uploads still in flight, by sheet id: { displayUrl, done }, where
  // `done` resolves to the bgImage the upload settled on (null if it failed).
  // Every save waits on these first, so a drawing saved straight after an
  // import still carries its plan's stored path instead of a blob: link that
  // dies with the tab.
  const planUploadsRef = useRef(new Map());
  const [finishingUpload, setFinishingUpload] = useState(false);

  // The single way a project is made ready to persist.
  const readyToSave = useCallback(async (p) => {
    const pending = [...planUploadsRef.current.entries()];
    if (pending.length) {
      setFinishingUpload(true);
      try {
        const settled = new Map(await Promise.all(
          pending.map(async ([sheetId, upload]) => [sheetId, { upload, bg: await upload.done }])
        ));
        p = {
          ...p,
          sheets: (p.sheets || []).map(s => {
            const r = settled.get(s.id);
            // Only where this snapshot still shows the plan that was uploading.
            if (r && r.bg && s.bgImage && s.bgImage.src === r.upload.displayUrl) {
              return { ...s, bgImage: r.bg };
            }
            return s;
          }),
        };
      } finally {
        setFinishingUpload(false);
      }
    }
    return prepareProjectForSave(p);
  }, []);
  const updateBoq = useCallback((boq) => {
    setProject(p => ({ ...p, boq }));
  }, []);
  // Patch arbitrary fields (name, drawingNumber, …) on the active sheet.
  const setActiveSheet = useCallback((patch) => {
    setProject(p => ({ ...p, sheets: p.sheets.map(s => s.id === p.activeSheetId ? { ...s, ...patch } : s) }));
  }, []);

  // UI state
  const selection = useEditor(s => s.selection);
  const selectedId = selection?.kind === "symbol" ? selection.id : null;
  const selectedFurnId = selection?.kind === "furniture" ? selection.id : null;
  const selectedWallId = selection?.kind === "wall" ? selection.id : null;
  const selectedAnnoId = selection?.kind === "annotation" ? selection.id : null;
  const selectedWireId = selection?.kind === "wire" ? selection.id : null;
  const setSelectedId = useEditor(s => s.setSelectedId);
  const setSelectedFurnId = useEditor(s => s.setSelectedFurnId);
  const setSelectedWallId = useEditor(s => s.setSelectedWallId);
  const setSelectedAnnoId = useEditor(s => s.setSelectedAnnoId);
  const setSelectedWireId = useEditor(s => s.setSelectedWireId);
  const tool = useEditor(s => s.tool);
  const setTool = useEditor(s => s.setTool);
  const [wireStart, setWireStart] = useState(null);
  const zoom = useEditor(s => s.zoom);
  const setZoom = useEditor(s => s.setZoom);
  const pan = useEditor(s => s.pan);
  const setPan = useEditor(s => s.setPan);
  const [draggingPlacedId, setDraggingPlacedId] = useState(null);
  const [draggingFurnId, setDraggingFurnId] = useState(null);
  const [draggingAnno, setDraggingAnno] = useState(null); // { id, mode: 'body' | 'anchor' }
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [rotatingId, setRotatingId] = useState(null);
  const [rotatingFurnId, setRotatingFurnId] = useState(null);
  const [resizingFurnId, setResizingFurnId] = useState(null);
  // Wall tool state. wallDraft = the in-progress polyline; wallCursor = the
  // snapped pointer position for the rubber-band preview.
  const WALL_THICKNESS = { external: 16, internal: 10 };
  const [wallType, setWallType] = useState("external");
  const [wallDraft, setWallDraft] = useState(null);   // { points:[{x,y}], type }
  const [wallCursor, setWallCursor] = useState(null); // { x, y }
  const [activeCategory, setActiveCategory] = useState("sockets");
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const [pdfLoading, setPdfLoading] = useState(false);
  const symbolScale = activeSheet.symbolScale ?? 1;
  const setSymbolScale = (v) => setActiveSheet({ symbolScale: v });
  const colourMode = project.colourMode || "colour";
  const [isPanning, setIsPanning] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const [draggingFile, setDraggingFile] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [normaliseFlash, setNormaliseFlash] = useState(false);
  const [showMeta, setShowMeta] = useState(false);     // metadata edit modal
  const [printPreview, setPrintPreview] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [inspectorHidden, setInspectorHidden] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(false); // grid lines + snap to grid (off by default; toggle via Grid button)
  const [showBoq, setShowBoq] = useState(false);        // bill of quantities modal
  const [showTitleBlock, setShowTitleBlock] = useState(false); // title block template editor
  const [showNotes, setShowNotes] = useState(false);    // notes editor modal
  const [showProjects, setShowProjects] = useState(false); // project manager modal
  const [projectList, setProjectList] = useState([]);   // saved projects index
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [floorPlanOpen, setFloorPlanOpen] = useState(false);
  const [floorPlanArgs, setFloorPlanArgs] = useState(null);

  // Grid size in drawing units; symbols snap to multiples of this. Smaller =
  // more squares / finer placement (better for spacing out lighting).
  const GRID = 12;
  const snap = useCallback(
    (v) => (snapEnabled ? Math.round(v / GRID) * GRID : v),
    [snapEnabled]
  );

  // Refs
  const viewportRef = useRef(null);   // the dark workspace that holds the sheet
  const fileInputRef = useRef(null);
  const drawingAreaRef = useRef(null); // the SVG drawing area inside the sheet
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Multi-touch pinch-to-zoom tracking
  const pointersRef = useRef(new Map());   // pointerId -> {x,y}
  const pinchRef = useRef(null);           // active pinch baseline
  const pinchActiveRef = useRef(false);
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  const panRef = useRef(pan); panRef.current = pan;
  const sheetTransformRef = useRef(null);  // the pan/zoom <div>, driven imperatively during pinch
  const livePinchRef = useRef(null);       // latest pinch {zoom,panX,panY}; committed to state on release

  // ---------- Drawing area geometry ----------
  // The drawing area occupies the centre of the sheet, bounded by margins,
  // legend column, notes column, and title block.
  const DRAW = useMemo(() => ({
    x: SHEET.margin + SHEET.legendWidth + 8,
    y: SHEET.margin,
    w: SHEET.width - SHEET.margin * 2 - SHEET.legendWidth - SHEET.notesWidth - 16,
    h: SHEET.height - SHEET.margin * 2 - SHEET.titleHeight - 8,
  }), []);

  // ---------- Undo / Redo ----------
  const snapshot = useCallback(() => {
    setHistory(h => [...h.slice(-49), { placed, wires, annotations, furniture, walls }]);
    setFuture([]);
  }, [placed, wires, annotations, furniture, walls]);

  const undo = () => {
    setHistory(h => {
      if (!h.length) return h;
      const prev = h[h.length - 1];
      setFuture(f => [{ placed, wires, annotations, furniture, walls }, ...f].slice(0, 50));
      updateProject(prev);
      return h.slice(0, -1);
    });
  };
  const redo = () => {
    setFuture(f => {
      if (!f.length) return f;
      const next = f[0];
      setHistory(h => [...h, { placed, wires, annotations, furniture, walls }].slice(-50));
      updateProject(next);
      return f.slice(1);
    });
  };

  // ---------- Sheets (floors) ----------
  const switchSheet = useCallback((id) => {
    setProject(p => ({ ...p, activeSheetId: id }));
    setSelectedId(null); setSelectedAnnoId(null); setWireStart(null);
    setHistory([]); setFuture([]);
    setTimeout(fitToScreen, 60);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addSheet = useCallback(() => {
    setProject(p => {
      const n = p.sheets.length + 1;
      const name = n === 2 ? "First floor" : `Drawing ${n}`;
      const s = freshSheet(name);
      return { ...p, sheets: [...p.sheets, s], activeSheetId: s.id };
    });
    setSelectedId(null); setSelectedAnnoId(null); setWireStart(null);
    setHistory([]); setFuture([]);
    setTimeout(fitToScreen, 60);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Renaming a drawing tab persists straight away, so a tab renamed on a tablet
  // survives the drawing being closed without the user thinking to hit Save.
  // Same on-the-spot save as applyFloorPlan below: patch state, then write the
  // whole project to its existing row. A drawing that has never been saved has
  // no row yet, so it just keeps the name in state until the first Save.
  const renameSheet = useCallback(async (id, name) => {
    let updated = null;
    setProject(p => {
      const current = p.sheets.find(s => s.id === id);
      if (!current || current.name === name) return p; // no change -- no write
      updated = { ...p, sheets: p.sheets.map(s => s.id === id ? { ...s, name } : s) };
      return updated;
    });
    if (currentProjectIdRef.current && updated) {
      try {
        const safe = await readyToSave(updated);
        await updateProjectRow(currentProjectIdRef.current, updated.meta?.projectName || "Untitled drawing", safe);
        setProject(prev => mergeSavedPaths(prev, safe));
        // Same confirmation the Save button gives, so the rename visibly sticks.
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 1500);
      } catch (err) {
        // Keep the new name on screen -- it is still in state and goes up with
        // the next Save; only the immediate write failed.
        console.error("Rename save failed:", err);
      }
    }
  }, []);

  const deleteSheet = useCallback((id) => {
    setProject(p => {
      if (p.sheets.length <= 1) return p; // always keep one
      const sheets = p.sheets.filter(s => s.id !== id);
      const activeSheetId = p.activeSheetId === id ? sheets[0].id : p.activeSheetId;
      return { ...p, sheets, activeSheetId };
    });
    setSelectedId(null); setSelectedAnnoId(null); setWireStart(null);
    setHistory([]); setFuture([]);
  }, []);

  // ---------- File import (PDF or image) ----------
  // Show an imported plan immediately via a local object URL, then upload the
  // bytes to Supabase Storage in the background and attach the durable `path`.
  // Falls back to inline base64 only if the upload can't happen (offline / not
  // configured) so the plan is never lost.
  const setPlanImageFromBlob = (blob, w, h, existingObjectUrl = null, sourcePdf = null) => {
    const targetId = activeSheetIdRef.current;
    const prevPath = sheetsRef.current.find(s => s.id === targetId)?.bgImage?.path || null;
    const displayUrl = existingObjectUrl || URL.createObjectURL(blob);
    // For PDFs, mint a LOCAL link to the original right away so the crisp windowed
    // renderer switches on the instant the plan is imported — no save/reopen needed.
    // This link is transient (blob: URL) and is stripped before any save; the
    // permanent copy is uploaded below and re-linked by hydrateImages on next load.
    const pdfNow = sourcePdf ? { pdfSrc: URL.createObjectURL(sourcePdf), pdfPage: 1 } : {};
    patchSheetById(targetId, { bgImage: { src: displayUrl, w, h, ...pdfNow } });
    setTimeout(fitToScreen, 60);
    // Registered BEFORE the upload starts, so a save that follows immediately
    // always finds it and waits (see readyToSave).
    const upload = { displayUrl, done: null };
    planUploadsRef.current.set(targetId, upload);
    upload.done = (async () => {
      try {
        const { path } = await uploadPlanImage(blob);
        let pdfExtra = {};
        if (sourcePdf) {
          try {
            const { path: pdfPath } = await uploadPlanImage(sourcePdf);
            pdfExtra = { pdfPath, pdfPage: 1 };
          } catch (e) {
            console.warn("original PDF store failed (preview still works):", e?.message);
          }
        }
        const storedBg = { src: displayUrl, w, h, path, ...pdfNow, ...pdfExtra };
        patchSheetById(targetId, { bgImage: storedBg });
        if (prevPath && prevPath !== path) deletePlanImages([prevPath]);
        return storedBg;
      } catch (err) {
        console.warn("plan image upload failed; using inline fallback:", err?.message);
        try {
          const dataUrl = await blobToDataUrl(blob);
          const inlineBg = { src: dataUrl, w, h, ...pdfNow };
          patchSheetById(targetId, { bgImage: inlineBg });
          return inlineBg;
        } catch {
          return null; // keep the object URL for this session at least
        }
      } finally {
        // A newer import on the same sheet replaces this entry; only clear our own.
        if (planUploadsRef.current.get(targetId) === upload) planUploadsRef.current.delete(targetId);
      }
    })();
  };

  const handleFile = async (file) => {
    if (!file) return;
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (isPdf) {
      setPdfLoading(true);
      try {
        const pdfjs = await ensurePdfjs();
        const buf = await file.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: buf }).promise;
        // Just use first page for now (multi-page is a future feature)
        const page = await pdf.getPage(1);

        // Render at high resolution so the plan stays crisp. Desktop aims for
        // ~4400px wide; touch devices (iPad/iOS Safari) are capped well under
        // iOS's ~16.7M-pixel canvas limit and use JPEG to avoid blank renders
        // and out-of-memory crashes.
        const base = page.getViewport({ scale: 1 });
        const isTouch = typeof navigator !== "undefined" &&
          (navigator.maxTouchPoints > 1 ||
           (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(pointer: coarse)").matches));
        const TARGET_W = isTouch ? 2400 : 4400;
        const MAX_DIM = isTouch ? 3000 : 6400;
        const MAX_AREA = isTouch ? 9_000_000 : 40_000_000;
        let renderScale = Math.max(isTouch ? 1.5 : 3, Math.min(TARGET_W / base.width, isTouch ? 3.2 : 5));
        let w = base.width * renderScale, h = base.height * renderScale;
        const maxSide = Math.max(w, h);
        if (maxSide > MAX_DIM) { const k = MAX_DIM / maxSide; renderScale *= k; w *= k; h *= k; }
        if (w * h > MAX_AREA) { const k = Math.sqrt(MAX_AREA / (w * h)); renderScale *= k; }

        const viewport = page.getViewport({ scale: renderScale });
        const c = document.createElement("canvas");
        c.width = Math.round(viewport.width);
        c.height = Math.round(viewport.height);
        const ctx = c.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        await page.render({ canvasContext: ctx, viewport }).promise;
        const mime = isTouch ? "image/jpeg" : "image/png";
        const quality = isTouch ? 0.9 : undefined;
        const iw = c.width, ih = c.height;
        const blob = await new Promise((res, rej) =>
          c.toBlob(b => b ? res(b) : rej(new Error("Could not render the plan image.")), mime, quality));
        c.width = c.height = 0; // release the large canvas promptly
        setPlanImageFromBlob(blob, iw, ih, null, file);
      } catch (err) {
        alert("Could not read PDF: " + err.message);
      } finally {
        setPdfLoading(false);
      }
    } else {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        setPlanImageFromBlob(file, img.width, img.height, objectUrl);
      };
      img.onerror = () => { URL.revokeObjectURL(objectUrl); alert("Could not read image."); };
      img.src = objectUrl;
    }
    setTimeout(fitToScreen, 100);
  };

  // ---------- Zoom & pan (over the whole sheet) ----------
  const fitToScreen = useCallback(() => {
    const vp = viewportRef.current?.getBoundingClientRect();
    if (!vp) return;
    const padding = 40;
    const scaleX = (vp.width - padding * 2) / SHEET.width;
    const scaleY = (vp.height - padding * 2) / SHEET.height;
    const scale = Math.min(scaleX, scaleY);
    setZoom(scale);
    setPan({
      x: (vp.width - SHEET.width * scale) / 2,
      y: (vp.height - SHEET.height * scale) / 2,
    });
  }, []);

  // Initial fit
  useEffect(() => {
    const t = setTimeout(fitToScreen, 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const zoomAt = useCallback((clientX, clientY, factor) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    setZoom(prevZoom => {
      const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prevZoom * factor));
      if (newZoom === prevZoom) return prevZoom;
      const realFactor = newZoom / prevZoom;
      setPan(prevPan => ({
        x: cx - (cx - prevPan.x) * realFactor,
        y: cy - (cy - prevPan.y) * realFactor,
      }));
      return newZoom;
    });
  }, []);

  // Mouse-wheel zoom across the workspace
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * ZOOM_WHEEL_SPEED);
      zoomAt(e.clientX, e.clientY, factor);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // Two-finger pinch-to-zoom (touch). Capture-phase listeners so pointers are
  // tracked even when a finger lands on a symbol (whose handler stops bubbling).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const pts = pointersRef.current;

    const onDown = (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const rect = el.getBoundingClientRect();
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const midX = (a.x + b.x) / 2 - rect.left;
        const midY = (a.y + b.y) / 2 - rect.top;
        const z = zoomRef.current, p = panRef.current;
        pinchRef.current = {
          startDist: dist, startZoom: z,
          worldX: (midX - p.x) / z, worldY: (midY - p.y) / z,
          rectLeft: rect.left, rectTop: rect.top,
        };
        pinchActiveRef.current = true;
        // Cancel any pan/drag the first finger may have begun.
        setIsPanning(false); setDraggingPlacedId(null); setDraggingFurnId(null); setDraggingAnno(null); setRotatingId(null); setRotatingFurnId(null); setResizingFurnId(null);
        try { el.setPointerCapture(e.pointerId); } catch {}
      }
    };

    const onMove = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinchRef.current && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const { startDist, startZoom, worldX, worldY, rectLeft, rectTop } = pinchRef.current;
        const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, startZoom * (dist / startDist)));
        const midX = (a.x + b.x) / 2 - rectLeft;
        const midY = (a.y + b.y) / 2 - rectTop;
        const panX = midX - worldX * newZoom;
        const panY = midY - worldY * newZoom;
        // Drive the transform straight on the DOM node so the whole sheet
        // (every symbol/wall) isn't re-rendered on each of the ~120 move events
        // an iPad fires — that re-render is what made the pinch feel slow.
        livePinchRef.current = { zoom: newZoom, panX, panY };
        const node = sheetTransformRef.current;
        if (node) node.style.transform = `translate(${panX}px, ${panY}px) scale(${newZoom})`;
        e.preventDefault();
      }
    };

    const onUp = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) {
        // Pinch finished — commit the final zoom/pan to React state once.
        if (livePinchRef.current) {
          const { zoom: z, panX, panY } = livePinchRef.current;
          livePinchRef.current = null;
          setZoom(z);
          setPan({ x: panX, y: panY });
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

  // ---------- Coordinate transforms ----------
  // Convert client (screen) coordinates to drawing-area coordinates.
  // The drawing area lives inside the sheet, which is itself transformed
  // by (pan, zoom) inside the viewport. So:
  //   sheetSpace = (client - viewportTopLeft - pan) / zoom
  //   drawingAreaSpace = sheetSpace - (DRAW.x, DRAW.y)
  const clientToDrawing = (clientX, clientY) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const sheetX = (clientX - rect.left - pan.x) / zoom;
    const sheetY = (clientY - rect.top - pan.y) / zoom;
    return { x: sheetX - DRAW.x, y: sheetY - DRAW.y };
  };

  // ---------- Drag from palette ----------
  // ---- Palette → canvas placement -------------------------------------------
  // Pointer-based (not HTML5 drag-and-drop) so it's instant on touch. The tiles
  // use touch-action:none so iOS doesn't claim the gesture for scrolling and
  // cancel the drag; in return we scroll the palette ourselves on a vertical
  // swipe. Horizontal swipe (toward the canvas) picks the symbol up.
  const paletteDragState = useRef(null);
  const [paletteGhost, setPaletteGhost] = useState(null);

  const onPalettePointerDown = (e, symbolId) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (paletteDragState.current) return;
    // Reaching for a symbol means you're done drawing link lines — drop back to the
    // select/place tool so you don't have to manually click off the wire tool first.
    if (tool === "wire") { setTool("select"); setWireStart(null); }
    const pointerId = e.pointerId;
    const startX = e.clientX, startY = e.clientY;
    const startPlaced = placed;
    const isTouch = e.pointerType !== "mouse";
    const scroller = (e.currentTarget && e.currentTarget.closest)
      ? e.currentTarget.closest("[data-palette-scroll]") : null;
    const startScrollTop = scroller ? scroller.scrollTop : 0;
    const state = { mode: "idle" };  // idle | drag | scroll
    paletteDragState.current = state;

    function cleanup() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      paletteDragState.current = null;
      setPaletteGhost(null);
    }
    const move = (ev) => {
      if (ev.pointerId !== pointerId) return;
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (state.mode === "idle") {
        if (!isTouch) {
          if (Math.hypot(dx, dy) < 6) return;
          state.mode = "drag";
        } else if (dx > 10) {
          state.mode = "drag";            // moving toward the canvas (to the right) → pick up
        } else if (Math.abs(dy) > 12) {
          state.mode = "scroll";          // a clear vertical swipe → scroll the list
        } else {
          return;                         // ambiguous so far — wait for more movement
        }
      }
      if (ev.cancelable) ev.preventDefault();
      if (state.mode === "scroll") {
        if (scroller) scroller.scrollTop = startScrollTop - dy;
        return;
      }
      setPaletteGhost({ symbolId, x: ev.clientX, y: ev.clientY });
    };
    const finish = (ev, place) => {
      if (ev.pointerId !== pointerId) return;
      const mode = state.mode;
      cleanup();
      if (!place || mode !== "drag" || !findSymbol(symbolId)) return;
      const { x, y } = clientToDrawing(ev.clientX, ev.clientY);
      if (x < 0 || y < 0 || x > DRAW.w || y > DRAW.h) return; // released off the sheet → ignore
      snapshot();
      const newItem = {
        id: "p_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
        symbolId, x: snap(x), y: snap(y), rotation: 0, scale: 1, label: "",
      };
      updateProject({ placed: [...startPlaced, newItem] });
      setSelectedId(newItem.id);
      setSelectedAnnoId(null);
    };
    const up = (ev) => finish(ev, true);
    const cancel = (ev) => finish(ev, false);
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  // Drop onto the drawing area
  const onDrawingDrop = (e) => {
    e.preventDefault();
    setDraggingFile(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
      return;
    }
    const symbolId = e.dataTransfer.getData("text/plain");
    if (!symbolId || !findSymbol(symbolId)) return;
    const { x, y } = clientToDrawing(e.clientX, e.clientY);
    if (x < 0 || y < 0 || x > DRAW.w || y > DRAW.h) return;
    snapshot();
    const newItem = {
      id: "p_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      symbolId, x: snap(x), y: snap(y), rotation: 0, scale: 1, label: "",
    };
    updateProject({ placed: [...placed, newItem] });
    setSelectedId(newItem.id);
    setSelectedAnnoId(null);
  };

  const onDrawingDragOver = (e) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes("Files") && !bgImage) {
      setDraggingFile(true);
    }
  };
  const onDrawingDragLeave = (e) => {
    if (e.currentTarget === e.target) setDraggingFile(false);
  };

  // ---------- Symbol interactions ----------
  const onItemMouseDown = (e, item) => {
    if (tool === "pan" || spacePressed) return;
    e.stopPropagation();
    if (tool === "wire") {
      if (!wireStart) {
        setWireStart(item.id);
      } else if (wireStart !== item.id) {
        snapshot();
        updateProject({ wires: [...wires, { id: "w_" + Date.now(), fromId: wireStart, toId: item.id }] });
        setWireStart(null);
      } else {
        setWireStart(null);
      }
      return;
    }
    setSelectedId(item.id);
    setSelectedAnnoId(null);
    setSelectedWireId(null);
    const { x, y } = clientToDrawing(e.clientX, e.clientY);
    setDragOffset({ x: x - item.x, y: y - item.y });
    setDraggingPlacedId(item.id);
    try { viewportRef.current?.setPointerCapture?.(e.pointerId); } catch {}
  };

  // ---------- Furniture (floor-plan layer) interactions ----------
  // Kept deliberately separate from the electrical handlers above. Furniture
  // is never wireable and never touches the placed/wires/annotation arrays.
  const onFurnitureMouseDown = (e, item) => {
    if (tool === "pan" || spacePressed || tool === "wire") return;
    e.stopPropagation();
    setSelectedFurnId(item.id);
    setSelectedId(null);
    setSelectedAnnoId(null);
    setSelectedWireId(null);
    const { x, y } = clientToDrawing(e.clientX, e.clientY);
    setDragOffset({ x: x - item.x, y: y - item.y });
    setDraggingFurnId(item.id);
    try { viewportRef.current?.setPointerCapture?.(e.pointerId); } catch {}
  };
  const startFurnRotating = (id) => setRotatingFurnId(id);
  const startFurnResizing = (id) => setResizingFurnId(id);

  // ---------- Wall tool (floor-plan layer) ----------
  // Snap a pointer position: clamp to the sheet, lock to horizontal/vertical
  // relative to the previous point (unless Shift), then snap to the grid.
  const snapWallPoint = (clientX, clientY, shiftKey) => {
    let { x, y } = clientToDrawing(clientX, clientY);
    x = Math.max(0, Math.min(DRAW.w, x));
    y = Math.max(0, Math.min(DRAW.h, y));
    const pts = wallDraft?.points || [];
    if (pts.length > 0 && !shiftKey) {
      const prev = pts[pts.length - 1];
      if (Math.abs(x - prev.x) >= Math.abs(y - prev.y)) y = prev.y; else x = prev.x;
    }
    return { x: snap(x), y: snap(y) };
  };
  const addWallPoint = (clientX, clientY, shiftKey) => {
    const pt = snapWallPoint(clientX, clientY, shiftKey);
    // One line at a time: first click drops the start, second click finishes
    // that segment and commits it. No double-click needed.
    if (!wallDraft || !wallDraft.points || wallDraft.points.length === 0) {
      setWallDraft({ points: [pt], type: wallType });
      setWallCursor(pt);
      return;
    }
    const a = wallDraft.points[0];
    if (a.x === pt.x && a.y === pt.y) return; // ignore a zero-length click
    snapshot();
    const newWall = {
      id: "wl_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      points: [a, pt],
      type: wallDraft.type || wallType,
    };
    updateProject({ walls: [...walls, newWall] });
    setWallDraft(null);
    setWallCursor(null);
  };
  const cancelWall = () => { setWallDraft(null); setWallCursor(null); };
  const onWallMouseDown = (e, wall) => {
    if (tool !== "select" || spacePressed) return;
    e.stopPropagation();
    setSelectedWallId(wall.id);
    setSelectedId(null); setSelectedFurnId(null); setSelectedAnnoId(null); setSelectedWireId(null);
  };

  // Drop a furniture piece from the Floor Plan palette onto the sheet.
  // Mirrors onPalettePointerDown exactly, but targets the furniture array.
  const onFurniturePointerDown = (e, furnitureId) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (paletteDragState.current) return;
    const pointerId = e.pointerId;
    const startX = e.clientX, startY = e.clientY;
    const startFurniture = furniture;
    const isTouch = e.pointerType !== "mouse";
    const scroller = (e.currentTarget && e.currentTarget.closest)
      ? e.currentTarget.closest("[data-palette-scroll]") : null;
    const startScrollTop = scroller ? scroller.scrollTop : 0;
    const state = { mode: "idle" };
    paletteDragState.current = state;

    function cleanup() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      paletteDragState.current = null;
      setPaletteGhost(null);
    }
    const move = (ev) => {
      if (ev.pointerId !== pointerId) return;
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (state.mode === "idle") {
        if (!isTouch) {
          if (Math.hypot(dx, dy) < 6) return;
          state.mode = "drag";
        } else if (dx > 10) {
          state.mode = "drag";
        } else if (Math.abs(dy) > 12) {
          state.mode = "scroll";
        } else {
          return;
        }
      }
      if (ev.cancelable) ev.preventDefault();
      if (state.mode === "scroll") {
        if (scroller) scroller.scrollTop = startScrollTop - dy;
        return;
      }
      setPaletteGhost({ furnitureId, x: ev.clientX, y: ev.clientY });
    };
    const finish = (ev, place) => {
      if (ev.pointerId !== pointerId) return;
      const mode = state.mode;
      cleanup();
      if (!place || mode !== "drag" || !findFurniture(furnitureId)) return;
      const { x, y } = clientToDrawing(ev.clientX, ev.clientY);
      if (x < 0 || y < 0 || x > DRAW.w || y > DRAW.h) return;
      snapshot();
      const newItem = {
        id: "f_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
        furnitureId, x: snap(x), y: snap(y), rotation: 0, scale: furnitureScale(furnitureId),
      };
      updateProject({ furniture: [...startFurniture, newItem] });
      setSelectedFurnId(newItem.id);
    };
    const up = (ev) => finish(ev, true);
    const cancel = (ev) => finish(ev, false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  // ---------- Annotation interactions ----------
  const onAnnotationBodyMouseDown = (e, anno) => {
    if (tool === "pan" || spacePressed) return;
    e.stopPropagation();
    setSelectedAnnoId(anno.id);
    setSelectedId(null);
    setSelectedWireId(null);
    const { x, y } = clientToDrawing(e.clientX, e.clientY);
    setDragOffset({ x: x - anno.x, y: y - anno.y });
    setDraggingAnno({ id: anno.id, mode: "body" });
    try { viewportRef.current?.setPointerCapture?.(e.pointerId); } catch {}
  };
  const onAnnotationAnchorMouseDown = (e, anno) => {
    if (tool === "pan" || spacePressed) return;
    e.stopPropagation();
    setSelectedAnnoId(anno.id);
    setSelectedId(null);
    setSelectedWireId(null);
    setDraggingAnno({ id: anno.id, mode: "anchor" });
    try { viewportRef.current?.setPointerCapture?.(e.pointerId); } catch {}
  };

  // ---------- Viewport mouse handling ----------
  const onViewportMouseDown = (e) => {
    if (pinchActiveRef.current) return;   // a pinch is underway
    const explicitPan = e.button === 1 || spacePressed || tool === "pan";
    // Don't intercept clicks on real interactive elements inside the sheet
    const isInteractive =
      e.target.tagName === "INPUT" ||
      e.target.tagName === "TEXTAREA" ||
      e.target.tagName === "BUTTON" ||
      e.target.isContentEditable ||
      e.target.closest?.("button") ||
      e.target.closest?.(".notes-editable");
    if (isInteractive) return;

    // Wall tool: a left-click in the drawing area lays the next wall point.
    // Sits before the pan logic so wall clicks never pan (Space/middle still pan).
    const explicitPanWall = e.button === 1 || spacePressed || tool === "pan";
    if (tool === "wall" && !explicitPanWall && e.button === 0 && e.target.closest?.("[data-drawing-bg]")) {
      e.preventDefault();
      addWallPoint(e.clientX, e.clientY, e.shiftKey);
      return;
    }

    // Pan when clicking blank workspace, sheet background, drawing background
    // (anywhere that isn't a symbol/annotation/text field)
    const onPannableBg =
      e.target === viewportRef.current ||
      e.target.closest?.("[data-sheet-bg]") ||
      e.target.closest?.("[data-drawing-bg]") && tool !== "note" && tool !== "wall";

    const wantPan = explicitPan || (e.button === 0 && onPannableBg);

    if (wantPan) {
      e.preventDefault();
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      try { viewportRef.current?.setPointerCapture?.(e.pointerId); } catch {}
      if (e.button === 0 && onPannableBg) {
        setSelectedId(null);
        setSelectedAnnoId(null);
        setSelectedWireId(null);
        setWireStart(null);
      }
      return;
    }

    // Click in drawing area in note mode → create a new annotation
    if (tool === "note" && e.target.closest?.("[data-drawing-bg]")) {
      const { x, y } = clientToDrawing(e.clientX, e.clientY);
      if (x < 0 || y < 0 || x > DRAW.w || y > DRAW.h) return;
      snapshot();
      const newAnno = {
        id: "a_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
        x, y,
        anchorX: x + 80, anchorY: y + 40,
        text: "Note",
      };
      updateProject({ annotations: [...annotations, newAnno] });
      setSelectedAnnoId(newAnno.id);
      setSelectedId(null);
      setTool("select");
    }
  };

  const onViewportMouseMove = (e) => {
    if (pinchActiveRef.current) return;   // pinch-zoom owns the gesture
    if (isPanning) {
      setPan({
        x: panStart.current.panX + (e.clientX - panStart.current.x),
        y: panStart.current.panY + (e.clientY - panStart.current.y),
      });
      return;
    }
    if (tool === "wall") {
      setWallCursor(snapWallPoint(e.clientX, e.clientY, e.shiftKey));
      return;
    }
    if (rotatingId) {
      const item = placed.find(p => p.id === rotatingId);
      if (!item) return;
      const { x, y } = clientToDrawing(e.clientX, e.clientY);
      const dx = x - item.x;
      const dy = y - item.y;
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
      const rounded = e.shiftKey ? Math.round(angle / 15) * 15 : Math.round(angle);
      updateProject({
        placed: placed.map(it =>
          it.id === rotatingId ? { ...it, rotation: ((rounded % 360) + 360) % 360 } : it
        ),
      });
      return;
    }
    if (draggingPlacedId) {
      const { x, y } = clientToDrawing(e.clientX, e.clientY);
      updateProject({
        placed: placed.map(it =>
          it.id === draggingPlacedId
            ? { ...it, x: snap(x - dragOffset.x), y: snap(y - dragOffset.y) }
            : it
        ),
      });
      return;
    }
    if (rotatingFurnId) {
      const item = furniture.find(p => p.id === rotatingFurnId);
      if (!item) return;
      const { x, y } = clientToDrawing(e.clientX, e.clientY);
      const angle = (Math.atan2(y - item.y, x - item.x) * 180) / Math.PI + 90;
      const rounded = e.shiftKey ? Math.round(angle / 15) * 15 : Math.round(angle);
      updateProject({
        furniture: furniture.map(it =>
          it.id === rotatingFurnId ? { ...it, rotation: ((rounded % 360) + 360) % 360 } : it
        ),
      });
      return;
    }
    if (resizingFurnId) {
      const item = furniture.find(p => p.id === resizingFurnId);
      if (!item) return;
      const { x, y } = clientToDrawing(e.clientX, e.clientY);
      // Distance from the piece centre to the pointer. The corner sits at
      // half*√2 from centre, so newSize = pointerDistance * √2. Rotation-
      // invariant, so it works at any angle.
      const d = Math.hypot(x - item.x, y - item.y);
      const base = 48 * symbolScale;
      let nextScale = (d * Math.SQRT2) / base;
      nextScale = Math.max(0.8, Math.min(30, nextScale));
      updateProject({
        furniture: furniture.map(it =>
          it.id === resizingFurnId ? { ...it, scale: nextScale } : it
        ),
      });
      return;
    }
    if (draggingFurnId) {
      const { x, y } = clientToDrawing(e.clientX, e.clientY);
      updateProject({
        furniture: furniture.map(it =>
          it.id === draggingFurnId
            ? { ...it, x: snap(x - dragOffset.x), y: snap(y - dragOffset.y) }
            : it
        ),
      });
      return;
    }
    if (draggingAnno) {
      const { x, y } = clientToDrawing(e.clientX, e.clientY);
      if (draggingAnno.mode === "body") {
        const target = annotations.find(a => a.id === draggingAnno.id);
        if (!target) return;
        const dx = (x - dragOffset.x) - target.x;
        const dy = (y - dragOffset.y) - target.y;
        updateProject({
          annotations: annotations.map(a =>
            a.id === draggingAnno.id
              ? { ...a, x: a.x + dx, y: a.y + dy, anchorX: a.anchorX + dx, anchorY: a.anchorY + dy }
              : a
          ),
        });
      } else if (draggingAnno.mode === "anchor") {
        updateProject({
          annotations: annotations.map(a =>
            a.id === draggingAnno.id ? { ...a, anchorX: x, anchorY: y } : a
          ),
        });
      }
    }
  };

  const onViewportMouseUp = (e) => {
    setDraggingPlacedId(null);
    setDraggingFurnId(null);
    setDraggingAnno(null);
    setRotatingId(null);
    setRotatingFurnId(null);
    setResizingFurnId(null);
    setIsPanning(false);
    try { if (e?.pointerId != null) viewportRef.current?.releasePointerCapture?.(e.pointerId); } catch {}
  };
  const onViewportDoubleClick = (e) => {
    // Walls finish on the second click now, so nothing to do here.
  };

  // ---------- Symbol actions ----------
  const rotateSelected = () => {
    if (!selectedId) return;
    snapshot();
    updateProject({
      placed: placed.map(it =>
        it.id === selectedId ? { ...it, rotation: (it.rotation + 15) % 360 } : it
      ),
    });
  };
  const setRotation = (deg) => {
    if (!selectedId) return;
    updateProject({
      placed: placed.map(it =>
        it.id === selectedId ? { ...it, rotation: ((deg % 360) + 360) % 360 } : it
      ),
    });
  };
  const setItemScale = (s) => {
    if (!selectedId) return;
    const clamped = Math.max(0.4, Math.min(3, s));
    updateProject({
      placed: placed.map(it =>
        it.id === selectedId ? { ...it, scale: clamped } : it
      ),
    });
  };
  const normaliseSizes = () => {
    if (placed.length) {
      snapshot();
      updateProject({ placed: placed.map(it => ({ ...it, scale: 1 })) });
    }
    setNormaliseFlash(true);
    setTimeout(() => setNormaliseFlash(false), 1300);
  };
  const onWireSelect = (id) => {
    setSelectedWireId(id);
    setSelectedId(null);
    setSelectedAnnoId(null);
  };
  const deleteSelected = () => {
    if (selectedId) {
      snapshot();
      updateProject({
        placed: placed.filter(it => it.id !== selectedId),
        wires: wires.filter(w => w.fromId !== selectedId && w.toId !== selectedId),
      });
      setSelectedId(null);
    } else if (selectedFurnId) {
      snapshot();
      updateProject({ furniture: furniture.filter(it => it.id !== selectedFurnId) });
      setSelectedFurnId(null);
    } else if (selectedWallId) {
      snapshot();
      updateProject({ walls: walls.filter(w => w.id !== selectedWallId) });
      setSelectedWallId(null);
    } else if (selectedAnnoId) {
      snapshot();
      updateProject({ annotations: annotations.filter(a => a.id !== selectedAnnoId) });
      setSelectedAnnoId(null);
    } else if (selectedWireId) {
      snapshot();
      updateProject({ wires: wires.filter(w => w.id !== selectedWireId) });
      setSelectedWireId(null);
    }
  };
  const updateLabel = (val) => {
    updateProject({
      placed: placed.map(it =>
        it.id === selectedId ? { ...it, label: val } : it
      ),
    });
  };
  const updateAnnoText = (val) => {
    updateProject({
      annotations: annotations.map(a =>
        a.id === selectedAnnoId ? { ...a, text: val } : a
      ),
    });
  };

  // ---------- Keyboard ----------
  useEffect(() => {
    const onKey = (e) => {
      const isInput = e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable;
      if (e.code === "Space" && !isInput) {
        e.preventDefault();
        setSpacePressed(true);
      }
      if (isInput) return;
      if (wallDraft && e.key === "Escape") { e.preventDefault(); cancelWall(); return; }
      if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
      else if (e.key === "r" || e.key === "R") rotateSelected();
      else if (e.key === "Escape") { setSelectedId(null); setSelectedFurnId(null); setSelectedWallId(null); setSelectedAnnoId(null); setSelectedWireId(null); setWireStart(null); setTool("select"); setPrintPreview(false); setShowMeta(false); setShowBoq(false); setShowProjects(false); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "z") { e.preventDefault(); undo(); }
      else if ((e.metaKey || e.ctrlKey) && (e.key === "y" || (e.shiftKey && e.key === "Z"))) { e.preventDefault(); redo(); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); saveProject(); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "p") { e.preventDefault(); setPrintPreview(true); }
      else if (e.key === "v" || e.key === "V") setTool("select");
      else if (e.key === "w" || e.key === "W") setTool("wire");
      else if (e.key === "h" || e.key === "H") setTool("pan");
      else if (e.key === "n" || e.key === "N") setTool("note");
      else if (e.key === "+" || e.key === "=") {
        const r = viewportRef.current?.getBoundingClientRect();
        if (r) zoomAt(r.left + r.width/2, r.top + r.height/2, 1.2);
      }
      else if (e.key === "-" || e.key === "_") {
        const r = viewportRef.current?.getBoundingClientRect();
        if (r) zoomAt(r.left + r.width/2, r.top + r.height/2, 1/1.2);
      }
      else if (e.key === "0") fitToScreen();
    };
    const onKeyUp = (e) => {
      if (e.code === "Space") setSpacePressed(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  });

  // ---------- Projects (multi-project save/load) ----------
  // Project list lives in the cloud `projects` table (one row per drawing).
  const refreshProjectList = useCallback(async () => {
    try {
      const rows = await listProjects();
      setProjectList(rows.map(r => ({ id: r.id, name: r.name, updatedAt: r.updatedAt })));
    } catch (err) {
      console.error("Could not load projects", err);
    }
  }, []);

  // Load the project list once on mount
  useEffect(() => { refreshProjectList(); }, [refreshProjectList]);

  // Let the route layer know the current project id (for linkable URLs).
  useEffect(() => {
    if (currentProjectId && onProjectId) onProjectId(currentProjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId]);

  // Quick-save: writes to the currently open project, or creates one if new.
  // One save at a time. A save can wait a while on a plan upload, and a second
  // Save / Ctrl+S / Save As in that window would otherwise insert a duplicate
  // drawing (sharing the first one's stored plan). A save requested while one
  // is running gets that save's result instead of starting another.
  const saveInFlightRef = useRef(null);
  const runSave = (save) => {
    if (saveInFlightRef.current) return saveInFlightRef.current;
    const running = (async () => {
      try { return await save(); } finally { saveInFlightRef.current = null; }
    })();
    saveInFlightRef.current = running;
    return running;
  };

  const saveProject = () => runSave(async () => {
    try {
      if (currentProjectId) {
        const safe = await readyToSave(project);
        await updateProjectRow(currentProjectId, meta.projectName || "Untitled drawing", safe);
        setProject(prev => mergeSavedPaths(prev, safe));
        await refreshProjectList();
      } else {
        return await insertAsNewProject(meta.projectName || "Untitled drawing");
      }
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
      return true;
    } catch (err) {
      alert("Save failed: " + (err.message || err));
      return false;
    }
  });

  // Apply a plan handed back from the embedded Floor Plan sketch, in place (no navigation).
  const applyFloorPlan = async ({ path, w, h, dataUrl, sketchId }) => {
    const sid = activeSheetIdRef.current;
    let updated = null;
    setProject(prev => {
      updated = { ...prev, sheets: prev.sheets.map(s => s.id === sid ? { ...s, bgImage: { path, w, h, src: dataUrl }, sketchId } : s) };
      return updated;
    });
    setFloorPlanOpen(false);
    if (currentProjectIdRef.current && updated) {
      try {
        const safe = await readyToSave(updated);
        await updateProjectRow(currentProjectIdRef.current, updated.meta?.projectName || "Untitled drawing", safe);
        setProject(prev => mergeSavedPaths(prev, safe));
      } catch (err) { console.error("Floor plan save failed:", err); }
    }
  };

  // Save As: store the current canvas as a new named project (new cloud row)
  const saveProjectAs = (name) => runSave(() => insertAsNewProject(name));

  // The body of Save As, also used by the first Save of a new drawing (which
  // already holds the save slot, so it must not go through runSave again).
  const insertAsNewProject = async (name) => {
    try {
      const named = { ...project, meta: { ...project.meta, projectName: name || project.meta.projectName } };
      const safe = await readyToSave(named);
      const id = await insertProject(name || named.meta.projectName || "Untitled drawing", safe);
      setCurrentProjectId(id);
      // Merge into the LIVE project, not the click-time snapshot: the save may
      // have waited on an upload, and edits made meanwhile must survive.
      setProject(prev => mergeSavedPaths({ ...prev, meta: { ...prev.meta, projectName: named.meta.projectName } }, safe));
      await refreshProjectList();
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
      return true;
    } catch (err) {
      alert("Save failed: " + (err.message || err));
      return false;
    }
  };

  const openProjectById = async (id) => {
    try {
      const data = await getProjectData(id);
      if (!data) { alert("Could not find that project."); return; }
      const np = normaliseProject(data);
      // Mint signed URLs for any Storage-backed plan images before showing.
      const hydrated = await hydrateImages(np);
      // Always open on the first drawing (ground floor), regardless of which
      // sheet was active when the project was last saved.
      setProject({ ...hydrated, activeSheetId: hydrated.sheets[0].id });
      setCurrentProjectId(id);
      setShowProjects(false);
      setHistory([]); setFuture([]);
      setTimeout(fitToScreen, 50);
    } catch (err) {
      alert("Open failed.");
    }
  };

  const deleteProjectById = async (id) => {
    try {
      // Best-effort: clear the project's Storage images before dropping the row.
      let paths = [];
      try {
        const data = await getProjectData(id);
        if (data) paths = collectImagePaths(normaliseProject(data));
      } catch { /* still delete the row even if we can't read it */ }
      await deleteProjectRow(id);
      if (paths.length) deletePlanImages(paths);
      await refreshProjectList();
      if (currentProjectId === id) setCurrentProjectId(null);
    } catch (err) {
      alert("Delete failed.");
    }
  };

  const newProject = () => {
    if (placed.length && !confirm("Start a new blank project? Unsaved changes to the current drawing will be lost.")) return;
    setProject(freshProject());
    setCurrentProjectId(null);
    setHistory([]); setFuture([]);
    setShowProjects(false);
    setTimeout(fitToScreen, 50);
  };

  // On entry from the dashboard: open a project, start fresh, or import.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current || !initialTarget) return;
    didInit.current = true;
    const t = initialTarget;
    if (t.mode === "open" && t.projectId) {
      openProjectById(t.projectId);
    } else {
      setProject(freshProject());
      setCurrentProjectId(null);
      if (t.category) setActiveCategory(t.category);
      if (t.mode === "import") setTimeout(() => fileInputRef.current?.click(), 250);
      setTimeout(fitToScreen, 60);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Crash recovery: keep a local draft so work is never lost -------------
  const projectRef = useRef(project); projectRef.current = project;
  const currentProjectIdRef = useRef(currentProjectId); currentProjectIdRef.current = currentProjectId;
  const draftTimer = useRef(null);
  const [recovery, setRecovery] = useState(null);
  const countPlaced = (p) => (p?.sheets || []).reduce((n, s) => n + ((s.placed && s.placed.length) || 0), 0);

  // Debounced local autosave — survives tab crashes / reloads (esp. on iPad).
  useEffect(() => {
    if (!didInit.current) return;
    if (countPlaced(project) === 0 && !bgImage) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      try {
        // Strip ALL image bytes (not just migrated ones) so the draft is a few
        // KB and reliably fits in localStorage — otherwise a freshly-imported
        // plan made the draft several MB, it silently failed, and a crash then
        // lost the user's work entirely.
        window.localStorage.setItem("planworks:draft:v1", JSON.stringify({
          projectId: currentProjectId || null, savedAt: Date.now(),
          project: stripImagesForDraft(project),
        }));
      } catch (e) { /* storage full / unavailable */ }
    }, 800);
    return () => { if (draftTimer.current) clearTimeout(draftTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, currentProjectId, bgImage]);

  // Once the initial load settles, offer to restore if the local draft holds
  // more work than what loaded (i.e. a previous session crashed before saving).
  useEffect(() => {
    const id = setTimeout(() => {
      let draft = null;
      try { draft = JSON.parse(window.localStorage.getItem("planworks:draft:v1") || "null"); } catch (e) {}
      if (!draft || !draft.project) return;
      const sameProject = (draft.projectId || null) === (currentProjectIdRef.current || null);
      if (sameProject && countPlaced(draft.project) > countPlaced(projectRef.current)) {
        setRecovery({ project: draft.project, savedAt: draft.savedAt });
      }
    }, 1500);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const restoreDraft = async () => {
    if (!recovery) return;
    // The draft stores only Storage paths, so re-mint signed URLs to render.
    const hydrated = await hydrateImages(recovery.project);
    setProject(hydrated);
    setHistory([]); setFuture([]);
    setRecovery(null);
    setTimeout(fitToScreen, 60);
  };
  const dismissDraft = () => setRecovery(null);

  const exportJSON = () => {
    const data = JSON.stringify(project, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (meta.projectName || "plan").replace(/[^a-z0-9-_]+/gi, "_") + ".json";
    a.click();
  };
  const printSheet = () => {
    window.print();
  };

  const selectedItem = placed.find(p => p.id === selectedId);
  const selectedAnno = annotations.find(a => a.id === selectedAnnoId);

  // Cursor over viewport
  const viewportCursor =
    isPanning ? "grabbing" :
    (tool === "pan" || spacePressed) ? "grab" :
    tool === "wire" ? "crosshair" :
    tool === "wall" ? "crosshair" :
    tool === "note" ? "text" :
    "default";

  // The list of distinct symbol IDs used in the current sheet (for the legend)
  const legendItems = useMemo(() => {
    const ids = new Set(placed.map(p => p.symbolId));
    return Array.from(ids).map(id => ({
      id,
      symbol: findSymbol(id),
      meta: SYMBOL_META[id] || { description: findSymbol(id)?.name || id, height: null },
    })).filter(x => x.symbol);
  }, [placed]);

  // Title-block view: sheet name + drawing number come from the active sheet.
  // Leaving the editor must never lose a drawing. One that already has a cloud
  // row is saved on the way out, so the dashboard is always safe to click. One
  // that has never been saved has no row to write to, so it asks first rather
  // than silently creating or discarding anything.
  const leaveToDashboard = async () => {
    if (!onHome) return;
    const p = projectRef.current;
    const hasWork = countPlaced(p) > 0 || (p?.sheets || []).some(s => s && s.bgImage);
    if (hasWork) {
      if (currentProjectIdRef.current) {
        const ok = await saveProject();
        if (ok === false && !confirm("Your changes couldn't be saved. Leave anyway?")) return;
      } else if (!confirm("This drawing hasn't been saved yet. Leave without saving?")) {
        return;
      }
    }
    onHome();
  };

  const displayMeta = useMemo(
    () => ({ ...meta, sheetName: activeSheet.name, drawingNumber: activeSheet.drawingNumber || "" }),
    [meta, activeSheet.name, activeSheet.drawingNumber]
  );

  return (
    <ProjectTitleBlockContext.Provider value={effectiveTitleBlock}>
    <div className="w-full h-screen flex flex-col bg-slate-100 text-slate-900 dark:bg-[#0E141B] dark:text-slate-100 overflow-hidden select-none"
         style={{ height: "100dvh", fontFamily: "'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif" }}>

      {/* ==================== TOP BAR ==================== */}
      <TopBar
        meta={meta}
        onHome={leaveToDashboard}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onShowMeta={() => setShowMeta(true)}
        onImport={() => fileInputRef.current.click()}
        onUndo={undo} onRedo={redo}
        onSave={saveProject} savedFlash={savedFlash}
        onShowProjects={() => { refreshProjectList(); setShowProjects(true); }}
        onExportJSON={exportJSON}
        onPrint={() => setPrintPreview(true)}
        colourMode={colourMode}
        onToggleColour={() => setProject(p => ({ ...p, colourMode: ({ navy: "colour", colour: "red", red: "mono", mono: "navy" })[p.colourMode || "colour"] }))}
        onNormalise={normaliseSizes}
        normaliseFlash={normaliseFlash}
        snapEnabled={snapEnabled}
        onToggleSnap={() => setSnapEnabled(s => !s)}
        onShowBoq={() => setShowBoq(true)}
        onShowNotes={() => setShowNotes(true)}
        onShowTitleBlock={() => setShowTitleBlock(true)}
        sidebarHidden={sidebarHidden}
        onToggleSidebar={() => setSidebarHidden(s => !s)}
      />
      <input ref={fileInputRef} type="file" accept="image/*,.pdf" className="hidden"
             onChange={(e) => handleFile(e.target.files[0])} />

      {paletteGhost && (() => {
        if (paletteGhost.furnitureId) {
          const fsym = findFurniture(paletteGhost.furnitureId);
          return (
            <div style={{ position: "fixed", left: paletteGhost.x, top: paletteGhost.y, transform: "translate(-50%,-50%)", pointerEvents: "none", zIndex: 2000 }}>
              <svg viewBox={FURNITURE_VIEWBOX} width="60" height="60"
                   style={{ color: FURNITURE_COLOUR, filter: "drop-shadow(0 3px 8px rgba(0,0,0,.35))", opacity: 0.95 }}>
                {fsym?.svg}
              </svg>
            </div>
          );
        }
        const cols = resolveColours(paletteGhost.symbolId, colourMode || "colour");
        const sym = findSymbol(paletteGhost.symbolId);
        return (
          <div style={{ position: "fixed", left: paletteGhost.x, top: paletteGhost.y, transform: "translate(-50%,-50%)", pointerEvents: "none", zIndex: 2000 }}>
            <svg viewBox={VIEWBOX} width="50" height="50"
                 style={{ color: cols.body, "--feeder": cols.feeder, filter: "drop-shadow(0 3px 8px rgba(0,0,0,.35))", opacity: 0.95 }}>
              {sym?.svg}
            </svg>
          </div>
        );
      })()}

      {recovery && (
        <div className="flex items-center flex-wrap gap-x-3 gap-y-1 px-4 py-2 bg-[#FFF7E6] border-b border-amber-300 text-[12px] text-amber-900">
          <span className="font-semibold">Recovered unsaved work</span>
          <span className="text-amber-700">{countPlaced(recovery.project)} symbols · {new Date(recovery.savedAt).toLocaleString()}</span>
          <div className="ml-auto flex gap-2">
            <button onClick={restoreDraft} className="px-3 py-1.5 rounded-md bg-[#3FB7C9] text-[#08313a] text-[11px] font-semibold uppercase tracking-wider hover:bg-[#52C4D5]">Restore</button>
            <button onClick={dismissDraft} className="px-3 py-1.5 rounded-md bg-white/70 text-amber-800 text-[11px] font-semibold uppercase tracking-wider hover:bg-white">Dismiss</button>
          </div>
        </div>
      )}

      <div className="relative z-10 flex-1 flex overflow-hidden">

        {/* ==================== LEFT PALETTE ==================== */}
        {!sidebarHidden && (
          <PalettePanel
            onPalettePointerDown={onPalettePointerDown}
            onFurniturePointerDown={onFurniturePointerDown}
            symbolScale={symbolScale}
            setSymbolScale={setSymbolScale}
            colourMode={colourMode}
          />
        )}

        {/* ==================== WORKSPACE (sheet inside) ==================== */}
        <main className="flex-1 relative overflow-hidden bg-slate-200 dark:bg-[#0B1117] flex flex-col">
          <SheetTabs
            sheets={sheets}
            activeId={activeSheetId}
            onSwitch={switchSheet}
            onAdd={addSheet}
            onRename={renameSheet}
            onDelete={deleteSheet}
          />
          <div className="relative flex-1 overflow-hidden" style={{ cursor: viewportCursor }}>
          <Workspace
            viewportRef={viewportRef}
            drawingAreaRef={drawingAreaRef}
            sheetTransformRef={sheetTransformRef}
            pan={pan} zoom={zoom}
            meta={displayMeta} notes={notes}
            updateMeta={updateMeta}
            updateNotes={(n) => updateProject({ notes: n })}
            onSheetField={setActiveSheet}
            bgImage={bgImage}
            placed={placed} wires={wires} annotations={annotations}
            furniture={furniture}
            walls={walls}
            wallDraft={wallDraft} wallCursor={wallCursor}
            wallThickness={WALL_THICKNESS}
            legendItems={legendItems}
            colourMode={colourMode}
            symbolSize={48 * symbolScale}
            wireStart={wireStart}
            onWireSelect={onWireSelect}
            spacePressed={spacePressed}
            DRAW={DRAW}
            showGrid={snapEnabled}
            gridSize={GRID}
            onViewportMouseDown={onViewportMouseDown}
            onViewportMouseMove={onViewportMouseMove}
            onViewportMouseUp={onViewportMouseUp}
            onViewportDoubleClick={onViewportDoubleClick}
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
            startRotating={setRotatingId}
          />

          {/* Floating tool toolbar */}
          <FloatingToolbar tool={tool} setTool={(t) => { setTool(t); setWireStart(null); if (t !== "wall") cancelWall(); }} />

          {/* Floor Plan — opens the sketch for this drawing (round-trips back here) */}
          {(
            <button
              onClick={() => {
                setFloorPlanArgs({
                  openSketchId: activeSheet?.sketchId || null,
                  linkProject: currentProjectId,
                  linkSheet: activeSheet?.id || null,
                  linkName: meta.projectName || "Floor plan",
                });
                setFloorPlanOpen(true);
              }}
              title="Draw or edit the floor plan"
              className="absolute top-4 left-16 z-20 flex items-center gap-1.5 h-9 px-3 bg-white dark:bg-[#16202B] rounded-xl ring-1 ring-slate-200/70 dark:ring-[#2A3947] shadow-[0_10px_30px_-10px_rgba(16,28,40,0.22)] text-[12px] font-semibold text-slate-700 dark:text-slate-200 hover:text-[#22808F] transition-colors">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="1.5"/><path d="M3 9h6V3M21 15h-6v6"/></svg>
              Floor Plan
            </button>
          )}

          {/* Wall-type chooser — only while the wall tool is active */}
          {tool === "wall" && (
            <div className="absolute top-4 left-44 z-20 flex items-center gap-1 bg-white dark:bg-[#16202B] rounded-xl ring-1 ring-slate-200/70 dark:ring-[#2A3947] shadow-[0_10px_30px_-10px_rgba(16,28,40,0.22)] p-1">
              {["external", "internal"].map((t) => (
                <button key={t} onClick={() => setWallType(t)}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold uppercase tracking-wide transition-colors ${
                    wallType === t ? "bg-[#3FB7C9]/15 text-[#1C6E7B] ring-1 ring-[#3FB7C9]/45" : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10"
                  }`}>
                  {t === "external" ? "External" : "Internal"}
                </button>
              ))}
              <div className="w-px h-5 bg-slate-200 dark:bg-[#2A3947] mx-0.5"/>
              <span className="px-1.5 text-[10px] text-slate-500 dark:text-slate-400 whitespace-nowrap">click start · click end</span>
            </div>
          )}

          {/* Floating zoom toolbar */}
          <ZoomControls
            zoom={zoom}
            onIn={() => {
              const r = viewportRef.current.getBoundingClientRect();
              zoomAt(r.left + r.width/2, r.top + r.height/2, 1.2);
            }}
            onOut={() => {
              const r = viewportRef.current.getBoundingClientRect();
              zoomAt(r.left + r.width/2, r.top + r.height/2, 1/1.2);
            }}
            onFit={fitToScreen}
          />

          {/* PDF loading */}
          {pdfLoading && (
            <div className="absolute inset-0 z-30 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center">
              <div className="bg-white px-8 py-5 rounded-xl ring-1 ring-slate-300 flex items-center gap-3">
                <Sparkles size={16} className="text-[#22808F] animate-pulse"/>
                <span className="text-xs tracking-[0.2em] uppercase text-slate-800">Rendering PDF</span>
              </div>
            </div>
          )}

          {/* Save waiting on a plan upload (see readyToSave) */}
          {finishingUpload && (
            <div className="absolute inset-0 z-30 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center">
              <div className="bg-white px-8 py-5 rounded-xl ring-1 ring-slate-300 flex items-center gap-3">
                <Sparkles size={16} className="text-[#22808F] animate-pulse"/>
                <span className="text-xs tracking-[0.2em] uppercase text-slate-800">Finishing plan upload</span>
              </div>
            </div>
          )}

          {/* External file drop overlay */}
          {draggingFile && (
            <div className="absolute inset-4 z-30 rounded-2xl border-2 border-dashed border-[#3FB7C9]/60 bg-[#ECF8FA] flex items-center justify-center pointer-events-none">
              <div className="text-[#22808F] text-sm tracking-[0.2em] uppercase">Drop to import</div>
            </div>
          )}

          {/* Status bar */}
          <div className="absolute bottom-0 left-0 right-0 px-4 h-7 bg-white dark:bg-[#16202B] text-slate-500 dark:text-slate-400 text-[10px] tracking-wider flex justify-between items-center border-t border-slate-200 dark:border-[#263441]">
            <div className="flex gap-5">
              <span>SYMBOLS <span className="text-[#22808F] ml-1" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{placed.length}</span></span>
              <span>WIRES <span className="text-[#22808F] ml-1" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{wires.length}</span></span>
              <span>NOTES <span className="text-[#22808F] ml-1" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{annotations.length}</span></span>
              <span>TOOL <span className="text-[#22808F] ml-1">{tool.toUpperCase()}</span></span>
              {tool === "wire" && wireStart && <span className="text-[#22808F] animate-pulse">→ click target</span>}
              {tool === "note" && <span className="text-[#22808F]">click drawing area to add</span>}
              {tool === "wall" && <span className="text-[#22808F]">{wallDraft ? "click to set the end point" : "click to start a wall"}</span>}
              {spacePressed && <span className="text-[#22808F]">PAN</span>}
            </div>
            <div className="text-slate-400" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              SHEET A3 · {meta.scale}
            </div>
          </div>
          </div>
        </main>

        {/* ==================== RIGHT INSPECTOR ==================== */}
        {!sidebarHidden && (
          inspectorHidden ? (
            <div className="w-9 bg-[#EBEFF6] dark:bg-[#1A2530] border-l border-slate-200 dark:border-[#263441] flex flex-col items-center pt-1.5">
              <button onClick={() => setInspectorHidden(false)} title="Show inspector"
                className="w-8 h-8 flex items-center justify-center rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/70 dark:hover:bg-[#263441]">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
            </div>
          ) : (
            <Inspector
              selectedItem={selectedItem}
              selectedAnno={selectedAnno}
              wireSelected={!!selectedWireId}
              updateLabel={updateLabel}
              updateAnnoText={updateAnnoText}
              setRotation={setRotation}
              setItemScale={setItemScale}
              rotateSelected={rotateSelected}
              deleteSelected={deleteSelected}
              placed={placed}
              onCollapse={() => setInspectorHidden(true)}
            />
          )
        )}
      </div>

      {/* ==================== METADATA EDITOR ==================== */}
      {showMeta && (
        <MetaEditor meta={displayMeta} updateMeta={updateMeta} onSheetField={setActiveSheet} onClose={() => setShowMeta(false)} />
      )}

      {/* ==================== PRINT PREVIEW ==================== */}
      {printPreview && (
        <PrintPreview
          project={project}
          legendItems={legendItems}
          colourMode={colourMode}
          symbolScale={symbolScale}
          DRAW={DRAW}
          onClose={() => setPrintPreview(false)}
          onPrint={printSheet}
        />
      )}

      {/* ==================== BILL OF QUANTITIES ==================== */}
      {showBoq && (
        <BillOfQuantities project={project} updateBoq={updateBoq} onClose={() => setShowBoq(false)} />
      )}

      {/* ==================== TITLE BLOCK TEMPLATE ==================== */}
      {showTitleBlock && (
        <TitleBlockEditor
          start={effectiveTitleBlock}
          isCustomised={!!project.titleBlock}
          onSaveProject={(tb) => updateProject({ titleBlock: tb })}
          onSaveDefault={(tb) => saveTitleBlock(tb)}
          onResetToDefault={() => updateProject({ titleBlock: null })}
          onClose={() => setShowTitleBlock(false)}
        />
      )}

      {showNotes && (
        <NotesEditor
          notes={notes}
          updateNotes={(n) => updateProject({ notes: n })}
          onClose={() => setShowNotes(false)}
        />
      )}

      {/* ==================== PROJECT MANAGER ==================== */}
      {showProjects && (
        <ProjectManager
          projectList={projectList}
          currentProjectId={currentProjectId}
          currentName={meta.projectName}
          onSaveAs={saveProjectAs}
          onOpen={openProjectById}
          onDelete={deleteProjectById}
          onNew={newProject}
          onClose={() => setShowProjects(false)}
        />
      )}

      {/* ==================== FLOOR PLAN — embedded sketch, same window ==================== */}
      {floorPlanOpen && (
        <div className="fixed inset-0 z-[60] bg-[#18222D]">
          <CadSketchPanel
            embedded
            openSketchId={floorPlanArgs?.openSketchId || null}
            linkProject={floorPlanArgs?.linkProject || null}
            linkSheet={floorPlanArgs?.linkSheet || null}
            linkName={floorPlanArgs?.linkName || null}
            onClose={() => setFloorPlanOpen(false)}
            onApplyPlan={applyFloorPlan}
          />
        </div>
      )}
    </div>
    </ProjectTitleBlockContext.Provider>
  );
}

