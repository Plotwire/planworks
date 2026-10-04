import { createHash } from "crypto";
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
  rowMatchesKeyMode,
  stripeKeyMode,
  subscriptionRow,
} from "@/lib/stripeWebhook";
import {
  BLOCKING_STATUSES,
  billingPicture,
  checkoutIdempotencyKey,
  chooseOpenSession,
  ownerOf,
  sessionExpiresAt,
  sessionUsable,
  sessionsToExpire,
  stableStringify,
} from "@/lib/checkoutGuard";

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
// without them rather than failing the webhook. NOT livemode: it decides
// whether the row gives access at all (supabase/try-mode.sql
// counted_subscriptions, lib/access.js rowCounts), so a row saved without it
// would leave a paying customer on Try with the webhook answering 200 and
// Stripe never retrying. A missing livemode column (SQL not run, or a stale
// schema cache) fails the write instead: the webhook answers 500 and Stripe
// retries until it can be saved properly.
const OPTIONAL_COLUMNS = ["cancel_at", "payment_failed_at"];

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

// Every subscription on one customer, in any status, newest first. Paged
// through, not just the first page: a running subscription behind a long run
// of newer ended ones (cancelled duplicates, failed first payments) must still
// be seen, or the webhook could record an ended one and the checkout guard
// could offer a second subscription. Capped, with a warning, so one
// pathological customer can't stall a request.
const SUBSCRIPTION_LIST_CAP = 500;

async function listCustomerSubscriptions(customerId) {
  const stripe = getStripe();
  const out = [];
  let startingAfter = null;
  for (;;) {
    const page = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const data = page?.data || [];
    out.push(...data);
    if (!page?.has_more || !data.length) return out;
    if (out.length >= SUBSCRIPTION_LIST_CAP) {
      console.warn(`[billing] customer ${customerId} has over ${SUBSCRIPTION_LIST_CAP} subscriptions; only the newest were checked`);
      return out;
    }
    startingAfter = data[data.length - 1].id;
  }
}

// subscriptions.search returns at most 100 a page. More than that for one
// account isn't a real situation; it is logged rather than paged (search is
// rate-limited far more tightly than lists, and the per-customer lists above
// are the complete, consistent lookup).
const SEARCH_LIMIT = 100;

function warnIfSearchTruncated(page, userId) {
  if (page?.has_more) console.warn(`[billing] over ${SEARCH_LIMIT} subscriptions found for ${userId}; only the first ${SEARCH_LIMIT} were checked`);
}

// This person's subscriptions on one customer, in any status.
async function customerSubscriptions(customerId, userId) {
  try {
    const all = await listCustomerSubscriptions(customerId);
    return all.filter((s) => {
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
    const page = await getStripe().subscriptions.search({ query: `metadata['user_id']:'${userId}'`, limit: SEARCH_LIMIT });
    warnIfSearchTruncated(page, userId);
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
// seconds or null): its open and uncollectible invoices, minus any left over
// from before the last payment (lib/stripeWebhook.js firstFailedAt /
// lastPaidAt).
async function failedSince(subscriptionId) {
  const [open, uncollectible, paid] = await Promise.all([
    invoicesWithStatus(subscriptionId, "open", 20),
    invoicesWithStatus(subscriptionId, "uncollectible", 20),
    invoicesWithStatus(subscriptionId, "paid", 3),
  ]);
  return firstFailedAt([...open, ...uncollectible], { after: lastPaidAt(paid) });
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

// ===========================================================================
// Checkout: one subscription per person (app/api/billing/checkout/route.js)
// ===========================================================================
// Before a Checkout Session is made, STRIPE is asked whether this person
// already has a subscription that is running or can still be paid
// (lib/checkoutGuard.js BLOCKING_STATUSES). Our own row is only a starting
// point: it lags behind Stripe until the webhook lands, which is exactly when
// a second payment would slip through. Looked at, side by side:
//   * the customer on the person's row (when the row is from this Stripe mode);
//   * customers with the person's email, and their subscriptions;
//   * subscriptions.search on metadata user_id -- an extra: Stripe's search
//     index lags by about a minute, so an error there is tolerated.
// Found one: the person is sent to the billing portal for it instead, and our
// row is brought up to date from Stripe first if it was behind. Otherwise:
//   * a first payment of theirs that never went through (incomplete) has its
//     invoice voided, so it can't be paid as well (retireIncomplete);
//   * one Stripe customer per person (reused, or made once with the account id
//     in its metadata), so every checkout of theirs lands on the same customer;
//   * the Checkout Session gets an idempotency key per person per 10 minutes,
//     so a double-click or a second tab gets the same session back;
//   * it stops being payable after 35-45 minutes instead of Stripe's 24 hours;
//   * any other open checkout of theirs, on any customer, is expired: only
//     one can be paid (if Stripe won't expire one -- a payment on it is in
//     progress -- no new one is handed out either).
// Any Stripe failure other than the search throws (the route answers 500): a
// checkout is never started on a guess.

function digestOf(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 24);
}

async function retrieveCustomerOrNull(id) {
  try {
    const c = await getStripe().customers.retrieve(id);
    return c && !c.deleted ? c : null;
  } catch (e) {
    if (isResourceMissing(e)) return null;
    throw e;
  }
}

// Every subscription on one customer, in any status and for any owner
// (billingPicture decides which are the person's).
async function allSubscriptionsOf(customerId) {
  try {
    return await listCustomerSubscriptions(customerId);
  } catch (e) {
    if (isResourceMissing(e)) return [];
    throw e;
  }
}

async function customersWithEmail(email) {
  if (!email) return [];
  const page = await getStripe().customers.list({ email, limit: 10 });
  return (page?.data || []).filter((c) => c && !c.deleted);
}

// An extra only: it lags, and any error just means "nothing found this way".
async function searchedSubscriptions(userId) {
  try {
    const page = await getStripe().subscriptions.search({
      query: `metadata['user_id']:'${userId}'`,
      limit: SEARCH_LIMIT,
      expand: ["data.customer"],
    });
    warnIfSearchTruncated(page, userId);
    return page?.data || [];
  } catch (e) {
    console.warn("[billing/checkout] subscription search failed; relying on the customer lookups:", e?.message);
    return [];
  }
}

// What Stripe has for this person (lib/checkoutGuard.js billingPicture).
// row: their subscriptions row, already known to be from this Stripe mode.
export async function findStripeBilling(user, row) {
  const uid = asUserId(user?.id);
  if (!uid) throw new Error("findStripeBilling: not a user id");
  const storedId = row?.stripe_customer_id || null;
  const [storedCustomer, storedSubs, byEmail, searched] = await Promise.all([
    storedId ? retrieveCustomerOrNull(storedId) : null,
    storedId ? allSubscriptionsOf(storedId) : [],
    customersWithEmail(user.email),
    searchedSubscriptions(uid),
  ]);
  const otherCustomers = byEmail.filter((c) => c.id !== storedId);
  const otherSubs = await Promise.all(otherCustomers.map((c) => allSubscriptionsOf(c.id)));
  return billingPicture({
    userId: uid,
    stored: storedId ? { customer: storedCustomer, subscriptions: storedSubs } : null,
    others: otherCustomers.map((customer, i) => ({ customer, subscriptions: otherSubs[i] })),
    searched,
    storedSubscriptionId: row?.stripe_subscription_id || null,
  });
}

// One Stripe customer per person, made the first time they check out, with the
// account id in its metadata so it is found again (by email here, by the
// webhook through the subscription). The idempotency key makes a double-click
// make only one. fresh: the one that key returns has since been deleted.
async function createCustomerFor(user, { fresh = false } = {}) {
  const params = { ...(user.email ? { email: user.email } : {}), metadata: { user_id: user.id } };
  const key = `plotwire-customer-${user.id}-${digestOf(params)}${fresh ? `-${nowUnix()}` : ""}`;
  const c = await getStripe().customers.create(params, { idempotencyKey: key });
  return c.id;
}

// Every open Checkout Session in this Stripe account is read, not only the
// ones on this customer: a person can have open sessions on more than one
// customer (their email changed between two checkouts, so the second found
// none by email and made a new customer), and every one of theirs must be
// expired. List calls are consistent (unlike search), and open sessions are
// few: ours stop being payable after 45 minutes. chooseOpenSession() keeps
// only this person's.
const OPEN_SESSIONS_CAP = 1000;

async function openSessionsFor(customerId) {
  const stripe = getStripe();
  const [onCustomer, everywhere] = await Promise.all([
    stripe.checkout.sessions.list({ customer: customerId, status: "open", limit: 20 }).then((p) => p?.data || []),
    (async () => {
      const out = [];
      let startingAfter = null;
      for (;;) {
        const page = await stripe.checkout.sessions.list({
          status: "open",
          limit: 100,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        const data = page?.data || [];
        out.push(...data);
        if (!page?.has_more || !data.length) return out;
        if (out.length >= OPEN_SESSIONS_CAP) {
          console.warn(`[billing/checkout] over ${OPEN_SESSIONS_CAP} open Checkout Sessions; only the newest were checked`);
          return out;
        }
        startingAfter = data[data.length - 1].id;
      }
    })(),
  ]);
  return [...onCustomer, ...everywhere];
}

// Make an open Checkout Session unpayable. "expired" (or already was), "gone",
// "complete" when it was paid in the meantime, or "open" when Stripe refused
// to expire it and it is still payable (e.g. a payment on it is in progress).
async function expireSession(id) {
  const stripe = getStripe();
  try {
    await stripe.checkout.sessions.expire(id);
    return "expired";
  } catch (e) {
    if (isResourceMissing(e)) return "gone";
    if (e?.type !== "StripeInvalidRequestError") throw e;
    const s = await stripe.checkout.sessions.retrieve(id); // refused: why?
    if (s?.status === "complete") return "complete";
    if (s?.status === "open") return "open";
    return "expired";
  }
}

// The person's row brought up to date from Stripe for this running
// subscription of theirs, when the row doesn't show it yet (webhook late or
// lost) -- the same sync the webhook runs. Returns true when the row changed.
async function healRow(uid, sub, row) {
  const behind = !row || row.stripe_subscription_id !== sub.id || row.status !== sub.status;
  if (!behind || (ownerOf(sub) && ownerOf(sub) !== uid)) return false;
  const res = await syncSubscription(sub.id, { userIdHint: uid, stampUserId: true });
  return Boolean(res?.changed);
}

// Someone with a running subscription: the billing portal for it, never a
// second checkout. If our row doesn't show that subscription yet it is healed
// from Stripe first (healRow), so the app unlocks without waiting for the
// webhook.
async function portalFor(user, sub, row, origin) {
  const uid = asUserId(user.id);
  try {
    await healRow(uid, sub, row);
  } catch (e) {
    console.error("[billing/checkout] couldn't update the subscriptions row from Stripe:", sub.id, e);
  }
  try {
    const portal = await getStripe().billingPortal.sessions.create({
      customer: idOf(sub.customer),
      return_url: `${origin}/`,
    });
    return { kind: "portal", url: portal.url, status: sub.status, subscriptionId: sub.id };
  } catch (e) {
    console.error("[billing/checkout] couldn't open the billing portal for", idOf(sub.customer), e);
    return { kind: "blocked", reason: "portal-unavailable", status: sub.status, subscriptionId: sub.id };
  }
}

// A first payment that never went through leaves the subscription
// "incomplete" for up to 23 hours, and its first invoice can still be paid in
// that time (hosted invoice page, a 3D Secure link, the API). Starting a new
// checkout next to it would let both be paid -- two subscriptions. So before a
// new checkout, each incomplete subscription of theirs has that invoice
// VOIDED: it can then never be paid, so that subscription never starts and
// Stripe expires it (incomplete_expired: Try, not Lapsed). It is deliberately
// not cancelled: a cancelled subscription reads as one that ended (Lapsed),
// and cancelling leaves its invoice open (Stripe only stops collecting it).
// Voiding first is race-free: if the invoice was paid a moment ago the void
// is refused and that now-running subscription is returned (-> the portal).
// Returns a subscription of theirs that is running after all, or null.
async function retireIncomplete(subscriptions) {
  const stripe = getStripe();
  for (const s of subscriptions || []) {
    if (s?.status !== "incomplete") continue;
    const fresh = await retrieveSubscriptionOrNull(s.id);
    if (!fresh) continue;
    if (BLOCKING_STATUSES.has(fresh.status)) return fresh;
    if (fresh.status !== "incomplete") continue;
    const invoiceId = idOf(fresh.latest_invoice);
    if (!invoiceId) continue;
    try {
      await stripe.invoices.voidInvoice(invoiceId);
      continue;
    } catch (e) {
      if (isResourceMissing(e)) continue;
      if (e?.type !== "StripeInvalidRequestError") throw e;
    }
    // Refused: why?
    const inv = await stripe.invoices.retrieve(invoiceId);
    if (inv?.status === "paid") {
      const now = await retrieveSubscriptionOrNull(fresh.id);
      if (now && BLOCKING_STATUSES.has(now.status)) return now;
    } else if (inv?.status === "open") {
      console.warn(`[billing/checkout] couldn't void ${invoiceId} of incomplete subscription ${fresh.id}; the reconciliation report will show a duplicate if it is paid`);
    }
  }
  return null;
}

// Start a checkout for this person, or send them to the billing portal.
// origin: the checked return origin (returnOrigin). price: the Stripe price.
// Returns one of:
//   { kind: "checkout", url, sessionId }
//   { kind: "portal", url, status }        already has a running subscription
//   { kind: "blocked", reason, status }    reason "portal-unavailable": the
//                                          same, but no portal link could be
//                                          made (portal not set up in Stripe);
//                                          reason "payment-in-progress": another
//                                          checkout of theirs is being paid and
//                                          Stripe wouldn't stop it
export async function beginCheckout(user, { origin, price }) {
  const uid = asUserId(user?.id);
  if (!uid) throw new Error("beginCheckout: not a user id");
  const stripe = getStripe();

  // Previews and production share one database: a row from the other Stripe
  // mode is ignored, and its customer isn't looked up or reused.
  const stored = await readSubscriptionRow(uid);
  const row = rowMatchesKeyMode(stored, stripeKeyMode(process.env.STRIPE_SECRET_KEY)) ? stored : null;

  const found = await findStripeBilling(user, row);
  if (found.blocking) return portalFor(user, found.blocking, row, origin);
  if (row && BLOCKING_STATUSES.has(row.status)) {
    // Our row says running, Stripe has nothing running: Stripe wins. (The
    // reconciliation report picks the row up.)
    console.warn(`[billing/checkout] row for ${uid} says ${row.status} (${row.stripe_subscription_id}) but Stripe has nothing running; starting a new checkout`);
  }
  const wentLive = await retireIncomplete(found.subscriptions);
  if (wentLive) return portalFor(user, wentLive, row, origin);

  const nowSec = nowUnix();
  const paramsFor = (customer) => ({
    mode: "subscription",
    customer,
    // The account id, three ways: the webhook maps a completed checkout back
    // to the account from client_reference_id (or the session metadata), and
    // every later subscription event from the subscription metadata.
    client_reference_id: uid,
    metadata: { user_id: uid },
    line_items: [{ price, quantity: 1 }],
    allow_promotion_codes: true,
    // No trial: the first month is charged at checkout. People try Plotwire
    // before paying through Try mode instead (lib/access.js).
    subscription_data: { metadata: { user_id: uid } },
    success_url: `${origin}/?checkout=success`,
    cancel_url: `${origin}/?checkout=cancelled`,
    expires_at: sessionExpiresAt(nowSec),
  });
  const keyFor = (params) => checkoutIdempotencyKey({ userId: uid, nowSec, digest: digestOf(params) });

  // A Checkout Session on this customer, with only one of theirs payable.
  const checkoutOn = async (customerId) => {
    const params = paramsFor(customerId);
    const created = await stripe.checkout.sessions.create(params, { idempotencyKey: keyFor(params) });

    // The newest open session of theirs (on any customer) is the one to pay;
    // every other open one is expired.
    const open = await openSessionsFor(customerId);
    let { winner, others } = chooseOpenSession(open, { userId: uid, origin, nowSec });
    // None usable in the list: the session this key hands back (Stripe
    // replays the first answer for 24 hours) was paid, or expired, since the
    // key was first used -- or the list just didn't show it as usable. It is
    // looked at directly. Usable -> that one. Paid and still running -> the
    // portal. Otherwise a new session under a key of its own, checked the
    // same way (a replay can be stale too).
    let candidate = created;
    for (let attempt = 0; !winner && attempt < 3; attempt++) {
      const fresh = await stripe.checkout.sessions.retrieve(candidate.id);
      if (sessionUsable(fresh, { userId: uid, origin, nowSec })) {
        winner = fresh;
        break;
      }
      // Still payable but not one to send them to: expired with the others.
      if (fresh?.status === "open") others.push(fresh);
      if (fresh?.status === "complete") {
        const now = await findStripeBilling(user, row);
        if (now.blocking) return portalFor(user, now.blocking, row, origin);
        // Paid, but that subscription has ended since: a new checkout is fine.
      }
      candidate = await stripe.checkout.sessions.create(params, { idempotencyKey: `${keyFor(params)}-after-${candidate.id}` });
    }
    if (!winner) throw new Error(`[billing/checkout] no open Checkout Session for ${uid} after retries`);

    // Never the winner itself: it may be in `others` when it was found by the
    // direct look above rather than in the list.
    const toExpire = sessionsToExpire(others, winner);
    const outcomes = await Promise.all(toExpire.map((s) => expireSession(s.id)));
    const stillOpen = outcomes.includes("open");
    if (stillOpen || outcomes.includes("complete")) {
      // Another checkout of theirs was paid while this one was being set up,
      // or is being paid right now and Stripe wouldn't stop it. Either way
      // this one must not be payable as well.
      const now = await findStripeBilling(user, row);
      if (now.blocking || stillOpen) {
        try {
          await expireSession(winner.id);
        } catch (e) {
          console.warn("[billing/checkout] couldn't expire", winner.id, e?.message);
        }
        if (now.blocking) return portalFor(user, now.blocking, row, origin);
        console.warn(`[billing/checkout] another checkout of ${uid} is still payable (payment in progress?); not starting a second one`);
        return { kind: "blocked", reason: "payment-in-progress", status: null };
      }
    }
    return { kind: "checkout", url: winner.url, sessionId: winner.id };
  };

  const customerId = found.customerId || (await createCustomerFor(user));
  try {
    return await checkoutOn(customerId);
  } catch (e) {
    // The customer was deleted after it was found or made. (Stripe replays a
    // customer made under the same idempotency key for 24 hours, deleted or
    // not.) Start again on a new one.
    if (!isMissingCustomer(e)) throw e;
    console.warn("[billing/checkout] customer not usable in Stripe; making a new one:", customerId);
    return checkoutOn(await createCustomerFor(user, { fresh: true }));
  }
}

// "Check again" after Checkout (POST /api/billing/sync): if the webhook is late
// or lost, this person's row is brought up to date from STRIPE -- never from
// anything the browser says. Same lookups as the checkout guard; only a
// subscription Stripe says is running for them is written (healRow, the
// webhook's own sync). It never starts a checkout or opens a portal, and never
// downgrades a row (ended subscriptions are the webhook's and the
// reconciliation report's job).
// Returns { found, changed, status }: found = Stripe has a running
// subscription of theirs; changed = the row was updated just now.
export async function refreshFromStripe(user) {
  const uid = asUserId(user?.id);
  if (!uid) throw new Error("refreshFromStripe: not a user id");
  const stored = await readSubscriptionRow(uid);
  const row = rowMatchesKeyMode(stored, stripeKeyMode(process.env.STRIPE_SECRET_KEY)) ? stored : null;
  const found = await findStripeBilling(user, row);
  const sub = found.blocking;
  if (!sub) return { found: false, changed: false, status: null };
  const changed = await healRow(uid, sub, row);
  return { found: true, changed, status: sub.status };
}
