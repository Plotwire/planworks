"use client";

/* ============================================================================
 * lib/device/session.js -- the device copies follow the signed-in account
 * ----------------------------------------------------------------------------
 * startDevice(uid), once per signed-in account (AppShell):
 *   - everything kept for the weak signal is read and written under that
 *     account's id only (every key starts "<uid>/");
 *   - drawings, plan images and dashboard lists kept for any OTHER account on
 *     this device are deleted, so one account's copies can never be shown to
 *     another. Another account's unsent saves are left, unread, until that
 *     account signs in here again: deleting them would lose its work.
 *   - starts uploading this account's waiting saves (lib/device/outbox).
 * clearDevice(), on signing out: deletes everything this file set up, unsent
 * saves included (AppShell asks first when there are any).
 * ========================================================================== */

import { STORES, idbClear, idbPrune, idbAll } from "./idb";
import { setPlanCacheUser, forgetPlanLinks } from "./planCache";
import { setDrawingsUser } from "./drawings";
import { startOutbox, stopOutbox, pendingSaves } from "./outbox";

let current = null;

export async function startDevice(uid) {
  if (!uid || uid === current) return;
  current = uid;
  setPlanCacheUser(uid);
  setDrawingsUser(uid);
  const mine = (k) => typeof k === "string" && k.startsWith(uid + "/");
  await Promise.all(["drawings", "images", "lists"].map((s) => idbPrune(s, mine)));
  await startOutbox(uid);
}

// The session ended without a sign-out here (expired, or signed out in
// another tab): stop uploading and reading, but keep what's on the device --
// waiting saves included -- for when this account signs in again.
export function pauseDevice() {
  if (!current) return;
  current = null;
  stopOutbox();
  setPlanCacheUser(null);
  setDrawingsUser(null);
}

export async function clearDevice() {
  current = null;
  stopOutbox();
  setPlanCacheUser(null);
  setDrawingsUser(null);
  forgetPlanLinks();
  await Promise.all(STORES.map((s) => idbClear(s)));
}

// Saves made on this device by `uid` that haven't been uploaded yet.
export async function unsentCount(uid) {
  if (!uid) return 0;
  if (uid === current) return (await pendingSaves(uid)).length;
  return (await idbAll("outbox", uid + "/")).length;
}
