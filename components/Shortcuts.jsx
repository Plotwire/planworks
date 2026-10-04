"use client";

/* ============================================================================
 * components/Shortcuts.jsx - keyboard shortcuts made discoverable.
 *
 * Shared by the drawing editor and the Sketch a plan tool: the key labels
 * (platform-aware), the teal key caps, the shortcuts card ("?" or the
 * Shortcuts button), the status bar hints and the sketch's first-run tip.
 * Each screen passes its own lists, written next to its keyboard handler so
 * they stay in step with it; nothing here knows what a key does.
 *
 * Key specs are strings: "mod+shift+z", "e", "esc", "shift+drag". Tokens:
 *   mod (⌘ on Mac / iPad, Ctrl elsewhere), shift, alt, esc, enter, del,
 *   backspace, space, plus, minus, digits (0-9), any single character, and
 *   the mouse words drag / mdrag / wheel (shown as text, not as a key).
 * ========================================================================= */

import React, { useEffect, useRef, useState, useCallback, useId } from "react";
import { createPortal } from "react-dom";
import { Keyboard, X, Hand } from "lucide-react";
import { isTouchDevice } from "@/lib/touch";

// Both screens are client-only, so these are worked out once, like
// CadSketch's PROMOTE. iPadOS reports itself as a Mac, which is what we want.
const nav = typeof navigator !== "undefined" ? navigator : null;
export const IS_MAC = !!nav && (/mac|iphone|ipad|ipod/i.test((nav.userAgentData && nav.userAgentData.platform) || nav.platform || "") || /Mac OS X|iPhone|iPad/.test(nav.userAgent || ""));
// TOUCH: a touch device (lib/touch) whose main pointer is a finger - an iPad,
// a phone. A touch-screen PC driven with a mouse and keyboard (maxTouchPoints
// 10, pointer: fine) gets the keyboard view; the card still offers it both.
const CAN_TOUCH = isTouchDevice();
export const TOUCH = CAN_TOUCH && !(typeof window !== "undefined" && window.matchMedia && window.matchMedia("(pointer: fine)").matches);
// Key badges on toolbar buttons: not on touch (and only from 1300px, in the
// class names). The key is in the tooltip everywhere.
export const SHOW_KBD = !TOUCH;

const MONO = { fontFamily: "var(--font-jetbrains-mono), monospace" };
const NAME = {
  mod: IS_MAC ? "⌘" : "Ctrl", shift: IS_MAC ? "⇧" : "Shift", alt: IS_MAC ? "⌥" : "Alt",
  esc: "Esc", enter: "Enter", del: IS_MAC ? "⌫" : "Del", backspace: IS_MAC ? "⌫" : "Backspace",
  space: "Space", plus: "+", minus: "-", digits: "0–9",
};
const ARIA = { mod: IS_MAC ? "Meta" : "Control", shift: "Shift", alt: "Alt", esc: "Escape", enter: "Enter", del: "Delete", backspace: "Backspace", space: "Space", plus: "+", minus: "-" };
const MOUSE = { drag: "drag", mdrag: "middle-drag", wheel: "scroll wheel" };
const MODS = new Set(["mod", "shift", "alt"]);
const name = (t) => NAME[t] || MOUSE[t] || t.toUpperCase();

// "Ctrl+Shift+Z" / "⌘⇧Z": for tooltips and other plain text.
export function keyText(spec) {
  const t = spec.split("+");
  return IS_MAC && t.slice(0, -1).every((x) => MODS.has(x)) ? t.map(name).join("") : t.map(name).join("+");
}
// For aria-keyshortcuts (keys only; mouse words have no value there).
export function ariaKeys(spec) {
  const t = spec.split("+");
  return t.some((x) => MOUSE[x]) ? undefined : t.map((x) => ARIA[x] || x.toUpperCase()).join("+");
}

// One teal key cap. small: the status bar / tip size.
export function Kbd({ children, small = false }) {
  return (
    <kbd className={`inline-flex items-center justify-center rounded-[5px] bg-[var(--action)] text-[color:var(--action-ink)] font-semibold leading-none align-middle whitespace-nowrap tracking-normal ${
      small ? "min-w-[16px] h-4 px-1 text-[9.5px] shadow-[inset_0_-1px_0_rgba(26,37,48,0.35)]" : "min-w-[22px] h-[22px] px-1.5 text-[11px] shadow-[inset_0_-2px_0_rgba(26,37,48,0.3)]"}`}
      style={MONO}>{children}</kbd>
  );
}

// One combination: caps with "+" between; mouse words as text.
function Combo({ spec, small }) {
  const t = spec.split("+");
  return (
    <span className="inline-flex items-center gap-1 align-middle whitespace-nowrap">
      {t.map((x, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="text-slate-400 dark:text-slate-500 text-[10px]">+</span>}
          {MOUSE[x] ? <span className={`italic ${small ? "" : "text-[11.5px] text-slate-500 dark:text-slate-400"}`}>{MOUSE[x]}</span> : <Kbd small={small}>{name(x)}</Kbd>}
        </React.Fragment>
      ))}
    </span>
  );
}

// Alternatives (a spec or a list of them) with "or" between; ones that read
// the same on this platform (Del / Backspace on a Mac) are shown once.
export function KeyAlts({ keys, small = false }) {
  const list = (Array.isArray(keys) ? keys : [keys]).filter((k, i, a) => a.findIndex((o) => keyText(o) === keyText(k)) === i);
  return (
    <span className="inline-flex items-center gap-1.5 align-middle whitespace-nowrap">
      {list.map((k, i) => (
        <React.Fragment key={k}>
          {i > 0 && <span className="text-[10px] text-slate-400 dark:text-slate-500">or</span>}
          <Combo spec={k} small={small} />
        </React.Fragment>
      ))}
    </span>
  );
}

// Status bar hint: parts are plain strings or [keys, text] pairs, shown as
// "[Key] text" and joined with " · ". Clipped with an ellipsis (it gives way
// to the right-hand read-out, never the other way round).
export function StatusHint({ parts }) {
  return (
    <span className="min-w-0 truncate text-[#22808F] dark:text-[#3FB7C9]">
      {parts.filter(Boolean).map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="mx-1.5 text-slate-400 dark:text-slate-500">·</span>}
          {typeof p === "string" ? p : <><KeyAlts keys={p[0]} small />{p[1] ? " " + p[1] : null}</>}
        </React.Fragment>
      ))}
    </span>
  );
}

// Fired on document when the card opens: an open top-bar menu (SheetParts
// TbMenu) closes rather than sit under the card and outlive it.
export const CLOSE_MENUS = "plotwire:close-menus";

// Swallows the repeats of a held key (from window, capture) until it is let go
// (matched by e.code: "?" comes up as "/" if Shift is released first).
function holdUntilUp(code) {
  const down = (e) => { if (e.code === code && e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); } };
  const up = (e) => { if (e.type === "blur" || e.code === code) { window.removeEventListener("keydown", down, true); window.removeEventListener("keyup", up, true); window.removeEventListener("blur", up); } };
  window.addEventListener("keydown", down, true);
  window.addEventListener("keyup", up, true);
  window.addEventListener("blur", up);
}

/* ----------------------------------------------------------------------------
 * The shortcuts card
 * ----------------------------------------------------------------------------
 * A centred card over a light scrim (not a page): navy header, the groups in
 * two columns at desktop widths, one when narrow, scrolling inside when the
 * window is short. Esc, "?", the X or a click outside closes it.
 *
 * groups:      [{ title, items: [[label, keys]] }]       keys: see KeyAlts
 * touchGroups: [{ title, items: [[label, gesture]] }]    shown on touch devices
 * A group with no items is left out. On anything with a touch screen the
 * footer switches between the two lists (an iPad with a keyboard, a touch PC).
 *
 * While it is open it owns the keyboard: a capture listener on window takes
 * every key before the screen's own handler, so Esc closes only the card (no
 * cancelled wall, no lost selection) and tool keys, Delete or a typed length
 * wait until it is closed. ⌘/Ctrl+S and P are held too, so the browser's own
 * Save page / Print never open in their place.
 * ------------------------------------------------------------------------- */
export function ShortcutsCard({ open, onClose, subtitle = null, groups = [], touchGroups = null }) {
  const [touchView, setTouchView] = useState(TOUCH && !!touchGroups);
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();

  useEffect(() => { if (open) setTouchView(TOUCH && !!touchGroups); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const back = document.activeElement;
    const onKey = (e) => {
      if (e.key === "Escape" || (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey)) {
        e.preventDefault(); e.stopImmediatePropagation();
        // A held key repeats: the first press closes the card, the repeats
        // are swallowed until it is let go (no flicker, and a held Esc does
        // not go on to cancel the wall underneath).
        if (!e.repeat) { holdUntilUp(e.code); closeRef.current(); }
        return;
      }
      if (e.key === "Tab") {
        // Keep focus in the card.
        const f = [...panelRef.current.querySelectorAll("button, [href], [tabindex]:not([tabindex='-1'])")];
        if (!f.length) { e.preventDefault(); return; }
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
      }
      if ((e.ctrlKey || e.metaKey) && /^[sp]$/i.test(e.key)) e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    document.dispatchEvent(new Event(CLOSE_MENUS));
    panelRef.current && panelRef.current.focus();
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (back && back !== document.body && back.focus && document.contains(back)) back.focus();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  const touch = touchView && !!touchGroups;
  const list = (touch ? touchGroups : groups).filter((g) => g.items && g.items.length);
  const title = touch ? "Touch gestures" : "Keyboard shortcuts";
  const Icon = touch ? Hand : Keyboard;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-3 min-[480px]:p-6 bg-[#0E141B]/35 dark:bg-black/45"
      style={{ fontFamily: "var(--font-inter), ui-sans-serif, system-ui, -apple-system, sans-serif" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className="w-full max-w-[760px] max-h-full flex flex-col rounded-2xl overflow-hidden bg-white dark:bg-[#16202B] ring-1 ring-black/5 dark:ring-[#2A3947] shadow-[0_28px_70px_-24px_rgba(0,0,0,0.55)] outline-none select-text">
        <div className="flex items-center gap-3 pl-5 pr-3 h-14 shrink-0 bg-[#1A2530] dark:bg-[#0E141B] border-b border-black/20 dark:border-[#263441]">
          <span className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center bg-[var(--action)] text-[color:var(--action-ink)]"><Icon size={16} /></span>
          <div className="flex-1 min-w-0">
            <h2 id={titleId} className="text-[15px] font-semibold text-white leading-tight" style={{ fontFamily: "var(--font-space-grotesk), sans-serif" }}>{title}</h2>
            {subtitle && <div className="text-[11px] text-slate-300/80 truncate">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" title="Close (Esc)"
            className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center bg-[var(--action)] hover:bg-[var(--action-hover)] text-[color:var(--action-ink)] transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-3 pb-4 columns-1 min-[700px]:columns-2 gap-x-8">
          {list.map((g) => (
            <section key={g.title} className="break-inside-avoid pt-2 pb-2">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#22808F] dark:text-[#5FD0E0] mb-1">{g.title}</h3>
              <ul>
                {g.items.map(([label, val]) => (
                  <li key={label} className="flex items-center justify-between gap-3 min-h-[34px] py-1 border-b border-slate-100 dark:border-[#22303D] last:border-b-0">
                    <span className="text-[12.5px] leading-snug text-slate-700 dark:text-slate-200">{label}</span>
                    {touch
                      ? <span className="shrink-0 max-w-[55%] text-right text-[11.5px] leading-snug font-medium px-2 py-1 rounded-md bg-[#ECF8FA] text-[#1C6F7C] dark:bg-[#3FB7C9]/15 dark:text-[#5FD0E0]">{val}</span>
                      : <span className="shrink-0"><KeyAlts keys={val} /></span>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="shrink-0 flex items-center justify-between gap-3 px-5 py-2.5 border-t border-slate-200 dark:border-[#263441] bg-slate-50 dark:bg-[#121A23] text-[11px] text-slate-500 dark:text-slate-400">
          <span className="truncate">{touch ? "Tap outside the card to close it." : <>Press <Kbd small>?</Kbd> any time to open this card, <Kbd small>Esc</Kbd> to close it.</>}</span>
          {CAN_TOUCH && touchGroups && (
            <button type="button" onClick={() => setTouchView((v) => !v)}
              className="shrink-0 font-semibold text-[#22808F] dark:text-[#5FD0E0] hover:underline">{touch ? "Keyboard shortcuts" : "Touch gestures"}</button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ----------------------------------------------------------------------------
 * First-run tip
 * ----------------------------------------------------------------------------
 * useOnceTip(key): [show, dismiss]. Shown until dismissed once on this device
 * (localStorage); if storage is unavailable it is hidden for the session.
 * ------------------------------------------------------------------------- */
export function useOnceTip(key) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let seen = false;
    try { seen = window.localStorage.getItem(key) === "1"; } catch { seen = false; }
    setShow(!seen);
  }, [key]);
  const dismiss = useCallback(() => {
    setShow(false);
    try { window.localStorage.setItem(key, "1"); } catch { /* hidden for this session only */ }
  }, [key]);
  return [show, dismiss];
}

// The small card itself; className places it.
export function ShortcutsTip({ onDismiss, onOpen, className = "" }) {
  return (
    <div role="status" className={`absolute z-20 flex items-center gap-2 pl-2 pr-1.5 h-10 rounded-xl bg-white dark:bg-[#16202B] ring-1 ring-slate-200/70 dark:ring-[#2A3947] shadow-[0_10px_30px_-10px_rgba(16,28,40,0.3)] text-[12px] text-slate-700 dark:text-slate-200 whitespace-nowrap ${className}`}>
      <button type="button" onClick={onOpen} title={TOUCH ? "Touch gestures" : "Keyboard shortcuts"}
        className="w-7 h-7 shrink-0 rounded-lg flex items-center justify-center bg-[var(--action)] hover:bg-[var(--action-hover)] text-[color:var(--action-ink)] transition-colors">
        <Keyboard size={14} />
      </button>
      <span className="pl-0.5">{TOUCH ? "Tap the keyboard button for touch gestures" : <>Press <Kbd small>?</Kbd> for keyboard shortcuts</>}</span>
      <button type="button" onClick={onDismiss}
        className="ml-1 h-7 px-2.5 rounded-lg text-[11px] font-semibold bg-[var(--action)] hover:bg-[var(--action-hover)] text-[color:var(--action-ink)] transition-colors">Got it</button>
      <button type="button" onClick={onDismiss} aria-label="Dismiss tip" title="Dismiss"
        className="w-7 h-7 shrink-0 rounded-lg flex items-center justify-center bg-[var(--action)] hover:bg-[var(--action-hover)] text-[color:var(--action-ink)] transition-colors">
        <X size={14} />
      </button>
    </div>
  );
}
