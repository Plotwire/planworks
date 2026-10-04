"use client";

// What someone sees after Stripe Checkout sends them back, while the webhook
// confirms the payment (rules: lib/checkoutReturn.js, hook:
// lib/useCheckoutReturn.js). Neither screen grants anything: access only
// changes when the subscription row says so.

import React from "react";
import Toast from "@/components/Toast";

const ACTION = "bg-[var(--action)] hover:bg-[var(--action-hover)] text-[color:var(--action-ink)]";

// In place of the app for up to three minutes after the return. Never the
// Try/Lapsed paywall: they may well have paid, we just haven't heard yet.
export function ConfirmingPayment({ canContinue = false, onContinue }) {
  return (
    <div
      className="fixed inset-0 z-[60] overflow-auto text-white"
      style={{ background: "linear-gradient(150deg,#1A2530 0%,#233241 55%,#2C4150 100%)" }}
    >
      <div className="flex items-center gap-3 px-7 py-[22px]">
        <div
          aria-hidden
          className="w-10 h-10 rounded-[11px] grid place-items-center"
          style={{ background: "linear-gradient(150deg,#3FB7C9,#22808F)" }}
        >
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5"><path d="M13 2 4 13h6l-1 9 9-11h-6l1-9z" fill="#08313a" /></svg>
        </div>
        <div className="text-[20px] font-semibold tracking-[-0.01em]">Plot<b className="text-[#3FB7C9] font-semibold">wire</b></div>
      </div>

      <main className="max-w-[460px] mx-auto px-6 pt-[12vh] pb-14 text-center" role="status" aria-live="polite">
        <div
          aria-hidden
          className="mx-auto w-12 h-12 rounded-full border-[3px] border-white/15 border-t-[#3FB7C9] animate-spin"
        />
        <h1 className="mt-7 text-[26px] leading-tight font-semibold tracking-[-0.02em]">Confirming your payment…</h1>
        <p className="mt-3 text-[14.5px] leading-relaxed text-[#aab8c6]">
          Stripe has sent you back to Plotwire. We&rsquo;re waiting for Stripe to confirm your subscription,
          which usually takes a few seconds.
        </p>
        {canContinue && (
          <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.06] px-5 py-4">
            <p className="text-[13.5px] leading-relaxed text-[#d8e2ec]">
              Taking longer than usual? You can carry on using Plotwire while we finish.
              You won&rsquo;t be charged twice.
            </p>
            <button
              type="button"
              onClick={onContinue}
              className={`mt-4 h-11 px-5 rounded-[11px] text-[14.5px] font-semibold transition-colors ${ACTION}`}
            >
              Continue to Plotwire
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

// A note over the app, bottom centre: never in the way of a drawing. The
// shared Toast (components/Toast.jsx). onCheck adds a "Check again" button;
// onDismiss a close button.
export function PaymentNote({ message, onCheck, checking = false, onDismiss }) {
  return (
    <Toast message={message} onDismiss={onDismiss}>
      {onCheck && (
        <button
          type="button"
          onClick={onCheck}
          disabled={checking}
          className={`shrink-0 h-8 px-3 rounded-lg text-[13px] font-semibold transition-colors disabled:opacity-60 ${ACTION}`}
        >
          {checking ? "Checking…" : "Check again"}
        </button>
      )}
    </Toast>
  );
}
