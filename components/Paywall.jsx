"use client";

import React, { useState } from "react";
import { startCheckout } from "@/lib/billingClient";
import { TRIAL_DAYS } from "@/lib/pricing";

const FEATURES = [
  "Unlimited plans & quotes",
  "Automatic bill of quantities",
  "Branded PDF export",
  "All your jobs in one place",
  "Unlimited users on your account",
];

export default function Paywall({ user, onSignOut, onManageBilling, hasLapsed = false, notice = "" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const choose = async () => {
    setError(""); setBusy(true);
    try {
      await startCheckout(); // redirects away on success
    } catch (e) {
      setBusy(false);
      setError(e?.message || "Couldn't start checkout. Try again in a moment.");
    }
  };

  return (
    <div className="pw-pay">
      <style>{CSS}</style>

      <header className="pay-top">
        <div className="brandrow">
          <div className="brandmark" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none"><path d="M13 2 4 13h6l-1 9 9-11h-6l1-9z" fill="#08313a" /></svg>
          </div>
          <div className="wordmark">Plot<b>wire</b></div>
        </div>
        <button type="button" className="signout" onClick={onSignOut}>
          {user?.email ? `Sign out (${user.email})` : "Sign out"}
        </button>
      </header>

      <main className="pay-main">
        <div className="pay-intro">
          <div className="eyebrow">{hasLapsed ? "Welcome back" : "Subscribe to continue"}</div>
          <h1>{hasLapsed ? "Pick up where you left off" : `Start your ${TRIAL_DAYS}-day free trial`}</h1>
          <p className="lede">
            {hasLapsed
              ? "Your subscription isn't active. Re-subscribe to carry on — your drawings are safe."
              : `Full access while you trial. We'll take your card now, but won't charge until day ${TRIAL_DAYS} — cancel any time before then.`}
          </p>
        </div>

        {(notice || error) && (
          <div className={`pay-banner ${error ? "is-error" : ""}`}>{error || notice}</div>
        )}

        <div className="card">
          <div className="card-name">Plotwire</div>
          <div className="card-price">
            <span className="amt">£15</span><span className="per">/month</span>
          </div>
          <p className="card-blurb">One simple plan. Unlimited users on your account.</p>
          <ul className="feat">
            {FEATURES.map((f) => (
              <li key={f}>
                <svg viewBox="0 0 24 24" fill="none" aria-hidden><path d="M5 13l4 4L19 7" stroke="#22808F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <button type="button" className="pick primary" onClick={choose} disabled={busy}>
            {busy ? "Redirecting…" : (hasLapsed ? "Re-subscribe" : "Start free trial")}
          </button>
          <div className="reassure">
            <span>{TRIAL_DAYS}-day free trial</span><i /><span>Cancel anytime</span>
          </div>
        </div>

        <div className="secure">Secure checkout by Stripe</div>

        {hasLapsed && onManageBilling && (
          <button type="button" className="manage-link" onClick={onManageBilling}>
            Manage existing billing
          </button>
        )}
      </main>
    </div>
  );
}

const CSS = `
.pw-pay{position:fixed; inset:0; overflow:auto; font-family:'Inter',system-ui,sans-serif; color:#fff;
  background:linear-gradient(150deg,#1A2530 0%,#233241 55%,#2C4150 100%)}
.pw-pay *{box-sizing:border-box; margin:0; padding:0}
.pw-pay::before{content:""; position:fixed; inset:0; pointer-events:none;
  background-image:linear-gradient(rgba(63,183,201,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(63,183,201,.08) 1px,transparent 1px);
  background-size:30px 30px; -webkit-mask-image:radial-gradient(120% 90% at 50% 0%,#000,transparent 80%); mask-image:radial-gradient(120% 90% at 50% 0%,#000,transparent 80%)}
.pay-top{position:relative; display:flex; align-items:center; justify-content:space-between; padding:22px 28px}
.brandrow{display:flex; align-items:center; gap:12px}
.brandmark{width:40px; height:40px; border-radius:11px; background:linear-gradient(150deg,#3FB7C9,#22808F); display:grid; place-items:center; box-shadow:0 8px 20px -6px rgba(63,183,201,.55)}
.brandmark svg{width:20px; height:20px}
.wordmark{font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:20px; letter-spacing:-.01em}
.wordmark b{color:#3FB7C9}
.signout{background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12); color:#c6d2de; font:inherit; font-size:12.5px; padding:8px 13px; border-radius:9px; cursor:pointer; transition:background .15s, border-color .15s; max-width:46vw; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.signout:hover{background:rgba(255,255,255,.1); border-color:rgba(255,255,255,.2)}
.pay-main{position:relative; max-width:460px; margin:0 auto; padding:18px 24px 56px}
.pay-intro{text-align:center; margin:18px auto 28px}
.eyebrow{font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:.22em; text-transform:uppercase; color:#3FB7C9; margin-bottom:14px}
.pay-intro h1{font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:30px; line-height:1.12; letter-spacing:-.02em}
.lede{color:#aab8c6; font-size:14.5px; line-height:1.6; margin-top:14px}
.pay-banner{margin:0 auto 22px; text-align:center; font-size:13.5px; color:#d8e2ec; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12); border-radius:11px; padding:11px 14px}
.pay-banner.is-error{color:#FECACA; background:rgba(185,28,28,.14); border-color:rgba(254,202,202,.3)}
.card{position:relative; background:#fff; color:#0E141B; border-radius:18px; padding:28px 26px 24px; border:2px solid #3FB7C9; box-shadow:0 22px 50px -20px rgba(63,183,201,.5)}
.card-name{font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:19px}
.card-price{margin-top:8px; display:flex; align-items:baseline; gap:4px}
.card-price .amt{font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:44px; letter-spacing:-.02em; color:#0E141B}
.card-price .per{font-size:14px; color:#697785}
.card-blurb{color:#697785; font-size:13px; line-height:1.5; margin-top:8px}
.feat{list-style:none; margin:20px 0 22px; display:flex; flex-direction:column; gap:12px}
.feat li{display:flex; align-items:flex-start; gap:9px; font-size:14px; color:#3A4654; line-height:1.4}
.feat svg{width:18px; height:18px; flex:0 0 18px; margin-top:1px}
.pick{width:100%; height:48px; border-radius:11px; font:inherit; font-weight:600; font-size:15px; cursor:pointer; transition:background .15s, transform .1s; border:none; background:#3FB7C9; color:#08313a}
.pick:hover:not(:disabled){background:#52C4D5}
.pick:active:not(:disabled){transform:translateY(1px)}
.pick:disabled{opacity:.6; cursor:default}
.reassure{display:flex; align-items:center; justify-content:center; gap:12px; margin-top:16px; color:#8b9bab; font-size:12px; font-family:'JetBrains Mono',monospace; letter-spacing:.04em}
.reassure i{width:4px; height:4px; border-radius:50%; background:#c2ccd6}
.secure{text-align:center; margin-top:22px; color:#8b9bab; font-size:12px; font-family:'JetBrains Mono',monospace; letter-spacing:.06em}
.manage-link{display:block; margin:18px auto 0; background:none; border:none; color:#9fb0c0; font:inherit; font-size:13px; text-decoration:underline; cursor:pointer}
.manage-link:hover{color:#cfdae4}
@media (max-width:520px){ .pay-intro h1{font-size:25px} }
`;
