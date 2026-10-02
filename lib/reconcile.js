// ============================================================================
// Billing reconciliation -- PURE rules: no imports with side effects, no I/O,
// no env reads. Compares what Stripe has (subscriptions, failed webhook
// deliveries, webhook endpoints, refunds) with what Plotwire has
// (public.subscriptions, billing_exempt, billing_test_accounts, app_flags,
// public.stripe_events) and lists every mismatch. lib/billingReconcile.js
// gathers the data and emails the report; app/api/admin/reconcile/route.js
// runs it every day (vercel.json).
//
// "Full" is decided on both sides with the ONE access rule: lib/access.js
// accessLevel() (the documented copy of public.access_level() in
// supabase/try-mode.sql, proven equal by the tests) for what Plotwire gives,
// and the same subscriptionLevel() applied to Stripe's own status for what
// Stripe says the person has paid for.
//
// Sections (each item is one issue; "notes" are for information only):
//   full_unpaid  full access in Plotwire, but no valid Stripe subscription
//                behind it (billing_exempt accounts are never listed)
//   paid_locked  paying in Stripe (active, trialing, or past_due within the
//                7-day grace), but not full in Plotwire
//   duplicates   more than one running subscription on one Stripe customer,
//                or for one account across customers
//   webhooks     webhook failures in the last WINDOW_HOURS: public.stripe_events
//                rows that failed, got stuck, found no account or recovered
//                after failing; events Stripe couldn't deliver; the webhook
//                endpoint missing, disabled or not sent the handled events
//   refunds      running subscriptions whose latest invoice was fully refunded
//   setup        configuration and data that would let someone in without
//                paying, or a check that couldn't run
// ============================================================================
import { accessLevel, pastDueGraceUntil, rowCounts, subscriptionLevel, toMs, PAST_DUE_GRACE_DAYS } from "@/lib/access";
import { FAILED_PAYMENT_STATUSES, HANDLED_EVENT_TYPES, asUserId, idOf, rowMatchesKeyMode } from "@/lib/stripeWebhook";
import { BLOCKING_STATUSES, ownerOf } from "@/lib/checkoutGuard";

// How far back webhook failures are reported. A day, plus up to 59 minutes
// of Vercel starting the cron late within its hour, plus the
// STUCK_AFTER_MINUTES a brand-new event is left to settle, plus slack: a
// daily run never leaves a gap (an item may rarely be listed on two days).
export const WINDOW_HOURS = 26;
// Refunds made in this many days are checked (one monthly invoice, plus slack).
export const REFUND_LOOKBACK_DAYS = 35;
// A webhook event still "processing" after this long has died part-way.
export const STUCK_AFTER_MINUTES = 10;
// A past_due or unpaid row older than this means Stripe isn't cancelling
// after its retries (its failed-payment setting should be "cancel").
export const LONG_OVERDUE_DAYS = 30;
// The accounts supabase/billing-exempt.sql makes exempt (joe@, admin@plotwire.uk,
// info@fentonselectrical). Fewer after go-live means one of them is on Try.
export const EXPECTED_EXEMPT_ACCOUNTS = 3;
export const WEBHOOK_PATH = "/api/billing/webhook";
// The email lists at most this many items per section (the route's JSON has
// them all); an outage can fail hundreds of events.
export const MAX_LISTED_PER_SECTION = 25;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Paying for Plotwire right now, as Stripe sees it (past_due only within the
// grace -- see stripeLevelOf).
const PAYING_STATUSES = new Set(["active", "trialing", "past_due"]);

export const SECTIONS = Object.freeze([
  {
    key: "full_unpaid",
    title: "Full access without a valid Stripe subscription",
    help: "Check each one in the Stripe Dashboard. If Stripe is right, correct or delete the account's row in public.subscriptions.",
  },
  {
    key: "paid_locked",
    title: "Paying in Stripe but not unlocked in Plotwire",
    help: "The payment never reached public.subscriptions. Fix any webhook problem below, then resend the subscription's latest event from the Stripe Dashboard (delete that event's row in public.stripe_events first if it has one).",
  },
  {
    key: "duplicates",
    title: "Duplicate subscriptions",
    help: "Refund and cancel the extra subscription in Stripe, and keep the one public.subscriptions tracks.",
  },
  {
    key: "webhooks",
    title: `Webhook failures (last ${WINDOW_HOURS} hours)`,
    help: "Check the endpoint in the Stripe Dashboard (Developers > Webhooks) and the Vercel logs for /api/billing/webhook.",
  },
  {
    key: "refunds",
    title: "Refunded but still running",
    help: "If the refund was meant to end the subscription, cancel it in Stripe as well: a refund on its own leaves it running and renewing.",
  },
  {
    key: "setup",
    title: "Setup and data checks",
    help: "Each item says what to change.",
  },
]);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n) => String(n).padStart(2, "0");

// "2 Oct 2026, 06:00 UTC" (no locale data needed, so it reads the same everywhere).
export function formatWhen(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "an unknown time";
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
}

// "2 Oct 2026"
export function formatDay(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "an unknown date";
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// Minor units to "£15.00" (or "15.00 EUR").
export function formatMoney(amount, currency) {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  const v = (amount / 100).toFixed(2);
  const c = String(currency || "").toLowerCase();
  return c === "gbp" ? `£${v}` : `${v} ${c.toUpperCase()}`.trim();
}

const unixMs = (t) => (typeof t === "number" && Number.isFinite(t) ? t * 1000 : null);

// The end of the subscription's current billing period (ms). Current API
// versions keep it on the item; older ones on the subscription.
export function periodEndMs(sub) {
  return unixMs(sub?.items?.data?.[0]?.current_period_end ?? sub?.current_period_end ?? null);
}

function asSet(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Set) return v;
  return new Set([...v].map((x) => asUserId(x)).filter(Boolean));
}

function lookup(map, key) {
  if (!map || key === null || key === undefined) return undefined;
  if (map instanceof Map) return map.get(key);
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

function pushTo(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The level Stripe's own state gives a subscription right now, with the one
// rule (lib/access.js subscriptionLevel). For past_due the failure time comes
// from the row when the row tracks this subscription; otherwise the rule's
// fallback (start of the unpaid month) is used.
export function stripeLevelOf(sub, row, now) {
  const tracks = Boolean(row) && row.stripe_subscription_id === sub?.id && FAILED_PAYMENT_STATUSES.has(row.status);
  return subscriptionLevel({
    status: sub?.status,
    paymentFailedAt: tracks ? row.payment_failed_at : null,
    currentPeriodEnd: periodEndMs(sub),
    now,
  });
}

function stripeGraceEnd(sub, row) {
  const tracks = Boolean(row) && row.stripe_subscription_id === sub?.id && FAILED_PAYMENT_STATUSES.has(row.status);
  return pastDueGraceUntil({
    status: sub?.status,
    paymentFailedAt: tracks ? row.payment_failed_at : null,
    currentPeriodEnd: periodEndMs(sub),
  });
}

// The endpoint URL's path, or null.
function pathOf(url) {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------

// input (everything already fetched; see lib/billingReconcile.js):
//   now             ms
//   keyMode         "live" | "test" (the Stripe key's mode)
//   vercelEnv       VERCEL_ENV ("production", "preview", ...)
//   billingEnabled  NEXT_PUBLIC_BILLING_ENABLED === "true"
//   price           STRIPE_PRICE (null: prices aren't checked)
//   subscriptions   every Stripe subscription in this mode, any status
//   listTruncated   the list stopped at its cap
//   retrieved       { id: subscription | null } fetched one by one (rows
//                   whose subscription the list left out; null: not in Stripe)
//   customers       { id: customer } for running subscriptions with no user_id
//   stripeEvents    events Stripe couldn't deliver in the window (null: not checked)
//   endpoints       webhook endpoints (null: not checked)
//   refundedInvoices { invoiceId: { chargeId, refundedAt (unix s) } } for fully
//                   refunded payments (null: not checked)
//   latestInvoices  { invoiceId: invoice } for discounted running subscriptions
//   stripeErrors    { "what": "message" } for checks that couldn't run
//   rows            public.subscriptions rows
//   exempt          billing_exempt user ids (null: table missing)
//   testAccounts    billing_test_accounts user ids (null: table missing)
//   enforceBilling  app_flags.enforce_billing (null: not installed)
//   ledger          public.stripe_events rows attempted in the window (null: table missing)
// Returns { checkedAt, mode, production, windowHours, counts, issues, notes,
// issueCount, clean, bySection }. Issues and notes are
// { section, code, userId, customerId, customerEmail, subscriptionId,
//   eventId, detail }.
export function reconcile(input = {}) {
  const {
    now = Date.now(),
    keyMode,
    vercelEnv = null,
    billingEnabled = false,
    price = null,
    subscriptions = [],
    listTruncated = false,
    retrieved = {},
    customers = {},
    stripeEvents = null,
    endpoints = null,
    refundedInvoices = null,
    latestInvoices = {},
    stripeErrors = {},
    rows = [],
    exempt = null,
    testAccounts = null,
    enforceBilling = null,
    ledger = null,
  } = input;
  if (keyMode !== "live" && keyMode !== "test") throw new Error("reconcile: keyMode must be 'live' or 'test'");

  const production = vercelEnv === "production" || keyMode === "live";
  const modeWord = keyMode === "live" ? "live" : "test";
  const since = now - WINDOW_HOURS * HOUR_MS;
  const exemptSet = asSet(exempt) || new Set();
  const testSet = asSet(testAccounts) || new Set();
  const goneLive = production && billingEnabled;

  const issues = [];
  const notes = [];
  const item = (section, code, fields) => ({
    section,
    code,
    userId: null,
    customerId: null,
    customerEmail: null,
    subscriptionId: null,
    eventId: null,
    ...fields,
  });
  const issue = (section, code, fields) => {
    const it = item(section, code, fields);
    issues.push(it);
    return it;
  };
  const note = (code, fields) => notes.push(item("notes", code, fields));
  // A change in the last STUCK_AFTER_MINUTES may still have its webhook on
  // the way. The item stays an issue (it may be real); the hint says so.
  const recentHint = (...times) => {
    const ms = Math.max(...times.filter((t) => typeof t === "number" && Number.isFinite(t)));
    const age = now - ms;
    if (!Number.isFinite(age) || age < -60 * 1000 || age >= STUCK_AFTER_MINUTES * 60 * 1000) return "";
    const when = age < 60 * 1000 ? "under a minute" : plural(Math.round(age / 60000), "minute");
    return ` This changed ${when} ago, so its webhook may still be on the way: run the check again (?email=0) to confirm.`;
  };
  const changedAt = (sub, row) =>
    recentHint(unixMs(sub?.created), unixMs(sub?.canceled_at), unixMs(sub?.ended_at), toMs(row?.updated_at));

  // Rows, and who owns which Stripe subscription / customer.
  const rowsByUser = new Map();
  const userBySub = new Map();
  const usersByCustomer = new Map();
  for (const r of rows || []) {
    const uid = asUserId(r?.user_id);
    if (!uid) continue;
    rowsByUser.set(uid, r);
    if (r.stripe_subscription_id) userBySub.set(r.stripe_subscription_id, uid);
    if (r.stripe_customer_id) {
      if (!usersByCustomer.has(r.stripe_customer_id)) usersByCustomer.set(r.stripe_customer_id, new Set());
      usersByCustomer.get(r.stripe_customer_id).add(uid);
    }
  }
  const subsById = new Map();
  for (const s of subscriptions || []) if (s?.id) subsById.set(s.id, s);
  const findSub = (id) => {
    if (!id) return null;
    if (subsById.has(id)) return subsById.get(id);
    const r = lookup(retrieved, id);
    return r || null;
  };
  const customerOf = (sub) => {
    if (sub?.customer && typeof sub.customer === "object") return sub.customer;
    return lookup(customers, idOf(sub?.customer)) || null;
  };
  // The account a Stripe subscription belongs to: its metadata (our checkout
  // writes user_id), else the row that tracks it, else its customer's
  // metadata, else the one account whose row holds that customer.
  const ownerOfSub = (sub) => {
    const meta = ownerOf(sub);
    if (meta) return meta;
    const viaRow = userBySub.get(sub.id);
    if (viaRow) return viaRow;
    const viaCustomer = ownerOf(customerOf(sub));
    if (viaCustomer) return viaCustomer;
    const set = usersByCustomer.get(idOf(sub.customer));
    return set && set.size === 1 ? [...set][0] : null;
  };
  const customerEmailOf = (sub) => {
    const c = customerOf(sub);
    return c && !c.deleted && typeof c.email === "string" ? c.email : null;
  };

  // -------------------------------------------------------------------------
  // 1. Full in Plotwire without a valid Stripe subscription
  // -------------------------------------------------------------------------
  let otherModeRows = 0;
  let legacyPastDue = 0;
  for (const [uid, row] of rowsByUser) {
    if (exemptSet.has(uid)) continue; // exempt: full without paying, by design
    const testAccount = testSet.has(uid);
    const sameMode = rowMatchesKeyMode(row, keyMode);
    if (!sameMode) otherModeRows += 1;
    if (row.status === "past_due" && !row.payment_failed_at && rowCounts(row, { testAccount })) legacyPastDue += 1;

    // past_due / unpaid far longer than Stripe's retries take.
    if (sameMode && rowCounts(row, { testAccount }) && FAILED_PAYMENT_STATUSES.has(row.status)) {
      const failedAt = toMs(row.payment_failed_at);
      if (failedAt !== null && now - failedAt > LONG_OVERDUE_DAYS * DAY_MS) {
        issue("setup", "long-overdue", {
          userId: uid,
          customerId: row.stripe_customer_id || null,
          subscriptionId: row.stripe_subscription_id || null,
          detail: `${row.status} for ${Math.floor((now - failedAt) / DAY_MS)} days (payment failed ${formatDay(failedAt)}). Stripe's failed-payment setting should cancel the subscription after its retries.`,
        });
      }
    }

    const level = accessLevel({ testAccount, row, now });
    if (level !== "full") continue;
    const base = {
      userId: uid,
      customerId: row.stripe_customer_id || null,
      subscriptionId: row.stripe_subscription_id || null,
    };
    if (!sameMode) {
      if (keyMode === "live") {
        // Only a billing test account's test-mode row can count here.
        issue("full_unpaid", "test-row-counts", {
          ...base,
          detail: `Full access from a TEST-mode subscription (${row.status}): the account is in billing_test_accounts, so its test card counts in production too. Remove it from billing_test_accounts once testing is over.`,
        });
      }
      // A test key can't see live subscriptions: counted in the notes.
      continue;
    }
    if (!row.stripe_subscription_id) {
      issue("full_unpaid", "no-subscription-id", {
        ...base,
        detail: `Plotwire gives full access (row status ${row.status}), but the row has no Stripe subscription id.${changedAt(null, row)}`,
      });
      continue;
    }
    const sub = findSub(row.stripe_subscription_id);
    if (!sub) {
      issue("full_unpaid", "missing-in-stripe", {
        ...base,
        detail: `Plotwire says ${row.status}, but Stripe (${modeWord} mode) has no subscription ${row.stripe_subscription_id}: it was deleted, or made in the other Stripe mode.${changedAt(null, row)}`,
      });
      continue;
    }
    const owner = ownerOf(sub);
    if (owner && owner !== uid) {
      issue("full_unpaid", "other-account", {
        ...base,
        detail: `Plotwire says ${row.status}, but Stripe's subscription ${sub.id} belongs to another account (${owner}).${changedAt(sub, row)}`,
      });
      continue;
    }
    if (stripeLevelOf(sub, row, now) !== "full") {
      let why = `Stripe says ${sub.status}`;
      if (sub.status === "past_due") {
        const end = stripeGraceEnd(sub, row);
        why = end === null
          ? "Stripe says past_due, with no known date for the failed payment"
          : `Stripe says past_due, and the ${PAST_DUE_GRACE_DAYS}-day grace ended ${formatDay(end)}`;
      }
      issue("full_unpaid", "stripe-not-paying", { ...base, detail: `Plotwire says ${row.status}, but ${why}.${changedAt(sub, row)}` });
    }
  }

  // -------------------------------------------------------------------------
  // 2. Paying in Stripe, not full in Plotwire; and the checks on every
  //    running subscription (price, pause, discounts, refunds, duplicates)
  // -------------------------------------------------------------------------
  let running = 0;
  let testIgnored = 0;
  let noMetadata = 0;
  const runningByCustomer = new Map();
  const runningByOwner = new Map();
  for (const sub of subscriptions || []) {
    if (!sub?.id || !BLOCKING_STATUSES.has(sub.status)) continue;
    running += 1;
    const uid = ownerOfSub(sub);
    const customerId = idOf(sub.customer);
    const customerEmail = customerEmailOf(sub);
    const base = { userId: uid, customerId, customerEmail, subscriptionId: sub.id };
    pushTo(runningByCustomer, customerId, sub);
    if (uid) pushTo(runningByOwner, uid, sub);
    if (!ownerOf(sub) && uid) noMetadata += 1;

    // Only the Plotwire price, one seat, collecting payment.
    const items = sub.items?.data || [];
    if (items.length !== 1) {
      issue("setup", "items", { ...base, detail: `Running subscription with ${plural(items.length, "item")} (expected exactly 1).` });
    } else {
      const p = items[0]?.price?.id || null;
      if (price && p !== price) {
        issue("setup", "price", { ...base, detail: `Running subscription for price ${p || "(none)"}, not the Plotwire price ${price}. It still gives full access.` });
      }
      const q = items[0]?.quantity ?? 1;
      if (q !== 1) issue("setup", "quantity", { ...base, detail: `Running subscription with quantity ${q} (expected 1).` });
    }
    if (sub.status === "paused") {
      // A trial that ended without a card, with "pause" as its end behaviour.
      issue("setup", "paused", {
        ...base,
        detail: "The subscription is paused: the account is read-only, and it can't start a new subscription (it would be sent to the billing portal) until this one is resumed or cancelled in Stripe.",
      });
    }
    if (sub.pause_collection) {
      issue("setup", "paused-collection", {
        ...base,
        detail: `Payment collection is paused (${sub.pause_collection.behavior || "paused"}), but Stripe keeps the subscription ${sub.status}, so the account stays full without paying. Resume or cancel it in Stripe.`,
      });
    }
    // Made in the Dashboard with "email invoice": Stripe keeps it active for
    // days_until_due while the invoice sits unpaid. Checkout never does this.
    if (sub.collection_method && sub.collection_method !== "charge_automatically") {
      issue("setup", "send-invoice", {
        ...base,
        detail: `Its invoices are emailed for payment by hand (collection_method ${sub.collection_method}), so Stripe keeps it ${sub.status} for days while unpaid and the account is full without paying. Plotwire's Checkout always charges the card: switch it to automatic charging in Stripe, or cancel it.`,
      });
    }

    if (!PAYING_STATUSES.has(sub.status)) continue; // unpaid / paused: not paying
    const row = uid ? rowsByUser.get(uid) || null : null;
    if (stripeLevelOf(sub, row, now) !== "full") continue; // past_due beyond the grace: rightly not full

    // Refunded, still running.
    if (refundedInvoices) {
      const inv = idOf(sub.latest_invoice);
      const refund = inv ? lookup(refundedInvoices, inv) : undefined;
      if (refund) {
        issue("refunds", "refunded-latest-invoice", {
          ...base,
          detail: `The latest invoice ${inv} was fully refunded${refund.refundedAt ? ` on ${formatDay(unixMs(refund.refundedAt))}` : ""}, but the subscription is still ${sub.status}, so the account keeps full access and it renews.`,
        });
      }
    }

    // Discounts (a 100% promotion code is "active" at £0). For information.
    if ((sub.discounts || []).length) {
      const inv = lookup(latestInvoices, idOf(sub.latest_invoice));
      const amount = inv ? formatMoney(inv.total ?? inv.amount_due, inv.currency) : null;
      note("discount", {
        ...base,
        detail: `Has a discount (promotion code)${amount ? `; latest invoice ${amount}` : ""}.`,
      });
    }

    if (!uid) {
      issue("paid_locked", "unmapped", {
        ...base,
        detail: `Stripe says ${sub.status}, but no Plotwire account is linked: the subscription has no user_id in its metadata and its customer isn't on any account's row.${changedAt(sub, null)}`,
      });
      continue;
    }
    if (exemptSet.has(uid)) {
      note("exempt-paying", { ...base, detail: `An exempt account also has a running subscription (${sub.status}); it doesn't need one.` });
      continue;
    }
    const testAccount = testSet.has(uid);
    if (keyMode === "test" && !testAccount) {
      // A test card on an account that isn't a billing test account: it
      // never unlocks anything (previews share the production database).
      testIgnored += 1;
      continue;
    }
    const level = accessLevel({ testAccount, row, now });
    if (level === "full") continue;
    let reason;
    if (!row) reason = "there is no row for it in public.subscriptions";
    else if (!rowCounts(row, { testAccount })) reason = "its row is a test-mode row, which production ignores";
    else if (row.stripe_subscription_id !== sub.id) reason = `its row tracks ${row.stripe_subscription_id || "no subscription"} (${row.status})`;
    else reason = `its row says ${row.status}`;
    issue("paid_locked", "not-unlocked", {
      ...base,
      detail: `Stripe says ${sub.status}, but Plotwire gives this account ${level}: ${reason}.${changedAt(sub, row)}`,
    });
  }

  // -------------------------------------------------------------------------
  // 3. Duplicates: per customer, and per account across customers
  // -------------------------------------------------------------------------
  const describe = (list) => list.map((s) => `${s.id} (${s.status})`).join(", ");
  for (const [customerId, list] of runningByCustomer) {
    if (list.length < 2) continue;
    const owners = [...new Set(list.map(ownerOfSub).filter(Boolean))];
    issue("duplicates", "per-customer", {
      userId: owners.length === 1 ? owners[0] : null,
      customerId,
      customerEmail: customerEmailOf(list[0]),
      detail: `${list.length} running subscriptions on one Stripe customer: ${describe(list)}.`,
    });
  }
  for (const [uid, list] of runningByOwner) {
    const customerIds = [...new Set(list.map((s) => idOf(s.customer)).filter(Boolean))];
    if (list.length < 2 || customerIds.length < 2) continue;
    issue("duplicates", "per-account", {
      userId: uid,
      detail: `${list.length} running subscriptions for one account across ${customerIds.length} Stripe customers (${customerIds.join(", ")}): ${describe(list)}.`,
    });
  }

  // -------------------------------------------------------------------------
  // 4. Webhook failures
  // -------------------------------------------------------------------------
  const listedEvents = new Map();
  if (ledger === null) {
    issue("setup", "ledger-missing", {
      detail: "public.stripe_events doesn't exist: run supabase/billing-hardening.sql. Without it the webhook can't save subscriptions and its failures can't be checked.",
    });
  } else {
    for (const e of ledger || []) {
      if (!e?.id) continue;
      // Previews and production share the table: only this mode's events.
      if ((e.livemode === true) !== (keyMode === "live")) continue;
      const last = toMs(e.last_attempt_at) ?? toMs(e.received_at);
      if (last === null || last < since) continue;
      const attempts = Number(e.attempts) || 0;
      const what = `${e.type || "event"} ${e.id}${e.object_id ? ` (for ${e.object_id})` : ""}`;
      let code = null;
      let detail = null;
      if (!e.processed_at) {
        if (e.outcome === "processing") {
          if (now - last < STUCK_AFTER_MINUTES * 60 * 1000) continue; // may be running right now
          code = "stuck";
          detail = `${what} started ${formatWhen(last)} and never finished (attempt ${attempts}). Stripe retries it.`;
        } else {
          code = "failed";
          detail = `${what} failed (attempt ${attempts}, last ${formatWhen(last)}): ${e.error || "no error recorded"}. Stripe retries it for up to 3 days.`;
        }
      } else if (e.outcome === "unmapped") {
        code = "unmapped";
        detail = `${what} had no Plotwire account to apply to: ${e.error || "unmapped"}.`;
      } else if (e.error && attempts > 1) {
        code = "recovered";
        detail = `${what} failed ${plural(attempts - 1, "time")}, then succeeded. Last error: ${e.error}.`;
      } else {
        continue;
      }
      listedEvents.set(e.id, issue("webhooks", code, { eventId: e.id, detail }));
    }
  }
  if (stripeEvents) {
    for (const ev of stripeEvents) {
      if (!ev?.id) continue;
      const created = unixMs(ev.created);
      if (created !== null && created < since) continue;
      const already = listedEvents.get(ev.id);
      if (already) {
        already.detail += " Stripe still lists it as not delivered.";
        continue;
      }
      // Stripe delivers within seconds; a very new event is still on its way
      // (the next run, 24 hours later, still sees it inside its window).
      if (created !== null && now - created < STUCK_AFTER_MINUTES * 60 * 1000) continue;
      listedEvents.set(ev.id, issue("webhooks", "undelivered", {
        eventId: ev.id,
        detail: `Stripe hasn't delivered ${ev.type || "event"} ${ev.id} (created ${formatWhen(created)})${ev.pending_webhooks ? `; ${plural(ev.pending_webhooks, "endpoint")} still pending` : ""}.`,
      }));
    }
  }
  if (endpoints) {
    const ours = endpoints.filter((ep) => pathOf(ep?.url) === WEBHOOK_PATH);
    const working = ours.filter((ep) => ep.status === "enabled");
    if (!ours.length) {
      issue("webhooks", "no-endpoint", {
        detail: `No Stripe webhook endpoint (${modeWord} mode) points at ${WEBHOOK_PATH}, so no payment reaches Plotwire.`,
      });
    } else if (!working.length) {
      for (const ep of ours) {
        issue("webhooks", "endpoint-disabled", {
          detail: `The Stripe webhook endpoint ${ep.url} is ${ep.status || "not enabled"}. Stripe disables an endpoint after days of failed deliveries: fix the cause, then enable it again.`,
        });
      }
    } else {
      for (const ep of ours.filter((x) => x.status !== "enabled")) {
        note("endpoint-disabled", { detail: `Another webhook endpoint for ${WEBHOOK_PATH} is ${ep.status || "not enabled"}: ${ep.url}.` });
      }
    }
    for (const ep of working) {
      const enabled = new Set(ep.enabled_events || []);
      const missing = enabled.has("*") ? [] : [...HANDLED_EVENT_TYPES].filter((t) => !enabled.has(t));
      if (missing.length) {
        issue("webhooks", "endpoint-events", {
          detail: `The Stripe webhook endpoint ${ep.url} isn't sent ${missing.join(", ")}.`,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 5. Setup: keys, the database switch, test accounts, missing tables,
  //    checks that couldn't run
  // -------------------------------------------------------------------------
  if (vercelEnv === "production" && keyMode === "test") {
    issue("setup", "production-test-key", {
      detail: "Production is using a Stripe TEST key, so live payments can't be processed or checked. Set the live STRIPE_SECRET_KEY for Production only.",
    });
  }
  if (vercelEnv && vercelEnv !== "production" && keyMode === "live") {
    issue("setup", "preview-live-key", {
      detail: `This ${vercelEnv} deployment is using the LIVE Stripe key: real cards are charged and written to the shared database. Keep the live keys in Production only.`,
    });
  }
  if (enforceBilling === null) {
    const text = "The database billing rules aren't installed (supabase/try-mode.sql hasn't been run), so the database doesn't enforce Try or read-only accounts.";
    if (goneLive) issue("setup", "not-installed", { detail: text });
    else note("not-installed", { detail: text });
  } else if (goneLive && enforceBilling !== true) {
    issue("setup", "enforce-off", {
      detail: "Billing is on in the app (NEXT_PUBLIC_BILLING_ENABLED), but the database switch app_flags.enforce_billing is off, so a direct Supabase call can save without paying. Switch it on (supabase/RUN-ORDER.md step 6d).",
    });
  } else if (production && !billingEnabled && enforceBilling === true) {
    issue("setup", "enforce-without-app", {
      detail: "app_flags.enforce_billing is on, but billing is off in the app (NEXT_PUBLIC_BILLING_ENABLED isn't true), so some saves are refused with no explanation on screen.",
    });
  } else {
    note("enforce", { detail: `Database switch app_flags.enforce_billing: ${enforceBilling ? "on" : "off"}.` });
  }
  if (testAccounts === null) {
    // Covered by the not-installed item above.
  } else if (goneLive && testSet.size > 0) {
    issue("setup", "test-accounts-live", {
      detail: `billing_test_accounts lists ${plural(testSet.size, "account")}; their test-card subscriptions count in production. Empty it once testing is over (supabase/RUN-ORDER.md step 6a).`,
    });
  } else {
    note("test-accounts", { detail: `Billing test accounts (billing_test_accounts): ${testSet.size}.` });
  }
  if (exempt !== null) {
    const n = exemptSet.size;
    if (goneLive && n < EXPECTED_EXEMPT_ACCOUNTS) {
      issue("setup", "exempt-missing", {
        detail: `Only ${plural(n, "exempt account")} in billing_exempt (expected ${EXPECTED_EXEMPT_ACCOUNTS}). Run supabase/billing-exempt.sql again once the missing account has signed up and confirmed its email.`,
      });
    } else {
      note("exempt", { detail: `Exempt accounts (billing_exempt): ${n}${n === EXPECTED_EXEMPT_ACCOUNTS ? "" : ` (expected ${EXPECTED_EXEMPT_ACCOUNTS})`}.` });
    }
  }
  if (!price) note("price-unset", { detail: "STRIPE_PRICE isn't set here, so subscription prices weren't checked." });
  if (listTruncated) {
    issue("setup", "list-truncated", {
      detail: `Stripe has more subscriptions than one run reads (${subsById.size} were compared), so this report may be incomplete.`,
    });
  }
  for (const [what, message] of Object.entries(stripeErrors || {})) {
    issue("setup", "check-failed", { detail: `Couldn't check ${what}: ${message}. This part of the report is missing.` });
  }

  // Notes (for information; not issues).
  if (otherModeRows) {
    note("other-mode-rows", {
      detail: keyMode === "live"
        ? `Test-mode rows in public.subscriptions (from the test-mode preview; they give no access unless the account is a billing test account): ${otherModeRows}.`
        : `Live-mode rows in public.subscriptions not checked (this deployment has a Stripe test key): ${otherModeRows}.`,
    });
  }
  if (testIgnored) {
    note("test-ignored", {
      detail: `Test-mode subscriptions on accounts that aren't billing test accounts (they unlock nothing, by design): ${testIgnored}.`,
    });
  }
  if (noMetadata) {
    note("no-metadata", {
      detail: `Running subscriptions with no user_id in their metadata, linked through their customer (made in the Dashboard?): ${noMetadata}.`,
    });
  }
  if (legacyPastDue) {
    note("legacy-past-due", {
      detail: `past_due rows with no payment_failed_at (written before billing-hardening.sql; their grace counts from the start of the unpaid month): ${legacyPastDue}.`,
    });
  }

  const bySection = Object.fromEntries(SECTIONS.map((s) => [s.key, issues.filter((i) => i.section === s.key).length]));
  return {
    checkedAt: new Date(now).toISOString(),
    mode: keyMode,
    production,
    vercelEnv: vercelEnv || null,
    windowHours: WINDOW_HOURS,
    counts: {
      stripeSubscriptions: subsById.size,
      running,
      rows: rowsByUser.size,
      ledgerEvents: ledger ? ledger.length : null,
    },
    issues,
    notes,
    issueCount: issues.length,
    clean: issues.length === 0,
    bySection,
  };
}

// Every account id the report mentions (for the email-address lookup).
export function accountsIn(report) {
  const ids = new Set();
  for (const x of [...(report?.issues || []), ...(report?.notes || [])]) if (x.userId) ids.add(x.userId);
  return [...ids];
}

// ---------------------------------------------------------------------------
// The email
// ---------------------------------------------------------------------------

export const SUBJECT_PREFIX = "Plotwire billing";

export function reportSubject(report) {
  const n = report?.issueCount || 0;
  const base = n === 0 ? `${SUBJECT_PREFIX}: All clear` : `${SUBJECT_PREFIX}: ${plural(n, "issue")}`;
  return report?.mode === "test" ? `${base} [Stripe test mode]` : base;
}

// Who an item is about, for a person: "name@example.com", or the account id
// when the address isn't known. emails: { userId: email | null }, where null
// means the account doesn't exist.
export function accountLabel(userId, emails = {}) {
  if (!userId) return null;
  const e = lookup(emails, userId);
  if (e === null) return `account ${userId} (no such Plotwire account)`;
  if (typeof e === "string" && e) return e;
  return `account ${userId}`;
}

function itemHeading(it, emails) {
  const who = accountLabel(it.userId, emails)
    || (it.customerEmail ? `${it.customerEmail} (Stripe customer email)` : null);
  const ids = [it.subscriptionId, it.customerId, it.eventId].filter(Boolean);
  return [who, ...ids].filter(Boolean).join(" · ");
}

const escapeHtml = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function headerLines(report) {
  const where = report.production ? "production" : report.vercelEnv || "not production";
  return [
    `${formatWhen(Date.parse(report.checkedAt))} · Stripe ${report.mode} mode (${where})`,
    `Compared ${plural(report.counts.stripeSubscriptions, "Stripe subscription")} (${report.counts.running} running) with ${plural(report.counts.rows, "row")} in public.subscriptions.`,
  ];
}

// { subject, text, html } for the report. emails: { userId: email | null }.
export function formatReport(report, { emails = {} } = {}) {
  const subject = reportSubject(report);
  const head = headerLines(report);
  const text = [`Plotwire billing check`, ...head, ""];
  const html = [
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1A2530;font-size:14px;line-height:1.5">`,
    `<h1 style="font-size:18px;margin:0 0 4px">Plotwire billing check</h1>`,
    ...head.map((l) => `<p style="margin:0;color:#4a5866">${escapeHtml(l)}</p>`),
  ];

  if (report.clean) {
    text.push("All clear: nothing needs attention.");
    html.push(`<p style="margin:16px 0;font-size:16px;font-weight:600;color:#1f7a4d">All clear: nothing needs attention.</p>`);
  } else {
    const n = report.issueCount;
    text.push(`${plural(n, "issue")} ${n === 1 ? "needs" : "need"} attention.`);
    html.push(`<p style="margin:16px 0;font-size:16px;font-weight:600;color:#b42318">${escapeHtml(`${plural(n, "issue")} ${n === 1 ? "needs" : "need"} attention.`)}</p>`);
    let k = 0;
    for (const s of SECTIONS) {
      const list = report.issues.filter((i) => i.section === s.key);
      if (!list.length) continue;
      k += 1;
      text.push("", `${k}. ${s.title} (${list.length})`, `   ${s.help}`);
      html.push(`<h2 style="font-size:15px;margin:20px 0 2px">${k}. ${escapeHtml(s.title)} (${list.length})</h2>`);
      html.push(`<p style="margin:0 0 6px;color:#4a5866">${escapeHtml(s.help)}</p><ul style="margin:0;padding-left:20px">`);
      for (const it of list.slice(0, MAX_LISTED_PER_SECTION)) {
        const heading = itemHeading(it, emails);
        text.push(`   - ${heading || "(no account)"}`, `     ${it.detail}`);
        html.push(`<li style="margin:0 0 6px"><strong>${escapeHtml(heading || "(no account)")}</strong><br>${escapeHtml(it.detail)}</li>`);
      }
      if (list.length > MAX_LISTED_PER_SECTION) {
        const more = `...and ${list.length - MAX_LISTED_PER_SECTION} more (the JSON from GET /api/admin/reconcile lists them all).`;
        text.push(`   ${more}`);
        html.push(`<li style="margin:0 0 6px">${escapeHtml(more)}</li>`);
      }
      html.push(`</ul>`);
    }
  }

  if (report.notes.length) {
    text.push("", "For information (not counted as issues):");
    html.push(`<h2 style="font-size:15px;margin:20px 0 2px">For information (not counted as issues)</h2><ul style="margin:0;padding-left:20px;color:#4a5866">`);
    for (const it of report.notes) {
      const heading = itemHeading(it, emails);
      const line = heading ? `${heading}: ${it.detail}` : it.detail;
      text.push(`- ${line}`);
      html.push(`<li style="margin:0 0 4px">${escapeHtml(line)}</li>`);
    }
    html.push(`</ul>`);
  }

  const footer = "Sent by the daily billing reconciliation (GET /api/admin/reconcile, scheduled in vercel.json).";
  text.push("", footer);
  html.push(`<p style="margin:20px 0 0;color:#7a8794;font-size:12px">${escapeHtml(footer)}</p></div>`);
  return { subject, text: text.join("\n"), html: html.join("\n") };
}

// { subject, text, html } when the check couldn't run at all.
export function formatFailure({ message, mode = null, now = Date.now() } = {}) {
  const subject = `${SUBJECT_PREFIX}: check failed${mode === "test" ? " [Stripe test mode]" : ""}`;
  const lines = [
    "Plotwire billing check",
    formatWhen(now),
    "",
    "The daily billing check couldn't run, so nothing was compared. This is NOT an all-clear.",
    `Error: ${message || "unknown error"}`,
    "",
    "Check the Vercel function logs for /api/admin/reconcile, fix the cause, then run it again (GET with Authorization: Bearer $CRON_SECRET).",
  ];
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1A2530;font-size:14px;line-height:1.5">${lines
    .map((l) => (l ? `<p style="margin:0 0 6px">${escapeHtml(l)}</p>` : ""))
    .join("\n")}</div>`;
  return { subject, text: lines.join("\n"), html };
}
