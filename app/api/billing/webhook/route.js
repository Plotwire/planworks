import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { beginStripeEvent, finishStripeEvent, handleStripeEvent } from "@/lib/billing";
import { HANDLED_EVENT_TYPES, stripeKeyMode, webhookModeDecision } from "@/lib/stripeWebhook";

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
export async function POST(req) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!secret || !stripeKeyMode(key)) {
    console.error("[billing/webhook] not configured: STRIPE_WEBHOOK_SECRET and an sk_/rk_ STRIPE_SECRET_KEY are both required");
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
    return new NextResponse("Webhook misconfigured", { status: 500 });
  }
  if (!mode.process) {
    console.warn(`[billing/webhook] ignored ${event.type} ${event.id}: ${mode.reason}`);
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
    try {
      await finishStripeEvent(event, { outcome: "failed", error: e }, ledger);
    } catch (e2) {
      console.error("[billing/webhook] couldn't record the failure for", event.id, e2);
    }
    // 500 tells Stripe to retry -- right for a transient Stripe or database error.
    return new NextResponse("Handler error", { status: 500 });
  }

  if (result.outcome === "unmapped") {
    // Acknowledged (a retry can't fix it), but kept in stripe_events for the
    // reconciliation report.
    console.warn("[billing/webhook] no account for", event.type, event.id, "-", result.detail);
  }
  try {
    await finishStripeEvent(event, result, ledger);
  } catch (e) {
    // The row is already right; only the ledger entry is stale. Don't ask
    // Stripe to resend an event that has been applied.
    console.error("[billing/webhook] processed, but couldn't mark", event.id, "as done:", e);
  }
  return NextResponse.json({ received: true, outcome: result.outcome });
}
