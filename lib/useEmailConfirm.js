"use client";

// Whether the signed-in account's email address is confirmed, for the note on
// the dashboard (components/ConfirmEmailBanner.jsx) and the Subscribe screen
// (components/Paywall.jsx). The server decides (app/api/account/email,
// lib/emailConfirmServer.js); this only asks it, and asks again when the
// window comes back into view (they may have clicked the link on their phone).
//
// status: "unknown" (not known yet, no signal, or not set up), "confirmed" or
// "unconfirmed". Nothing is ever blocked on "unknown": the server makes the
// only check that matters, before checkout.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

async function call(body) {
  if (!supabase) throw new Error("This app isn't linked to the cloud yet.");
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Please sign in again.");
  const res = await fetch("/api/account/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  let payload = null;
  try { payload = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || !payload) throw new Error(payload?.error || "Something went wrong. Try again in a minute.");
  return payload;
}

const hiddenKey = (uid) => "plotwire:confirmEmailNoteHidden:" + uid;
const FOCUS_GAP_MS = 5000;

export function useEmailConfirm(session) {
  const uid = session?.user?.id || null;
  const [state, setState] = useState({ uid: null, status: "unknown", email: "", sentAt: null, sendError: null });
  const [hiddenFor, setHiddenFor] = useState(null);
  const lastCheck = useRef(0);

  const check = useCallback(async () => {
    if (!uid) return;
    lastCheck.current = Date.now();
    try {
      const s = await call({ action: "status" });
      const status = s.confirmed ? "confirmed" : s.unavailable ? "unknown" : "unconfirmed";
      setState({ uid, status, email: s.email || "", sentAt: s.sentAt || null, sendError: s.sendError || null });
    } catch { /* no signal or signed out: leave it as it was */ }
  }, [uid]);

  useEffect(() => { check(); }, [check]);

  // Dismissed for this browser session (sessionStorage), per account.
  useEffect(() => {
    if (!uid) return;
    try { setHiddenFor(sessionStorage.getItem(hiddenKey(uid)) ? uid : null); } catch { setHiddenFor(null); }
  }, [uid]);
  const dismiss = useCallback(() => {
    if (!uid) return;
    try { sessionStorage.setItem(hiddenKey(uid), "1"); } catch { /* still hidden until reload */ }
    setHiddenFor(uid);
  }, [uid]);

  const status = state.uid === uid ? state.status : "unknown";

  // Not confirmed yet: ask again whenever the window comes back into view.
  useEffect(() => {
    if (status !== "unconfirmed") return undefined;
    const again = () => {
      if (document.visibilityState === "visible" && Date.now() - lastCheck.current > FOCUS_GAP_MS) check();
    };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => { window.removeEventListener("focus", again); document.removeEventListener("visibilitychange", again); };
  }, [status, check]);

  const resend = useCallback(async () => {
    const r = await call({ action: "resend" });
    setState((s) => (s.uid === uid ? { ...s, sentAt: r.sentAt || new Date().toISOString(), sendError: null } : s));
    return r;
  }, [uid]);

  const changeEmail = useCallback(async (email) => {
    const r = await call({ action: "change", email });
    // The sign-in address has changed: pick that up in this session.
    try { await supabase.auth.refreshSession(); } catch { /* the next refresh will */ }
    setState((s) => (s.uid === uid ? { ...s, status: "unconfirmed", email: r.email, sentAt: r.sentAt || null, sendError: r.sendError || null } : s));
    return r;
  }, [uid]);

  return {
    status,
    email: state.uid === uid ? state.email : "",
    sentAt: state.uid === uid ? state.sentAt : null,
    sendError: state.uid === uid ? state.sendError : null,
    hidden: hiddenFor === uid && Boolean(uid),
    dismiss, resend, changeEmail, refresh: check,
  };
}
