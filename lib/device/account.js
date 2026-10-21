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
 * reloads, merged when there are several, retried every RETRY_MS while any
 * wait, and counted as unsent work on sign-out (lib/device/session).
 *
 * Kept in IndexedDB's "lists" store under "<uid>/account:<name>", so they
 * follow the same rules as the rest of the device copies: deleted on sign-out,
 * and never read for another account (lib/device/session).
 * ========================================================================== */

import { idbGet, idbPut, idbDelete } from "./idb";
import { loadSettings, patchSettings } from "../db";

const RETRY_MS = 60000;
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

// Settings changes waiting to upload, for `uid` (any account's). The Recent
// symbols list alone isn't work to warn about on sign-out: it is only which
// symbols sit at the top of the palette.
export async function settingsWaiting(uid) {
  const p = await keptAccount(uid, "settingsPending");
  return Boolean(p && Object.keys(p).some((key) => key !== "recentSymbols"));
}
export const isWaitingSettings = (key) => typeof key === "string" && key.endsWith("/account:settingsPending");

// ---- Settings -----------------------------------------------------------------

// Bumped each time changes finish uploading: a read from the server that
// began before then may predate them (readSettings).
let uploads = 0;

// The account's settings: the device's copy with any changes still waiting
// laid over it, then (when there is signal) the server's, with the waiting
// changes laid over that. onValue is called with each as it becomes known.
// Resolves once the server has answered (or couldn't be reached).
export async function readSettings(uid, onValue) {
  const pending = (await keptAccount(uid, "settingsPending")) || null;
  const kept = await keptAccount(uid, "settings");
  if (kept !== undefined) onValue({ ...(kept || {}), ...(pending || {}) }, "device");
  const before = uploads;
  try {
    const fresh = await loadSettings();
    if (uploads !== before) {
      // Changes went up while this read was on its way: it may not have them.
      // The device's copy has them (flushSettings keeps what was stored).
      const now = (await keptAccount(uid, "settings")) || {};
      const still = (await keptAccount(uid, "settingsPending")) || null;
      onValue({ ...now, ...(still || {}) }, "device");
      return;
    }
    await keepAccount(uid, "settings", fresh || {});
    const still = (await keptAccount(uid, "settingsPending")) || null;
    onValue({ ...(fresh || {}), ...(still || {}) }, "server");
    if (still) flushSettings(uid);
  } catch (err) {
    console.warn("settings: using this device's copy:", err?.message || err);
    if (kept === undefined) onValue(pending ? { ...pending } : null, "none");
  }
}

// The account's settings as the server holds them now, or null with no
// signal: for the Recent symbols, which another device can change while this
// one is open (components/AppShell.jsx reads them again as a drawing opens).
export async function settingsOnServer() {
  try { return await loadSettings(); } catch { return null; }
}

// Change some settings: on the device at once, then up in the background.
// Resolves once the change is on the device (not when it reaches the server).
// If this device can't keep it, it's sent straight to the server instead,
// and rejects if that fails, so a change is never silently dropped.
export async function changeSettings(uid, patch) {
  if (!uid) throw new Error("Not signed in.");
  const pending = (await keptAccount(uid, "settingsPending")) || {};
  if (!(await keepAccount(uid, "settingsPending", { ...pending, ...patch }))) {
    await patchSettings(patch);
    return;
  }
  const kept = (await keptAccount(uid, "settings")) || {};
  await keepAccount(uid, "settings", { ...kept, ...patch });
  flushSettings(uid);
}

// Where the upload of settings changes is, for the screens that change them
// (the quote presets), so a change is never shown as saved when it isn't:
//   "saved"      nothing waiting: the account has every change
//   "uploading"  kept on this device, going up now
//   "waiting"    kept on this device, no signal: it goes up when there is
//   "failed"     kept on this device, but the account refused it (error says
//                why); it is still retried
let upload = { state: "saved", error: null };
const watchers = new Set();
function setUpload(next) {
  upload = next;
  watchers.forEach((fn) => { try { fn(next); } catch { /* a screen gone */ } });
}
export function watchSettingsUpload(fn) {
  watchers.add(fn);
  fn(upload);
  return () => watchers.delete(fn);
}
// No signal (the request never reached the account), as against a refusal.
const isNoSignal = (err) => (typeof navigator !== "undefined" && navigator.onLine === false)
  || err instanceof TypeError || /failed to fetch|network|load failed|timed? ?out/i.test(String(err?.message || err));

let flushing = null;
let retryTimer = null;
export function flushSettings(uid) {
  if (!uid) return Promise.resolve();
  if (flushing) return flushing.then(() => flushSettings(uid));
  clearTimeout(retryTimer);
  flushing = (async () => {
    try {
      const pending = await keptAccount(uid, "settingsPending");
      if (!pending || !Object.keys(pending).length) { setUpload({ state: "saved", error: null }); return; }
      setUpload({ state: "uploading", error: null });
      const stored = await patchSettings(pending);
      uploads++;
      // Only what was sent is done: a change made meanwhile still waits.
      const now = (await keptAccount(uid, "settingsPending")) || {};
      const left = {};
      for (const key of Object.keys(now)) if (JSON.stringify(now[key]) !== JSON.stringify(pending[key])) left[key] = now[key];
      if (Object.keys(left).length) await keepAccount(uid, "settingsPending", left);
      else await idbDelete("lists", k(uid, "settingsPending"));
      await keepAccount(uid, "settings", { ...(stored || {}), ...left });
      if (Object.keys(left).length) retryTimer = setTimeout(() => flushSettings(uid), 1000);
      else setUpload({ state: "saved", error: null });
    } catch (err) {
      console.warn("settings change waiting for signal:", err?.message || err);
      setUpload(isNoSignal(err) ? { state: "waiting", error: null } : { state: "failed", error: String(err?.message || err) });
      // On a weak signal the browser may never say "online" again: try again.
      retryTimer = setTimeout(() => flushSettings(uid), RETRY_MS);
    }
  })().finally(() => { flushing = null; });
  return flushing;
}

// Signing out or another account: stop retrying for this one.
export function stopSettings() { clearTimeout(retryTimer); }
