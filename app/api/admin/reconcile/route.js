import { NextResponse } from "next/server";
import { checkCronAuth, runReconciliation } from "@/lib/billingReconcile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Several Stripe list calls and a few single lookups; 60 s is within every
// Vercel plan's limit. The comparison itself gives up after 35 s
// (BUILD_DEADLINE_MS) so the "check failed" email still goes out in time.
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

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
export async function GET(req) {
  const auth = checkCronAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });

  const sendEmail = req.nextUrl.searchParams.get("email") !== "0";
  const { status, body } = await runReconciliation({ sendEmail });
  return NextResponse.json(body, { status, headers: NO_STORE });
}
