"use client";

// Registers public/sw.js (the app shell cache) in production builds only: in
// development it would serve stale code while editing. The build id makes each
// deploy install a fresh worker (next.config.js sets NEXT_PUBLIC_BUILD_ID).
export function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (process.env.NODE_ENV !== "production") return;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
  if (window.location.protocol !== "https:" && !local) return;
  const build = encodeURIComponent(process.env.NEXT_PUBLIC_BUILD_ID || "dev");
  const go = () => navigator.serviceWorker.register(`/sw.js?build=${build}`, { scope: "/" }).catch((err) => {
    console.warn("service worker not registered:", err?.message || err);
  });
  // After the page has loaded, so it never competes with the first paint.
  if (document.readyState === "complete") go();
  else window.addEventListener("load", go, { once: true });
}
