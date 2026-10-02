// ============================================================================
// Stripe webhook rules -- PURE helpers: no imports, no I/O, no env reads.
// They decide what the webhook does; lib/billing.js does the Stripe and
// database calls and app/api/billing/webhook/route.js wires them together.
// Kept separate so every rule can be tested on its own.
// ============================================================================

// The events the webhook acts on. Subscribe the Stripe endpoint to exactly
// these. Anything else is acknowledged (200) and ignored.
export const HANDLED_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);

// Statuses that count as a live, paid-up (or trialling) subscription: the
// checkout's "already subscribed" check and the guard that stops anything
// else replacing a row it can't verify.
export const LIVE_STATUSES = new Set(["active", "trialing"]);

// The renewal failed and Stripe hasn't been paid: the row records when.
export const FAILED_PAYMENT_STATUSES = new Set(["past_due", "unpaid"]);

// ---------------------------------------------------------------------------
// Which mode of event this deployment acts on
// ---------------------------------------------------------------------------

// "live" for sk_live_/rk_live_ keys, "test" for sk_test_/rk_test_, else null.
export function stripeKeyMode(key) {
  if (typeof key !== "string") return null;
  if (/^(sk|rk)_live_/.test(key)) return "live";
  if (/^(sk|rk)_test_/.test(key)) return "test";
  return null;
}

// Production = VERCEL_ENV "production" OR a live key. Production acts only on
// live-mode events. Every deployment ignores events whose mode doesn't match
// its key (a test event can't be fetched with a live key, and vice versa).
// So: production on a live key -> live events; a preview on a test key -> test
// events; production on a test key (a misconfiguration) -> nothing.
// Ignored TEST events are acknowledged (200) so Stripe doesn't retry them.
// A LIVE event reaching a deployment with a test key is different: it passed
// the signature check, so a live webhook secret is set next to a test key (the
// classic go-live slip). misconfigured: true -> the route answers 500, so
// Stripe keeps the real payment events, shows the endpoint failing, and
// retries them (for up to 3 days) until the key is fixed.
export function webhookModeDecision({ eventLivemode, secretKey, vercelEnv } = {}) {
  const keyMode = stripeKeyMode(secretKey);
  if (!keyMode) return { process: false, misconfigured: true, reason: "no-usable-stripe-key", production: vercelEnv === "production", keyMode };
  const production = vercelEnv === "production" || keyMode === "live";
  const eventMode = eventLivemode === true ? "live" : "test";
  if (production && eventMode !== "live") {
    return { process: false, misconfigured: false, reason: "test-mode-event-on-production", production, keyMode };
  }
  if (eventMode !== keyMode) {
    return {
      process: false,
      misconfigured: eventMode === "live",
      reason: `${eventMode}-mode-event-with-${keyMode}-key`,
      production,
      keyMode,
    };
  }
  return { process: true, misconfigured: false, reason: null, production, keyMode };
}

// ---------------------------------------------------------------------------
// What an event points at
// ---------------------------------------------------------------------------

// An expandable Stripe field: "id" or { id, ... }.
export function idOf(x) {
  if (typeof x === "string") return x || null;
  if (x && typeof x === "object" && typeof x.id === "string") return x.id || null;
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A Supabase user id, or null for anything that isn't one (metadata and
// client_reference_id are free text as far as Stripe is concerned).
export function asUserId(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return UUID.test(s) ? s.toLowerCase() : null;
}

// The subscription an invoice belongs to. API 2025-03-31 and later (including
// the 2026-05-27.dahlia version this SDK pins) put it on
// invoice.parent.subscription_details; older versions on invoice.subscription.
// Null for a one-off invoice.
export function invoiceSubscriptionId(invoice) {
  return idOf(invoice?.parent?.subscription_details?.subscription) || idOf(invoice?.subscription) || null;
}

// The object a handled event is about: { kind, id, subscriptionId? }.
// Only ids are taken from the payload; the webhook re-fetches everything else.
export function eventTarget(event) {
  const obj = event?.data?.object || {};
  switch (event?.type) {
    case "checkout.session.completed":
      return { kind: "checkout_session", id: obj.id || null };
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return { kind: "subscription", id: obj.id || null };
    case "invoice.paid":
    case "invoice.payment_failed":
      return { kind: "invoice", id: obj.id || null, subscriptionId: invoiceSubscriptionId(obj) };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Which of a person's subscriptions the row tracks
// ---------------------------------------------------------------------------

// Best first. A subscription that ended (canceled) outranks a checkout that
// never completed (incomplete), so a former customer who abandons a new
// checkout stays Lapsed rather than dropping back to Try.
const STATUS_RANK = {
  active: 0,
  trialing: 1,
  past_due: 2,
  unpaid: 3,
  paused: 4,
  canceled: 5,
  incomplete: 6,
  incomplete_expired: 7,
};

export function statusRank(status) {
  return Object.prototype.hasOwnProperty.call(STATUS_RANK, status) ? STATUS_RANK[status] : 8;
}

// About to record a subscription that isn't paid up (past_due, unpaid, ended
// or never started)? Then look for another one this person has (a duplicate,
// possibly on a different Stripe customer) that might be, before writing it.
// past_due is included: a failed renewal on one subscription must not start
// the 7-day clock while a duplicate is paid up.
export function needsDuplicateLookup(status) {
  return !LIVE_STATUSES.has(status);
}

// From freshly fetched subscriptions, the one the row should track: best
// status; on a tie the one already stored (so duplicates don't make the row
// flip back and forth), then the newest.
export function pickSubscription(subs, { storedId = null } = {}) {
  const byId = new Map();
  for (const s of subs || []) if (s && s.id && !byId.has(s.id)) byId.set(s.id, s);
  const list = [...byId.values()];
  list.sort(
    (a, b) =>
      statusRank(a.status) - statusRank(b.status) ||
      Number(b.id === storedId) - Number(a.id === storedId) ||
      (b.created || 0) - (a.created || 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
  return list[0] || null;
}

// May the row (stored) be pointed at `next`?
//   * same subscription, or no row yet: yes;
//   * a test-mode subscription never replaces a live-mode row (previews and
//     production share one database, and the preview processes test events);
//   * storedVerified: the caller fetched the stored subscription from Stripe
//     and pickSubscription() preferred `next`, so yes;
//   * otherwise (the stored one couldn't be checked): only a live one
//     (active/trialing) may replace it -- a cancelled or stale subscription
//     can never overwrite an active one.
export function replaceDecision({ stored, next, storedVerified = false } = {}) {
  const storedId = stored?.stripe_subscription_id || null;
  if (!storedId || storedId === next?.id) return { ok: true, reason: null };
  if (stored.livemode === true && next?.livemode !== true) {
    return { ok: false, reason: "a test-mode subscription never replaces a live-mode row" };
  }
  if (storedVerified) return { ok: true, reason: null };
  if (LIVE_STATUSES.has(next?.status)) return { ok: true, reason: null };
  return { ok: false, reason: "kept the stored subscription; ignored a different one that isn't live" };
}

// ---------------------------------------------------------------------------
// The failed-payment clock (subscriptions.payment_failed_at)
// ---------------------------------------------------------------------------

// Unix seconds from a Postgres/ISO timestamp, a Date or a number of seconds.
export function toUnix(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.floor(v) : null;
  const ms = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

export function isoFromUnix(sec) {
  return typeof sec === "number" && Number.isFinite(sec) ? new Date(sec * 1000).toISOString() : null;
}

// The last time Stripe was paid for the subscription: the latest
// status_transitions.paid_at among its PAID invoices. Unix seconds or null.
export function lastPaidAt(invoices) {
  let best = null;
  for (const inv of invoices || []) {
    if (!inv || inv.status !== "paid") continue;
    const t = inv.status_transitions?.paid_at ?? null;
    if (typeof t === "number" && (best === null || t > best)) best = t;
  }
  return best;
}

// When the unpaid invoice behind a past_due/unpaid spell first failed, from
// the subscription's OPEN invoices as Stripe has them now. Stripe charges an
// automatically collected invoice the moment it finalizes it, so the first
// failed attempt is at status_transitions.finalized_at. The OLDEST open
// invoice that has been attempted wins, so retries, card updates, replayed
// events and later invoices never move the clock. Unix seconds or null.
// after (unix seconds, from lastPaidAt): open invoices finalized before the
// last payment are left over from an EARLIER spell (failed-payment settings
// that leave an invoice open) and don't start this one -- Stripe sets the
// status from the latest invoice, so the person was paid up in between.
export function firstFailedAt(invoices, { after = null } = {}) {
  let best = null;
  for (const inv of invoices || []) {
    if (!inv || inv.status !== "open") continue;
    if (!(inv.attempt_count > 0 || inv.attempted === true)) continue;
    const t = inv.status_transitions?.finalized_at ?? inv.effective_at ?? inv.created ?? null;
    if (typeof t !== "number") continue;
    if (typeof after === "number" && t < after) continue;
    if (best === null || t < best) best = t;
  }
  return best;
}

// The row's payment_failed_at (unix seconds or null). Set only while the
// subscription is past_due or unpaid; null for every other status, so it
// clears as soon as Stripe is paid (active) or the subscription ends.
// Source, in order: Stripe's open invoices (above); else the value already
// stored for this same subscription's failed spell; else the event's time;
// else now.
// Never later than now: a Stripe TEST clock runs ahead of real time and stamps
// its invoices in clock time, and a future value would stretch the 7-day grace
// in the shared database. An invoice time in the future is therefore not
// used: the value kept for this spell is (it was set when the failure was
// first seen), or else now -- so later events and retries still don't move it.
export function resolvePaymentFailedAt({ status, subscriptionId, fromInvoices, stored, eventCreated, now } = {}) {
  if (!FAILED_PAYMENT_STATUSES.has(status)) return null;
  const n = typeof now === "number" ? now : Math.floor(Date.now() / 1000);
  if (typeof fromInvoices === "number" && fromInvoices <= n) return fromInvoices;
  const sameSpell =
    stored &&
    stored.stripe_subscription_id === subscriptionId &&
    FAILED_PAYMENT_STATUSES.has(stored.status);
  const kept = sameSpell ? toUnix(stored.payment_failed_at) : null;
  if (kept !== null) return Math.min(kept, n);
  if (typeof fromInvoices === "number") return n;
  if (typeof eventCreated === "number") return Math.min(eventCreated, n);
  return n;
}

// ---------------------------------------------------------------------------
// Rows from the other Stripe mode (previews and production share one database)
// ---------------------------------------------------------------------------

// May a deployment whose Stripe key is in keyMode ("live" | "test") act on
// this subscriptions row (reuse its customer, treat it as "already
// subscribed")? A live key: only livemode=true rows -- a test row written by a
// preview must never stop a real customer paying, and its test customer id
// doesn't exist in live mode. A test key: anything but a live row (rows
// written before the livemode column existed are null, and are test rows).
// No key mode (unknown): the row is used as before.
export function rowMatchesKeyMode(row, keyMode) {
  if (!row) return false;
  if (keyMode === "live") return row.livemode === true;
  if (keyMode === "test") return row.livemode !== true;
  return true;
}

// ---------------------------------------------------------------------------
// The subscriptions row
// ---------------------------------------------------------------------------

// Our row (minus user_id and updated_at) from a Stripe Subscription object.
// `plan` is the friendly name for the price (lib/billing.js planForPrice).
export function subscriptionRow(sub, { customerId = null, plan = null, paymentFailedAt = null } = {}) {
  const item = sub?.items?.data?.[0];
  const priceId = item?.price?.id || null;
  // Current Stripe API versions put the billing period on the subscription
  // item; older ones had it on the subscription itself.
  const periodEnd = item?.current_period_end ?? sub?.current_period_end ?? null;
  // A scheduled cancellation. Newer Stripe API versions (the portal on
  // 2026-05-27.dahlia) set cancel_at to the end date and can leave
  // cancel_at_period_end false, so either one means "cancelling". Undoing it
  // in the portal ("Don't cancel subscription") clears both, so it clears here.
  const cancelAt = sub?.cancel_at ?? (sub?.cancel_at_period_end ? periodEnd : null);
  const failed = FAILED_PAYMENT_STATUSES.has(sub?.status);
  return {
    stripe_customer_id: customerId || idOf(sub?.customer) || null,
    stripe_subscription_id: sub?.id || null,
    status: sub?.status || null,
    plan: plan || null,
    price_id: priceId,
    current_period_end: isoFromUnix(periodEnd),
    cancel_at_period_end: Boolean(cancelAt),
    cancel_at: isoFromUnix(cancelAt),
    trial_end: isoFromUnix(sub?.trial_end ?? null),
    payment_failed_at: failed ? isoFromUnix(paymentFailedAt) : null,
    livemode: sub?.livemode === true,
  };
}

const ROW_FIELDS = [
  "stripe_customer_id",
  "stripe_subscription_id",
  "status",
  "plan",
  "price_id",
  "current_period_end",
  "cancel_at_period_end",
  "cancel_at",
  "trial_end",
  "payment_failed_at",
  "livemode",
];
const TIME_FIELDS = new Set(["current_period_end", "cancel_at", "trial_end", "payment_failed_at"]);

// The fields that would change if `next` were written over `existing`. A
// column the stored row doesn't have (its SQL not applied yet) is skipped:
// the write leaves it out too. Timestamps compare by instant, not text.
export function rowChanges(existing, next) {
  if (!existing) return ROW_FIELDS.filter((f) => f in (next || {}));
  const changed = [];
  for (const f of ROW_FIELDS) {
    if (!(f in next) || !(f in existing)) continue;
    const a = existing[f] ?? null;
    const b = next[f] ?? null;
    if (TIME_FIELDS.has(f) ? toUnix(a) !== toUnix(b) : a !== b) changed.push(f);
  }
  return changed;
}
