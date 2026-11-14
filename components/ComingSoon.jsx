"use client";

import React from "react";

// Public holding page shown while COMING_SOON is on (see AppShell). Visitors who
// aren't logged in see this instead of the login screen. A discreet "Sign in"
// link (and the ?login=1 URL) lets the owner reach the real login.
export default function ComingSoon({ onSignIn }) {
  return (
    <div className="w-full min-h-screen flex flex-col items-center justify-center bg-[#F4F6F9] px-6 text-center">
      <div className="flex flex-col items-center max-w-md">
        {/* Plotwire wordmark */}
        <svg width="240" height="58" viewBox="0 0 532 128" role="img" aria-label="Plotwire" className="mb-10">
          <rect width="128" height="128" rx="37" fill="#2C97A8" />
          <path d="M67 24 L41 61.5 h12 L50 104 L76 66.5 h-12 z" fill="#1A2530" stroke="#1A2530" strokeWidth="3.5" strokeLinejoin="round" />
          <text x="160" y="96" fontFamily="'Poppins','Helvetica Neue',Arial,sans-serif" fontSize="92" letterSpacing="-1">
            <tspan fill="#1A2530" fontWeight="400">Plot</tspan><tspan fill="#2C97A8" fontWeight="700">wire</tspan>
          </text>
        </svg>

        <div className="text-[11px] tracking-[0.35em] text-[#2C97A8] uppercase font-semibold mb-4">
          Coming soon
        </div>

        <h1 className="text-2xl sm:text-3xl font-semibold text-[#1A2530] leading-snug mb-4">
          Electrical layouts &amp; quoting,<br className="hidden sm:block" /> built for electricians.
        </h1>

        <p className="text-[15px] text-slate-500 leading-relaxed mb-2">
          We&apos;re putting the finishing touches to Plotwire. Check back soon.
        </p>

        <p className="text-[15px] text-slate-500 leading-relaxed">
          For enquiries, get in touch at{" "}
          <a href="mailto:admin@plotwire.uk" className="text-[#2C97A8] no-underline hover:underline">
            admin@plotwire.uk
          </a>
          .
        </p>
      </div>

      {/* Discreet owner sign-in */}
      <button
        type="button"
        onClick={onSignIn}
        className="mt-16 text-[11px] tracking-[0.2em] uppercase text-slate-400 hover:text-[#2C97A8] transition-colors"
      >
        Sign in
      </button>
    </div>
  );
}
