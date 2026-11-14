"use client";

// Shown on the sign-in pages (AuthFrame in components/LoginScreen.jsx) when
// the page is open inside Instagram, Facebook, Messenger or TikTok's built-in
// browser (lib/inAppBrowser.js): asks the person to open Plotwire in their
// phone's own browser, says how, and offers to copy the link.
// "Not now" hides it until the page is next opened.
// Test in any browser by adding ?inapp=instagram to the address.

import React, { useEffect, useState } from "react";
import { detectInAppBrowser, openInBrowserLabel } from "@/lib/inAppBrowser";

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* blocked in some built-in browsers: try the old way */ }
  try {
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.style.position = "fixed";
    box.style.opacity = "0";
    document.body.appendChild(box);
    box.select();
    const ok = document.execCommand("copy");
    box.remove();
    return ok;
  } catch {
    return false;
  }
}

export default function InAppBrowserBanner() {
  // Worked out after the page loads: the server has no user agent to go on.
  const [found, setFound] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [copied, setCopied] = useState(""); // "" | "yes" | "no"

  useEffect(() => {
    setFound(detectInAppBrowser(navigator.userAgent, window.location.search));
  }, []);

  if (!found || hidden) return null;

  // Straight to sign-in, past the Coming Soon page, and never a link that
  // carries a token from this page's address.
  const link = `${window.location.origin}/?login=1`;
  const copy = async () => setCopied((await copyText(link)) ? "yes" : "no");

  return (
    <div className="iab" role="region" aria-label="Open Plotwire in your phone's browser">
      <style>{CSS}</style>
      <div className="iab-head">
        <svg className="iab-icon" width="22" height="22" viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="11" fill="#F59E0B" />
          <path d="M13.5 7.5H16.5V10.5M16.2 7.8L11 13M14.5 13.5V16H8V9.5H10.5" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="iab-title">For the best experience, open Plotwire in your phone&apos;s browser</p>
      </div>
      <p className="iab-why">
        You&apos;re in {found.app}&apos;s built-in browser. Links in our emails open in your phone&apos;s browser,
        so you&apos;d end up signed in there, not here.
      </p>
      <ol className="iab-steps">
        <li>Tap the three dots <b aria-hidden>⋯</b> at the top right.</li>
        <li>Choose <b>Open in browser</b>. It may say <b>{openInBrowserLabel(found.os)}</b>.</li>
      </ol>
      <div className="iab-actions">
        <button type="button" className="iab-copy" onClick={copy}>Copy link</button>
        <button type="button" className="iab-later" onClick={() => setHidden(true)}>Not now</button>
      </div>
      {copied === "yes" && <p className="iab-done" role="status">Link copied. Paste it into your phone&apos;s browser.</p>}
      {copied === "no" && (
        <p className="iab-done" role="status">
          Couldn&apos;t copy it. Press and hold the link to copy it:
          <input className="iab-link" readOnly value={link} onFocus={(e) => e.target.select()} />
        </p>
      )}
    </div>
  );
}

// Amber like the app's other "needs attention" notes; teal is for buttons only.
const CSS = `
div.iab{width:100%; max-width:380px; background:#FFFBEB; border:1.5px solid #FBBF24; color:#78350F; border-radius:12px; padding:14px 14px 12px; margin:0 auto 22px; font-size:13.5px; line-height:1.5}
.iab .iab-head{display:flex; gap:10px; align-items:flex-start}
.iab .iab-icon{flex:none; margin-top:1px}
.iab .iab-title{font-weight:600; color:#0E141B; font-size:14.5px; line-height:1.4}
.iab .iab-why{margin-top:6px}
.iab .iab-steps{margin:8px 0 0 20px; padding:0; list-style:decimal}
.iab .iab-steps li{margin:3px 0; padding-left:2px}
.iab .iab-steps b{color:#0E141B}
.iab .iab-actions{display:flex; align-items:center; gap:14px; margin-top:12px}
.iab .iab-copy{height:40px; padding:0 16px; border:none; border-radius:10px; background:var(--action); color:var(--action-ink); font:inherit; font-weight:600; font-size:14px; cursor:pointer}
.iab .iab-copy:hover{background:var(--action-hover)}
.iab .iab-later{background:none; border:none; padding:0; font:inherit; font-size:13.5px; color:#78350F; text-decoration:underline; cursor:pointer}
.iab .iab-done{margin-top:10px; font-size:13px}
.iab .iab-link{display:block; width:100%; margin-top:6px; height:38px; border-radius:8px; border:1px solid #FBBF24; background:#fff; padding:0 10px; font-size:13px; color:#0E141B}
`;
