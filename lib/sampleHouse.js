"use client";

/* ============================================================================
 * lib/sampleHouse.js -- "Try a sample house" (the new-account dashboard)
 * ----------------------------------------------------------------------------
 * For someone without a plan to hand: a ready-made two-bed bungalow, made
 * into a drawing of their own exactly as the Floor Plan tool makes one
 * (components/cad/CadSketch.jsx createDrawing): the floor plan is saved to
 * their account as a sketch (so Floor plan opens it, to edit), its picture
 * goes on a new drawing at true scale, and the drawing is saved to their
 * account. Plan only: placing the sockets and lights is theirs to do.
 *
 * Works with no signal like the Floor Plan tool: the sketch and the drawing
 * go to this device first and upload when there is signal (lib/device), and
 * the plan's picture rides in the drawing until it can be uploaded.
 * ========================================================================== */

import { T_EXT, T_INT } from "./cad/plan";
import { renderModelToPng } from "./cad/sketchToImage";
import { PLAN_PX, scalePrefOf, scaleLabel, planSheetFrame, stairsField, planStairs } from "./cad/planScale";
import { saveSketch } from "./device/sketches";
import { newDrawingFrom } from "./device/sketchToDrawing";
import { uploadPlanImage, dataUrlToBlob } from "./planImages";

export const SAMPLE_NAME = "Sample house";

const ext = (id, x1, y1, x2, y2) => ({ id, type: "external", x1, y1, x2, y2 });
const int = (id, x1, y1, x2, y2) => ({ id, type: "internal", x1, y1, x2, y2 });
const box = (pre, a, b, c, d) => [ext(pre + "N", a, b, c, b), ext(pre + "E", c, b, c, d), ext(pre + "S", a, d, c, d), ext(pre + "W", a, b, a, d)];
const door = (id, x, y, dir, w, o = {}) => ({ id, x, y, dir, w, t: T_INT, hinge: -1, fold: 1, ref: "", ...o });
const win = (id, x, y, dir, w, o = {}) => ({ id, x, y, dir, w, t: T_EXT, escape: false, ref: "", ...o });
const room = (name, x, y) => ({ name, x, y, auto: true });

// A two-bed bungalow, 11 m by 7 m (mm, the Floor Plan tool's units): living
// room down one side; two bedrooms, kitchen, hall and bathroom on the other.
// Room sizes are worked out by the Floor Plan tool from the walls.
export function sampleModel() {
  return {
    wallStyle: "solid", wallWeight: "standard", labelSize: "medium", notes: [], boundary: null, rooflights: [],
    EXTENT: { w: 11000, h: 7600, margin: 2600 },
    walls: [
      ...box("B-", 150, 150, 11150, 7150),
      int("i1", 4200, 150, 4200, 7150), int("i2", 4200, 3600, 11150, 3600), int("i3", 7600, 150, 7600, 3600),
      int("i4", 7600, 3600, 7600, 7150), int("i5", 9400, 3600, 9400, 7150),
    ],
    doors: [
      door("d1", 4200, 2600, "v", 800), door("d2", 5200, 3600, "h", 800), door("d3", 8400, 3600, "h", 800),
      door("d4", 7600, 5000, "v", 800), door("d5", 9400, 5200, "v", 750),
      door("fd", 8500, 7150, "h", 1000, { t: T_EXT, hinge: -1, fold: -1 }),
    ],
    windows: [
      win("w1", 2000, 150, "h", 1800), win("w2", 5800, 150, "h", 1500), win("w3", 9400, 150, "h", 1500),
      win("w4", 2000, 7150, "h", 1800), win("w5", 5800, 7150, "h", 1500), win("w6", 10300, 7150, "h", 900),
    ],
    dims: [],
    rooms: [room("Living", 2175, 3650), room("Bed 1", 5900, 1875), room("Bed 2", 9375, 1875), room("Kitchen", 5900, 5375), room("Hall", 8500, 5375), room("Bath", 10275, 5375)],
    stairs: null,
  };
}

const noSignal = (err) => (typeof navigator !== "undefined" && navigator.onLine === false) || err?.status === 0 || err?.noSignal ||
  /abort|failed to fetch|fetch failed|networkerror|load failed|timed? ?out/i.test(String(err?.message || ""));

// The sample house as a new drawing of this account's. Resolves to the
// drawing's id once it is on this device (open it with /drawing?id=...).
export async function createSampleDrawing() {
  const model = sampleModel();
  const ps = planSheetFrame(model, { scalePref: scalePrefOf(model) });
  const png = await renderModelToPng(model, ps.frame, PLAN_PX, { scale: ps.scale });
  let path = null;
  try {
    path = (await uploadPlanImage(dataUrlToBlob(png.dataUrl))).path;
  } catch (err) {
    if (!noSignal(err)) throw err;
  }
  const sheetId = "s_" + Math.random().toString(36).slice(2, 9);
  const today = new Date().toISOString().slice(0, 10);
  return newDrawingFrom(SAMPLE_NAME, async (id) => {
    const skId = await saveSketch({ id: null, name: SAMPLE_NAME, data: { ...model, _link: { projectId: id, sheetId, frame: ps.frame, scale: ps.scale } } });
    return {
      meta: { projectName: SAMPLE_NAME, drawingNumber: "", date: today, revision: "A", revNote: "First Issue", company: "", clientName: "", clientEmail: "", scale: scaleLabel(ps.scale) },
      boq: null, titleBlock: null, colourMode: "red",
      notes: "",
      sheets: [{
        id: sheetId, name: "Ground floor", drawingNumber: "", sketchId: skId,
        bgImage: { ...(path ? { path } : { src: png.dataUrl }), w: png.w, h: png.h, planFrame: ps.frame, planScale: ps.scale, ...stairsField(ps.frame, planStairs(model)) },
        placed: [], furniture: [], walls: [], wires: [], annotations: [], notes: "", symbolScale: 1,
      }],
      activeSheetId: sheetId,
    };
  });
}
