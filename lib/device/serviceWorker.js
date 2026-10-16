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
  if (process.env.NODE_ENV !== "production") return;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
  if (window.location.protocol !== "https:" && !local) return;
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
