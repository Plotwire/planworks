"use client";

/* ============================================================================
 * lib/device/library.js -- the offline library
 * ----------------------------------------------------------------------------
 * Keeps EVERY drawing of the signed-in account on this device, with every plan
 * image and original PDF they use, and every floor plan sketch, so a whole day without signal still has
 * every job to hand: open, edit, save (lib/device/outbox), quote, PDF. Also
 * the work planner, to look at (lib/device/plannerCopy), the symbol counts
 * Try mode checks its limit against (lib/device/symbolCounts), and a check
 * that the service worker has kept the app itself, every page and code file
 * (lib/device/serviceWorker keepAppFiles): the dashboard only says "ready"
 * when it has.
 *
 * In the background, whenever there is signal (at start, when signal returns,
 * when the app comes back into view, and every LOOK_EVERY_MS): the list of
 * drawings is fetched (small), then each drawing this device doesn't have at
 * its latest version is fetched, one at a time, then each plan file it
 * doesn't have. A drawing with a save waiting on this device is never
 * fetched over: the device holds the newer work (the outbox uploads it,
 * keeping the drawing-safety rules). A drawing deleted elsewhere is dropped,
 * and so are plan files no drawing uses any more.
 *
 * It stops when signal goes, when the account signs out, when the device is
 * on a data saver (unless asked: updateLibrary), or when storage is nearly
 * full (status "full"). Signing out clears everything (lib/device/session).
 * ========================================================================== */

import { listProjects, getProjectRecord } from "../db";
import { deviceDrawings, keepServerCopy, forgetDrawing, rememberList } from "./drawings";
import { keepFiles, keptFiles, keptBytes, dropUnused } from "./planCache";
import { pendingSaves } from "./outbox";
import { askToPersist } from "./idb";
import { syncSketchLibrary } from "./sketches";
import { refreshPlannerCopy } from "./plannerCopy";
import { refreshSymbolCounts } from "./symbolCounts";
import { keepAppFiles } from "./serviceWorker";

const LOOK_EVERY_MS = 15 * 60000;
const APP_RETRY_MS = 60000;        // the app itself not all kept yet
const FIRST_LOOK_MS = 4000;        // after start: let the app settle first
const STORAGE_FULL = 0.9;          // of the browser's quota for this site
const PAUSE_MS = 150;              // between drawings, so the app stays responsive

let uid = null;
let timer = null;
let running = false;
let again = false;
let wired = false;
const listeners = new Set();
let status = blank();

function blank() {
  return {
    state: "off",            // off | idle | updating | offline | full | error
    drawings: 0,             // kept on this device, at their latest version
    drawingsTotal: null,     // in the account (null until a list has come back)
    files: 0,                // plan images and PDFs kept
    filesTotal: null,
    bytes: 0,                // what the library keeps (drawings and files)
    usage: null,             // the browser's own figures for this site
    quota: null,
    persisted: null,         // storage the browser has promised not to clear
    lastUpdated: null,       // when the library last finished up to date
    // The app itself (pages and code, public/sw.js): { kept, total,
    // complete }, or null when there's no service worker to ask.
    app: null,
  };
}

// Every part of the app kept? (No worker to ask: nothing to wait for.)
export const appReady = (app) => !app || (app.complete && app.kept >= app.total);

function set(patch) {
  status = { ...status, ...patch };
  for (const fn of listeners) { try { fn(status); } catch (e) { console.warn("library listener:", e); } }
}

export function subscribeLibrary(fn) { listeners.add(fn); fn(status); return () => listeners.delete(fn); }
export const libraryStatus = () => status;

const online = () => typeof navigator === "undefined" || navigator.onLine !== false;
const saveData = () => typeof navigator !== "undefined" && navigator.connection?.saveData === true;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function storageFigures() {
  const out = { usage: null, quota: null, persisted: null };
  try {
    const e = await navigator.storage?.estimate?.();
    if (e) { out.usage = e.usage ?? null; out.quota = e.quota ?? null; }
  } catch { /* not supported */ }
  try { out.persisted = (await navigator.storage?.persisted?.()) ?? null; } catch { /* not supported */ }
  return out;
}
async function nearlyFull() {
  const { usage, quota } = await storageFigures();
  return Boolean(usage && quota && usage / quota > STORAGE_FULL);
}

// ---- Start / stop (lib/device/session) ------------------------------------

export function startLibrary(userId) {
  uid = userId || null;
  if (!uid) return;
  set({ ...blank(), state: "idle" });
  if (!wired && typeof window !== "undefined") {
    wired = true;
    window.addEventListener("online", () => schedule(1500));
    window.addEventListener("offline", () => { if (uid) set({ state: "offline" }); });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && status.lastUpdated && Date.now() - status.lastUpdated > LOOK_EVERY_MS) schedule(2000);
    });
  }
  // Ask once more for storage the browser won't clear (an iPad keeps a
  // website's data for about a week of not being used otherwise).
  askToPersist();
  measure();
  schedule(FIRST_LOOK_MS);
}

export function stopLibrary() {
  uid = null;
  clearTimeout(timer);
  set(blank());
}

// "Update now": also on a data saver.
export function updateLibrary() { schedule(0, true); }

let forced = false;
function schedule(ms, force = false) {
  clearTimeout(timer);
  if (!uid) return;
  if (force) forced = true;
  timer = setTimeout(run, ms);
}

// The figures alone, from what is on the device (no network).
async function measure() {
  const me = uid;
  if (!me) return;
  const [drawings, files, fileBytes, figures, app] = await Promise.all([deviceDrawings(me), keptFiles(), keptBytes(), storageFigures(), keepAppFiles({ fetch: false })]);
  if (uid !== me) return;
  const drawingBytes = drawings.reduce((n, d) => n + approxSize(d.data), 0);
  set({ files: files.size, bytes: fileBytes + drawingBytes, app, ...figures, ...(status.drawingsTotal === null ? { drawings: drawings.length } : {}) });
}
function approxSize(data) {
  try { return JSON.stringify(data).length; } catch { return 0; }
}

// Every plan image and original PDF a drawing uses.
function filesOf(data) {
  const out = [];
  for (const s of data?.sheets || []) {
    const bg = s?.bgImage;
    if (bg?.path) out.push(bg.path);
    if (bg?.pdfPath) out.push(bg.pdfPath);
  }
  return out;
}

// ---- Updating ---------------------------------------------------------------

async function run() {
  if (running) { again = true; return; }
  const me = uid;
  if (!me) return;
  const force = forced;
  forced = false;
  if (!online()) { set({ state: "offline" }); return; }
  if (saveData() && !force) { set({ state: "idle" }); schedule(LOOK_EVERY_MS); return; }
  running = true;
  const stop = async () => uid !== me || !online() || (await nearlyFull());
  try {
    set({ state: "updating" });
    const listedAt = Date.now();
    const rows = await listProjects({ timeoutMs: 60000 });
    if (uid !== me) return;
    rememberList(me, rows);
    const latest = new Map(rows.map((r) => [r.id, r.updatedAt ?? null]));
    set({ drawingsTotal: rows.length });

    // Drawings: any this device doesn't have at its latest version.
    let kept = new Map((await deviceDrawings(me)).map((d) => [d.id, d]));
    const countUpToDate = () => rows.filter((r) => kept.get(r.id)?.version === (r.updatedAt ?? null)).length;
    set({ drawings: countUpToDate() });
    for (const row of rows) {
      if (await stop()) break;
      const have = kept.get(row.id);
      if (have && have.version === (row.updatedAt ?? null)) continue;
      // A save of it waiting on this device: that is the newer work.
      if ((await pendingSaves(me)).some((e) => e.id === row.id)) continue;
      let rec = null;
      const since = Date.now();
      try { rec = await getProjectRecord(row.id, { timeoutMs: 60000 }); } catch { break; } // signal went
      if (uid !== me) return;
      if (!rec || !rec.data) continue;
      // Checked again after the wait: a save may have been made meanwhile,
      // and one that has already uploaded wrote a newer copy (keepServerCopy
      // leaves that alone).
      if ((await pendingSaves(me)).some((e) => e.id === row.id)) continue;
      if (!(await keepServerCopy(me, row.id, { name: row.name, data: rec.data, version: rec.version }, since))) continue;
      kept.set(row.id, { id: row.id, version: rec.version, data: rec.data });
      set({ drawings: countUpToDate() });
      await sleep(PAUSE_MS);
    }
    if (uid !== me) return;

    // Drawings deleted elsewhere: dropped, unless this device has work for
    // them waiting, or kept them after the list was fetched (a new drawing).
    const waiting = new Set((await pendingSaves(me)).map((e) => e.id));
    kept = new Map((await deviceDrawings(me)).map((d) => [d.id, d]));
    for (const d of kept.values()) {
      if (latest.has(d.id) || waiting.has(d.id) || d.version === null || (d.savedAt || 0) > listedAt) continue;
      await forgetDrawing(me, d.id);
      kept.delete(d.id);
    }

    // Floor plan sketches ("Edit floor plan", the sketch tool).
    try { await syncSketchLibrary(stop); } catch (err) { console.warn("offline library: sketches:", err?.message || err); }
    if (uid !== me) return;

    // The work planner, to look at with no signal (lib/device/plannerCopy.js),
    // and the symbol counts Try mode checks (lib/device/symbolCounts.js).
    try { await refreshPlannerCopy(me); } catch (err) { console.warn("offline library: planner:", err?.message || err); }
    try { await refreshSymbolCounts(me); } catch (err) { console.warn("offline library: symbol counts:", err?.message || err); }
    if (uid !== me) return;

    // Plan files: every one a kept drawing (or a waiting save) uses.
    const used = new Set();
    for (const d of kept.values()) filesOf(d.data).forEach((p) => used.add(p));
    for (const e of await pendingSaves(me)) filesOf(e.data).forEach((p) => used.add(p));
    set({ filesTotal: used.size });
    await keepFiles([...used], { shouldStop: stop });
    if (uid !== me) return;
    await dropUnused(used);

    // The app itself: any page or code file the service worker doesn't have
    // yet (the editor, sketch tool, PDF and quote makers), fetched now.
    const app = await keepAppFiles();
    if (uid !== me) return;
    set({ app });

    const full = await nearlyFull();
    const done = !full && online() && countUpToDate() === rows.length && appReady(app);
    set({ state: full ? "full" : !online() ? "offline" : "idle", ...(done ? { lastUpdated: Date.now() } : {}) });
  } catch (err) {
    if (uid === me) set({ state: online() ? "error" : "offline" });
    console.warn("offline library:", err?.message || err);
  } finally {
    running = false;
    await measure();
    // Asked again while this ran (or another account signed in): run again.
    if (again) { again = false; schedule(1000); }
    // Part of the app not kept yet (still installing, or a file failed):
    // looked at again soon, not in a quarter of an hour.
    else if (uid === me) schedule(appReady(status.app) ? LOOK_EVERY_MS : APP_RETRY_MS);
  }
}
