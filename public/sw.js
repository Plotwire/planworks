/* Plotwire service worker: the app opens on a weak signal, or none.
 *
 * Caches ONLY the app itself, from this site:
 *   - /_next/static/...  the app's code, styles and fonts. Their names change
 *                        whenever their contents do, so a kept copy is always
 *                        right: served from the cache, fetched once.
 *   - pages (/, /drawing, /new, ...) and their Next.js page data: fetched
 *                        from the network when it answers within a few
 *                        seconds, otherwise (or with no signal) served from
 *                        the cache. The pages are the same for everyone (each
 *                        is built once and has no account data in it).
 *   - other files of this site's (icons, logos): the cached copy at once,
 *                        refreshed in the background.
 * Never: any other site (Supabase: drawings, sign-in, plan images, so no
 * tokens and no account data are ever stored here), /api (billing), /auth
 * (sign-in links), /monitoring (Sentry), or anything that isn't a GET.
 *
 * Registered by components/AppShell.jsx as /sw.js?build=<id>; a new build
 * installs a new worker, which drops the old build's pages.
 */

const BUILD = new URL(self.location.href).searchParams.get("build") || "dev";
const STATIC_CACHE = "plotwire-static-v1";
const PAGES_CACHE = "plotwire-pages-" + BUILD;
const FILES_CACHE = "plotwire-files-v1";
const PAGES = ["/", "/drawing", "/new", "/sketch", "/planner", "/business", "/symbols"];
const NETWORK_WAIT_MS = 3000;
const MAX_STATIC = 400;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const pages = await caches.open(PAGES_CACHE);
    const statics = await caches.open(STATIC_CACHE);
    for (const path of PAGES) {
      try {
        const res = await fetch(path, { cache: "reload", credentials: "same-origin" });
        if (!res.ok) continue;
        await pages.put(path, res.clone());
        // The code each page names in its HTML, so it opens with no signal.
        const html = await res.text();
        const files = new Set((html.match(/\/_next\/static\/[^"'\s)]+/g) || []).map((u) => u.replace(/&amp;/g, "&")));
        await Promise.all([...files].map(async (u) => {
          if (await statics.match(u)) return;
          try { const r = await fetch(u); if (r.ok) await statics.put(u, r); } catch { /* next time */ }
        }));
      } catch { /* offline while installing: pages are cached as they're visited */ }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith("plotwire-pages-") && name !== PAGES_CACHE) await caches.delete(name);
    }
    trimStatic();
    await self.clients.claim();
  })());
});

async function trimStatic() {
  try {
    const cache = await caches.open(STATIC_CACHE);
    const keys = await cache.keys();
    // Oldest first (insertion order): an old build's files go before the new.
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_STATIC))) await cache.delete(k);
  } catch { /* not fatal */ }
}

const offline = () => self.navigator && self.navigator.onLine === false;

function skip(url, request) {
  if (request.method !== "GET") return true;
  if (url.origin !== self.location.origin) return true;
  const p = url.pathname;
  return p.startsWith("/api/") || p.startsWith("/auth/") || p.startsWith("/monitoring") || p === "/sw.js";
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (skip(url, request)) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, url.pathname));
    return;
  }
  if (request.headers.get("RSC") === "1") {
    // Prefetches are a nicety: leave them to the network.
    if (request.headers.get("Next-Router-Prefetch")) return;
    event.respondWith(networkFirst(request, url.pathname + "?__rsc", { fail: () => Response.error() }));
    return;
  }
  if (url.pathname.startsWith("/_next/")) return; // anything else Next.js serves: as normal
  event.respondWith(staleWhileRevalidate(request));
});

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request, { ignoreSearch: false });
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === "basic") cache.put(request, res.clone());
  return res;
}

// The page from the network if it answers within NETWORK_WAIT_MS (then kept
// for next time), otherwise the kept copy. The query string doesn't matter
// here: /drawing?id=... is the same page for every drawing.
async function networkFirst(request, key, { fail } = {}) {
  const cache = await caches.open(PAGES_CACHE);
  const kept = await cache.match(key);
  const fromNetwork = fetch(request).then((res) => {
    if (res.ok && res.type === "basic" && !res.redirected) cache.put(key, res.clone());
    return res;
  });
  if (kept && offline()) { fromNetwork.catch(() => {}); return kept; }
  if (!kept) {
    try { return await fromNetwork; } catch { return fail ? fail() : offlinePage(); }
  }
  let timer;
  const slow = new Promise((resolve) => { timer = setTimeout(() => resolve(null), NETWORK_WAIT_MS); });
  try {
    const res = await Promise.race([fromNetwork.catch(() => null), slow]);
    if (res && res.ok) return res;
    fromNetwork.catch(() => {});
    return kept;
  } finally {
    clearTimeout(timer);
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(FILES_CACHE);
  const kept = await cache.match(request);
  const fresh = fetch(request).then((res) => {
    if (res.ok && res.type === "basic") cache.put(request, res.clone());
    return res;
  });
  if (kept) { fresh.catch(() => {}); return kept; }
  return fresh;
}

function offlinePage() {
  return new Response(
    "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>" +
    "<title>Plotwire</title><body style='font:16px system-ui;padding:40px;color:#16222D'>" +
    "<h1 style='font-size:20px'>No signal</h1><p>Plotwire needs to be opened once with signal on this device before it can open without. Try again when you have signal.</p>",
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}
