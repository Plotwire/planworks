"use client";

import React from "react";

// Full-screen "please rotate" message for tablets held in portrait.
//
// Websites can't lock rotation (iPad Safari doesn't allow it), so instead this
// covers the app while a touch tablet is upright. It is shown and hidden by a
// CSS media query alone: the element is always rendered, and nothing under it
// unmounts or re-renders when the device turns, so unsaved work and open
// dialogs are exactly as they were once it's back in landscape.
//
// Who sees it (all must hold):
//   hover: none, pointer: coarse  a touch-first device -- not a desktop or
//                                 laptop, even a touchscreen one, and not a
//                                 narrow browser window;
//   orientation: portrait         held upright;
//   min-width: 600px              tablet-sized (phones are narrower upright).
//
// AppShell leaves it out on public pages (legal documents, planner share
// links), so those stay readable in portrait.
export default function RotateNotice() {
  return (
    <div className="pw-rotate" role="alert" aria-live="polite">
      <style>{CSS}</style>
      <div className="pw-rotate-inner">
        <svg className="pw-rotate-icon" viewBox="0 0 64 64" fill="none" aria-hidden>
          {/* A tablet turning onto its side */}
          <rect x="20" y="10" width="24" height="36" rx="4" stroke="#FFFFFF" strokeOpacity=".35" strokeWidth="2.5" />
          <rect x="14" y="26" width="36" height="24" rx="4" stroke="#3FB7C9" strokeWidth="2.5" />
          <path d="M48 12c5 3 8 8 8 14" stroke="#3FB7C9" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M52 24l4 3 3-4" stroke="#3FB7C9" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p>Plotwire works best in landscape. Please rotate your device.</p>
      </div>
    </div>
  );
}

const CSS = `
.pw-rotate{display:none}
@media (hover: none) and (pointer: coarse) and (orientation: portrait) and (min-width: 600px){
  .pw-rotate{position:fixed; inset:0; z-index:2147483000; display:flex; align-items:center; justify-content:center;
    padding:32px; background:#1A2530; color:#FFFFFF; font-family:'Inter',system-ui,sans-serif; touch-action:none}
}
.pw-rotate-inner{max-width:340px; text-align:center}
.pw-rotate-icon{width:88px; height:88px; margin:0 auto 22px; display:block}
.pw-rotate p{margin:0; font-size:18px; line-height:1.5; color:#E7EDF3}
`;
