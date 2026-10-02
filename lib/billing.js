import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getStripe } from "@/lib/stripe";
import {
  LIVE_STATUSES,
  FAILED_PAYMENT_STATUSES,
  asUserId,
  eventTarget,
  firstFailedAt,
  idOf,
  isoFromUnix,
  lastPaidAt,
  needsDuplicateLookup,
  pickSubscription,
  replaceDecision,
  resolvePaymentFailedAt,
  rowChanges,
  subscriptionRow,
} from "@/lib/stripeWebhook";

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// Where Stripe sends people back to (checkout success/cancel, portal return).
// The site they came from if it's production or one of our Vercel previews,
// so a preview's checkout lands back on that preview; anything else gets
// APP_URL. Only these hosts are trusted -- the Origin header is client-set.
const RETURN_HOSTS = [/^app\.plotwire\.uk$/, /^planworks-[a-z0-9-]+-plotwire\.vercel\.app$/];

export function returnOrigin(req) {
  const candidate = req.headers.get("origin") || req.nextUrl?.origin || "";
  try {
    const u = new URL(candidate);
    if (u.protocol === "https:" && !u.port && RETURN_HOSTS.some((re) => re.test(u.hostname))) {
      return u.origin;
    }
  } catch {}
  return APP_URL;
}

// Single flat subscription. One Stripe Price for the whole product.
export const STRIPE_PRICE = process.env.STRIPE_PRICE;

// The webhook stamps a friendly plan name on the row. With one tier this is
// always "standard" for our price (kept so the column stays meaningful and a
// future multi-tier change is easy).
export function planForPrice(priceId) {
  if (priceId && STRIPE_PRICE && priceId === STRIPE_PRICE) return "standard";
  return null;
}

// Pull the Bearer token out of an incoming request.
export function bearer(req) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

// Validate a Supabase access token and return the user (or null).
export async function userFromToken(token) {
  if (!token) return null;
  try {
    const { data, error } = await getSupabaseAdmin().auth.getUser(token);
    if (error) return null;
    return data?.user || null;
  } catch {
    return null;
  }
}

// True when Stripe rejected a call because the customer ID we sent doesn't
// exist in this Stripe account -- e.g. a row saved under a previous account,
// or a test-mode ID used with a live key.
export function isMissingCustomer(e) {
  return e?.code === "resource_missing" && e?.param === "customer";
}

// Statuses that count as a live, paid-up (or trialling) subscription. Defined
// with the webhook rules in lib/stripeWebhook.js.
export { LIVE_STATUSES };

// ===========================================================================
// Stripe -> subscriptions: what the webhook does with an event
// ===========================================================================
// The decisions are pure helpers in lib/stripeWebhook.js. In short:
//   * Never trust an event's payload or the order events arrive in: every
//     event re-fetches the subscription and writes what Stripe has NOW.
//   * One row per user, tracking that person's best subscription (active >
//     trialing > past_due > ...), so cancelling a duplicate can't lapse
//     someone whose other subscription is still being paid.
//   * Writing the same state again changes nothing (no write; updated_at kept).
//   * After a write the subscription is fetched once more and the row checked
//     again, so two deliveries racing each other can't leave an older state.
//   * payment_failed_at is when the unpaid invoice first failed (from Stripe's
//     open invoices; never later than now). It is set only while
//     past_due/unpaid, null otherwise.

// Columns added after the table was created. Until their SQL has been run
// (subscriptions-cancel-at.sql, billing-hardening.sql) the row is saved
// without them rather than failing the webhook.
const OPTIONAL_COLUMNS = ["cancel_at", "payment_failed_at", "livemode"];

function isResourceMissing(e) {
  return e?.code === "resource_missing" || e?.raw?.code === "resource_missing";
}

function isMissingTable(error) {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

const nowUnix = () => Math.floor(Date.now() / 1000);

async function readSubscriptionRow(userId) {
  const { data, error } = await getSupabaseAdmin()
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

// The account whose row already holds this Stripe customer, if exactly one
// does. Maps a subscription made without our metadata (e.g. in the dashboard
// for an existing customer) back to its account.
async function userForCustomer(customerId) {
  if (!customerId) return null;
  const { data, error } = await getSupabaseAdmin()
    .from("subscriptions")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .limit(2);
  if (error) throw error;
  return data?.length === 1 ? asUserId(data[0].user_id) : null;
}

async function retrieveSubscriptionOrNull(id) {
  try {
    return await getStripe().subscriptions.retrieve(id);
  } catch (e) {
    // Not in this Stripe account/mode (e.g. a test-mode id seen with a live key).
    if (isResourceMissing(e)) return null;
    throw e;
  }
}

// This person's subscriptions on one customer, in any status.
async function customerSubscriptions(customerId, userId) {
  try {
    const page = await getStripe().subscriptions.list({ customer: customerId, status: "all", limit: 20 });
    return (page?.data || []).filter((s) => {
      const owner = asUserId(s.metadata?.user_id);
      return !owner || owner === userId;
    });
  } catch (e) {
    if (isResourceMissing(e)) return [];
    throw e;
  }
}

// This person's subscriptions on ANY customer, found by the user_id our
// checkout writes into the subscription metadata. Catches duplicates made on
// a second customer (two checkouts before the first webhook landed). Stripe's
// search index lags by up to about a minute, which is fine here: a brand-new
// duplicate brings itself in through its own events. A rejected query is
// logged and treated as "none found" (the per-customer lookup still ran);
// anything transient (rate limit, Stripe down) is thrown so Stripe retries.
async function userSubscriptions(userId) {
  try {
    const page = await getStripe().subscriptions.search({ query: `metadata['user_id']:'${userId}'`, limit: 20 });
    return (page?.data || []).filter((s) => asUserId(s.metadata?.user_id) === userId);
  } catch (e) {
    if (e?.type === "StripeInvalidRequestError") {
      console.warn("[billing] subscription search unavailable; checked the stored customer only:", e?.message);
      return [];
    }
    throw e;
  }
}

async function invoicesWithStatus(subscriptionId, status, limit) {
  const page = await getStripe().invoices.list({ subscription: subscriptionId, status, limit });
  return page?.data || [];
}

// When this past_due/unpaid subscription's unpaid invoice first failed (unix
// seconds or null): its open invoices, minus any left over from before the
// last payment (lib/stripeWebhook.js firstFailedAt / lastPaidAt).
async function failedSince(subscriptionId) {
  const [open, paid] = await Promise.all([
    invoicesWithStatus(subscriptionId, "open", 20),
    invoicesWithStatus(subscriptionId, "paid", 3),
  ]);
  return firstFailedAt(open, { after: lastPaidAt(paid) });
}

async function writeSubscriptionRow(row) {
  const admin = getSupabaseAdmin();
  let data = { ...row };
  for (;;) {
    const { error } = await admin.from("subscriptions").upsert(data, { onConflict: "user_id" });
    if (!error) return;
    const missing =
      error.code === "PGRST204" &&
      OPTIONAL_COLUMNS.find((c) => c in data && String(error.message || "").includes(`'${c}'`));
    if (!missing) throw error;
    console.warn(`[billing] subscriptions.${missing} column missing; saved without it (run the billing SQL)`);
    const { [missing]: _omit, ...rest } = data;
    data = rest;
  }
}

// Upsert our subscriptions row from a Stripe Subscription object.
//
// There is one row per user. If that row already tracks a DIFFERENT Stripe
// subscription, replaceDecision() (lib/stripeWebhook.js) decides: a test-mode
// subscription never replaces a live-mode row, and unless the caller compared
// the two fresh from Stripe (verifiedStoredId = the stored id it checked),
// only a live subscription replaces another -- so a cancelled or stale
// subscription can never overwrite an active one.
//
// Returns { written, skipped, reason }. written: the row changed. skipped: the
// guard kept the stored subscription. The same state again is a no-op.
export async function upsertSubscription(sub, { userId, customerId, paymentFailedAt = null, verifiedStoredId } = {}) {
  const stored = await readSubscriptionRow(userId);
  const storedVerified =
    verifiedStoredId !== undefined && (stored?.stripe_subscription_id || null) === verifiedStoredId;
  const verdict = replaceDecision({ stored, next: sub, storedVerified });
  if (!verdict.ok) return { written: false, skipped: true, reason: verdict.reason };

  const priceId = sub.items?.data?.[0]?.price?.id || null;
  const row = {
    user_id: userId,
    ...subscriptionRow(sub, { customerId, plan: planForPrice(priceId), paymentFailedAt }),
  };
  if (stored && rowChanges(stored, row).length === 0) return { written: false, skipped: false, reason: "unchanged" };
  row.updated_at = new Date().toISOString();
  await writeSubscriptionRow(row);
  return { written: true, skipped: false, reason: null };
}

// One pass: fetch from Stripe, choose, write if different.
async function syncOnce(subscriptionId, { userIdHint = null, stampUserId = false, eventCreated = null } = {}) {
  const stripe = getStripe();
  const sub = await retrieveSubscriptionOrNull(subscriptionId);
  if (!sub) {
    // Gone from Stripe (e.g. "Delete all test data" while an old event is
    // still being retried). A retry can never succeed, so acknowledge it; a
    // row still pointing at it is the reconciliation report's job.
    return {
      outcome: "skipped",
      changed: false,
      subscriptionId,
      detail: `subscription ${subscriptionId} no longer exists in Stripe`,
    };
  }

  const metaUser = asUserId(sub.metadata?.user_id);
  const hintUser = asUserId(userIdHint);
  if (metaUser && hintUser && metaUser !== hintUser) {
    console.warn("[billing] checkout and subscription disagree on user_id; using the subscription's:", sub.id);
  }
  const userId = metaUser || hintUser || (await userForCustomer(idOf(sub.customer)));
  if (!userId) {
    return {
      outcome: "unmapped",
      changed: false,
      subscriptionId: sub.id,
      detail: `subscription ${sub.id} (customer ${idOf(sub.customer)}) has no user_id and its customer isn't linked to an account`,
    };
  }
  if (stampUserId && !metaUser) {
    // So every later event for it maps straight to the account. Best effort:
    // the row is written below either way.
    try {
      await stripe.subscriptions.update(sub.id, { metadata: { user_id: userId } });
    } catch (e) {
      console.warn("[billing] couldn't stamp user_id on", sub.id, e?.message);
    }
  }

  const stored = await readSubscriptionRow(userId);
  const storedId = stored?.stripe_subscription_id || null;
  const candidates = [sub];
  let verifiedStoredId; // undefined = the stored subscription couldn't be checked in Stripe
  if (!storedId || storedId === sub.id) {
    verifiedStoredId = storedId;
  } else {
    const current = await retrieveSubscriptionOrNull(storedId);
    if (current) {
      candidates.push(current);
      verifiedStoredId = storedId;
    }
  }
  if (needsDuplicateLookup(pickSubscription(candidates, { storedId }).status)) {
    // About to record a subscription that isn't paid up (past_due, ended or
    // never started). If this person has a better one (a duplicate), track
    // that instead: on the customers we know (catches subscriptions made
    // without our metadata, e.g. in the dashboard) and on any other customer
    // (by the user_id in the metadata).
    // The lookups are independent, so they run side by side (Stripe wants a
    // quick answer to a webhook).
    const customers = [...new Set([idOf(sub.customer), stored?.stripe_customer_id].filter(Boolean))];
    const found = await Promise.all([
      ...customers.map((c) => customerSubscriptions(c, userId)),
      userSubscriptions(userId),
    ]);
    for (const list of found) candidates.push(...list);
  }
  const chosen = pickSubscription(candidates, { storedId });

  const fromInvoices = FAILED_PAYMENT_STATUSES.has(chosen.status) ? await failedSince(chosen.id) : null;
  const paymentFailedAt = resolvePaymentFailedAt({
    status: chosen.status,
    subscriptionId: chosen.id,
    fromInvoices,
    stored,
    eventCreated,
    now: nowUnix(),
  });

  let res;
  try {
    res = await upsertSubscription(chosen, { userId, customerId: idOf(chosen.customer), paymentFailedAt, verifiedStoredId });
  } catch (e) {
    // 23503: the account was deleted. Nothing to unlock; don't make Stripe retry.
    if (e?.code === "23503") {
      return { outcome: "unmapped", changed: false, userId, subscriptionId: chosen.id, detail: `account ${userId} no longer exists` };
    }
    throw e;
  }
  if (res.skipped) console.warn("[billing/webhook]", res.reason, chosen.id, chosen.status);
  return {
    outcome: res.skipped ? "skipped" : "processed",
    changed: res.written,
    userId,
    subscriptionId: chosen.id,
    detail: res.skipped
      ? res.reason
      : chosen.id !== sub.id
        ? `tracking ${chosen.id} (${chosen.status}) rather than ${sub.id} (${sub.status})`
        : null,
  };
}

// Bring the account's row in line with Stripe, starting from one subscription.
// hints: userIdHint (a Checkout Session's client_reference_id), stampUserId
// (write user_id onto the subscription when it has none), eventCreated (unix
// seconds, a last-resort clock for payment_failed_at).
// Returns { outcome: "processed" | "skipped" | "unmapped", changed, userId,
// subscriptionId, detail }.
export async function syncSubscription(subscriptionId, hints = {}) {
  let changed = false;
  let result = null;
  for (let pass = 0; pass < 3; pass++) {
    result = await syncOnce(subscriptionId, { ...hints, stampUserId: Boolean(hints.stampUserId) && pass === 0 });
    if (!result.changed) break;
    // Written: look once more. A delivery racing this one may have written an
    // older state in between; a second look that finds nothing to change ends it.
    changed = true;
  }
  return { ...result, changed };
}

// Act on one verified, handled event. Throws on a failure worth retrying
// (Stripe or the database unavailable); the route answers 500 so Stripe
// retries. Returns { outcome, detail, ... } otherwise.
export async function handleStripeEvent(event) {
  const target = eventTarget(event);
  const eventCreated = typeof event?.created === "number" ? event.created : null;
  if (!target?.id) return { outcome: "skipped", changed: false, detail: `nothing to act on in ${event?.type}` };

  if (target.kind === "checkout_session") {
    let session;
    try {
      session = await getStripe().checkout.sessions.retrieve(target.id);
    } catch (e) {
      // Gone from Stripe: a retry can never succeed (see syncOnce).
      if (isResourceMissing(e)) return { outcome: "skipped", changed: false, detail: `checkout session ${target.id} no longer exists in Stripe` };
      throw e;
    }
    if (session.mode !== "subscription") return { outcome: "skipped", changed: false, detail: `checkout mode ${session.mode}` };
    const subscriptionId = idOf(session.subscription);
    if (!subscriptionId) return { outcome: "skipped", changed: false, detail: "checkout session has no subscription" };
    // Our checkout sets client_reference_id (and metadata.user_id) to the account id.
    const userIdHint = asUserId(session.client_reference_id) || asUserId(session.metadata?.user_id);
    return syncSubscription(subscriptionId, { userIdHint, stampUserId: Boolean(userIdHint), eventCreated });
  }

  if (target.kind === "invoice") {
    if (!target.subscriptionId) return { outcome: "skipped", changed: false, detail: "invoice isn't for a subscription" };
    return syncSubscription(target.subscriptionId, { eventCreated });
  }

  return syncSubscription(target.id, { eventCreated });
}

// ===========================================================================
// The Stripe events ledger: public.stripe_events (supabase/billing-hardening.sql)
// ===========================================================================
// One row per event id. An event already processed is skipped, so the same
// event delivered twice changes nothing. Failures are kept (error, attempts,
// processed_at null) for the reconciliation report.
//   outcome: processing (started, or crashed mid-way) | processed | skipped
//            (nothing to do) | unmapped (no account to apply it to) | failed
// Events this deployment ignores (wrong mode, unhandled type) are NOT written:
// previews and production share the table, so one deployment ignoring an event
// must never mark it done for the other.

function describeError(e) {
  const code = e?.code ? `${e.code}: ` : "";
  return `${code}${e?.message || String(e)}`.slice(0, 1000);
}

// Returns { tracked, duplicate, attempts }. tracked=false: the table doesn't
// exist yet, so the event is processed without the ledger (still safe: a
// repeat writes nothing because the row already matches Stripe).
export async function beginStripeEvent(event) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("stripe_events")
    .select("processed_at, attempts")
    .eq("id", event.id)
    .limit(1);
  if (error) {
    if (isMissingTable(error)) {
      console.error("[billing/webhook] public.stripe_events is missing; run supabase/billing-hardening.sql. Processing without the duplicate check.");
      return { tracked: false, duplicate: false, attempts: 0 };
    }
    throw error;
  }
  const prior = data?.[0] || null;
  if (prior?.processed_at) return { tracked: true, duplicate: true, attempts: prior.attempts || 0 };

  const now = new Date().toISOString();
  const rec = {
    id: event.id,
    type: event.type,
    livemode: event.livemode === true,
    object_id: event.data?.object?.id || null,
    stripe_created: isoFromUnix(event.created),
    last_attempt_at: now,
    attempts: (prior?.attempts || 0) + 1,
    outcome: "processing",
  };
  const { error: writeError } = await admin.from("stripe_events").upsert(rec, { onConflict: "id" });
  if (writeError) throw writeError;
  return { tracked: true, duplicate: false, attempts: rec.attempts };
}

// Record how an event ended. outcome "failed" leaves processed_at empty so the
// event isn't treated as done; anything else marks it processed. Tried twice:
// an applied event left at "processing" would read as a webhook failure.
export async function finishStripeEvent(event, { outcome, detail = null, error = null } = {}, ledger = { tracked: true }) {
  if (!ledger?.tracked) return;
  const patch = { outcome };
  if (outcome !== "failed") patch.processed_at = new Date().toISOString();
  if (outcome === "failed") patch.error = describeError(error);
  else if (outcome === "unmapped") patch.error = String(detail || "unmapped").slice(0, 1000);
  let writeError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    ({ error: writeError } = await getSupabaseAdmin().from("stripe_events").update(patch).eq("id", event.id));
    if (!writeError) return;
  }
  throw writeError;
}
