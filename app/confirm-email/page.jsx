"use client";

// Where the link in a Plotwire confirmation email lands
// (lib/emailConfirm.js confirmationEmail):
//   https://app.plotwire.uk/confirm-email?code=...
// It works in any browser, signed in or not (a phone's mail app, Instagram's
// built-in browser, another computer): it only marks the address confirmed
// (app/api/account/confirm-email), so the account can subscribe. It doesn't
// sign anyone in.
//
// A public path (components/AppShell.jsx): no sign-in and no Coming Soon page.

import React, { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthFrame } from "@/components/LoginScreen";
import { linkPage } from "@/lib/emailConfirm";

function ConfirmEmail() {
  const params = useSearchParams();
  const code = params.get("code") || "";
  const [state, setState] = useState("working");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const res = await fetch("/api/account/confirm-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const body = await res.json().catch(() => null);
        setState(body?.state || "failed");
      } catch {
        setState("failed");
      }
    })();
  }, [code]);

  const page = state === "working" ? null : linkPage(state);

  return (
    <AuthFrame>
      <div className="login-card">
        {!page ? (
          <>
            <h1>Confirming your email…</h1>
            <p className="sub">One moment.</p>
          </>
        ) : (
          <>
            {page.ok && (
              <div className="check-badge" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none"><path d="M4 13l5 5L20 7" stroke="#22808F" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
            )}
            <h1>{page.title}</h1>
            <p className="sub">{page.text}</p>
            {/* A full page load: the app checks the sign-in and the address afresh. */}
            <button type="button" className="submit" onClick={() => window.location.assign("/?login=1")}>
              Go to Plotwire
            </button>
          </>
        )}
      </div>
    </AuthFrame>
  );
}

export default function ConfirmEmailPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmEmail />
    </Suspense>
  );
}
