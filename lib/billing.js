import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
export { TRIAL_DAYS } from "@/lib/pricing";

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

// Statuses that count as a live, paid-up (or trialling) subscription.
export const LIVE_STATUSES = new Set(["active", "trialing"]);

// Upsert our subscriptions row from a Stripe Subscription object.
//
// There is one row per user. If that row already tracks a DIFFERENT Stripe
// subscription, it is only replaced when the incoming one is live -- so a
// cancelled or stale subscription can never overwrite an active one. Returns
// false when the update was skipped for that reason.
export async function upsertSubscription(sub, { userId, customerId } = {}) {
  const admin = getSupabaseAdmin();

  const { data: existing, error: readError } = await admin
    .from("subscriptions")
    .select("stripe_subscription_id")
    .eq("user_id", userId)
    .limit(1);
  if (readError) throw readError;
  const storedId = existing?.[0]?.stripe_subscription_id || null;
  if (storedId && storedId !== sub.id && !LIVE_STATUSES.has(sub.status)) {
    return false;
  }

  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id || null;
  // Current Stripe API versions put the billing period on the subscription
  // item; older ones had it on the subscription itself.
  const periodEnd = item?.current_period_end ?? sub.current_period_end ?? null;
  const row = {
    user_id: userId,
    stripe_customer_id: customerId || sub.customer || null,
    stripe_subscription_id: sub.id,
    status: sub.status,
    plan: planForPrice(priceId),
    price_id: priceId,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin
    .from("subscriptions")
    .upsert(row, { onConflict: "user_id" });
  if (error) throw error;
  return true;
}
