"use client";

/* ============================================================================
 * Touch-device detection
 * ----------------------------------------------------------------------------
 * One definition, shared by everything that has to behave differently on an
 * iPad. It was written inline in the PDF export first; the drawing editor and
 * the CAD sketch now need the same answer, and three copies of a device check
 * that must agree is three chances for them to disagree.
 *
 * Deliberately NOT a media query in CSS: the callers use it to decide what to
 * put in a style object and what scale to rasterise at, which CSS can't
 * express, and keeping one mechanism means one thing to reason about.
 *
 * Safe before hydration -- returns false when there is no window.
 * ========================================================================= */

export function isTouchDevice() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  if (navigator.maxTouchPoints > 1) return true;
  return Boolean(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
}

/* iOS Safari's canvas limits (iPad, iPhone) and touch-first tablets: big
 * renders have to stay small there. Not a Windows laptop that merely has a
 * touch screen -- it reports touch points too (isTouchDevice), but its mouse
 * or trackpad is the main pointer and it has a desktop's memory. iPadOS
 * Safari says "Macintosh", hence the touch-points check for Macs. */
export function smallCanvasBudget() {
  if (!isTouchDevice()) return false;
  if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) return true;
  return /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent || "");
}

/* ============================================================================
 * Sheet supersample factor
 * ----------------------------------------------------------------------------
 * iOS keeps the zoom wrapper on a composited layer -- pinch mutates its
 * transform continuously -- and then stretches that layer's cached raster.
 * Neither releasing will-change nor nudging a repaint on settle shifted it.
 *
 * So lay the sheet out N times larger and divide the wrapper's transform by the
 * same N. The mapping from stored coordinates to the screen is unchanged, but
 * the layer holds N times the detail when iOS rasterises it.
 *
 * N IS THE VALUE IN THE URL. ?supersample=1.5 means N = 1.5, and ?supersample=1
 * therefore means N = 1, which is OFF. That reading is chosen over treating 1
 * as an on-switch because a parameter that takes a value cannot also have one
 * value meaning something else -- 1.5 giving 1.5 while 1 gives 2 is a trap. A
 * bare ?supersample with no value still means "on at the default".
 *
 * Cost scales with the SQUARE of N: composited layer area is N^2, so 2 is 4x
 * and 1.5 is 2.25x. 1.5 still buys a 50% linear gain -- enough to push blur
 * onset from around 250% out past 375% -- while being materially cheaper for
 * iOS to move around, which is what makes it worth dialling rather than fixing.
 *
 * Range is clamped to 1..2. Anything outside it, or unparseable, resolves to 1
 * rather than being honoured: at 3 the sheet is ~16M pixels, against iOS
 * Safari's canvas ceiling.
 *
 * Ships DARK -- touch devices only, and only when asked for.
 * ========================================================================= */
const SS_MIN = 1;
const SS_MAX = 2;
// Shipped default on touch devices. 1.25 was verified on an iPad: existing
// symbols unmoved, new placement landing correctly, PDF positions matching.
// It is the cheapest setting that helps -- area goes with the square of N, so
// 1.25 is 1.56x the composited layer against 4x at 2 -- which is what keeps
// iOS from dropping tiles while panning.
const SS_DEFAULT = 1.25;

function clampFactor(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < SS_MIN || n > SS_MAX) return 1;
  return n;
}

let lastReported = null;

function report(n) {
  if (n !== lastReported) {
    lastReported = n;
    console.info("Plotwire supersample: N =", n, n === 1 ? "(off)" : "(on)");
  }
  return n;
}

export function supersampleFactor() {
  if (typeof window === "undefined") return 1;
  // Desktop is untouched and always has been: it was fixed by removing the
  // permanent will-change, and never needed this. Returning before anything
  // else means N is 1 there, which makes every expression below it identical
  // to the code that predates supersampling.
  if (!isTouchDevice()) return 1;

  // The URL wins outright, INCLUDING ?supersample=1 meaning off. That is the
  // escape hatch: a device that behaves badly can be switched back without a
  // redeploy, which is why it has to beat the default rather than fall through
  // to it. A bare ?supersample with no value means the strongest setting.
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has("supersample")) {
      const raw = params.get("supersample");
      return report(raw === null || raw === "" ? SS_MAX : clampFactor(raw));
    }
  } catch { /* ignore */ }

  const env = process.env.NEXT_PUBLIC_SUPERSAMPLE;
  if (env === "true") return report(SS_MAX);
  if (env === "false" || env === "off") return report(1);
  if (env) return report(clampFactor(env));

  return report(SS_DEFAULT);
}
