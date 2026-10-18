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
 * fetched (their names change with their contents). The page asks again now
 * and then ("keep-app" message, lib/device/serviceWorker.js keepAppFiles):
 * any file still missing is fetched, and it hears how many are kept, so the
 * dashboard only says "ready" when the app itself is too.
 *
 * On Vercel each code file's address carries "?dpl=<deployment>" (Skew
 * Protection: it routes the request to the deployment that built the page).
 * The files are named by their contents, so they are kept and found by path
 * alone (keyOf): the query never stops a kept file being found. It is still
 * sent when fetching, so Vercel serves the right deployment's file.
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

// A kept copy only counts if it's a good one (never anything but, as kept
// here, but a damaged entry is fetched again rather than served).
async function good(match) {
  const res = await match;
  return res && res.ok ? res : null;
}

// What a file of this site's is kept under: its path alone (see the top).
// Other sites' files (LIBS) keep their full address.
function keyOf(u) {
  const url = new URL(u, self.location.origin);
  return url.origin === self.location.origin ? url.origin + url.pathname : url.href;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    await keepApp();
    await self.skipWaiting();
  })());
});

// The pages, and every code file the build needs, kept; the list of those
// files kept too (BUILD_FILES, the addresses to fetch them by). Resolves to
// { kept, total } (pages and files). fetchMissing false: only counts.
async function keepApp({ fetchMissing = true } = {}) {
  const pages = await caches.open(PAGES_CACHE);
  const statics = await caches.open(STATIC_CACHE);
  let list = null; // { files, complete }
  try { const listed = await pages.match(BUILD_FILES); if (listed) list = await listed.json(); } catch { /* none */ }
  if (list && Array.isArray(list)) list = { files: list, complete: false }; // an earlier version's list
  if (fetchMissing) {
    const fresh = !list || !list.complete;
    const found = new Set(list ? list.files : []);
    for (const path of PAGES) {
      // With a complete list, only the pages not kept yet.
      if (!fresh && (await pages.match(path))) continue;
      try {
        const res = await fetch(path, { cache: "reload", credentials: "same-origin" });
        if (!res.ok) continue;
        await pages.put(path, res.clone());
        // The code each page names in its HTML, so it opens with no signal.
        const html = await res.text();
        for (const u of html.match(/\/_next\/static\/[^"'\s)]+/g) || []) found.add(u.replace(/&amp;/g, "&"));
      } catch { /* no signal: pages are kept as they're visited */ }
    }
    let complete = Boolean(list && list.complete);
    if (fresh) {
      const all = await allCodeFiles(found);
      if (all) { all.forEach((u) => found.add(u)); complete = true; }
    }
    if (found.size) {
      const files = [...found];
      await keepAll(statics, files);
      list = { files, complete };
      try { await pages.put(BUILD_FILES, new Response(JSON.stringify(list))); } catch { /* not fatal */ }
    }
  }
  const files = list ? list.files : [];
  let kept = 0;
  for (const path of PAGES) if (await pages.match(path)) kept++;
  for (const u of files) if (await good(statics.match(keyOf(u)))) kept++;
  return { kept, total: PAGES.length + files.length, complete: Boolean(list && list.complete) };
}

// Every code file the build's webpack runtime can load: those it names
// outright, and those it names by chunk id and content hash, at the
// deployment's own address ("?dpl=...", as the pages name their files).
// null when the runtime couldn't be read (no signal): keepApp tries again
// next time. A runtime this doesn't understand gives only the outright ones
// (the pages' own files and lib/device/warmUp.js still cover the common ones).
async function allCodeFiles(pageFiles) {
  const runtime = [...pageFiles].find((u) => /^\/_next\/static\/chunks\/webpack-[^/?]+\.js(\?|$)/.test(u));
  if (!runtime) return null;
  const query = new URL(runtime, self.location.origin).search;
  let code = "";
  try { const r = await fetch(runtime); if (!r.ok) return null; code = await r.text(); } catch { return null; }
  const out = new Set();
  for (const m of code.matchAll(/"(static\/(?:chunks|css)\/[^"]+\.(?:js|css))"/g)) out.add("/_next/" + m[1] + query);
  const byHash = /"static\/chunks\/"\+\(\(\{([^}]*)\}\)\[\w+\]\|\|\w+\)\+"\."\+\(\{([^}]*)\}\)\[\w+\]\+"\.js"/.exec(code);
  if (byHash) {
    const names = {};
    for (const [, id, name] of byHash[1].matchAll(/(\d+):"([^"]+)"/g)) names[id] = name;
    for (const [, id, hash] of byHash[2].matchAll(/(\d+):"([^"]+)"/g)) out.add(`/_next/static/chunks/${names[id] || id}.${hash}.js${query}`);
  }
  return [...out];
}

// Fetch and keep each file not kept yet, a few at a time, and the fonts and
// images each style sheet names. A file that can't be fetched now is fetched
// next time (keepApp) or when it's first used.
async function keepAll(cache, urls) {
  const queue = [...urls];
  const seen = new Set(queue.map(keyOf));
  const worker = async () => {
    while (queue.length) {
      const u = queue.shift();
      try {
        const key = keyOf(u);
        let res = await good(cache.match(key));
        if (!res) {
          const r = await fetch(u);
          if (!r.ok) continue;
          await cache.put(key, r.clone());
          res = r;
        }
        if (/\.css$/.test(new URL(key).pathname)) {
          const query = new URL(u, self.location.origin).search;
          for (const [, m] of (await res.text()).matchAll(/url\((\/_next\/static\/media\/[^)"']+)\)/g)) {
            if (!seen.has(keyOf(m))) { seen.add(keyOf(m)); queue.push(m + query); urls.push(m + query); }
          }
        }
      } catch { /* next time */ }
    }
  };
  await Promise.all(Array.from({ length: FETCH_AT_ONCE }, worker));
}

// The page asks: keep anything still missing (when there's signal), and say
// how much of the app is kept (lib/device/serviceWorker.js keepAppFiles).
self.addEventListener("message", (event) => {
  const data = event.data || {};
  const port = event.ports && event.ports[0];
  if (data.type !== "keep-app" || !port) return;
  event.waitUntil((async () => {
    let result = { kept: 0, total: 0, listed: false };
    try { result = await keepApp({ fetchMissing: data.fetch !== false && !offline() }); } catch { /* counts as nothing kept */ }
    port.postMessage(result);
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

// The current build's code files and pdf.js are always kept; of the rest
// (older builds', for a page still open from one), the newest EXTRA_STATIC.
async function trimStatic() {
  try {
    const cache = await caches.open(STATIC_CACHE);
    const keys = await cache.keys();
    let current = null;
    try {
      const listed = await (await caches.open(PAGES_CACHE)).match(BUILD_FILES);
      if (listed) {
        const list = await listed.json();
        current = new Set((Array.isArray(list) ? list : list.files || []).map(keyOf));
      }
    } catch { /* no list: by age alone */ }
    if (!current) {
      for (const k of keys.slice(0, Math.max(0, keys.length - MAX_STATIC))) await cache.delete(k);
      return;
    }
    // Copies kept under a full address by an earlier version count as others.
    const others = keys.filter((k) => new URL(k.url).origin === self.location.origin && !current.has(k.url));
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

// Kept by path (keyOf), so "?dpl=..." never hides a kept file; a copy kept
// under its full address by an earlier version is found too. Not kept and
// no signal: a plain network error (the page shows "needs signal once",
// components/NeedsSignal.jsx), never an unhandled rejection here.
async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const key = keyOf(request.url);
  const hit = (await good(cache.match(key))) || (await good(cache.match(request, { ignoreSearch: true })));
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res.ok && (res.type === "basic" || res.type === "cors")) cache.put(key, res.clone());
    return res;
  } catch {
    return Response.error();
  }
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
