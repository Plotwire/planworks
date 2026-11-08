"use client";

import React, { useEffect } from "react";
import { Save, X } from "lucide-react";
import { StatusIcon } from "@/components/StatusMark";

// Shared pieces of the owner's Timesheets screens. The styles are in
// TimesheetsHome.jsx.

export function Alert({ children }) {
  return (
    <div className="ts-alert" role="alert">
      <StatusIcon tone="red" size={18} />
      <span>{children}</span>
    </div>
  );
}

export function CardHead({ title, sub, children }) {
  return (
    <div className="ts-card-head">
      <div>
        <h2>{title}</h2>
        <p>{sub}</p>
      </div>
      <div className="ts-card-tools">{children}</div>
    </div>
  );
}

export function EmptyState({ icon, title, text, children }) {
  return (
    <div className="ts-empty">
      <span className="ts-empty-ic">{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}

export function ShowArchived({ count, checked, onChange }) {
  if (count === 0) return null;
  return (
    <label className="ts-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      Show archived ({count})
    </label>
  );
}

// A form in a dialog. Clicking outside doesn't close it, so nothing typed is
// lost by a stray tap. Escape and Cancel do.
export function Dialog({ title, icon, busy, error, saveLabel, onCancel, onSubmit, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div className="ts-dialog-back">
      <form className="ts-dialog" role="dialog" aria-modal="true" aria-label={title} onSubmit={onSubmit} noValidate>
        <div className="ts-dialog-head">
          <span className="ts-ic">{icon}</span>
          <h2>{title}</h2>
        </div>
        <div className="ts-dialog-body">{children}</div>
        {error && <Alert>{error}</Alert>}
        <div className="ts-dialog-actions">
          <button type="button" className="ts-btn" onClick={onCancel} disabled={busy}>
            <X strokeWidth={2.1} /><span>Cancel</span>
          </button>
          <button type="submit" className="ts-btn" disabled={busy}>
            <Save strokeWidth={1.9} /><span>{busy ? "Saving…" : saveLabel}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
