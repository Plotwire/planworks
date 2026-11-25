"use client";

// The dashboard's note for an account whose email address isn't confirmed yet
// (branch signup-straight-in): "Please confirm your email — we've sent a link
// to …", with Resend and Change email. Calm, in the page like the Try note
// (components/HomeScreen.jsx .access-banner), never a pop-up; the cross hides
// it until the browser is closed. Everything else works as normal: only
// subscribing waits for the confirmation (app/api/billing/checkout).
// State and calls: lib/useEmailConfirm.js.

import React, { useState } from "react";
import { X } from "lucide-react";
import { StatusIcon } from "@/components/StatusMark";
import { cleanNewEmail } from "@/lib/emailConfirm";

export default function ConfirmEmailBanner({ confirm }) {
  const [busy, setBusy] = useState("");          // "" | "resend" | "change"
  const [note, setNote] = useState("");          // what just happened
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [newEmail, setNewEmail] = useState("");

  if (!confirm || confirm.status !== "unconfirmed" || confirm.hidden) return null;
  const email = confirm.email;
  const sent = Boolean(confirm.sentAt);

  const resend = async () => {
    setBusy("resend"); setError(""); setNote("");
    try {
      await confirm.resend();
      setNote("Sent. Check your inbox, and your junk folder if it's not there.");
    } catch (e) {
      setError(e?.message || "That didn't work. Try again in a minute.");
    } finally { setBusy(""); }
  };

  const change = async (e) => {
    e?.preventDefault();
    const clean = cleanNewEmail(newEmail, email);
    if (clean.error) { setError(clean.error); return; }
    setBusy("change"); setError(""); setNote("");
    try {
      const r = await confirm.changeEmail(clean.value);
      setEditing(false); setNewEmail("");
      setNote(r?.sendError ? `Changed. ${r.sendError}` : "Changed. Use your new address to sign in from now on.");
    } catch (err) {
      setError(err?.message || "That didn't work. Try again in a minute.");
    } finally { setBusy(""); }
  };

  return (
    <div className="access-banner cb-note" role="status">
      <style>{CSS}</style>
      <div className="cb-text">
        <StatusIcon tone="amber" size={20} />
        <div>
          <strong>Please confirm your email</strong>
          <span>
            {sent
              ? <> &mdash; we&rsquo;ve sent a link to <b className="cb-email">{email}</b>.</>
              : <> (<b className="cb-email">{email}</b>). Press Send link and we&rsquo;ll email you one.</>}
          </span>
          {!sent && confirm.sendError && !note && !error && <span className="cb-msg">{confirm.sendError}</span>}
          {note && <span className="cb-msg">{note}</span>}
          {error && <span className="cb-msg is-error" role="alert">{error}</span>}
          {editing && (
            <form className="cb-form" onSubmit={change}>
              <label className="cb-label" htmlFor="cb-new-email">New email address</label>
              <div className="cb-row">
                <input id="cb-new-email" type="email" autoComplete="email" value={newEmail}
                       onChange={(e) => setNewEmail(e.target.value)} placeholder="you@yourcompany.co.uk" autoFocus />
                <button type="submit" className="mg-primary" disabled={busy === "change"}>{busy === "change" ? "Saving…" : "Save"}</button>
                <button type="button" className="mg-primary" onClick={() => { setEditing(false); setNewEmail(""); setError(""); }} disabled={busy === "change"}>Cancel</button>
              </div>
            </form>
          )}
        </div>
      </div>
      <div className="cb-actions">
        <button type="button" className="mg-primary" onClick={resend} disabled={Boolean(busy)}>
          {busy === "resend" ? "Sending…" : sent ? "Resend" : "Send link"}
        </button>
        {!editing && (
          <button type="button" className="mg-primary" onClick={() => { setEditing(true); setError(""); setNote(""); }} disabled={Boolean(busy)}>
            Change email
          </button>
        )}
        <button type="button" className="cb-close" onClick={confirm.dismiss} aria-label="Hide this note" title="Hide this note">
          <X size={16} strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}

const CSS = `
.pw-home .cb-note{align-items:flex-start}
.pw-home .cb-text{display:flex; gap:12px; align-items:flex-start; flex:1; min-width:260px}
.pw-home .cb-text > svg{margin-top:1px}
.pw-home .cb-email{font-weight:600; color:var(--ink); overflow-wrap:anywhere}
.pw-home .cb-msg{display:block; margin-top:6px; font-size:13px; color:var(--ink-2)}
.pw-home .cb-msg.is-error{color:#B91C1C}
.pw-home .cb-actions{display:flex; gap:8px; align-items:center; flex-wrap:wrap}
.pw-home .cb-close{width:36px; height:36px; border-radius:10px; border:none; display:grid; place-items:center; background:var(--action); color:var(--action-ink); cursor:pointer; transition:background .15s}
.pw-home .cb-close:hover{background:var(--action-hover)}
.pw-home .cb-form{margin-top:10px}
.pw-home .cb-label{display:block; font-size:12.5px; font-weight:500; color:var(--ink-2); margin-bottom:6px}
.pw-home .cb-row{display:flex; gap:8px; flex-wrap:wrap}
.pw-home .cb-row input{flex:1; min-width:200px; height:38px; border-radius:10px; border:1px solid var(--line); background:var(--surface); color:var(--ink); padding:0 12px; font:inherit; font-size:14px; outline:none}
.pw-home .cb-row input:focus{border-color:#3FB7C9; box-shadow:0 0 0 3px rgba(63,183,201,.18)}
`;
