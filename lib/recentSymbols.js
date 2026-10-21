/* ============================================================================
 * lib/recentSymbols.js -- the account's Recent symbols (top of the palette)
 * ----------------------------------------------------------------------------
 * The last RECENT_MAX symbols placed from the palette, most recent first,
 * each once: [{ id, at }] with `at` when it was last placed (ms). Kept in the
 * account's settings (user_settings.data.recentSymbols, no new table or
 * column), so the laptop and the iPad show the same list. Pure values only:
 * where it is kept and sent is components/AppShell.jsx and lib/device/account.
 *
 * Two devices' lists combine rather than replace (mergeRecent, used when the
 * list is saved, lib/db patchSettings): each symbol at its latest use on
 * either, newest first. So a list made with no signal joins the account's
 * when it goes up, and never wipes what the other device placed meanwhile.
 * ========================================================================== */

export const RECENT_MAX = 8;

// A list as kept: well-formed entries, each symbol once (at its latest use),
// most recent first, at most RECENT_MAX. Anything else (missing, a list from
// a newer app) gives what can be read of it.
export function cleanRecent(list) {
  if (!Array.isArray(list)) return [];
  const latest = new Map();
  for (const e of list) {
    if (!e || typeof e.id !== "string" || !e.id) continue;
    const at = Number.isFinite(e.at) ? e.at : 0;
    if (!latest.has(e.id) || latest.get(e.id) < at) latest.set(e.id, at);
  }
  return [...latest].map(([id, at]) => ({ id, at }))
    .sort((a, b) => b.at - a.at)
    .slice(0, RECENT_MAX);
}

// `id` just placed: to the front (moved there if it was already in the list).
// Always ahead of the rest, even if this device's clock is behind the one
// that placed the current front symbol.
export function addRecent(list, id, now = Date.now()) {
  const clean = cleanRecent(list);
  if (!id) return clean;
  const front = clean.length ? clean[0].at : 0;
  return cleanRecent([{ id, at: Math.max(now, front + 1) }, ...clean.filter((e) => e.id !== id)]);
}

// Two lists as one: each symbol at its latest use on either.
export const mergeRecent = (a, b) => cleanRecent([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]);

export const sameRecent = (a, b) => JSON.stringify(cleanRecent(a)) === JSON.stringify(cleanRecent(b));
