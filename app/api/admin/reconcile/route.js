import { NextResponse } from "next/server";
import { ALERT_AREA, checkCronAuth, runReconciliation } from "@/lib/billingReconcile";
import { alertError, alertMessage, flushAlerts } from "@/lib/alert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Several Stripe list calls and a few single lookups; 60 s is within every
// Vercel plan's limit. The comparison itself gives up after 35 s
// (BUILD_DEADLINE_MS) so the "check failed" email still goes out in time.
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };
// A missing CRON_SECRET on production means the daily check can't run at all;
// alerted at most once an hour per server instance (anyone can call this
// URL). Vercel runs crons on production deployments only, so a preview
// without it (manual runs only) is logged, not alerted.
const NOT_CONFIGURED_THROTTLE_MS = 60 * 60 * 1000;

// GET /api/admin/reconcile -- the daily billing reconciliation (vercel.json
// runs it every morning). Admin only: Authorization: Bearer $CRON_SECRET,
// which is exactly what Vercel Cron sends when CRON_SECRET is set.
//   ?email=0  build and return the report without emailing it
// Compares Stripe with public.subscriptions (lib/billingReconcile.js,
// lib/reconcile.js), emails the report to RECONCILE_EMAIL_TO (default
// admin@plotwire.uk) and returns it as JSON. Changes nothing.
//   200 { ok, clean, issueCount, issues, notes, email, ... }
//   401 wrong or missing secret   503 CRON_SECRET not set (or too short)
//   500 the check couldn't run or timed out (the admin is emailed that it failed)
//   502 the report was built but the email couldn't be sent
// Environment (Production; Preview only for manual runs -- crons run on
// production deployments only):
//   CRON_SECRET           required, at least 16 characters (openssl rand -hex 32);
//                         unset or shorter = 503 for every call
//   RESEND_API_KEY        to email the report (plotwire.uk verified in Resend);
//                         unset = the report is returned, not emailed
//   RECONCILE_EMAIL_TO    optional, comma-separated (default admin@plotwire.uk)
//   RECONCILE_EMAIL_FROM  optional (default "Plotwire billing <billing@plotwire.uk>")
// It also reads STRIPE_SECRET_KEY (its mode decides which rows are compared;
// a restricted key needs read access to subscriptions, customers, invoices,
// invoice payments, events, webhook endpoints, refunds, charges and, in test
// mode, test clocks), STRIPE_PRICE, VERCEL_ENV, NEXT_PUBLIC_BILLING_ENABLED,
// NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
// Sentry (lib/alert.js, tag area=billing-reconcile): mismatches, a check that
// couldn't run and a failed email (lib/billingReconcile.js), CRON_SECRET
// missing on production, and any error in this route. Flushed before the
// response.
export async function GET(req) {
  let res;
  try {
    res = await respond(req);
  } catch (e) {
    console.error("[admin/reconcile] unexpected error:", e);
    alertError(e, { area: ALERT_AREA, problem: "route-error", title: "Billing reconciliation: unexpected error" });
    res = NextResponse.json({ ok: false, error: "The check failed unexpectedly." }, { status: 500, headers: NO_STORE });
  }
  // Waits only when something was captured (lib/alert.js).
  await flushAlerts();
  return res;
}

async function respond(req) {
  const auth = checkCronAuth(req);
  if (!auth.ok) {
    if (auth.status === 503 && process.env.VERCEL_ENV === "production") {
      alertMessage("Billing reconciliation: CRON_SECRET missing or too short, so the daily check can't run", {
        area: ALERT_AREA,
        problem: "not-configured",
        level: "error",
        throttleMs: NOT_CONFIGURED_THROTTLE_MS,
      });
    }
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }

  const sendEmail = req.nextUrl.searchParams.get("email") !== "0";
  const { status, body } = await runReconciliation({ sendEmail });
  return NextResponse.json(body, { status, headers: NO_STORE });
}
