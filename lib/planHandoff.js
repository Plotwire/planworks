"use client";

/* ============================================================================
 * lib/planHandoff.js -- a plan picked on the dashboard, for the editor
 * ----------------------------------------------------------------------------
 * "Upload a plan" on the new-account dashboard opens the file picker from the
 * tap itself (iPad Safari only opens it from a tap), then the editor opens
 * in import mode and takes the file from here, instead of opening the picker
 * again (components/ElectricalPlanTool.jsx). Kept in memory only: the page
 * doesn't reload between the two, and a file left here is never used later
 * than the next import.
 * ========================================================================== */

let pending = null;

export function handOverPlan(file) { pending = file || null; }

export function takePlan() {
  const f = pending;
  pending = null;
  return f;
}
