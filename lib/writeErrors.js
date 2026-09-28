// Turns a database refusal on a save into a message a user can act on.
//
// Once supabase/try-mode.sql is live and its enforce_billing switch is on:
//   * INSERT and UPDATE on projects, sketches and planner_jobs are refused for
//     lapsed accounts. Postgres reports that as SQLSTATE 42501 ("new row
//     violates row-level security policy"). The app only ever writes the
//     signed-in user's own rows, so that code on a save means the access
//     check failed.
//   * A Try account's drawing save that would pass 25 symbols in total is
//     refused by a trigger with the message TRY_SYMBOL_LIMIT (SQLSTATE P0001).
//   * A Try or lapsed account creating a planner share link: SHARE_LINK_LOCKED.
//
// Reads and deletes are never billing-gated, so only save paths use this.

export const SUBSCRIPTION_INACTIVE_MESSAGE =
  "Your subscription isn't active, so changes can't be saved. " +
  "Your work is safe — you can still open and export it.";

export const TRY_LIMIT_MESSAGE =
  "You've used all your trial symbols. Subscribe to keep going — everything you've drawn is kept.";

export const SHARE_LOCKED_MESSAGE =
  "Share links are part of a Plotwire subscription. Subscribe to share your planner.";

const RLS_VIOLATION = "42501";

export function isSubscriptionRefusal(error) {
  return Boolean(error) && error.code === RLS_VIOLATION;
}

export function isTryLimitRefusal(error) {
  return Boolean(error) && /TRY_SYMBOL_LIMIT/.test(String(error.message || ""));
}

export function isShareLockedRefusal(error) {
  return Boolean(error) && /SHARE_LINK_LOCKED/.test(String(error.message || ""));
}

// Use in place of `throw error` after a Supabase insert/update/upsert.
export function saveError(error) {
  const message = isSubscriptionRefusal(error) ? SUBSCRIPTION_INACTIVE_MESSAGE
    : isTryLimitRefusal(error) ? TRY_LIMIT_MESSAGE
    : isShareLockedRefusal(error) ? SHARE_LOCKED_MESSAGE
    : null;
  if (!message) return error;
  const friendly = new Error(message);
  friendly.code = error.code;
  friendly.cause = error;
  return friendly;
}
