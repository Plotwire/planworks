// Turns a database refusal on a save into a message a user can act on.
//
// Once supabase/paywall-policies.sql is live, INSERT and UPDATE on projects,
// sketches and planner_jobs require an active subscription at the database level. Postgres
// reports a refused write as SQLSTATE 42501 ("new row violates row-level
// security policy"). The app only ever writes the signed-in user's own rows,
// so in practice that code on a save means the subscription check failed.
//
// Reads and deletes are never subscription-gated, so only save paths use this.

export const SUBSCRIPTION_INACTIVE_MESSAGE =
  "Your subscription isn't active, so changes can't be saved. " +
  "Your work is safe — you can still open and export it.";

const RLS_VIOLATION = "42501";

export function isSubscriptionRefusal(error) {
  return Boolean(error) && error.code === RLS_VIOLATION;
}

// Use in place of `throw error` after a Supabase insert/update/upsert.
export function saveError(error) {
  if (!isSubscriptionRefusal(error)) return error;
  const friendly = new Error(SUBSCRIPTION_INACTIVE_MESSAGE);
  friendly.code = error.code;
  friendly.cause = error;
  return friendly;
}
