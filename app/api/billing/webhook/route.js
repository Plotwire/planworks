import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { upsertSubscription } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  // The raw body is required for signature verification — do not parse as JSON.
  const body = await req.text();

  let event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, secret);
  } catch (e) {
    console.error("[billing/webhook] bad signature:", e.message);
    return new NextResponse("Invalid signature", { status: 400 });
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        // Stripe doesn't guarantee event order, so the payload may be stale by
        // the time it arrives. Re-fetch and use the subscription as it is NOW.
        const sub = await getStripe().subscriptions.retrieve(event.data.object.id);
        const userId = sub.metadata?.user_id;
        // user_id is stamped onto the subscription at checkout. Without it we
        // can't map back to an account, so we ack (200) and move on rather than
        // make Stripe retry forever.
        if (userId) {
          const written = await upsertSubscription(sub, { userId, customerId: sub.customer });
          if (!written) {
            console.warn("[billing/webhook] kept the stored subscription; ignored non-live", sub.id, sub.status);
          }
        } else {
          console.warn("[billing/webhook] subscription with no user_id metadata:", sub.id);
        }
        break;
      }
      default:
        break;
    }
  } catch (e) {
    console.error("[billing/webhook] handler error:", e);
    // 500 tells Stripe to retry — appropriate for a transient DB error.
    return new NextResponse("Handler error", { status: 500 });
  }

  return NextResponse.json({ received: true });
}
