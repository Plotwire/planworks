"use client";

// Waiting for Stripe's webhook after Checkout sends someone back. The rules
// and timings are in lib/checkoutReturn.js; this hook runs them.
//
//   const r = useCheckoutReturn({ enabled, userId, ready, full, refresh, sync });
//   r.begin()          ?checkout=success was in the URL (AppShell strips it)
//   r.phase            "none" | "confirming" | "pending" (| transient ones)
//   r.canContinue      the "Continue to Plotwire" button may show
//   r.continueNow()    carry on into the app; keep checking in the background
//   r.checkAgain()     ask the server to check with Stripe, then refresh (the
//                      "Check again" button)
//   r.forget()         drop the return (a deliberate sign-out)
//   r.awaitingSignIn   a return is remembered but nobody is signed in
//   r.showPendingBanner / r.dismissPending()
//   r.showConfirmedNote / r.dismissConfirmed()
//
// enabled: billing is switched on (NEXT_PUBLIC_BILLING_ENABLED). Off, this
// does nothing at all.
// refresh: re-read the subscription row. sync (optional): ask the server to
// bring the row up to date from Stripe (lib/billingClient.js
// syncSubscriptionFromStripe), at the points in checkoutReturn.SYNC_AT_MS.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CONTINUE_AFTER_MS,
  SLOW_POLL_MS,
  clearReturn,
  pollDelay,
  readReturn,
  returnPhase,
  saveReturn,
  syncsDue,
} from "@/lib/checkoutReturn";

function tabStorage() {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function useCheckoutReturn({ enabled, userId, ready, full, refresh, sync }) {
  const [rec, setRec] = useState(null); // { at, uid, continued } while waiting
  const [now, setNow] = useState(() => Date.now());
  const [bannerHidden, setBannerHidden] = useState(false);
  const [confirmedNote, setConfirmedNote] = useState(false);
  const [checking, setChecking] = useState(false);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const syncRef = useRef(sync);
  syncRef.current = sync;

  // A return remembered from before a reload of this tab. One too old to be
  // about this visit is dropped here, signed in or not (so it can't keep
  // sending a signed-out tab to sign-in).
  useEffect(() => {
    if (!enabled) return;
    const r = readReturn(tabStorage());
    if (!r) return;
    const t = Date.now();
    if (returnPhase({ at: r.at, now: t }) === "expired") {
      clearReturn(tabStorage());
      return;
    }
    setRec(r);
    setNow(t);
  }, [enabled]);

  const begin = useCallback(() => {
    if (!enabled) return;
    const r = { at: Date.now(), uid: null, continued: false };
    saveReturn(tabStorage(), r);
    setRec(r);
    setNow(r.at);
    setBannerHidden(false);
    setConfirmedNote(false);
  }, [enabled]);

  // Tie the return to the account signed in when it is first seen; a
  // different account on this tab drops it.
  useEffect(() => {
    if (!rec || !userId) return;
    if (!rec.uid) {
      const r = { ...rec, uid: userId };
      saveReturn(tabStorage(), r);
      setRec(r);
    } else if (rec.uid !== userId) {
      clearReturn(tabStorage());
      setRec(null);
    }
  }, [rec, userId]);

  // (uid not bound yet counts: the effect above binds it on this render.)
  const mine = Boolean(enabled && rec && userId && (!rec.uid || rec.uid === userId));
  const phase = mine
    ? returnPhase({ at: rec.at, now, ready, full, continued: rec.continued })
    : "none";

  // Unlocked: done. Too old to be about this visit: dropped.
  useEffect(() => {
    if (phase === "confirmed") {
      clearReturn(tabStorage());
      setRec(null);
      setConfirmedNote(true);
    } else if (phase === "expired") {
      clearReturn(tabStorage());
      setRec(null);
    }
  }, [phase]);

  // The "Payment confirmed" note goes by itself.
  useEffect(() => {
    if (!confirmedNote) return;
    const t = setTimeout(() => setConfirmedNote(false), 8000);
    return () => clearTimeout(t);
  }, [confirmedNote]);

  // A clock while confirming: shows "Continue" after CONTINUE_AFTER_MS and
  // ends the window on time even if a refresh is slow.
  useEffect(() => {
    if (phase !== "confirming") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // Poll the subscription row: backoff while confirming, then every 30 s.
  // (Realtime and focus refreshes in lib/useSubscription.js run as well.)
  // At the SYNC_AT_MS points the server is first asked to check with Stripe.
  const waiting = phase === "confirming" || phase === "pending";
  const startedAt = rec?.at ?? null;
  useEffect(() => {
    if (!waiting || startedAt === null) return;
    let stopped = false;
    let timer = null;
    let attempt = 0;
    let synced = 0;
    const tick = async () => {
      if (stopped) return;
      const due = syncsDue(Date.now() - startedAt);
      if (due > synced) {
        synced = due;
        try { await syncRef.current?.(); } catch { /* the refresh below still runs */ }
        if (stopped) return;
      }
      try { await refreshRef.current?.(); } catch { /* next tick */ }
      if (stopped) return;
      const t = Date.now();
      setNow(t);
      attempt += 1;
      const inWindow = returnPhase({ at: startedAt, now: t, ready: false }) === "confirming";
      timer = setTimeout(tick, inWindow ? pollDelay(attempt) : SLOW_POLL_MS);
    };
    timer = setTimeout(tick, pollDelay(0));
    return () => { stopped = true; clearTimeout(timer); };
  }, [waiting, startedAt]);

  const continueNow = useCallback(() => {
    setRec((r) => {
      if (!r) return r;
      const next = { ...r, continued: true };
      saveReturn(tabStorage(), next);
      return next;
    });
  }, []);

  // A deliberate sign-out: forget the return, so the next visit to this tab
  // isn't sent to sign-in for it (and nothing resumes for the next account).
  const forget = useCallback(() => {
    clearReturn(tabStorage());
    setRec(null);
    setBannerHidden(false);
    setConfirmedNote(false);
  }, []);

  const checkAgain = useCallback(async () => {
    setChecking(true);
    try {
      try { await syncRef.current?.(); } catch { /* still re-read the row */ }
      await refreshRef.current?.();
    } catch { /* shown as still pending */ }
    finally { setChecking(false); setNow(Date.now()); }
  }, []);

  return {
    phase,
    confirming: phase === "confirming",
    pending: phase === "pending",
    canContinue: phase === "confirming" && rec !== null && now - rec.at >= CONTINUE_AFTER_MS,
    // (rec is only ever a recent return: an old one is dropped on load.)
    awaitingSignIn: Boolean(enabled && rec && !userId),
    showPendingBanner: phase === "pending" && !bannerHidden,
    showConfirmedNote: confirmedNote,
    checking,
    begin,
    continueNow,
    checkAgain,
    forget,
    dismissPending: () => setBannerHidden(true),
    dismissConfirmed: () => setConfirmedNote(false),
  };
}
