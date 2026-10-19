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
import { ptToMm, validRect } from "./planCrop";

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

// Page 1 of a PDF (ArrayBuffer or Uint8Array), opened once for the crop
// step and the render: { pdf, page, w, h } in PDF points as pdf.js shows it
// (rotation applied), and the paper size, pageMm. pdf.destroy() frees it.
export async function loadPdfPage(data) {
  const pdfjs = await ensurePdfjs();
  const pdf = await pdfjs.getDocument({ data }).promise;
  const page = await pdf.getPage(1); // multi-page is a future feature
  const v = page.getViewport({ scale: 1 });
  return { pdf, page, w: v.width, h: v.height, pageMm: { w: ptToMm(v.width), h: ptToMm(v.height) } };
}

// The crop (pdf.js points, top-left origin) in the PDF's own space, for the
// PDF download to embed just that area (pdf-lib embedPage).
export function cropBoxOf(page, crop) {
  const v = page.getViewport({ scale: 1 });
  const a = v.convertToPdfPoint(crop.x, crop.y), b = v.convertToPdfPoint(crop.x + crop.w, crop.y + crop.h);
  return { left: Math.min(a[0], b[0]), bottom: Math.min(a[1], b[1]), right: Math.max(a[0], b[0]), top: Math.max(a[1], b[1]) };
}

// The cropped area (or the whole page) of a loaded page as the plan
// picture, { blob, w, h }, at full detail for its own size: a small area of a
// big sheet gets more pixels per mm than the whole page would. PNG keeps line
// art crisp on a computer; JPEG keeps iPad memory down. Throws rather than
// give a picture under MIN_PLAN_PX.
export async function renderPdfPage(page, crop = null) {
  const v1 = page.getViewport({ scale: 1 });
  const r = validRect(crop) ? crop : { x: 0, y: 0, w: v1.width, h: v1.height };
  const small = smallCanvasBudget();
  const scale = pdfPlanScale({ width: r.w, height: r.h }, small);
  const viewport = page.getViewport({ scale });
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(r.w * scale));
  c.height = Math.max(1, Math.round(r.h * scale));
  const w = c.width, h = c.height;
  if (Math.max(w, h) < MIN_PLAN_PX) throw new Error(`the plan would only be ${w} x ${h} pixels, too small to stay sharp`);
  try {
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
    await page.render({ canvasContext: ctx, viewport, transform: [1, 0, 0, 1, -r.x * scale, -r.y * scale] }).promise;
    const blob = await new Promise((res, rej) =>
      c.toBlob(b => b ? res(b) : rej(new Error("Could not render the plan image.")), small ? "image/jpeg" : "image/png", small ? 0.9 : undefined));
    return { blob, w, h };
  } finally {
    c.width = c.height = 0; // release the large canvas promptly
  }
}

// Page 1 of `data` as the plan picture (the whole page).
export async function renderPdfPlan(data) {
  return renderPdfPage((await loadPdfPage(data)).page);
}

// A picture's cropped area as a picture of its own, { blob, w, h }, at the
// picture's own detail (less only where a device's canvas can't hold it).
export async function cropPicture(img, crop, type = "image/png") {
  const nw = img.naturalWidth || img.width, nh = img.naturalHeight || img.height;
  const r = validRect(crop) ? crop : { x: 0, y: 0, w: nw, h: nh };
  const cap = smallCanvasBudget() ? 12_000_000 : 40_000_000;
  const k = Math.min(1, Math.sqrt(cap / (r.w * r.h)));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(r.w * k));
  c.height = Math.max(1, Math.round(r.h * k));
  const w = c.width, h = c.height;
  try {
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const png = /png|gif|webp|svg/i.test(type);
    if (!png) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, w, h);
    const blob = await new Promise((res, rej) =>
      c.toBlob(b => b ? res(b) : rej(new Error("Could not crop the picture.")), png ? "image/png" : "image/jpeg", png ? undefined : 0.92));
    return { blob, w, h };
  } finally {
    c.width = c.height = 0;
  }
}
