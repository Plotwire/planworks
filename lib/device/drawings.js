"use client";

/* ============================================================================
 * lib/device/drawings.js -- drawings kept on this device
 * ----------------------------------------------------------------------------
 * Every drawing of the account (the offline library, lib/device/library),
 * and any opened or saved here, so opening one shows it at once
 * while the latest version is checked in the background (the editor's
 * openProjectById), and so a save is on the device the moment it is made
 * (lib/device/outbox). Also the dashboard's last list, for an instant
 * dashboard.
 *
 * Kept in the "device form": exactly what the drawing would be saved as, with
 * no short-lived links. A plan with a stored copy keeps only its path (the
 * image itself is in lib/device/planCache); a plan imported in this tab and
 * not uploaded yet keeps its bytes on the device (localImage), so a save made
 * without signal survives closing the tab.
 * ========================================================================== */

import { idbGet, idbPut, idbDelete, idbAll } from "./idb";
import { putLocalImage, localImageState, localImageLink } from "./planCache";

let currentUid = null;

export function setDrawingsUser(uid) { currentUid = uid || null; }
const key = (uid, id) => `${uid}/${id}`;

// blob: link -> local image key, so saving the same imported plan again
// doesn't keep its bytes twice.
const keptBlobs = new Map();
const newLocalKey = () => {
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch { /* fall through */ }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
};

// The editor's project, as it would be saved, with nothing that dies with
// the tab. Never rejects: a plan whose bytes can't be kept loses only its
// local link (its stored path, or inline image, is kept as normal).
export async function toDeviceForm(p) {
  if (!p) return p;
  const sheets = await Promise.all((p.sheets || []).map(async (s) => {
    const bg = s && s.bgImage;
    if (!bg) return s;
    const { src, pdfSrc, ...rest } = bg;
    // An original PDF with a stored copy keeps its path; one held only in
    // this tab is left out, as a save does now (the editor stores it in the
    // background and the next save carries its path).
    if (rest.path) { const { localImage, uploadKey, ...stored } = rest; return { ...s, bgImage: stored }; }
    if (typeof src === "string" && src.startsWith("data:")) return { ...s, bgImage: { ...rest, src } };
    let k = rest.localImage || (typeof src === "string" && src.startsWith("blob:") ? keptBlobs.get(src) : null);
    if (!k && typeof src === "string" && src.startsWith("blob:")) {
      try {
        const blob = await (await fetch(src)).blob();
        const candidate = newLocalKey();
        if (await putLocalImage(candidate, blob)) { k = candidate; keptBlobs.set(src, k); }
      } catch { /* the tab no longer has it */ }
    }
    if (k) {
      // Already uploaded (by the outbox, before the editor heard): its path.
      const kept = await localImageState(k);
      const { localImage, uploadKey, ...plain } = rest;
      if (kept?.path) return { ...s, bgImage: { ...plain, path: kept.path } };
      return { ...s, bgImage: { ...plain, localImage: k, uploadKey: rest.uploadKey || src } };
    }
    return { ...s, bgImage: rest };
  }));
  const { _recordId, ...data } = p;
  return { ...data, sheets };
}

// Back from the device form: plans kept only on this device get a blob: link
// again. Plans with a stored copy are linked by the caller (planCache).
export async function fromDeviceForm(data) {
  if (!data || !Array.isArray(data.sheets)) return data;
  const sheets = await Promise.all(data.sheets.map(async (s) => {
    const bg = s && s.bgImage;
    if (!bg || !bg.localImage || bg.path) return s;
    const kept = await localImageState(bg.localImage);
    if (kept?.path) {
      // Uploaded since: an ordinary stored plan now (linked by the caller).
      const { localImage, uploadKey, ...rest } = bg;
      return { ...s, bgImage: { ...rest, path: kept.path } };
    }
    const link = await localImageLink(bg.localImage);
    return link ? { ...s, bgImage: { ...bg, src: link } } : s;
  }));
  return { ...data, sheets };
}

// ---- Device copies --------------------------------------------------------

// version: the row's updated_at this copy is based on (null for a drawing
// that has never reached the server).
export async function rememberDrawing(uid, id, { name, data, version }) {
  if (!uid || !id || !data) return;
  await idbPut("drawings", { key: key(uid, id), id, name: name || "", data, version: version ?? null, savedAt: Date.now() });
}

export async function deviceDrawing(uid, id) {
  if (!uid || !id) return null;
  return (await idbGet("drawings", key(uid, id))) || null;
}

export const forgetDrawing = (uid, id) => (uid && id ? idbDelete("drawings", key(uid, id)) : Promise.resolve());

// Every drawing kept for the account (the offline library, lib/device/library).
export async function deviceDrawings(uid) {
  return uid ? idbAll("drawings", uid + "/") : [];
}

// ---- The dashboard list ---------------------------------------------------

export const rememberList = (uid, rows) => (uid ? idbPut("lists", { key: key(uid, "projects"), rows, savedAt: Date.now() }) : Promise.resolve(false));
export async function cachedList(uid) {
  if (!uid) return null;
  const r = await idbGet("lists", key(uid, "projects"));
  return r && Array.isArray(r.rows) ? r : null;
}

// A save that reached the database, written into the kept list too, so the
// dashboard shows it (a new drawing, a "(copy)", a new name) even before it
// next has signal. The next list from the database replaces this anyway.
export async function noteInList(uid, row) {
  const kept = await cachedList(uid);
  if (!kept || !row || !row.id) return;
  const rows = [row, ...kept.rows.filter((r) => r.id !== row.id)]
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  await idbPut("lists", { ...kept, rows });
}

export { currentUid as _drawingsUid };
