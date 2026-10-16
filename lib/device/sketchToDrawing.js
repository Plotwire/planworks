"use client";

/* ============================================================================
 * lib/device/sketchToDrawing.js -- the sketch tool's sends, through the outbox
 * ----------------------------------------------------------------------------
 * "Send to drawing" from the sketch page (components/cad/CadSketch.jsx) makes
 * a new drawing or updates the one the sketch was sent to before. Both go
 * through the outbox like any save (lib/device/outbox), so they work with no
 * signal, and an update keeps the drawing-safety rules: it is laid over the
 * newest work this device has for the drawing (a save still waiting, else
 * the device's copy, else the server's) and only written over the version
 * that work was based on. If the drawing changed elsewhere meanwhile, the
 * outbox keeps it as "(copy)" as it does for any save.
 * ========================================================================== */

import { pendingSaves, queueSave, newDrawingId } from "./outbox";
import { deviceDrawing, rememberDrawing, toDeviceForm, _drawingsUid } from "./drawings";
import { getProjectRecord } from "../db";

const READ_TIMEOUT_MS = 20000;
const noSignal = (err) => typeof navigator !== "undefined" && navigator.onLine === false ||
  err?.status === 0 || err?.noSignal || /abort|failed to fetch|fetch failed|networkerror|load failed|timed? ?out/i.test(String(err?.message || ""));

// The newest work this device has for drawing `id`: { data, base, expect,
// name } (data in device form), or null if the drawing doesn't exist.
// Throws with no signal when the device has nothing of it.
async function newestOf(id) {
  const uid = _drawingsUid;
  if (!uid) throw new Error("Not signed in.");
  const waiting = (await pendingSaves(uid)).find((e) => e.id === id);
  if (waiting) return { data: waiting.data, base: waiting.base, expect: waiting.tag, name: waiting.name };
  const kept = await deviceDrawing(uid, id);
  try {
    const rec = await getProjectRecord(id, { timeoutMs: READ_TIMEOUT_MS });
    if (!rec || !rec.data) return null;
    await rememberDrawing(uid, id, { name: rec.data?.meta?.projectName || "", data: rec.data, version: rec.version });
    return { data: rec.data, base: rec.version, expect: null, name: rec.data?.meta?.projectName || "" };
  } catch (err) {
    if (!noSignal(err) || !kept) throw err;
    return { data: kept.data, base: kept.version, expect: null, name: kept.name };
  }
}

// Update drawing `id`: change(data) returns the new data (any plan on it may
// be a stored path or an inline image). Resolves to { ok: true, result }
// with what change returned alongside, or { ok: false } when the drawing
// doesn't exist.
export async function updateDrawingFrom(id, change) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await newestOf(id);
    if (!cur) return { ok: false };
    const { data, ...result } = change(cur.data);
    const name = data?.meta?.projectName || cur.name || "Untitled drawing";
    const r = await queueSave({ id, name, data: await toDeviceForm(data), base: cur.base, expect: cur.expect });
    if (!r.conflict) return { ok: true, result };
    // Another tab saved it in between: lay this over that, once.
  }
  throw new Error("The drawing is being saved in another tab. Try again in a moment.");
}

// A new drawing with this data. Resolves to its id once it's on the device.
export async function newDrawingFrom(name, makeData) {
  const id = newDrawingId();
  const data = await makeData(id);
  await queueSave({ id, name, data: await toDeviceForm(data), kind: "insert" });
  return id;
}
