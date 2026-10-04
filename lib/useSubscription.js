"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";

import { appAccess, accessRetryDelay, ACCESS_FAILURES_BEFORE_NOTICE, isAccessLevel } from "@/lib/access";

// ============================================================================
// The signed-in account's access level, AS THE DATABASE DECIDES IT.
//
// my_access() (supabase/try-mode.sql) returns the level the database
// enforces -- billing_exempt, live-mode subscriptions only, the 7-day past_due
// grace -- and the app shows exactly that. lib/access.js has the same rule
// written out, used only until that SQL is installed (appAccess there).
//
// A failed check never makes anyone Try: that would show a paying or exempt
// account the Try limits because of a network blip. Instead
//   * before anything is known: `loading` stays true (the app shows its
//     splash) and the check is retried (1 s, 2 s, 4 s ... then every 30 s);
//     after ACCESS_FAILURES_BEFORE_NOTICE failures `failed` is set so the app
//     can say it couldn't check;
//   * once something is known: the last known level is kept and the check is
//     retried in the background.
// Saves are checked by the database whatever the app shows.
// ============================================================================

// PostgREST / Postgres "no such function": my_access() isn't installed yet.
const MISSING_FUNCTION = new Set(["PGRST202", "42883"]);

// The database's answer: { installed: true, access } or { installed: false }.
// Throws on any other failure (network, auth, an answer without a level).
async function fetchAccess() {
  const { data, error } = await supabase.rpc("my_access");
  if (error) {
    if (MISSING_FUNCTION.has(error.code)) return { installed: false, access: null };
    throw error;
  }
  if (!data || !isAccessLevel(data.level)) throw new Error("my_access() returned no access level");
  return { installed: true, access: data };
}

// The caller's own subscription row. RLS guarantees we only ever see our own;
// the webhook (service role) is the only writer. Select * and read fields
// defensively, so a column added on the backend can't break the app.
async function fetchRow() {
  // One row per user (the webhook upserts on user_id), so limit(1) is enough.
  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

// Said once per page load: the app is enforcing billing but the database
// isn't, so the Try/Lapsed limits are only in the browser.
let warnedNotEnforced = false;

// setTimeout can't wait longer than this (about 24.8 days).
const MAX_TIMER_MS = 2 ** 31 - 1;
// Grace end, device clock ahead of the database's: look again this often, for
// at most this long after the grace end (see the grace effect below).
const GRACE_RECHECK_MS = 30 * 1000;
const GRACE_SKEW_MS = 10 * 60 * 1000;

export function useSubscription(session) {
  const uid = session?.user?.id || null;
  const enabled = Boolean(uid && supabase);
  // The last good check: { uid, access, row, installed }. Kept through failed
  // checks; dropped when the account changes.
  const [snap, setSnap] = useState(null);
  const [error, setError] = useState(null);
  const [failures, setFailures] = useState(0);
  const mounted = useRef(true);
  const uidRef = useRef(uid);
  uidRef.current = uid;
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const seqRef = useRef(0);      // checks started
  const appliedRef = useRef(0);  // newest check whose result is shown
  const failRef = useRef(0);
  const retryTimer = useRef(null);

  const refresh = useCallback(async () => {
    const forUid = uidRef.current;
    if (!enabled || !forUid) return null;
    const seq = ++seqRef.current;
    clearTimeout(retryTimer.current);
    const [rowRes, accRes] = await Promise.allSettled([fetchRow(), fetchAccess()]);
    // Unmounted, signed out / another account since, or a newer check has
    // already landed: this answer is out of date.
    if (!mounted.current || forUid !== uidRef.current || seq < appliedRef.current) {
      return snapRef.current?.row ?? null;
    }
    const prev = snapRef.current && snapRef.current.uid === forUid ? snapRef.current : null;
    let next = null;
    if (accRes.status === "fulfilled" && accRes.value.installed) {
      // The database's answer decides. The row is only for dates and the
      // Billing button: if it failed this time, keep the last one.
      next = {
        uid: forUid,
        installed: true,
        access: accRes.value.access,
        row: rowRes.status === "fulfilled" ? rowRes.value : (prev ? prev.row : null),
      };
    } else if (accRes.status === "fulfilled" && rowRes.status === "fulfilled") {
      // my_access() not installed yet: lib/access.js decides from the row.
      next = { uid: forUid, installed: false, access: null, row: rowRes.value };
    }
    const failed = rowRes.status === "rejected" ? rowRes.reason : accRes.status === "rejected" ? accRes.reason : null;
    if (next) {
      appliedRef.current = seq;
      setSnap(next);
      snapRef.current = next;
    }
    if (failed) {
      // Keep whatever is known; try again shortly.
      failRef.current += 1;
      setFailures(failRef.current);
      setError(failed);
      clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => { refresh(); }, accessRetryDelay(failRef.current));
    } else {
      failRef.current = 0;
      setFailures(0);
      setError(null);
    }
    return (next || prev)?.row ?? null;
  }, [enabled]);

  useEffect(() => {
    mounted.current = true;
    // A different account (or none): forget everything about the last one.
    setSnap(null);
    snapRef.current = null;
    setError(null);
    failRef.current = 0;
    setFailures(0);
    appliedRef.current = seqRef.current;
    if (!enabled) return () => { mounted.current = false; };
    refresh();

    // Live updates when Stripe's webhook writes a new status (e.g. trial → active,
    // or a cancellation). Wrapped so it silently no-ops if realtime isn't enabled
    // on the table — focus refetch below still keeps things current.
    let channel = null;
    try {
      channel = supabase
        .channel(`subscriptions:${uid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "subscriptions", filter: `user_id=eq.${uid}` },
          () => refresh()
        )
        .subscribe();
    } catch { /* realtime not enabled — fine */ }

    // Re-check when the tab regains focus (covers returning from the Stripe
    // portal in the same tab).
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      mounted.current = false;
      clearTimeout(retryTimer.current);
      document.removeEventListener("visibilitychange", onVisible);
      try { channel && supabase.removeChannel(channel); } catch {}
    };
  }, [enabled, uid, refresh]);

  const known = enabled && snap && snap.uid === uid ? snap : null;
  // "full" | "try" | "lapsed" (lib/access.js), null until first known.
  const view = known ? appAccess({ access: known.access, row: known.row }) : null;
  const level = view ? view.level : null;
  const graceUntil = view ? view.graceUntil : null;

  // past_due: look again the moment the grace ends, so the app turns
  // read-only on time without a reload (the database already refuses saves).
  // The wait is timed on this device's clock. If that runs ahead of the
  // database's, the look at grace end still says full: look again every
  // GRACE_RECHECK_MS (each answer is a new `known`, so this re-runs) for up to
  // GRACE_SKEW_MS after the grace end, until the database agrees. Not for a
  // grace that ended long ago with the level still full (an exempt account's
  // old past_due row): nothing will change there, so no polling.
  useEffect(() => {
    if (!enabled || level !== "full" || graceUntil === null) return;
    let wait = graceUntil - Date.now() + 1000;
    if (wait <= 0) {
      if (Date.now() - graceUntil > GRACE_SKEW_MS) return;
      wait = GRACE_RECHECK_MS;
    }
    const t = setTimeout(() => refresh(), Math.min(wait, MAX_TIMER_MS));
    return () => clearTimeout(t);
  }, [enabled, level, graceUntil, refresh, known]);

  const enforced = known?.installed ? known.access.enforced === true : false;
  useEffect(() => {
    if (!known || warnedNotEnforced) return;
    if (!known.installed || !enforced) {
      warnedNotEnforced = true;
      console.warn(
        "[billing] The app is enforcing billing but the database isn't (" +
          (known.installed ? "app_flags.enforce_billing is false" : "supabase/try-mode.sql isn't installed") +
          "): Try and Lapsed limits are only in the browser."
      );
    }
  }, [known, enforced]);

  const sub = view ? view.row : null;
  return {
    // True until the first check succeeds (the app shows its splash). Never
    // ends in "try" because a check failed.
    loading: enabled && !known,
    // Several checks in a row failed and nothing is known yet.
    failed: enabled && !known && failures >= ACCESS_FAILURES_BEFORE_NOTICE,
    error,
    sub,
    status: sub?.status || null,
    exempt: known?.installed ? known.access.exempt === true : false,
    level,
    // Where the level came from: "database" (my_access) or "rule-copy"
    // (lib/access.js, until try-mode.sql is installed).
    source: view ? view.source : null,
    // Is the database enforcing billing (app_flags.enforce_billing)?
    enforced,
    // past_due: when full access ends (ms), else null.
    graceUntil,
    plan: sub?.plan || null,                       // "standard" (set by webhook)
    isActive: level === "full",
    cancelAtPeriodEnd: Boolean(sub?.cancel_at_period_end || sub?.cancel_at),
    // When a scheduled cancellation takes effect. cancel_at is the exact date;
    // rows written before that column existed fall back to the period end.
    cancelAt: sub?.cancel_at || (sub?.cancel_at_period_end ? sub?.current_period_end || null : null),
    currentPeriodEnd: sub?.current_period_end || null,
    trialEnd: sub?.trial_end || null,
    refresh,
  };
}
