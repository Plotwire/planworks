import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { beginStripeEvent, finishStripeEvent, handleStripeEvent } from "@/lib/billing";
import { HANDLED_EVENT_TYPES, stripeKeyMode, webhookModeDecision } from "@/lib/stripeWebhook";
import { alertError, alertMessage, flushAlerts } from "@/lib/alert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One event can take a few sequential Stripe and database round trips (see
// lib/billing.js syncSubscription). 60 s is within every Vercel plan's limit.
export const maxDuration = 60;

// Stripe -> Plotwire. Order of checks:
//   1. Configured? No webhook secret or no usable Stripe key -> 500 (fail
//      closed; Stripe keeps retrying until it's fixed).
//   2. Signature, on the raw body -> 400 if missing or wrong.
//   3. Mode: production acts on live events only, and every deployment ignores
//      test events whose mode doesn't match its key (lib/stripeWebhook.js)
//      -> 200. A LIVE event at a deployment with a test key is a
//      misconfiguration -> 500, so Stripe keeps retrying it until it's fixed.
//   4. Not one of the handled event types -> 200.
//   5. Already processed (public.stripe_events) -> 200, nothing changes.
//   6. Re-fetch from Stripe and update the row (lib/billing.js). A failure
//      worth retrying -> 500 and the error is recorded against the event.
//
// Sentry (lib/alert.js, tag area=billing-webhook; the alert rule emails
// admin@plotwire.uk): every 500 (but "not configured" only where billing is
// switched on -- anyone can post here, and billing is deliberately off on
// production until go-live and on most previews), a failed signature check,
// a test-mode event reaching production (warning), an event with no Plotwire
// account (warning), and a test-mode subscription kept off a live-mode row
// (warning). Signature failures are two Sentry issues, each at most one event
// per 10 minutes per server instance: "signature-mismatch" (error) when the
// header looks like a real Stripe delivery -- fresh timestamp and a v1
// signature -- which is what every event looks like when
// STRIPE_WEBHOOK_SECRET doesn't match the Stripe endpoint, and
// "bad-signature" (warning) for a missing, malformed or stale header, i.e.
// junk. So junk can't hide a real secret mismatch inside an issue that is
// already open. Only the event's id, type and livemode go with an alert,
// never its contents (customer emails, names and card details live there).
// Anything captured is flushed before the response.
const AREA = "billing-webhook";
const MINUTE = 60 * 1000;
const SIGNATURE_THROTTLE_MS = 10 * MINUTE;
const CONFIG_THROTTLE_MS = 10 * MINUTE;
// Stripe's default signature tolerance (stripe-node Webhook.DEFAULT_TOLERANCE).
const SIGNATURE_TOLERANCE_S = 300;
// lib/stripeWebhook.js replaceDecision's reason when it keeps a test-mode
// subscription off a live-mode row (previews and production share the
// database).
const TEST_OVER_LIVE = /test-mode subscription never replaces a live-mode row/;

// What Sentry may know about an event: ids and types only.
function eventExtra(event) {
  return { eventId: event?.id ?? null, eventType: event?.type ?? null, livemode: event?.livemode === true };
}

// True when a stripe-signature header is shaped like a real Stripe delivery:
// a timestamp within Stripe's tolerance of now and at least one v1 HMAC-SHA256
// (64 hex characters). It failed verification, so it was signed with a
// different secret (or the body was altered on the way).
function looksLikeStripeDelivery(sig) {
  if (typeof sig !== "string") return false;
  let timestamp = null;
  let v1 = false;
  for (const item of sig.split(",")) {
    const [k, v = ""] = item.trim().split("=");
    if (k === "t" && /^\d{9,11}$/.test(v)) timestamp = Number(v);
    if (k === "v1" && /^[0-9a-f]{64}$/i.test(v)) v1 = true;
  }
  if (timestamp === null || !v1) return false;
  return Math.abs(Math.floor(Date.now() / 1000) - timestamp) <= SIGNATURE_TOLERANCE_S;
}

function alertTags(event) {
  const tags = { stripe_mode: stripeKeyMode(process.env.STRIPE_SECRET_KEY) || "none" };
  if (event) {
    tags.livemode = String(event.livemode === true);
    tags.event_type = event.type;
  }
  return tags;
}

export async function POST(req) {
  let res;
  try {
    res = await receive(req);
  } catch (e) {
    // Every expected failure is answered inside receive(); this is the net
    // under it (e.g. the request body couldn't be read).
    console.error("[billing/webhook] unexpected error:", e);
    alertError(e, { area: AREA, problem: "unexpected-error", title: "Billing webhook: unexpected error", tags: alertTags(null) });
    res = new NextResponse("Handler error", { status: 500 });
  }
  // Waits only when something was captured above (lib/alert.js).
  await flushAlerts();
  return res;
}

async function receive(req) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!secret || !stripeKeyMode(key)) {
    console.error("[billing/webhook] not configured: STRIPE_WEBHOOK_SECRET and an sk_/rk_ STRIPE_SECRET_KEY are both required");
    // Alerted only where billing is switched on: anyone can post here, and a
    // deployment with billing deliberately off (production before go-live,
    // most previews) has nothing to fix.
    if (process.env.NEXT_PUBLIC_BILLING_ENABLED === "true") {
      alertMessage("Billing webhook: not configured (STRIPE_WEBHOOK_SECRET / STRIPE_SECRET_KEY)", {
        area: AREA,
        problem: "not-configured",
        level: "error",
        tags: alertTags(null),
        extra: { webhookSecretSet: Boolean(secret), stripeKeyUsable: Boolean(stripeKeyMode(key)) },
        throttleMs: CONFIG_THROTTLE_MS,
      });
    }
    return new NextResponse("Webhook not configured", { status: 500 });
  }

  const sig = req.headers.get("stripe-signature");
  // The raw body is required for signature verification -- do not parse as JSON.
  const body = await req.text();

  let event;
  try {
    if (!sig) throw new Error("no stripe-signature header");
    event = getStripe().webhooks.constructEvent(body, sig, secret);
  } catch (e) {
    console.error("[billing/webhook] bad signature:", e.message);
    const extra = { signatureHeader: Boolean(sig), reason: String(e?.message || e).slice(0, 300) };
    if (looksLikeStripeDelivery(sig)) {
      // Shaped like a real Stripe delivery but signed with another secret:
      // if these keep coming, STRIPE_WEBHOOK_SECRET doesn't match the Stripe
      // endpoint and no payment event is being applied. Its own Sentry issue,
      // so an open "bad-signature" issue full of junk can't swallow it.
      alertMessage("Billing webhook: Stripe signature doesn't match STRIPE_WEBHOOK_SECRET", {
        area: AREA,
        problem: "signature-mismatch",
        level: "error",
        tags: alertTags(null),
        extra,
        throttleMs: SIGNATURE_THROTTLE_MS,
      });
    } else {
      // Missing, malformed or stale header: almost always junk from the
      // internet. A warning.
      alertMessage("Billing webhook: signature check failed", {
        area: AREA,
        problem: "bad-signature",
        level: "warning",
        tags: alertTags(null),
        extra,
        throttleMs: SIGNATURE_THROTTLE_MS,
      });
    }
    return new NextResponse("Invalid signature", { status: 400 });
  }

  const mode = webhookModeDecision({
    eventLivemode: event.livemode,
    secretKey: key,
    vercelEnv: process.env.VERCEL_ENV,
  });
  if (mode.misconfigured) {
    // A real payment event this deployment can't act on (live webhook secret,
    // test STRIPE_SECRET_KEY). Not 200: Stripe would mark it delivered and
    // never send it again.
    console.error(`[billing/webhook] misconfigured: ${event.type} ${event.id}: ${mode.reason}. Set the live STRIPE_SECRET_KEY; Stripe retries for up to 3 days.`);
    alertMessage("Billing webhook: live event at a deployment with a test Stripe key", {
      area: AREA,
      problem: "misconfigured",
      level: "error",
      tags: alertTags(event),
      extra: { ...eventExtra(event), reason: mode.reason },
      throttleMs: CONFIG_THROTTLE_MS,
    });
    return new NextResponse("Webhook misconfigured", { status: 500 });
  }
  if (!mode.process) {
    console.warn(`[billing/webhook] ignored ${event.type} ${event.id}: ${mode.reason}`);
    if (mode.production) {
      // Production only acts on live events. A test event that passed the
      // signature check means a Stripe test endpoint points here with this
      // deployment's secret, or production runs on a test key.
      alertMessage("Billing webhook: test-mode event ignored in production", {
        area: AREA,
        problem: "test-event-in-production",
        level: "warning",
        tags: alertTags(event),
        extra: { ...eventExtra(event), reason: mode.reason },
        throttleMs: CONFIG_THROTTLE_MS,
      });
    }
    return NextResponse.json({ received: true, ignored: mode.reason });
  }

  if (!HANDLED_EVENT_TYPES.has(event.type)) {
    return NextResponse.json({ received: true, ignored: "unhandled event type" });
  }

  let ledger;
  try {
    ledger = await beginStripeEvent(event);
  } catch (e) {
    console.error("[billing/webhook] couldn't record event", event.id, e);
    alertError(e, {
      area: AREA,
      problem: "ledger-error",
      title: "Billing webhook: couldn't record the event",
      tags: alertTags(event),
      extra: eventExtra(event),
    });
    return new NextResponse("Handler error", { status: 500 });
  }
  if (ledger.duplicate) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  let result;
  try {
    result = await handleStripeEvent(event);
  } catch (e) {
    console.error("[billing/webhook] handler error:", event.type, event.id, e);
    let failureRecorded = ledger.tracked === true;
    try {
      await finishStripeEvent(event, { outcome: "failed", error: e }, ledger);
    } catch (e2) {
      failureRecorded = false;
      console.error("[billing/webhook] couldn't record the failure for", event.id, e2);
    }
    alertError(e, {
      area: AREA,
      problem: "handler-error",
      title: `Billing webhook: ${event.type} failed`,
      tags: alertTags(event),
      extra: { ...eventExtra(event), failureRecorded, attempt: ledger.attempts ?? null },
    });
    // 500 tells Stripe to retry -- right for a transient Stripe or database error.
    return new NextResponse("Handler error", { status: 500 });
  }

  if (result.outcome === "unmapped") {
    // Acknowledged (a retry can't fix it), but kept in stripe_events for the
    // reconciliation report.
    console.warn("[billing/webhook] no account for", event.type, event.id, "-", result.detail);
    alertMessage("Billing webhook: Stripe event with no Plotwire account", {
      area: AREA,
      problem: "unmapped",
      level: "warning",
      tags: alertTags(event),
      extra: { ...eventExtra(event), reasonIn: "public.stripe_events.error and the daily reconciliation report" },
    });
  } else if (result.outcome === "skipped" && TEST_OVER_LIVE.test(String(result.detail || ""))) {
    alertMessage("Billing webhook: test-mode subscription kept off a live account", {
      area: AREA,
      problem: "test-over-live",
      level: "warning",
      tags: alertTags(event),
      extra: eventExtra(event),
    });
  }
  try {
    await finishStripeEvent(event, result, ledger);
  } catch (e) {
    // The row is already right; only the ledger entry is stale. Don't ask
    // Stripe to resend an event that has been applied.
    console.error("[billing/webhook] processed, but couldn't mark", event.id, "as done:", e);
    alertError(e, {
      area: AREA,
      problem: "ledger-not-marked",
      level: "warning",
      title: "Billing webhook: processed, but couldn't mark the event as done",
      tags: alertTags(event),
      extra: eventExtra(event),
    });
  }
  return NextResponse.json({ received: true, outcome: result.outcome });
}
