"use client";

import React from "react";
import { StatusIcon } from "@/components/StatusMark";

/* ============================================================================
 * A part of the app this device hasn't downloaded yet, opened with no signal.
 * The service worker keeps every code file of the app (public/sw.js), and the
 * dashboard only says "ready for working without signal" once it has. If one
 * is missing all the same (the app was opened with no signal straight after
 * an update, or storage was cleared), this says so plainly instead of the
 * editor's "Something went wrong" crash screen.
 * ========================================================================== */

export const NEEDS_SIGNAL = "This part of Plotwire needs signal once to download.";
const DETAIL = "It hasn't been downloaded to this device yet. Open it once with signal and it works without signal from then on. Your drawings and saves are safe on this device.";
export const NEEDS_SIGNAL_ALERT = `${NEEDS_SIGNAL}\n\n${DETAIL}`;

// A code file that couldn't be loaded: webpack's ChunkLoadError (scripts and
// style sheets), or the browser's own wording for a module import.
export function isMissingCode(err) {
  if (!err) return false;
  if (err.name === "ChunkLoadError") return true;
  return /Loading (CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i
    .test(String(err.message || err));
}

const BTN = "h-10 px-4 rounded-[10px] text-[13px] font-semibold bg-[var(--action)] hover:bg-[var(--action-hover)] text-[color:var(--action-ink)] transition-colors";

// Full screen (a page), or filling its box (a panel: onClose shown as Close).
export function NeedsSignalScreen({ onClose = null }) {
  const home = typeof window !== "undefined" && window.location.pathname === "/";
  return (
    <div className={`${onClose ? "w-full h-full" : "w-full min-h-screen"} flex items-center justify-center bg-[#F4F6F9] dark:bg-[#0B1117] p-6`}>
      <div role="alert" className="max-w-md w-full bg-white dark:bg-[#16202B] rounded-2xl ring-1 ring-slate-200 dark:ring-[#263441] shadow-xl p-6 text-center">
        {/* Red warning: needs signal (components/StatusMark.jsx). */}
        <div className="flex items-center justify-center gap-2 mb-3">
          <StatusIcon tone="red" size={28} />
          <span className="text-[11px] tracking-[0.2em] uppercase font-bold text-[#B91C1C] dark:text-[#F87171]">Needs signal</span>
        </div>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">{NEEDS_SIGNAL}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">{DETAIL}</p>
        <div className="flex gap-2 justify-center flex-wrap">
          <button type="button" className={BTN} onClick={() => window.location.reload()}>Try again</button>
          {onClose
            ? <button type="button" className={BTN} onClick={onClose}>Close</button>
            : !home && <button type="button" className={BTN} onClick={() => { window.location.href = "/"; }}>Dashboard</button>}
        </div>
      </div>
    </div>
  );
}

// Around a part loaded on demand (next/dynamic): a missing code file shows
// NeedsSignalScreen; any other error goes on to the boundary above, as before.
export class NeedsSignalBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (!isMissingCode(error)) throw error;
    return <NeedsSignalScreen onClose={this.props.onClose ? () => { this.setState({ error: null }); this.props.onClose(); } : null} />;
  }
}
