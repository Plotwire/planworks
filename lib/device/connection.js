"use client";

/* ============================================================================
 * lib/device/connection.js -- is there signal?
 * ----------------------------------------------------------------------------
 * The browser's own online/offline says so at once when Wi-Fi or Airplane
 * Mode changes, but a weak or captive signal can say "online" with nothing
 * getting through. So the last request to the server counts too: the outbox
 * (lib/device/outbox.js) and the editor's version check note each answer,
 * or each failure to get one (noteServer). While the server isn't
 * answering, it's asked again now and then (PROBE_MS), so the status shows
 * the signal coming back even when nothing is waiting to upload.
 *
 * hasSignal() and subscribeSignal() drive the traffic-light status in the
 * editor and on the dashboard (components/StatusMark.jsx).
 * ========================================================================== */

const PROBE_MS = 20000;

let reachable = true;   // the server answered the last request made to it
let wired = false;
let probeTimer = null;
const listeners = new Set();

const browserOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;
export const hasSignal = () => browserOnline() && reachable;

// A failed request that never got an answer (as lib/device/outbox decides).
export function looksLikeNoSignal(err) {
  if (!browserOnline()) return true;
  const msg = String(err?.message || err?.name || err || "");
  const status = Number(err?.status || err?.statusCode || 0);
  return /abort|failed to fetch|fetch failed|networkerror|network request failed|load failed|timed? ?out|the internet connection/i.test(msg)
    || [408, 502, 503, 504].includes(status);
}

function tell() {
  const now = hasSignal();
  for (const fn of listeners) { try { fn(now); } catch (e) { console.warn("signal listener:", e); } }
  probe();
}

// A request to the server got an answer (ok true), or no answer at all (ok
// false: no signal, timed out). A refusal is an answer: ok true.
export function noteServer(ok) {
  if (reachable === Boolean(ok)) return;
  reachable = Boolean(ok);
  tell();
}

// While the browser says online but the server isn't answering: ask this
// site now and then (any answer, even "not found", means signal is back).
// /api/ is never answered by the service worker (public/sw.js), so the
// request really goes out.
function probe() {
  clearTimeout(probeTimer);
  if (reachable || !browserOnline() || typeof window === "undefined") return;
  probeTimer = setTimeout(async () => {
    try {
      await fetch(`/api/ping?t=${Date.now()}`, { method: "HEAD", cache: "no-store", credentials: "same-origin" });
      noteServer(true);
    } catch {
      probe();
    }
  }, PROBE_MS);
}

function wire() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  // Signal back, as the browser sees it: assumed reachable again; the next
  // request (the outbox retries at once) says otherwise if it isn't.
  window.addEventListener("online", () => { reachable = true; tell(); });
  window.addEventListener("offline", tell);
}

export function subscribeSignal(fn) {
  wire();
  listeners.add(fn);
  return () => listeners.delete(fn);
}
