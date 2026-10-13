"use client";

/* ============================================================================
 * SYMBOL LIBRARY — choose which symbols the drawing editor's picker offers.
 *
 * Every approved symbol, by category, with previews, search, category filters
 * and presets. Ticks save to the account's settings (AppShell saveSymbolPicks
 * -> user_settings.data.symbolLibrary). Ticks only change the PICKER: a symbol
 * already on a drawing shows, prints, exports and counts whether it's ticked
 * or not (lib/symbolLibrary.js).
 *
 * Used as the /symbols page and, from the editor's "More symbols…" link, as a
 * window over the editor (modal) so an open drawing is never left.
 * Newly approved symbols carry a "New" badge; they are never ticked for anyone
 * until the account ticks them. Draft symbols are never offered; development
 * builds can show them, greyed out and not tickable, for review.
 * ========================================================================= */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Shapes, X, Search, Undo2 } from "lucide-react";
import { useApp } from "@/components/AppShell";
import { LIBRARY_CATEGORIES, SYMBOL_META, VIEWBOX, resolveColours } from "@/lib/symbols";
import { librarySymbols, PRESETS, presetPicks, allPicks, picksFromSettings } from "@/lib/symbolLibrary";

const DEV = process.env.NODE_ENV !== "production";
const HAS_DRAFTS = librarySymbols({ drafts: true }).some((s) => s.draft);
const SAVE_DELAY = 600;

function Preview({ sym, size = 44 }) {
  const cols = resolveColours(sym.id, "colour");
  return (
    <svg viewBox={VIEWBOX} width={size} height={size} aria-hidden="true"
         style={{ color: cols.body, "--feeder": cols.feeder, flex: "none" }}>
      {sym.svg}
    </svg>
  );
}

export default function SymbolLibrary({ onClose, modal = false }) {
  const { symbolLibrary, saveSymbolPicks } = useApp();
  const symbolPicks = useMemo(() => picksFromSettings(symbolLibrary), [symbolLibrary]);
  const [picks, setPicks] = useState(() => new Set(symbolPicks));
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("all");
  const [showDrafts, setShowDrafts] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | pending | saving | saved | error
  const [undo, setUndo] = useState(null);       // { label, picks } after a preset

  // The account's saved ticks can arrive after this opens (first load).
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) setPicks(new Set(symbolPicks));
  }, [symbolPicks]);

  const symbols = useMemo(() => librarySymbols({ drafts: DEV && showDrafts }), [showDrafts]);
  const offered = useMemo(() => librarySymbols(), []);

  /* ---- Saving: debounced, one at a time, never lost on close ------------- */
  const latest = useRef(null);
  const timer = useRef(null);
  const busy = useRef(false);
  const flush = async () => {
    clearTimeout(timer.current);
    timer.current = null;
    if (busy.current || !latest.current || !saveSymbolPicks) return;
    const next = latest.current;
    latest.current = null;
    busy.current = true;
    setStatus("saving");
    try {
      await saveSymbolPicks(next);
      busy.current = false;
      if (latest.current) flush(); else setStatus("saved");
    } catch (err) {
      busy.current = false;
      if (!latest.current) latest.current = next; // keep it for Try again
      setStatus("error");
      console.warn("Symbol Library save failed:", err?.message || err);
    }
  };
  const change = (nextSet) => {
    touched.current = true;
    setPicks(nextSet);
    // Saved in catalogue order, so the stored list reads sensibly.
    latest.current = offered.map((s) => s.id).filter((id) => nextSet.has(id));
    setStatus("pending");
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY);
  };
  useEffect(() => () => {
    // Closing with a change still waiting: save it now.
    if (timer.current) { clearTimeout(timer.current); if (latest.current && saveSymbolPicks) saveSymbolPicks(latest.current).catch(() => {}); }
  }, [saveSymbolPicks]);

  // Over the editor: Escape or a click outside the sheet closes it.
  useEffect(() => {
    if (!modal || !onClose) return;
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [modal, onClose]);

  const toggle = (id) => {
    const next = new Set(picks);
    if (next.has(id)) next.delete(id); else next.add(id);
    setUndo(null);
    change(next);
  };
  const setMany = (ids, on) => {
    const next = new Set(picks);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    setUndo(null);
    change(next);
  };
  const applyPreset = (label, ids) => {
    setUndo({ label, picks: [...picks] });
    change(new Set(ids));
  };

  /* ---- What shows ---------------------------------------------------------- */
  const q = query.trim().toLowerCase();
  const matches = (s) => !q || [s.name, s.code, SYMBOL_META[s.id]?.description, s.materials].some((t) => String(t || "").toLowerCase().includes(q));
  const visible = symbols.filter((s) => (cat === "all" || s.category === cat) && matches(s));
  const sections = LIBRARY_CATEGORIES
    .map((c) => ({ ...c, items: visible.filter((s) => s.category === c.key) }))
    .filter((c) => c.items.length || (cat === c.key && !q));
  const countIn = (key) => symbols.filter((s) => s.category === key).length;
  const ticked = offered.filter((s) => picks.has(s.id)).length;

  const statusText = {
    idle: "", pending: "Saving…", saving: "Saving…", saved: "Saved",
    error: "Couldn’t save. Your ticks are still here.",
  }[status];

  const body = (
    <div className={"pw-lib" + (modal ? " is-modal" : "")} role={modal ? "dialog" : undefined} aria-modal={modal || undefined} aria-label="Symbol library"
         onMouseDown={modal && onClose ? (e) => { if (e.target === e.currentTarget) onClose(); } : undefined}>
      <style>{CSS}</style>
      <div className="lib-sheet">
        <header className="lib-head">
          <div className="lib-head-l">
            <span className="lib-ic"><Shapes size={19} strokeWidth={1.8}/></span>
            <div>
              <h1>Symbol library</h1>
              <p>Tick the symbols you want in the drawing editor. A symbol already on a drawing always shows, prints and counts, ticked or not.</p>
            </div>
          </div>
          <div className="lib-head-r">
            <span className={"lib-status" + (status === "error" ? " is-error" : "")} aria-live="polite">
              {statusText}
              {status === "error" && <button type="button" className="lib-link" onClick={flush}>Try again</button>}
            </span>
            {onClose && (
              <button type="button" className="lib-close" onClick={onClose} title={modal ? "Back to the drawing" : "Back to dashboard"} aria-label={modal ? "Back to the drawing" : "Back to dashboard"}>
                <X size={19} strokeWidth={2}/>
              </button>
            )}
          </div>
        </header>

        <div className="lib-tools">
          <label className="lib-search">
            <Search size={15} strokeWidth={2}/>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, code or material" aria-label="Search symbols"/>
            {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X size={14}/></button>}
          </label>
          <span className="lib-count"><b>{ticked}</b> of {offered.length} ticked</span>
        </div>

        <div className="lib-presets">
          <span className="lib-label">Presets</span>
          {PRESETS.map((p) => (
            <button key={p.key} type="button" className="lib-chip" onClick={() => applyPreset(p.label, presetPicks(p.key))}>{p.label}</button>
          ))}
          <button type="button" className="lib-chip" onClick={() => applyPreset("Select all", allPicks())}>Select all</button>
          <button type="button" className="lib-chip" onClick={() => applyPreset("Clear all", [])}>Clear all</button>
          {undo && (
            <span className="lib-undo">
              {undo.label} applied.
              <button type="button" className="lib-link" onClick={() => { const back = new Set(undo.picks); setUndo(null); change(back); }}>
                <Undo2 size={13}/> Undo
              </button>
            </span>
          )}
        </div>

        <div className="lib-cats" role="tablist" aria-label="Categories">
          <button type="button" role="tab" aria-selected={cat === "all"} className="lib-cat" onClick={() => setCat("all")}>All <i>{symbols.length}</i></button>
          {LIBRARY_CATEGORIES.map((c) => (
            <button key={c.key} type="button" role="tab" aria-selected={cat === c.key} className="lib-cat" onClick={() => setCat(c.key)}>
              {c.label} <i>{countIn(c.key)}</i>
            </button>
          ))}
          {DEV && HAS_DRAFTS && (
            <label className="lib-dev" title="Development builds only: draft symbols are never offered to users">
              <input type="checkbox" checked={showDrafts} onChange={(e) => setShowDrafts(e.target.checked)}/> Show drafts
            </label>
          )}
        </div>

        <div className="lib-body">
          {!sections.length && <div className="lib-empty">No symbols match &ldquo;{query}&rdquo;.</div>}
          {sections.map((c) => {
            const tickable = c.items.filter((s) => !s.draft).map((s) => s.id);
            const on = tickable.filter((id) => picks.has(id)).length;
            return (
              <section key={c.key} className="lib-sec">
                <div className="lib-sec-head">
                  <h2>{c.label}</h2>
                  <span className="lib-sec-n">{on} of {tickable.length} ticked</span>
                  {tickable.length > 0 && (
                    <span className="lib-sec-acts">
                      <button type="button" className="lib-link" onClick={() => setMany(tickable, true)}>Tick all</button>
                      <button type="button" className="lib-link" onClick={() => setMany(tickable, false)}>Untick all</button>
                    </span>
                  )}
                </div>
                {!c.items.length ? (
                  <div className="lib-empty">No symbols in this category yet.</div>
                ) : (
                  <div className="lib-grid">
                    {c.items.map((s) => {
                      const meta = SYMBOL_META[s.id] || {};
                      const isOn = picks.has(s.id);
                      const badge = s.draft ? "Draft" : s.isNew ? "New" : null;
                      return (
                        <label key={s.id} className={"lib-card" + (isOn ? " is-on" : "") + (s.draft ? " is-draft" : "") + (badge ? " has-badge" : "")} title={(meta.description || s.name) + (meta.height ? " · " + meta.height : "")}>
                          <input type="checkbox" checked={isOn} disabled={s.draft} onChange={() => toggle(s.id)} aria-label={s.name + (badge ? " (" + badge.toLowerCase() + ")" : "")}/>
                          <Preview sym={s}/>
                          <span className="lib-card-t">
                            <span className="lib-name">{s.name}</span>
                            <span className="lib-meta"><b>{s.code}</b>{s.materials}</span>
                          </span>
                          {badge && <span className={s.draft ? "lib-draft" : "lib-new"} aria-hidden="true">{badge}</span>}
                        </label>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
  return body;
}

const CSS = `
.pw-lib{position:fixed; inset:0; z-index:1; overflow:auto; padding:28px 20px 48px;
  --teal:#3FB7C9; --teal-600:#2C97A8; --teal-700:#22808F; --navy:#1A2530;
  --paper:#F4F6F9; --surface:#FFFFFF; --line:#E6EBF1; --ink:#0E141B; --ink-2:#3A4654; --muted:#697785; --on:#EAF6F7;
  background:var(--paper); color:var(--ink);
  font-family:var(--font-inter),system-ui,sans-serif; -webkit-font-smoothing:antialiased}
.pw-lib.is-modal{z-index:80; background:rgba(10,20,25,.55); padding:24px 16px}
.pw-lib *{box-sizing:border-box}
html.dark .pw-lib{--paper:#0E141B; --surface:#16202B; --line:#263441; --ink:#E7EDF3; --ink-2:#C3CEDA; --muted:#8B99A8; --on:#123039}
html.dark .pw-lib.is-modal{background:rgba(0,0,0,.6)}

.pw-lib .lib-sheet{max-width:1180px; margin:0 auto; background:var(--surface); border:1px solid var(--line); border-radius:18px; overflow:hidden}
.pw-lib .lib-head{display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:20px 22px; border-bottom:1px solid var(--line)}
.pw-lib .lib-head-l{display:flex; align-items:center; gap:13px; min-width:0}
.pw-lib .lib-head-r{display:flex; align-items:center; gap:14px; flex:none}
.pw-lib .lib-ic{width:40px; height:40px; border-radius:10px; display:flex; align-items:center; justify-content:center; flex:none; background:var(--teal-600); color:var(--navy)}
.pw-lib .lib-ic svg, .pw-lib .lib-close svg{display:block}
.pw-lib h1{margin:0; font-family:var(--font-space-grotesk),system-ui,sans-serif; font-size:18px; font-weight:600; letter-spacing:-.01em}
.pw-lib .lib-head p{margin:2px 0 0; font-size:12.5px; color:var(--muted); max-width:640px}
.pw-lib .lib-close{width:40px; height:40px; flex:none; padding:0; border:0; border-radius:10px; display:flex; align-items:center; justify-content:center; background:var(--teal-600); color:var(--navy); cursor:pointer; transition:background .15s ease}
.pw-lib .lib-close:hover{background:var(--teal-700)}
.pw-lib .lib-status{font-size:12px; color:var(--muted); display:flex; align-items:center; gap:8px}
.pw-lib .lib-status.is-error{color:#c0392b}

.pw-lib .lib-tools{display:flex; align-items:center; gap:16px; flex-wrap:wrap; padding:16px 22px 0}
.pw-lib .lib-search{flex:1 1 320px; max-width:460px; display:flex; align-items:center; gap:8px; height:40px; padding:0 12px; border:1px solid var(--line); border-radius:10px; background:var(--paper); color:var(--muted)}
.pw-lib .lib-search:focus-within{border-color:var(--teal); box-shadow:0 0 0 3px rgba(63,183,201,.18)}
.pw-lib .lib-search input{flex:1; min-width:0; border:0; outline:0; background:transparent; font:inherit; font-size:14px; color:var(--ink)}
.pw-lib .lib-search button{border:0; background:transparent; color:var(--muted); cursor:pointer; display:flex; padding:2px}
.pw-lib .lib-count{font-size:13px; color:var(--ink-2)}
.pw-lib .lib-count b{color:var(--ink)}

.pw-lib .lib-presets{display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:14px 22px 0}
.pw-lib .lib-label{font-size:12px; font-weight:600; color:var(--ink-2); margin-right:2px}
.pw-lib .lib-chip{height:32px; padding:0 13px; border-radius:999px; border:1px solid var(--line); background:var(--surface); color:var(--ink-2); font:inherit; font-size:12.5px; font-weight:600; cursor:pointer; transition:all .15s ease}
.pw-lib .lib-chip:hover{border-color:var(--teal-600); color:var(--ink); background:var(--on)}
.pw-lib .lib-undo{display:inline-flex; align-items:center; gap:8px; font-size:12.5px; color:var(--ink-2); margin-left:6px}
.pw-lib .lib-link{display:inline-flex; align-items:center; gap:4px; border:0; background:transparent; padding:0; font:inherit; font-size:12.5px; font-weight:600; color:var(--teal-700); cursor:pointer}
html.dark .pw-lib .lib-link{color:var(--teal)}
.pw-lib .lib-link:hover{text-decoration:underline}

.pw-lib .lib-cats{display:flex; gap:6px; flex-wrap:wrap; align-items:center; padding:14px 22px 14px; border-bottom:1px solid var(--line)}
.pw-lib .lib-cat{height:30px; padding:0 11px; border-radius:8px; border:1px solid var(--line); background:var(--paper); color:var(--ink-2); font:inherit; font-size:12.5px; font-weight:500; cursor:pointer}
.pw-lib .lib-cat i{font-style:normal; color:var(--muted); margin-left:3px; font-size:11.5px}
.pw-lib .lib-cat[aria-selected="true"]{background:var(--teal-600); border-color:var(--teal-600); color:var(--navy); font-weight:600}
.pw-lib .lib-cat[aria-selected="true"] i{color:var(--navy)}
.pw-lib .lib-dev{margin-left:auto; font-size:12px; color:var(--muted); display:flex; align-items:center; gap:6px}

.pw-lib .lib-body{padding:6px 22px 24px}
.pw-lib .lib-sec{padding-top:16px}
.pw-lib .lib-sec-head{display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; margin-bottom:10px}
.pw-lib h2{margin:0; font-family:var(--font-space-grotesk),system-ui,sans-serif; font-size:15px; font-weight:600}
.pw-lib .lib-sec-n{font-size:12px; color:var(--muted)}
.pw-lib .lib-sec-acts{display:flex; gap:12px; margin-left:auto}
.pw-lib .lib-grid{display:grid; grid-template-columns:repeat(auto-fill, minmax(208px, 1fr)); gap:8px}
.pw-lib .lib-card{position:relative; display:flex; align-items:center; gap:10px; padding:9px 10px; border:1px solid var(--line); border-radius:12px; background:var(--surface); cursor:pointer; transition:border-color .15s ease, background .15s ease}
.pw-lib .lib-card:hover{border-color:rgba(63,183,201,.6)}
.pw-lib .lib-card.is-on{border-color:var(--teal-600); background:var(--on)}
.pw-lib .lib-card.is-draft{cursor:default; opacity:.7; border-style:dashed}
.pw-lib .lib-card.has-badge .lib-card-t{padding-right:36px}
.pw-lib .lib-card input{width:17px; height:17px; flex:none; margin:0; accent-color:var(--teal-600); cursor:inherit}
.pw-lib .lib-card svg{background:#fff; border-radius:8px; padding:2px}
.pw-lib .lib-card-t{display:flex; flex-direction:column; gap:3px; min-width:0}
.pw-lib .lib-name{font-size:12.5px; font-weight:600; color:var(--ink); line-height:1.25; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden}
.pw-lib .lib-meta{font-size:11px; color:var(--muted); line-height:1.3; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.pw-lib .lib-meta b{color:var(--ink-2); margin-right:6px; font-weight:700}
.pw-lib .lib-draft, .pw-lib .lib-new{position:absolute; top:6px; right:7px; font-size:9.5px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--navy); border-radius:4px; padding:1px 5px}
.pw-lib .lib-draft{background:#F2B233}
.pw-lib .lib-new{background:var(--teal-600)}
.pw-lib .lib-empty{padding:18px 4px; font-size:13px; color:var(--muted)}

@media (max-width:640px){
  .pw-lib{padding:12px 8px 32px}
  .pw-lib .lib-head{padding:16px}
  .pw-lib .lib-tools, .pw-lib .lib-presets, .pw-lib .lib-cats, .pw-lib .lib-body{padding-left:14px; padding-right:14px}
  .pw-lib .lib-grid{grid-template-columns:1fr}
}
`;
