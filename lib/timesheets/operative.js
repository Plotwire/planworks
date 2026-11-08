// Is this login a Timesheets operative?
//
// The marker lives in app_metadata, which only the server can set. A signed-in
// person can change their own user_metadata, so that is never looked at.
//
// The marker only picks the screen and turns the login away from owner-only
// routes. What an operative can read and write is decided by the database
// (supabase/timesheets.sql), whatever this says.

export const OPERATIVE_HOME = "/time";

export const NOT_FOR_OPERATIVES = "Billing isn't available on this login.";

export function isOperativeUser(user) {
  return user?.app_metadata?.plotwire_kind === "operative";
}
