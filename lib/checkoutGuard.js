// ============================================================================
// Checkout guard rules -- PURE helpers: no I/O, no env reads.
// One Plotwire subscription per person. lib/billing.js beginCheckout() does
// the Stripe and database calls; app/api/billing/checkout/route.js wraps it.
// Kept separate so every rule can be tested on its own.
// ============================================================================
import { asUserId, idOf, pickSubscription } from "@/lib/stripeWebhook";

// A subscription in one of these statuses is still running, or can still be
// paid and come back to life, so a second one must never be started next to
// it. The person is sent to the billing portal instead.
//   active, trialing  paid up (or trialling)
//   past_due          a renewal failed and Stripe is still retrying it
//   unpaid            Stripe stopped retrying, but the invoice stays open and
//                     can still be paid (the "leave as unpaid" setting)
//   paused            can be resumed
// Not blocking:
//   incomplete        a first payment that never went through. It can't
//                     charge anyone unless they go back and finish that exact
//                     payment, and Stripe expires it (uncharged) within 23 h.
//                     Blocking it would strand someone whose card was declined
//                     on a portal with nothing in it.
//   incomplete_expired, canceled   over.
export const BLOCKING_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "paused"]);

// The account a Stripe object names in its metadata (user_id), or null.
export function ownerOf(obj) {
  return asUserId(obj?.metadata?.user_id);
}

// The account a Checkout Session was made for: our checkout sets both
// client_reference_id and metadata.user_id.
export function sessionOwner(session) {
  return asUserId(session?.client_reference_id) || ownerOf(session);
}

// What Stripe has for this person, from the lookups lib/billing.js makes:
//   stored   { customer, subscriptions }   the customer on the person's own
//            subscriptions row (customer null if Stripe doesn't have it)
//   others   [{ customer, subscriptions }] other customers with their email
//   searched subscriptions found by metadata user_id, on any customer
//            (customer expanded where Stripe gave it)
//
// A customer is the person's when it's on their row, or it names them
// (metadata.user_id), or one of its subscriptions does. A customer that names
// a DIFFERENT account is never theirs: an email address can change hands, and
// a billing portal must never open on somebody else's customer. On a customer
// that is theirs, a subscription with no user_id (made in the dashboard)
// counts as theirs; one naming another account never does.
//
// Returns:
//   subscriptions  every subscription of theirs Stripe knows about
//   blocking       the best one that is still running (BLOCKING_STATUSES), or
//                  null -- the one to send them to the portal for
//   customerId     the customer to use: blocking's, else the one to reuse for
//                  a new checkout (row first, then email matches, newest
//                  first, then search results), else null (make one)
export function billingPicture({ userId, stored = null, others = [], searched = [], storedSubscriptionId = null } = {}) {
  const uid = asUserId(userId);
  const owned = new Map();
  const customers = [];
  if (!uid) return { subscriptions: [], blocking: null, customerId: null };

  const consider = (customer, subs, onRow) => {
    if (!customer || customer.deleted) return;
    const named = ownerOf(customer);
    if (named && named !== uid) return;
    const list = (subs || []).filter(Boolean);
    const proven = onRow || named === uid || list.some((s) => ownerOf(s) === uid);
    if (!proven) return;
    for (const s of list) {
      const o = ownerOf(s);
      if ((!o || o === uid) && !owned.has(s.id)) owned.set(s.id, s);
    }
    if (!customers.some((c) => c.id === customer.id)) customers.push(customer);
  };
  consider(stored?.customer, stored?.subscriptions, true);
  for (const o of others || []) consider(o?.customer, o?.subscriptions, false);

  const searchedCustomers = [];
  for (const s of searched || []) {
    if (!s?.id || ownerOf(s) !== uid) continue;
    const c = s.customer && typeof s.customer === "object" ? s.customer : null;
    if (c && (c.deleted || (ownerOf(c) && ownerOf(c) !== uid))) continue;
    if (!owned.has(s.id)) owned.set(s.id, s);
    const cid = idOf(s.customer);
    if (cid && !searchedCustomers.includes(cid)) searchedCustomers.push(cid);
  }

  const subscriptions = [...owned.values()];
  const blocking = pickSubscription(
    subscriptions.filter((s) => BLOCKING_STATUSES.has(s.status)),
    { storedId: storedSubscriptionId }
  );
  const customerId = blocking
    ? idOf(blocking.customer)
    : customers[0]?.id || searchedCustomers[0] || null;
  return { subscriptions, blocking, customerId };
}

// ---------------------------------------------------------------------------
// Checkout Sessions: one payable at a time
// ---------------------------------------------------------------------------

// Double-clicks, two tabs and retries inside the same 10 minutes get the SAME
// Checkout Session back from Stripe (idempotency key per person per window).
export const CHECKOUT_WINDOW_SECONDS = 600;

export function checkoutWindow(nowSec) {
  return Math.floor(nowSec / CHECKOUT_WINDOW_SECONDS);
}

// When a new Checkout Session stops being payable: 35-45 minutes after it is
// made. Stripe accepts 30 minutes to 24 hours (default 24 h, which leaves an
// abandoned checkout payable all day). Fixed per window, so a repeat inside
// the window sends identical parameters and gets the same session back.
export function sessionExpiresAt(nowSec) {
  return (checkoutWindow(nowSec) + 1) * CHECKOUT_WINDOW_SECONDS + 35 * 60;
}

// The idempotency key for checkout.sessions.create: the person, the 10-minute
// window and a digest of the exact parameters. The digest matters: Stripe
// refuses a key reused with DIFFERENT parameters (e.g. a customer found since,
// or another allowed return address), and that must not turn into an error.
export function checkoutIdempotencyKey({ userId, nowSec, digest }) {
  return `plotwire-checkout-${userId}-${checkoutWindow(nowSec)}-${digest}`;
}

// JSON with sorted keys, so the same parameters always give the same digest.
export function stableStringify(value) {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

// A session sent to someone needs at least this long left to be paid.
export const SESSION_MIN_REMAINING_SECONDS = 5 * 60;

// An open subscription Checkout Session made for this person.
export function isOpenSessionOf(s, userId) {
  const uid = asUserId(userId);
  return Boolean(s && uid && s.status === "open" && s.mode === "subscription" && sessionOwner(s) === uid);
}

// An open session of theirs that is fine to send them to: it has a payment
// page, returns to this site and has time left.
export function sessionUsable(s, { userId, origin, nowSec } = {}) {
  return (
    isOpenSessionOf(s, userId) &&
    typeof s.url === "string" &&
    Boolean(s.url) &&
    typeof origin === "string" &&
    String(s.success_url || "").startsWith(`${origin}/`) &&
    (s.expires_at || 0) - nowSec >= SESSION_MIN_REMAINING_SECONDS
  );
}

// From OPEN Checkout Sessions (any customer; other people's are ignored): the
// one to send this person to (the newest of theirs that is usable), and every
// other open one of theirs, to expire -- so only one checkout can ever be
// paid at a time. Two requests racing each other both pick the same winner
// (newest, then highest id), so they can't expire each other's.
export function chooseOpenSession(sessions, { userId, origin, nowSec } = {}) {
  const seen = new Set();
  const mine = (sessions || []).filter((s) => {
    if (!isOpenSessionOf(s, userId) || seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
  const usable = mine.filter((s) => sessionUsable(s, { userId, origin, nowSec }));
  usable.sort((a, b) => (b.created || 0) - (a.created || 0) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const winner = usable[0] || null;
  return { winner, others: mine.filter((s) => s.id !== winner?.id) };
}

// The sessions to expire once the winner is settled: every other open one of
// theirs, each once, never the winner itself. (The winner can be chosen after
// the list was read -- the replay check in lib/billing.js -- so it may be in
// the list.)
export function sessionsToExpire(others, winner) {
  const seen = new Set();
  return (others || []).filter((s) => {
    if (!s?.id || s.id === winner?.id || seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
}

// ---------------------------------------------------------------------------
// A brake on Subscribe clicks (app/api/billing/checkout/route.js)
// ---------------------------------------------------------------------------
// Every checkout POST asks Stripe several things (including subscriptions
// search, which Stripe rate-limits far more tightly than other calls and the
// webhook also uses). A person, or a page stuck in a loop, gets at most this
// many checkout starts per window; beyond that the route answers 429 without
// calling Stripe. Generous for a human: every start sends the browser away.
export const CHECKOUT_RATE_LIMIT = 10;
export const CHECKOUT_RATE_WINDOW_MS = 60 * 1000;

// stamps: this person's recent starts (ms). Returns { ok, stamps } -- the
// stamps to keep (the new one added when ok) -- and retryAfterSec when not.
// A stamp from the "future" (the clock moved back) is dropped.
export function rateCheck(stamps, nowMs, { limit = CHECKOUT_RATE_LIMIT, windowMs = CHECKOUT_RATE_WINDOW_MS } = {}) {
  const recent = (stamps || []).filter((t) => {
    const age = nowMs - t;
    return Number.isFinite(age) && age >= 0 && age < windowMs;
  });
  if (recent.length >= limit) {
    const oldest = Math.min(...recent);
    return { ok: false, stamps: recent, retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - nowMs) / 1000)) };
  }
  return { ok: true, stamps: [...recent, nowMs] };
}
