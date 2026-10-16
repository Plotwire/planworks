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
 *   - pdf.js, the one other site's file the app needs (PDF plans and PDF
 *                        import): that exact version only (LIBS), kept once
 *                        fetched; the page checks its integrity hash.
 * Never: any other site (Supabase: drawings, sign-in, plan images, so no
 * tokens and no account data are ever stored here), /api (billing), /auth
 * (sign-in links), /monitoring (Sentry), or anything that isn't a GET.
 *
 * Installing keeps every code file of the build, not only each page's own:
 * the editor, the sketch tool and the PDF makers are loaded later by the
 * page, through files the build's webpack runtime names (allCodeFiles), and a
 * day without signal needs all of them. Only files not kept already are
 * fetched (their names change with their contents).
 *
 * Registered by components/AppShell.jsx as /sw.js?build=<id>; a new build
 * installs a new worker, which drops the old build's pages.
 *
 * Kill switch: deployed with NEXT_PUBLIC_SW_OFF=1, public/sw-off.js is served
 * in place of this file and removes the worker and its caches from every
 * device, keeping saves that are waiting to upload (next.config.js).
 */

const BUILD = new URL(self.location.href).searchParams.get("build") || "dev";
const STATIC_CACHE = "plotwire-static-v1";
const PAGES_CACHE = "plotwire-pages-" + BUILD;
const FILES_CACHE = "plotwire-files-v1";
const PAGES = ["/", "/drawing", "/new", "/sketch", "/planner", "/business", "/symbols"];
const NETWORK_WAIT_MS = 3000;
const MAX_STATIC = 400;
const EXTRA_STATIC = 150;      // older builds' files kept beside the current build's
const FETCH_AT_ONCE = 4;
const BUILD_FILES = "/__build-files"; // the current build's code files (pages cache)
// Other sites' files kept like the app's own code: exact versions only, so a
// kept copy is always right (lib/pdfjs.js checks each against its hash).
const LIBS = ["https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const pages = await caches.open(PAGES_CACHE);
    const statics = await caches.open(STATIC_CACHE);
    const files = new Set();
    for (const path of PAGES) {
      try {
        const res = await fetch(path, { cache: "reload", credentials: "same-origin" });
        if (!res.ok) continue;
        await pages.put(path, res.clone());
        // The code each page names in its HTML, so it opens with no signal.
        const html = await res.text();
        for (const u of html.match(/\/_next\/static\/[^"'\s)]+/g) || []) files.add(u.replace(/&amp;/g, "&"));
      } catch { /* offline while installing: pages are cached as they're visited */ }
    }
    for (const u of await allCodeFiles(files)) files.add(u);
    await keepAll(statics, [...files]);
    try { await pages.put(BUILD_FILES, new Response(JSON.stringify([...files]))); } catch { /* not fatal */ }
    await self.skipWaiting();
  })());
});

// Every code file the build's webpack runtime can load: those it names
// outright, and those it names by chunk id and content hash. A runtime this
// doesn't understand gives only the outright ones (the pages' own files and
// lib/device/warmUp.js still cover the common ones).
async function allCodeFiles(pageFiles) {
  const runtime = [...pageFiles].find((u) => /^\/_next\/static\/chunks\/webpack-[^/]+\.js$/.test(u));
  if (!runtime) return [];
  let code = "";
  try { const r = await fetch(runtime); if (!r.ok) return []; code = await r.text(); } catch { return []; }
  const out = new Set();
  for (const m of code.matchAll(/"(static\/(?:chunks|css)\/[^"]+\.(?:js|css))"/g)) out.add("/_next/" + m[1]);
  const byHash = /"static\/chunks\/"\+\(\(\{([^}]*)\}\)\[\w+\]\|\|\w+\)\+"\."\+\(\{([^}]*)\}\)\[\w+\]\+"\.js"/.exec(code);
  if (byHash) {
    const names = {};
    for (const [, id, name] of byHash[1].matchAll(/(\d+):"([^"]+)"/g)) names[id] = name;
    for (const [, id, hash] of byHash[2].matchAll(/(\d+):"([^"]+)"/g)) out.add(`/_next/static/chunks/${names[id] || id}.${hash}.js`);
  }
  return [...out];
}

// Fetch and keep each file not kept yet, a few at a time. A file that can't
// be fetched now is fetched when it's first used.
async function keepAll(cache, urls) {
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const u = urls[next++];
      try {
        if (await cache.match(u)) continue;
        const r = await fetch(u);
        if (r.ok) await cache.put(u, r);
      } catch { /* next time */ }
    }
  };
  await Promise.all(Array.from({ length: FETCH_AT_ONCE }, worker));
}

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith("plotwire-pages-") && name !== PAGES_CACHE) await caches.delete(name);
    }
    trimStatic();
    await self.clients.claim();
  })());
});

// The current build's code files and pdf.js are always kept; of the rest
// (older builds', for a page still open from one), the newest EXTRA_STATIC.
async function trimStatic() {
  try {
    const cache = await caches.open(STATIC_CACHE);
    const keys = await cache.keys();
    let current = null;
    try {
      const listed = await (await caches.open(PAGES_CACHE)).match(BUILD_FILES);
      if (listed) current = new Set(await listed.json());
    } catch { /* no list: by age alone */ }
    if (!current) {
      for (const k of keys.slice(0, Math.max(0, keys.length - MAX_STATIC))) await cache.delete(k);
      return;
    }
    const others = keys.filter((k) => {
      const u = new URL(k.url);
      return u.origin === self.location.origin && !current.has(u.pathname + u.search);
    });
    // Oldest first (insertion order).
    for (const k of others.slice(0, Math.max(0, others.length - EXTRA_STATIC))) await cache.delete(k);
  } catch { /* not fatal */ }
}

const offline = () => self.navigator && self.navigator.onLine === false;

function skip(url, request) {
  if (request.method !== "GET") return true;
  if (url.origin !== self.location.origin) return !LIBS.some((prefix) => url.href.startsWith(prefix));
  const p = url.pathname;
  return p.startsWith("/api/") || p.startsWith("/auth/") || p.startsWith("/monitoring") || p === "/sw.js";
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (skip(url, request)) return;

  if (url.pathname.startsWith("/_next/static/") || url.origin !== self.location.origin) {
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
  if (res.ok && (res.type === "basic" || res.type === "cors")) cache.put(request, res.clone());
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
