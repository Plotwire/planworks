"use client";

import React from "react";

/* ============================================================================
 * Traffic-light status, wherever offline or sync status shows: the editor,
 * the dashboard's "ready to work offline" line, drawing cards and banners.
 *   green  tick     Synced / Ready to work offline
 *   amber  clock    Saved on this device, will upload when signal returns /
 *                   Still downloading / No signal
 *   red    warning  Not uploaded / Needs signal
 * Bright and obvious at a glance. Teal is for buttons only, never status.
 * ========================================================================== */

export const TONE = {
  green: { icon: "#16A34A" },
  amber: { icon: "#F59E0B" },
  red: { icon: "#DC2626" },
};

// The mark alone: a filled tick in a circle, a clock face, or a warning
// triangle, white on the tone's colour.
export function StatusIcon({ tone, size = 16, title = null }) {
  const c = (TONE[tone] || TONE.amber).icon;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden={title ? undefined : true} role={title ? "img" : undefined}
      style={{ flex: "none", display: "block" }}>
      {title ? <title>{title}</title> : null}
      {tone === "green" && (
        <>
          <circle cx="12" cy="12" r="11" fill={c} />
          <path d="M6.6 12.4l3.6 3.6 7.3-7.6" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {tone === "amber" && (
        <>
          <circle cx="12" cy="12" r="11" fill={c} />
          <circle cx="12" cy="12" r="7" fill="none" stroke="#fff" strokeWidth="2" />
          <path d="M12 8.2V12l2.8 1.9" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {tone === "red" && (
        <>
          <path d="M10.3 2.9a2 2 0 0 1 3.4 0l9.2 16a2 2 0 0 1-1.7 3H2.8a2 2 0 0 1-1.7-3z" fill={c} />
          <path d="M12 8.5v6" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
          <circle cx="12" cy="18" r="1.5" fill="#fff" />
        </>
      )}
    </svg>
  );
}

// A pill: the mark and the words, on the tone's tint. onClick makes it a
// button (try again, or say why).
export function StatusPill({ tone, text, title = null, onClick = null, size = "md", className = "" }) {
  const props = {
    className: `pw-status pw-status-${size} ${className}`.trim(),
    "data-tone": tone,
    title: title || text,
  };
  const body = (
    <>
      <StatusIcon tone={tone} size={size === "lg" ? 18 : size === "sm" ? 14 : 16} />
      <span className="pw-status-text">{text}</span>
      <style>{STATUS_CSS}</style>
    </>
  );
  return onClick
    ? <button type="button" onClick={onClick} {...props}>{body}</button>
    : <span role="status" {...props}>{body}</span>;
}

// Colours for anything carrying data-tone (the pill, banners, cards' badges).
export const STATUS_CSS = `
.pw-status{display:inline-flex;align-items:center;gap:7px;border-radius:999px;border:1.5px solid;font-family:var(--font-inter),system-ui,sans-serif;font-weight:700;line-height:1;white-space:nowrap;letter-spacing:0;text-transform:none;max-width:100%}
.pw-status .pw-status-text{overflow:hidden;text-overflow:ellipsis}
.pw-status.pw-status-sm{height:22px;padding:0 9px 0 4px;font-size:11px}
.pw-status.pw-status-md{height:26px;padding:0 11px 0 5px;font-size:12px}
.pw-status.pw-status-lg{height:32px;padding:0 13px 0 7px;font-size:13px}
button.pw-status{cursor:pointer}
.pw-status[data-tone=green]{background:#DCFCE7;border-color:#4ADE80;color:#14532D}
.pw-status[data-tone=amber]{background:#FEF3C7;border-color:#FBBF24;color:#78350F}
.pw-status[data-tone=red]{background:#FEE2E2;border-color:#F87171;color:#7F1D1D}
html.dark .pw-status[data-tone=green]{background:rgba(22,163,74,.22);border-color:#22C55E;color:#BBF7D0}
html.dark .pw-status[data-tone=amber]{background:rgba(245,158,11,.22);border-color:#F59E0B;color:#FDE68A}
html.dark .pw-status[data-tone=red]{background:rgba(220,38,38,.24);border-color:#EF4444;color:#FECACA}
@media print{.pw-status{display:none !important}}
`;
