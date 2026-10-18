"use client";

/* ============================================================================
 * lib/device/idb.js -- what this device keeps for weak signal (IndexedDB)
 * ----------------------------------------------------------------------------
 * One database, four stores, every key starting with the signed-in user's id
 * ("<uid>/..."), so one account's copies can never be read for another:
 *   drawings  the account's drawings (lib/device/drawings, lib/device/library)
 *   images    plan images and PDFs, by their storage path (lib/device/planCache)
 *   outbox    saves made on this device and not yet uploaded (lib/device/outbox)
 *   lists     the dashboard's list of drawings ("<uid>/projects"), the
 *             account's settings and company details ("<uid>/account:..."),
 *             floor plan sketches ("<uid>/sketch:<id>", lib/device/sketches),
 *             the work planner ("<uid>/planner", lib/device/plannerCopy) and
 *             each drawing's symbol count for Try mode
 *             ("<uid>/account:symbolCounts", lib/device/symbolCounts)
 *
 * Opened at whatever version it is (never upgraded once made): an upgrade
 * waits on every other open tab, and a tab still on an older build would be
 * left without storage.
 * Signing out clears it (lib/device/session).
 *
 * Every call is best effort: if IndexedDB is unavailable (some private
 * windows) or fails, reads find nothing and writes are skipped, and the app
 * works as it did before -- straight from the network.
 * ========================================================================== */

const DB_NAME = "plotwire-device";
export const STORES = ["drawings", "images", "outbox", "lists"];
const UPGRADE_WAIT_MS = 8000;

let dbPromise = null;

function open() {
  if (typeof window === "undefined" || !window.indexedDB) return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      let req, done = false;
      const finish = (db) => { if (!done) { done = true; resolve(db); } };
      try { req = window.indexedDB.open(DB_NAME); } catch { resolve(null); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "key" });
      };
      req.onsuccess = () => {
        const db = req.result;
        // Another tab upgrading the database: step aside, reopen next time.
        db.onversionchange = () => { try { db.close(); } catch { /* closed */ } dbPromise = null; };
        if (done) { try { db.close(); } catch { /* closed */ } return; }
        finish(db);
      };
      req.onerror = () => finish(null);
      // Another tab still has the older version open: it steps aside
      // (onversionchange above), so wait a little before giving up.
      req.onblocked = () => setTimeout(() => { if (!done) { dbPromise = null; finish(null); } }, UPGRADE_WAIT_MS);
    });
  }
  return dbPromise;
}

function run(store, mode, fn) {
  return open().then((db) => new Promise((resolve) => {
    if (!db) { resolve(undefined); return; }
    let tx, out;
    try {
      tx = db.transaction(store, mode);
      out = fn(tx.objectStore(store));
    } catch { resolve(undefined); return; }
    tx.oncomplete = () => resolve(out && "result" in out ? out.result : out);
    tx.onerror = () => resolve(undefined);
    tx.onabort = () => resolve(undefined);
  })).catch(() => undefined);
}

export const idbGet = (store, key) => run(store, "readonly", (s) => s.get(key));
export const idbPut = (store, value) => run(store, "readwrite", (s) => s.put(value)).then((r) => r !== undefined);
export const idbDelete = (store, key) => run(store, "readwrite", (s) => s.delete(key));

// Read one record and write what replaces it in a single transaction, so no
// other tab can write it in between. change(current) runs inside the
// transaction, so it must not wait on anything; it gets null if there is no
// record, and returns the record to keep (its key may differ from `key`: the
// record moves), null to delete it, or undefined to leave it as it is.
// Resolves to { ok: true, value: what change returned }, or { ok: false } if
// IndexedDB couldn't do it (nothing was written).
export function idbUpdate(store, key, change) {
  return open().then((db) => new Promise((resolve) => {
    if (!db) { resolve({ ok: false }); return; }
    let tx, value;
    try {
      tx = db.transaction(store, "readwrite");
      const s = tx.objectStore(store);
      const req = s.get(key);
      req.onsuccess = () => {
        try {
          value = change(req.result ?? null);
          if (value === null) s.delete(key);
          else if (value && typeof value === "object") {
            if (value.key !== key) s.delete(key);
            s.put(value);
          }
        } catch { try { tx.abort(); } catch { /* already finished */ } }
      };
    } catch { resolve({ ok: false }); return; }
    tx.oncomplete = () => resolve({ ok: true, value });
    tx.onerror = () => resolve({ ok: false });
    tx.onabort = () => resolve({ ok: false });
  })).catch(() => ({ ok: false }));
}

// Every record whose key starts with `prefix` ("<uid>/").
export function idbAll(store, prefix = "") {
  const range = prefix && typeof IDBKeyRange !== "undefined"
    ? IDBKeyRange.bound(prefix, prefix + "￿") : undefined;
  return run(store, "readonly", (s) => s.getAll(range)).then((r) => r || []);
}

// Delete every record in `store` for which keep(key) is false.
export function idbPrune(store, keep) {
  return open().then((db) => new Promise((resolve) => {
    if (!db) { resolve(); return; }
    let tx;
    try {
      tx = db.transaction(store, "readwrite");
      const req = tx.objectStore(store).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return;
        if (!keep(c.key, c.value)) c.delete();
        c.continue();
      };
    } catch { resolve(); return; }
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  })).catch(() => {});
}

export const idbClear = (store) => run(store, "readwrite", (s) => s.clear());

// Ask the browser not to clear this site's storage under pressure: unsent
// saves live here. A refusal only means the usual browser rules apply.
export function askToPersist() {
  try { navigator.storage?.persist?.().catch(() => {}); } catch { /* not supported */ }
}
