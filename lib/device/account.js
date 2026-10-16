"use client";

/* ============================================================================
 * lib/device/account.js -- the account's own details, kept on this device
 * ----------------------------------------------------------------------------
 * What the title block, the quote and the PDFs need besides the drawing: the
 * account's settings (title block, quote items and rates, quote preferences,
 * Symbol Library ticks) and its company details and logos. Each is kept here
 * whenever it is loaded, and shown from here at once (and with no signal).
 *
 * Settings changed here go to the device first, then up (flushSettings): only
 * the fields changed, laid over what the server holds at that moment
 * (patchSettings), so a change made without signal can never overwrite
 * settings this device didn't see. Changes waiting to go up are kept across
 * reloads, and merged when there are several.
 *
 * Kept in IndexedDB's "lists" store under "<uid>/account:<name>", so they
 * follow the same rules as the rest of the device copies: deleted on sign-out,
 * and never read for another account (lib/device/session).
 * ========================================================================== */

import { idbGet, idbPut, idbDelete } from "./idb";
import { loadSettings, patchSettings } from "../db";

const k = (uid, name) => `${uid}/account:${name}`;

export async function keptAccount(uid, name) {
  if (!uid) return undefined;
  const r = await idbGet("lists", k(uid, name));
  return r ? r.value : undefined;
}
export function keepAccount(uid, name, value) {
  if (!uid) return Promise.resolve(false);
  return idbPut("lists", { key: k(uid, name), value, savedAt: Date.now() });
}

// ---- Settings -----------------------------------------------------------------

// The account's settings: the device's copy with any changes still waiting
// laid over it, then (when there is signal) the server's, with the waiting
// changes laid over that. onValue is called with each as it becomes known.
// Resolves once the server has answered (or couldn't be reached).
export async function readSettings(uid, onValue) {
  const pending = (await keptAccount(uid, "settingsPending")) || null;
  const kept = await keptAccount(uid, "settings");
  if (kept !== undefined) onValue({ ...(kept || {}), ...(pending || {}) }, "device");
  try {
    const fresh = await loadSettings();
    await keepAccount(uid, "settings", fresh || {});
    const still = (await keptAccount(uid, "settingsPending")) || null;
    onValue({ ...(fresh || {}), ...(still || {}) }, "server");
    if (still) flushSettings(uid);
  } catch (err) {
    console.warn("settings: using this device's copy:", err?.message || err);
    if (kept === undefined) onValue(pending ? { ...pending } : null, "none");
  }
}

// Change some settings: on the device at once, then up in the background.
// Resolves once the change is on the device (not when it reaches the server).
export async function changeSettings(uid, patch) {
  if (!uid) throw new Error("Not signed in.");
  const pending = (await keptAccount(uid, "settingsPending")) || {};
  await keepAccount(uid, "settingsPending", { ...pending, ...patch });
  const kept = (await keptAccount(uid, "settings")) || {};
  await keepAccount(uid, "settings", { ...kept, ...patch });
  flushSettings(uid);
}

let flushing = null;
export function flushSettings(uid) {
  if (!uid) return Promise.resolve();
  if (flushing) return flushing.then(() => flushSettings(uid));
  flushing = (async () => {
    try {
      const pending = await keptAccount(uid, "settingsPending");
      if (!pending || !Object.keys(pending).length) return;
      const stored = await patchSettings(pending);
      // Only what was sent is done: a change made meanwhile still waits.
      const now = (await keptAccount(uid, "settingsPending")) || {};
      const left = {};
      for (const key of Object.keys(now)) if (JSON.stringify(now[key]) !== JSON.stringify(pending[key])) left[key] = now[key];
      if (Object.keys(left).length) await keepAccount(uid, "settingsPending", left);
      else await idbDelete("lists", k(uid, "settingsPending"));
      await keepAccount(uid, "settings", { ...(stored || {}), ...left });
    } catch (err) {
      console.warn("settings change waiting for signal:", err?.message || err);
    }
  })().finally(() => { flushing = null; });
  return flushing;
}
