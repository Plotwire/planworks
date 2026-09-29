"use client";

// Cloudflare Turnstile, the security check on the forms that call Supabase
// auth with a password or send email: sign-in, sign-up, password reset and
// the password re-check before deleting a drawing.
//
// Supabase verifies the token itself (Auth > Bot and Abuse Protection), so the
// app only passes it along as captchaToken. It must work with that setting
// off OR on:
//   - No NEXT_PUBLIC_TURNSTILE_SITE_KEY: nothing renders, status is "off",
//     and forms submit exactly as before.
//   - Widget failed (script blocked, Cloudflare error): status is "failed" and
//     the form is NOT held back -- with CAPTCHA off in Supabase that still
//     works, with it on Supabase refuses and CAPTCHA_MESSAGE explains.
//   - Otherwise forms wait for a token ("ready") before submitting.
// Tokens are single-use: call reset() after every attempt.

import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise = null;

function loadScript() {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SCRIPT_SRC;
      s.async = true;
      s.defer = true;
      s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing")));
      s.onerror = () => { scriptPromise = null; s.remove(); reject(new Error("turnstile script failed")); };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

// Props: onToken(token|null), onStatus("off"|"pending"|"ready"|"failed").
const Turnstile = forwardRef(function Turnstile({ onToken, onStatus, action }, ref) {
  const box = useRef(null);
  const widgetId = useRef(null);
  // Latest callbacks without re-rendering the widget when they change.
  const cb = useRef({ onToken, onStatus });
  cb.current = { onToken, onStatus };

  useImperativeHandle(ref, () => ({
    reset() {
      cb.current.onToken?.(null);
      if (widgetId.current != null && window.turnstile) {
        cb.current.onStatus?.("pending");
        try { window.turnstile.reset(widgetId.current); } catch {}
      }
    },
  }), []);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) { cb.current.onStatus?.("off"); return; }
    let cancelled = false;
    cb.current.onStatus?.("pending");
    loadScript().then((ts) => {
      if (cancelled || !box.current) return;
      widgetId.current = ts.render(box.current, {
        sitekey: TURNSTILE_SITE_KEY,
        action,
        theme: "light",
        size: "flexible",
        callback: (token) => { cb.current.onToken?.(token); cb.current.onStatus?.("ready"); },
        "expired-callback": () => { cb.current.onToken?.(null); cb.current.onStatus?.("pending"); },
        "timeout-callback": () => { cb.current.onToken?.(null); cb.current.onStatus?.("pending"); },
        "error-callback": () => { cb.current.onToken?.(null); cb.current.onStatus?.("failed"); },
      });
    }).catch(() => {
      if (!cancelled) { cb.current.onToken?.(null); cb.current.onStatus?.("failed"); }
    });
    return () => {
      cancelled = true;
      if (widgetId.current != null && window.turnstile) {
        try { window.turnstile.remove(widgetId.current); } catch {}
      }
      widgetId.current = null;
    };
  }, [action]);

  if (!TURNSTILE_SITE_KEY) return null;
  return <div ref={box} className="turnstile-box" style={{ margin: "4px 0 16px", minHeight: 65 }} />;
});

export default Turnstile;

// Supabase's error when CAPTCHA is on and the token is missing, used or bad.
export function isCaptchaError(error) {
  return /captcha/i.test(error?.message || "");
}

export const CAPTCHA_MESSAGE = "The security check didn't go through. Wait for it to finish, then try again.";

// True while the form should wait for the widget before submitting.
export function captchaPending(status) {
  return status === "pending";
}
