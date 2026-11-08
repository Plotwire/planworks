"use client";

import React, { useState } from "react";
import { Archive, Pencil, Plus, RotateCcw, Save, X } from "lucide-react";
import { addWorkType, changeWorkType } from "@/lib/timesheets/lists";
import { byWorkTypeOrder, cleanWorkTypeName, nextSortOrder, saveErrorMessage, LIMITS } from "@/lib/timesheets/rules";

const DUPLICATE = "You already have a work type with that name, on this list or archived.";

export default function WorkTypesPanel({ ownerId, types, onSaved }) {
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null); // { id, name } while renaming
  const [rowBusy, setRowBusy] = useState(null);
  const [error, setError] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const archivedCount = types.filter((t) => !t.active).length;
  const shown = types.filter((t) => showArchived || t.active).sort(byWorkTypeOrder);

  const add = async (e) => {
    e.preventDefault();
    if (adding) return;
    const { value, error: problem } = cleanWorkTypeName(newName);
    if (problem) { setError(problem); return; }
    setAdding(true);
    setError("");
    try {
      onSaved(await addWorkType(ownerId, value, nextSortOrder(types)));
      setNewName("");
    } catch (err) {
      setError(saveErrorMessage(err, DUPLICATE));
    } finally {
      setAdding(false);
    }
  };

  const change = async (id, patch) => {
    setRowBusy(id);
    setError("");
    try {
      onSaved(await changeWorkType(id, patch));
      return true;
    } catch (err) {
      setError(saveErrorMessage(err, DUPLICATE));
      return false;
    } finally {
      setRowBusy(null);
    }
  };

  const rename = async (e) => {
    e.preventDefault();
    const { value, error: problem } = cleanWorkTypeName(editing.name);
    if (problem) { setError(problem); return; }
    if (await change(editing.id, { name: value })) setEditing(null);
  };

  return (
    <>
      <form className="ts-inline" onSubmit={add}>
        <input type="text" value={newName} maxLength={LIMITS.workType} placeholder="New work type" aria-label="New work type"
          disabled={adding} onChange={(e) => { setNewName(e.target.value); if (error) setError(""); }}/>
        <button type="submit" className="ts-btn" disabled={adding}><Plus size={16} strokeWidth={2}/><span>{adding ? "Adding…" : "Add"}</span></button>
      </form>

      {error && <div className="ts-error" role="alert">{error}</div>}

      {archivedCount > 0 && (
        <label className="ts-check">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)}/>
          Show archived ({archivedCount})
        </label>
      )}

      {shown.length === 0 ? (
        <div className="ts-empty">No work types yet. Add one above.</div>
      ) : (
        <div className="ts-list">
          {shown.map((t) => (
            <div key={t.id} className={"ts-row is-type" + (t.active ? "" : " is-archived")}>
              {editing?.id === t.id ? (
                <form className="ts-inline" style={{ gridColumn: "1 / -1" }} onSubmit={rename}>
                  <input type="text" value={editing.name} maxLength={LIMITS.workType} aria-label="Work type name" autoFocus
                    disabled={rowBusy === t.id} onChange={(e) => setEditing({ ...editing, name: e.target.value })}/>
                  <button type="submit" className="ts-btn is-small" disabled={rowBusy === t.id}><Save size={14} strokeWidth={1.9}/><span>Save</span></button>
                  <button type="button" className="ts-btn is-small" disabled={rowBusy === t.id} onClick={() => { setEditing(null); setError(""); }}><X size={14} strokeWidth={2}/><span>Cancel</span></button>
                </form>
              ) : (
                <>
                  <div className="ts-name">{t.name}{!t.active && <span className="ts-badge">Archived</span>}</div>
                  <div className="ts-actions">
                    <button type="button" className="ts-btn is-small" disabled={rowBusy === t.id} onClick={() => { setEditing({ id: t.id, name: t.name }); setError(""); }}>
                      <Pencil size={14} strokeWidth={2}/><span>Rename</span>
                    </button>
                    <button type="button" className="ts-btn is-small" disabled={rowBusy === t.id} onClick={() => change(t.id, { active: !t.active })}>
                      {t.active ? <Archive size={14} strokeWidth={2}/> : <RotateCcw size={14} strokeWidth={2}/>}
                      <span>{t.active ? "Archive" : "Restore"}</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="ts-hint">Your team can only pick active work types. Renaming or archiving one doesn&rsquo;t change hours already recorded.</p>
    </>
  );
}
