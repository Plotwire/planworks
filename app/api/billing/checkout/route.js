import { NextResponse } from "next/server";
import { bearer, userFromToken, STRIPE_PRICE, returnOrigin, beginCheckout } from "@/lib/billing";
import { rateCheck } from "@/lib/checkoutGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The guard looks Stripe up several ways before a session is made
// (lib/billing.js beginCheckout); 30 s is well within every Vercel plan.
export const maxDuration = 30;

// Recent checkout starts per person, on this server instance only
// (lib/checkoutGuard.js rateCheck). A brake on a stuck page or a script, not a
// guarantee: the double-charge guard itself doesn't depend on it.
const recentStarts = new Map();

function allowStart(userId) {
  const nowMs = Date.now();
  const verdict = rateCheck(recentStarts.get(userId), nowMs);
  recentStarts.set(userId, verdict.stamps);
  if (recentStarts.size > 1000) {
    // Forget people with nothing recent, so the map stays small.
    for (const [id, stamps] of recentStarts) {
      if (!rateCheck(stamps, nowMs).stamps.length) recentStarts.delete(id);
    }
  }
  return verdict;
}

// POST /api/billing/checkout (Bearer: the Supabase access token).
//   200 { url }                        a Stripe Checkout page to send the
//                                      browser to
//   200 { url, portal: true, status }  they already have a subscription that
//                                      is running or can still be paid
//                                      (status: its Stripe status): the
//                                      billing portal for it instead, never a
//                                      second checkout
//   409 { error, existing }            the same, but no portal link could be
//                                      made
//   409 { error, inProgress }          another checkout of theirs is being
//                                      paid right now
//   429 { error }                      too many attempts in a minute
//   401 / 400 / 500 { error }
// The browser goes to url either way (lib/billingClient.js).
export async function POST(req) {
  try {
    const user = await userFromToken(bearer(req));
    if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

    const price = STRIPE_PRICE;
    if (!price) return NextResponse.json({ error: "Billing isn't configured yet." }, { status: 400 });

    const allowed = allowStart(user.id);
    if (!allowed.ok) {
      return NextResponse.json(
        { error: "Too many attempts. Wait a minute, then try again." },
        { status: 429, headers: { "Retry-After": String(allowed.retryAfterSec) } }
      );
    }

    const result = await beginCheckout(user, { origin: returnOrigin(req), price });

    if (result.kind === "portal") {
      return NextResponse.json({ url: result.url, portal: true, status: result.status || null });
    }
    if (result.kind === "blocked" && result.reason === "payment-in-progress") {
      return NextResponse.json(
        {
          error: "A payment for Plotwire is already going through. Wait a minute, then refresh — you won’t be charged twice.",
          inProgress: true,
        },
        { status: 409 }
      );
    }
    if (result.kind === "blocked") {
      return NextResponse.json(
        {
          error: "You already have a Plotwire subscription, but we couldn’t open your billing page just now. Try again in a moment.",
          existing: true,
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ url: result.url });
  } catch (e) {
    console.error("[billing/checkout]", e);
    return NextResponse.json({ error: "Could not start checkout. Try again shortly." }, { status: 500 });
  }
}
