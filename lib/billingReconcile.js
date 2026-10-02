import "server-only";
import { createHash, timingSafeEqual } from "crypto";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { HANDLED_EVENT_TYPES, asUserId, idOf, rowMatchesKeyMode, stripeKeyMode } from "@/lib/stripeWebhook";
import { BLOCKING_STATUSES, ownerOf } from "@/lib/checkoutGuard";
import {
  REFUND_LOOKBACK_DAYS,
  WINDOW_HOURS,
  accountsIn,
  formatFailure,
  formatReport,
  reconcile,
} from "@/lib/reconcile";

// ============================================================================
// The daily billing reconciliation (app/api/admin/reconcile/route.js):
// fetch everything from Stripe and the database, compare it
// (lib/reconcile.js reconcile), email the report to the admin (Resend) and
// return it. Read-only: nothing is written to Stripe or the database.
// ============================================================================

export const DEFAULT_EMAIL_TO = "admin@plotwire.uk";
export const DEFAULT_EMAIL_FROM = "Plotwire billing <billing@plotwire.uk>";
const RESEND_URL = "https://api.resend.com/emails";

// Limits, so one run stays well inside the route's time limit.
const SUBSCRIPTIONS_CAP = 10000;
const EVENTS_CAP = 1000;
const REFUNDS_CAP = 1000;
const RETRIEVE_CAP = 200; // single lookups (customers, invoices, subscriptions)
const CLOCKS_CAP = 100; // Stripe test clocks (test mode only)
const ROW_PAGE = 1000; // PostgREST's default maximum rows per request
const CONCURRENCY = 5;
// The comparison must finish within this, leaving time inside the route's
// 60 s limit (maxDuration) to send the email (Resend: 10 s, 1 s, 10 s at
// worst). A slow or hung Stripe or database call then ends as a "check
// failed" email instead of Vercel killing the run with nothing sent.
export const BUILD_DEADLINE_MS = 35000;
// Shorter secrets are refused (503), like an unset one. Vercel recommends at
// least 16 random characters; the go-live checklist uses openssl rand -hex 32.
export const MIN_SECRET_LENGTH = 16;
// The statuses whose row can give full access: their Stripe subscription is
// always looked up, even when the list left it out.
const ROW_STATUSES_TO_CHECK = new Set(["active", "trialing", "past_due"]);

// ---------------------------------------------------------------------------
// Who may run it: Authorization: Bearer $CRON_SECRET (what Vercel Cron sends
// when CRON_SECRET is set). Compared in constant time; no secret configured
// means nobody (fail closed).
// ---------------------------------------------------------------------------

function sameSecret(given, expected) {
  // Hash both so the comparison is constant-time whatever their lengths.
  const a = createHash("sha256").update(String(given), "utf8").digest();
  const b = createHash("sha256").update(String(expected), "utf8").digest();
  return timingSafeEqual(a, b);
}

// { ok: true } or { ok: false, status, error }.
export function checkCronAuth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[admin/reconcile] CRON_SECRET is not set; refusing every call");
    return { ok: false, status: 503, error: "Not configured." };
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    console.error(`[admin/reconcile] CRON_SECRET is shorter than ${MIN_SECRET_LENGTH} characters; refusing every call (use openssl rand -hex 32)`);
    return { ok: false, status: 503, error: "Not configured." };
  }
  const m = (req.headers.get("authorization") || "").match(/^Bearer (.+)$/);
  if (!m || !sameSecret(m[1], secret)) return { ok: false, status: 401, error: "Unauthorised." };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isMissingTable(error) {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

function isResourceMissing(e) {
  return e?.code === "resource_missing" || e?.raw?.code === "resource_missing";
}

const errorText = (e) => String(e?.message || e || "unknown error").slice(0, 300);

// fn over items, at most `limit` at a time; results in input order. On a
// failure no new item is started, the ones already running are waited for
// (nothing is left running), then the first error is thrown.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  let failed = null;
  const worker = async () => {
    while (next < items.length && !failed) {
      const i = next++;
      try {
        out[i] = await fn(items[i], i);
      } catch (e) {
        failed = failed || { error: e };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failed) throw failed.error;
  return out;
}

// Every item of an auto-paginating Stripe list, up to cap.
async function collect(list, cap) {
  const items = [];
  for await (const x of list) {
    items.push(x);
    if (items.length >= cap) return { items, truncated: true };
  }
  return { items, truncated: false };
}

// Every row of a table (paged). null when the table doesn't exist yet.
async function allRows(table, columns, orderBy, filter = (q) => q) {
  const admin = getSupabaseAdmin();
  const out = [];
  for (let from = 0; ; from += ROW_PAGE) {
    const { data, error } = await filter(admin.from(table).select(columns))
      .order(orderBy, { ascending: true })
      .range(from, from + ROW_PAGE - 1);
    if (error) {
      if (isMissingTable(error)) return null;
      throw error;
    }
    out.push(...(data || []));
    if (!data || data.length < ROW_PAGE) return out;
  }
}

async function enforceBillingFlag() {
  const { data, error } = await getSupabaseAdmin()
    .from("app_flags")
    .select("value")
    .eq("key", "enforce_billing")
    .limit(1);
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  return data?.length ? data[0].value === true : null;
}

// ---------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------

// Fully refunded payments made in the last REFUND_LOOKBACK_DAYS, by the
// invoice they paid: { invoiceId: { chargeId, refundedAt } }.
async function refundedInvoices(stripe, nowSec) {
  const { items: refunds } = await collect(
    stripe.refunds.list({ created: { gte: nowSec - REFUND_LOOKBACK_DAYS * 86400 }, limit: 100, expand: ["data.charge"] }),
    REFUNDS_CAP
  );
  const charges = new Map(); // charge id -> { charge, refundedAt }
  for (const r of refunds) {
    if (r?.status === "failed" || r?.status === "canceled") continue;
    const charge = r?.charge && typeof r.charge === "object" ? r.charge : null;
    if (!charge?.id || charge.refunded !== true) continue; // partial refunds don't end anything
    const prev = charges.get(charge.id);
    if (!prev || (r.created || 0) > (prev.refundedAt || 0)) charges.set(charge.id, { charge, refundedAt: r.created || null });
  }
  const out = {};
  const list = [...charges.values()].slice(0, RETRIEVE_CAP);
  await mapLimit(list, CONCURRENCY, async ({ charge, refundedAt }) => {
    const pi = idOf(charge.payment_intent);
    if (!pi) return;
    const page = await stripe.invoicePayments.list({ payment: { type: "payment_intent", payment_intent: pi }, limit: 10 });
    for (const p of page?.data || []) {
      const inv = idOf(p.invoice);
      if (inv) out[inv] = { chargeId: charge.id, refundedAt };
    }
  });
  return out;
}

// Subscriptions on Stripe test clocks (test mode only). A plain
// subscriptions.list leaves them out ("The response will not include
// subscriptions with test clocks if this and the customer parameter is not
// set"), so each clock's are listed on their own.
async function testClockSubscriptions(stripe) {
  const { items: clocks } = await collect(stripe.testHelpers.testClocks.list({ limit: 100 }), CLOCKS_CAP);
  const lists = await mapLimit(clocks, CONCURRENCY, async (clock) =>
    (await collect(stripe.subscriptions.list({ status: "all", test_clock: clock.id, limit: 100 }), SUBSCRIPTIONS_CAP)).items
  );
  return lists.flat();
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

// Gather, compare, return { report, emails } (no email sent).
export async function buildReconciliation({ now = Date.now() } = {}) {
  const key = process.env.STRIPE_SECRET_KEY;
  const keyMode = stripeKeyMode(key);
  if (!keyMode) throw new Error("STRIPE_SECRET_KEY is missing or isn't an sk_/rk_ key");
  const stripe = getStripe();
  const nowSec = Math.floor(now / 1000);
  const sinceSec = nowSec - WINDOW_HOURS * 3600;
  const sinceIso = new Date(sinceSec * 1000).toISOString();
  const stripeErrors = {};
  // A check that can't run is reported as an issue rather than failing the
  // whole report (the subscription list and the database are required).
  // fn is called inside the promise chain, so even a synchronous throw lands here.
  const optional = (what, fn) =>
    Promise.resolve()
      .then(fn)
      .catch((e) => {
        console.warn(`[admin/reconcile] couldn't check ${what}:`, errorText(e));
        stripeErrors[what] = errorText(e);
        return null;
      });

  // allSettled, not all: every lookup has finished before the run carries on
  // or gives up, so nothing is left running after the route has answered.
  const settled = await Promise.allSettled([
    collect(stripe.subscriptions.list({ status: "all", limit: 100 }), SUBSCRIPTIONS_CAP),
    allRows("subscriptions", "*", "user_id"),
    allRows("billing_exempt", "user_id", "user_id"),
    allRows("billing_test_accounts", "user_id", "user_id"),
    enforceBillingFlag(),
    allRows(
      "stripe_events",
      "id, type, livemode, object_id, outcome, attempts, error, received_at, last_attempt_at, processed_at",
      "id",
      (q) => q.gte("last_attempt_at", sinceIso)
    ),
    optional("Stripe's failed webhook deliveries", () =>
      // Only the events Plotwire's webhook handles: the others may be failing
      // at some other endpoint of the Stripe account, which isn't ours.
      collect(
        stripe.events.list({ delivery_success: false, created: { gte: sinceSec }, types: [...HANDLED_EVENT_TYPES], limit: 100 }),
        EVENTS_CAP
      )
    ),
    optional("the Stripe webhook endpoints", () => stripe.webhookEndpoints.list({ limit: 100 }).then((p) => p?.data || [])),
    optional("refunds", () => refundedInvoices(stripe, nowSec)),
    optional("the subscriptions on Stripe test clocks", () => (keyMode === "test" ? testClockSubscriptions(stripe) : [])),
  ]);
  const failure = settled.find((s) => s.status === "rejected");
  if (failure) throw failure.reason;
  const [subs, rows, exempt, testAccounts, enforceBilling, ledger, failed, endpoints, refunds, clockSubs] = settled.map((s) => s.value);
  if (rows === null) throw new Error("public.subscriptions doesn't exist");

  const subsById = new Map();
  for (const s of [...subs.items, ...(clockSubs || [])]) if (s?.id && !subsById.has(s.id)) subsById.set(s.id, s);
  const rowSubIds = new Set(rows.map((r) => r.stripe_subscription_id).filter(Boolean));
  const rowCustomers = new Set(rows.map((r) => r.stripe_customer_id).filter(Boolean));

  // Every row of this Stripe mode that can give full access has its
  // subscription checked, even when the list left it out (a truncated list,
  // a test clock whose listing failed, a change made while the list was
  // being read): fetched one by one. Not found in Stripe = null.
  const retrieved = {};
  const missingIds = [
    ...new Set(
      rows
        .filter((r) => r.stripe_subscription_id && ROW_STATUSES_TO_CHECK.has(r.status) && rowMatchesKeyMode(r, keyMode))
        .map((r) => r.stripe_subscription_id)
        .filter((id) => !subsById.has(id))
    ),
  ];
  if (missingIds.length > RETRIEVE_CAP) {
    stripeErrors["every row's Stripe subscription"] = `${missingIds.length - RETRIEVE_CAP} weren't looked up (limit ${RETRIEVE_CAP} a run)`;
  }
  await mapLimit(missingIds.slice(0, RETRIEVE_CAP), CONCURRENCY, async (id) => {
    try {
      retrieved[id] = await stripe.subscriptions.retrieve(id);
    } catch (e) {
      if (!isResourceMissing(e)) throw e;
      retrieved[id] = null;
    }
  });
  // Found that way: compared like the listed ones (price, duplicates, ...).
  for (const s of Object.values(retrieved)) if (s?.id && !subsById.has(s.id)) subsById.set(s.id, s);
  const subscriptions = [...subsById.values()];

  // Running subscriptions with no user_id that no row tracks: their customer
  // may name the account, and its email helps to find whose it is.
  const customerIds = [
    ...new Set(
      subscriptions
        .filter((s) => BLOCKING_STATUSES.has(s.status) && !ownerOf(s) && !rowSubIds.has(s.id) && !rowCustomers.has(idOf(s.customer)))
        .map((s) => idOf(s.customer))
        .filter(Boolean)
    ),
  ].slice(0, RETRIEVE_CAP);
  const customers = {};
  await mapLimit(customerIds, CONCURRENCY, async (id) => {
    try {
      customers[id] = await stripe.customers.retrieve(id);
    } catch (e) {
      if (!isResourceMissing(e)) throw e;
    }
  });

  // The latest invoice of discounted running subscriptions (to show the amount).
  const invoiceIds = [
    ...new Set(
      subscriptions
        .filter((s) => BLOCKING_STATUSES.has(s.status) && (s.discounts || []).length)
        .map((s) => idOf(s.latest_invoice))
        .filter(Boolean)
    ),
  ].slice(0, RETRIEVE_CAP);
  const latestInvoices = {};
  await mapLimit(invoiceIds, CONCURRENCY, async (id) => {
    try {
      latestInvoices[id] = await stripe.invoices.retrieve(id);
    } catch (e) {
      console.warn("[admin/reconcile] couldn't read invoice", id, errorText(e));
    }
  });

  const report = reconcile({
    now,
    keyMode,
    vercelEnv: process.env.VERCEL_ENV || null,
    billingEnabled: process.env.NEXT_PUBLIC_BILLING_ENABLED === "true",
    price: process.env.STRIPE_PRICE || null,
    subscriptions,
    listTruncated: subs.truncated,
    retrieved,
    customers,
    stripeEvents: failed ? failed.items : null,
    endpoints,
    refundedInvoices: refunds,
    latestInvoices,
    stripeErrors,
    rows,
    exempt: exempt ? exempt.map((r) => r.user_id) : null,
    testAccounts: testAccounts ? testAccounts.map((r) => r.user_id) : null,
    enforceBilling,
    ledger,
  });

  // Email addresses of the accounts it mentions (null: no such account).
  const emails = {};
  const ids = accountsIn(report).filter((id) => asUserId(id)).slice(0, RETRIEVE_CAP);
  const admin = getSupabaseAdmin();
  await mapLimit(ids, CONCURRENCY, async (id) => {
    try {
      const { data, error } = await admin.auth.admin.getUserById(id);
      if (data?.user) emails[id] = data.user.email || undefined;
      else if (error?.status === 404 || /not found/i.test(error?.message || "")) emails[id] = null;
    } catch (e) {
      console.warn("[admin/reconcile] couldn't look up account", id, errorText(e));
    }
  });
  return { report, emails };
}

// ---------------------------------------------------------------------------
// Email (Resend REST API, no SDK)
// ---------------------------------------------------------------------------

export function reportRecipients() {
  const list = String(process.env.RECONCILE_EMAIL_TO || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+$/.test(s));
  return list.length ? list : [DEFAULT_EMAIL_TO];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// { sent, id?, to, skipped?, error? }. One retry for a network error, a 429
// or a 5xx, under the same Idempotency-Key so Resend never sends it twice.
export async function sendReportEmail({ subject, text, html }, { idempotencyKey } = {}) {
  const to = reportRecipients();
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[admin/reconcile] RESEND_API_KEY is not set; the report was not emailed");
    return { sent: false, to, skipped: "RESEND_API_KEY is not set" };
  }
  const from = process.env.RECONCILE_EMAIL_FROM || DEFAULT_EMAIL_FROM;
  const key = idempotencyKey || `plotwire-reconcile-${createHash("sha256").update(`${subject}\n${text}`).digest("hex").slice(0, 32)}`;
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(RESEND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({ from, to, subject, text, html }),
        signal: AbortSignal.timeout(10000),
      });
      const body = await res.json().catch(() => null);
      if (res.ok) return { sent: true, id: body?.id || null, to };
      lastError = `Resend answered ${res.status}: ${body?.message || body?.name || "no details"}`;
      if (res.status !== 429 && res.status < 500) break;
    } catch (e) {
      lastError = `couldn't reach Resend: ${errorText(e)}`;
    }
    if (attempt === 1) await sleep(1000);
  }
  console.error("[admin/reconcile] the report email wasn't sent:", lastError);
  return { sent: false, to, error: lastError };
}

// ---------------------------------------------------------------------------
// What the route answers
// ---------------------------------------------------------------------------

// p, or a "timed out" error after ms (whatever p does later is ignored).
function withDeadline(p, ms) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timed out after ${ms / 1000} s: Stripe or the database answered too slowly`)),
      ms
    );
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
}

// Run it. sendEmail false: build and return only.
// Returns { status, body }: 200 (sent, or not sent because Resend isn't set
// up), 502 (the email failed), 500 (the check itself couldn't run, or didn't
// finish within deadlineMs; the admin is emailed that it failed).
export async function runReconciliation({ sendEmail = true, now = Date.now(), deadlineMs = BUILD_DEADLINE_MS } = {}) {
  let built;
  try {
    built = await withDeadline(buildReconciliation({ now }), deadlineMs);
  } catch (e) {
    console.error("[admin/reconcile] the check couldn't run:", e);
    const message = errorText(e);
    const mail = sendEmail
      ? await sendReportEmail(formatFailure({ message, mode: stripeKeyMode(process.env.STRIPE_SECRET_KEY), now }))
      : { sent: false, skipped: "email=0" };
    return { status: 500, body: { ok: false, error: message, email: mail } };
  }

  const { report, emails } = built;
  const mail = formatReport(report, { emails });
  const email = sendEmail
    ? await sendReportEmail(mail, { idempotencyKey: `plotwire-reconcile-${report.checkedAt}-${report.mode}` })
    : { sent: false, skipped: "email=0" };
  if (report.issueCount) console.warn(`[admin/reconcile] ${mail.subject}`);

  const body = {
    ok: true,
    clean: report.clean,
    issueCount: report.issueCount,
    subject: mail.subject,
    mode: report.mode,
    production: report.production,
    checkedAt: report.checkedAt,
    counts: report.counts,
    bySection: report.bySection,
    issues: report.issues.map((i) => ({ ...i, account: emails[i.userId] ?? null })),
    notes: report.notes.map((n) => ({ ...n, account: emails[n.userId] ?? null })),
    email,
  };
  return { status: email.error ? 502 : 200, body };
}
