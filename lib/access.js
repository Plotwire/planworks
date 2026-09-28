// ============================================================================
// Access levels -- the browser's copy of public.access_level() in
// supabase/try-mode.sql. The database is what enforces them; this decides what
// the app shows.
//
//   full   : billing_exempt, or a live subscription (active, trialing,
//            past_due -- past_due so a failed renewal doesn't cut anyone off
//            mid-job while Stripe retries).
//   try    : never paid. No subscription row, or only an abandoned or failed
//            first checkout. Up to TRY_SYMBOL_LIMIT symbols, watermarked, no
//            exports.
//   lapsed : had a real subscription that has ended. Read-only.
// ============================================================================

export const FULL_STATUSES = new Set(["active", "trialing", "past_due"]);
// A first checkout that never completed: that account has never paid.
const NEVER_PAID_STATUSES = new Set(["incomplete", "incomplete_expired"]);

export function accessLevel({ status, exempt } = {}) {
  if (exempt) return "full";
  if (status && FULL_STATUSES.has(status)) return "full";
  if (status && !NEVER_PAID_STATUSES.has(status)) return "lapsed";
  return "try";
}
