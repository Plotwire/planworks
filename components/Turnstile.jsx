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
//   - Widget failed (script blocked or stalled, Cloudflare error such as
//     110200 "hostname not allowed for this key"): status is "failed", a
//     message under the box says why, and the form is NOT held back -- with
//     CAPTCHA off in Supabase that still works, with it on Supabase refuses
//     and CAPTCHA_MESSAGE explains.
//   - Otherwise forms wait for a token ("ready") before submitting.
// Tokens are single-use: call reset() after every attempt.

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
// A blocker can stall the script instead of failing it; don't wait forever.
const SCRIPT_TIMEOUT_MS = 15000;
let scriptPromise = null;

function loadScript() {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      const fail = (why) => { clearTimeout(timer); scriptPromise = null; s.remove(); reject(new Error(why)); };
      const timer = setTimeout(() => fail("turnstile script timed out"), SCRIPT_TIMEOUT_MS);
      s.src = SCRIPT_SRC;
      s.async = true;
      s.defer = true;
      s.onload = () => {
        clearTimeout(timer);
        window.turnstile ? resolve(window.turnstile) : fail("turnstile missing");
      };
      s.onerror = () => fail("turnstile script failed");
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

// What to tell the person when the check can't run. Never silent: without a
// token, Supabase refuses the request once CAPTCHA is on.
function problemText(code) {
  if (code === "script") {
    return "The security check couldn't load. An ad or tracker blocker may be stopping it: allow challenges.cloudflare.com, then reload the page.";
  }
  if (/^1102/.test(code)) {
    return `The security check isn't set up for this web address (Cloudflare error ${code}).`;
  }
  return `The security check hit a problem (Cloudflare error ${code}). Reload the page to try again.`;
}

// Props: onToken(token|null), onStatus("off"|"pending"|"ready"|"failed").
// The box carries data-status (same values) so it can be checked in DevTools.
const Turnstile = forwardRef(function Turnstile({ onToken, onStatus, action }, ref) {
  const box = useRef(null);
  const widgetId = useRef(null);
  const [status, setStatus] = useState(TURNSTILE_SITE_KEY ? "pending" : "off");
  const [problem, setProblem] = useState(null); // error code, or "script"
  // Latest callbacks without re-rendering the widget when they change.
  const cb = useRef({ onToken, onStatus });
  cb.current = { onToken, onStatus };

  const report = useRef((next, token = null, code = null) => {
    setStatus(next);
    setProblem(next === "failed" ? code : null);
    if (next === "failed") console.warn("[turnstile] security check unavailable:", code);
    cb.current.onToken?.(token);
    cb.current.onStatus?.(next);
  }).current;

  useImperativeHandle(ref, () => ({
    reset() {
      cb.current.onToken?.(null);
      if (widgetId.current != null && window.turnstile) {
        report("pending");
        try { window.turnstile.reset(widgetId.current); } catch {}
      }
    },
  }), [report]);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) { report("off"); return; }
    let cancelled = false;
    report("pending");
    loadScript().then((ts) => {
      if (cancelled || !box.current) return;
      widgetId.current = ts.render(box.current, {
        sitekey: TURNSTILE_SITE_KEY,
        action,
        theme: "light",
        size: "flexible",
        callback: (token) => report("ready", token),
        "expired-callback": () => report("pending"),
        "timeout-callback": () => report("pending"),
        "error-callback": (code) => report("failed", null, String(code || "unknown")),
      });
    }).catch(() => {
      if (!cancelled) report("failed", null, "script");
    });
    return () => {
      cancelled = true;
      if (widgetId.current != null && window.turnstile) {
        try { window.turnstile.remove(widgetId.current); } catch {}
      }
      widgetId.current = null;
    };
  }, [action, report]);

  if (!TURNSTILE_SITE_KEY) return null;
  return (
    <div className="turnstile-wrap" data-status={status} style={{ margin: "4px 0 16px" }}>
      <div ref={box} className="turnstile-box" style={{ minHeight: problem === "script" ? 0 : 65 }} />
      {problem && (
        <p role="alert" style={{ fontSize: 12.5, lineHeight: 1.5, color: "#B45309", marginTop: 6 }}>
          {problemText(problem)}
        </p>
      )}
    </div>
  );
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
