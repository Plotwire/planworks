"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Upload, Trash2, Save, FolderOpen, Download, Undo2, Redo2,
  MousePointer2, Cable, RotateCw, ZoomIn, ZoomOut, Maximize2,
  Palette, Ruler, Hand, Sparkles, Type, Printer, Settings,
  ChevronRight, X, FileText, Eye, EyeOff, Layers,
} from "lucide-react";
import { listProjects, getProjectData, getProjectRecord, deleteProjectRow, unreferencedPlanPaths } from "@/lib/db";
import { defaultDrawingName } from "@/lib/drawingName";
import { uploadPlanImage, signPlanImages, deletePlanImages, blobToDataUrl } from "@/lib/planImages";
import { looksLikePdf, renderPdfPlan } from "@/lib/pdfPlan";
import {
  SYMBOLS, SYMBOL_META, CATEGORY_COLOURS, VIEWBOX,
  findSymbol, findCategory, resolveColours,
} from "@/lib/symbols.jsx";
import { findFurniture, furnitureScale, FURNITURE_VIEWBOX, FURNITURE_COLOUR } from "@/lib/furniture.jsx";
import {
  TopBar, Palette as PalettePanel, Workspace, Inspector,
  FloatingToolbar, ZoomControls, WallTypeChooser, StatusBar, StatusCount, CollapsedPanel, MetaEditor, PrintPreview, BillOfQuantities,
  ProjectManager, SheetTabs, TitleBlockEditor, NotesEditor,
  ProjectTitleBlockContext,
} from "@/components/SheetParts";
import { useApp } from "@/components/AppShell";
import { openSketch } from "@/lib/device/sketches";
import { SHEET, DRAW } from "@/lib/cad/sheet";
import { applyPlanToSheet, scaleLabel, outsideNote } from "@/lib/cad/planScale";
import { DEFAULT_TITLEBLOCK } from "@/lib/titleBlock";
import { normaliseWireStrength, wireStrengthField } from "@/lib/wireStrength";
import { useTryUsage, useTryPrompt, TryPill, TryPrompt, LOCKED, drawingSymbolCount, refusedPrompt } from "@/components/TryMode";
import { ShortcutsCard, StatusHint, TOUCH } from "@/components/Shortcuts";
import dynamic from "next/dynamic";
const CadSketchPanel = dynamic(() => import("@/components/cad/CadSketch"), { ssr: false });
import { NeedsSignalBoundary } from "@/components/NeedsSignal";
import { useEditor } from "@/store/editorStore";
import { toDeviceForm, fromDeviceForm, deviceDrawing, rememberDrawing, forgetDrawing } from "@/lib/device/drawings";
import { planLinks, cachedPlanLinks, rememberUploadedPlan } from "@/lib/device/planCache";
import { queueSave, subscribeOutbox, outboxStatus, outboxReason, holdSync, releaseSync, discardSave, forgetSaves, pendingSaves, newDrawingId, syncNow } from "@/lib/device/outbox";
import { warmUpOffline } from "@/lib/device/warmUp";
import { registerPlanUpload } from "@/lib/device/uploads";
import { SyncStatus, syncView } from "@/components/SheetParts";
import { hasSignal, subscribeSignal, noteServer, looksLikeNoSignal } from "@/lib/device/connection";

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

// Sheet dimensions — A3 landscape at 96 DPI (web standard) — and the drawing
// area (DRAW): lib/cad/sheet, shared with components/SheetParts.jsx and the
// sketch's true-scale plan export (lib/cad/planScale).

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
// format (array of {heading, body} sections) into plain text. New drawings
// start with EMPTY notes; DEFAULT_NOTES_TEXT is only the fallback for older
// saved drawings that never had a notes field, so they keep what they showed.
function notesToText(n) {
  if (typeof n === "string") return n;
  if (Array.isArray(n)) return n.map(s => [s.heading, s.body].filter(Boolean).join("\n")).join("\n\n");
  return DEFAULT_NOTES_TEXT;
}

const sid = () => "s_" + Math.random().toString(36).slice(2, 9);

// A sheet holds one drawing (one floor). bgImage = imported plan. Each sheet
// has its OWN editable free-text notes.
function freshSheet(name = "Ground floor") {
  return { id: sid(), name, drawingNumber: "", bgImage: null, placed: [], furniture: [], walls: [], wires: [], annotations: [], notes: "", symbolScale: 1 };
}

// A project holds meta + drawings (sheets); notes live on each sheet.
// A new drawing is named after when it was started (lib/drawingName), so it
// can be told apart on the dashboard until the user names it.
function freshProject() {
  const sheet = freshSheet("Ground floor");
  return {
    meta: { ...DEFAULT_META, projectName: defaultDrawingName(), date: new Date().toISOString().slice(0, 10) },
    notes: "", // new drawings start with blank Installation Notes
    boq: null,
    titleBlock: null, // null = use the account default; set = job-specific
    colourMode: "red",     // new drawings start on Classic Red; the toolbar palette
                           // button still cycles red -> mono -> navy -> colour
    // (no wireStrength: new drawings start on Standard; see lib/wireStrength)
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
      // The sketch this sheet's plan was drawn in (Edit floor plan). Kept only
      // when present, so sheets without one are unchanged.
      ...(s.sketchId ? { sketchId: s.sketchId } : {}),
    }));
    // Wire lines: kept only when not Standard, so older drawings are unchanged.
    return { meta, notes: projNotesText, boq: p.boq || null, titleBlock: p.titleBlock || null, colourMode: p.colourMode || "colour", ...wireStrengthField(p.wireStrength), sheets, activeSheetId: sheets.find(s => s.id === p.activeSheetId) ? p.activeSheetId : sheets[0].id };
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
  return { meta, notes: projNotesText, boq: p.boq || null, titleBlock: p.titleBlock || null, colourMode: p.colourMode || "colour", ...wireStrengthField(p.wireStrength), sheets: [sheet], activeSheetId: sheet.id };
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

// Attach links (path -> url) as `src` / `pdfSrc` to the plans that don't have
// one yet. Plan images come from the copies kept on this device
// (lib/device/planCache), downloaded once per device; see linkPlansLater in
// the editor.
function linkPlans(p, links) {
  if (!p || !links || !links.size) return p;
  let changed = false;
  const sheets = (p.sheets || []).map(s => {
    const bg = s.bgImage;
    if (!bg) return s;
    let nbg = bg;
    if (bg.path && !bg.src && links.get(bg.path)) nbg = { ...nbg, src: links.get(bg.path) };
    if (bg.pdfPath && !bg.pdfSrc && links.get(bg.pdfPath)) nbg = { ...nbg, pdfSrc: links.get(bg.pdfPath) };
    if (nbg === bg) return s;
    changed = true;
    return { ...s, bgImage: nbg };
  });
  return changed ? { ...p, sheets } : p;
}

// A saved drawing's save state on this device (lib/device/outbox), or null
// when nothing of it is waiting. Never "synced" by default: green needs the
// server's word (syncView in components/SheetParts.jsx, `confirmed` below).
const syncLabel = (id) => (id ? outboxStatus(id) || null : null);

// Plans already on this device get their links now; the rest follow in the
// background (the editor's linkPlansLater).
async function hydrateImages(p) {
  try { return linkPlans(p, await cachedPlanLinks(collectImagePaths(p))); } catch { return p; }
}

// What the user has drawn, for "has anything changed since it was shown?":
// the project without the short-lived image links, the active tab or its row.
function editSignature(p) {
  try {
    return JSON.stringify({
      ...p, _recordId: null, activeSheetId: null,
      sheets: (p?.sheets || []).map(s => {
        const bg = s.bgImage;
        if (!bg) return s;
        const { src, pdfSrc, ...rest } = bg;
        return { ...s, bgImage: { ...rest, inline: !rest.path && typeof src === "string" ? src.slice(0, 120) : null } };
      }),
    });
  } catch { return String(Math.random()); }
}

const isBlobUrl = (url) => typeof url === "string" && url.startsWith("blob:");

// Uploads of original PDFs held only in this tab, by blob: link ->
// Promise<stored path>. Shared, so a retry never uploads the same large file
// twice, and a finished upload's path is reused.
const tabPdfUploads = new Map();
// PDFs that can never be stored: the server refused the file itself (too
// large, wrong type) or the tab no longer has it. Not retried this session.
// Offline and sign-in failures are NOT recorded, so a later save retries.
const tabPdfStoreFailed = new Set();

function isPermanentStoreError(err) {
  if (err?.tabCopyGone) return true;
  const status = String(err?.statusCode || err?.status || "");
  return err?.name === "StorageApiError" && (status === "413" || status === "415");
}

// Store an original PDF that exists only as a blob: link in this tab.
// Resolves to its stored path, or null if it couldn't be stored (yet).
async function storeTabOnlyPdf(pdfSrc) {
  if (!isBlobUrl(pdfSrc) || tabPdfStoreFailed.has(pdfSrc)) return null;
  let upload = tabPdfUploads.get(pdfSrc);
  if (!upload) {
    upload = (async () => {
      let pdf;
      try {
        pdf = await (await fetch(pdfSrc)).blob();
      } catch {
        throw Object.assign(new Error("the original PDF is no longer available in this tab"), { tabCopyGone: true });
      }
      return (await uploadPlanImage(pdf)).path;
    })();
    tabPdfUploads.set(pdfSrc, upload);
  }
  try {
    return await upload;
  } catch (err) {
    if (tabPdfUploads.get(pdfSrc) === upload) tabPdfUploads.delete(pdfSrc); // a later save may retry...
    if (isPermanentStoreError(err)) tabPdfStoreFailed.add(pdfSrc);          // ...unless it never can work
    console.warn("original PDF store failed (plan kept as image):", err?.message);
    return null;
  }
}

// After a save, copy any newly-minted paths back onto in-memory sheets while
// keeping their working display `src`, so subsequent saves/drafts stay tiny.
function mergeSavedPaths(current, safe) {
  if (!safe) return current;
  const byId = new Map((safe?.sheets || []).map(s => [s.id, s.bgImage]));
  return {
    ...current,
    sheets: (current?.sheets || []).map(s => {
      const safeBg = byId.get(s.id);
      if (safeBg && safeBg.path && s.bgImage && !s.bgImage.path) {
        return { ...s, bgImage: { ...s.bgImage, path: safeBg.path } };
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

// The crash-recovery drafts, one per kind, so opening a saved drawing never
// overwrites the backup of an unsaved new one:
//   DRAFT_KEY      the saved drawing last open: { projectId, version, savedAt, project }
//                  (version: the row's updated_at the work is based on)
//   NEW_DRAFT_KEY  the unsaved new drawing: { projectId: null, sessionKey, savedAt, project }
//                  (sessionKey: which new drawing, so its first save can clear it)
// The project carries _recordId, the row it was loaded from or first saved as
// (none for an unsaved drawing). components/EditorErrorBoundary.jsx and
// lib/deviceData.js know both keys.
const DRAFT_KEY = "planworks:draft:v1";
const NEW_DRAFT_KEY = "planworks:draft:new:v1";
// A backup handed from "Open as a new drawing" to the /new page (this tab only).
const HANDOFF_KEY = "planworks:openAsNew";

function readDraft(key) {
  try {
    const d = JSON.parse(window.localStorage.getItem(key) || "null");
    return d && d.project && typeof d.project === "object" ? d : null;
  } catch { return null; }
}
function writeDraft(key, draft) {
  try { window.localStorage.setItem(key, JSON.stringify(draft)); } catch { /* storage full / unavailable */ }
}
function removeDraft(key) {
  try { window.localStorage.removeItem(key); } catch { /* unavailable */ }
}
// The backup of an unsaved new drawing, if this device has one. The editor
// before this one kept it in DRAFT_KEY with no id; such a draft is moved
// across now, before the drawing being opened writes its own over it.
function readUnsavedDraft() {
  const d = readDraft(NEW_DRAFT_KEY);
  if (d) return d;
  const legacy = readDraft(DRAFT_KEY);
  if (legacy && !legacy.projectId && !legacy.project._recordId) {
    writeDraft(NEW_DRAFT_KEY, legacy);
    removeDraft(DRAFT_KEY);
    return legacy;
  }
  return null;
}
const newSessionKey = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
// A backup's work as an unsaved drawing: no row of its own.
function asUnsaved(p) {
  if (!p) return p;
  const { _recordId, ...rest } = p;
  return rest;
}

// Tool definitions
const TOOLS = {
  select: { icon: MousePointer2, label: "Select", hint: "V" },
  pan:    { icon: Hand,          label: "Pan",    hint: "H" },
  wire:   { icon: Cable,         label: "Wire",   hint: "W" },
  note:   { icon: Type,          label: "Note",   hint: "N" },
};

// The shortcuts card (components/Shortcuts.jsx, "?" or the Shortcuts button):
// every key the keyboard handler in ElectricalPlanTool takes, and the touch
// gestures the drawing handles. Keep them in step with the handlers.
const SHORTCUTS = [
  { title: "Draw", items: [
    ["Wire tool: link two symbols", ["w"]],
    ["Note tool", ["n"]],
    ["Stop: back to Select, clear the selection", ["esc"]],
  ] },
  { title: "Edit", items: [
    ["Select tool", ["v"]],
    ["Rotate the selected symbol 15°", ["r"]],
    ["Rotate in 15° steps (drag the handle)", ["shift+drag"]],
    ["Delete the selected item", ["del", "backspace"]],
    ["Undo", ["mod+z"]],
    ["Redo", ["mod+shift+z", "mod+y"]],
    ["Save", ["mod+s"]],
    ["Download a PDF or print", ["mod+p"]],
  ] },
  { title: "View", items: [
    ["Zoom in", ["plus", "="]],
    ["Zoom out", ["minus"]],
    ["Fit the sheet to the window", ["0"]],
    ["Close the print preview, quote, details or projects", ["esc"]],
    ["Keyboard shortcuts (this card)", ["?"]],
  ] },
  { title: "Navigate", items: [
    ["Pan tool", ["h"]],
    ["Pan while held", ["space+drag"]],
    ["Pan with any tool", ["mdrag"]],
    ["Pan by dragging an empty part of the sheet", ["drag"]],
    ["Zoom in or out at the pointer", ["wheel"]],
  ] },
];
const TOUCH_GESTURES = [
  { title: "Draw", items: [
    ["Add a symbol", "Drag it from the palette onto the drawing"],
    ["Scroll the palette", "Swipe up or down on it"],
    ["Wire two symbols", "Wire tool, then tap one symbol and the other"],
  ] },
  { title: "Edit", items: [
    ["Select", "Tap a symbol, note, wire or furniture piece"],
    ["Move", "Drag a symbol, note or furniture piece"],
    ["Rotate a symbol", "Drag its round handle"],
    ["Rotate or resize furniture", "Drag its handles"],
    ["Point a note's arrow", "Drag the dot at its tip"],
    ["Delete a symbol, note or wire", "Tap Delete in the inspector"],
    ["Undo or redo", "Tap the arrows in the top bar"],
    ["Rename a drawing", "Double-tap its tab"],
  ] },
  { title: "View", items: [
    ["Zoom", "Pinch with two fingers"],
    ["Zoom in, out or to fit", "The buttons at the top right"],
  ] },
  { title: "Navigate", items: [
    ["Pan", "Drag with two fingers, or drag an empty part of the sheet"],
  ] },
];

// ============================================================================
export default function ElectricalPlanTool({ initialTarget = null, onHome = null, theme = "light", onToggleTheme = null, onProjectId = null, onOpenFloorPlan = null, onOpenAsNew = null }) {
  // Project state
  const project = useEditor(s => s.project);
  const setProject = useEditor(s => s.setProject);
  const { meta, sheets, activeSheetId } = project;
  const activeSheet = sheets.find(s => s.id === activeSheetId) || sheets[0];
  const { bgImage, placed, wires, annotations, notes } = activeSheet;
  const furniture = activeSheet.furniture || [];
  const walls = activeSheet.walls || [];
  // A ref so async image uploads target the right sheet even if the user has
  // since switched floors.
  const activeSheetIdRef = useRef(project.activeSheetId);
  activeSheetIdRef.current = project.activeSheetId;

  // Title block: per-project, falling back to the account default for new jobs.
  const { titleBlock: accountTitleBlock, saveTitleBlock, access = {}, user } = useApp();
  // The signed-in account: this device's copies are kept under it (lib/device).
  const uidRef = useRef(user?.id || null);
  uidRef.current = user?.id || null;
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

  // Store a sheet's original PDF (held only as a blob: link in this tab) in
  // the background, and attach its path to the sheet once stored. Pressing
  // Save never waits for this: the raster plan is what a save must not lose.
  // The original is what keeps the plan sharp when zoomed and the export
  // vector, so a save made before it's stored waits for it in the outbox
  // (originalPdf in lib/device/outbox) and carries its path.
  const storeOriginalPdf = useCallback((sheetId, pdfSrc) => {
    const stored = storeTabOnlyPdf(pdfSrc);
    registerPlanUpload(pdfSrc, stored);
    stored.then((pdfPath) => {
      if (!pdfPath) return;
      setProject(p => ({
        ...p,
        sheets: p.sheets.map(s =>
          s.id === sheetId && s.bgImage && s.bgImage.pdfSrc === pdfSrc && !s.bgImage.pdfPath
            ? { ...s, bgImage: { ...s.bgImage, pdfPath, pdfPage: s.bgImage.pdfPage || 1 } }
            : s),
      }));
    });
  }, []);

  // Each save retries, in the background, any original PDF whose upload failed
  // earlier. Not for a sheet whose raster is still uploading: the import starts
  // the PDF itself once the raster is stored.
  const retryOriginalPdfs = (p) => {
    (p?.sheets || []).forEach(s => {
      const bg = s.bgImage;
      if (bg && !bg.pdfPath && isBlobUrl(bg.pdfSrc) && !planUploadsRef.current.has(s.id)) {
        storeOriginalPdf(s.id, bg.pdfSrc);
      }
    });
  };
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
  // Wire lines (View menu): saved on the drawing like the colours; Standard is
  // stored as no field at all (lib/wireStrength).
  const wireStrength = normaliseWireStrength(project.wireStrength);
  const setWireStrength = (v) => setProject(({ wireStrength: _old, ...p }) => ({ ...p, ...wireStrengthField(v) }));
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
  // This drawing's save status on this device (lib/device/outbox): "local",
  // "syncing", "synced", "waiting", "stuck" or "refused"; null when nothing
  // of it is waiting.
  const [syncState, setSyncState] = useState(null);
  // Has the server confirmed the version on screen, this session? true once
  // it was opened from the server, its version checked, or a save of it went
  // up; "gone" if the server no longer has it. Opened from this device's
  // copy, it's false until checked. (syncView, components/SheetParts.jsx.)
  const [confirmed, setConfirmedValue] = useState(false);
  const confirmedRef = useRef(false);
  const setConfirmed = (v) => { confirmedRef.current = v; setConfirmedValue(v); };
  // Signal, as lib/device/connection sees it: the status changes the moment
  // it goes or comes back.
  const [signal, setSignal] = useState(() => hasSignal());
  // What the drawing looked like when it was put on screen, to tell whether
  // it has been changed here since (checkLatest).
  const openedSigRef = useRef(null);
  // A short message about this drawing (a newer version arrived, ...).
  const [openNote, setOpenNote] = useState("");
  // Opening a saved drawing: "opening" until it arrives, then "ready";
  // "failed" (couldn't be fetched) or "missing" (no such drawing) if it
  // doesn't. Nothing can be edited or saved until "ready" (openProjectById).
  const [openState, setOpenStateValue] = useState(
    initialTarget?.mode === "open" && initialTarget.projectId ? "opening" : "ready");
  const openStateRef = useRef(openState);
  const setOpenState = (s) => { openStateRef.current = s; setOpenStateValue(s); };
  // False once this editor has closed. The drawing lives in a store that
  // outlives the editor (store/editorStore.ts), so nothing that finishes after
  // that may put anything in it.
  const aliveRef = useRef(true);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);
  // The version (updated_at) of each row this editor has loaded or saved, by
  // id: a save only writes over the version it was based on (writeRecord).
  const versionsRef = useRef(new Map());
  // The waiting saves this editor's work follows on from (lib/device/outbox):
  // the tag of its own last save of the drawing on screen, or of the save it
  // opened from (lastTagRef), and every tag it has written or opened from
  // (myTagsRef). A save only joins a waiting save it had seen, and only a
  // save of its own moves this editor on (the outbox listener): the same
  // drawing open in another tab can't write over this tab's work, or this
  // tab over that one's.
  const lastTagRef = useRef(null);
  const myTagsRef = useRef(new Set());
  const noteTag = (tag, current = true) => {
    if (!tag) return;
    myTagsRef.current.add(tag);
    if (current) lastTagRef.current = tag;
  };
  // Which unsaved new drawing this is, for its crash-recovery draft
  // (NEW_DRAFT_KEY); null once it has a row.
  const newKeyRef = useRef(null);
  // Try mode (components/TryMode.jsx): the account-wide symbol count, and the
  // "Subscribe to keep going" / locked-feature prompt. Callbacks that outlive a
  // render read the latest count through the ref.
  const tryUsage = useTryUsage({ enabled: access.isTry, limit: access.symbolLimit, currentProjectId, project, uid: user?.id });
  const tryUsageRef = useRef(tryUsage);
  tryUsageRef.current = tryUsage;
  const tryPrompt = useTryPrompt();
  // Lapsed subscription: read-only. Drawings open in the print preview (view,
  // download, print) and nothing is saved.
  const readOnly = Boolean(access.readOnly);
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  // Went read-only while this drawing was open (the 7-day past_due grace
  // ended, or the subscription was cancelled): changes since the last save
  // can't be saved any more, so leaving asks first (leaveToDashboard).
  const editableWhileOpen = useRef(!readOnly);
  const lapsedWhileOpen = useRef(false);
  useEffect(() => {
    if (!readOnly) { editableWhileOpen.current = true; lapsedWhileOpen.current = false; }
    else if (editableWhileOpen.current) lapsedWhileOpen.current = true;
  }, [readOnly]);
  // Read-only because a payment is owed, not because the subscription ended.
  const readOnlyNotice = access.paymentOverdue
    ? "Your last payment didn’t go through, so this drawing is view-only until it’s paid. You can still download and print it, and its quote."
    : "Your subscription has ended, so this drawing is view-only. You can still download and print it, and its quote.";
  const [floorPlanOpen, setFloorPlanOpen] = useState(false);
  const [floorPlanArgs, setFloorPlanArgs] = useState(null);
  const [planGone, setPlanGone] = useState(false); // linked sketch was deleted
  const [shortcutsOpen, setShortcutsOpen] = useState(false); // the shortcuts card ("?")

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
  // The drawing area (DRAW, lib/cad/sheet) occupies the centre of the sheet,
  // bounded by margins, legend column, notes column, and title block.

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
      await enqueueSave(updated, async ({ p, id, stillLoaded }) => {
        try {
          // Only over the drawing's own row, at the version it was based on;
          // otherwise nothing is written now and the next Save keeps the work
          // as a new drawing (saveProject).
          const r = await writeRecord(p, id, drawingName(p));
          if (!r.ok) return false;
          const safe = r.safe;
          if (stillLoaded()) setProject(prev => mergeSavedPaths(prev, safe));
          // Same confirmation the Save button gives, so the rename visibly sticks.
          setSavedFlash(true);
          setTimeout(() => setSavedFlash(false), 1500);
          return true;
        } catch (err) {
          // Keep the new name on screen -- it is still in state and goes up with
          // the next Save; only the immediate write failed.
          console.error("Rename save failed:", err);
          return false;
        }
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- enqueueSave only touches refs

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
  // The plan being replaced keeps its stored file: the saved row still points
  // at it until the next save, and a Save As copy may point at it for good.
  const setPlanImageFromBlob = (blob, w, h, existingObjectUrl = null, sourcePdf = null) => {
    const targetId = activeSheetIdRef.current;
    const displayUrl = existingObjectUrl || URL.createObjectURL(blob);
    // For PDFs, mint a LOCAL link to the original right away so the crisp windowed
    // renderer switches on the instant the plan is imported — no save/reopen needed.
    // This link is transient (blob: URL) and is stripped before any save; the
    // permanent copy is uploaded below and re-linked by hydrateImages on next load.
    const pdfNow = sourcePdf ? { pdfSrc: URL.createObjectURL(sourcePdf), pdfPage: 1 } : {};
    patchSheetById(targetId, { bgImage: { src: displayUrl, w, h, ...pdfNow }, sketchId: null });
    setTimeout(fitToScreen, 60);
    // Registered BEFORE the upload starts, so a save that follows immediately
    // always finds it: the outbox waits for this upload rather than sending the
    // plan twice (registerPlanUpload below, lib/device/uploads).
    const upload = { displayUrl, done: null };
    planUploadsRef.current.set(targetId, upload);
    // A slow upload must never put an older plan back. Its result lands only
    // while it is the sheet's newest import AND the sheet still shows it (it
    // may since have been replaced by a Floor Plan, say). A superseded upload
    // changes nothing, but `done` still resolves with its bgImage for a save
    // whose snapshot shows this plan.
    const isNewest = () => planUploadsRef.current.get(targetId) === upload;
    const applyToSheet = (bg) => setProject(p => ({
      ...p,
      sheets: p.sheets.map(s => (s.id === targetId && s.bgImage?.src === displayUrl ? { ...s, bgImage: bg } : s)),
    }));
    // `done` settles once the raster plan is stored -- the part a save must
    // wait for. The original PDF (larger, optional) follows in the background.
    upload.done = (async () => {
      try {
        const { path } = await uploadPlanImage(blob);
        // Kept on this device under its stored path: never downloaded again here.
        rememberUploadedPlan(path, blob);
        const storedBg = { src: displayUrl, w, h, path, ...pdfNow };
        if (isNewest()) {
          applyToSheet(storedBg);
          if (pdfNow.pdfSrc) storeOriginalPdf(targetId, pdfNow.pdfSrc);
        }
        return storedBg;
      } catch (err) {
        console.warn("plan image upload failed; using inline fallback:", err?.message);
        try {
          const dataUrl = await blobToDataUrl(blob);
          const inlineBg = { src: dataUrl, w, h, ...pdfNow };
          if (isNewest()) applyToSheet(inlineBg);
          return inlineBg;
        } catch {
          return null; // keep the object URL for this session at least
        }
      } finally {
        // A newer import on the same sheet replaces this entry; only clear our own.
        if (planUploadsRef.current.get(targetId) === upload) planUploadsRef.current.delete(targetId);
      }
    })();
    // A save made before this finishes keeps the plan on the device, and its
    // upload (lib/device/outbox) waits for this one rather than sending it again.
    registerPlanUpload(displayUrl, upload.done.then(bg => bg?.path || null));
  };

  const handleFile = async (file) => {
    if (!file) return;
    // By its bytes too: a PDF taken for a picture is drawn at 1 pixel per
    // point by Safari, and stored like that (lib/pdfPlan.js).
    const isPdf = await looksLikePdf(file);
    if (isPdf) {
      setPdfLoading(true);
      try {
        // Stored as a PDF even when it came without the type or the name.
        const pdfFile = file.type === "application/pdf" ? file
          : new File([file], (file.name || "plan").replace(/\.pdf$/i, "") + ".pdf", { type: "application/pdf" });
        const { blob, w, h } = await renderPdfPlan(await pdfFile.arrayBuffer());
        setPlanImageFromBlob(blob, w, h, null, pdfFile);
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
    // The drawing this drag began on. Dropped onto another one (it arrived
    // mid-drag), startPlaced would replace that drawing's symbols.
    const startGen = loadGenRef.current;
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
      if (loadGenRef.current !== startGen || openStateRef.current !== "ready") return;
      const { x, y } = clientToDrawing(ev.clientX, ev.clientY);
      if (x < 0 || y < 0 || x > DRAW.w || y > DRAW.h) return; // released off the sheet → ignore
      if (!tryUsageRef.current.canAdd(1)) { tryPrompt.show(LOCKED.limit); return; } // Try mode: at the limit
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
    if (!tryUsageRef.current.canAdd(1)) { tryPrompt.show(LOCKED.limit); return; } // Try mode: at the limit
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
  // (listed for the shortcuts card in SHORTCUTS, above)
  useEffect(() => {
    const onKey = (e) => {
      // The floor-plan sketch open over the editor owns the keyboard: no
      // editor shortcut (Delete, R, W, Ctrl+Z...) may act on the hidden sheet.
      if (floorPlanOpen) return;
      // Nor while a drawing is opening (or failed to): nothing is editable.
      if (openStateRef.current !== "ready") return;
      const isInput = e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable;
      if (e.code === "Space" && !isInput) {
        e.preventDefault();
        setSpacePressed(true);
      }
      if (isInput) return;
      // "?" opens the shortcuts card, not over another window (the floor plan
      // sketch has its own). While it is open the card takes every key first
      // (components/Shortcuts.jsx), so none of these reach here.
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!e.repeat && !floorPlanOpen && !printPreview && !readOnly && !showMeta && !showBoq && !showTitleBlock && !showNotes && !showProjects && !planGone && !tryPrompt.prompt) {
          e.preventDefault(); setShortcutsOpen(true);
        }
        return;
      }
      if (wallDraft && e.key === "Escape") { e.preventDefault(); cancelWall(); return; }
      if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
      else if (e.key === "r" || e.key === "R") rotateSelected();
      else if (e.key === "Escape") { setSelectedId(null); setSelectedFurnId(null); setSelectedWallId(null); setSelectedAnnoId(null); setSelectedWireId(null); setWireStart(null); setTool("select"); setPrintPreview(false); setShowMeta(false); setShowBoq(false); setShowProjects(false); }
      // Lower-cased with Shift checked: ⌘⇧Z comes through as "z" on a Mac (and
      // Caps Lock makes Ctrl+Z a "Z"), so the key alone can't tell undo from redo.
      else if ((e.metaKey || e.ctrlKey) && (e.key || "").toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.metaKey || e.ctrlKey) && ((e.key || "").toLowerCase() === "y" || (e.shiftKey && (e.key || "").toLowerCase() === "z"))) { e.preventDefault(); redo(); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); saveProject(); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        if (tryUsageRef.current.enabled) tryPrompt.show(LOCKED.export); // Try mode: printing is locked
        else setPrintPreview(true);
      }
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

  // The list is only needed by the Projects window, which loads it when it
  // opens (onShowProjects): not fetched on every open of a drawing.

  // Let the route layer know the current project id (for linkable URLs).
  useEffect(() => {
    if (currentProjectId && onProjectId) onProjectId(currentProjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId]);

  // ---------- Save queue ----------
  // Saves run one at a time, in the order they were asked for, and the editor
  // stays usable meanwhile. A save can wait on a plan upload, so:
  //   - a save that had to wait for an earlier one saves the project as it is
  //     when its turn comes, so edits made during the wait are included, and
  //     a second Save of a new drawing updates the row the first one created;
  //   - loadGenRef changes whenever a different project is put in the editor.
  //     A save that runs or finishes after that -- or after the editor has
  //     closed -- writes the snapshot it was asked to save, to the row it was
  //     asked for, and leaves the editor (now showing another drawing, or
  //     another editor's) alone.
  // Whatever row a save is aimed at, it only writes over it through
  // writeRecord, below.
  const saveQueueRef = useRef(Promise.resolve());
  const queuedSavesRef = useRef(0);
  const loadGenRef = useRef(0);
  const enqueueSave = (snapshot, save) => {
    const gen = loadGenRef.current;
    const requestedId = currentProjectIdRef.current;
    const waited = queuedSavesRef.current > 0;
    queuedSavesRef.current += 1;
    const turn = saveQueueRef.current.then(() => {
      const stillLoaded = () => aliveRef.current && loadGenRef.current === gen;
      const current = stillLoaded();
      return save({
        // The store, not projectRef: a save queued behind a first Save sees
        // the row id that save stamped on the project before any re-render.
        p: current && waited ? useEditor.getState().project : snapshot,
        id: current ? currentProjectIdRef.current : requestedId,
        stillLoaded,
      });
    });
    const done = turn.finally(() => { queuedSavesRef.current -= 1; });
    saveQueueRef.current = done.catch(() => {});
    return done;
  };
  // Resolves once no save is queued or running, including saves queued while
  // it waits. Never rejects: the chain in saveQueueRef swallows save errors.
  const whenSavesSettled = async () => {
    while (queuedSavesRef.current > 0) await saveQueueRef.current;
  };

  // The save is on this device (lib/device/outbox uploads it). The Projects
  // list and Try totals are refreshed when it reaches the server (the outbox
  // listener below).
  const confirmSaved = () => {
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  };

  // ---------- Save guard ----------
  // A drawing's row is only ever written over with that drawing's own work:
  //   - the project on screen carries _recordId, the row it was loaded from
  //     (openProjectById) or first saved as (insertAsNewProject). Anything
  //     else put in the editor -- a new drawing, a backup kept as a new
  //     drawing -- has none, and a project that reached the store from
  //     anywhere else would carry another row's id;
  //   - the write only lands if the row is still at the version this editor
  //     loaded or last saved (versionsRef). A tab or device that has been
  //     sitting on an older copy can't overwrite a newer save made elsewhere.
  // Either check failing writes nothing: saveProject keeps the work as a new
  // drawing instead (keepAsNewDrawing).
  //
  // Saves go to this device first (lib/device/outbox): writeRecord puts the
  // work on the device and returns at once; the outbox uploads it in the
  // background, retrying until there is signal, and only over the version it
  // was based on. If that version has changed or gone by then, the outbox
  // keeps the work as "<name> (copy)" and the listener below moves the editor
  // onto the copy and says so, as keepAsNewDrawing does.
  const belongsTo = (p, id) => Boolean(id && p && p._recordId === id && versionsRef.current.has(id));
  // Resolves to { ok: true, queued: true } once the work is on this device,
  // or { ok: false, reason } with nothing saved: "other" (not this row's
  // work) or "changed" (another tab's save of it is waiting). Throws only if
  // the device couldn't take it.
  const writeRecord = async (p, id, name) => {
    if (!belongsTo(p, id)) return { ok: false, reason: "other" };
    retryOriginalPdfs(p);
    const data = await toDeviceForm(p);
    const r = await queueSave({ id, name, data, base: versionsRef.current.get(id), expect: lastTagRef.current });
    // Another tab's save of this drawing is waiting, made after this one
    // last looked: kept as a copy (saveProject), never merged over it.
    if (r.conflict) return { ok: false, reason: "changed" };
    noteTag(r.tag);
    setSyncState(syncLabel(id));
    return { ok: true, queued: true };
  };
  // The name a save gives the row: the project name (a new drawing starts
  // with one, freshProject), else what unnamed drawings have always been.
  const drawingName = (p) => p?.meta?.projectName || "Untitled drawing";

  // Quick-save: writes to the currently open project, or creates one if new.
  // Nothing while a drawing is opening or failed to open: there is no
  // drawing on screen to save.
  const saveProject = () => {
    if (openStateRef.current !== "ready") return Promise.resolve(false);
    return enqueueSave(useEditor.getState().project, async ({ p, id, stillLoaded }) => {
      if (readOnlyRef.current) return false; // lapsed: read-only
      if (!id) {
        // Try mode: the database would refuse a save over the limit; say so first.
        if (tryUsageRef.current.blocksSave(null)) { tryPrompt.show(LOCKED.limit); return false; }
        return insertAsNewProject(p, p.meta?.projectName || defaultDrawingName(), { stillLoaded, rename: false });
      }
      // Kept as a new drawing below, which counts as one in Try mode.
      if (tryUsageRef.current.blocksSave(belongsTo(p, id) ? id : null)) { tryPrompt.show(LOCKED.limit); return false; }
      try {
        const r = await writeRecord(p, id, drawingName(p));
        if (!r.ok) return keepAsNewDrawing(p, r.reason, { stillLoaded });
        if (stillLoaded()) setProject(prev => mergeSavedPaths(prev, r.safe));
        confirmSaved();
        return true;
      } catch (err) {
        alert("Save failed: " + (err.message || err));
        return false;
      }
    });
  };

  // A save that may not write over its row (writeRecord) keeps the work as a
  // new drawing, named as a copy so the two can be told apart, and says so.
  // The row it was aimed at is left exactly as it is.
  const keepAsNewDrawing = async (p, reason, { stillLoaded }) => {
    if (tryUsageRef.current.blocksSave(null)) { tryPrompt.show(LOCKED.limit); return false; }
    const base = drawingName(p);
    const name = /\(copy\)$/.test(base) ? base : `${base} (copy)`;
    const ok = await insertAsNewProject(p, name, { stillLoaded, rename: true });
    if (ok) {
      const why = reason === "changed"
        ? "This drawing was changed or deleted somewhere else (another tab or device) after it was opened here, so your version can't replace it."
        : "What's on screen didn't come from this drawing, so it can't replace it.";
      setTimeout(() => window.alert(`${why}\n\nYour work has been saved as a new drawing, "${name}". The other drawing hasn't been changed.`), 0);
    }
    return ok;
  };

  // Apply a plan handed back from the embedded Floor Plan sketch, in place (no navigation).
  // scale / frame: the true scale and plan frame it was drawn at
  // (lib/cad/planScale). When that moved the plan on the sheet (a new scale,
  // or a plan that outgrew its frame), everything placed on the sheet moves
  // with it so each item stays on the same spot of the plan, and the title
  // block's Scale is set to match. That one is project-wide: with more than
  // one floor it shows the last plan sent. onSaved: the sketch moves its link
  // on to the new frame and scale once the drawing is saved with them.
  const applyFloorPlan = async ({ path, w, h, dataUrl, sketchId, sheetId, scale = null, frame = null, remap = null, legacyFrame = null, manual = false, stairs = null, onSaved = null }) => {
    const sid = sheetId || activeSheetIdRef.current;
    const plan = { path, w, h, src: dataUrl, sketchId, frame, scale, oldFrame: remap && remap.oldFrame, legacyFrame, stairs };
    const withPlan = (prev) => {
      let moved = false, outside = 0;
      const sheets = prev.sheets.map(s => {
        if (s.id !== sid) return s;
        const r = applyPlanToSheet(s, plan);
        if (r.remapped) { moved = true; outside = r.outside; }
        return r.sheet;
      });
      const next = { ...prev, sheets, ...(scale && sheets.some(s => s.id === sid) ? { meta: { ...prev.meta, scale: scaleLabel(scale) } } : {}) };
      return { next, moved, outside };
    };
    // Worked out now from the project as shown (the editor sits behind the
    // sketch, so nothing has changed it), as well as in the update below,
    // which React may only run later: the save never waits on that.
    const dry = withPlan(projectRef.current);
    let done = null;
    setProject(prev => { done = withPlan(prev); return done.next; });
    const { next: updated, moved, outside } = done || dry;
    // Undo must not put symbols back where they were on the old plan.
    if (moved) { setHistory([]); setFuture([]); }
    setFloorPlanOpen(false);
    if (currentProjectIdRef.current) {
      const ok = await enqueueSave(updated, async ({ p, id, stillLoaded }) => {
        try {
          // As renameSheet: only over its own row (writeRecord), else the
          // next Save keeps it as a new drawing.
          const r = await writeRecord(p, id, drawingName(p));
          if (!r.ok) return false;
          if (stillLoaded()) setProject(prev => mergeSavedPaths(prev, r.safe));
          return true;
        } catch (err) {
          console.error("Floor plan save failed:", err);
          return false;
        }
      });
      if (ok) onSaved?.();
    } else onSaved?.(); // no row yet: the sheet carries its frame into the first Save
    // Items the re-map left outside the drawing area: say so once the new plan is showing.
    if (outside) setTimeout(() => window.alert(outsideNote(outside, scale, manual)), 0);
  };

  // Save As: store the current canvas as a new named project (new cloud row)
  // Try mode: a copy keeps the original, so its symbols count twice.
  const saveProjectAs = (name) => {
    if (openStateRef.current !== "ready") return Promise.resolve(false);
    return enqueueSave(useEditor.getState().project, ({ p, stillLoaded }) => {
      if (readOnlyRef.current) return false; // lapsed: read-only
      if (tryUsageRef.current.blocksSave(null)) { tryPrompt.show(LOCKED.limit); return false; }
      return insertAsNewProject(p, name || p.meta?.projectName || defaultDrawingName(), { stillLoaded, rename: true });
    });
  };

  // Insert `p` as a new project row named `name`. Used by Save As and when a
  // save keeps its work as a new drawing (rename: true -- the editor takes the
  // new name), and by the first Save of a new drawing (rename: false -- a name
  // typed while it waited is kept).
  // Saved to this device at once with the id the new row will have, and
  // uploaded by the outbox (lib/device/outbox). Until it is, the version is
  // unknown (undefined): later saves of it join the waiting upload.
  const insertAsNewProject = async (p, name, { stillLoaded, rename }) => {
    try {
      const id = newDrawingId();
      retryOriginalPdfs(p);
      const data = await toDeviceForm({ ...p, meta: { ...p.meta, projectName: name } });
      const { tag } = await queueSave({ id, name, data, kind: "insert" });
      noteTag(tag, false);
      versionsRef.current.set(id, undefined);
      const safe = null;
      // A new drawing's crash-recovery backup is saved work from now on.
      if (newKeyRef.current && readDraft(NEW_DRAFT_KEY)?.sessionKey === newKeyRef.current) {
        removeDraft(NEW_DRAFT_KEY);
      }
      if (stillLoaded()) {
        // Set the ref now, not on the next render: a save queued behind this
        // one must update this row, not insert another. The project in the
        // store is stamped with the row at once for the same reason (the save
        // guard, writeRecord).
        currentProjectIdRef.current = id;
        newKeyRef.current = null;
        lastTagRef.current = tag;
        setCurrentProjectId(id);
        setSyncState(syncLabel(id));
        // Merged into the live project, so edits made while this save waited
        // on an upload survive.
        setProject(prev => ({
          ...mergeSavedPaths({
            ...prev,
            meta: { ...prev.meta, projectName: rename ? name : (prev.meta.projectName || name) },
          }, safe),
          _recordId: id,
        }));
      }
      confirmSaved();
      return true;
    } catch (err) {
      alert("Save failed: " + (err.message || err));
      return false;
    }
  };

  // Open the saved drawing `id` in this editor. Until it arrives the editor
  // shows "Opening drawing…" and nothing can be edited or saved (openState).
  // Only the newest open, in an editor still on screen, may land: an answer
  // that comes back after the editor closed or after a newer open is dropped,
  // so a slow connection can never put one drawing into another's editor.
  // initial: the open this editor was started for. It may offer the
  // crash-recovery backup, and if it fails it offers Retry or Back instead of
  // leaving a blank sheet that looks like the drawing.
  //
  // A drawing kept on this device (lib/device/drawings) opens at once from
  // that copy, editable straight away, and the server's version is checked in
  // the background (checkLatest). One that isn't is fetched as before, behind
  // "Opening drawing…". Plan images never hold up the open: they are shown
  // from this device's copies, or arrive in the background (linkPlansLater).
  const openSeqRef = useRef(0);
  const openProjectById = async (id, { initial = false } = {}) => {
    const seq = ++openSeqRef.current;
    const live = () => aliveRef.current && openSeqRef.current === seq;
    const uid = uidRef.current;

    // ---- This device's copy, if it has one ----
    let local = null, waiting = null;
    try {
      local = uid ? await deviceDrawing(uid, id) : null;
      waiting = uid ? (await pendingSaves(uid)).find(e => e.id === id) || null : null;
    } catch { local = null; waiting = null; }
    if (!live()) return;
    // A save of it still waiting is the newest work on this device.
    const kept = waiting && waiting.data ? waiting.data : local && local.data;
    if (kept) {
      // Nothing of this drawing goes up while its latest version is checked.
      holdSync(id);
      let shown = null;
      try {
        const np = normaliseProject(await fromDeviceForm(kept));
        const links = await cachedPlanLinks(collectImagePaths(np));
        shown = { ...linkPlans(np, links), activeSheetId: np.sheets[0].id, _recordId: id };
      } catch (err) {
        console.warn("device copy unreadable:", err?.message || err);
      }
      if (!live()) { releaseSync(id); return; }
      if (shown) {
        // Based on the version its waiting save was (if it has one), else the
        // version this copy is.
        const version = waiting ? waiting.base : local.version;
        showOpened(id, shown, version, initial, waiting ? waiting.tag : null);
        // A new drawing still waiting to upload has no server copy yet.
        if (waiting && waiting.kind === "insert") releaseSync(id);
        else checkLatest(id, seq, editSignature(shown), version, Boolean(waiting));
        return;
      }
      releaseSync(id);
    }

    // ---- Not on this device: fetched, as before ----
    setOpenState("opening");
    let loaded = null, version = null, missing = false;
    try {
      const rec = await getProjectRecord(id, { timeoutMs: 60000 });
      if (!live()) return;
      if (!rec || !rec.data) {
        missing = true;
      } else {
        const np = normaliseProject(rec.data);
        const links = await cachedPlanLinks(collectImagePaths(np));
        if (!live()) return;
        // Always open on the first drawing (ground floor), regardless of which
        // sheet was active when the project was last saved. Stamped with its
        // row: only this work may be saved over it (writeRecord).
        loaded = { ...linkPlans(np, links), activeSheetId: np.sheets[0].id, _recordId: id };
        version = rec.version;
        if (uid) rememberDrawing(uid, id, { name: rec.data?.meta?.projectName || "", data: rec.data, version });
      }
    } catch (err) {
      console.warn("Open failed:", err?.message || err);
      if (looksLikeNoSignal(err)) noteServer(false);
      if (!live()) return;
    }
    if (!loaded) {
      if (initial) { setOpenState(missing ? "missing" : "failed"); return; }
      setOpenState("ready"); // the drawing already on screen stays
      alert(missing ? "Could not find that project." : "Open failed.");
      return;
    }
    noteServer(true);
    showOpened(id, loaded, version, initial, null, true);
  };

  // Put an opened drawing on screen (either path above). fromServer: just
  // fetched from the server, so its version is confirmed; from this device's
  // copy it isn't, until checkLatest hears back.
  const showOpened = (id, loaded, version, initial, tag = null, fromServer = false) => {
    setConfirmed(fromServer);
    openedSigRef.current = editSignature(loaded);
    versionsRef.current.set(id, version);
    lastTagRef.current = null;
    noteTag(tag);
    // Read now, before this drawing's own backup is written over the draft.
    const offer = initial ? draftOfferOnOpen(id, version, loaded) : null;
    // Bumped only when the project actually arrives: a save asked for before
    // this never binds to or merges into it, while a save that finishes
    // first -- or an open that fails -- still binds to the drawing on screen.
    loadGenRef.current += 1;
    setProject(loaded);
    currentProjectIdRef.current = id;
    setCurrentProjectId(id);
    setSyncState(syncLabel(id));
    setOpenNote("");
    setOpenState("ready");
    setShowProjects(false);
    setHistory([]); setFuture([]);
    setRecovery(offer);
    setTimeout(fitToScreen, 50);
    linkPlansLater();
  };

  // The server's version of a drawing opened from this device's copy. If it
  // is newer and nothing has been changed here since it was shown, the newer
  // version replaces it on screen. If something has (or this device had a
  // save of its own waiting), the work here is kept: when it goes up, the
  // outbox finds the newer version and saves it as "(copy)" -- the drawing
  // safety rule. With no signal, the device copy simply carries on, and the
  // check runs again when signal returns (the signal effect below).
  // sigShown: editSignature of the drawing as it was put on screen.
  const checkingRef = useRef(false);
  const checkLatest = async (id, seq, sigShown, version, hadWaiting) => {
    const live = () => aliveRef.current && openSeqRef.current === seq;
    checkingRef.current = true;
    try {
      const rec = await getProjectRecord(id, { timeoutMs: 60000 });
      noteServer(true);
      if (!live()) return;
      if (!rec || !rec.data) {
        setConfirmed("gone");
        setOpenNote("This drawing has been deleted somewhere else. Saving keeps your work as a new drawing.");
        return;
      }
      if (rec.version === version) { setConfirmed(true); return; } // this device's copy is the latest
      const edited = editSignature(useEditor.getState().project) !== sigShown;
      if (hadWaiting || edited) {
        setOpenNote("A newer version of this drawing was saved on another device. Your changes here will be saved as a copy.");
        return;
      }
      // Nothing changed here: a save asked for since holds nothing new.
      if (await discardSave(id, lastTagRef.current)) lastTagRef.current = null;
      const np = normaliseProject(rec.data);
      const links = await cachedPlanLinks(collectImagePaths(np));
      if (!live() || editSignature(useEditor.getState().project) !== sigShown) return;
      versionsRef.current.set(id, rec.version);
      const latest = {
        ...linkPlans(np, links),
        activeSheetId: np.sheets[0].id,
        _recordId: id,
      };
      setProject(prev => ({
        ...latest,
        activeSheetId: np.sheets.some(s => s.id === prev.activeSheetId) ? prev.activeSheetId : np.sheets[0].id,
      }));
      openedSigRef.current = editSignature(latest);
      setHistory([]); setFuture([]);
      setSyncState(syncLabel(id));
      setConfirmed(true);
      const uid = uidRef.current;
      if (uid) rememberDrawing(uid, id, { name: rec.data?.meta?.projectName || "", data: rec.data, version: rec.version });
      setOpenNote("Updated to the latest version from the server.");
      setTimeout(() => setOpenNote(n => (n.startsWith("Updated to the latest") ? "" : n)), 4000);
      linkPlansLater();
    } catch (err) {
      // No signal: carry on with this device's copy.
      console.warn("latest version check failed:", err?.message || err);
      if (looksLikeNoSignal(err)) noteServer(false);
    } finally {
      checkingRef.current = false;
      releaseSync(id);
    }
  };

  // Signal gone or back (lib/device/connection): the status follows at once.
  // Back, and the drawing on screen came from this device's copy without
  // being checked (and nothing of it waits to upload, which would confirm
  // it): checked now.
  useEffect(() => subscribeSignal((now) => {
    setSignal(now);
    const id = currentProjectIdRef.current;
    if (!now || !id || confirmedRef.current || checkingRef.current || openStateRef.current !== "ready") return;
    if (outboxStatus(id)) return;
    if (!versionsRef.current.has(id) || versionsRef.current.get(id) === undefined) return;
    checkLatest(id, openSeqRef.current, openedSigRef.current, versionsRef.current.get(id), false);
  }), []); // eslint-disable-line react-hooks/exhaustive-deps -- refs and stable setters only

  // Plans without a link yet: images from this device's copies or downloaded
  // once (planCache), each shown as it arrives; original PDFs from the kept
  // copy if any, else a signed link as before, kept for next time in the
  // background. Never holds anything up; tried again when signal returns.
  const linkPlansLater = () => {
    const gen = loadGenRef.current;
    const ok = () => aliveRef.current && loadGenRef.current === gen;
    const p = useEditor.getState().project;
    const sheets = p?.sheets || [];
    const images = sheets.map(s => s.bgImage).filter(bg => bg && bg.path && !bg.src).map(bg => bg.path);
    const pdfs = sheets.map(s => s.bgImage).filter(bg => bg && bg.pdfPath && !bg.pdfSrc).map(bg => bg.pdfPath);
    if (images.length) {
      planLinks(images, { onEach: (path, link) => { if (ok()) setProject(prev => linkPlans(prev, new Map([[path, link]]))); } })
        .catch(() => {});
    }
    if (pdfs.length) {
      (async () => {
        const kept = await cachedPlanLinks(pdfs);
        const missing = pdfs.filter(x => !kept.has(x));
        const signed = missing.length ? await signPlanImages(missing) : new Map();
        if (ok()) setProject(prev => linkPlans(prev, new Map([...signed, ...kept])));
        if (missing.length) planLinks(missing).catch(() => {});
      })().catch(() => {});
    }
  };
  useEffect(() => {
    const again = () => linkPlansLater();
    window.addEventListener("online", again);
    return () => window.removeEventListener("online", again);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- reads the store, not props

  // Once the drawing is up and nothing is happening, fetch the code the PDF
  // downloads, the quote, the sketch tool and PDF plans use, so they work
  // later without signal (lib/device/warmUp.js).
  useEffect(() => {
    if (openState !== "ready") return;
    return warmUpOffline({ delayMs: 5000 });
  }, [openState]);

  // Saves reaching the server (lib/device/outbox): the editor catches up.
  useEffect(() => subscribeOutbox((ev) => {
    const cur = currentProjectIdRef.current;
    if (ev.type === "status") {
      if (!ev.id || ev.id === cur) setSyncState(syncLabel(cur));
      return;
    }
    // The account wouldn't take this drawing's save (over the trial limit,
    // or no active subscription): it stays on this device; say why.
    if (ev.type === "refused") {
      if (ev.id === cur) tryPrompt.show(refusedPrompt(ev.reason, access.symbolLimit));
      return;
    }
    if (ev.previousId !== cur && ev.id !== cur) return; // another drawing
    // Not this editor's work (the same drawing saved in another tab): this
    // editor stays on the version it had, so its next save can't write over
    // that one (it becomes a copy).
    if (!ev.tag || !myTagsRef.current.has(ev.tag)) return;
    versionsRef.current.set(ev.id, ev.version);
    if (ev.id !== ev.previousId) {
      // Now a different row: the copy, or the id the database chose.
      versionsRef.current.delete(ev.previousId);
      currentProjectIdRef.current = ev.id;
      setCurrentProjectId(ev.id);
    }
    setProject(prev => {
      if (prev._recordId !== ev.previousId && prev._recordId !== ev.id) return prev;
      const next = { ...mergeSavedPaths(prev, ev.safe), _recordId: ev.id };
      return ev.type === "copied" ? { ...next, meta: { ...next.meta, projectName: ev.name } } : next;
    });
    setSyncState(syncLabel(ev.id));
    setConfirmed(true); // the server has this editor's latest save
    tryUsageRef.current.refresh(); // Try mode: the saved totals just changed
    if (ev.type === "copied") {
      const why = ev.reason === "deleted"
        ? "This drawing was deleted somewhere else after it was opened here, so your version can't go back into it."
        : "This drawing was changed somewhere else (another tab or device) after it was opened here, so your version can't replace it.";
      setTimeout(() => window.alert(`${why}\n\nYour work has been saved as a new drawing, "${ev.name}". The other drawing hasn't been changed.`), 0);
    }
  }), []); // eslint-disable-line react-hooks/exhaustive-deps -- refs and stable setters only
  // "Retry" after a failed first open.
  const retryOpen = () => {
    if (initialTarget?.projectId) openProjectById(initialTarget.projectId, { initial: true });
  };

  const deleteProjectById = async (id) => {
    try {
      // Note the project's stored files before its row goes.
      let paths = [];
      try {
        const data = await getProjectData(id);
        if (data) paths = collectImagePaths(normaliseProject(data));
      } catch { /* still delete the row even if we can't read it */ }
      await deleteProjectRow(id);
      // Nor kept on this device any more, nor any save of it still waiting.
      forgetDrawing(uidRef.current, id);
      forgetSaves(id);
      // Then, in the background, remove only the files nothing still uses.
      // Checked once this tab's saves have settled: a Save As still waiting on
      // an upload is about to insert a row that shares these files. Kept: any
      // file a remaining row refers to (a Save As copy shares its source's
      // files), the canvas shows (a deleted open drawing stays on screen and
      // can be saved again), or a save waiting on this device will refer to.
      if (paths.length) {
        whenSavesSettled()
          .then(async () => {
            const onCanvas = new Set(collectImagePaths(projectRef.current));
            const waiting = new Set((await pendingSaves(uidRef.current)).flatMap(e => collectImagePaths(e.data)));
            return unreferencedPlanPaths(paths.filter(path => !onCanvas.has(path) && !waiting.has(path)));
          })
          .then(deletePlanImages);
      }
      await refreshProjectList();
      if (currentProjectIdRef.current === id) {
        // Saved again, it becomes a new drawing.
        currentProjectIdRef.current = null;
        setCurrentProjectId(null);
      }
    } catch (err) {
      alert("Delete failed.");
    }
  };

  const newProject = () => {
    if (placed.length && !confirm("Start a new blank project? Unsaved changes to the current drawing will be lost.")) return;
    loadGenRef.current += 1; // see enqueueSave
    setProject(freshProject());
    currentProjectIdRef.current = null;
    setCurrentProjectId(null);
    newKeyRef.current = newSessionKey();
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
    loadGenRef.current += 1; // see enqueueSave
    // A blank sheet first, whatever the store still holds from the drawing
    // before (it outlives the editor), so nothing of another drawing is ever
    // in this editor, even behind "Opening drawing…".
    setProject(freshProject());
    setCurrentProjectId(null);
    if (t.mode === "open" && t.projectId) {
      openProjectById(t.projectId, { initial: true });
      return;
    }
    newKeyRef.current = newSessionKey();
    if (t.category) setActiveCategory(t.category);
    if (t.mode === "import") setTimeout(() => fileInputRef.current?.click(), 250);
    setTimeout(fitToScreen, 60);
    if (t.restoreUnsaved) openHandedBackup();
    else setRecovery(draftOfferOnNew());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Crash recovery: keep a local draft so work is never lost -------------
  // A backup is only offered once the drawing on screen has settled (opened,
  // or started new), never on a timer, and only ever restored into the
  // drawing it is a backup of: same id, and the version that just opened. An
  // unsaved new drawing's backup found while a saved drawing opens -- or one
  // made on an older version -- is offered as "Open as a new drawing", which
  // gives it a row of its own (see the draft keys at the top of this file).
  const projectRef = useRef(project); projectRef.current = project;
  const currentProjectIdRef = useRef(currentProjectId); currentProjectIdRef.current = currentProjectId;
  const draftTimer = useRef(null);
  const [recovery, setRecovery] = useState(null);
  const countPlaced = (p) => (p?.sheets || []).reduce((n, s) => n + ((s.placed && s.placed.length) || 0), 0);

  // Debounced local autosave — survives tab crashes / reloads (esp. on iPad).
  // Not while a drawing is opening: there is nothing of it to back up yet.
  useEffect(() => {
    if (!didInit.current || openState !== "ready") return;
    if (countPlaced(project) === 0 && !bgImage) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      // Saved since this was scheduled: the next change backs it up by its id.
      if (!currentProjectId && currentProjectIdRef.current) return;
      // Strip ALL image bytes (not just migrated ones) so the draft is a few
      // KB and reliably fits in localStorage — otherwise a freshly-imported
      // plan made the draft several MB, it silently failed, and a crash then
      // lost the user's work entirely.
      const draft = { savedAt: Date.now(), project: stripImagesForDraft(project) };
      if (currentProjectId) {
        writeDraft(DRAFT_KEY, { projectId: currentProjectId, version: versionsRef.current.get(currentProjectId) ?? null, ...draft });
      } else {
        writeDraft(NEW_DRAFT_KEY, { projectId: null, sessionKey: newKeyRef.current, ...draft });
      }
    }, 800);
    return () => { if (draftTimer.current) clearTimeout(draftTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, currentProjectId, bgImage, openState]);

  // What to offer once saved drawing `id` has opened at `version` (loaded):
  //   - its own backup, to Restore into it, when that holds more work and was
  //     made on the version that just opened;
  //   - the same backup made on an older version (or by the editor before
  //     this one, which didn't record it), as a new drawing: restoring it
  //     here would replace a newer save;
  //   - else this device's unsaved new drawing, as a new drawing.
  // Lapsed accounts can't save, so nothing is offered.
  const draftOfferOnOpen = (id, version, loaded) => {
    if (readOnlyRef.current) return null;
    const own = readDraft(DRAFT_KEY);
    if (own && own.projectId === id && countPlaced(own.project) > countPlaced(loaded)) {
      const ownWork = (own.project._recordId ?? id) === id;
      if (ownWork && own.version != null && own.version === version) {
        return { kind: "restore", projectId: id, project: own.project, savedAt: own.savedAt };
      }
      if (onOpenAsNew) return { kind: "new", project: own.project, savedAt: own.savedAt, fromUnsaved: false };
    }
    const unsaved = onOpenAsNew ? readUnsavedDraft() : null;
    if (unsaved && countPlaced(unsaved.project) > 0) {
      return { kind: "new", project: unsaved.project, savedAt: unsaved.savedAt, fromUnsaved: true };
    }
    return null;
  };
  // What to offer a new drawing: this device's unsaved new drawing, to Restore
  // into it (it has no row either).
  const draftOfferOnNew = () => {
    if (readOnlyRef.current) return null;
    const unsaved = readUnsavedDraft();
    if (unsaved && countPlaced(unsaved.project) > 0) {
      return { kind: "restore", projectId: null, project: unsaved.project, savedAt: unsaved.savedAt, sessionKey: unsaved.sessionKey || null };
    }
    return null;
  };

  const restoreDraft = async () => {
    const r = recovery;
    if (!r) return;
    if (r.kind === "new") { openBackupAsNew(r); return; }
    const gen = loadGenRef.current;
    // The draft stores only Storage paths, so re-mint signed URLs to render.
    const hydrated = await hydrateImages(r.project);
    // Only into the drawing it was offered for, and only if nothing else has
    // been put in the editor since.
    if (!aliveRef.current) return;
    if (loadGenRef.current !== gen || (currentProjectIdRef.current || null) !== (r.projectId || null)) {
      setRecovery(null);
      return;
    }
    loadGenRef.current += 1; // see enqueueSave
    setProject(r.projectId ? { ...asUnsaved(hydrated), _recordId: r.projectId } : asUnsaved(hydrated));
    if (!r.projectId && r.sessionKey) newKeyRef.current = r.sessionKey;
    setHistory([]); setFuture([]);
    setRecovery(null);
    setTimeout(fitToScreen, 60);
    linkPlansLater();
  };
  const dismissDraft = () => setRecovery(null);

  // "Open as a new drawing": leave this drawing the usual way (a saved one is
  // saved on the way out), then the /new page opens the backup as an unsaved
  // new drawing (openHandedBackup). An unsaved new drawing's backup is read
  // there from its own draft; any other is handed over for this tab only.
  const openBackupAsNew = (r) => {
    setRecovery(null);
    leaveEditor(() => {
      try {
        if (r.fromUnsaved) window.sessionStorage.removeItem(HANDOFF_KEY);
        else window.sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(r.project));
      } catch {
        if (!r.fromUnsaved) { window.alert("That backup couldn't be opened as a new drawing on this device."); return; }
      }
      onOpenAsNew?.();
    });
  };
  const openHandedBackup = async () => {
    let backup = null, sessionKey = null;
    try {
      backup = JSON.parse(window.sessionStorage.getItem(HANDOFF_KEY) || "null");
      window.sessionStorage.removeItem(HANDOFF_KEY);
    } catch { backup = null; }
    if (!backup) {
      const d = readUnsavedDraft();
      if (d) { backup = d.project; sessionKey = d.sessionKey || null; }
    }
    if (!backup || !Array.isArray(backup.sheets) || !backup.sheets.length) return;
    const gen = loadGenRef.current;
    const hydrated = await hydrateImages(backup);
    if (!aliveRef.current || loadGenRef.current !== gen || currentProjectIdRef.current) return;
    loadGenRef.current += 1; // see enqueueSave
    const sheets = hydrated.sheets;
    setProject({ ...asUnsaved(hydrated), activeSheetId: sheets.some(s => s.id === hydrated.activeSheetId) ? hydrated.activeSheetId : sheets[0].id });
    if (sessionKey) newKeyRef.current = sessionKey;
    setHistory([]); setFuture([]);
    setTimeout(fitToScreen, 60);
    linkPlansLater();
  };

  // The status bar's "Not uploaded", tapped: why, and Subscribe. It tries
  // once more too, in case the account has changed since.
  const explainRefused = () => {
    tryPrompt.show(refusedPrompt(outboxReason(currentProjectIdRef.current), access.symbolLimit));
    syncNow();
  };

  // Where this drawing's save is, honestly (components/SheetParts.jsx
  // syncView): shown beside Save and in the status bar, in traffic-light
  // colours. Tapped: says why (refused), tries again now (waiting or stuck),
  // or says what it means.
  const sync = syncView({
    state: syncState,
    reason: currentProjectId ? outboxReason(currentProjectId) : null,
    signal,
    confirmed,
    saved: Boolean(currentProjectId),
  });
  const onSyncClick = () => {
    if (!sync) return;
    if (syncState === "refused") { explainRefused(); return; }
    if (syncState === "waiting" || syncState === "stuck" || syncState === "local") syncNow();
    setOpenNote(`${sync.text}. ${sync.detail.replace(/ Tap (to try now|for why)\.$/, "")}`);
  };

  // Try mode's Subscribe: save the drawing first (when the save is allowed) so
  // nothing is lost going through checkout, then open the Subscribe screen.
  const subscribeFromEditor = async () => {
    tryPrompt.hide();
    const hasWork = currentProjectIdRef.current || drawingSymbolCount(projectRef.current) > 0;
    if (hasWork && !tryUsageRef.current.blocksSave(currentProjectIdRef.current || null)) {
      try { await saveProject(); } catch { /* the local draft still holds it */ }
    }
    access.openSubscribe?.();
  };

  const exportJSON = () => {
    const data = JSON.stringify(asUnsaved(project), null, 2);
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
  // `go` is where to (the dashboard, or a new drawing: openBackupAsNew).
  const leaveEditor = async (go) => {
    if (!go) return;
    // Still opening, or the open failed: there is no drawing here to keep.
    if (openStateRef.current !== "ready") { go(); return; }
    const p = useEditor.getState().project;
    const hasWork = countPlaced(p) > 0 || (p?.sheets || []).some(s => s && s.bgImage);
    if (readOnlyRef.current) { // lapsed: nothing can be saved
      if (lapsedWhileOpen.current && hasWork &&
          !confirm("Your account is now view-only, so any changes since your last save can't be saved. Download or print a copy from this screen first if you need them. Leave anyway?")) return;
      go();
      return;
    }
    if (hasWork) {
      if (currentProjectIdRef.current) {
        // Over its own row only; otherwise kept as a new drawing (saveProject).
        const ok = await saveProject();
        if (ok === false && !confirm("Your changes couldn't be saved. Leave anyway?")) return;
      } else if (!confirm("This drawing hasn't been saved yet. Leave without saving?")) {
        return;
      }
    }
    go();
  };
  const leaveToDashboard = () => leaveEditor(onHome);

  // ---- Floor plan round trip -----------------------------------------------
  // The sheet's plan came from a sketch when the sheet carries its sketchId (an
  // import clears it). Edit floor plan saves the drawing, then opens that
  // sketch over the editor; Back to drawing / Use this plan there updates this
  // same sheet at the plan's true scale (applyFloorPlan): the frame is kept
  // when it still fits, else symbols move with the plan, so they stay put on it.
  const openFloorPlan = (sketchId) => {
    setFloorPlanArgs({
      openSketchId: sketchId || null,
      // The ref: Edit floor plan saves first, and that save may have made
      // this a new drawing since this render.
      linkProject: currentProjectIdRef.current,
      linkSheet: activeSheet?.id || null,
      linkName: meta.projectName || "Floor plan",
    });
    setFloorPlanOpen(true);
  };
  const planFromSketch = Boolean(activeSheet?.sketchId && activeSheet?.bgImage);
  const editFloorPlan = async () => {
    const id = activeSheet?.sketchId;
    if (!id) return;
    // This device's copy of the sketch (lib/device/sketches.js), so the floor
    // plan opens with no signal too.
    let data = null;
    try { data = (await openSketch(id))?.data || null; }
    catch (err) { alert("Couldn't open the floor plan. Check your connection and try again."); return; }
    if (!data) { setPlanGone(true); return; }
    await saveProject();
    openFloorPlan(id);
  };

  // Status bar: the keys for what is happening now, as key caps
  // (components/Shortcuts.jsx StatusHint); on touch, what to tap or drag.
  const act = TOUCH ? "Tap" : "Click";
  const deselect = TOUCH ? [] : [["del", "to delete"], ["esc", "deselect"]];
  const statusParts = spacePressed ? ["Drag to pan", "let go of Space to stop"]
    : tool === "wall" ? (wallDraft ? [`${act} to set the end point`, !TOUCH && ["shift", "any angle"], !TOUCH && ["esc", "cancel"]] : [`${act} to start a wall`, !TOUCH && ["esc", "exit"]])
    : tool === "wire" ? [wireStart ? `${act} the symbol to link it to` : `${act} a symbol to start a wire`, !TOUCH && ["esc", "stop"]]
    : tool === "note" ? [`${act} the drawing to add a note`, !TOUCH && ["esc", "cancel"]]
    : tool === "pan" ? (TOUCH ? ["Drag to pan", "pinch to zoom"] : ["Drag to pan", ["wheel", "to zoom"], ["v", "select"]])
    : selectedId ? (TOUCH ? ["Drag to move it", "drag the round handle to rotate"] : ["Drag to move it", ["r", "rotate 15°"], ...deselect])
    : selectedFurnId ? ["Drag to move it", TOUCH ? "drag its handles to rotate or resize" : null, ...deselect]
    : selectedAnnoId ? ["Drag the note or its arrow to move it", ...deselect]
    : selectedWireId ? (TOUCH ? ["Delete is in the inspector"] : deselect)
    : selectedWallId ? (TOUCH ? ["Wall selected"] : deselect)
    : TOUCH ? ["Drag symbols in from the palette", "tap to select", "pinch to zoom"]
    : ["Drag symbols in from the palette", ["w", "wire"], ["n", "note"], ["space+drag", "to pan"]];

  const displayMeta = useMemo(
    () => ({ ...meta, sheetName: activeSheet.name, drawingNumber: activeSheet.drawingNumber || "" }),
    [meta, activeSheet.name, activeSheet.drawingNumber]
  );

  return (
    <ProjectTitleBlockContext.Provider value={effectiveTitleBlock}>
    <div className="w-full h-screen flex flex-col bg-slate-100 text-slate-900 dark:bg-[#0E141B] dark:text-slate-100 overflow-hidden select-none"
         style={{ height: "100dvh", fontFamily: "var(--font-inter), ui-sans-serif, system-ui, -apple-system, sans-serif" }}>

      {/* ==================== TOP BAR ==================== */}
      <TopBar
        meta={meta}
        trialPill={access.isTry ? <TryPill used={tryUsage.used} limit={tryUsage.limit} onSubscribe={subscribeFromEditor} /> : null}
        onHome={leaveToDashboard}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onShowMeta={() => setShowMeta(true)}
        onImport={() => fileInputRef.current.click()}
        onUndo={undo} onRedo={redo}
        onSave={saveProject} savedFlash={savedFlash}
        syncView={sync} onSyncClick={onSyncClick}
        onShowProjects={() => { refreshProjectList(); setShowProjects(true); }}
        onExportJSON={access.isTry ? () => tryPrompt.show(LOCKED.saveFile) : exportJSON}
        onPrint={access.isTry ? () => tryPrompt.show(LOCKED.export) : () => setPrintPreview(true)}
        colourMode={colourMode}
        onToggleColour={() => setProject(p => ({ ...p, colourMode: ({ navy: "colour", colour: "red", red: "mono", mono: "navy" })[p.colourMode || "colour"] }))}
        wireStrength={wireStrength}
        onWireStrength={setWireStrength}
        onNormalise={normaliseSizes}
        normaliseFlash={normaliseFlash}
        snapEnabled={snapEnabled}
        onToggleSnap={() => setSnapEnabled(s => !s)}
        onShowBoq={() => setShowBoq(true)}
        onShowNotes={() => setShowNotes(true)}
        onShowTitleBlock={() => setShowTitleBlock(true)}
        onEditFloorPlan={planFromSketch && !readOnly ? editFloorPlan : null}
        sidebarHidden={sidebarHidden}
        onToggleSidebar={() => setSidebarHidden(s => !s)}
        onShowShortcuts={() => setShortcutsOpen(true)}
        shortcutsOpen={shortcutsOpen}
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
          {/* A backup of another drawing (kind "new") never goes into this
              one: it can only become a new drawing of its own. */}
          <span className="font-semibold">{recovery.kind === "new"
            ? (recovery.fromUnsaved ? "Unsaved new drawing found on this device" : "Unsaved work from an older copy of this drawing")
            : "Recovered unsaved work"}</span>
          <span className="text-amber-700">
            {recovery.kind === "new" && recovery.project?.meta?.projectName ? `${recovery.project.meta.projectName} · ` : ""}
            {countPlaced(recovery.project)} symbols · {new Date(recovery.savedAt).toLocaleString()}
          </span>
          <div className="ml-auto flex gap-2">
            <button onClick={restoreDraft} className="px-3 py-1.5 rounded-md bg-[var(--action)] text-[color:var(--action-ink)] text-[11px] font-semibold uppercase tracking-wider hover:bg-[var(--action-hover)]">
              {recovery.kind === "new" ? "Open as a new drawing" : "Restore"}
            </button>
            <button onClick={dismissDraft} className="px-3 py-1.5 rounded-md bg-white/70 text-amber-800 text-[11px] font-semibold uppercase tracking-wider hover:bg-white">
              {recovery.kind === "new" && recovery.fromUnsaved ? "Not now" : "Dismiss"}
            </button>
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
            wireStrength={wireStrength}
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
              onClick={() => openFloorPlan(activeSheet?.sketchId)}
              title="Draw or edit the floor plan"
              className="absolute top-4 left-16 z-20 flex items-center gap-1.5 h-9 px-3 bg-white dark:bg-[#16202B] rounded-xl ring-1 ring-slate-200/70 dark:ring-[#2A3947] shadow-[0_10px_30px_-10px_rgba(16,28,40,0.22)] text-[12px] font-semibold text-slate-700 dark:text-slate-200 hover:text-[#22808F] transition-colors">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="1.5"/><path d="M3 9h6V3M21 15h-6v6"/></svg>
              Floor Plan
            </button>
          )}

          {/* Wall-type chooser — only while the wall tool is active */}
          {tool === "wall" && <WallTypeChooser value={wallType} onChange={setWallType} />}

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

          {/* External file drop overlay */}
          {draggingFile && (
            <div className="absolute inset-4 z-30 rounded-2xl border-2 border-dashed border-[#3FB7C9]/60 bg-[#ECF8FA] flex items-center justify-center pointer-events-none">
              <div className="text-[#22808F] text-sm tracking-[0.2em] uppercase">Drop to import</div>
            </div>
          )}

          {/* Status bar */}
          {openNote && (
            <div role="status" className="absolute top-3 left-1/2 -translate-x-1/2 z-20 max-w-[560px] w-[calc(100%-2rem)] flex items-start gap-3 px-4 py-2.5 rounded-xl bg-white dark:bg-[#16202B] ring-1 ring-slate-200 dark:ring-[#263441] shadow-[0_10px_30px_-10px_rgba(16,28,40,0.3)] text-[12.5px] leading-snug text-slate-700 dark:text-slate-200">
              <span className="flex-1">{openNote}</span>
              <button type="button" onClick={() => setOpenNote("")} aria-label="Dismiss" title="Dismiss"
                className="shrink-0 w-6 h-6 -mr-1 rounded-md flex items-center justify-center bg-[var(--action)] hover:bg-[var(--action-hover)] text-[color:var(--action-ink)]">
                <X size={13} />
              </button>
            </div>
          )}
          <StatusBar right={<><SyncStatus view={sync} onClick={onSyncClick} />SHEET A3 · {meta.scale}</>}>
            {/* The counts always show; the hint after them truncates. */}
            <StatusCount label="SYMBOLS" value={placed.length} />
            <StatusCount label="WIRES" value={wires.length} />
            <StatusCount label="NOTES" value={annotations.length} />
            <span>TOOL <span className="text-[#22808F] ml-1">{tool.toUpperCase()}</span></span>
            <StatusHint parts={statusParts} />
          </StatusBar>
          </div>
        </main>

        {/* ==================== RIGHT INSPECTOR ==================== */}
        {!sidebarHidden && (
          inspectorHidden ? (
            <CollapsedPanel onExpand={() => setInspectorHidden(false)} />
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
              onEditFloorPlan={planFromSketch && !readOnly ? editFloorPlan : null}
            />
          )
        )}
      </div>

      {/* ==================== METADATA EDITOR ==================== */}
      {showMeta && (
        <MetaEditor meta={displayMeta} updateMeta={updateMeta} onSheetField={setActiveSheet} onClose={() => setShowMeta(false)} />
      )}

      {/* ==================== PRINT PREVIEW ==================== */}
      {(printPreview || readOnly) && (
        <PrintPreview
          project={project}
          legendItems={legendItems}
          colourMode={colourMode}
          wireStrength={wireStrength}
          symbolScale={symbolScale}
          DRAW={DRAW}
          onClose={readOnly ? leaveToDashboard : () => setPrintPreview(false)}
          onPrint={printSheet}
          notice={readOnly ? readOnlyNotice : null}
          onShowBoq={readOnly ? () => setShowBoq(true) : null}
          closeLabel={readOnly ? "Back to dashboard" : null}
        />
      )}

      {/* ==================== BILL OF QUANTITIES ==================== */}
      {showBoq && (
        <BillOfQuantities project={project} updateBoq={updateBoq} onClose={() => setShowBoq(false)} readOnly={readOnly} />
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
          {/* The sketch tool's code not on this device and no signal: says
              so and closes back to the drawing (components/NeedsSignal.jsx). */}
          <NeedsSignalBoundary onClose={() => setFloorPlanOpen(false)}>
          <CadSketchPanel
            embedded
            openSketchId={floorPlanArgs?.openSketchId || null}
            linkProject={floorPlanArgs?.linkProject || null}
            linkSheet={floorPlanArgs?.linkSheet || null}
            linkName={floorPlanArgs?.linkName || null}
            onClose={() => setFloorPlanOpen(false)}
            onApplyPlan={applyFloorPlan}
          />
          </NeedsSignalBoundary>
        </div>
      )}
    </div>
      {/* Edit floor plan: the linked sketch has been deleted. */}
      {planGone && (
        <div role="dialog" aria-modal="true" aria-labelledby="pw-plan-gone" onClick={() => setPlanGone(false)}
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[3px]">
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-[420px] rounded-2xl bg-white dark:bg-[#16202B] p-6 shadow-2xl text-slate-900 dark:text-slate-100">
            <h2 id="pw-plan-gone" className="text-[19px] font-bold mb-2" style={{ fontFamily: "var(--font-space-grotesk), sans-serif" }}>This floor plan can't be edited</h2>
            <p className="text-[13.5px] leading-relaxed text-slate-600 dark:text-slate-300 mb-5">
              The sketch it was drawn in has been deleted. The plan on this sheet stays exactly as it is, with your symbols.
              To change it, draw a new floor plan for this sheet, or import a PDF or image.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPlanGone(false)}
                className="h-10 px-4 rounded-[10px] text-[13px] font-semibold bg-slate-100 text-[#1A2530] dark:bg-[#22303D] dark:text-slate-100">OK</button>
              <button type="button" onClick={() => { setPlanGone(false); openFloorPlan(null); }}
                className="h-10 px-4 rounded-[10px] text-[13px] font-semibold bg-[var(--action)] text-[color:var(--action-ink)] hover:bg-[var(--action-hover)]">Draw a new floor plan</button>
            </div>
          </div>
        </div>
      )}
      <ShortcutsCard open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} subtitle="Electrical drawing"
        groups={SHORTCUTS} touchGroups={TOUCH_GESTURES} />
      {/* Opening a saved drawing: over everything, so nothing can be edited
          or saved until it has arrived (openProjectById). If it can't be
          opened: Retry or Back, never a blank sheet that looks like it. */}
      {openState !== "ready" && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#F4F6F9] dark:bg-[#0B1117]"
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => e.preventDefault()}>
          {openState === "opening" ? (
            <div role="status" className="text-[10px] tracking-[0.3em] text-slate-400 uppercase">Opening drawing…</div>
          ) : (
            <div role="alertdialog" aria-modal="true" aria-labelledby="pw-open-failed"
              className="w-full max-w-[420px] rounded-2xl bg-white dark:bg-[#16202B] ring-1 ring-slate-200 dark:ring-[#263441] p-6 shadow-xl text-slate-900 dark:text-slate-100">
              <h2 id="pw-open-failed" className="text-[19px] font-bold mb-2" style={{ fontFamily: "var(--font-space-grotesk), sans-serif" }}>
                {openState === "missing" ? "This drawing can't be found" : "This drawing didn't open"}
              </h2>
              <p className="text-[13.5px] leading-relaxed text-slate-600 dark:text-slate-300 mb-5">
                {openState === "missing"
                  ? "It may have been deleted, or it belongs to another account. Nothing has been changed."
                  : "It couldn't be fetched, probably because of the connection. Nothing has been changed. Try again, or go back to your drawings."}
              </p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => onHome?.()}
                  className="h-10 px-4 rounded-[10px] text-[13px] font-semibold bg-slate-100 text-[#1A2530] dark:bg-[#22303D] dark:text-slate-100">Back</button>
                <button type="button" onClick={retryOpen}
                  className="h-10 px-4 rounded-[10px] text-[13px] font-semibold bg-[var(--action)] text-[color:var(--action-ink)] hover:bg-[var(--action-hover)]">Retry</button>
              </div>
            </div>
          )}
        </div>
      )}
      {/* Try mode: the Subscribe prompt (components/TryMode.jsx). */}
      <TryPrompt open={Boolean(tryPrompt.prompt)} title={tryPrompt.prompt?.title} body={tryPrompt.prompt?.body}
        onSubscribe={tryPrompt.prompt?.refused ? () => { tryPrompt.hide(); access.openSubscribe?.(); } : subscribeFromEditor}
        onClose={tryPrompt.hide} />
    </ProjectTitleBlockContext.Provider>
  );
}

