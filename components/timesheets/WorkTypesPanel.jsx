"use client";

import React, { useState } from "react";
import { Archive, Pencil, Plus, RotateCcw, Tag } from "lucide-react";
import { addWorkType, changeWorkType } from "@/lib/timesheets/lists";
import { byWorkTypeOrder, cleanWorkTypeName, nextSortOrder, saveErrorMessage, LIMITS } from "@/lib/timesheets/rules";
import { Alert, CardHead, Dialog, EmptyState, ShowArchived } from "@/components/timesheets/parts";

const DUPLICATE = "You already have a work type with that name, on this list or archived.";

export default function WorkTypesPanel({ ownerId, types, onSaved }) {
  const [dialog, setDialog] = useState(null); // null: closed. With an id: renaming.
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [rowBusy, setRowBusy] = useState(null);
  const [rowError, setRowError] = useState("");

  const archivedCount = types.filter((t) => !t.active).length;
  const shown = types.filter((t) => showArchived || t.active).sort(byWorkTypeOrder);

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

  return (
    <section className="ts-card">
      <CardHead title="Work types" sub="The kinds of work your team can record.">
        <ShowArchived count={archivedCount} checked={showArchived} onChange={setShowArchived} />
        {addButton}
      </CardHead>

      {rowError && <div className="ts-card-alert"><Alert>{rowError}</Alert></div>}

      {shown.length === 0 ? (
        types.length === 0 ? (
          <EmptyState icon={<Tag strokeWidth={1.8} />} title="No work types yet"
            text="Add the kinds of work your team does.">
            {addButton}
          </EmptyState>
        ) : (
          <EmptyState icon={<Archive strokeWidth={1.8} />} title="All your work types are archived"
            text="Tick Show archived to see them, or add a new one." />
        )
      ) : (
        <div className="ts-table" role="table" aria-label="Work types">
          <div className="ts-tr is-head is-type" role="row">
            <span role="columnheader">Work type</span>
            <span role="columnheader" className="ts-sr">Actions</span>
          </div>
          {shown.map((t) => (
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
              </div>
            </div>
          ))}
        </div>
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
