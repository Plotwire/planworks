"use client";

// Thin client wrappers around the billing API routes.
// The endpoints expect a Supabase access token as a Bearer header; checkout and
// portal return a Stripe-hosted URL we send the browser to. Keeping the fetch/redirect logic
// here means the UI components stay declarative.

import { supabase } from "@/lib/supabase";

async function authedPost(path, body, { needUrl = true } = {}) {
  if (!supabase) throw new Error("This app isn't linked to the cloud yet.");

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Your session has expired — sign in again.");

  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body || {}),
  });

  let payload = null;
  try { payload = await res.json(); } catch { /* non-JSON error body */ }

  if (!res.ok || !payload || (needUrl && !payload.url)) {
    throw new Error(payload?.error || "Something went wrong reaching billing. Try again in a moment.");
  }
  return payload;
}

// Start a Stripe Checkout session for the subscription and hand the browser
// over. The server decides where: Stripe Checkout, or -- when this account
// already has a subscription that is running or can still be paid -- the
// billing portal for it instead (portal: true, status: that subscription's
// Stripe status), so nobody pays twice.
// Resolves once the browser is on its way, with { portal, status }.
export async function startCheckout() {
  const { url, portal, status } = await authedPost("/api/billing/checkout", {});
  window.location.assign(url);
  return { portal: Boolean(portal), status: typeof status === "string" ? status : null };
}

// Back from Checkout and still not unlocked: ask the server to check with
// Stripe and bring this account's subscription up to date (in case the webhook
// is late or lost). Grants nothing by itself -- the server asks Stripe -- and
// never charges anything. Resolves { found, changed }; throws when the check
// couldn't be made (the caller just keeps waiting).
export async function syncSubscriptionFromStripe() {
  const r = await authedPost("/api/billing/sync", {}, { needUrl: false });
  return { found: r.found === true, changed: r.changed === true };
}

// Open the Stripe Customer Portal so the user can change plan, update card,
// or cancel. Returns them to the app afterwards (return URL set server-side).
export async function openBillingPortal() {
  const { url } = await authedPost("/api/billing/portal", {});
  window.location.assign(url);
}
