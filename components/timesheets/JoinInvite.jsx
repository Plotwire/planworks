"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ExternalLink } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { StatusIcon } from "@/components/StatusMark";
import { WORKER_CSS } from "@/components/timesheets/WorkerWeek";
import { checkInvite, acceptInvite } from "@/lib/timesheets/team";
import {
  JOIN_PATH, SIGN_IN_PATH, PASSWORD_MIN, isInviteCode, joinProblem, passwordProblem, chromeIntentFor,
} from "@/lib/timesheets/invites";
import { detectInAppBrowser, canOpenInChrome } from "@/lib/inAppBrowser";

// The page an invite email's link opens (/time/join?invite=<code>). The
// worker taps Continue, sets a password, and lands on their week. No Coming
// Soon page, terms or customer set-up: this page is outside those
// (components/AppShell.jsx PUBLIC_PATHS), and a worker's login never sees them.
//
// Opening the page doesn't use the invite up (email scanners open links);
// only Continue does. The code is kept for this tab and taken out of the
// address bar. In Instagram, Facebook or Messenger on Android, an "Open in
// Chrome" button carries the same link over (lib/inAppBrowser.js).

const KEEP = "plotwire-invite";

export default function JoinInvite() {
  const router = useRouter();
  const [code, setCode] = useState(null);
  const [step, setStep] = useState("checking");   // checking | ready | joining | password | saving | problem | failed
  const [info, setInfo] = useState(null);          // { name, email, company }
  const [problem, setProblem] = useState(null);    // { title, text, signIn }
  const [otherLogin, setOtherLogin] = useState(""); // someone else signed in on this device
  const [inApp, setInApp] = useState(null);
  const [origin, setOrigin] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { document.title = "Join your team — Plotwire"; }, []);

  // Read the code once, keep it for this tab, take it out of the address bar.
  useEffect(() => {
    let found = null;
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("invite");
      if (isInviteCode(fromUrl)) { found = fromUrl; sessionStorage.setItem(KEEP, fromUrl); }
      else found = sessionStorage.getItem(KEEP);
    } catch { /* storage blocked: the code from the address still works */ }
    setInApp(detectInAppBrowser(navigator.userAgent, window.location.search));
    setOrigin(window.location.origin);
    // Only the code comes out of the address (?inapp= stays, for testing).
    const rest = new URLSearchParams(window.location.search);
    if (rest.has("invite")) {
      rest.delete("invite");
      window.history.replaceState(null, "", rest.toString() ? `${JOIN_PATH}?${rest}` : JOIN_PATH);
    }
    if (isInviteCode(found)) setCode(found);
    else { setProblem(joinProblem("invalid")); setStep("problem"); }
  }, []);

  const check = async (c) => {
    setStep("checking");
    setError("");
    try {
      const [res, session] = await Promise.all([checkInvite(c), supabase?.auth.getSession()]);
      if (res.state !== "ok") { setProblem(joinProblem(res.state, res.company)); setStep("problem"); return; }
      const signedIn = session?.data?.session?.user?.email || "";
      setOtherLogin(signedIn && signedIn.toLowerCase() !== String(res.email).toLowerCase() ? signedIn : "");
      setInfo(res);
      setStep("ready");
    } catch (e) {
      setError(e.message);
      setStep("failed");
    }
  };
  useEffect(() => { if (code) check(code); }, [code]);

  const accept = async () => {
    setStep("joining");
    setError("");
    try {
      const res = await acceptInvite(code);
      const { error: signInError } = await supabase.auth.verifyOtp({ token_hash: res.token_hash, type: "magiclink" });
      if (signInError) throw new Error("You're on the team, but signing in didn't work. Go to sign in and use \"Forgot password\".");
      try { sessionStorage.removeItem(KEEP); } catch { /* nothing kept */ }
      setStep("password");
    } catch (e) {
      if (e.body?.state) { setProblem(joinProblem(e.body.state, e.body.company || info?.company)); setStep("problem"); return; }
      setError(e.message);
      setStep("ready");
    }
  };

  const savePassword = async (ev) => {
    ev.preventDefault();
    const bad = passwordProblem(password);
    if (bad) { setError(bad); return; }
    setStep("saving");
    setError("");
    const { error: e } = (await supabase.auth.updateUser({ password })) || {};
    if (e) {
      setError(/weak|pwned|known|guess/i.test(e.message || "") ? "That password is too easy to guess. Try a longer one."
        : /at least|characters/i.test(e.message || "") ? e.message
        : "Couldn't save your password. Check your signal and try again.");
      setStep("password");
      return;
    }
    router.replace(SIGN_IN_PATH);
  };

  const company = info?.company || "";
  const signInAddress = origin ? `${origin.replace(/^https?:\/\//, "")}${SIGN_IN_PATH}` : "";

  return (
    <div className="pw-tsw">
      <style>{WORKER_CSS}</style>
      <header className="tsw-top">
        <span className="tsw-brandmark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><path d="M13 2 4 13h6l-1 9 9-11h-6l1-9z" fill="#08313a"/></svg>
        </span>
        <div className="tsw-who">
          <div className="tsw-name">Timesheets</div>
          <div className="tsw-company">{company || "Plotwire"}</div>
        </div>
      </header>

      <main className="tsw-main">
        {step === "checking" ? (
          <div className="tsw-card tsw-loading" aria-label="Loading">Checking your invite…</div>
        ) : step === "failed" ? (
          <div className="tsw-card tsw-message" role="alert">
            <StatusIcon tone="red" size={28} />
            <h2>Couldn&rsquo;t check your invite</h2>
            <p>{error || "Check your signal and try again."}</p>
            <button type="button" className="tsw-btn is-wide" onClick={() => check(code)}>Try again</button>
          </div>
        ) : step === "problem" ? (
          <div className="tsw-card tsw-message">
            <StatusIcon tone="amber" size={28} />
            <h2>{problem.title}</h2>
            <p>{problem.text}</p>
            {problem.signIn && (
              <button type="button" className="tsw-btn is-wide" onClick={() => router.push(SIGN_IN_PATH)}>Sign in</button>
            )}
          </div>
        ) : step === "ready" || step === "joining" ? (
          <section className="tsw-card tsw-join">
            <h1>{company ? `${company} has invited you` : "You've been invited"}</h1>
            <p>
              Record the hours you work and the jobs you work on, from your phone.
              You&rsquo;ll sign in as <b>{info.email}</b>.
            </p>
            {canOpenInChrome(inApp) && origin && code && (
              <a className="tsw-open-chrome" href={chromeIntentFor(`${origin}${JOIN_PATH}?invite=${code}`)}>
                <ExternalLink size={16} strokeWidth={2.2} /><span>Open in Chrome</span>
              </a>
            )}
            {otherLogin && (
              <p className="tsw-join-note">You&rsquo;re signed in as <b>{otherLogin}</b> on this device. Continuing signs that account out here.</p>
            )}
            {error && <p className="tsw-error" role="alert">{error}</p>}
            <button type="button" className="tsw-btn is-wide is-submit" onClick={accept} disabled={step === "joining"}>
              {step === "joining" ? "Setting you up…" : "Continue"}
            </button>
          </section>
        ) : (
          <form className="tsw-card tsw-join" onSubmit={savePassword} noValidate>
            <h1>Set your password</h1>
            <p>You&rsquo;ll use it with <b>{info?.email}</b> to sign in next time.</p>
            <label>
              Password (at least {PASSWORD_MIN} characters)
              <span className="tsw-pw-row">
                <input type={show ? "text" : "password"} value={password} autoComplete="new-password" autoFocus
                       onChange={(e) => { setPassword(e.target.value); if (error) setError(""); }} />
                <button type="button" className="tsw-icon-btn" onClick={() => setShow((s) => !s)}
                        aria-label={show ? "Hide password" : "Show password"} title={show ? "Hide password" : "Show password"}>
                  {show ? <EyeOff strokeWidth={2} /> : <Eye strokeWidth={2} />}
                </button>
              </span>
            </label>
            {error && <p className="tsw-error" role="alert">{error}</p>}
            <button type="submit" className="tsw-btn is-wide is-submit" disabled={step === "saving"}>
              {step === "saving" ? "Saving…" : "Save and open my timesheet"}
            </button>
            {inApp && signInAddress && (
              <p className="tsw-tip">
                Tip: you&rsquo;re in {inApp.app}&rsquo;s own browser. Next time, open <b>{signInAddress}</b> in
                Chrome or Safari and sign in there.
              </p>
            )}
          </form>
        )}
      </main>
    </div>
  );
}
