"use client";

// The app's one toast: a small dark note, bottom centre, 16px from the edge,
// sized to its content. Sizes and position are inline on purpose: the page
// stylesheet gives `body > div` height:100%, and a toast mounted straight
// under <body> picked that up and stretched the full viewport height. Inline
// styles beat that rule, so no page CSS can stretch it again.
// `children` = extra buttons before the close button (e.g. "Check again").

import React from "react";
import { X } from "lucide-react";

export const TOAST_ACTION = "bg-[var(--action)] hover:bg-[var(--action-hover)] text-[color:var(--action-ink)]";

const BOX = {
  position: "fixed", left: "50%", bottom: 16, top: "auto", transform: "translateX(-50%)",
  width: "calc(100% - 32px)", maxWidth: 480, height: "auto", minHeight: 0, maxHeight: "none",
  boxSizing: "border-box", padding: "12px 14px", borderRadius: 12,
  display: "flex", alignItems: "center", gap: 12, zIndex: 2147481000,
  boxShadow: "0 18px 40px -12px rgba(0,0,0,.45)",
};

export default function Toast({ message, onDismiss = null, children = null }) {
  return (
    <div role="status" aria-live="polite" style={BOX} className="border border-white/10 bg-[#1A2530] text-white">
      <p className="flex-1 min-w-0 m-0 text-[13.5px] leading-snug text-[#e3eaf1]">{message}</p>
      {children}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          title="Dismiss"
          className={`shrink-0 w-8 h-8 rounded-lg grid place-items-center transition-colors ${TOAST_ACTION}`}
        >
          <X size={16} strokeWidth={2.4} />
        </button>
      )}
    </div>
  );
}
