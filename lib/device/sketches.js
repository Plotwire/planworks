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
 * Sketches have always been saved last-writer-wins (no version check), and
 * still are: what a device saves replaces the sketch. A sketch's work isn't
 * lost to that -- the drawing it was sent to keeps the plan image -- and
 * drawings themselves keep the drawing-safety rules (lib/device/outbox).
 *
 * Record ("sketches" store, key "<uid>/<id>"):
 *   { key, id, name, data, updatedAt (the server's; null if never uploaded),
 *     dirty (a tag while a save waits to upload, else null), isNew (never
 *     uploaded), savedAt, aliasOf (the id the database gave it instead) }
 * ========================================================================== */

import { idbGet, idbAll, idbUpdate, idbDelete } from "./idb";
import { listSketches, getSketchRecord, insertSketch, updateSketch, deleteSketch } from "../cad/sketchStore";

const BACKOFF_MS = [3000, 10000, 30000, 60000, 120000];
const READ_TIMEOUT_MS = 20000;

let uid = null;
let timer = null;
let running = false;
let again = false;   // asked to run while running: run once more after
let failures = 0;
let wired = false;

const keyOf = (u, id) => `${u}/${id}`;
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
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timed out")), ms))]);

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
  let r = await idbGet("sketches", keyOf(uid, id));
  if (r?.aliasOf) r = await idbGet("sketches", keyOf(uid, r.aliasOf));
  return r || null;
}

// ---- What the sketch tool calls ---------------------------------------------

// Save a sketch: on the device at once, then up in the background. A new
// sketch (no id) gets one here. Resolves to the id.
export async function saveSketch({ id, name, data }) {
  if (!uid) throw new Error("Not signed in.");
  let target = id || newId();
  const existing = id ? await record(id) : null;
  if (existing) target = existing.id;
  const tag = newId();
  const r = await idbUpdate("sketches", keyOf(uid, target), (prev) => ({
    key: keyOf(uid, target), id: target, name: name || "Untitled sketch", data,
    updatedAt: prev?.updatedAt ?? null, isNew: prev ? prev.isNew === true : !id, dirty: tag, savedAt: Date.now(),
  }));
  if (!r.ok) throw new Error("This device couldn't keep the sketch.");
  schedule(0);
  return target;
}

// A sketch to open: this device's copy if it has one (kept up to date by the
// offline library), else fetched and kept. Resolves to { id, name, data }, or
// null when there's no such sketch. Throws with no signal and no copy.
export async function openSketch(id) {
  const kept = await record(id);
  if (kept) {
    if (!kept.dirty) refresh(kept).catch(() => {});
    return { id: kept.id, name: kept.name, data: kept.data };
  }
  const rec = await withTimeout(getSketchRecord(id), READ_TIMEOUT_MS);
  if (!rec) return null;
  await keep(id, rec);
  return { id, name: rec.name, data: rec.data };
}

// The sketches list: the server's with this device's own (new or changed
// here) laid over it; with no signal, this device's.
export async function sketchList() {
  const mine = uid ? (await idbAll("sketches", uid + "/")).filter((r) => !r.aliasOf) : [];
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
  if (uid && kept) await idbDelete("sketches", keyOf(uid, kept.id));
}

// ---- Keeping copies -------------------------------------------------------------

async function keep(id, rec) {
  await idbUpdate("sketches", keyOf(uid, id), (prev) => {
    if (prev?.dirty) return undefined; // work here waiting to upload is newer
    return { key: keyOf(uid, id), id, name: rec.name || "Untitled sketch", data: rec.data, updatedAt: rec.updatedAt ?? null, isNew: false, dirty: null, savedAt: Date.now() };
  });
}

async function refresh(kept) {
  if (!online()) return;
  const rec = await withTimeout(getSketchRecord(kept.id), READ_TIMEOUT_MS);
  if (rec && rec.updatedAt !== kept.updatedAt) await keep(kept.id, rec);
}

// The offline library (lib/device/library.js): every sketch of the account
// kept here at its latest version; ones deleted elsewhere dropped.
export async function syncSketchLibrary(shouldStop) {
  if (!uid) return;
  const me = uid;
  const listedAt = Date.now();
  const server = await listSketches({ throwOnError: true });
  const mine = new Map((await idbAll("sketches", me + "/")).map((r) => [r.id, r]));
  for (const s of server) {
    if (shouldStop && (await shouldStop())) return;
    const have = mine.get(s.id);
    if (have && (have.dirty || have.updatedAt === s.updatedAt)) continue;
    const rec = await getSketchRecord(s.id);
    if (uid !== me) return;
    if (rec) await keep(s.id, rec);
  }
  const listed = new Set(server.map((s) => s.id));
  for (const r of mine.values()) {
    if (listed.has(r.id) || r.dirty || r.isNew || r.aliasOf || (r.savedAt || 0) > listedAt) continue;
    await idbDelete("sketches", r.key);
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
    const waiting = (await idbAll("sketches", me + "/")).filter((r) => r.dirty && !r.aliasOf);
    for (const r of waiting) {
      if (uid !== me) return;
      try {
        let id = r.id;
        if (r.isNew) {
          try {
            await insertSketch(r.name, r.data, { id: r.id });
          } catch (err) {
            if (isDuplicate(err)) await updateSketch(r.id, r.name, r.data); // an earlier try made it
            else if (isNetwork(err)) throw err;
            else {
              // The database didn't take an id from the app: let it choose one,
              // and remember the old id points at it (drawings may name it).
              id = await insertSketch(r.name, r.data);
            }
          }
        } else {
          await updateSketch(r.id, r.name, r.data);
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
    if (uid === me) {
      if (wait !== null) schedule(wait);
      else if (again) schedule(0);
    }
    again = false;
  }
}

// Uploaded: no longer waiting, unless it was saved again meanwhile.
async function done(r, id) {
  const now = new Date().toISOString();
  if (id !== r.id) {
    await idbUpdate("sketches", keyOf(uid, id), () => ({ ...r, key: keyOf(uid, id), id, isNew: false, dirty: null, updatedAt: now, savedAt: Date.now() }));
    await idbUpdate("sketches", keyOf(uid, r.id), () => ({ key: keyOf(uid, r.id), id: r.id, aliasOf: id, savedAt: Date.now() }));
    return;
  }
  await idbUpdate("sketches", keyOf(uid, id), (cur) => {
    if (!cur) return undefined;
    if (cur.dirty !== r.dirty) { schedule(0); return { ...cur, isNew: false }; }
    return { ...cur, isNew: false, dirty: null, updatedAt: now };
  });
}

// Saves of sketches still waiting on this device for `forUid`.
export async function waitingSketches(forUid = uid) {
  return forUid ? (await idbAll("sketches", forUid + "/")).filter((r) => r.dirty && !r.aliasOf).length : 0;
}
