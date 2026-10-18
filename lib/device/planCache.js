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
 * Images live in IndexedDB (lib/device/idb), keyed "<uid>/<path>". The
 * offline library (lib/device/library) keeps one of every plan image and
 * original PDF the account's drawings use, and drops the ones no drawing
 * uses any more (dropUnused). Signing out clears them (lib/device/session).
 * ========================================================================== */

import { idbGet, idbPut, idbAll, idbDelete } from "./idb";
import { signPlanImages } from "../planImages";

const DOWNLOAD_TIMEOUT_MS = 60000;
const LARGE_DOWNLOAD_TIMEOUT_MS = 5 * 60000; // an original PDF on a weak signal
const SIGN_BATCH = 8;                         // signed links last a while, not for ever

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
  if (!currentUid || !blob) return false;
  return idbPut("images", { key: key(currentUid, path), path, blob, size: blob.size || 0, usedAt: Date.now() });
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

async function download(url, timeoutMs = DOWNLOAD_TIMEOUT_MS) {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
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

// ---- The offline library (lib/device/library) ----------------------------

// What this device keeps for the account: path -> size (bytes). No image is
// read into memory for this.
export async function keptFiles() {
  const out = new Map();
  if (!currentUid) return out;
  for (const r of await idbAll("images", currentUid + "/")) {
    if (r.uploadedAs || !r.path || r.path.startsWith("local:")) continue;
    out.set(r.path, r.size || 0);
  }
  return out;
}

// Bytes of plan files kept, the local-only ones (not uploaded yet) included.
export async function keptBytes() {
  if (!currentUid) return 0;
  let n = 0;
  for (const r of await idbAll("images", currentUid + "/")) n += r.size || 0;
  return n;
}

// Download each path not kept yet, one at a time, and keep it. Stops early
// when shouldStop() says so (no signal, signed out, storage nearly full).
// Resolves to the number kept.
export async function keepFiles(paths, { shouldStop } = {}) {
  if (!currentUid) return 0;
  const have = await keptFiles();
  const missing = [...new Set((paths || []).filter((p) => p && !have.has(p)))];
  let kept = 0;
  for (let i = 0; i < missing.length; i += SIGN_BATCH) {
    if (shouldStop && (await shouldStop())) break;
    const batch = missing.slice(i, i + SIGN_BATCH);
    // A request that hangs on a weak signal mustn't hold the library up.
    const signed = await Promise.race([signPlanImages(batch), new Promise((r) => setTimeout(() => r(new Map()), DOWNLOAD_TIMEOUT_MS))]);
    for (const path of batch) {
      if (shouldStop && (await shouldStop())) return kept;
      const url = signed.get(path);
      if (!url) continue;
      const blob = await download(url, /\.pdf$/i.test(path) ? LARGE_DOWNLOAD_TIMEOUT_MS : DOWNLOAD_TIMEOUT_MS);
      if (blob && (await storeImage(path, blob))) kept++;
    }
  }
  return kept;
}

// Drop kept files no drawing uses any more (deleted drawings, replaced
// plans). Never a local-only plan, and never one kept in the last graceMs:
// a plan just imported is kept before the drawing using it is saved.
export async function dropUnused(used, graceMs = 24 * 3600 * 1000) {
  if (!currentUid) return 0;
  const before = Date.now() - graceMs;
  let n = 0;
  for (const r of await idbAll("images", currentUid + "/")) {
    if (r.pinned || !r.path || used.has(r.path) || (r.usedAt || 0) > before) continue;
    await idbDelete("images", r.key);
    if (links.has(r.path)) { try { URL.revokeObjectURL(links.get(r.path)); } catch { /* gone */ } links.delete(r.path); }
    n++;
  }
  return n;
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
