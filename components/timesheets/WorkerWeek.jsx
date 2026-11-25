"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2, Send, Lock, Pencil, Check } from "lucide-react";
import { StatusIcon } from "@/components/StatusMark";
import {
  listEntries, listWeeks, addEntry, changeEntry, removeEntry, submitWeek, entryErrorMessage,
} from "@/lib/timesheets/entries";
import {
  weekDays, addDays, weekLabel, parseDay, DAY_LONG, DAY_SHORT, hhmm, minutesBetween, formatHours, jobLabel,
  totals, dayState, canSubmitWeek, cleanEntry, newEntryDefaults, OTHER_JOB,
} from "@/lib/timesheets/week";

// A worker's week, phone first: Monday to Sunday as day cards, each with the
// jobs worked that day (job, work type, start, finish, hours worked out, an
// optional note), "+ Add another job" for a second site, the week's total and
// "Submit week". Each entry saves itself a moment after a change, so there's
// no Save button. A submitted week is locked until the boss reopens it; the
// database enforces that, and every other rule, whatever happens here.

let draftCount = 0;
const newKey = () => `draft-${++draftCount}`;

const shortDate = (iso) => {
  const d = parseDay(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
};
const stamp = (ts) => {
  try {
    return new Date(ts).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
};

export default function WorkerWeek({ ctx, lists }) {
  const thisMonday = ctx.week_start;
  const [monday, setMonday] = useState(thisMonday);
  const [rows, setRows] = useState(null);        // saved entries this week, each with a _key
  const [drafts, setDrafts] = useState([]);      // new, not yet saved: { _key, date, defaults }
  const [week, setWeek] = useState(null);        // { status, submitted_at, reopened_at } or null
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState({});    // _key -> "dirty" | "saving" | "incomplete" | "error"
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const loadSeq = useRef(0);
  const shown = useRef({ monday, sunday: addDays(monday, 6) });

  const days = weekDays(monday);
  const sunday = days[6];
  shown.current = { monday, sunday };

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setRows(null); setDrafts([]); setPending({}); setFailed(false); setSubmitError(""); setConfirmSubmit(false);
    try {
      const [entries, weeks] = await Promise.all([listEntries(monday, sunday), listWeeks(monday, monday)]);
      if (seq !== loadSeq.current) return;
      setRows(entries.map((e) => ({ ...e, _key: e.id })));
      setWeek(weeks[0] || null);
    } catch {
      if (seq === loadSeq.current) setFailed(true);
    }
  }, [monday, sunday]);
  useEffect(() => { load(); }, [load]);

  const onPending = useCallback((key, state) => {
    setPending((p) => {
      if ((p[key] || null) === (state || null)) return p;
      const next = { ...p };
      if (state) next[key] = state; else delete next[key];
      return next;
    });
  }, []);

  const onSaved = useCallback((row) => {
    // A save that finishes after moving to another week belongs to that week.
    if (row.work_date < shown.current.monday || row.work_date > shown.current.sunday) return;
    setRows((rs) => (rs || []).some((r) => r._key === row._key)
      ? rs.map((r) => (r._key === row._key ? row : r))
      : [...(rs || []), row]);
    setDrafts((ds) => ds.filter((d) => d._key !== row._key));
  }, []);

  const onRemoved = useCallback((key) => {
    setRows((rs) => (rs || []).filter((r) => r._key !== key));
    setDrafts((ds) => ds.filter((d) => d._key !== key));
    onPending(key, null);
  }, [onPending]);

  const addDraft = (date) => {
    const all = [...(rows || [])];
    setDrafts((ds) => [...ds, { _key: newKey(), date, defaults: newEntryDefaults({ date, entries: all, jobs: lists.jobs, types: lists.work_types }) }]);
  };

  const status = week?.status || null;
  const sum = totals(rows || []);
  const unsaved = drafts.length > 0 || Object.keys(pending).length > 0;
  const submittable = canSubmitWeek({ monday, thisMonday, weekStatus: status });
  const company = ctx.company || "your boss";

  const doSubmit = async () => {
    setSubmitting(true);
    setSubmitError("");
    try {
      const w = await submitWeek(monday);
      setWeek(w);
      setConfirmSubmit(false);
    } catch (err) {
      setSubmitError(entryErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const weekName = monday === thisMonday ? "This week" : monday === addDays(thisMonday, -7) ? "Last week" : "Week";

  return (
    <>
      <section className="tsw-weekbar" aria-label="Week">
        <button type="button" className="tsw-arrow" onClick={() => setMonday(addDays(monday, -7))} aria-label="Previous week">
          <ChevronLeft strokeWidth={2.2} />
        </button>
        <div className="tsw-weekname">
          <div className="tsw-week-eyebrow">{weekName}</div>
          <div className="tsw-week-dates">{weekLabel(monday)}</div>
        </div>
        <button type="button" className="tsw-arrow" onClick={() => setMonday(addDays(monday, 7))}
                disabled={monday >= thisMonday} aria-label="Next week">
          <ChevronRight strokeWidth={2.2} />
        </button>
      </section>

      {status === "submitted" && (
        <div className="tsw-banner is-green is-locked" role="status">
          <span className="tsw-lock-badge"><Lock strokeWidth={2.4} /></span>
          <span><b>Submitted</b>{week.submitted_at ? ` ${stamp(week.submitted_at)}` : ""}. It&rsquo;s locked: only {company} can reopen it.</span>
        </div>
      )}
      {status === "reopened" && (
        <div className="tsw-banner is-amber" role="status">
          <StatusIcon tone="amber" size={22} />
          <span><b>Reopened</b> by {company}. Make your changes, then submit the week again.</span>
        </div>
      )}
      {!status && monday < thisMonday && rows && (
        <div className="tsw-banner is-amber" role="status">
          <StatusIcon tone="amber" size={22} />
          <span><b>Not submitted yet.</b> Check it, then submit it below.</span>
        </div>
      )}

      {failed ? (
        <div className="tsw-card tsw-message" role="alert">
          <StatusIcon tone="red" size={28} />
          <h2>Couldn&rsquo;t load this week</h2>
          <p>Check your signal and try again.</p>
          <button type="button" className="tsw-btn is-wide" onClick={load}>Try again</button>
        </div>
      ) : !rows ? (
        <div className="tsw-card tsw-loading" aria-label="Loading">Loading…</div>
      ) : (
        <div className="tsw-days">
          {days.map((date, i) => {
            const state = dayState({ date, today: ctx.today, earliest: ctx.earliest_date, weekStatus: status });
            const open = state === "open";
            const items = [
              ...rows.filter((r) => r.work_date === date).map((r) => ({ key: r._key, entry: r })),
              ...drafts.filter((d) => d.date === date).map((d) => ({ key: d._key, draft: d })),
            ].sort((a, b) => hhmm(a.entry?.start_time ?? a.draft.defaults.start_time ?? "")
              .localeCompare(hhmm(b.entry?.start_time ?? b.draft.defaults.start_time ?? "")) || 0);
            const dayMins = sum.byDay[date] || 0;
            const isToday = date === ctx.today;
            return (
              <article key={date} className={`tsw-day is-${state}${isToday ? " is-today" : ""}`} aria-label={`${DAY_LONG[i]} ${shortDate(date)}`}>
                {/* Navy strip (teal for today): day, date and the day's hours. */}
                <header className="tsw-day-head">
                  <h2><b>{DAY_SHORT[i]}</b> <span>{shortDate(date)}</span></h2>
                  {isToday && <span className="tsw-today">Today</span>}
                  <span className={`tsw-day-total${dayMins ? "" : " is-zero"}`}>
                    {state === "locked" && <Lock strokeWidth={2.4} aria-label="Locked" />}
                    {formatHours(dayMins)}
                  </span>
                </header>

                <div className="tsw-day-body">
                  {items.map(({ key, entry, draft }) => (
                    <EntryRow key={key} rowKey={key} entry={entry} draft={draft} date={date} lists={lists} editable={open}
                              onSaved={onSaved} onRemoved={onRemoved} onPending={onPending} />
                  ))}

                  {open && (
                    <button type="button" className={`tsw-add${items.length ? "" : " is-first"}`} onClick={() => addDraft(date)}>
                      <Plus strokeWidth={2.4} />
                      <span>{items.length ? "Add another job" : "Add hours"}</span>
                    </button>
                  )}
                  {!open && !items.length && (
                    <p className="tsw-day-note">{state === "future" ? "Not yet" : "No hours"}</p>
                  )}
                  {state === "closed" && items.length > 0 && (
                    <p className="tsw-day-note">Too long ago to change. Ask {company} to reopen the week.</p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {rows && !failed && (
        <footer className="tsw-foot">
          <div className="tsw-foot-inner">
            <div className="tsw-total">
              <div className="l">Week total</div>
              <div className="n">{formatHours(sum.week)}</div>
            </div>
            {status === "submitted" ? (
              <div className="tsw-submitted"><Lock strokeWidth={2.4} /><span>Submitted</span></div>
            ) : submittable ? (
              <button type="button" className="tsw-btn is-submit" onClick={() => setConfirmSubmit(true)} disabled={unsaved}>
                <Send strokeWidth={2} /><span>Submit week</span>
              </button>
            ) : null}
          </div>
          {submittable && unsaved && <p className="tsw-foot-note">Finish or remove the job you&rsquo;re adding, then submit.</p>}
        </footer>
      )}

      {confirmSubmit && (
        <div className="tsw-dialog-back">
          <div className="tsw-dialog" role="dialog" aria-modal="true" aria-label="Submit week">
            <h2>Submit this week?</h2>
            <p>
              {weekLabel(monday)}: <b>{formatHours(sum.week)}</b>.
              {sum.week === 0 && " There are no hours on it."} Once it&rsquo;s submitted you can&rsquo;t change it.
              Only {company} can reopen it.
            </p>
            {submitError && <p className="tsw-error" role="alert">{submitError}</p>}
            <div className="tsw-dialog-actions">
              <button type="button" className="tsw-btn is-quiet" onClick={() => setConfirmSubmit(false)} disabled={submitting}>Cancel</button>
              <button type="button" className="tsw-btn" onClick={doSubmit} disabled={submitting}>
                <Send strokeWidth={2} /><span>{submitting ? "Submitting…" : "Submit week"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// One job on one day. Saves itself a moment after each change once it's
// complete (job, work type, start, finish); the note is optional.
function EntryRow({ rowKey, entry, draft, date, lists, editable, onSaved, onRemoved, onPending }) {
  // An older entry may have no job ("Other") or a break taken off its hours;
  // both are kept as they are.
  const initial = entry
    ? { job_id: entry.job_id || OTHER_JOB, work_type_id: entry.work_type_id || "", start_time: hhmm(entry.start_time),
        finish_time: hhmm(entry.finish_time), description: entry.description || "",
        break_minutes: entry.break_minutes || 0 }
    : draft.defaults;
  const [form, setForm] = useState(initial);
  const [status, setStatus] = useState(entry ? "saved" : "new");   // new | saved | saving | error
  const [error, setError] = useState("");
  const [touched, setTouched] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [expanded, setExpanded] = useState(!entry);   // a new job opens ready to fill in

  const idRef = useRef(entry?.id || null);
  const savedSig = useRef(entry ? JSON.stringify(cleanEntry(initial).value ?? null) : null);
  const formRef = useRef(form);
  formRef.current = form;
  const busy = useRef(false);
  const again = useRef(false);
  const timer = useRef(null);

  const save = useCallback(async () => {
    timer.current = null;
    const c = cleanEntry(formRef.current);
    if (c.error) return;
    const sig = JSON.stringify(c.value);
    if (sig === savedSig.current) { setStatus("saved"); onPending(rowKey, null); return; }
    if (busy.current) { again.current = true; return; }
    busy.current = true;
    setStatus("saving");
    onPending(rowKey, "saving");
    setError("");
    try {
      const row = idRef.current ? await changeEntry(idRef.current, c.value) : await addEntry(date, c.value);
      idRef.current = row.id;
      savedSig.current = sig;
      setStatus("saved");
      onPending(rowKey, null);
      onSaved({ ...row, _key: rowKey });
    } catch (err) {
      setStatus("error");
      setError(entryErrorMessage(err));
      onPending(rowKey, "error");
    } finally {
      busy.current = false;
      if (again.current) { again.current = false; save(); }
    }
  }, [date, onPending, onSaved, rowKey]);

  // Save a moment after each change, once the entry is complete.
  useEffect(() => {
    if (!editable) return undefined;
    const c = cleanEntry(form);
    if (c.error) { onPending(rowKey, "incomplete"); return undefined; }
    if (JSON.stringify(c.value) === savedSig.current) { onPending(rowKey, null); return undefined; }
    onPending(rowKey, "dirty");
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 700);
    return () => clearTimeout(timer.current);
  }, [form, editable, onPending, rowKey, save]);

  // Leaving the week with a change still waiting: save it now.
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); save(); } }, [save]);

  const set = (field) => (e) => {
    const value = e.target.value;
    setTouched(true);
    setForm((f) => {
      if (field !== "job_id") return { ...f, [field]: value };
      const job = lists.jobs.find((j) => j.id === value);
      return { ...f, job_id: value, work_type_id: job?.default_work_type_id || f.work_type_id };
    });
  };

  const remove = async () => {
    clearTimeout(timer.current);
    timer.current = null;
    if (!idRef.current) { onRemoved(rowKey); return; }
    setStatus("saving");
    try {
      await removeEntry(idRef.current);
      onRemoved(rowKey);
    } catch (err) {
      setStatus("error");
      setError(entryErrorMessage(err));
      setConfirmRemove(false);
    }
  };

  const span = minutesBetween(form.start_time, form.finish_time);
  const mins = span == null || span <= (form.break_minutes || 0) ? null : span - (form.break_minutes || 0);

  if (!editable) {
    return (
      <EntrySummary number={entry.job_number} name={entry.job_number ? entry.job_name : jobLabel(entry)}
                    type={entry.work_type} start={entry.start_time} finish={entry.finish_time}
                    minutes={entry.minutes} note={entry.description} />
    );
  }

  // Keep an archived job, an older "Other" job, or an archived work type on
  // an entry that already has it.
  const jobs = !entry || lists.jobs.some((j) => j.id === entry.job_id)
    ? lists.jobs
    : entry.job_id
      ? [...lists.jobs, { id: entry.job_id, job_number: entry.job_number, job_name: entry.job_name }]
      : [...lists.jobs, { id: OTHER_JOB, job_name: entry.job_name, other_note: entry.other_note }];
  const types = lists.work_types.some((t) => t.id === form.work_type_id) || !entry?.work_type_id
    ? lists.work_types
    : [...lists.work_types, { id: entry.work_type_id, name: entry.work_type }];
  const check = cleanEntry(form);
  const hint = check.error && (touched || entry) ? check.error : "";

  // A saved job shows as one tidy row; tap it to change it. A new one, or one
  // that needs attention, shows the form.
  if (!expanded && status !== "error" && !check.error) {
    const job = jobs.find((j) => j.id === form.job_id);
    return (
      <EntrySummary number={job?.job_number} name={job ? (job.job_number ? job.job_name : jobLabel(job)) : ""}
                    type={types.find((t) => t.id === form.work_type_id)?.name} start={form.start_time} finish={form.finish_time}
                    minutes={mins} note={form.description} saving={status === "saving"} onEdit={() => setExpanded(true)} />
    );
  }

  const done = () => {
    if (timer.current) { clearTimeout(timer.current); save(); }
    setExpanded(false);
  };

  return (
    <div className={`tsw-entry${status === "error" ? " is-error" : ""}`}>
      <select className="tsw-job" value={form.job_id} onChange={set("job_id")} aria-label="Job">
        <option value="" disabled>Pick a job</option>
        {jobs.map((j) => <option key={j.id} value={j.id}>{jobLabel(j)}</option>)}
      </select>
      <div className="tsw-entry-grid">
        <select value={form.work_type_id} onChange={set("work_type_id")} aria-label="Work type">
          <option value="" disabled>Work type</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <label className="tsw-time">
          <span>Start</span>
          <input type="time" step="300" value={form.start_time} onChange={set("start_time")} aria-label="Start time" />
        </label>
        <label className="tsw-time">
          <span>Finish</span>
          <input type="time" step="300" value={form.finish_time} onChange={set("finish_time")} aria-label="Finish time" />
        </label>
        <div className="tsw-hours" aria-label="Hours worked">{mins == null ? "–" : formatHours(mins)}</div>
      </div>
      <div className="tsw-entry-foot">
        <input type="text" className="tsw-note" value={form.description} onChange={set("description")}
               maxLength={150} placeholder="Note (optional)" aria-label="Note (optional)" />
        {confirmRemove ? (
          <span className="tsw-remove-ask">
            <button type="button" className="tsw-btn is-small" onClick={remove}>Remove</button>
            <button type="button" className="tsw-btn is-small is-quiet" onClick={() => setConfirmRemove(false)}>Keep</button>
          </span>
        ) : (
          <>
            <button type="button" className="tsw-icon-btn is-small" onClick={() => (idRef.current ? setConfirmRemove(true) : remove())}
                    aria-label="Remove this job" title="Remove this job">
              <Trash2 strokeWidth={2} />
            </button>
            <button type="button" className="tsw-icon-btn is-small" onClick={done} disabled={!!check.error}
                    aria-label="Done" title="Done">
              <Check strokeWidth={2.6} />
            </button>
          </>
        )}
      </div>
      <div className="tsw-entry-status" aria-live="polite">
        {status === "error" ? <><StatusIcon tone="red" size={14} /><span>{error}</span></>
          : hint ? <span className="tsw-hint">{hint}</span>
          : status === "saving" ? <><StatusIcon tone="amber" size={14} /><span>Saving…</span></>
          : status === "saved" && idRef.current ? <><StatusIcon tone="green" size={14} /><span>Saved</span></>
          : null}
      </div>
    </div>
  );
}

// One job as a row: teal accent bar, job number chip, job name, work type
// tag, times and hours. Tappable (to change it) when onEdit is given.
function EntrySummary({ number, name, type, start, finish, minutes, note, saving, onEdit }) {
  const body = (
    <>
      {number ? <span className="tsw-chip">{number}</span> : null}
      <span className="tsw-sum-main">
        <span className="tsw-sum-job">{name || "Other"}</span>
        <span className="tsw-sum-meta">
          {type && <span className="tsw-tag">{type}</span>}
          <span className="tsw-sum-times">{hhmm(start)}–{hhmm(finish)}</span>
        </span>
        {note ? <span className="tsw-sum-note">{note}</span> : null}
      </span>
      <b className="tsw-sum-hours">{minutes == null ? "–" : formatHours(minutes)}</b>
      {onEdit && (
        <span className="tsw-sum-edit" aria-hidden="true">
          {saving ? <StatusIcon tone="amber" size={15} /> : <Pencil strokeWidth={2.2} />}
        </span>
      )}
    </>
  );
  return onEdit
    ? <button type="button" className="tsw-sum is-tap" onClick={onEdit} aria-label={`Change ${name || "this job"}`}>{body}</button>
    : <div className="tsw-sum">{body}</div>;
}

// Same colours, type, cards and buttons as the rest of Plotwire (the
// dashboard and the owner's Timesheets screens), laid out for a phone.
export const WORKER_CSS = `
.pw-tsw{position:fixed; inset:0; overflow-x:hidden; overflow-y:auto; z-index:1;
  --ink:#0E141B; --navy:#1A2530; --navy-2:#22303D; --navy-line:#314250;
  --teal:#3FB7C9; --teal-600:#2C97A8; --teal-700:#22808F;
  --paper:#F4F6F9; --surface:#FFFFFF; --line:#E6EBF1; --line-2:#EEF2F6;
  --ink-2:#3A4654; --muted:#697785; --muted-2:#9AA6B2;
  --brand:#2C3E50; --on-teal:#0E141B; --chip-ink:#08313A; --teal-soft:#E2F4F7; --teal-soft-ink:#08313A;
  background:var(--paper); color:var(--ink); font-family:var(--font-inter),system-ui,sans-serif; -webkit-font-smoothing:antialiased}
.pw-tsw *{box-sizing:border-box; margin:0; padding:0}
html.dark .pw-tsw{--ink:#E7EDF3; --ink-2:#B6C2CE; --muted:#8595A3; --muted-2:#6B7A88;
  --paper:#0E141B; --surface:#16202B; --line:#263441; --line-2:#202C38; --navy:#0A1016; --navy-2:#16202B;
  --teal-soft:rgba(63,183,201,.16); --teal-soft-ink:#7FD3DF}

.pw-tsw .tsw-top{position:sticky; top:0; z-index:5; display:flex; align-items:center; gap:12px; padding:12px 16px;
  background:linear-gradient(120deg,#1A2530 0%,#233241 60%,#2C4150 100%); color:#fff; box-shadow:0 6px 18px -10px rgba(16,28,40,.5)}
.pw-tsw .tsw-brandmark{width:38px; height:38px; flex:none; border-radius:11px; display:grid; place-items:center; background:linear-gradient(150deg,#3FB7C9,#22808F)}
.pw-tsw .tsw-brandmark svg{width:20px; height:20px}
.pw-tsw .tsw-who{flex:1; min-width:0}
.pw-tsw .tsw-name{font-family:var(--font-space-grotesk),sans-serif; font-weight:600; font-size:17px; letter-spacing:-.01em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.pw-tsw .tsw-company{font-size:12.5px; color:#aab8c6; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.pw-tsw .tsw-signout-note{padding:8px 16px; font-size:13px; color:#B91C1C}

.pw-tsw .tsw-main{max-width:640px; margin:0 auto; padding:14px 12px 120px}
.pw-tsw .tsw-card{background:var(--surface); border:1px solid var(--line); border-radius:16px; box-shadow:0 1px 2px rgba(16,28,40,.04),0 1px 3px rgba(16,28,40,.06)}
html.dark .pw-tsw .tsw-card{box-shadow:0 1px 2px rgba(0,0,0,.4)}
.pw-tsw .tsw-message{padding:28px 20px; display:flex; flex-direction:column; align-items:center; text-align:center; gap:8px}
.pw-tsw .tsw-message h2{font-family:var(--font-space-grotesk),sans-serif; font-weight:600; font-size:18px}
.pw-tsw .tsw-message p{font-size:14px; color:var(--muted); line-height:1.5; margin-bottom:6px}
.pw-tsw .tsw-loading{padding:26px 20px; text-align:center; font-size:14px; color:var(--muted)}

.pw-tsw .tsw-weekbar{display:flex; align-items:center; gap:10px; margin-bottom:12px}
.pw-tsw .tsw-weekname{flex:1; text-align:center}
.pw-tsw .tsw-week-eyebrow{font-family:var(--font-jetbrains-mono),monospace; font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--teal-700)}
html.dark .pw-tsw .tsw-week-eyebrow{color:var(--teal)}
.pw-tsw .tsw-week-dates{font-family:var(--font-space-grotesk),sans-serif; font-weight:600; font-size:18px; letter-spacing:-.01em; margin-top:2px}
.pw-tsw .tsw-arrow{width:46px; height:46px; flex:none; border:none; border-radius:12px; display:grid; place-items:center; background:var(--action); color:var(--action-ink); cursor:pointer}
.pw-tsw .tsw-arrow svg{width:22px; height:22px}
.pw-tsw .tsw-arrow:hover:not(:disabled){background:var(--action-hover)}

.pw-tsw .tsw-banner{display:flex; align-items:flex-start; gap:10px; padding:12px 14px; margin-bottom:12px; border-radius:12px; font-size:14px; line-height:1.45}
.pw-tsw .tsw-banner.is-green{background:#ECFDF3; border:1.5px solid #4ADE80; color:#14532D}
.pw-tsw .tsw-banner.is-amber{background:#FFFBEB; border:1.5px solid #FBBF24; color:#78350F}
html.dark .pw-tsw .tsw-banner.is-green{background:#0F2A1A; color:#BBF7D0}
html.dark .pw-tsw .tsw-banner.is-amber{background:#2A2114; color:#FDE68A}

/* Day cards: a navy strip (day, date, hours) over a white body. Today's
   strip is teal with dark ink. */
.pw-tsw .tsw-days{display:flex; flex-direction:column; gap:12px}
.pw-tsw .tsw-day{background:var(--surface); border:1px solid var(--line); border-radius:14px; overflow:hidden;
  box-shadow:0 1px 2px rgba(16,28,40,.05),0 3px 10px -4px rgba(16,28,40,.10)}
html.dark .pw-tsw .tsw-day{box-shadow:0 1px 2px rgba(0,0,0,.4)}
.pw-tsw .tsw-day.is-future{opacity:.55}
.pw-tsw .tsw-day-head{display:flex; align-items:center; gap:10px; min-height:44px; padding:0 14px; background:var(--brand); color:#fff}
.pw-tsw .tsw-day-head h2{font-family:var(--font-space-grotesk),sans-serif; font-size:15px; letter-spacing:.08em; text-transform:uppercase; white-space:nowrap}
.pw-tsw .tsw-day-head h2 b{font-weight:700}
.pw-tsw .tsw-day-head h2 span{margin-left:3px; font-family:var(--font-jetbrains-mono),monospace; font-weight:500; font-size:13.5px; letter-spacing:.04em; color:#D7E2EB}
.pw-tsw .tsw-today{padding:3px 8px; border-radius:999px; background:var(--on-teal); color:#fff; font-size:10.5px; font-weight:700; letter-spacing:.08em; text-transform:uppercase}
.pw-tsw .tsw-day-total{margin-left:auto; display:inline-flex; align-items:center; gap:6px; font-family:var(--font-jetbrains-mono),monospace; font-weight:700; font-size:15px; white-space:nowrap}
.pw-tsw .tsw-day-total svg{width:15px; height:15px}
.pw-tsw .tsw-day-total.is-zero{font-weight:500; opacity:.7}
.pw-tsw .tsw-day.is-today{border-color:var(--teal-600); box-shadow:0 0 0 1px var(--teal-600),0 6px 16px -8px rgba(44,151,168,.55)}
.pw-tsw .tsw-day.is-today .tsw-day-head{background:var(--teal-600); color:var(--on-teal)}
.pw-tsw .tsw-day.is-today .tsw-day-head h2 span{color:var(--on-teal)}
.pw-tsw .tsw-day-body{padding:10px; display:flex; flex-direction:column; gap:8px}
.pw-tsw .tsw-day-note{padding:2px 4px; font-size:13.5px; color:var(--muted)}

/* A saved job: white row, teal accent bar, number chip, name, type tag, hours. */
.pw-tsw .tsw-sum{width:100%; display:flex; align-items:flex-start; gap:10px; padding:11px 12px 11px 12px; text-align:left;
  background:var(--surface); border:1px solid var(--line); border-left:4px solid var(--teal-600); border-radius:10px;
  font-family:inherit; font-size:14px; color:var(--ink)}
.pw-tsw .tsw-sum.is-tap{cursor:pointer; transition:box-shadow .15s ease}
.pw-tsw .tsw-sum.is-tap:hover{box-shadow:0 3px 10px -4px rgba(16,28,40,.22)}
.pw-tsw .tsw-chip{flex:none; margin-top:1px; padding:3px 7px; border-radius:6px; background:var(--teal); color:var(--chip-ink);
  font-family:var(--font-jetbrains-mono),monospace; font-weight:700; font-size:12.5px; line-height:1.25}
.pw-tsw .tsw-sum-main{flex:1; min-width:0; display:flex; flex-direction:column; gap:5px}
.pw-tsw .tsw-sum-job{font-weight:600; font-size:15px; line-height:1.3; overflow-wrap:anywhere}
.pw-tsw .tsw-sum-meta{display:flex; align-items:center; gap:8px; flex-wrap:wrap}
.pw-tsw .tsw-tag{padding:2px 8px; border-radius:999px; background:var(--line-2); color:var(--ink-2); font-size:12px; font-weight:600}
.pw-tsw .tsw-sum-times{font-family:var(--font-jetbrains-mono),monospace; font-size:12.5px; color:var(--muted)}
.pw-tsw .tsw-sum-note{font-size:13px; color:var(--muted); overflow-wrap:anywhere}
.pw-tsw .tsw-sum-hours{flex:none; margin-top:1px; font-family:var(--font-jetbrains-mono),monospace; font-weight:700; font-size:15px; white-space:nowrap}
.pw-tsw .tsw-sum-edit{flex:none; width:28px; height:28px; margin-top:-3px; border-radius:8px; display:grid; place-items:center; background:var(--action); color:var(--action-ink)}
.pw-tsw .tsw-sum-edit svg{width:15px; height:15px}

/* A job being filled in or changed. */
.pw-tsw .tsw-entry{padding:12px 12px 10px; border-radius:10px; background:var(--surface); border:1px solid var(--line); border-left:4px solid var(--teal-600);
  display:flex; flex-direction:column; gap:8px; box-shadow:0 3px 12px -6px rgba(16,28,40,.22)}
.pw-tsw .tsw-entry.is-error{border-color:#F87171; border-left-color:#DC2626}
.pw-tsw .tsw-entry select,.pw-tsw .tsw-entry input{width:100%; height:46px; padding:0 12px; font-family:inherit; font-size:16px; color:var(--ink);
  background:var(--paper); border:1px solid var(--line); border-radius:10px; outline:none; -webkit-appearance:none; appearance:none}
.pw-tsw .tsw-entry select{background-image:linear-gradient(45deg,transparent 50%,var(--muted) 50%),linear-gradient(135deg,var(--muted) 50%,transparent 50%);
  background-position:calc(100% - 18px) 20px,calc(100% - 13px) 20px; background-size:5px 5px; background-repeat:no-repeat; padding-right:32px}
.pw-tsw .tsw-entry select:focus,.pw-tsw .tsw-entry input:focus{border-color:var(--teal); box-shadow:0 0 0 3px rgba(63,183,201,.18)}
.pw-tsw .tsw-job{font-weight:600}
.pw-tsw .tsw-entry-grid{display:grid; grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr) 64px; gap:8px; align-items:end}
.pw-tsw .tsw-time{display:flex; flex-direction:column; gap:3px}
.pw-tsw .tsw-time span{font-size:11px; font-weight:600; color:var(--muted)}
.pw-tsw .tsw-time input{padding:0 8px; text-align:center}
.pw-tsw .tsw-hours{height:46px; display:grid; place-items:center; font-family:var(--font-jetbrains-mono),monospace; font-weight:700; font-size:14.5px; white-space:nowrap}
.pw-tsw .tsw-entry-foot{display:flex; gap:8px; align-items:center}
.pw-tsw .tsw-note{flex:1; min-width:0}
.pw-tsw .tsw-remove-ask{display:flex; gap:6px; flex:none}
.pw-tsw .tsw-entry-status{min-height:16px; display:flex; align-items:center; gap:6px; font-size:12.5px; color:var(--muted)}
.pw-tsw .tsw-hint{color:#B45309}
html.dark .pw-tsw .tsw-hint{color:#FBBF24}

/* Buttons: the app's teal with a dark navy icon. */
.pw-tsw .tsw-btn{height:46px; padding:0 16px; display:inline-flex; align-items:center; justify-content:center; gap:8px; border:none; border-radius:12px;
  background:var(--action); color:var(--action-ink); font-family:inherit; font-size:15px; font-weight:600; cursor:pointer; white-space:nowrap; transition:background .15s ease}
.pw-tsw .tsw-btn svg{width:19px; height:19px; flex:none}
.pw-tsw .tsw-btn:hover:not(:disabled){background:var(--action-hover)}
.pw-tsw .tsw-btn.is-wide{width:100%}
.pw-tsw .tsw-btn.is-small{height:40px; padding:0 12px; font-size:13.5px; border-radius:10px}
.pw-tsw .tsw-btn.is-quiet{background:var(--line-2); color:var(--ink-2)}
.pw-tsw .tsw-btn.is-quiet:hover:not(:disabled){background:var(--line)}
.pw-tsw .tsw-icon-btn{width:46px; height:46px; flex:none; border:none; border-radius:12px; display:grid; place-items:center; background:var(--action); color:var(--action-ink); cursor:pointer}
.pw-tsw .tsw-icon-btn svg{width:20px; height:20px}
.pw-tsw .tsw-icon-btn.is-small{width:46px; height:46px}
.pw-tsw .tsw-icon-btn:hover:not(:disabled){background:var(--action-hover)}
/* "Add hours" / "Add another job": light teal, dark ink. */
.pw-tsw .tsw-add{width:100%; height:44px; padding:0 14px; display:flex; align-items:center; justify-content:center; gap:8px;
  border:1px solid rgba(44,151,168,.35); border-radius:10px; background:var(--teal-soft); color:var(--teal-soft-ink);
  font-family:inherit; font-size:14.5px; font-weight:600; cursor:pointer; transition:background .15s ease}
.pw-tsw .tsw-add.is-first{height:50px; font-size:15.5px}
.pw-tsw .tsw-add:hover{background:rgba(63,183,201,.28)}
.pw-tsw .tsw-add svg{width:18px; height:18px}
.pw-tsw button:disabled{opacity:.5; cursor:not-allowed}
.pw-tsw button:focus-visible,.pw-tsw input:focus-visible,.pw-tsw select:focus-visible{outline:2px solid var(--teal); outline-offset:2px}

/* The week's total and Submit: a solid navy bar, white total, teal button. */
.pw-tsw .tsw-foot{position:fixed; left:0; right:0; bottom:0; z-index:5; background:var(--brand); color:#fff;
  box-shadow:0 -8px 24px -12px rgba(16,28,40,.5); padding:12px 14px calc(12px + env(safe-area-inset-bottom))}
.pw-tsw .tsw-foot-inner{max-width:616px; margin:0 auto; display:flex; align-items:center; gap:12px}
.pw-tsw .tsw-total{flex:1}
.pw-tsw .tsw-total .l{font-size:11px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; color:#B7C6D2}
.pw-tsw .tsw-total .n{font-family:var(--font-jetbrains-mono),monospace; font-weight:700; font-size:28px; letter-spacing:-.02em; line-height:1.1; color:#fff}
.pw-tsw .tsw-btn.is-submit{height:52px; padding:0 22px; font-size:16px}
.pw-tsw .tsw-submitted{display:inline-flex; align-items:center; gap:8px; height:44px; padding:0 16px; border-radius:999px; background:#DCFCE7; color:#14532D; font-weight:700; font-size:15px}
.pw-tsw .tsw-submitted svg{width:17px; height:17px}
.pw-tsw .tsw-foot-note{max-width:616px; margin:6px auto 0; font-size:12.5px; color:#FCD34D}

/* Submitted: a padlock badge on the banner. */
.pw-tsw .tsw-lock-badge{flex:none; width:24px; height:24px; border-radius:7px; display:grid; place-items:center; background:#16A34A; color:#fff}
.pw-tsw .tsw-lock-badge svg{width:14px; height:14px}

.pw-tsw .tsw-dialog-back{position:fixed; inset:0; z-index:20; background:rgba(11,17,23,.55); display:grid; place-items:end center; padding:12px}
.pw-tsw .tsw-dialog{width:100%; max-width:480px; background:var(--surface); color:var(--ink); border-radius:18px; padding:20px; box-shadow:0 24px 60px -12px rgba(11,17,23,.45)}
.pw-tsw .tsw-dialog h2{font-family:var(--font-space-grotesk),sans-serif; font-weight:600; font-size:20px; margin-bottom:8px}
.pw-tsw .tsw-dialog p{font-size:15px; line-height:1.5; color:var(--ink-2)}
.pw-tsw .tsw-error{margin-top:10px; color:#B91C1C !important; font-size:14px !important}
.pw-tsw .tsw-dialog-actions{display:flex; gap:10px; margin-top:16px}
.pw-tsw .tsw-dialog-actions .tsw-btn{flex:1}

/* The privacy notice (first sign-in) and the Privacy link under the week. */
.pw-tsw .tsw-notice{padding:22px 18px; display:flex; flex-direction:column; gap:12px; border-top:4px solid var(--teal-600)}
.pw-tsw .tsw-notice-ic{width:44px; height:44px; border-radius:12px; display:grid; place-items:center; background:var(--teal-soft); color:var(--teal-soft-ink)}
.pw-tsw .tsw-notice-ic svg{width:22px; height:22px}
.pw-tsw .tsw-notice h2,.pw-tsw .tsw-join h1{font-family:var(--font-space-grotesk),sans-serif; font-weight:600; font-size:20px; letter-spacing:-.01em; line-height:1.25}
.pw-tsw .tsw-notice p{font-size:15.5px; line-height:1.6; color:var(--ink-2)}
.pw-tsw .tsw-notice .tsw-btn{margin-top:4px}
.pw-tsw .tsw-privacy-link{margin-top:18px; text-align:center}
.pw-tsw .tsw-privacy-link button{border:0; background:none; padding:8px 12px; font-family:inherit; font-size:13.5px; font-weight:600; color:var(--muted); text-decoration:underline; text-underline-offset:3px; cursor:pointer}
.pw-tsw .tsw-dialog p + .tsw-dialog-actions{margin-top:18px}

/* The invite page (components/timesheets/JoinInvite.jsx). */
.pw-tsw .tsw-join{padding:22px 18px; display:flex; flex-direction:column; gap:12px; border-top:4px solid var(--teal-600)}
.pw-tsw .tsw-join p{font-size:15.5px; line-height:1.55; color:var(--ink-2)}
.pw-tsw .tsw-join p b{color:var(--ink); overflow-wrap:anywhere}
.pw-tsw .tsw-join-note{padding:10px 12px; border-radius:10px; font-size:14px !important; background:#FFFBEB; border:1.5px solid #FBBF24; color:#78350F !important}
html.dark .pw-tsw .tsw-join-note{background:#2A2114; color:#FDE68A !important}
.pw-tsw .tsw-join label{display:flex; flex-direction:column; gap:6px; font-size:13px; font-weight:600; color:var(--ink-2)}
.pw-tsw .tsw-join input{width:100%; height:48px; padding:0 12px; font-family:inherit; font-size:16px; color:var(--ink); background:var(--paper); border:1px solid var(--line); border-radius:10px; outline:none}
.pw-tsw .tsw-join input:focus{border-color:var(--teal); box-shadow:0 0 0 3px rgba(63,183,201,.18)}
.pw-tsw .tsw-pw-row{display:flex; gap:8px; align-items:center}
.pw-tsw .tsw-pw-row input{flex:1; min-width:0}
.pw-tsw .tsw-open-chrome{align-self:flex-start; display:inline-flex; align-items:center; gap:7px; height:38px; padding:0 12px; border-radius:10px;
  background:var(--action); color:var(--action-ink); font-size:13.5px; font-weight:600; text-decoration:none}
.pw-tsw .tsw-tip{font-size:13px !important; color:var(--muted) !important}

@media (min-width:700px){
  .pw-tsw .tsw-dialog-back{place-items:center}
  .pw-tsw .tsw-main{padding-top:22px}
}
@media (max-width:380px){
  .pw-tsw .tsw-entry-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr); }
  .pw-tsw .tsw-entry-grid select{grid-column:1 / -1}
  .pw-tsw .tsw-hours{grid-column:1 / -1; height:auto; place-items:start}
}
`;
