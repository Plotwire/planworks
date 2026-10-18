"use client";

/* ============================================================================
 * lib/device/symbolCounts.js -- each drawing's symbol count, kept on this device
 * ----------------------------------------------------------------------------
 * A Try account may have TRY_SYMBOL_LIMIT symbols across all its saved
 * drawings; the database refuses a save that would take it past that
 * (supabase/try-mode.sql), counting each drawing as it holds it. The editor
 * checks the same limit before a symbol is placed or a drawing saved
 * (components/TryMode.jsx), so that a save made with no signal is never
 * refused later. It needs the database's counts for that, so they are kept
 * here: fetched with signal (the editor, the offline library), and brought up
 * to date as this device's saves upload (lib/device/outbox) or a drawing is
 * deleted (the dashboard), so they are right with no signal too.
 *
 * Kept in IndexedDB's "lists" store under "<uid>/account:symbolCounts":
 *   { key, counts: { id: n }, noted: { id: when }, at }
 * `noted` marks counts changed here after the last fetch began (`at`), so a
 * fetch that was already on its way can't put the old ones back. Deleted on
 * sign-out with the rest of the account's copies (lib/device/session.js).
 * ========================================================================== */

import { idbGet, idbUpdate } from "./idb";
import { savedSymbolCounts } from "../db";

const keyOf = (uid) => `${uid}/account:symbolCounts`;
const READ_TIMEOUT_MS = 20000;

// The kept counts as a Map (id -> count), or null if none were ever fetched.
export async function keptSymbolCounts(uid) {
  if (!uid) return null;
  const r = await idbGet("lists", keyOf(uid));
  return r && r.counts ? new Map(Object.entries(r.counts)) : null;
}

// The database's counts, fetched `since` (when the request was sent).
async function keepCounts(uid, map, since) {
  await idbUpdate("lists", keyOf(uid), (prev) => {
    const counts = Object.fromEntries(map);
    const noted = {};
    for (const [id, at] of Object.entries(prev?.noted || {})) {
      if (at <= since) continue;
      if (prev.counts?.[id] === undefined) delete counts[id];
      else counts[id] = prev.counts[id];
      noted[id] = at;
    }
    return { key: keyOf(uid), counts, noted, at: since };
  });
}

// Fetch the database's counts and keep them. Resolves to the Map; throws
// with no signal.
export async function refreshSymbolCounts(uid) {
  if (!uid) return null;
  const since = Date.now();
  const map = await savedSymbolCounts({ timeoutMs: READ_TIMEOUT_MS });
  await keepCounts(uid, map, since);
  return map;
}

// A save reached the database: drawing `id` now holds `n` symbols there.
// Nothing is noted before the first fetch: a list of only some drawings
// would read as the whole account.
export async function noteSymbolCount(uid, id, n) {
  if (!uid || !id) return;
  await idbUpdate("lists", keyOf(uid), (prev) => (prev ? {
    ...prev,
    counts: { ...prev.counts, [id]: Number(n) || 0 },
    noted: { ...(prev.noted || {}), [id]: Date.now() },
  } : undefined));
}

// A drawing deleted: it no longer counts.
export async function forgetSymbolCount(uid, id) {
  if (!uid || !id) return;
  await idbUpdate("lists", keyOf(uid), (prev) => {
    if (!prev) return undefined;
    const { [id]: _gone, ...counts } = prev.counts || {};
    return { ...prev, counts, noted: { ...(prev.noted || {}), [id]: Date.now() } };
  });
}
