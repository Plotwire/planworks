"use client";

/* ============================================================================
 * lib/device/planCache.js -- plan images kept on this device
 * ----------------------------------------------------------------------------
 * A plan image is shown from a signed link that changes every time it is
 * minted, so the browser could never reuse one it had already downloaded:
 * every dashboard visit and every open fetched every plan again. Here each
 * image is kept on the device by its STORAGE PATH (which never changes for a
 * given file), and shown from a local blob: link. The network is used once
 * per image per device: one call to sign the paths not kept yet, then one
 * download each.
 *
 * Images live in IndexedDB (lib/device/idb), keyed "<uid>/<path>", at most
 * MAX_IMAGES of them (the least recently used go first). Signing out clears
 * them (lib/device/session).
 * ========================================================================== */

import { idbGet, idbPut, idbAll, idbDelete } from "./idb";
import { signPlanImages } from "../planImages";

const MAX_IMAGES = 80;
const DOWNLOAD_TIMEOUT_MS = 60000;

// path -> blob: link for this page. One link per image, so a drawing open in
// the editor and its dashboard card share it. Revoked on sign-out.
const links = new Map();
let currentUid = null;

const key = (uid, path) => `${uid}/${path}`;

export function setPlanCacheUser(uid) {
  if (uid === currentUid) return;
  currentUid = uid || null;
  forgetPlanLinks();
}

export function forgetPlanLinks() {
  for (const url of links.values()) { try { URL.revokeObjectURL(url); } catch { /* gone */ } }
  links.clear();
}

function linkFor(path, blob) {
  if (links.has(path)) return links.get(path);
  const url = URL.createObjectURL(blob);
  links.set(path, url);
  return url;
}

async function storeImage(path, blob) {
  if (!currentUid || !blob) return;
  await idbPut("images", { key: key(currentUid, path), path, blob, size: blob.size || 0, usedAt: Date.now() });
  trim();
}

let trimTimer = null;
function trim() {
  clearTimeout(trimTimer);
  trimTimer = setTimeout(async () => {
    if (!currentUid) return;
    // Local-only plans (not uploaded yet) are never trimmed: they may be the
    // only copy of a plan imported without signal.
    const all = (await idbAll("images", currentUid + "/")).filter((r) => !r.pinned);
    if (all.length <= MAX_IMAGES) return;
    all.sort((a, b) => (a.usedAt || 0) - (b.usedAt || 0));
    for (const r of all.slice(0, all.length - MAX_IMAGES)) await idbDelete("images", r.key);
  }, 2000);
}

// The blob: link for each path already on this device (no network).
export async function cachedPlanLinks(paths) {
  const out = new Map();
  if (!currentUid) return out;
  const want = [...new Set((paths || []).filter(Boolean))];
  await Promise.all(want.map(async (path) => {
    if (links.has(path)) { out.set(path, links.get(path)); return; }
    const rec = await idbGet("images", key(currentUid, path));
    if (rec && rec.blob) {
      out.set(path, linkFor(path, rec.blob));
      // Remember it was used (for the size limit), without waiting.
      idbPut("images", { ...rec, usedAt: Date.now() });
    }
  }));
  return out;
}

async function download(url) {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), DOWNLOAD_TIMEOUT_MS) : null;
  try {
    const res = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  } finally {
    if (t) clearTimeout(t);
  }
}

// Links for every path: from the device where kept, otherwise signed and
// downloaded once (in the background of whoever asks), then kept. A path that
// can't be fetched (no signal) is simply missing from the result; ask again
// later. onEach(path, link) is told about each image as it arrives, so a
// screen can show them one by one.
export async function planLinks(paths, { onEach } = {}) {
  const out = await cachedPlanLinks(paths);
  for (const [p, l] of out) onEach?.(p, l);
  const missing = [...new Set((paths || []).filter((p) => p && !out.has(p)))];
  if (!missing.length || !currentUid) return out;
  const signed = await signPlanImages(missing);
  // Two at a time: on a weak signal, the first plans arrive sooner.
  let next = 0;
  const worker = async () => {
    while (next < missing.length) {
      const path = missing[next++];
      const url = signed.get(path);
      if (!url) continue;
      const blob = await download(url);
      if (!blob) continue;
      await storeImage(path, blob);
      const link = linkFor(path, blob);
      out.set(path, link);
      onEach?.(path, link);
    }
  };
  await Promise.all([worker(), worker()]);
  return out;
}

// A plan this device has just uploaded: keep it, so it is never downloaded.
export async function rememberUploadedPlan(path, blob) {
  if (!path || !blob) return;
  await storeImage(path, blob);
}

// Images kept for local-only plans (not uploaded yet), by a key of their own.
// Once one is uploaded its bytes move to the cache above (by path) and its
// own record keeps only that path, so a save still naming it -- from an
// editor that hasn't heard yet -- finds the stored plan instead of nothing.
const localKeyOf = (localKey) => key(currentUid, "local:" + localKey);

export async function putLocalImage(localKey, blob) {
  if (!currentUid || !localKey || !blob) return false;
  return idbPut("images", { key: localKeyOf(localKey), path: "local:" + localKey, blob, size: blob.size || 0, usedAt: Date.now(), pinned: true });
}

// { blob } (not uploaded yet), { path } (uploaded), or null (not on this device).
export async function localImageState(localKey) {
  if (!currentUid || !localKey) return null;
  const rec = await idbGet("images", localKeyOf(localKey));
  if (rec?.uploadedAs) return { path: rec.uploadedAs };
  return rec?.blob ? { blob: rec.blob } : null;
}

export async function markLocalImageUploaded(localKey, path) {
  if (!currentUid || !localKey || !path) return false;
  return idbPut("images", { key: localKeyOf(localKey), path: "local:" + localKey, uploadedAs: path, size: 0, usedAt: Date.now(), pinned: true });
}

export async function localImageLink(localKey) {
  const id = "local:" + localKey;
  if (links.has(id)) return links.get(id);
  const blob = (await localImageState(localKey))?.blob;
  return blob ? linkFor(id, blob) : null;
}
