"use client";

import React, { useMemo, useState } from "react";
import { Archive, Briefcase, MapPin, Pencil, Plus, RotateCcw } from "lucide-react";
import { addJob, changeJob } from "@/lib/timesheets/lists";
import { byJobNumber, byWorkTypeOrder, cleanJob, saveErrorMessage, LIMITS } from "@/lib/timesheets/rules";
import { Alert, CardHead, Dialog, EmptyState, ShowArchived } from "@/components/timesheets/parts";

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

  const addButton = (
    <button type="button" className="ts-btn is-primary" onClick={() => open({ ...BLANK })}>
      <Plus strokeWidth={2.1} /><span>Add job</span>
    </button>
  );

  return (
    <section className="ts-card">
      <CardHead title="Jobs" sub="What your team records their hours against.">
        <ShowArchived count={archivedCount} checked={showArchived} onChange={setShowArchived} />
        {addButton}
      </CardHead>

      {rowError && <div className="ts-card-alert"><Alert>{rowError}</Alert></div>}

      {shown.length === 0 ? (
        jobs.length === 0 ? (
          <EmptyState icon={<Briefcase strokeWidth={1.8} />} title="No jobs yet"
            text="Add your first job so your team can record their hours against it.">
            {addButton}
          </EmptyState>
        ) : (
          <EmptyState icon={<Archive strokeWidth={1.8} />} title="All your jobs are archived"
            text="Tick Show archived to see them, or add a new job." />
        )
      ) : (
        <div className="ts-table" role="table" aria-label="Jobs">
          <div className="ts-tr is-head is-job" role="row">
            <span role="columnheader">Job no.</span>
            <span role="columnheader">Job and site</span>
            <span role="columnheader">Default work type</span>
            <span role="columnheader" className="ts-sr">Actions</span>
          </div>
          {shown.map((j) => {
            const type = typeName.get(j.default_work_type_id);
            const archived = j.status === "archived";
            return (
              <div key={j.id} className={"ts-tr is-job" + (archived ? " is-archived" : "")} role="row">
                <div role="cell"><span className="ts-code">{j.job_number}</span></div>
                <div role="cell">
                  <div className="ts-name">{j.job_name}{archived && <span className="ts-badge">Archived</span>}</div>
                  {j.site_address && <div className="ts-sub"><MapPin strokeWidth={1.9} /><span>{j.site_address}</span></div>}
                </div>
                <div role="cell" className={type ? "ts-type" : "ts-type is-none"}>
                  {type ? `${type.name}${type.active ? "" : " (archived)"}` : "No default"}
                </div>
                <div role="cell" className="ts-actions">
                  <button type="button" className="ts-btn" disabled={rowBusy === j.id} onClick={() => open({ ...j })}>
                    <Pencil strokeWidth={2} /><span>Edit</span>
                  </button>
                  <button type="button" className="ts-btn" disabled={rowBusy === j.id} onClick={() => setStatus(j, archived ? "active" : "archived")}>
                    {archived ? <RotateCcw strokeWidth={2} /> : <Archive strokeWidth={2} />}
                    <span>{archived ? "Restore" : "Archive"}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="ts-card-foot">Your team can only pick active jobs. Archived jobs stay on the timesheets they were used on, and renaming a job doesn&rsquo;t change hours already recorded.</p>

      {form && (
        <Dialog title={form.id ? "Edit job" : "Add job"} icon={<Briefcase size={19} strokeWidth={1.8} />}
          busy={busy} error={error} saveLabel="Save job" onCancel={() => open(null)} onSubmit={save}>
          <div className="ts-fields">
            <label className="ts-field">
              <span className="ts-label">Job number</span>
              <input type="text" value={form.job_number} maxLength={LIMITS.jobNumber} placeholder="e.g. 001" disabled={busy}
                autoFocus onChange={(e) => set("job_number", e.target.value)} />
            </label>
            <label className="ts-field">
              <span className="ts-label">Job name</span>
              <input type="text" value={form.job_name} maxLength={LIMITS.jobName} placeholder="e.g. Appletree Grange" disabled={busy}
                onChange={(e) => set("job_name", e.target.value)} />
            </label>
            <label className="ts-field is-wide">
              <span className="ts-label">Site address (optional)</span>
              <input type="text" value={form.site_address || ""} maxLength={LIMITS.siteAddress} disabled={busy}
                onChange={(e) => set("site_address", e.target.value)} />
            </label>
            <label className="ts-field is-wide">
              <span className="ts-label">Default work type (optional)</span>
              <select value={form.default_work_type_id || ""} disabled={busy} onChange={(e) => set("default_work_type_id", e.target.value)}>
                <option value="">None</option>
                {choices.map((t) => <option key={t.id} value={t.id}>{t.name}{t.active ? "" : " (archived)"}</option>)}
              </select>
            </label>
          </div>
        </Dialog>
      )}
    </section>
  );
}
