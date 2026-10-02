// ============================================================================
// Access levels -- ONE rule. It lives in the database (supabase/try-mode.sql:
// public.access_level() and public.subscription_access_level()), which
// enforces it; the app SHOWS the level the database returns from my_access()
// (lib/useSubscription.js via appAccess() below). This file is the documented
// copy of that rule for the browser: it is used only while my_access() isn't
// installed (try-mode.sql not run yet) and by the tests that prove the two
// agree. Change the rule in BOTH places, or not at all.
//
//   full   : billing_exempt; or a subscription that is active or trialing; or
//            past_due for at most PAST_DUE_GRACE_DAYS after the failed payment
//            (payment_failed_at, from Stripe's failed invoice). A past_due row
//            without payment_failed_at (written before billing-hardening.sql)
//            counts from the start of the unpaid month: current_period_end
//            minus one month, because Stripe moves the period on at renewal
//            before it charges.
//   lapsed : had a real subscription (any status but incomplete /
//            incomplete_expired) that isn't full: canceled, unpaid, paused,
//            past_due beyond the grace. Read-only.
//   try    : never paid. No subscription row, or only an abandoned or failed
//            first checkout (incomplete, incomplete_expired). Up to
//            TRY_SYMBOL_LIMIT symbols, watermarked, no exports.
//
// Which row counts: only a LIVE-mode Stripe subscription (livemode true),
// except for billing_test_accounts, whose test-mode rows count too. Previews
// and production share one database, so a test card on a preview must never
// unlock a real account. A row that doesn't count is ignored (Try).
//
// PURE: no imports, no I/O. Server and browser can both use it.
// ============================================================================

// Days a past_due subscription keeps full access after the failed payment.
// Must match public.past_due_grace_days() in supabase/try-mode.sql.
export const PAST_DUE_GRACE_DAYS = 7;

export const ACCESS_LEVELS = Object.freeze(["full", "try", "lapsed"]);

const DAY_MS = 24 * 60 * 60 * 1000;
const FULL_STATUSES = new Set(["active", "trialing"]);
// A first checkout that never completed: that account has never paid.
const NEVER_PAID_STATUSES = new Set(["incomplete", "incomplete_expired"]);

export function isAccessLevel(v) {
  return ACCESS_LEVELS.includes(v);
}

// Milliseconds from an ISO/Postgres timestamp, a Date or a number of ms.
export function toMs(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const ms = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

// One calendar month earlier, in UTC, the way Postgres subtracts
// interval '1 month' (a day that doesn't exist in that month becomes its last
// day: 31 March -> 28/29 February).
export function oneMonthEarlier(ms) {
  const d = new Date(ms);
  const m = d.getUTCMonth();
  const y = d.getUTCFullYear() - (m === 0 ? 1 : 0);
  const tm = m === 0 ? 11 : m - 1;
  const last = new Date(Date.UTC(y, tm + 1, 0)).getUTCDate();
  return Date.UTC(y, tm, Math.min(d.getUTCDate(), last),
    d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
}

// When a past_due subscription's full access ends (ms), or null when the
// status isn't past_due or neither date is known.
// Same as public.past_due_grace_until().
export function pastDueGraceUntil({ status, paymentFailedAt, currentPeriodEnd } = {}) {
  if (status !== "past_due") return null;
  let from = toMs(paymentFailedAt);
  if (from === null) {
    const end = toMs(currentPeriodEnd);
    if (end === null) return null;
    from = oneMonthEarlier(end);
  }
  return from + PAST_DUE_GRACE_DAYS * DAY_MS;
}

// The level ONE subscriptions row gives at the moment `now` (ms or Date).
// Same as public.subscription_access_level().
export function subscriptionLevel({ status, paymentFailedAt, currentPeriodEnd, now = Date.now() } = {}) {
  if (!status || NEVER_PAID_STATUSES.has(status)) return "try";
  if (FULL_STATUSES.has(status)) return "full";
  if (status === "past_due") {
    const until = pastDueGraceUntil({ status, paymentFailedAt, currentPeriodEnd });
    if (until !== null && toMs(now) <= until) return "full";
  }
  return "lapsed";
}

// Does this subscriptions row count? Same as public.counted_subscriptions().
export function rowCounts(row, { testAccount = false } = {}) {
  return Boolean(row) && (row.livemode === true || testAccount === true);
}

// An account's level: exempt, else what its counted row gives, else Try.
// Same as public.access_level(). row: a subscriptions row as the table has it.
export function accessLevel({ exempt = false, testAccount = false, row = null, now = Date.now() } = {}) {
  if (exempt) return "full";
  if (!rowCounts(row, { testAccount })) return "try";
  return subscriptionLevel({
    status: row.status,
    paymentFailedAt: row.payment_failed_at,
    currentPeriodEnd: row.current_period_end,
    now,
  });
}

// ---------------------------------------------------------------------------
// What the app shows
// ---------------------------------------------------------------------------

// From one successful read of the account's own subscriptions row and
// my_access():
//   access : my_access() -- the DATABASE's answer, used as it is -- or null
//            when that function isn't installed yet (try-mode.sql not run).
//            Then this file's copy of the rule decides, from the row alone
//            (no billing_exempt or test accounts exist without that SQL).
//   row    : the account's own subscriptions row, or null.
// Returns { level, row: the row if it counts (else null), source, graceUntil
// (ms, past_due only) }.
export function appAccess({ access = null, row = null, now = Date.now() } = {}) {
  if (access && isAccessLevel(access.level)) {
    return {
      level: access.level,
      row: row && access.row_counts === true ? row : null,
      source: "database",
      graceUntil: toMs(access.grace_until),
    };
  }
  const counted = rowCounts(row) ? row : null;
  return {
    level: accessLevel({ row: counted, now }),
    row: counted,
    source: "rule-copy",
    graceUntil: counted
      ? pastDueGraceUntil({ status: counted.status, paymentFailedAt: counted.payment_failed_at, currentPeriodEnd: counted.current_period_end })
      : null,
  };
}

// Display only (it decides nothing): a lapsed account whose subscription is
// still running but unpaid -- past_due beyond the grace, or unpaid. Its
// drawings are read-only until the invoice is paid (Terms 4.6); it hasn't
// ended, so it is told to pay in Billing, not to re-subscribe.
const PAYMENT_OWED_STATUSES = new Set(["past_due", "unpaid"]);
export function isPaymentOverdue(level, status) {
  return level === "lapsed" && PAYMENT_OWED_STATUSES.has(status);
}

// After a failed check: wait 1 s, 2 s, 4 s, 8 s, 16 s, then every 30 s.
export function accessRetryDelay(failures) {
  const n = Math.max(1, Number(failures) || 1);
  return Math.min(30000, 1000 * Math.pow(2, n - 1));
}

// Failed checks in a row, with nothing known yet, before the app stops showing
// a plain splash and says it couldn't check (it keeps retrying). It never
// falls back to Try: that would show a paying or exempt account the Try
// limits because of a network blip.
export const ACCESS_FAILURES_BEFORE_NOTICE = 3;
