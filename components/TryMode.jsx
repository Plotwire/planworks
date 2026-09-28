"use client";

import React, { useCallback, useEffect, useState } from "react";
import { savedSymbolCounts } from "@/lib/db";

/* ============================================================================
 * TRY MODE -- the in-app side of "Try Plotwire" (lib/access.js). An account
 * that has never paid can place TRY_SYMBOL_LIMIT symbols in total across all
 * its saved drawings, and can't export, price or share. Its drawing sheet is
 * marked "TRIAL – NOT FOR ISSUE" with one faint Plotwire logo -- nothing is
 * laid over the toolbars, panels, BOQ or sketch tool. The database enforces
 * the same limit on save (supabase/try-mode.sql); this makes it friendly.
 * ========================================================================= */

// Shown in the title block's drawing-number chip while in Try mode.
export const TRIAL_DRAWING_NUMBER = "TRIAL – NOT FOR ISSUE";

// Symbols in a drawing: every sheet's placed symbols (furniture, wires and
// notes don't count). Same rule as buildPreview().count in lib/db.js.
export function drawingSymbolCount(project) {
  if (!project) return 0;
  if (Array.isArray(project.sheets)) return project.sheets.reduce((n, s) => n + ((s.placed && s.placed.length) || 0), 0);
  return (project.placed && project.placed.length) || 0;
}

/* Live Try usage in the drawing editor: the symbols saved in the account's
 * OTHER drawings plus the drawing on screen. */
export function useTryUsage({ enabled, limit, currentProjectId, project }) {
  const [saved, setSaved] = useState(null); // Map id -> count, null until loaded
  const refresh = useCallback(async () => {
    if (!enabled) return;
    try { setSaved(await savedSymbolCounts()); } catch (e) { console.warn("Try usage:", e?.message || e); }
  }, [enabled]);
  useEffect(() => { refresh(); }, [refresh, currentProjectId]);

  const current = drawingSymbolCount(project);
  const savedTotal = (excludeId) => {
    if (!saved) return 0;
    let n = 0;
    saved.forEach((c, id) => { if (id !== excludeId) n += c; });
    return n;
  };
  const used = savedTotal(currentProjectId) + current;

  return {
    enabled: Boolean(enabled),
    limit,
    used,
    // May another `n` symbols go onto this drawing?
    canAdd: (n = 1) => !enabled || used + n <= limit,
    // Would the database refuse this save? Same rule as supabase/try-mode.sql:
    // over the limit AND adding symbols. Saving an existing drawing that
    // doesn't add any always works, so accounts already over the limit (from
    // before Try mode) can still tidy up. A new drawing or a Save As copy has
    // nothing saved yet (excludeId = null), so the copy counts every saved
    // drawing, including its original, plus itself.
    blocksSave: (excludeId) => {
      if (!enabled) return false;
      if (excludeId && saved && current <= (saved.get(excludeId) || 0)) return false;
      return savedTotal(excludeId) + current > limit;
    },
    refresh,
  };
}

/* "Trial · 12 of 25 symbols" pill with the standard solid teal Subscribe
 * button beside it. Used in the editor's top toolbar and on the dashboard,
 * never over the canvas. Sizes are set on the elements themselves, not in a
 * stylesheet, so no page rule can stretch them (a `body > div` rule once
 * turned an earlier floating chip into a full-height capsule). */
const PILL_ROW = { display: "inline-flex", alignItems: "center", gap: 8, flex: "none" };
const PILL = {
  display: "inline-flex", alignItems: "center", boxSizing: "border-box", height: 32, padding: "0 12px",
  borderRadius: 999, fontSize: 12, lineHeight: 1, fontWeight: 600, whiteSpace: "nowrap",
  fontFamily: "Inter, system-ui, sans-serif", fontVariantNumeric: "tabular-nums",
};
const PILL_BTN = {
  boxSizing: "border-box", height: 32, padding: "0 14px", border: 0, borderRadius: 10,
  fontSize: 12, lineHeight: 1, fontWeight: 600, cursor: "pointer", flex: "none", whiteSpace: "nowrap",
  fontFamily: "Inter, system-ui, sans-serif",
};
export function TryPill({ used, limit, onSubscribe, subscribeLabel = "Subscribe" }) {
  const full = used >= limit;
  return (
    <span className="pw-try-pill" style={PILL_ROW}>
      <span className="pw-try-pill-count" data-full={full ? "1" : undefined} role="status" style={PILL}
        title={`Try Plotwire: ${Math.min(used, limit)} of ${limit} symbols used across all your saved drawings`}>
        {/* Full wording on wide screens; "Trial · N/25" under 1300px (tablets). */}
        <span className="pw-try-pill-full">Trial &middot; {Math.min(used, limit)} of {limit} symbols</span>
        <span className="pw-try-pill-short">Trial &middot; {Math.min(used, limit)}/{limit}</span>
      </span>
      <button type="button" className="pw-try-pill-btn" onClick={onSubscribe} style={PILL_BTN}>{subscribeLabel}</button>
      <style>{PILL_CSS}</style>
    </span>
  );
}

/* One faint Plotwire logo centred on the drawing sheet (about 6% opacity).
 * The caller places it inside the sheet; it never takes clicks. */
export function TrialSheetMark() {
  return (
    <div aria-hidden style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                              pointerEvents: "none", zIndex: 5, opacity: 0.06 }}>
      <svg width="520" height="150" viewBox="0 0 520 150" fill="none">
        <rect x="0" y="15" width="120" height="120" rx="30" fill="#1A2530" />
        <path d="M68 38 38 80h22l-5 33 32-45H65l3-30z" fill="#ffffff" />
        <text x="148" y="104" fontFamily="'Space Grotesk', Inter, system-ui, sans-serif" fontSize="84" fontWeight="700" letterSpacing="-2" fill="#1A2530">
          Plotwire
        </text>
      </svg>
    </div>
  );
}

// "Subscribe to keep going" -- shown when a Try account hits the limit, or a
// locked feature (export, print, quotes, share links) is used.
export function TryPrompt({ open, title, body, onSubscribe, onClose }) {
  if (!open) return null;
  return (
    <div className="pw-try-prompt" role="dialog" aria-modal="true" aria-labelledby="pw-try-title" onClick={onClose}>
      <div className="box" onClick={(e) => e.stopPropagation()}>
        <div className="eyebrow">Try Plotwire</div>
        <h2 id="pw-try-title">{title || "Subscribe to keep going"}</h2>
        <p>{body || "You've used all your trial symbols. Subscribe to carry on — everything you've drawn is kept."}</p>
        <div className="actions">
          <button type="button" className="ghost" onClick={onClose}>Not now</button>
          <button type="button" className="primary" onClick={onSubscribe}>Subscribe</button>
        </div>
      </div>
      <style>{PROMPT_CSS}</style>
    </div>
  );
}

// The prompt state most screens need: which message is showing.
export function useTryPrompt() {
  const [prompt, setPrompt] = useState(null); // { title, body } or null
  const show = useCallback((p) => setPrompt(p || {}), []);
  const hide = useCallback(() => setPrompt(null), []);
  return { prompt, show, hide };
}

// Messages for the features Try mode locks.
export const LOCKED = {
  export: { title: "Exports come with a subscription", body: "Downloading and printing drawings unlocks when you subscribe. Everything you've drawn is kept." },
  saveFile: { title: "Saving to a file comes with a subscription", body: "Your drawings are saved to your account as you go. Downloading a copy unlocks when you subscribe." },
  boq: { title: "Prices, quotes and materials lists come with a subscription", body: "You can see every item and quantity. Pricing, client quotes and downloads unlock when you subscribe." },
  share: { title: "Sharing comes with a subscription", body: "Share links and images of your planner unlock when you subscribe." },
  limit: null, // the default "Subscribe to keep going" wording
};

// Colours only; sizes are inline (PILL / PILL_BTN). Navy text and a thin teal
// outline; the button is the standard solid teal action button. Dark mode
// lightens the text so it stays readable on the dark toolbar.
const PILL_CSS = `
.pw-try-pill-count{color:#1A2530; border:1px solid #2C97A8; background:transparent}
.pw-try-pill-count[data-full]{border-color:#D9822B}
.pw-try-pill-btn{background:var(--action,#2C97A8); color:var(--action-ink,#1A2530)}
.pw-try-pill-btn:hover{background:var(--action-hover,#22808F)}
html.dark .pw-try-pill-count{color:#E7EDF3}
.pw-try-pill-short{display:none}
@media (max-width:1299px){.pw-try-pill-full{display:none} .pw-try-pill-short{display:inline}}
@media print{.pw-try-pill{display:none !important}}
`;

const PROMPT_CSS = `
.pw-try-prompt{position:fixed; inset:0; z-index:2147481000; background:rgba(15,23,42,.5); backdrop-filter:blur(3px); display:flex; align-items:center; justify-content:center; padding:16px}
.pw-try-prompt .box{width:100%; max-width:420px; background:#fff; border-radius:16px; padding:24px 24px 20px; box-shadow:0 24px 60px -20px rgba(0,0,0,.45); font-family:Inter,system-ui,sans-serif; color:#0E141B}
.pw-try-prompt .eyebrow{font:600 10px/1 'JetBrains Mono',monospace; letter-spacing:.14em; text-transform:uppercase; color:#22808F; margin-bottom:10px}
.pw-try-prompt h2{font-size:19px; font-weight:700; margin:0 0 8px}
.pw-try-prompt p{font-size:13.5px; line-height:1.55; color:#3A4654; margin:0 0 20px}
.pw-try-prompt .actions{display:flex; justify-content:flex-end; gap:8px}
.pw-try-prompt button{height:40px; padding:0 16px; border-radius:10px; font:600 13px Inter,system-ui,sans-serif; cursor:pointer}
.pw-try-prompt .ghost{background:#F1F5F9; border:0; color:#1A2530}
.pw-try-prompt .primary{background:var(--action,#2C97A8); color:var(--action-ink,#1A2530); border:0}
.pw-try-prompt .primary:hover{background:var(--action-hover,#22808F)}
html.dark .pw-try-prompt .box{background:#16202B; color:#E7EDF3}
html.dark .pw-try-prompt p{color:#B6C2CE}
html.dark .pw-try-prompt .ghost{background:#22303D; color:#E7EDF3}
`;
