"use client";

/* ============================================================================
 * Plan-image storage (the iPad memory fix)
 * ----------------------------------------------------------------------------
 * Imported floor-plan images used to be embedded as base64 data URLs inside the
 * project JSON (and therefore inside the projects.data JSONB column, the
 * localStorage auto-draft, and every dashboard listProjects() response). On
 * iPad Safari, holding several multi-megabyte base64 strings in memory at once
 * is what crashed the tab.
 *
 * Now the bytes live in a PRIVATE Supabase Storage bucket. The project JSON
 * keeps only a tiny { path, w, h } reference. At render time we mint a short
 * signed URL for that path; the browser streams + decodes the image natively
 * and can evict it, instead of a base64 string pinned in JS heap.
 *
 * Bucket + RLS policies are created by supabase/plan-images-setup.sql.
 * ========================================================================== */

import { supabase } from "./supabase";

export const PLAN_BUCKET = "plan-images";
// Signed-URL lifetime. A fresh URL is minted every time a project is opened,
// and the print preview renews them before every export (SheetParts.jsx), so a
// drawing left open longer than this still previews and exports its plan.
const SIGN_TTL = 60 * 60 * 8; // 8 hours

function client() {
  if (!supabase) throw new Error("Cloud storage isn't configured yet.");
  return supabase;
}

async function currentUserId() {
  const { data } = await client().auth.getUser();
  return data?.user?.id || null;
}

// Convert a data: URL to a Blob WITHOUT fetch() — fetch on a multi-MB data URL
// is itself memory-heavy on iOS Safari, which is exactly what we're avoiding.
export function dataUrlToBlob(dataUrl) {
  const [head, b64] = String(dataUrl).split(",");
  const mime = (head.match(/data:([^;]+)/) || [])[1] || "image/jpeg";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// Read a Blob/File back into a data URL (used only for the offline fallback).
export function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error("Could not read image data."));
    r.readAsDataURL(blob);
  });
}

function extFor(type) {
  if (/pdf/i.test(type)) return "pdf";
  if (/png/i.test(type)) return "png";
  if (/webp/i.test(type)) return "webp";
  return "jpg";
}

function uuid() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Upload one plan image (Blob or File) into the user's private folder.
// Returns { path } — the durable reference stored in the project JSON.
export async function uploadPlanImage(blob) {
  const uid = await currentUserId();
  if (!uid) throw new Error("Not signed in.");
  const path = `${uid}/${uuid()}.${extFor(blob.type || "image/jpeg")}`;
  const { error } = await client()
    .storage
    .from(PLAN_BUCKET)
    .upload(path, blob, {
      contentType: blob.type || "image/jpeg",
      cacheControl: "3600",
      upsert: false,
    });
  if (error) throw error;
  return { path };
}

// Batch-sign many stored paths in a single round trip.
// Returns a Map<path, signedUrl>. Never throws — missing entries just won't be
// in the map, and the caller falls back to whatever src is already present.
export async function signPlanImages(paths) {
  const unique = [...new Set((paths || []).filter(Boolean))];
  const out = new Map();
  if (!unique.length || !supabase) return out;
  try {
    const { data, error } = await client()
      .storage
      .from(PLAN_BUCKET)
      .createSignedUrls(unique, SIGN_TTL);
    if (error) { console.warn("signPlanImages:", error.message); return out; }
    (data || []).forEach((row, i) => {
      const p = row?.path || unique[i];
      if (row && row.signedUrl && !row.error && p) out.set(p, row.signedUrl);
    });
  } catch (err) {
    console.warn("signPlanImages failed:", err?.message);
  }
  return out;
}

// Convenience: sign a single path.
export async function signPlanImage(path) {
  if (!path) return null;
  const map = await signPlanImages([path]);
  return map.get(path) || null;
}

// Best-effort delete of stored objects (e.g. when a project or an image is
// removed/replaced). Never throws — an orphaned object is harmless.
export async function deletePlanImages(paths) {
  const unique = [...new Set((paths || []).filter(Boolean))];
  if (!unique.length || !supabase) return;
  try {
    await client().storage.from(PLAN_BUCKET).remove(unique);
  } catch (err) {
    console.warn("deletePlanImages failed:", err?.message);
  }
}
