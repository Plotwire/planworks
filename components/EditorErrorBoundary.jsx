"use client";
import React from "react";

const DRAFT_KEY = "planworks:draft:v1";

// Catches render errors in the editor so a crash shows a recovery screen
// (with the local backup and the error text) instead of a blank document.
export default class EditorErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    try { console.error("Plotwire editor crashed:", error, info && info.componentStack); } catch (e) {}
  }
  downloadBackup = () => {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) { alert("No local backup was found on this device."); return; }
      const draft = JSON.parse(raw);
      const proj = draft.project || draft;
      const data = JSON.stringify(proj, null, 2);
      const blob = new Blob([data], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const nm = ((proj.meta && proj.meta.projectName) || "plotwire-recovery").replace(/[^a-z0-9-_]+/gi, "_");
      a.download = nm + "_recovery.json";
      a.click();
    } catch (e) {
      alert("Couldn't read the local backup.");
    }
  };
  render() {
    if (this.state.error) {
      return (
        <div className="w-full h-screen flex items-center justify-center bg-[#F4F6F9] dark:bg-[#0B1117] p-6">
          <div className="max-w-md w-full bg-white dark:bg-[#16202B] rounded-2xl ring-1 ring-slate-200 dark:ring-[#263441] shadow-xl p-6 text-center">
            <div className="text-[10px] tracking-[0.3em] uppercase text-[#22808F] mb-2">Plotwire</div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Something went wrong</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">
              The drawing hit an error, but your most recent work is saved locally on this device.
            </p>
            <p className="text-[11px] text-slate-400 mb-4">Download a backup first, then reload.</p>
            <div className="text-left text-[10px] font-mono bg-slate-50 dark:bg-black/30 text-slate-500 rounded-lg p-2 mb-4 max-h-28 overflow-auto break-words">
              {String((this.state.error && this.state.error.message) || this.state.error)}
            </div>
            <div className="flex gap-2 justify-center">
              <button onClick={this.downloadBackup}
                className="px-4 py-2 rounded-lg bg-[var(--action)] text-[color:var(--action-ink)] text-xs font-semibold uppercase tracking-wider hover:bg-[var(--action-hover)]">
                Download backup
              </button>
              <button onClick={() => window.location.reload()}
                className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-200 text-xs font-semibold uppercase tracking-wider hover:bg-slate-200 dark:hover:bg-white/20">
                Reload
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
