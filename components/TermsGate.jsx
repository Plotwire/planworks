"use client";

import React, { useState } from "react";
import { AuthFrame } from "@/components/LoginScreen";
import TermsCheckboxes from "@/components/TermsCheckboxes";
import { LEGAL_LINKS } from "@/lib/legal";

// Full-screen acceptance page, shown by AppShell after sign-in whenever the
// account has no acceptance record for the current LEGAL_VERSION: existing
// users the first time, and everyone again after a version change. Nothing
// else in the app is reachable from here -- only accepting or logging out.
export default function TermsGate({ user, onAccept, onSignOut, error = "" }) {
  const [agreed, setAgreed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);

  const accept = async (e) => {
    e.preventDefault();
    if (!agreed || !acknowledged || busy) return;
    setBusy(true);
    try { await onAccept(); } finally { setBusy(false); }
  };

  return (
    <AuthFrame>
      <form className="login-card" onSubmit={accept}>
        <h1>Before you continue</h1>
        <p className="sub">
          Please read and accept the{" "}
          <a className="inline-link" href={LEGAL_LINKS.terms} target="_blank" rel="noopener noreferrer">Terms of Service</a>,{" "}
          <a className="inline-link" href={LEGAL_LINKS.privacy} target="_blank" rel="noopener noreferrer">Privacy Policy</a> and{" "}
          <a className="inline-link" href={LEGAL_LINKS.dataProcessing} target="_blank" rel="noopener noreferrer">Data Processing Terms</a>
          {" "}to keep using Plotwire.
        </p>

        <TermsCheckboxes
          agreed={agreed} onAgreedChange={setAgreed}
          acknowledged={acknowledged} onAcknowledgedChange={setAcknowledged}
          disabled={busy}
        />

        {error && <div className="err" role="alert">{error}</div>}

        <button type="submit" className="submit" disabled={!agreed || !acknowledged || busy}>
          {busy ? "Saving…" : "Accept and continue"}
        </button>

        <div className="alt">
          <button type="button" onClick={onSignOut}>
            {user?.email ? `Log out (${user.email})` : "Log out"}
          </button>
        </div>
      </form>
    </AuthFrame>
  );
}
