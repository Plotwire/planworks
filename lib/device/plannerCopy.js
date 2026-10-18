"use client";

/* ============================================================================
 * lib/device/plannerCopy.js -- the work planner, kept on this device
 * ----------------------------------------------------------------------------
 * The planner as the server last gave it: its jobs (the four weeks it shows,
 * and the Unscheduled tray), its settings (name, operatives, days shown) and
 * whether the database has the planner-v2 columns. Kept whenever the planner
 * loads, after each change it saves, and by the offline library in the
 * background (lib/device/library.js), so it opens with no signal, or on a
 * signal too weak to answer, showing the last saved planner instead of an
 * empty one.
 *
 * View only: with no signal the planner can't be changed
 * (components/WorkPlanner.jsx). A planner save writes whole jobs with no
 * version check, so a change kept here for hours and uploaded later could
 * silently undo one made in the office in the meantime, and there is no safe
 * "(copy)" of a booked job, as there is of a drawing.
 *
 * Kept in IndexedDB's "lists" store under "<uid>/planner":
 *   { key, jobs, settings (null: none saved), v2, asOf, savedAt }
 * asOf is when what it holds was true on the server: when the read began,
 * or when a change was confirmed saved. Deleted on sign-out, and never read
 * for another account (lib/device/session.js).
 * ========================================================================== */

import { idbGet, idbUpdate } from "./idb";
import { loadPlannerJobs, fetchPlannerSettings, plannerSchemaV2 } from "../planner";

const keyOf = (uid) => `${uid}/planner`;
const READ_TIMEOUT_MS = 30000;

export async function keptPlanner(uid) {
  if (!uid) return null;
  const r = await idbGet("lists", keyOf(uid));
  return r && Array.isArray(r.jobs) ? r : null;
}

// Keep the planner as the server had it at `asOf`, unless what is kept is
// newer (a read that began earlier must never roll back a change confirmed
// since). settings undefined: keep the settings already kept.
export async function keepPlanner(uid, { jobs, settings, v2 }, asOf) {
  if (!uid || !Array.isArray(jobs)) return false;
  const at = asOf || Date.now();
  const r = await idbUpdate("lists", keyOf(uid), (prev) => {
    if (prev && (prev.asOf || 0) > at) return undefined;
    return {
      key: keyOf(uid), jobs, v2: Boolean(v2), asOf: at, savedAt: Date.now(),
      settings: settings === undefined ? (prev?.settings ?? null) : settings,
    };
  });
  return Boolean(r.ok && r.value);
}

// Settings just saved: kept with the jobs already kept.
export async function keepPlannerSettings(uid, settings) {
  if (!uid) return;
  await idbUpdate("lists", keyOf(uid), (prev) => (prev ? { ...prev, settings, savedAt: Date.now() } : undefined));
}

// Fetch the planner and keep it (the offline library). Throws when it
// couldn't be fetched; settings that couldn't be read keep the kept ones.
export async function refreshPlannerCopy(uid) {
  if (!uid) return;
  const asOf = Date.now();
  const [jobs, settings, v2] = await Promise.all([
    loadPlannerJobs({ timeoutMs: READ_TIMEOUT_MS }),
    fetchPlannerSettings({ timeoutMs: READ_TIMEOUT_MS }).catch(() => undefined),
    plannerSchemaV2({ timeoutMs: READ_TIMEOUT_MS }),
  ]);
  await keepPlanner(uid, { jobs, settings, v2 }, asOf);
}
