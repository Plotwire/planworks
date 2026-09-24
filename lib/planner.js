﻿"use client";

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

// Monday (local midnight) of the current real week.
export function currentMonday() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  const dow = (t.getDay() + 6) % 7;
  const m = new Date(t);
  m.setDate(t.getDate() - dow);
  return m;
}

function toISODate(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

// (week 0-3, day 0-5) -> real date string for storage.
function dateFor(w, d) {
  const m = currentMonday();
  m.setDate(m.getDate() + w * 7 + d);
  return toISODate(m);
}

// A stored row -> the shape the planner UI uses (with derived w, d).
function rowToJob(r) {
  const jd = new Date(r.job_date + "T00:00:00");
  jd.setHours(0, 0, 0, 0);
  const mon = currentMonday();
  const dayIdx = (jd.getDay() + 6) % 7; // 0=Mon .. 6=Sun
  const jobMon = new Date(jd);
  jobMon.setDate(jd.getDate() - dayIdx);
  const w = Math.round((jobMon.getTime() - mon.getTime()) / (7 * 86400000));
  return {
    id: r.id,
    c: r.contractor,
    w: w,
    d: dayIdx > 5 ? 5 : dayIdx,
    t: r.start_time || "",
    site: r.site || "",
    type: r.job_type || "",
    addr: r.addr || "",
    cust: r.cust || "",
    st: r.status || "booked",
    notes: r.notes || "",
    imp: !!r.important,
  };
}

// Load all jobs in the visible 4-week window (this Monday .. Saturday of week 3).
// The user_id filter is defence-in-depth: RLS on planner_jobs is what actually
// enforces ownership (see supabase/planner-rls-setup.sql), but the client asks
// only for its own rows too, so a lapsed policy can never quietly widen this
// into every account's diary again.
export async function loadPlannerJobs() {
  const uid = await currentUserId();
  if (!uid) throw new Error("Not signed in.");
  const mon = currentMonday();
  const start = toISODate(mon);
  const end = new Date(mon);
  end.setDate(mon.getDate() + 3 * 7 + 5);
  const { data, error } = await client()
    .from("planner_jobs")
    .select("*")
    .eq("user_id", uid)
    .gte("job_date", start)
    .lte("job_date", toISODate(end));
  if (error) throw error;
  return (data || []).map(rowToJob).filter((j) => j.w >= 0 && j.w <= 3);
}

// Insert or update a job. `job` carries { id, c, w, d, t, site, type, addr, cust, st, notes }.
export async function savePlannerJob(job) {
  const user_id = await currentUserId();
  if (!user_id) throw new Error("Not signed in.");
  const row = {
    id: job.id,
    user_id: user_id,
    job_date: dateFor(job.w, job.d),
    contractor: job.c,
    start_time: job.t || "",
    site: job.site || "",
    job_type: job.type || "",
    addr: job.addr || "",
    cust: job.cust || "",
    status: job.st || "booked",
    notes: job.notes || "",
    important: !!job.imp,
    updated_at: new Date().toISOString(),
  };
  const { error } = await client().from("planner_jobs").upsert(row, { onConflict: "id" });
  if (error) throw saveError(error);
}

export async function deletePlannerJob(id) {
  const uid = await currentUserId();
  if (!uid) throw new Error("Not signed in.");
  // Scoped by owner as well as id, so this can only ever remove one of this
  // account's own jobs -- RLS enforces the same thing server-side.
  const { error } = await client()
    .from("planner_jobs")
    .delete()
    .eq("id", id)
    .eq("user_id", uid);
  if (error) throw error;
}

/* ----------------------------------------------------------------------------
 * Planner settings (per account): editable company/planner name + the operative
 * roster. One row per user in planner_settings (user_id PK, data jsonb).
 * Resilient: if the table doesn't exist yet, returns null so the planner falls
 * back to defaults instead of breaking.
 * -------------------------------------------------------------------------- */
export async function loadPlannerSettings() {
  if (!supabase) return null;
  try {
    const uid = await currentUserId();
    if (!uid) return null;
    const { data, error } = await client()
      .from("planner_settings")
      .select("data")
      .eq("user_id", uid)
      .maybeSingle();
    if (error) { console.warn("loadPlannerSettings:", error.message); return null; }
    return data?.data || null;
  } catch (err) {
    console.warn("loadPlannerSettings failed:", err && err.message);
    return null;
  }
}

export async function savePlannerSettings(settings) {
  const user_id = await currentUserId();
  if (!user_id) throw new Error("Not signed in.");
  const { error } = await client()
    .from("planner_settings")
    .upsert({ user_id, data: settings, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw error;
}

/* ----------------------------------------------------------------------------
 * Read-only share link.
 * The owner generates a secret token stored in their own settings row. Anyone
 * with the link can VIEW the diary (via the planner_shared SQL function, which
 * is the only anonymous door and requires the token); nobody can edit without
 * signing in. Regenerating the token instantly revokes old links.
 * -------------------------------------------------------------------------- */
// The token is the only thing guarding the share link, so it must come from a
// cryptographically secure source. There is deliberately no Math.random
// fallback: if crypto.randomUUID is unavailable this throws and no link is made.
function randomToken() {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
}

// Return the account's existing share token, creating one if needed.
export async function ensureShareToken() {
  const current = (await loadPlannerSettings()) || {};
  if (current.shareToken && String(current.shareToken).length >= 16) return current.shareToken;
  const token = randomToken();
  await savePlannerSettings({ ...current, shareToken: token });
  return token;
}

// Issue a brand-new token; any previously shared link stops working.
export async function regenerateShareToken() {
  const current = (await loadPlannerSettings()) || {};
  const token = randomToken();
  await savePlannerSettings({ ...current, shareToken: token });
  return token;
}

// Public read: fetch a shared diary by token (no sign-in required).
export async function loadSharedPlanner(token) {
  if (!supabase) throw new Error("Cloud storage isn't configured yet.");
  const { data, error } = await supabase.rpc("planner_shared", { p_token: token });
  if (error) throw error;
  if (!data) return null;
  const jobs = (data.jobs || []).map(rowToJob).filter((j) => j.w >= 0 && j.w <= 3);
  return { settings: data.settings || {}, jobs };
}
