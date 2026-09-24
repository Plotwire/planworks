"use client";

import { supabase } from "./supabase";
import { saveError } from "./writeErrors";

function client() {
  if (!supabase) throw new Error("Cloud storage isn't configured yet.");
  return supabase;
}

async function currentUserId() {
  const { data } = await client().auth.getUser();
  return data?.user?.id || null;
}

/* ----------------------------------------------------------------------------
 * Lightweight dashboard preview.
 * The dashboard only needs a few small fields per project to draw its card +
 * thumbnail. Deriving and storing this tiny object (instead of fetching the
 * whole drawing for every card) keeps memory and transfer flat as the account
 * grows -- the fix for iPad Safari struggling when several full drawings are
 * held in memory at once. The preview lives inside the project JSON, so there
 * is no schema change.
 * -------------------------------------------------------------------------- */
export function buildPreview(data) {
  if (!data) return null;
  const sheets = Array.isArray(data.sheets) ? data.sheets : null;
  const first = sheets ? (sheets[0] || {}) : data; // legacy flat projects
  const bgi = first && first.bgImage;
  const bg = bgi && bgi.w && bgi.h ? { path: bgi.path || null, w: bgi.w, h: bgi.h } : null;
  const dots = ((first && first.placed) || []).slice(0, 600).map((p) => ({ x: p.x, y: p.y }));
  const count = sheets
    ? sheets.reduce((n, s) => n + ((s.placed && s.placed.length) || 0), 0)
    : ((data.placed && data.placed.length) || 0);
  const firstNumber = sheets ? ((sheets[0] && sheets[0].drawingNumber) || "") : "";
  return {
    plot: (data.meta && data.meta.plot) || "",
    drawingNumber: firstNumber || (data.meta && data.meta.drawingNumber) || "",
    floors: sheets ? sheets.length : 1,
    count,
    bg,
    dots,
  };
}

// List the signed-in user's projects (newest first). Selects ONLY the small
// preview, not the full drawing. Falls back to the full-data path if the light
// select isn't available, so the dashboard can never be left broken.
export async function listProjects() {
  const cl = client();
  const light = await cl
    .from("projects")
    .select("id, name, updated_at, preview:data->preview")
    .order("updated_at", { ascending: false });

  let rows;
  if (!light.error) {
    rows = (light.data || []).map((r) => ({
      id: r.id,
      name: r.name,
      updatedAt: r.updated_at,
      preview: r.preview || null,
    }));
  } else {
    console.warn("listProjects: light path unavailable, using full data:", light.error.message);
    const full = await cl
      .from("projects")
      .select("id, name, updated_at, data")
      .order("updated_at", { ascending: false });
    if (full.error) throw full.error;
    return (full.data || []).map((r) => ({
      id: r.id,
      name: r.name,
      updatedAt: r.updated_at,
      preview: buildPreview(r.data),
    }));
  }

  // Heal legacy rows with no stored preview yet: fetch just those, derive it,
  // use it now, and persist it so they are light next time. Drawings whose plan
  // image is still an embedded base64 (no Storage path) keep their thumbnail via
  // a transient src and are intentionally NOT persisted -- they stay on the heal
  // path (thumbnail preserved, no regression) until moved to Storage separately.
  const missing = rows.filter((r) => !r.preview).map((r) => r.id);
  if (missing.length) {
    try {
      const { data: legacy } = await cl.from("projects").select("id, data").in("id", missing);
      const byId = new Map((legacy || []).map((x) => [x.id, x.data]));
      for (const r of rows) {
        if (r.preview || !byId.has(r.id)) continue;
        const raw = byId.get(r.id);
        const pv = buildPreview(raw);
        const first = (raw && (Array.isArray(raw.sheets) ? raw.sheets[0] : raw)) || {};
        const bgi = first.bgImage;
        const legacyBase64 =
          bgi && bgi.w && bgi.h && !bgi.path && typeof bgi.src === "string" && bgi.src.startsWith("data:");
        if (legacyBase64 && pv && pv.bg) {
          r.preview = { ...pv, bg: { ...pv.bg, src: bgi.src } };
        } else {
          r.preview = pv;
          cl.from("projects")
            .update({ data: { ...(raw || {}), preview: pv } })
            .eq("id", r.id)
            .then(() => {}, () => {});
        }
      }
    } catch (err) {
      console.warn("preview heal skipped:", err && err.message);
    }
  }
  return rows;
}

export async function getProjectData(id) {
  const { data, error } = await client()
    .from("projects")
    .select("data")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data?.data || null;
}

// Insert a new project, returns its new id (uuid).
export async function insertProject(name, data) {
  const user_id = await currentUserId();
  const payload = { ...(data || {}), preview: buildPreview(data) };
  const { data: row, error } = await client()
    .from("projects")
    .insert({ user_id, name: name || "Untitled drawing", data: payload })
    .select("id")
    .single();
  if (error) throw saveError(error);
  return row.id;
}

export async function updateProjectRow(id, name, data) {
  const payload = { ...(data || {}), preview: buildPreview(data) };
  const { error } = await client()
    .from("projects")
    .update({ name, data: payload, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw saveError(error);
}

// Delete ONE drawing, and only if it belongs to the signed-in user.
//
// public.projects should have an RLS policy that already enforces this at the
// database level (see supabase/projects-rls-setup.sql) -- the user_id filter
// here is a second lock, not the only one, so a missing policy can't turn into
// "delete anyone's drawing by id". The .select() makes the delete report what
// it actually removed: exactly one row, or an error. Without it a delete that
// matched nothing would look like success and the card would come back on the
// next refresh.
export async function deleteProjectRow(id) {
  if (!id) throw new Error("No drawing was specified.");
  const user_id = await currentUserId();
  if (!user_id) throw new Error("You're not signed in.");
  const { data, error } = await client()
    .from("projects")
    .delete()
    .eq("id", id)
    .eq("user_id", user_id)
    .select("id");
  if (error) throw error;
  if (!data || data.length !== 1) {
    throw new Error("That drawing couldn't be deleted -- it may already be gone, or it isn't yours.");
  }
}

// Of the given plan-image paths, the ones no project row refers to -- the only
// ones safe to delete. Save As makes a row that shares its source's stored
// files, so one file can belong to several drawings. RLS limits the check to
// the signed-in user's own rows, the only ones that can read their files.
// Keeps a path on any doubt: a failed check leaves an orphaned file, which is
// harmless, never a drawing without its plan.
export async function unreferencedPlanPaths(paths) {
  const unique = [...new Set((paths || []).filter(Boolean))];
  if (!unique.length) return [];
  // Where a row can refer to a file: a sheet's plan image or original PDF, or
  // the single top-level plan of a drawing saved before multi-sheet support.
  const refsTo = (path) => [
    { sheets: [{ bgImage: { path } }] },
    { sheets: [{ bgImage: { pdfPath: path } }] },
    { bgImage: { path } },
  ];
  try {
    const cl = client();
    const inUse = async (path) => {
      for (const ref of refsTo(path)) {
        const { data, error } = await cl.from("projects").select("id").contains("data", ref).limit(1);
        if (error) throw error;
        if (data.length) return true;
      }
      return false;
    };
    const used = await Promise.all(unique.map(inUse));
    return unique.filter((_, i) => !used[i]);
  } catch (err) {
    console.warn("plan file reference check failed; keeping the files:", err?.message);
    return [];
  }
}

// Confirm the signed-in user really knows their password, for a destructive
// step. Uses the same call as the login screen; a wrong password fails without
// disturbing the session that's already signed in.
export async function verifyPassword(password) {
  if (!password) return { ok: false, message: "Enter your password to confirm." };
  const cl = client();
  const { data } = await cl.auth.getUser();
  const email = data?.user?.email;
  if (!email) return { ok: false, message: "You're not signed in." };
  const { error } = await cl.auth.signInWithPassword({ email, password });
  if (error) {
    // Supabase rate-limits repeated failures; pass that through rather than
    // insisting the password is wrong.
    const msg = /rate|too many/i.test(error.message || "")
      ? "Too many attempts. Wait a minute and try again."
      : "That password isn't right.";
    return { ok: false, message: msg };
  }
  return { ok: true };
}

// Detect drawings saved on this device under the old browser-storage scheme.
export function localProjectsPending() {
  if (typeof window === "undefined" || !supabase) return 0;
  try {
    if (localStorage.getItem("planworks:migrated")) return 0;
    const raw = localStorage.getItem("planworks:index");
    if (!raw) return 0;
    const idx = JSON.parse(raw);
    return Array.isArray(idx) ? idx.length : 0;
  } catch { return 0; }
}

// One-time upload of this device's locally-saved drawings into the cloud account.
export async function migrateLocalProjects() {
  if (typeof window === "undefined") return 0;
  let count = 0;
  try {
    const raw = localStorage.getItem("planworks:index");
    if (!raw) return 0;
    const index = JSON.parse(raw);
    const user_id = await currentUserId();
    for (const e of index) {
      try {
        const projRaw = localStorage.getItem("planworks:proj:" + e.id);
        if (!projRaw) continue;
        const data = JSON.parse(projRaw);
        const name = e.name || data?.meta?.projectName || "Untitled drawing";
        const { error } = await client()
          .from("projects")
          .insert({ user_id, name, data: { ...data, preview: buildPreview(data) } });
        if (!error) count++;
      } catch { /* skip a bad row */ }
    }
    localStorage.setItem("planworks:migrated", "1");
  } catch (err) {
    console.error("migrate failed", err);
  }
  return count;
}

/* ============================================================================
 * USER SETTINGS  (per-account)
 * One row per user in public.user_settings (user_id uuid PK, data jsonb).
 * Used for the editable title block template (logos + detail lines).
 * Resilient: if the table doesn't exist yet, reads return null instead of
 * throwing, so the app falls back to defaults until the table is created.
 * ========================================================================= */
export async function getSettings() {
  if (!supabase) return null;
  try {
    const user_id = await currentUserId();
    if (!user_id) return null;
    const { data, error } = await client()
      .from("user_settings")
      .select("data")
      .eq("user_id", user_id)
      .maybeSingle();
    if (error) { console.warn("getSettings:", error.message); return null; }
    return data?.data || null;
  } catch (err) {
    console.warn("getSettings failed:", err.message);
    return null;
  }
}

export async function saveSettings(settings) {
  const user_id = await currentUserId();
  if (!user_id) throw new Error("Not signed in.");
  const { error } = await client()
    .from("user_settings")
    .upsert(
      { user_id, data: settings, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  if (error) throw error;
}
