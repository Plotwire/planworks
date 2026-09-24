"use client";

import React, { useState } from "react";
import { supabase, isConfigured } from "@/lib/supabase";
import TermsCheckboxes from "@/components/TermsCheckboxes";
import { LEGAL_LINKS } from "@/lib/legal";
import { signupTermsMetadata } from "@/lib/termsAcceptance";

export default function LoginScreen({ recovery = false, onRecovered }) {
  const [mode, setMode] = useState("signin"); // "signin" | "signup" | "forgot"
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");        // email we just messaged
  const [sentKind, setSentKind] = useState("");    // "confirm" | "reset"
  const [resetDone, setResetDone] = useState(false);
  // Sign-up acknowledgements: both start unticked and both are required.
  const [agreed, setAgreed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const consentGiven = agreed && acknowledged;

  const switchMode = (m) => {
    setMode(m);
    setError(""); setSentTo(""); setSentKind("");
    setPassword(""); setConfirm("");
    setAgreed(false); setAcknowledged(false);
  };

  const signIn = async (e) => {
    e?.preventDefault();
    if (!isConfigured) { setError("This app isn't linked to the cloud yet."); return; }
    setBusy(true); setError("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.message || "Couldn't sign in. Check your email and password.");
  };

  const signUp = async (e) => {
    e?.preventDefault();
    if (!isConfigured) { setError("This app isn't linked to the cloud yet."); return; }
    if (!name.trim()) { setError("Please tell us your name."); return; }
    if (password.length < 8) { setError("Use a password of at least 8 characters."); return; }
    if (password !== confirm) { setError("Those two passwords don't match."); return; }
    if (!consentGiven) { setError("Please tick both boxes to create your account."); return; }
    setBusy(true); setError("");
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        // The acceptance rides in the account's metadata: with email
        // confirmation on there is no session yet to record it with, so the
        // record is written on first sign-in (see lib/termsAcceptance.js).
        data: { name: name.trim(), ...signupTermsMetadata() },
        emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
      },
    });
    setBusy(false);
    if (error) { setError(error.message || "Couldn't create your account."); return; }
    if (data?.user && !data?.session) { setSentTo(email.trim()); setSentKind("confirm"); return; }
    // confirmation off -> session live; AppShell takes over.
  };

  const sendReset = async (e) => {
    e?.preventDefault();
    if (!isConfigured) { setError("This app isn't linked to the cloud yet."); return; }
    if (!email.trim()) { setError("Enter the email address for your account."); return; }
    setBusy(true); setError("");
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
    });
    setBusy(false);
    if (error) { setError(error.message || "Couldn't send the reset email."); return; }
    setSentTo(email.trim()); setSentKind("reset");
  };

  const setNewPassword = async (e) => {
    e?.preventDefault();
    if (password.length < 8) { setError("Use a password of at least 8 characters."); return; }
    if (password !== confirm) { setError("Those two passwords don't match."); return; }
    setBusy(true); setError("");
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) { setError(error.message || "Couldn't update your password. The link may have expired — request a new one."); return; }
    setResetDone(true);
  };

  // ---- Recovery: user arrived via the reset link, set a new password ----
  if (recovery) {
    return (
      <AuthFrame>
        {resetDone ? (
          <div className="login-card">
            <div className="check-badge" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none"><path d="M4 13l5 5L20 7" stroke="#22808F" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <h1>Password updated</h1>
            <p className="sub">You're all set. Carry on into Plotwire.</p>
            <button type="button" className="submit" onClick={() => onRecovered?.()}>
              Continue to Plotwire
            </button>
          </div>
        ) : (
          <form className="login-card" onSubmit={setNewPassword}>
            <h1>Set a new password</h1>
            <p className="sub">Choose a new password for your account.</p>

            <label className="field">
              <span>New password</span>
              <input type="password" autoComplete="new-password" value={password}
                     onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required/>
            </label>
            <label className="field">
              <span>Confirm new password</span>
              <input type="password" autoComplete="new-password" value={confirm}
                     onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" required/>
            </label>

            {error && <div className="err">{error}</div>}

            <button type="submit" className="submit" disabled={busy}>
              {busy ? "Saving…" : "Save new password"}
            </button>
          </form>
        )}
      </AuthFrame>
    );
  }

  // ---- Emailed confirmation / reset-sent state ----
  if (sentTo) {
    const isReset = sentKind === "reset";
    return (
      <AuthFrame>
        <div className="login-card">
          <div className="check-badge" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none"><path d="M4 13l5 5L20 7" stroke="#22808F" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <h1>Check your email</h1>
          {isReset ? (
            <p className="sub">We've sent a password-reset link to <b>{sentTo}</b>. Open it to choose a new password.</p>
          ) : (
            <p className="sub">
              We've sent you a confirmation email. If it's not in your inbox, check your junk folder.
              <span className="sent-to">Sent to <b>{sentTo}</b></span>
            </p>
          )}
          <button type="button" className="submit" onClick={() => switchMode("signin")}>
            Back to sign in
          </button>
          {isReset && <p className="note">No email after a minute? Check your junk folder, or try again.</p>}
        </div>
      </AuthFrame>
    );
  }

  // ---- Normal logged-out flow: signin / signup / forgot ----
  const onSubmit = mode === "signin" ? signIn : mode === "signup" ? signUp : sendReset;

  return (
    <AuthFrame>
      <form className="login-card" onSubmit={onSubmit}>
        <h1>
          {mode === "signin" ? "Sign in" : mode === "signup" ? "Create your account" : "Reset your password"}
        </h1>
        <p className="sub">
          {mode === "signin" ? "Welcome back. Your drawings are saved to your account."
            : mode === "signup" ? "Set up Plotwire for your business — it takes a few seconds."
            : "Enter your account email and we'll send you a link to set a new password."}
        </p>

        {mode === "signup" && (
          <label className="field">
            <span>Your name</span>
            <input type="text" autoComplete="name" value={name}
                   onChange={(e) => setName(e.target.value)} placeholder="Jane Smith" required/>
          </label>
        )}

        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="username" value={email}
                 onChange={(e) => setEmail(e.target.value)} placeholder="you@yourcompany.co.uk" required/>
        </label>

        {mode !== "forgot" && (
          <label className="field">
            <span>Password</span>
            <input type="password"
                   autoComplete={mode === "signin" ? "current-password" : "new-password"}
                   value={password}
                   onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required/>
          </label>
        )}

        {mode === "signin" && (
          <div className="link-row">
            <button type="button" className="linkish" onClick={() => switchMode("forgot")}>
              Forgot password?
            </button>
          </div>
        )}

        {mode === "signup" && (
          <label className="field">
            <span>Confirm password</span>
            <input type="password" autoComplete="new-password" value={confirm}
                   onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" required/>
          </label>
        )}

        {mode === "signup" && (
          <TermsCheckboxes
            agreed={agreed} onAgreedChange={setAgreed}
            acknowledged={acknowledged} onAcknowledgedChange={setAcknowledged}
            disabled={busy}
          />
        )}

        {error && <div className="err">{error}</div>}

        <button type="submit" className="submit" disabled={busy || (mode === "signup" && !consentGiven)}>
          {busy
            ? (mode === "signin" ? "Signing in…" : mode === "signup" ? "Creating account…" : "Sending…")
            : (mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link")}
        </button>

        <div className="alt">
          {mode === "signin" && (
            <>New to Plotwire?{" "}
              <button type="button" onClick={() => switchMode("signup")}>Create an account</button>
            </>
          )}
          {mode === "signup" && (
            <>Already have an account?{" "}
              <button type="button" onClick={() => switchMode("signin")}>Sign in</button>
            </>
          )}
          {mode === "forgot" && (
            <button type="button" onClick={() => switchMode("signin")}>Back to sign in</button>
          )}
        </div>

        {!isConfigured && (
          <div className="note">The cloud connection isn't set up yet — check the environment variables.</div>
        )}

        <div className="legal-foot">
          <a href={LEGAL_LINKS.terms} target="_blank" rel="noopener noreferrer">Terms of Service</a>
          <span aria-hidden> · </span>
          <a href={LEGAL_LINKS.privacy} target="_blank" rel="noopener noreferrer">Privacy Policy</a>
        </div>
      </form>
    </AuthFrame>
  );
}

// The sign-in page layout (brand rail + card), shared with the terms acceptance
// page (components/TermsGate.jsx).
export function AuthFrame({ children }) {
  return (
    <div className="login-root">
      <style>{CSS}</style>
      <div className="login-rail">
        <div className="brandmark">
          <svg viewBox="0 0 24 24" fill="none"><path d="M13 2 4 13h6l-1 9 9-11h-6l1-9z" fill="#08313a"/></svg>
        </div>
        <div className="wordmark">Plot<b>wire</b></div>
        <p className="tag">Electrical layouts, quotes &amp; bills of quantities — drawn in minutes.</p>
        <div className="rail-foot">Plotwire</div>
      </div>
      <div className="login-main">{children}</div>
    </div>
  );
}

const CSS = `
.login-root{position:fixed; inset:0; display:flex; font-family:'Inter',system-ui,sans-serif; color:#0E141B; background:#F4F6F9}
.login-root *{box-sizing:border-box; margin:0; padding:0}
.login-rail{width:42%; max-width:520px; background:linear-gradient(150deg,#1A2530 0%,#233241 60%,#2C4150 100%); color:#fff; padding:48px 44px; display:flex; flex-direction:column; position:relative; overflow:hidden}
.login-rail::before{content:""; position:absolute; inset:0; background-image:linear-gradient(rgba(63,183,201,.10) 1px,transparent 1px),linear-gradient(90deg,rgba(63,183,201,.10) 1px,transparent 1px); background-size:26px 26px; -webkit-mask-image:linear-gradient(150deg,#000,transparent 75%); mask-image:linear-gradient(150deg,#000,transparent 75%)}
.login-rail .brandmark{width:48px; height:48px; border-radius:13px; background:linear-gradient(150deg,#3FB7C9,#22808F); display:grid; place-items:center; box-shadow:0 8px 20px -6px rgba(63,183,201,.55); position:relative}
.login-rail .brandmark svg{width:24px; height:24px}
.login-rail .wordmark{font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:24px; letter-spacing:-.01em; margin-top:22px; position:relative}
.login-rail .wordmark b{color:#3FB7C9}
.login-rail .tag{color:#aab8c6; font-size:15px; line-height:1.6; margin-top:14px; max-width:320px; position:relative}
.login-rail .rail-foot{margin-top:auto; font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:#7e8ea0; position:relative}
.login-main{flex:1; display:flex; align-items:center; justify-content:center; padding:32px}
.login-card{width:100%; max-width:380px}
.login-card h1{font-family:'Space Grotesk',sans-serif; font-size:26px; font-weight:600; letter-spacing:-.02em}
.login-card .sub{color:#697785; font-size:14px; margin-top:6px; margin-bottom:26px; line-height:1.55}
.field{display:block; margin-bottom:16px}
.field span{display:block; font-size:12.5px; font-weight:500; color:#3A4654; margin-bottom:6px}
.field input{width:100%; height:46px; border-radius:11px; border:1px solid #E6EBF1; background:#fff; padding:0 14px; font-size:14.5px; color:#0E141B; outline:none; transition:border-color .15s, box-shadow .15s}
.field input:focus{border-color:#3FB7C9; box-shadow:0 0 0 3px rgba(63,183,201,.18)}
.link-row{display:flex; justify-content:flex-end; margin:-6px 0 16px}
.linkish{background:none; border:none; padding:0; font:inherit; font-size:12.5px; color:#22808F; font-weight:500; cursor:pointer}
.linkish:hover{color:#3FB7C9; text-decoration:underline}
.err{background:#FEF2F2; border:1px solid #FECACA; color:#B91C1C; font-size:13px; border-radius:10px; padding:10px 12px; margin-bottom:14px}
.submit{width:100%; height:48px; border:none; border-radius:12px; background:#3FB7C9; color:#08313a; font-weight:600; font-size:15px; cursor:pointer; transition:background .15s, transform .1s}
.submit:hover:not(:disabled){background:#52C4D5}
.submit:active:not(:disabled){transform:translateY(1px)}
.submit:disabled{opacity:.6; cursor:default}
.alt{margin-top:18px; font-size:13.5px; color:#697785; text-align:center}
.alt button{background:none; border:none; padding:0; font:inherit; color:#22808F; font-weight:600; cursor:pointer}
.alt button:hover{color:#3FB7C9; text-decoration:underline}
.note{margin-top:16px; font-size:12.5px; color:#9AA6B2; text-align:center; line-height:1.5}
.consent{display:flex; flex-direction:column; gap:12px; margin:4px 0 18px}
.consent-row{display:flex; gap:10px; align-items:flex-start; font-size:13px; line-height:1.5; color:#3A4654; cursor:pointer}
.consent-row input{flex:none; width:18px; height:18px; margin-top:1px; accent-color:#22808F; cursor:pointer}
.consent-row a,.inline-link{color:#22808F; font-weight:500; text-decoration:underline}
.consent-row a:hover,.inline-link:hover{color:#3FB7C9}
.sent-to{display:block; margin-top:10px; font-size:13px; color:#697785}
.legal-foot{margin-top:22px; text-align:center; font-size:12px; color:#9AA6B2}
.legal-foot a{color:#697785; text-decoration:none}
.legal-foot a:hover{color:#22808F; text-decoration:underline}
.check-badge{width:52px; height:52px; border-radius:14px; background:#ECF8FA; display:grid; place-items:center; margin-bottom:18px}
.check-badge svg{width:28px; height:28px}
@media (max-width:760px){.login-rail{display:none}}
`;
