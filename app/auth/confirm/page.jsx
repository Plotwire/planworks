"use client";

// Where the links in Plotwire's account emails land (templates in
// supabase/email-templates/):
//   Confirm your email   https://app.plotwire.uk/auth/confirm?token_hash=...&type=email
//   Reset your password  https://app.plotwire.uk/auth/confirm?token_hash=...&type=recovery
// The emails link straight to the app instead of via the supabase.co address.
// This page checks the link with verifyOtp, which signs the user in, and then
// carries on into the app:
//   - a confirmation lands in the app, where the terms acceptance given at
//     sign-up is recorded;
//   - a password reset lands on "Set a new password": verifyOtp announces it
//     as PASSWORD_RECOVERY, which AppShell turns into that screen.
//
// A public path (components/AppShell.jsx): it must work signed out and past
// the Coming Soon page.

import React, { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { AuthFrame } from "@/components/LoginScreen";

// Link types this page handles, and what it says for each. "email" is
// Supabase's current type for a sign-up confirmation; "signup" is the older
// name for the same thing.
const CONFIRM_EMAIL = {
  working: "Confirming your email…",
  workingNote: "One moment — we're signing you in.",
  expired: "Confirmation links work once and expire after a while. If you've already confirmed your email, just sign in. Otherwise, create your account again to get a new link.",
  // Opened a second time while already signed in: nothing to confirm, carry on.
  continueIfSignedIn: true,
};
const LINK_TYPES = {
  email: CONFIRM_EMAIL,
  signup: CONFIRM_EMAIL,
  recovery: {
    working: "Opening your password reset…",
    workingNote: "One moment.",
    expired: "Password reset links work once and expire after a while. Go to sign in and choose “Forgot password?” to get a new one.",
    // They came to set a new password; don't drop them into the app instead.
    continueIfSignedIn: false,
  },
};

function AuthLink() {
  const router = useRouter();
  const params = useSearchParams();
  const tokenHash = params.get("token_hash");
  const type = params.get("type") || "email";
  const link = LINK_TYPES[type] || CONFIRM_EMAIL;
  const [failed, setFailed] = useState(false);
  const started = useRef(false); // a link works once: never verify it twice

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      if (supabase && tokenHash && LINK_TYPES[type]) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
        if (!error) { router.replace("/"); return; }
        console.warn("account email link failed:", error.message);
      }
      if (link.continueIfSignedIn) {
        const { data } = supabase ? await supabase.auth.getSession() : { data: null };
        if (data?.session) { router.replace("/"); return; }
      }
      setFailed(true);
    })();
  }, [tokenHash, type, link, router]);

  return (
    <AuthFrame>
      <div className="login-card">
        {failed ? (
          <>
            <h1>This link has expired</h1>
            <p className="sub">{link.expired}</p>
            {/* A full page load, not router navigation: AppShell reads ?login=1
                (past the Coming Soon page) from the URL when the page loads. */}
            <button type="button" className="submit" onClick={() => window.location.assign("/?login=1")}>
              Go to sign in
            </button>
          </>
        ) : (
          <>
            <h1>{link.working}</h1>
            <p className="sub">{link.workingNote}</p>
          </>
        )}
      </div>
    </AuthFrame>
  );
}

export default function AuthLinkPage() {
  return (
    <Suspense fallback={null}>
      <AuthLink />
    </Suspense>
  );
}
