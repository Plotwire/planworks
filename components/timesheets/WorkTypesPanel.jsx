"use client";

import React, { useState } from "react";
import { Archive, ChevronDown, Pencil, Plus, RotateCcw, Tag, Trash2 } from "lucide-react";
import { addWorkType, changeWorkType } from "@/lib/timesheets/lists";
import { byWorkTypeOrder, cleanWorkTypeName, nextSortOrder, saveErrorMessage, LIMITS } from "@/lib/timesheets/rules";
import { Alert, CardHead, Dialog, EmptyState } from "@/components/timesheets/parts";
import DeleteDialog from "@/components/timesheets/DeleteDialog";

const DUPLICATE = "You already have a work type with that name, on this list or archived.";

export default function WorkTypesPanel({ ownerId, types, onSaved, onRemoved }) {
  const [dialog, setDialog] = useState(null); // null: closed. With an id: renaming.
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [rowBusy, setRowBusy] = useState(null);
  const [rowError, setRowError] = useState("");

  const [deleting, setDeleting] = useState(null); // the work type the Delete dialog is for

  const active = types.filter((t) => t.active).sort(byWorkTypeOrder);
  const archived = types.filter((t) => !t.active).sort(byWorkTypeOrder);

  const open = (next) => { setDialog(next); setError(""); setRowError(""); };

  const save = async (e) => {
    e.preventDefault();
    if (busy) return;
    const { value, error: problem } = cleanWorkTypeName(dialog.name);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError("");
    try {
      onSaved(dialog.id
        ? await changeWorkType(dialog.id, { name: value })
        : await addWorkType(ownerId, value, nextSortOrder(types)));
      setDialog(null);
    } catch (err) {
      setError(saveErrorMessage(err, DUPLICATE));
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (type, active) => {
    setRowBusy(type.id);
    setRowError("");
    try {
      onSaved(await changeWorkType(type.id, { active }));
    } catch (err) {
      setRowError(saveErrorMessage(err, DUPLICATE));
    } finally {
      setRowBusy(null);
    }
  };

  const addButton = (
    <button type="button" className="ts-btn is-primary" onClick={() => open({ name: "" })}>
      <Plus strokeWidth={2.1} /><span>Add work type</span>
    </button>
  );

  // One work type: its name, then Rename, Archive / Restore and Delete.
  const row = (t) => (
    <div key={t.id} className={"ts-tr is-type" + (t.active ? "" : " is-archived")} role="row">
      <div role="cell" className="ts-name">{t.name}{!t.active && <span className="ts-badge">Archived</span>}</div>
      <div role="cell" className="ts-actions">
        <button type="button" className="ts-btn" disabled={rowBusy === t.id} onClick={() => open({ id: t.id, name: t.name })}>
          <Pencil strokeWidth={2} /><span>Rename</span>
        </button>
        <button type="button" className="ts-btn" disabled={rowBusy === t.id} onClick={() => setActive(t, !t.active)}>
          {t.active ? <Archive strokeWidth={2} /> : <RotateCcw strokeWidth={2} />}
          <span>{t.active ? "Archive" : "Restore"}</span>
        </button>
        <button type="button" className="ts-btn ts-btn-icon" disabled={rowBusy === t.id} onClick={() => setDeleting(t)}
                aria-label={`Delete work type ${t.name}`} title="Delete">
          <Trash2 strokeWidth={2} />
        </button>
      </div>
    </div>
  );

  return (
    <section className="ts-card">
      <CardHead title="Work types" sub="The kinds of work your team can record.">
        {addButton}
      </CardHead>

      {rowError && <div className="ts-card-alert"><Alert>{rowError}</Alert></div>}

      {types.length === 0 ? (
        <EmptyState icon={<Tag strokeWidth={1.8} />} title="No work types yet"
          text="Add the kinds of work your team does.">
          {addButton}
        </EmptyState>
      ) : (
        <>
          {active.length > 0 ? (
            <div className="ts-table" role="table" aria-label="Work types">
              <div className="ts-tr is-head is-type" role="row">
                <span role="columnheader">Work type</span>
                <span role="columnheader" className="ts-sr">Actions</span>
              </div>
              {active.map(row)}
            </div>
          ) : (
            <p className="ts-none-active">No active work types. Add one, or restore one from the archived ones below.</p>
          )}

          {/* Archived work types: out of the way until opened. */}
          {archived.length > 0 && (
            <div className="ts-archived">
              <button type="button" className="ts-archived-toggle" aria-expanded={showArchived}
                      onClick={() => setShowArchived((s) => !s)}>
                <ChevronDown strokeWidth={2.2} className={showArchived ? "is-up" : ""} />
                <span>Archived work types</span><i>{archived.length}</i>
              </button>
              {showArchived && (
                <div className="ts-table" role="table" aria-label="Archived work types">{archived.map(row)}</div>
              )}
            </div>
          )}
        </>
      )}

      {deleting && (
        <DeleteDialog kind="work_type" id={deleting.id} label={deleting.name}
                      onCancel={() => setDeleting(null)}
                      onDeleted={() => { onRemoved?.(deleting.id); setDeleting(null); }} />
      )}

      <p className="ts-card-foot">Your team can only pick active work types. Renaming or archiving one doesn&rsquo;t change hours already recorded.</p>

      {dialog && (
        <Dialog title={dialog.id ? "Rename work type" : "Add work type"} icon={<Tag size={19} strokeWidth={1.8} />}
          busy={busy} error={error} saveLabel="Save" onCancel={() => open(null)} onSubmit={save}>
          <label className="ts-field">
            <span className="ts-label">Name</span>
            <input type="text" value={dialog.name} maxLength={LIMITS.workType} disabled={busy} autoFocus
              onChange={(e) => { setDialog((d) => ({ ...d, name: e.target.value })); if (error) setError(""); }} />
          </label>
        </Dialog>
      )}
    </section>
  );
}
