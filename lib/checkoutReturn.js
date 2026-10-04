// ============================================================================
// Coming back from Stripe Checkout -- the rules, as plain functions (no React,
// no network) so they can be tested on their own. lib/useCheckoutReturn.js is
// the hook that uses them; components/PaymentStatus.jsx draws the screens.
//
// Stripe sends the browser back to /?checkout=success. That URL grants
// NOTHING: anyone can type it. Access only changes when the webhook has
// written the subscription row and the access rules (lib/access.js, mirrored
// in the database) say "full". Until then the app says so honestly:
//
//   confirming  "Confirming your payment…" in place of the app, polling with
//               backoff, plus realtime and focus refreshes (lib/useSubscription)
//               for up to CONFIRM_WINDOW_MS. The Try/Lapsed paywall is never
//               shown as if they hadn't paid. After CONTINUE_AFTER_MS they may
//               carry on into the app without waiting.
//   pending     after that window (or once they carry on): the app at its real
//               level with a non-blocking note that we're still confirming,
//               slower polling, for up to KEEP_CHECKING_MS from the return.
//               Subscribe still goes through the server guard, which sends
//               anyone Stripe has already charged to the billing portal, and
//               "Check again" asks the server to check with Stripe (see
//               SYNC_AT_MS).
//   confirmed   the account is full: done (a short "Payment confirmed" note).
//   expired     too old to be about this visit: dropped quietly.
//
// The return is remembered in sessionStorage (this tab only), so a reload
// keeps waiting rather than dropping a paying customer into Try. It is tied to
// the account that is signed in when it is first seen; another account
// signing in on this tab drops it. One older than KEEP_CHECKING_MS is dropped
// unread, signed in or not.
// ============================================================================

export const CONFIRM_WINDOW_MS = 3 * 60 * 1000;
export const CONTINUE_AFTER_MS = 20 * 1000;
export const KEEP_CHECKING_MS = 30 * 60 * 1000;
export const SLOW_POLL_MS = 30 * 1000;
export const STORAGE_KEY = "plotwire:checkoutReturn";

// The message once the confirming window is over (British English, shown in
// the app and on the Subscribe screen).
export const PAYMENT_PENDING_MESSAGE =
  "We’re still confirming your payment with Stripe. This can take a few minutes — you won’t be charged twice. Refresh in a minute.";

// Polling backoff during the confirming window: 1 s, 1.5 s, 2.3 s … capped at
// 10 s (about 25 checks in 3 minutes, on top of realtime).
export function pollDelay(attempt) {
  const n = Math.max(0, Number(attempt) || 0);
  return Math.min(10000, Math.round(1000 * Math.pow(1.5, n)));
}

// Polling only re-reads our own row, which the webhook writes. In case the
// webhook is late or lost, the server is also asked to check with Stripe
// itself (POST /api/billing/sync, which heals the row from Stripe): once
// SYNC_AT_MS[0] after the return (the webhook usually lands within seconds),
// once as the confirming window ends, and on every "Check again". After a
// reload, the points already passed count as one check.
export const SYNC_AT_MS = [15 * 1000, CONFIRM_WINDOW_MS];

// How many of those checks are due by this age (ms since the return).
export function syncsDue(age) {
  return SYNC_AT_MS.filter((ms) => age >= ms).length;
}

// Where a return stands. at: when they came back (ms). ready: the
// subscription has loaded. full: the access rules say full.
export function returnPhase({ at, now, ready = true, full = false, continued = false } = {}) {
  if (typeof at !== "number" || !Number.isFinite(at)) return "none";
  const age = now - at;
  if (age < -60 * 1000 || age > KEEP_CHECKING_MS) return "expired";
  if (ready && full) return "confirmed";
  if (age < CONFIRM_WINDOW_MS && !continued) return "confirming";
  return "pending";
}

// sessionStorage helpers. Every access is guarded: storage can be missing or
// throw (private windows, blocked site data), and then the return simply
// isn't remembered across a reload.
export function readReturn(storage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw);
    if (!r || typeof r.at !== "number" || !Number.isFinite(r.at)) return null;
    return {
      at: r.at,
      uid: typeof r.uid === "string" && r.uid ? r.uid : null,
      continued: r.continued === true,
    };
  } catch {
    return null;
  }
}

export function saveReturn(storage, rec) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify({ at: rec.at, uid: rec.uid || null, continued: rec.continued === true }));
  } catch { /* not remembered across a reload; fine */ }
}

export function clearReturn(storage) {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch { /* nothing to do */ }
}
