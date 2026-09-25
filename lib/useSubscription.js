"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";

// Statuses that unlock the app. past_due is included on purpose — we don't want
// to lock someone out the instant a renewal payment hiccups; Stripe retries and
// the user keeps working while they sort their card via the portal.
const UNLOCKED = new Set(["trialing", "active", "past_due"]);

// Read the caller's own subscription row. RLS guarantees we only ever see our
// own; the webhook (service role) is the only writer. We select * and read
// fields defensively so a column rename on the backend can't crash the gate —
// only `status` is load-bearing for access.
async function fetchRow() {
  if (!supabase) return null;
  // One row per user (webhook upserts on user_id), so a plain limit(1) is enough
  // and avoids depending on any particular column name for ordering.
  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

export function useSubscription(session) {
  const enabled = Boolean(session && supabase);
  const [loading, setLoading] = useState(enabled);
  const [sub, setSub] = useState(null);
  const [error, setError] = useState(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (!enabled) { setLoading(false); setSub(null); return null; }
    try {
      const row = await fetchRow();
      if (mounted.current) { setSub(row); setError(null); }
      return row;
    } catch (e) {
      if (mounted.current) setError(e);
      return null;
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    mounted.current = true;
    if (!enabled) { setLoading(false); setSub(null); return; }
    setLoading(true);
    refresh();

    // Live updates when Stripe's webhook writes a new status (e.g. trial → active,
    // or a cancellation). Wrapped so it silently no-ops if realtime isn't enabled
    // on the table — focus refetch below still keeps things current.
    let channel = null;
    try {
      const uid = session?.user?.id;
      channel = supabase
        .channel(`subscriptions:${uid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "subscriptions", filter: uid ? `user_id=eq.${uid}` : undefined },
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
      document.removeEventListener("visibilitychange", onVisible);
      try { channel && supabase.removeChannel(channel); } catch {}
    };
  }, [enabled, session?.user?.id, refresh]);

  const status = sub?.status || null;

  return {
    loading,
    error,
    sub,
    status,
    plan: sub?.plan || null,                       // "standard" (set by webhook)
    isActive: UNLOCKED.has(status),
    cancelAtPeriodEnd: Boolean(sub?.cancel_at_period_end || sub?.cancel_at),
    // When a scheduled cancellation takes effect. cancel_at is the exact date;
    // rows written before that column existed fall back to the period end.
    cancelAt: sub?.cancel_at || (sub?.cancel_at_period_end ? sub?.current_period_end || null : null),
    currentPeriodEnd: sub?.current_period_end || null,
    trialEnd: sub?.trial_end || null,
    refresh,
  };
}
