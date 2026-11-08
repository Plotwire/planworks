"use client";

import React, { useMemo, useState } from "react";
import { Archive, Pencil, Plus, RotateCcw, Save, X } from "lucide-react";
import { addJob, changeJob } from "@/lib/timesheets/lists";
import { byJobNumber, byWorkTypeOrder, cleanJob, saveErrorMessage, LIMITS } from "@/lib/timesheets/rules";

const BLANK = { job_number: "", job_name: "", site_address: "", default_work_type_id: "" };
const DUPLICATE = "That job number is already in use, on this list or on an archived job.";

export default function JobsPanel({ ownerId, jobs, types, onSaved }) {
  const [form, setForm] = useState(null); // null: closed. With an id: editing.
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [rowBusy, setRowBusy] = useState(null);
  const [rowError, setRowError] = useState("");

  const typeName = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);
  const archivedCount = jobs.filter((j) => j.status === "archived").length;
  const shown = jobs.filter((j) => showArchived || j.status === "active").sort(byJobNumber);

  // Active work types, plus the one this job already has if it's been archived.
  const choices = types
    .filter((t) => t.active || t.id === form?.default_work_type_id)
    .sort(byWorkTypeOrder);

  const open = (next) => { setForm(next); setError(""); setRowError(""); };
  const set = (key, value) => { setForm((f) => ({ ...f, [key]: value })); if (error) setError(""); };

  const save = async (e) => {
    e.preventDefault();
    if (busy) return;
    const { value, error: problem } = cleanJob(form);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError("");
    try {
      onSaved(form.id ? await changeJob(form.id, value) : await addJob(ownerId, value));
      setForm(null);
    } catch (err) {
      setError(saveErrorMessage(err, DUPLICATE));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (job, status) => {
    setRowBusy(job.id);
    setRowError("");
    try {
      onSaved(await changeJob(job.id, { status }));
    } catch (err) {
      setRowError(saveErrorMessage(err, DUPLICATE));
    } finally {
      setRowBusy(null);
    }
  };

  return (
    <>
      <div className="ts-tools">
        <button type="button" className="ts-btn" onClick={() => open({ ...BLANK })} disabled={Boolean(form)}>
          <Plus size={16} strokeWidth={2}/><span>Add job</span>
        </button>
        {archivedCount > 0 && (
          <label className="ts-check">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)}/>
            Show archived ({archivedCount})
          </label>
        )}
      </div>

      {form && (
        <form className="ts-form" onSubmit={save}>
          <label className="ts-field">
            <span className="ts-label">Job number</span>
            <input type="text" value={form.job_number} maxLength={LIMITS.jobNumber} placeholder="e.g. 001" disabled={busy}
              autoFocus onChange={(e) => set("job_number", e.target.value)}/>
          </label>
          <label className="ts-field">
            <span className="ts-label">Job name</span>
            <input type="text" value={form.job_name} maxLength={LIMITS.jobName} disabled={busy}
              onChange={(e) => set("job_name", e.target.value)}/>
          </label>
          <label className="ts-field is-wide">
            <span className="ts-label">Site address (optional)</span>
            <input type="text" value={form.site_address || ""} maxLength={LIMITS.siteAddress} disabled={busy}
              onChange={(e) => set("site_address", e.target.value)}/>
          </label>
          <label className="ts-field is-wide">
            <span className="ts-label">Default work type</span>
            <select value={form.default_work_type_id || ""} disabled={busy} onChange={(e) => set("default_work_type_id", e.target.value)}>
              <option value="">Choose a work type</option>
              {choices.map((t) => <option key={t.id} value={t.id}>{t.name}{t.active ? "" : " (archived)"}</option>)}
            </select>
          </label>
          {error && <div className="ts-error" role="alert">{error}</div>}
          <div className="ts-form-actions">
            <button type="button" className="ts-btn" onClick={() => open(null)} disabled={busy}><X size={16} strokeWidth={2}/><span>Cancel</span></button>
            <button type="submit" className="ts-btn" disabled={busy}><Save size={16} strokeWidth={1.9}/><span>{busy ? "Saving…" : "Save job"}</span></button>
          </div>
        </form>
      )}

      {rowError && <div className="ts-error" role="alert">{rowError}</div>}

      {shown.length === 0 ? (
        <div className="ts-empty">No jobs yet. Add your first job so your team can record hours against it.</div>
      ) : (
        <div className="ts-list">
          {shown.map((j) => {
            const type = typeName.get(j.default_work_type_id);
            const archived = j.status === "archived";
            return (
              <div key={j.id} className={"ts-row is-job" + (archived ? " is-archived" : "")}>
                <div className="ts-num">{j.job_number}</div>
                <div>
                  <div className="ts-name">{j.job_name}{archived && <span className="ts-badge">Archived</span>}</div>
                  {j.site_address && <div className="ts-sub">{j.site_address}</div>}
                </div>
                <div className="ts-type">{type ? `${type.name}${type.active ? "" : " (archived)"}` : "No default"}</div>
                <div className="ts-actions">
                  <button type="button" className="ts-btn is-small" disabled={Boolean(form) || rowBusy === j.id} onClick={() => open({ ...j })}>
                    <Pencil size={14} strokeWidth={2}/><span>Edit</span>
                  </button>
                  <button type="button" className="ts-btn is-small" disabled={rowBusy === j.id} onClick={() => setStatus(j, archived ? "active" : "archived")}>
                    {archived ? <RotateCcw size={14} strokeWidth={2}/> : <Archive size={14} strokeWidth={2}/>}
                    <span>{archived ? "Restore" : "Archive"}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="ts-hint">Your team can only pick active jobs. Archived jobs stay on the timesheets they were used on, and renaming a job doesn&rsquo;t change hours already recorded.</p>
    </>
  );
}
