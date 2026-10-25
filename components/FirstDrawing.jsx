"use client";

/* ============================================================================
 * components/FirstDrawing.jsx -- the first-drawing guide's screens
 * ----------------------------------------------------------------------------
 * FirstDrawingPanel: the dashboard for an account with no drawings yet (in
 *   place of the usual one, components/HomeScreen.jsx): "Let's do your first
 *   drawing" and three ways in -- upload a plan, draw one in the Floor Plan
 *   tool, or try a ready-made sample house (lib/sampleHouse.js).
 * FirstDrawingGuide: in the editor, a small checklist in the drawing area's
 *   bottom-left corner that ticks itself as each step is done, and one small
 *   hint at a time pointing at what to do next. It never stops anything:
 *   everything works as it always does around it, "Hide guide" puts it away
 *   for good, and each hint has its own cross.
 * Progress: lib/firstDrawing.js, kept with the account (AppShell).
 * ========================================================================== */

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Upload, PencilRuler, Home, Check, X, Loader2 } from "lucide-react";
import { GUIDE_STEPS, GUIDE_TEXT, stepDone, doneCount, allDone, nextStep } from "@/lib/firstDrawing";

/* ---------------------------------------------------------------------------
 * Dashboard: "Let's do your first drawing"
 * ------------------------------------------------------------------------ */
export function FirstDrawingPanel({ onUploadFile, onSketch, onSample, sampleBusy = false, sampleError = "" }) {
  const fileRef = useRef(null);
  const pick = (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (f) onUploadFile(f);
  };
  return (
    <section className="first-panel" data-first-drawing="">
      <style>{PANEL_CSS}</style>
      <div className="first-head">
        <h1>Let&rsquo;s do your first drawing</h1>
        <p>Pick a way in. In a few minutes you&rsquo;ll have sockets and lights on a plan, and a quote filled in from them.</p>
      </div>
      <div className="first-choices">
        {/* A label round the file input: the tap itself opens the picker,
            which is the only way iPad Safari will. */}
        <label className="first-choice" data-choice="upload" tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileRef.current?.click(); } }}>
          <input ref={fileRef} type="file" accept="image/*,.pdf" className="first-file" onChange={pick} tabIndex={-1} />
          <span className="first-ic"><Upload strokeWidth={2} aria-hidden="true" /></span>
          <span className="first-t">Upload a plan</span>
          <span className="first-s">A PDF, or a photo of the builder&rsquo;s drawing</span>
        </label>
        <button type="button" className="first-choice" data-choice="draw" onClick={onSketch}>
          <span className="first-ic"><PencilRuler strokeWidth={2} aria-hidden="true" /></span>
          <span className="first-t">Draw a floor plan</span>
          <span className="first-s">Sketch the rooms to size in the Floor Plan tool</span>
        </button>
        <button type="button" className="first-choice" data-choice="sample" onClick={onSample} disabled={sampleBusy} aria-busy={sampleBusy || undefined}>
          <span className="first-ic">{sampleBusy ? <Loader2 strokeWidth={2} className="first-spin" aria-hidden="true" /> : <Home strokeWidth={2} aria-hidden="true" />}</span>
          <span className="first-t">{sampleBusy ? "Setting up the sample house…" : "Try a sample house"}</span>
          <span className="first-s">A ready-made two-bed plan to practise on</span>
        </button>
      </div>
      {sampleError && <div className="first-error" role="alert">{sampleError}</div>}
    </section>
  );
}

const PANEL_CSS = `
.pw-home .first-panel{position:relative; overflow:hidden; border-radius:22px; background:linear-gradient(120deg,#1A2530 0%,#233241 60%,#2C4150 100%); padding:38px 36px 36px; margin-bottom:28px; color:#fff; box-shadow:0 18px 40px -12px rgba(16,28,40,.22)}
.pw-home .first-panel::before{content:""; position:absolute; inset:0; background-image:linear-gradient(var(--blueprint) 1px,transparent 1px),linear-gradient(90deg,var(--blueprint) 1px,transparent 1px); background-size:26px 26px; -webkit-mask-image:linear-gradient(105deg,transparent 35%,#000 100%); mask-image:linear-gradient(105deg,transparent 35%,#000 100%); pointer-events:none}
.pw-home .first-head{position:relative; margin-bottom:26px}
.pw-home .first-head h1{font-family:var(--font-space-grotesk),sans-serif; font-weight:600; font-size:34px; letter-spacing:-.02em; line-height:1.08; margin-bottom:10px}
.pw-home .first-head p{color:#c3cfdb; font-size:15.5px; line-height:1.55; max-width:620px}
.pw-home .first-choices{position:relative; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px}
.pw-home .first-choice{display:flex; flex-direction:column; align-items:flex-start; gap:8px; min-height:184px; padding:22px 22px 24px; border-radius:16px; border:none; background:#fff; color:var(--ink); text-align:left; cursor:pointer; font-family:inherit; transition:transform .17s ease, box-shadow .17s ease; position:relative}
.pw-home .first-choice:hover{transform:translateY(-2px); box-shadow:0 14px 30px -10px rgba(0,0,0,.45)}
.pw-home .first-choice:focus-visible{outline:3px solid var(--teal); outline-offset:3px}
.pw-home .first-choice:disabled{cursor:wait; transform:none; box-shadow:none; opacity:.92}
.pw-home .first-file{position:absolute; width:1px; height:1px; opacity:0; overflow:hidden; pointer-events:none}
.pw-home .first-ic{width:56px; height:56px; border-radius:14px; display:grid; place-items:center; background:var(--action); color:var(--action-ink); margin-bottom:8px}
.pw-home .first-ic svg{width:28px; height:28px}
.pw-home .first-spin{animation:first-spin 1s linear infinite}
@keyframes first-spin{to{transform:rotate(360deg)}}
.pw-home .first-t{font-family:var(--font-space-grotesk),sans-serif; font-weight:600; font-size:19px; letter-spacing:-.01em}
.pw-home .first-s{font-size:13.5px; line-height:1.45; color:var(--ink-2)}
.pw-home .first-error{position:relative; margin-top:16px; padding:12px 16px; border-radius:12px; background:#FEE2E2; border:1.5px solid #F87171; color:#7F1D1D; font-size:13.5px; font-weight:600}
@media (max-width:980px){.pw-home .first-choices{grid-template-columns:1fr}.pw-home .first-choice{min-height:0; flex-direction:row; align-items:center; flex-wrap:wrap}.pw-home .first-ic{margin-bottom:0}}
html.dark .pw-home .first-choice{background:#16202B; color:#E6EDF3}
html.dark .pw-home .first-s{color:#A9B6C3}
`;

/* ---------------------------------------------------------------------------
 * Editor: the checklist and the hints
 * ------------------------------------------------------------------------ */
// guide: the progress (lib/firstDrawing). hintsBlocked: something is open
// over the drawing (the quote, a dialog...), so no hint now. paletteShown:
// the symbol list is on screen (the palette hint points at it).
export function FirstDrawingGuide({ guide, onHide, onClose, onRealJob, onHintOff, hintsBlocked = false, paletteShown = true }) {
  const done = allDone(guide);
  const next = nextStep(guide);
  const off = guide?.hintsOff || {};
  const hint = done || hintsBlocked ? null
    : next === "symbol" && paletteShown && !off.palette ? "palette"
    : next === "quote" && !off.quote ? "quote"
    : null;
  return (
    <>
      <div data-guide-checklist="" role="region" aria-label="Your first drawing"
        className="absolute left-4 bottom-10 z-20 w-[256px] rounded-xl bg-white dark:bg-[#16202B] ring-1 ring-slate-200 dark:ring-[#2A3947] shadow-[0_12px_30px_-10px_rgba(16,28,40,0.35)] text-slate-800 dark:text-slate-100">
        {done ? (
          <div className="p-3.5" data-guide-done="">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center"><Check size={13} strokeWidth={3} /></span>
              <p className="flex-1 text-[13px] font-semibold leading-snug">Done: that&rsquo;s your first drawing and quote.</p>
              <button type="button" onClick={onClose} aria-label="Close" title="Close"
                className="shrink-0 -mt-0.5 -mr-0.5 w-6 h-6 rounded-md flex items-center justify-center bg-[var(--action)] hover:bg-[var(--action-hover)] text-[color:var(--action-ink)]">
                <X size={13} />
              </button>
            </div>
            <button type="button" onClick={onRealJob}
              className="mt-3 w-full h-10 rounded-lg bg-[var(--action)] hover:bg-[var(--action-hover)] text-[color:var(--action-ink)] text-[13px] font-semibold">
              Start a real job
            </button>
          </div>
        ) : (
          <div className="px-3.5 pt-3 pb-2.5">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-[12.5px] font-semibold">Your first drawing</span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">{doneCount(guide)} of {GUIDE_STEPS.length}</span>
            </div>
            <ol className="space-y-1.5">
              {GUIDE_STEPS.map((s, i) => {
                const ok = stepDone(guide, s);
                return (
                  <li key={s} data-guide-step={s} data-done={ok ? "" : undefined} className="flex items-start gap-2">
                    {ok ? (
                      <span className="mt-px shrink-0 w-[18px] h-[18px] rounded-full bg-emerald-600 text-white flex items-center justify-center" aria-label="Done"><Check size={12} strokeWidth={3} /></span>
                    ) : (
                      <span className={`mt-px shrink-0 w-[18px] h-[18px] rounded-full ring-[1.5px] ${s === next ? "ring-slate-700 dark:ring-slate-200" : "ring-slate-300 dark:ring-slate-600"} text-[10px] font-semibold flex items-center justify-center text-slate-500`}>{i + 1}</span>
                    )}
                    <span className={`text-[11.5px] leading-snug ${ok ? "text-slate-400 dark:text-slate-500 line-through decoration-slate-300" : s === next ? "font-semibold" : "text-slate-600 dark:text-slate-300"}`}>{GUIDE_TEXT[s]}</span>
                  </li>
                );
              })}
            </ol>
            <div className="mt-2 text-right">
              <button type="button" onClick={onHide} className="text-[11px] text-slate-500 dark:text-slate-400 underline underline-offset-2 hover:text-slate-800 dark:hover:text-slate-100">Hide guide</button>
            </div>
          </div>
        )}
      </div>
      {hint && <GuideHint kind={hint} onDismiss={() => onHintOff(hint)} />}
    </>
  );
}

const HINT_TEXT = {
  palette: "Drag a socket or light from here onto your plan.",
  quote: "Open Quote: everything you’ve placed is already counted in.",
};

// One small dark note with an arrow: at the symbol list (pointing left, just
// below the tool buttons so it never covers them), or under the Quote button
// (pointing up). Follows them if the layout moves; not shown if its target
// isn't on screen.
function GuideHint({ kind, onDismiss }) {
  const [pos, setPos] = useState(null);
  useEffect(() => {
    const place = () => {
      const vw = window.innerWidth;
      if (kind === "quote") {
        const b = document.querySelector('[data-guide="quote"]');
        const r = b && b.getBoundingClientRect();
        if (!r || !r.width) { setPos(null); return; }
        const W = 252, cx = r.left + r.width / 2;
        const left = Math.max(8, Math.min(vw - W - 8, cx - 30));
        setPos({ left, top: r.bottom + 12, width: W, arrow: "up", arrowX: cx - left });
        return;
      }
      const p = document.querySelector("[data-palette-scroll]");
      const pr = p && p.getBoundingClientRect();
      if (!pr || !pr.width) { setPos(null); return; }
      const t = document.querySelector("[data-tools-labelled]");
      const tr = t && t.getBoundingClientRect();
      const top = Math.max(pr.top + 40, tr && tr.height ? tr.bottom + 18 : 0);
      setPos({ left: pr.right + 14, top, width: 236, arrow: "left" });
    };
    place();
    const iv = setInterval(place, 500);
    window.addEventListener("resize", place);
    return () => { clearInterval(iv); window.removeEventListener("resize", place); };
  }, [kind]);
  if (!pos || typeof document === "undefined") return null;
  return createPortal(
    <div role="note" data-guide-hint={kind}
      // height: app/globals.css makes every top-level div full height.
      style={{ position: "fixed", left: pos.left, top: pos.top, width: pos.width, height: "auto", zIndex: 40 }}
      className="rounded-lg bg-[#1A2530] text-white shadow-[0_10px_26px_-8px_rgba(0,0,0,0.5)] pl-3 pr-1.5 py-2 flex items-start gap-2">
      {pos.arrow === "up" ? (
        <span aria-hidden="true" className="absolute -top-[7px] w-0 h-0 border-x-[7px] border-x-transparent border-b-[7px] border-b-[#1A2530]" style={{ left: pos.arrowX - 7 }} />
      ) : (
        <span aria-hidden="true" className="absolute top-3 -left-[7px] w-0 h-0 border-y-[7px] border-y-transparent border-r-[7px] border-r-[#1A2530]" />
      )}
      <span className="flex-1 text-[12.5px] leading-snug font-medium pt-px">{HINT_TEXT[kind]}</span>
      <button type="button" onClick={onDismiss} aria-label="Close tip" title="Close tip"
        className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center bg-[var(--action)] hover:bg-[var(--action-hover)] text-[color:var(--action-ink)]">
        <X size={13} />
      </button>
    </div>,
    document.body,
  );
}
