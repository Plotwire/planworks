"use client";

/* ============================================================================
 * lib/device/sketches.js -- floor plan sketches, kept on this device
 * ----------------------------------------------------------------------------
 * The sketch tool (components/cad/CadSketch.jsx) works with no signal: every
 * sketch is kept on the device (the offline library keeps all of them, see
 * syncSketchLibrary), a save goes to the device at once and uploads in the
 * background with retry, and a new sketch gets its id here, so a retried
 * upload can't make a second one.
 *
 * Opening a sketch with signal fetches the server's version (as before), so a
 * sketch changed on another device opens as it now is; the device's copy is
 * used with no signal, or when the server doesn't answer within a few
 * seconds, or when this device has work for it still waiting to upload.
 *
 * Sketches have always been saved last-writer-wins (no version check), and
 * still are. A sketch deleted elsewhere while this device had changes for it
 * is put back with those changes, rather than losing them.
 *
 * Kept in IndexedDB's "lists" store, key "<uid>/sketch:<id>":
 *   { key, id, name, data, updatedAt (the server's; null if never uploaded),
 *     dirty (a tag while a save waits to upload, else null), isNew (never
 *     uploaded), savedAt, aliasOf (the id the database gave it instead) }
 * ========================================================================== */

import { idbGet, idbAll, idbUpdate, idbDelete } from "./idb";
import { listSketches, getSketchRecord, insertSketch, updateSketch, deleteSketch } from "../cad/sketchStore";

const STORE = "lists";
const BACKOFF_MS = [3000, 10000, 30000, 60000, 120000];
const OPEN_WAIT_MS = 5000;      // opening: the server's version if it answers this soon
const READ_TIMEOUT_MS = 20000;
const WRITE_TIMEOUT_MS = 60000;

let uid = null;
let timer = null;
let running = false;
let again = false;   // asked to run while running: run once more after
let failures = 0;
let wired = false;

const prefix = (u) => `${u}/sketch:`;
const keyOf = (u, id) => `${u}/sketch:${id}`;
const newId = () => {
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch { /* fall through */ }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
};
const online = () => typeof navigator === "undefined" || navigator.onLine !== false;
const isNetwork = (err) => !online() || err?.status === 0 || err?.noSignal ||
  /abort|failed to fetch|fetch failed|networkerror|network request failed|load failed|timed? ?out/i.test(String(err?.message || err || ""));
const isDuplicate = (err) => err?.code === "23505" || /duplicate key/i.test(String(err?.message || ""));
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("timed out"), { status: 0 })), ms))]);

export function setSketchesUser(userId) {
  uid = userId || null;
  clearTimeout(timer);
  failures = 0;
  if (!uid) return;
  if (!wired && typeof window !== "undefined") {
    wired = true;
    window.addEventListener("online", () => { failures = 0; schedule(500); });
  }
  schedule(2000);
}

async function record(id) {
  if (!uid || !id) return null;
  let r = await idbGet(STORE, keyOf(uid, id));
  if (r?.aliasOf) r = await idbGet(STORE, keyOf(uid, r.aliasOf));
  return r || null;
}

// ---- What the sketch tool calls ---------------------------------------------

// Save a sketch: on the device at once, then up in the background. A new
// sketch (no id) gets one here. Resolves to the id. If this device can't
// keep it (storage not working), it's saved straight to the server as before.
export async function saveSketch({ id, name, data }) {
  if (!uid) throw new Error("Not signed in.");
  const existing = id ? await record(id) : null;
  const target = existing ? existing.id : id || newId();
  const tag = newId();
  const r = await idbUpdate(STORE, keyOf(uid, target), (prev) => ({
    key: keyOf(uid, target), id: target, name: name || "Untitled sketch", data,
    updatedAt: prev?.updatedAt ?? null, isNew: prev ? prev.isNew === true : !id, dirty: tag, savedAt: Date.now(),
  }));
  if (!r.ok) {
    if (id) {
      const res = await updateSketch(id, name, data);
      if (res && res.updated === false) await insertSketch(name, data, { id });
      return id;
    }
    return insertSketch(name, data, { id: target });
  }
  schedule(0);
  return target;
}

// A sketch to open, as { id, name, data }, or null when there's no such
// sketch. With signal, the server's version (waiting a few seconds at most);
// the device's copy with no signal, or when it holds work still waiting.
export async function openSketch(id) {
  const kept = await record(id);
  if (kept && (kept.dirty || kept.isNew || !online())) return { id: kept.id, name: kept.name, data: kept.data };
  const since = Date.now();
  try {
    const rec = await withTimeout(getSketchRecord(kept ? kept.id : id), kept ? OPEN_WAIT_MS : READ_TIMEOUT_MS);
    if (!rec) return kept && kept.isNew ? { id: kept.id, name: kept.name, data: kept.data } : null;
    await keep(kept ? kept.id : id, rec, since);
    return { id: kept ? kept.id : id, name: rec.name, data: rec.data };
  } catch (err) {
    if (kept) return { id: kept.id, name: kept.name, data: kept.data };
    throw err;
  }
}

// The sketches list: the server's with this device's own (new or changed
// here) laid over it; with no signal, this device's.
export async function sketchList() {
  const mine = uid ? (await idbAll(STORE, prefix(uid))).filter((r) => !r.aliasOf) : [];
  let server = null;
  try { server = await withTimeout(listSketches({ throwOnError: true }), READ_TIMEOUT_MS); } catch { server = null; }
  const byId = new Map();
  if (server) for (const s of server) byId.set(s.id, s);
  for (const r of mine) {
    if (!server || r.dirty || r.isNew || byId.has(r.id)) {
      const at = r.dirty ? new Date(r.savedAt).toISOString() : (r.updatedAt || byId.get(r.id)?.updatedAt || new Date(r.savedAt).toISOString());
      byId.set(r.id, { id: r.id, name: r.dirty || !byId.has(r.id) ? r.name : byId.get(r.id).name, updatedAt: at });
    }
  }
  return [...byId.values()].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

// Delete a sketch: from the server (needs signal, unless it never got
// there), then from this device.
export async function removeSketch(id) {
  const kept = await record(id);
  if (!kept || !kept.isNew) await deleteSketch(kept ? kept.id : id);
  if (uid && kept) await idbDelete(STORE, keyOf(uid, kept.id));
}

// ---- Keeping copies -------------------------------------------------------------

// The server's version, kept -- unless this device has saved the sketch since
// the read began (`since`): that work is newer, waiting or not.
async function keep(id, rec, since = 0) {
  await idbUpdate(STORE, keyOf(uid, id), (prev) => {
    if (prev?.dirty || prev?.isNew) return undefined;
    if (prev && since && (prev.savedAt || 0) > since) return undefined;
    return { key: keyOf(uid, id), id, name: rec.name || "Untitled sketch", data: rec.data, updatedAt: rec.updatedAt ?? null, isNew: false, dirty: null, savedAt: Date.now() };
  });
}

// The offline library (lib/device/library.js): every sketch of the account
// kept here at its latest version; ones deleted elsewhere dropped.
export async function syncSketchLibrary(shouldStop) {
  if (!uid) return;
  const me = uid;
  const listedAt = Date.now();
  const server = await withTimeout(listSketches({ throwOnError: true }), READ_TIMEOUT_MS);
  const mine = new Map((await idbAll(STORE, prefix(me))).map((r) => [r.id, r]));
  for (const s of server) {
    if (shouldStop && (await shouldStop())) return;
    const have = mine.get(s.id);
    if (have && (have.dirty || have.updatedAt === s.updatedAt)) continue;
    const since = Date.now();
    const rec = await withTimeout(getSketchRecord(s.id), READ_TIMEOUT_MS);
    if (uid !== me) return;
    if (rec) await keep(s.id, rec, since);
  }
  const listed = new Set(server.map((s) => s.id));
  for (const r of mine.values()) {
    if (listed.has(r.id) || r.dirty || r.isNew || r.aliasOf || (r.savedAt || 0) > listedAt) continue;
    await idbDelete(STORE, r.key);
  }
}

// ---- Uploading ----------------------------------------------------------------

function schedule(ms) {
  clearTimeout(timer);
  if (!uid) return;
  timer = setTimeout(run, ms);
}

async function run() {
  if (!uid) return;
  if (running) { again = true; return; }
  const me = uid;
  running = true;
  let wait = null;
  try {
    const waiting = (await idbAll(STORE, prefix(me))).filter((r) => r.dirty && !r.aliasOf);
    for (const r of waiting) {
      if (uid !== me) return;
      try {
        let id = r.id;
        if (r.isNew) {
          try {
            await withTimeout(insertSketch(r.name, r.data, { id: r.id }), WRITE_TIMEOUT_MS);
          } catch (err) {
            if (isDuplicate(err)) await withTimeout(updateSketch(r.id, r.name, r.data), WRITE_TIMEOUT_MS); // an earlier try made it
            else if (isNetwork(err)) throw err;
            else {
              // The database didn't take an id from the app: let it choose one,
              // and remember the old id points at it (drawings may name it).
              id = await withTimeout(insertSketch(r.name, r.data), WRITE_TIMEOUT_MS);
            }
          }
        } else {
          const res = await withTimeout(updateSketch(r.id, r.name, r.data), WRITE_TIMEOUT_MS);
          // Deleted elsewhere meanwhile: put back, with this device's work.
          if (res && res.updated === false) await withTimeout(insertSketch(r.name, r.data, { id: r.id }), WRITE_TIMEOUT_MS);
        }
        await done(r, id);
        failures = 0;
      } catch (err) {
        if (isNetwork(err)) { failures++; wait = BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)]; break; }
        console.warn("sketch couldn't be uploaded:", err?.message || err);
        wait = 5 * 60000;
      }
    }
  } finally {
    running = false;
    // Saved again, or another account's turn, while this ran: run again now.
    if (again) { again = false; schedule(0); }
    else if (uid === me && wait !== null) schedule(wait);
  }
}

// Uploaded: no longer waiting, unless it was saved again meanwhile.
async function done(r, id) {
  const now = new Date().toISOString();
  if (id !== r.id) {
    // Under the id the database chose, with the newest work kept here
    // (saved again during the upload: still waiting).
    let cur = null;
    await idbUpdate(STORE, keyOf(uid, r.id), (c) => { cur = c; return { key: keyOf(uid, r.id), id: r.id, aliasOf: id, savedAt: Date.now() }; });
    const latest = cur && !cur.aliasOf ? cur : r;
    const still = latest.dirty !== r.dirty;
    await idbUpdate(STORE, keyOf(uid, id), () => ({ ...latest, key: keyOf(uid, id), id, isNew: false, dirty: still ? latest.dirty : null, updatedAt: now, savedAt: Date.now() }));
    if (still) schedule(0);
    return;
  }
  await idbUpdate(STORE, keyOf(uid, id), (cur) => {
    if (!cur) return undefined;
    if (cur.dirty !== r.dirty) { schedule(0); return { ...cur, isNew: false }; }
    return { ...cur, isNew: false, dirty: null, updatedAt: now };
  });
}

// Saves of sketches still waiting on this device for `forUid`.
export async function waitingSketches(forUid = uid) {
  return forUid ? (await idbAll(STORE, prefix(forUid))).filter((r) => r.dirty && !r.aliasOf).length : 0;
}

// For lib/device/session.js: is this record (any account's) a sketch save
// still waiting to upload?
export const isWaitingSketch = (key, value) => typeof key === "string" && key.includes("/sketch:") && Boolean(value && value.dirty);
