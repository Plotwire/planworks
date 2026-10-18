"use client";

// Kill switch: deployed with NEXT_PUBLIC_SW_OFF=1, the app registers no
// worker and removes any this device has (see removeServiceWorker), and
// next.config.js serves public/sw-off.js in place of public/sw.js, so a
// device still on an older page gets switched off too.
const OFF = process.env.NEXT_PUBLIC_SW_OFF === "1";
// How often, at most, a page left open looks for a new worker.
const CHECK_EVERY_MS = 30 * 60 * 1000;

// Registers public/sw.js (the app shell cache) in production builds only: in
// development it would serve stale code while editing. The build id makes each
// deploy install a fresh worker (next.config.js sets NEXT_PUBLIC_BUILD_ID).
export function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (OFF) { removeServiceWorker(); return; }
  if (!workerExpected()) return;
  const build = encodeURIComponent(process.env.NEXT_PUBLIC_BUILD_ID || "dev");
  const go = () => navigator.serviceWorker.register(`/sw.js?build=${build}`, { scope: "/" })
    .then(keepChecking)
    .catch((err) => { console.warn("service worker not registered:", err?.message || err); });
  // After the page has loaded, so it never competes with the first paint.
  if (document.readyState === "complete") go();
  else window.addEventListener("load", go, { once: true });
}

// The kill switch, on the page: unregister this site's workers and delete
// their caches ("plotwire-..."). Never IndexedDB: saves waiting to upload
// are there, and the app goes on uploading them without a worker.
export async function removeServiceWorker() {
  try {
    for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
  } catch { /* none */ }
  try {
    if (typeof caches !== "undefined") {
      for (const name of await caches.keys()) if (name.startsWith("plotwire-")) await caches.delete(name);
    }
  } catch { /* none */ }
}

// Ask the worker (public/sw.js "keep-app") to keep any part of the app it
// doesn't have yet -- pages and every code file the editor, sketch tool, PDF
// and quote makers need -- and say how much is kept. fetch false: only count.
// Resolves to { kept, total, complete }, or null when there's no worker
// (development, the kill switch, a browser without one) or it didn't answer.
// A worker still installing (the first visit) counts as nothing kept yet.
const NOTHING_YET = { kept: 0, total: 0, complete: false };
export async function keepAppFiles({ fetch = true, timeoutMs = 180000 } = {}) {
  if (!workerExpected()) return null;
  try {
    const wait = fetch ? 60000 : 2000;
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), wait))]);
    const worker = reg && reg.active;
    if (!worker) return NOTHING_YET;
    return await new Promise((resolve) => {
      const channel = new MessageChannel();
      const t = setTimeout(() => resolve(null), timeoutMs);
      channel.port1.onmessage = (e) => { clearTimeout(t); resolve(e.data && typeof e.data.total === "number" ? e.data : NOTHING_YET); };
      worker.postMessage({ type: "keep-app", fetch }, [channel.port2]);
    });
  } catch {
    return NOTHING_YET;
  }
}

// Where registerServiceWorker registers one.
function workerExpected() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || OFF) return false;
  if (process.env.NODE_ENV !== "production") return false;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
  return window.location.protocol === "https:" || local;
}

// The browser only looks for a new worker when a page is opened, and a page
// left open for days (an iPad on site) isn't. Look when the app comes back
// into view, at most every CHECK_EVERY_MS: that's how a new deploy, or the
// kill switch (public/sw-off.js), reaches it.
function keepChecking(reg) {
  if (!reg) return;
  let last = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || Date.now() - last < CHECK_EVERY_MS) return;
    last = Date.now();
    reg.update().catch(() => {});
  });
}
