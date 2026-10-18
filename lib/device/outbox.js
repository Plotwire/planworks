"use client";

/* ============================================================================
 * lib/device/outbox.js -- saves go to the device first, then up
 * ----------------------------------------------------------------------------
 * Every write of a drawing's row goes through here: the editor's Save, a tab
 * rename, a floor plan sent back from the sketch, and the first save of a
 * new drawing. A save is on the device the moment it is made (the outbox
 * entry, and the drawing's device copy); it is uploaded in the background,
 * one at a time, and retried automatically until it gets through.
 *
 * Drawing safety (docs/drawing-safety-test.md) is kept:
 *   - an update is only written over the version it was based on (base: the
 *     row's updated_at this device last knew). A newer version saved
 *     somewhere else is never overwritten;
 *   - if the row has changed or gone, the work is saved as a new drawing,
 *     "<name> (copy)", exactly as Save does when it finds that. The editor is
 *     told (event "copied") and says so;
 *   - before deciding the row changed, it checks whether the change is this
 *     device's own earlier try (sent, answer lost on the way back): then it
 *     isn't a conflict and no copy is made. New drawings and copies get their
 *     id here, so a retried insert can't make a second drawing.
 * The same rule holds between tabs on this device. Several saves of one
 * drawing made while it waits are merged (the newest work goes up, based on
 * the version the first one was based on), but only saves that follow on
 * from each other: every save gets a tag, and a save only joins the waiting
 * one if its editor had seen that one (`expect`). A save from a tab that
 * hadn't -- the same drawing open in two tabs -- joins nothing; the editor
 * keeps it as a copy instead, as Save does when the row has changed.
 *
 * Status, per drawing, for the editor's indicator: "local" (saved on this
 * device), "syncing", "synced", "waiting" (no signal, will retry), "stuck"
 * (the server wouldn't take it; retried now and then, never dropped),
 * "refused" (the account won't take it: a Try account's save over its trial
 * symbols, reason "limit", or no active subscription, "subscription"; kept
 * and retried the same way, and the editor and dashboard say why). Every tab
 * hears every event (BroadcastChannel): whichever tab sends a save, the
 * editor that made it is told.
 * ========================================================================== */

import { idbGet, idbUpdate, idbAll, askToPersist } from "./idb";
import { rememberDrawing, forgetDrawing, noteInList } from "./drawings";
import { localImageState, markLocalImageUploaded, rememberUploadedPlan } from "./planCache";
import { planUploadFor } from "./uploads";
import { noteSymbolCount } from "./symbolCounts";
import { noteServer, subscribeSignal } from "./connection";
import { updateProjectRow, insertProjectRecord, getProjectRecord, buildPreview, searchFields, symbolCount } from "../db";
import { uploadPlanImage, dataUrlToBlob } from "../planImages";
import { isTryLimitRefusal, isSubscriptionRefusal, TRY_LIMIT_MESSAGE } from "../writeErrors";

const WRITE_TIMEOUT_MS = 90000;  // a large drawing on a weak signal
const READ_TIMEOUT_MS = 30000;
const BACKOFF_MS = [2000, 5000, 15000, 30000, 60000, 120000];
const STUCK_RETRY_MS = 5 * 60000;
const SENT_KEPT = 12;            // fingerprints of earlier tries kept per save

let uid = null;
// Waiting saves live in IndexedDB, shared by every tab. Only if it isn't
// working here (some private windows) are they kept in this tab's memory.
let memOnly = false;
const mem = new Map();        // key -> entry, when memOnly
const status = new Map();     // drawing id -> status
const reasons = new Map();    // drawing id -> why it was refused ("limit" | "subscription")
const holds = new Set();      // drawing ids not to upload yet (the editor is checking the server)
const listeners = new Set();
let channel = null;           // the other tabs of this app
let running = false;
let again = false;
let timer = null;
let failures = 0;
let wired = false;
let forceAll = false;         // the next run tries every save now, refused ones included

const newId = () => {
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch { /* fall through */ }
  // RFC 4122 v4 shape, for the uuid column.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
};
export const newDrawingId = newId;
const keyFor = (id) => `${uid}/${id}`;

// ---- Events ---------------------------------------------------------------

function deliver(ev) {
  if (ev.type === "status" && ev.id) {
    if (ev.status) status.set(ev.id, ev.status); else status.delete(ev.id);
    if (ev.status === "refused" && ev.reason) reasons.set(ev.id, ev.reason); else reasons.delete(ev.id);
  }
  for (const fn of listeners) { try { fn(ev); } catch (e) { console.warn("outbox listener:", e); } }
}
function emit(ev) {
  deliver(ev);
  try { channel?.postMessage({ uid, ev }); } catch { /* this tab only */ }
}
function hear(msg) {
  const { uid: from, ev } = msg?.data || {};
  if (ev && uid && from === uid) deliver(ev);
}
function setStatus(id, s, reason = null) { if (id) emit({ type: "status", id, status: s, ...(reason ? { reason } : {}) }); }

export function subscribeOutbox(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export const outboxStatus = (id) => status.get(id) || null;
// Why a "refused" save was refused: "limit" or "subscription".
export const outboxReason = (id) => reasons.get(id) || null;

// ---- Entries ----------------------------------------------------------------

async function entries(forUid = uid) {
  if (!forUid) return [];
  const stored = memOnly ? [] : await idbAll("outbox", forUid + "/");
  const byKey = new Map(stored.map((e) => [e.key, e]));
  for (const [k, e] of mem) if (k.startsWith(forUid + "/")) byKey.set(k, e);
  return [...byKey.values()].sort((a, b) => (a.queuedAt || 0) - (b.queuedAt || 0));
}
async function getEntry(id) {
  const k = keyFor(id);
  if (mem.has(k)) return mem.get(k);
  return memOnly ? null : (await idbGet("outbox", k)) || null;
}
// Change one waiting save in a single step, so no other tab writes it in
// between (lib/device/idb idbUpdate): change(current) returns the entry to
// keep, null to remove it, or undefined to leave it. Resolves to what change
// returned.
async function updateEntry(id, change) {
  const k = keyFor(id);
  if (!memOnly) {
    const r = await idbUpdate("outbox", k, change);
    if (r.ok) return r.value;
    memOnly = true;
    console.warn("outbox: this device's storage isn't working here; saves wait in this tab until they upload");
  }
  const out = change(mem.get(k) || null);
  if (out === null) mem.delete(k);
  else if (out && typeof out === "object") { if (out.key !== k) mem.delete(k); mem.set(out.key, out); }
  return out;
}

// The saves waiting on this device for an account (by default the one the
// outbox is running for). Callers that know the account pass it: they may
// ask before the outbox has started.
export async function pendingSaves(forUid = uid) { return entries(forUid); }

// ---- Start / stop (lib/device/session) ------------------------------------

export async function startOutbox(userId) {
  uid = userId || null;
  failures = 0;
  status.clear();
  reasons.clear();
  if (!uid) return;
  for (const e of await entries()) {
    status.set(e.id, e.refused ? "refused" : e.error ? "stuck" : "local");
    if (e.refused) reasons.set(e.id, e.refused);
  }
  deliver({ type: "status" });
  if (!wired && typeof window !== "undefined") {
    wired = true;
    window.addEventListener("online", () => { failures = 0; schedule(0); });
    // Signal back without the browser saying so (lib/device/connection's
    // check heard the server again): upload now, not after the backoff.
    subscribeSignal((now) => { if (now && uid) { failures = 0; schedule(0); } });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") schedule(500); });
    try {
      channel = new BroadcastChannel("plotwire-outbox");
      channel.onmessage = hear;
    } catch { /* older browser: each tab hears only itself */ }
  }
  // Every save is tried once at start, refused ones too: the account may
  // have subscribed since (checkout comes back with a fresh page).
  forceAll = true;
  schedule(1000);
}

export function stopOutbox() {
  uid = null;
  clearTimeout(timer);
  status.clear();
  reasons.clear();
  mem.clear();
}

// ---- Queueing a save --------------------------------------------------------

// A save of an existing drawing (kind "update"), or of a new one ("insert",
// with the id it will have). data: the drawing in device form
// (lib/device/drawings toDeviceForm). base: the version the work is based on
// (undefined if unknown: then it is never written over the row, see syncOne).
// expect: the tag of the waiting save this work follows on from, as its
// editor last saw it (its own last save, or the one it opened from), or null.
// Resolves to { tag } once the save is on the device, or { conflict: true },
// with nothing saved, if a save of this drawing is waiting that this work
// never saw (another tab's).
export async function queueSave({ id, name, data, base, kind = "update", expect = null }) {
  if (!uid || !id) throw new Error("Not signed in.");
  const tag = newId();
  let conflict = false;
  const entry = await updateEntry(id, (prev) => {
    if (prev) {
      if (prev.tag !== expect) { conflict = true; return undefined; }
      // Merged: the newest work, still based on the version the waiting save was.
      return { ...prev, name, data, tag, rev: (prev.rev || 0) + 1, error: null, refused: null, nextTry: null };
    }
    return { key: keyFor(id), id, kind, name, data, base, tag, rev: 1, queuedAt: Date.now(), tries: 0, error: null, sent: [] };
  });
  if (conflict) return { conflict: true };
  if (!entry) throw new Error("This device couldn't keep the save.");
  await rememberDrawing(uid, id, { name, data, version: entry.kind === "insert" ? null : entry.base });
  askToPersist();
  setStatus(id, "local");
  schedule(0);
  return { tag };
}

// Forget a waiting save that holds nothing new (the editor found the shown
// copy out of date before anything was changed). Only the save with this
// tag: never another tab's.
export async function discardSave(id, tag) {
  if (!id || !tag) return false;
  let gone = false;
  await updateEntry(id, (cur) => (cur && cur.tag === tag ? ((gone = true), null) : undefined));
  if (gone) setStatus(id, null);
  return gone;
}

// Drop everything waiting for a drawing that has been deleted.
export async function forgetSaves(id) {
  await updateEntry(id, (cur) => (cur ? null : undefined));
  setStatus(id, null);
}

export function holdSync(id) { if (id) holds.add(id); }
export function releaseSync(id) { if (id && holds.delete(id)) schedule(0); }

// "Try now": every waiting save, now, including ones refused earlier.
export function syncNow() { failures = 0; forceAll = true; schedule(0); }

// ---- Uploading ----------------------------------------------------------------

function schedule(ms) {
  clearTimeout(timer);
  if (!uid) return;
  timer = setTimeout(run, ms);
}

function isNetworkError(err) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = String(err?.message || err?.name || err || "");
  const status = Number(err?.status || err?.statusCode || 0);
  return /abort|failed to fetch|fetch failed|networkerror|network request failed|load failed|timed? ?out|the internet connection/i.test(msg)
    || [408, 425, 429, 500, 502, 503, 504].includes(status);
}
const isDuplicate = (err) => err?.code === "23505" || /duplicate key/i.test(String(err?.message || ""));

// Refused for the account's own reasons rather than a fault (lib/writeErrors
// saveError keeps the database's error as the cause): "limit", a Try
// account's save over its trial symbols; "subscription", not active.
function refusalOf(err) {
  const raw = err?.cause || err;
  if (isTryLimitRefusal(raw) || err?.message === TRY_LIMIT_MESSAGE) return "limit";
  if (isSubscriptionRefusal(raw) || isSubscriptionRefusal(err)) return "subscription";
  return null;
}

async function run() {
  if (running) { again = true; return; }
  if (!uid) return;
  running = true;
  const me = uid;
  const force = forceAll;
  forceAll = false;
  const work = async () => {
    let waitMs = null;
    let noSignal = false;
    let uploaded = false;
    const later = new Set();   // over the trial limit at the first try: once more at the end
    const outcome = (r) => {
      // No answer at all, or an answer (even a refusal): the signal status
      // follows (lib/device/connection).
      noteServer(r !== "network");
      if (r === "network") {
        failures++;
        waitMs = BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)];
        noSignal = true;
      } else if (r === "stuck") waitMs = Math.min(waitMs ?? STUCK_RETRY_MS, STUCK_RETRY_MS);
      else { failures = 0; if (r === "ok") uploaded = true; }
    };
    for (const e of await entries()) {
      if (uid !== me) return;
      if (holds.has(e.id)) continue;
      if (!force && e.error && e.nextTry && Date.now() < e.nextTry) { waitMs = Math.min(waitMs ?? STUCK_RETRY_MS, e.nextTry - Date.now()); continue; }
      const r = await syncOne(e, { deferLimit: true });
      if (r === "later") { later.add(e.id); noteServer(true); continue; }
      outcome(r);
      if (noSignal) break;
    }
    // Saves over the trial limit get a second try once the others have gone
    // up, which may have made room (a save removing symbols, queued after
    // this one), and so does one refused earlier when anything has gone up
    // since. Only then is a save marked refused.
    if (!noSignal && (later.size || uploaded)) {
      for (const e of await entries()) {
        if (uid !== me) return;
        if (holds.has(e.id) || !(later.has(e.id) || (uploaded && e.refused === "limit"))) continue;
        outcome(await syncOne(e));
        if (noSignal) break;
      }
    }
    if (waitMs !== null) schedule(waitMs);
  };
  try {
    // One tab at a time sends this device's saves.
    if (typeof navigator !== "undefined" && navigator.locks?.request) {
      await navigator.locks.request("plotwire-outbox", { ifAvailable: true }, async (lock) => {
        if (!lock) { forceAll = forceAll || force; schedule(3000); return; }
        await work();
      });
    } else {
      await work();
    }
  } catch (err) {
    console.warn("outbox run failed:", err?.message || err);
    schedule(BACKOFF_MS[2]);
  } finally {
    running = false;
    if (again) { again = false; schedule(0); }
  }
}

// Plans kept only on this device go up first; the save then carries their
// stored paths. Each stored path is written back into the waiting save
// (whatever has been merged into it since) and noted against the local
// image, so nothing is ever uploaded twice and a later save naming the local
// image finds the stored plan.
async function prepare(e) {
  const byLocal = new Map();   // local image key -> path
  const byInline = new Map();  // inline data: plan -> path
  const sheets = await Promise.all((e.data.sheets || []).map(async (s) => {
    const bg = s && s.bgImage;
    if (!bg) return s;
    if (bg.localImage && !bg.path) {
      const kept = await localImageState(bg.localImage);
      let path = kept?.path || null;
      if (!path) {
        const running = planUploadFor(bg.uploadKey);
        if (running) path = await running;
      }
      if (!path) {
        if (!kept?.blob) throw Object.assign(new Error("A plan kept on this device is missing."), { permanent: true });
        path = (await uploadPlanImage(kept.blob)).path;
        await rememberUploadedPlan(path, kept.blob);
      }
      await markLocalImageUploaded(bg.localImage, path);
      byLocal.set(bg.localImage, path);
      const { localImage, uploadKey, src, ...rest } = bg;
      return { ...s, bgImage: { ...rest, path } };
    }
    if (!bg.path && typeof bg.src === "string" && bg.src.startsWith("data:")) {
      // An inline plan (imported without signal before this version): stored now.
      try {
        const blob = dataUrlToBlob(bg.src);
        const { path } = await uploadPlanImage(blob);
        await rememberUploadedPlan(path, blob);
        byInline.set(bg.src, path);
        const { src, ...rest } = bg;
        return { ...s, bgImage: { ...rest, path } };
      } catch (err) {
        if (isNetworkError(err)) throw err;
        return s; // the server won't take the file: keep it inline, as before
      }
    }
    if (bg.src || bg.pdfSrc) { const { src, pdfSrc, ...rest } = bg; return { ...s, bgImage: rest }; }
    return s;
  }));
  // After the plans: each import starts storing its original PDF once its
  // plan is stored, so by now that upload is known (originalPdf).
  const data = { ...e.data, sheets: await Promise.all(sheets.map(originalPdf)) };
  if (byLocal.size || byInline.size) {
    await updateEntry(e.id, (cur) => (cur ? { ...cur, data: cur.tag === e.tag ? data : withPaths(cur.data, byLocal, byInline) } : undefined));
  }
  return data;
}
// An original PDF this tab was still storing when the save was made
// (pdfUploadKey, lib/device/drawings): wait for that upload and save its
// path, so the drawing reopens sharp from the PDF and not from its plan
// picture. Never holds a save up for good: an upload that failed, is taking
// too long, or belonged to a tab since closed leaves the save as it was
// (the plan picture), and the editor stores the PDF again on a later save.
const ORIGINAL_PDF_WAIT_MS = 120000;
async function originalPdf(s) {
  const bg = s && s.bgImage;
  if (!bg || !("pdfUploadKey" in bg)) return s;
  const { pdfUploadKey, ...rest } = bg;
  if (rest.pdfPath) return { ...s, bgImage: rest };
  const running = planUploadFor(pdfUploadKey);
  let wait = null;
  const pdfPath = running
    ? await Promise.race([running, new Promise((r) => { wait = setTimeout(() => r(null), ORIGINAL_PDF_WAIT_MS); })])
    : null;
  clearTimeout(wait);
  return { ...s, bgImage: pdfPath ? { ...rest, pdfPath, pdfPage: rest.pdfPage || 1 } : rest };
}
function withPaths(data, byLocal, byInline) {
  return {
    ...data,
    sheets: (data?.sheets || []).map((s) => {
      const bg = s && s.bgImage;
      if (!bg || bg.path) return s;
      const path = (bg.localImage && byLocal.get(bg.localImage)) || (typeof bg.src === "string" && byInline.get(bg.src));
      if (!path) return s;
      const { localImage, uploadKey, src, ...rest } = bg;
      return { ...s, bgImage: { ...rest, path } };
    }),
  };
}

// A fingerprint of a drawing as the database holds it (keys in a fixed
// order, as the database may reorder them): tells this device's own earlier
// tries apart from changes made anywhere else.
const asSent = (data) => JSON.parse(JSON.stringify({ ...data, preview: buildPreview(data) }));
function canonical(v) {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  }
  return JSON.stringify(v ?? null);
}
function fingerprint(stored) {
  const s = canonical(stored);
  let a = 0x811c9dc5, b = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = (Math.imul(b, 31) + c) | 0;
  }
  return (a >>> 0).toString(36) + "." + (b >>> 0).toString(36) + "." + s.length.toString(36);
}
// Noted before every try, so a try whose answer is lost is recognised later.
async function noteSent(e, print) {
  const at = await updateEntry(e.id, (cur) => (cur ? { ...cur, sent: [...(cur.sent || []).filter((x) => x !== print), print].slice(-SENT_KEPT) } : undefined));
  if (at) e.sent = at.sent;
}

// Row `id` didn't take this save as asked (an update refused, or an insert
// whose id is already taken). If the row already holds exactly this save,
// it's done. If it holds one of this device's own earlier tries of it (its
// answer lost), it's brought up to date over that. Anything else is a change
// made somewhere else: { refused: "changed" | "deleted" }.
async function ownRow(e, id, name, data, print) {
  const rec = await getProjectRecord(id, { timeoutMs: READ_TIMEOUT_MS });
  if (!rec) return { refused: "deleted" };
  const there = fingerprint(rec.data);
  if (there === print) return { id, version: rec.version };
  if (!(e.sent || []).includes(there)) return { refused: "changed" };
  const r = await updateProjectRow(id, name, data, { expectedVersion: rec.version, timeoutMs: WRITE_TIMEOUT_MS });
  return r.ok ? { id, version: r.version } : { refused: "changed" };
}

// deferLimit: a refusal over the trial limit returns "later", changing
// nothing, for run() to try once more after the other saves.
async function syncOne(e, { deferLimit = false } = {}) {
  setStatus(e.id, "syncing");
  try {
    const safe = await prepare(e);
    const name = e.name || "Untitled drawing";
    const print = fingerprint(asSent(safe));
    await noteSent(e, print);
    if (e.kind === "insert") {
      let res;
      try {
        res = await insertProjectRecord(name, safe, { id: e.plainInsert ? undefined : e.id, timeoutMs: WRITE_TIMEOUT_MS });
      } catch (err) {
        if (isDuplicate(err)) {
          // An earlier try made it and its answer was lost.
          res = await ownRow(e, e.id, name, safe, print);
          if (res.refused) return keepAsCopy(e, safe, name, res.refused);
        } else if (!isNetworkError(err) && !e.plainInsert && !err?.cause && !/TRY_SYMBOL|subscription/i.test(String(err?.message))) {
          // (err.cause: a billing refusal, lib/writeErrors -- not about the id.)
          // The database didn't take an id from the app: let it choose one.
          await updateEntry(e.id, (cur) => (cur ? { ...cur, plainInsert: true } : undefined));
          res = await insertProjectRecord(name, safe, { timeoutMs: WRITE_TIMEOUT_MS });
        } else throw err;
      }
      return finish(e, { id: res.id, version: res.version, safe, name, type: "inserted" });
    }

    if (e.base === undefined) {
      // Nothing to say which version this work is based on: never written
      // over the row blind. Kept as a copy instead.
      return keepAsCopy(e, safe, name, "unknown");
    }
    const r = await updateProjectRow(e.id, name, safe, { expectedVersion: e.base, timeoutMs: WRITE_TIMEOUT_MS });
    if (r.ok) return finish(e, { id: e.id, version: r.version, safe, name, type: "synced" });
    // Not written. Was it this very save, or an earlier try of it, landed
    // with its answer lost?
    const own = await ownRow(e, e.id, name, safe, print);
    if (!own.refused) return finish(e, { id: e.id, version: own.version, safe, name, type: "synced" });
    return keepAsCopy(e, safe, name, own.refused);
  } catch (err) {
    const network = isNetworkError(err);
    const refused = network ? null : refusalOf(err);
    if (refused === "limit" && deferLimit) { setStatus(e.id, e.refused ? "refused" : "local", e.refused); return "later"; }
    // The work stays here whatever happened: only the note of why changes.
    let fresh = false;
    await updateEntry(e.id, (cur) => {
      if (!cur) return undefined;
      fresh = Boolean(refused) && cur.refused !== refused;
      return {
        ...cur,
        tries: (cur.tries || 0) + 1,
        error: network ? null : String(err?.message || err),
        refused: refused || null,
        nextTry: network ? null : Date.now() + STUCK_RETRY_MS,
      };
    });
    setStatus(e.id, network ? "waiting" : refused ? "refused" : "stuck", refused);
    // Said once per save refused (a later save of it that's refused again
    // says so again): the editor that has it open explains.
    if (fresh) emit({ type: "refused", id: e.id, reason: refused, name: e.name || "Untitled drawing" });
    if (!network) console.warn("save couldn't be uploaded:", err?.message || err);
    return network ? "network" : "stuck";
  }
}

// The row changed or went since this work was based on it: the work becomes
// a new drawing, "<name> (copy)", and the row is left alone.
async function keepAsCopy(e, safe, name, reason) {
  const copyName = /\(copy\)$/.test(name) ? name : `${name} (copy)`;
  let copyId = e.copyId;
  if (!copyId) {
    copyId = newId();
    const at = await updateEntry(e.id, (cur) => (cur ? (cur.copyId ? cur : { ...cur, copyId }) : undefined));
    if (at?.copyId) copyId = at.copyId;
  }
  const copyData = { ...safe, meta: { ...(safe.meta || {}), projectName: copyName } };
  const print = fingerprint(asSent(copyData));
  await noteSent(e, print);
  let res;
  try {
    res = await insertProjectRecord(copyName, copyData, { id: copyId, timeoutMs: WRITE_TIMEOUT_MS });
  } catch (err) {
    if (!isDuplicate(err)) throw err;
    // Made by an earlier try. If it has been changed somewhere else since,
    // this work goes into a copy of its own.
    res = await ownRow(e, copyId, copyName, copyData, print);
    if (res.refused) {
      const again = newId();
      await updateEntry(e.id, (cur) => (cur ? { ...cur, copyId: again } : undefined));
      res = await insertProjectRecord(copyName, copyData, { id: again, timeoutMs: WRITE_TIMEOUT_MS });
    }
  }
  return finish(e, { id: res.id, version: res.version, safe: copyData, name: copyName, type: "copied", from: e.id, reason });
}

async function finish(e, res) {
  // Newer work saved while this went up stays waiting: it goes up next, on
  // top of the version just written (to the copy, if this one became one).
  let moved = null;
  await updateEntry(e.id, (cur) => {
    if (!cur) return undefined;
    if (cur.tag === e.tag) return null;
    moved = { ...cur, id: res.id, key: keyFor(res.id), kind: "update", base: res.version, tries: 0, error: null, refused: null, nextTry: null, copyId: undefined, plainInsert: undefined, sent: [] };
    return moved;
  });
  if (res.id !== e.id) { await forgetDrawing(uid, e.id); setStatus(e.id, null); }
  // The device copy is always the newest work on this device.
  await rememberDrawing(uid, res.id, moved
    ? { name: moved.name, data: moved.data, version: res.version }
    : { name: res.name, data: res.safe, version: res.version });
  await noteInList(uid, { id: res.id, name: res.name, updatedAt: res.version, preview: buildPreview(res.safe), ...searchFields(res.safe) });
  // What the database now counts for it (Try mode, lib/device/symbolCounts).
  await noteSymbolCount(uid, res.id, symbolCount(res.safe));
  setStatus(res.id, moved ? "local" : "synced");
  emit({ ...res, tag: e.tag, previousId: e.id });
  return "ok";
}
