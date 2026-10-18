"use client";

/* ============================================================================
 * lib/pdfPlan.js -- a PDF plan's page 1 as the plan picture
 * ----------------------------------------------------------------------------
 * The editor shows a PDF plan from the PDF itself while it has it (sharp at
 * any zoom, components/SheetParts.jsx PlanBackground). The picture made here
 * is what's shown otherwise -- before the PDF loads, without signal, in the
 * dashboard card -- and what the PDF download falls back to, so it has to
 * hold real detail.
 * ========================================================================== */

import { ensurePdfjs } from "./pdfjs";
import { smallCanvasBudget } from "./touch";

// A plan picture made from a PDF is never smaller than this on its long side.
export const MIN_PLAN_PX = 1500;

// A PDF by its type or name, or else by its first bytes: a PDF that arrives
// without either (some iPad pickers and drags) must not go down the picture
// path, where Safari draws it at 1 pixel per point -- a blurry 600 px plan.
export async function looksLikePdf(file) {
  if (!file) return false;
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name || "")) return true;
  try {
    const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
    for (let i = 0; i + 4 < head.length; i++) {
      if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46 && head[i + 4] === 0x2d) return true; // "%PDF-"
    }
  } catch { /* unreadable: not a PDF we can use */ }
  return false;
}

// The scale page 1 is drawn at: full detail for an A3 (about 4400 px wide on
// a computer, 2400 on an iPad) and more for bigger sheets (about 200 or 120
// pixels per inch of the sheet), within what each device's canvas holds:
// iOS fails big canvases with a blank render or a crash.
export function pdfPlanScale(base, small = smallCanvasBudget()) {
  const TARGET_W = Math.max(small ? 2400 : 4400, (base.width / 72) * (small ? 120 : 200));
  const MAX_DIM = small ? 4096 : 8192;
  const MAX_AREA = small ? 12_000_000 : 48_000_000;
  const long = Math.max(base.width, base.height);
  let scale = Math.max(small ? 1.5 : 3, Math.min(TARGET_W / base.width, small ? 3.2 : 5));
  scale = Math.max(scale, MIN_PLAN_PX / long);
  scale = Math.min(scale, MAX_DIM / long, Math.sqrt(MAX_AREA / (base.width * base.height)));
  return scale;
}

// Page 1 of `data` (ArrayBuffer or Uint8Array) as { blob, w, h }. PNG keeps
// line art crisp on a computer; JPEG keeps iPad memory down. Throws rather
// than give a picture under MIN_PLAN_PX.
export async function renderPdfPlan(data) {
  const pdfjs = await ensurePdfjs();
  const pdf = await pdfjs.getDocument({ data }).promise;
  const page = await pdf.getPage(1); // multi-page is a future feature
  const small = smallCanvasBudget();
  const viewport = page.getViewport({ scale: pdfPlanScale(page.getViewport({ scale: 1 }), small) });
  const c = document.createElement("canvas");
  c.width = Math.round(viewport.width);
  c.height = Math.round(viewport.height);
  const w = c.width, h = c.height;
  if (Math.max(w, h) < MIN_PLAN_PX) throw new Error(`the plan would only be ${w} x ${h} pixels, too small to stay sharp`);
  try {
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise((res, rej) =>
      c.toBlob(b => b ? res(b) : rej(new Error("Could not render the plan image.")), small ? "image/jpeg" : "image/png", small ? 0.9 : undefined));
    return { blob, w, h };
  } finally {
    c.width = c.height = 0; // release the large canvas promptly
  }
}
