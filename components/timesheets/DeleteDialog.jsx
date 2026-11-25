"use client";

import React, { useEffect, useRef, useState } from "react";
import { FileSpreadsheet, Trash2 } from "lucide-react";
import { StatusIcon } from "@/components/StatusMark";
import Turnstile, { TURNSTILE_SITE_KEY, captchaPending } from "@/components/Turnstile";
import { verifyPassword } from "@/lib/db";
import { previewDelete, deleteThing, listEntriesFor, listTeam } from "@/lib/timesheets/entries";
import { deleteWarning, deleteTitle, deleteErrorMessage } from "@/lib/timesheets/deleting";
import { timesheetWorkbook, xlsxFileName, XLSX_TYPE } from "@/lib/timesheets/workbook";

// Deleting in Timesheets (a job, a work type, a removed worker's record, one
// entry) is permanent, so it works like deleting a drawing: it asks for the
// account password, and nothing is deleted until that's right. First it says
// exactly what goes (the database counts it), with "Download Excel first"
// for those hours. The database decides what may be deleted
// (supabase/timesheets-delete.sql).
//
// kind: job | work_type | worker | entry. id: the thing's id. label: how it's
// named in the title. name / date: the worker and day, for the wording.
export default function DeleteDialog({ kind, id, label, name, date, onCancel, onDeleted }) {
  const [preview, setPreview] = useState(null);
  const [problem, setProblem] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState("");
  const inputRef = useRef(null);
  const turnstile = useRef(null);
  const [captchaToken, setCaptchaToken] = useState(null);
  const [captchaStatus, setCaptchaStatus] = useState(TURNSTILE_SITE_KEY ? "pending" : "off");

  useEffect(() => {
    let live = true;
    previewDelete(kind, id)
      .then((p) => { if (live) setPreview(p); })
      .catch((err) => { if (live) setProblem(deleteErrorMessage(err)); });
    return () => { live = false; };
  }, [kind, id]);
  useEffect(() => { if (preview) inputRef.current?.focus(); }, [preview]);

  // Escape cancels, but not mid-delete.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  // Exactly the hours this delete takes, as an Excel file.
  const downloadFirst = async () => {
    setSaving(true);
    setSaved("");
    try {
      const [rows, team] = await Promise.all([listEntriesFor(kind, id), listTeam()]);
      const names = new Map(team.map((o) => [o.id, o.name]));
      const from = preview.from || rows[0]?.work_date;
      const to = preview.to || rows[rows.length - 1]?.work_date;
      const blob = new Blob([timesheetWorkbook(rows, names, from, to)], { type: XLSX_TYPE });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = xlsxFileName(from, to).replace(/\.xlsx$/, "-before-delete.xlsx");
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setSaved(`Downloaded ${rows.length} ${rows.length === 1 ? "entry" : "entries"}.`);
    } catch {
      setSaved("Couldn't download. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (busy || !preview) return;
    setBusy(true);
    setError("");
    // 1. Password first. A wrong one never reaches the delete.
    const check = await verifyPassword(password, captchaToken);
    turnstile.current?.reset();
    if (!check.ok) {
      setBusy(false); setPassword(""); setError(check.message);
      inputRef.current?.focus();
      return;
    }
    // 2. Then delete exactly what this dialog named.
    try {
      const result = await deleteThing(kind, id);
      setPassword("");
      onDeleted(result);
    } catch (err) {
      setBusy(false); setPassword("");
      setError(deleteErrorMessage(err));
    }
  };

  const lines = preview ? deleteWarning(kind, preview, { name, date }) : [];
  const hasHours = Number(preview?.entries) > 0;

  return (
    <div className="ts-dialog-back">
      <form className="ts-dialog ts-delete" role="dialog" aria-modal="true" aria-labelledby="ts-del-title" onSubmit={submit} noValidate>
        <div className="ts-dialog-head">
          <span className="ts-ic is-danger"><Trash2 size={19} strokeWidth={1.9} /></span>
          <h2 id="ts-del-title">{deleteTitle(kind, label)}</h2>
        </div>

        {problem ? (
          <div className="ts-alert" role="alert"><StatusIcon tone="red" size={18} /><span>{problem}</span></div>
        ) : !preview ? (
          <p className="ts-delete-text">Checking what this would delete…</p>
        ) : (
          <>
            <div className="ts-delete-warning">
              {lines.map((line, i) => <p key={i} className={i === lines.length - 1 ? "is-final" : ""}>{line}</p>)}
            </div>
            {hasHours && (
              <div className="ts-delete-save">
                <button type="button" className="ts-btn" onClick={downloadFirst} disabled={saving || busy}>
                  <FileSpreadsheet strokeWidth={2} /><span>{saving ? "Preparing…" : "Download Excel first"}</span>
                </button>
                {saved && <span role="status">{saved}</span>}
              </div>
            )}
            <label className="ts-field">
              <span className="ts-label">Enter your account password to confirm</span>
              <input ref={inputRef} type="password" autoComplete="current-password" value={password} disabled={busy}
                     onChange={(ev) => { setPassword(ev.target.value); if (error) setError(""); }} />
            </label>
            <Turnstile ref={turnstile} action="delete" onToken={setCaptchaToken} onStatus={setCaptchaStatus} />
            {error && <div className="ts-alert" role="alert"><StatusIcon tone="red" size={18} /><span>{error}</span></div>}
          </>
        )}

        <div className="ts-dialog-actions">
          <button type="button" className="ts-btn is-quiet" onClick={onCancel} disabled={busy}>Cancel</button>
          {!problem && (
            <button type="submit" className="ts-btn is-danger"
                    disabled={busy || !preview || !password || captchaPending(captchaStatus)}>
              <Trash2 strokeWidth={2} /><span>{busy ? "Deleting…" : "Delete permanently"}</span>
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
