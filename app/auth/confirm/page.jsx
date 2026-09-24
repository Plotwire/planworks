"use client";

// Where the "Confirm your email" link lands:
//   https://app.plotwire.uk/auth/confirm?token_hash=...&type=email
// (template: supabase/email-templates/confirm-signup.html). The email links
// straight to the app instead of via the supabase.co address; this page
// confirms the address with verifyOtp, which signs the user in, and carries
// on into the app -- where the terms acceptance given at sign-up is recorded.
//
// A public path (components/AppShell.jsx): it must work signed out and past
// the Coming Soon page.

import React, { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { AuthFrame } from "@/components/LoginScreen";

// Link types this page confirms. "email" is Supabase's current type for a
// sign-up confirmation; "signup" is the older name for the same thing.
const CONFIRM_TYPES = new Set(["email", "signup"]);

function ConfirmEmail() {
  const router = useRouter();
  const params = useSearchParams();
  const [failed, setFailed] = useState(false);
  const started = useRef(false); // a link works once: never verify it twice

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const tokenHash = params.get("token_hash");
    const type = params.get("type") || "email";
    (async () => {
      if (supabase && tokenHash && CONFIRM_TYPES.has(type)) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
        if (!error) { router.replace("/"); return; }
        console.warn("email confirmation failed:", error.message);
      }
      // Already signed in -- e.g. the link was opened a second time: carry on.
      const { data } = supabase ? await supabase.auth.getSession() : { data: null };
      if (data?.session) { router.replace("/"); return; }
      setFailed(true);
    })();
  }, [params, router]);

  return (
    <AuthFrame>
      <div className="login-card">
        {failed ? (
          <>
            <h1>This link has expired</h1>
            <p className="sub">
              Confirmation links work once and expire after a while. If you've already
              confirmed your email, just sign in. Otherwise, create your account again
              to get a new link.
            </p>
            {/* A full page load, not router navigation: AppShell reads ?login=1
                (past the Coming Soon page) from the URL when the page loads. */}
            <button type="button" className="submit" onClick={() => window.location.assign("/?login=1")}>
              Go to sign in
            </button>
          </>
        ) : (
          <>
            <h1>Confirming your email…</h1>
            <p className="sub">One moment — we're signing you in.</p>
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
