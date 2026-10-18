"use client";

/* ============================================================================
 * lib/device/session.js -- the device copies follow the signed-in account
 * ----------------------------------------------------------------------------
 * startDevice(uid), once per signed-in account (AppShell):
 *   - everything kept for the weak signal is read and written under that
 *     account's id only (every key starts "<uid>/");
 *   - drawings, plan images, lists, sketches and account details kept for any
 *     OTHER account on this device are deleted, so one account's copies can
 *     never be shown to another. Another account's UNSENT work is left,
 *     unread, until that account signs in here again (deleting it would lose
 *     its work): its waiting saves (outbox), the plan images they still need
 *     to upload (pinned), its waiting sketch saves and settings changes.
 *   - starts uploading this account's waiting saves (lib/device/outbox), and
 *     keeping all of its drawings on the device (lib/device/library).
 * clearDevice(uid), on signing out: deletes everything kept for that account,
 * its unsent work included (AppShell asks first when there is any), and
 * everything of other accounts except their unsent work, as above.
 * ========================================================================== */

import { idbPrune, idbAll } from "./idb";
import { setPlanCacheUser, forgetPlanLinks } from "./planCache";
import { setDrawingsUser } from "./drawings";
import { startOutbox, stopOutbox, pendingSaves } from "./outbox";
import { startLibrary, stopLibrary } from "./library";
import { setSketchesUser, waitingSketches, isWaitingSketch } from "./sketches";
import { settingsWaiting, isWaitingSettings, stopSettings } from "./account";

let current = null;

// The account this device's copies are for now (null when none).
export const deviceUser = () => current;

const ofAccount = (uid) => (k) => typeof k === "string" && k.startsWith(uid + "/");

// Another account's work not uploaded yet: never deleted for anyone else.
function othersUnsent(store, key, value) {
  if (store === "outbox") return true;
  if (store === "images") return Boolean(value && value.pinned); // a plan an unsent save still has to upload
  if (store === "lists") return isWaitingSketch(key, value) || isWaitingSettings(key);
  return false;
}

export async function startDevice(uid) {
  if (!uid || uid === current) return;
  current = uid;
  setPlanCacheUser(uid);
  setDrawingsUser(uid);
  const mine = ofAccount(uid);
  await Promise.all(["drawings", "images", "lists"].map((s) => idbPrune(s, (k, v) => mine(k) || othersUnsent(s, k, v))));
  setSketchesUser(uid);
  await startOutbox(uid);
  startLibrary(uid);
}

// The session ended without a sign-out here (expired, or signed out in
// another tab): stop uploading and reading, but keep what's on the device --
// unsent work included -- for when this account signs in again.
export function pauseDevice() {
  if (!current) return;
  current = null;
  stopOutbox();
  stopLibrary();
  stopSettings();
  setSketchesUser(null);
  setPlanCacheUser(null);
  setDrawingsUser(null);
}

export async function clearDevice(uid) {
  current = null;
  stopOutbox();
  stopLibrary();
  stopSettings();
  setSketchesUser(null);
  setPlanCacheUser(null);
  setDrawingsUser(null);
  forgetPlanLinks();
  const mine = uid ? ofAccount(uid) : () => true;
  await Promise.all(["drawings", "images", "outbox", "lists"].map((s) =>
    idbPrune(s, (k, v) => !mine(k) && othersUnsent(s, k, v))));
}

// Work made on this device by `uid` that hasn't been uploaded yet: drawing
// saves, sketch saves, and settings changes (counted as one).
export async function unsentCount(uid) {
  if (!uid) return 0;
  const drawings = uid === current ? (await pendingSaves(uid)).length : (await idbAll("outbox", uid + "/")).length;
  return drawings + (await waitingSketches(uid)) + ((await settingsWaiting(uid)) ? 1 : 0);
}
