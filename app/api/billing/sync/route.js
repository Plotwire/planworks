import { NextResponse } from "next/server";
import { bearer, userFromToken, refreshFromStripe } from "@/lib/billing";
import { rateCheck } from "@/lib/checkoutGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The same Stripe lookups as the checkout guard (lib/billing.js).
export const maxDuration = 30;

// A brake per person, on this server instance only (lib/checkoutGuard.js
// rateCheck). The app calls this a couple of times after a return from Stripe
// and on "Check again"; each call asks Stripe several things.
const SYNC_RATE_LIMIT = 6;
const recentSyncs = new Map();

function allowSync(userId) {
  const nowMs = Date.now();
  const verdict = rateCheck(recentSyncs.get(userId), nowMs, { limit: SYNC_RATE_LIMIT });
  recentSyncs.set(userId, verdict.stamps);
  if (recentSyncs.size > 1000) {
    for (const [id, stamps] of recentSyncs) {
      if (!rateCheck(stamps, nowMs, { limit: SYNC_RATE_LIMIT }).stamps.length) recentSyncs.delete(id);
    }
  }
  return verdict;
}

// POST /api/billing/sync (Bearer: the Supabase access token).
// Back from Stripe Checkout and the webhook hasn't landed (late, or lost): the
// caller's own subscriptions row is brought up to date from Stripe
// (lib/billing.js refreshFromStripe). Stripe is asked; nothing the browser
// sends is trusted, and nothing else is changed.
//   200 { found, changed, status }  found: Stripe has a running subscription
//                                   of theirs; changed: the row was updated
//   401 / 429 / 500 { error }
export async function POST(req) {
  try {
    const user = await userFromToken(bearer(req));
    if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

    const allowed = allowSync(user.id);
    if (!allowed.ok) {
      return NextResponse.json(
        { error: "Too many attempts. Wait a minute, then try again." },
        { status: 429, headers: { "Retry-After": String(allowed.retryAfterSec) } }
      );
    }

    const r = await refreshFromStripe(user);
    return NextResponse.json({ found: r.found, changed: r.changed, status: r.status || null });
  } catch (e) {
    console.error("[billing/sync]", e);
    return NextResponse.json({ error: "Couldn't check with Stripe just now. Try again shortly." }, { status: 500 });
  }
}
