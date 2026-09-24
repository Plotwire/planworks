import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { bearer, userFromToken, STRIPE_PRICE, APP_URL, TRIAL_DAYS, LIVE_STATUSES } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const user = await userFromToken(bearer(req));
    if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

    const price = STRIPE_PRICE;
    if (!price) return NextResponse.json({ error: "Billing isn't configured yet." }, { status: 400 });

    const admin = getSupabaseAdmin();
    const stripe = getStripe();

    const { data: existing, error: readError } = await admin
      .from("subscriptions")
      .select("stripe_customer_id, status")
      .eq("user_id", user.id)
      .limit(1);
    if (readError) throw readError;
    const current = existing?.[0] || null;

    // Never start a second subscription for someone who already has a live one.
    if (current && LIVE_STATUSES.has(current.status)) {
      return NextResponse.json(
        { error: "You already have an active subscription. Use Manage billing to change it." },
        { status: 409 }
      );
    }

    // Reuse an existing Stripe customer if this user has subscribed before.
    const customerId = current?.stripe_customer_id || null;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      ...(customerId ? { customer: customerId } : { customer_email: user.email }),
      client_reference_id: user.id,
      line_items: [{ price, quantity: 1 }],
      allow_promotion_codes: true,
      subscription_data: {
        trial_period_days: TRIAL_DAYS,
        metadata: { user_id: user.id },
      },
      success_url: `${APP_URL}/?checkout=success`,
      cancel_url: `${APP_URL}/?checkout=cancelled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error("[billing/checkout]", e);
    return NextResponse.json({ error: "Could not start checkout. Try again shortly." }, { status: 500 });
  }
}
