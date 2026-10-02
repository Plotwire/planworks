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
 * roster, plus the share link's token. One row per user in planner_settings
 * (user_id PK, data jsonb).
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

// The stored settings as an object ({} when there are none).
function asSettings(data) {
  return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}

// What a settings save writes: the stored settings, freshly read, with the
// fields this save sends laid over them. Anything the save doesn't send is
// kept -- above all the share token, which a settings save never changes, so
// editing the operatives can't break a link a contractor is using. Only
// ensureShareToken() and regenerateShareToken() change the token.
export function mergePlannerSettings(stored, changes) {
  const { shareToken: _ignored, ...fields } = asSettings(changes);
  return { ...asSettings(stored), ...fields };
}

// Read, change and write this account's settings row in one safe step.
// `change(stored)` gets the settings as stored now and returns what to write,
// or null to write nothing. The write only lands if the row is still as it
// was read (same updated_at, and a share token still there, or still not
// there); if another tab or device saved in between, it reads again and
// re-applies the change, so neither save is lost and a regenerated or revoked
// link can't be brought back. Every app write moves updated_at on, so that
// check catches a changed token; the presence check also catches a link
// revoked by SQL that left updated_at alone. The token itself is never
// compared: filters travel in the request URL, which ends up in request logs,
// and the token is the key to the shared diary. A read that fails never
// writes: writing over settings it couldn't read is what used to drop the
// share token. Resolves to the settings now stored.
const SETTINGS_ATTEMPTS = 3;

async function changePlannerSettings(change) {
  const db = client();
  const user_id = await currentUserId();
  if (!user_id) throw new Error("Not signed in.");
  for (let attempt = 0; attempt < SETTINGS_ATTEMPTS; attempt++) {
    const { data: row, error } = await db
      .from("planner_settings")
      .select("data, updated_at")
      .eq("user_id", user_id)
      .maybeSingle();
    if (error) throw error;
    const stored = asSettings(row?.data);
    const next = change(stored);
    if (!next) return stored;
    // Never the same instant as the stored one (or earlier, on a device whose
    // clock is behind), so every save is seen as a change by the check above.
    let stamp = Date.now();
    const was = row?.updated_at ? Date.parse(row.updated_at) : NaN;
    if (Number.isFinite(was) && stamp <= was) stamp = was + 1;
    const updated_at = new Date(stamp).toISOString();

    if (!row) {
      const { error: insertError } = await db
        .from("planner_settings")
        .insert({ user_id, data: next, updated_at });
      if (!insertError) return next;
      if (insertError.code === "23505") continue; // another tab made the row first
      throw saveError(insertError);
    }

    let write = db
      .from("planner_settings")
      .update({ data: next, updated_at })
      .eq("user_id", user_id);
    write = row.updated_at == null ? write.is("updated_at", null) : write.eq("updated_at", row.updated_at);
    write = stored.shareToken == null
      ? write.is("data->>shareToken", null)
      : write.not("data->>shareToken", "is", null);
    const { data: written, error: updateError } = await write.select("user_id");
    if (updateError) throw saveError(updateError);
    if (written && written.length) return next;
    // Changed since it was read: go round again.
  }
  throw new Error("Your planner settings were being changed somewhere else at the same time. Try again.");
}

// Saves the company name, planner title and operatives. Keeps every other
// stored setting, including the share token.
export async function savePlannerSettings(settings) {
  await changePlannerSettings((stored) => mergePlannerSettings(stored, settings));
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

const hasShareToken = (settings) =>
  Boolean(settings.shareToken) && String(settings.shareToken).length >= 16;

// Return the account's existing share token, creating one if needed. Reads
// the stored settings itself and fails if it can't: a read that failed must
// never look like "no link yet" and replace a link people are using.
export async function ensureShareToken() {
  const saved = await changePlannerSettings((stored) =>
    hasShareToken(stored) ? null : { ...stored, shareToken: randomToken() });
  return saved.shareToken;
}

// Issue a brand-new token; any previously shared link stops working.
export async function regenerateShareToken() {
  const saved = await changePlannerSettings((stored) => ({ ...stored, shareToken: randomToken() }));
  return saved.shareToken;
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
