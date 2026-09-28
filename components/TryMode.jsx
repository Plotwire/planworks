"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { savedSymbolCounts } from "@/lib/db";

/* ============================================================================
 * TRY MODE -- the in-app side of "Try Plotwire" (lib/access.js). An account
 * that has never paid can place TRY_SYMBOL_LIMIT symbols in total across all
 * its saved drawings, sees a watermark, and can't export. The database enforces
 * the same limit on save (supabase/try-mode.sql); this makes it friendly.
 * ========================================================================= */

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

// Small pill: "12 of 25 trial symbols used · Subscribe".
export function TryChip({ used, limit, onSubscribe }) {
  const full = used >= limit;
  return (
    <div className="pw-try-chip" data-full={full ? "1" : undefined} role="status">
      <span>{Math.min(used, limit)} of {limit} trial symbols used</span>
      <button type="button" onClick={onSubscribe}>Subscribe</button>
      <style>{CHIP_CSS}</style>
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

// Faint diagonal "PLOTWIRE TRIAL" over everything on screen (drawing, BOQ,
// sketch), including when the page is printed. It never takes clicks.
export function TrialWatermark() {
  const bg = useMemo(() => {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='420' height='260'><text x='50%' y='50%' text-anchor='middle' dominant-baseline='middle' transform='rotate(-28 210 130)' font-family='Inter,Arial,sans-serif' font-size='30' font-weight='800' letter-spacing='6' fill='%231A2530' fill-opacity='0.09'>PLOTWIRE TRIAL</text></svg>`;
    return `url("data:image/svg+xml;utf8,${svg.replace(/#/g, "%23").replace(/\n/g, "")}")`;
  }, []);
  return (
    <div className="pw-trial-wm" aria-hidden style={{ backgroundImage: bg }}>
      <style>{WM_CSS}</style>
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

const CHIP_CSS = `
.pw-try-chip{position:fixed; left:50%; bottom:46px; transform:translateX(-50%); z-index:45; display:flex; align-items:center; gap:10px;
  padding:6px 6px 6px 14px; border-radius:999px; background:#ECF8FA; border:1px solid #BFE7ED; box-shadow:0 6px 18px -8px rgba(16,28,40,.35);
  font:600 11.5px/1 Inter,system-ui,sans-serif; color:#1A2530; white-space:nowrap}
.pw-try-chip[data-full]{background:#FFF1DE; border-color:#F5C58A; color:#7A3E00}
.pw-try-chip button{border:0; border-radius:999px; padding:6px 12px; font:inherit; cursor:pointer; background:var(--action,#2C97A8); color:var(--action-ink,#1A2530)}
.pw-try-chip button:hover{background:var(--action-hover,#22808F)}
html.dark .pw-try-chip{background:#13343b; border-color:#235662; color:#E7EDF3}
html.dark .pw-try-chip[data-full]{background:#3a2a14; border-color:#6b4a1f; color:#FFD9A8}
@media print{.pw-try-chip{display:none}}
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

// Above the drawing and the BOQ window (z 50-60), below prompts and the
// Subscribe screen. Printed too, so a browser print of the page carries it.
const WM_CSS = `
.pw-trial-wm{position:fixed; inset:0; z-index:70; pointer-events:none; background-repeat:repeat; background-position:center}
html.dark .pw-trial-wm{filter:invert(1)}
@media print{.pw-trial-wm{display:block !important; position:fixed; inset:0; z-index:2147483000; -webkit-print-color-adjust:exact; print-color-adjust:exact}}
`;
