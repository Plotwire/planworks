"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Download, FileSpreadsheet, Lock, RotateCcw, Users } from "lucide-react";
import { StatusIcon } from "@/components/StatusMark";
import { listEntries, listWeeks, listTeam, reopenWeek, entryErrorMessage } from "@/lib/timesheets/entries";
import {
  weekDays, addDays, weekLabel, DAY_SHORT, hhmm, formatHours, totals, parseDay,
} from "@/lib/timesheets/week";
import { entriesCsv, csvFileName } from "@/lib/timesheets/csv";
import { timesheetWorkbook, xlsxFileName, XLSX_TYPE } from "@/lib/timesheets/workbook";
import { Alert, CardHead, EmptyState, JobName } from "@/components/timesheets/parts";

// The boss's view of the team's weeks: each worker's week with totals per day
// and per job, whether it's submitted, a way to reopen a submitted week, and
// the export. Hours only. The database only ever gives this account its own
// team (supabase/timesheets.sql, timesheets-week.sql).

const stamp = (ts) => {
  try {
    return new Date(ts).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
};
const shortDate = (iso) => parseDay(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export default function WorkersPanel({ thisMonday }) {
  const [monday, setMonday] = useState(thisMonday);
  const [team, setTeam] = useState(null);
  const [entries, setEntries] = useState(null);
  const [weeks, setWeeks] = useState([]);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState({});          // operative id -> showing their entries
  const [asking, setAsking] = useState(null);    // operative id waiting for "Reopen?" yes
  const [busy, setBusy] = useState(null);
  const [rowError, setRowError] = useState("");
  const seq = useRef(0);

  const days = weekDays(monday);
  const sunday = days[6];

  const load = useCallback(async () => {
    const run = ++seq.current;
    setEntries(null); setFailed(false); setRowError(""); setAsking(null);
    try {
      const [t, e, w] = await Promise.all([listTeam(), listEntries(monday, sunday), listWeeks(monday, monday)]);
      if (run !== seq.current) return;
      setTeam(t); setEntries(e); setWeeks(w);
    } catch {
      if (run === seq.current) setFailed(true);
    }
  }, [monday, sunday]);
  useEffect(() => { load(); }, [load]);

  // Everyone on the team, plus anyone removed since who has hours this week.
  const people = useMemo(() => {
    if (!team || !entries) return [];
    const withHours = new Set(entries.map((e) => e.operative_id));
    return team
      .filter((o) => o.status !== "removed" || withHours.has(o.id))
      .sort((a, b) => a.name.localeCompare(b.name, "en"));
  }, [team, entries]);

  const reopen = async (person) => {
    setBusy(person.id);
    setRowError("");
    try {
      const w = await reopenWeek(person.id, monday);
      setWeeks((ws) => [...ws.filter((x) => x.operative_id !== person.id), { ...w, operative_id: person.id }]);
      setAsking(null);
    } catch (err) {
      setRowError(entryErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const weekName = monday === thisMonday ? "This week" : monday === addDays(thisMonday, -7) ? "Last week" : "Week";
  const ready = team && entries && !failed;

  return (
    <>
      <section className="ts-card">
        <CardHead title="Workers" sub="Each worker's week: hours per day and per job, and whether they've submitted it.">
          <div className="ts-weeknav" aria-label="Week">
            <button type="button" className="ts-btn ts-btn-icon" onClick={() => setMonday(addDays(monday, -7))} aria-label="Previous week">
              <ChevronLeft strokeWidth={2.2} />
            </button>
            <div className="ts-weeknav-label">
              <span>{weekName}</span>
              <b>{weekLabel(monday)}</b>
            </div>
            <button type="button" className="ts-btn ts-btn-icon" onClick={() => setMonday(addDays(monday, 7))}
                    disabled={monday >= thisMonday} aria-label="Next week">
              <ChevronRight strokeWidth={2.2} />
            </button>
          </div>
        </CardHead>

        {rowError && <div className="ts-card-alert"><Alert>{rowError}</Alert></div>}

        {failed ? (
          <div className="ts-card-alert">
            <Alert>Couldn&rsquo;t load the team&rsquo;s hours. Check your connection and try again.</Alert>
            <button type="button" className="ts-btn" style={{ marginTop: 10 }} onClick={load}>Try again</button>
          </div>
        ) : !ready ? (
          <div className="ts-skel" aria-label="Loading">
            {[0, 1, 2].map((i) => (
              <div key={i} className="ts-sk-row"><span className="ts-sk w15" /><span className="ts-sk w45" /><span className="ts-sk w20" /></div>
            ))}
          </div>
        ) : people.length === 0 ? (
          <EmptyState icon={<Users strokeWidth={1.8} />} title="No workers yet"
            text="Once workers are on your team, their weeks show here." />
        ) : (
          <div className="ts-workers">
            {people.map((person) => {
              const mine = entries.filter((e) => e.operative_id === person.id)
                .sort((a, b) => a.work_date.localeCompare(b.work_date) || hhmm(a.start_time).localeCompare(hhmm(b.start_time)));
              const sum = totals(mine);
              const week = weeks.find((w) => w.operative_id === person.id);
              const status = week?.status || null;
              const showing = !!open[person.id];
              return (
                <article key={person.id} className="ts-worker">
                  {/* Navy strip: name, submitted or not, the week's total. */}
                  <header className="ts-worker-head">
                    <div className="ts-worker-name">
                      <h3>{person.name}{person.status === "removed" && <span className="ts-badge">Removed</span>}</h3>
                      {status === "submitted" ? (
                        <span className="ts-pill is-green"><Lock strokeWidth={2.4} />Submitted {stamp(week.submitted_at)}</span>
                      ) : status === "reopened" ? (
                        <span className="ts-pill is-amber"><StatusIcon tone="amber" size={15} />Reopened {stamp(week.reopened_at)}</span>
                      ) : (
                        <span className="ts-pill is-amber"><StatusIcon tone="amber" size={15} />Not submitted</span>
                      )}
                    </div>
                    <div className="ts-worker-total">
                      <div className="n">{formatHours(sum.week)}</div>
                      <div className="l">Week total</div>
                    </div>
                  </header>

                  <div className="ts-worker-body">
                    <div className="ts-daygrid" role="list" aria-label={`${person.name}: hours per day`}>
                      {days.map((d, i) => (
                        <div key={d} role="listitem" className={`ts-daycell${sum.byDay[d] ? "" : " is-zero"}`}>
                          <span>{DAY_SHORT[i]}</span>
                          <b>{sum.byDay[d] ? formatHours(sum.byDay[d]) : "–"}</b>
                        </div>
                      ))}
                    </div>

                    {sum.byJob.length > 0 && (
                      <ul className="ts-jobtotals" aria-label={`${person.name}: hours per job`}>
                        {sum.byJob.map((j) => (
                          <li key={j.key}><JobName job={j} /><b>{formatHours(j.minutes)}</b></li>
                        ))}
                      </ul>
                    )}

                  <div className="ts-worker-tools">
                    {mine.length > 0 && (
                      <button type="button" className="ts-linkbtn" onClick={() => setOpen((o) => ({ ...o, [person.id]: !showing }))}
                              aria-expanded={showing}>
                        <ChevronDown strokeWidth={2.2} className={showing ? "is-up" : ""} />
                        {showing ? "Hide entries" : `Show ${mine.length} ${mine.length === 1 ? "entry" : "entries"}`}
                      </button>
                    )}
                    {status === "submitted" && (asking === person.id ? (
                      <span className="ts-ask">
                        <span>Reopen so {person.name.split(" ")[0]} can change it?</span>
                        <button type="button" className="ts-btn" onClick={() => reopen(person)} disabled={busy === person.id}>
                          <RotateCcw strokeWidth={2} /><span>{busy === person.id ? "Reopening…" : "Reopen"}</span>
                        </button>
                        <button type="button" className="ts-btn is-quiet" onClick={() => setAsking(null)} disabled={busy === person.id}>Cancel</button>
                      </span>
                    ) : (
                      <button type="button" className="ts-btn" onClick={() => setAsking(person.id)}>
                        <RotateCcw strokeWidth={2} /><span>Reopen week</span>
                      </button>
                    ))}
                  </div>

                  {showing && (
                    <div className="ts-entries" role="table" aria-label={`${person.name}: entries`}>
                      <div className="ts-entry is-head" role="row">
                        <span role="columnheader">Day</span><span role="columnheader">Job</span><span role="columnheader">Work type</span>
                        <span role="columnheader">Time</span><span role="columnheader">Hours</span><span role="columnheader">Note</span>
                      </div>
                      {mine.map((e) => (
                        <div key={e.id} className="ts-entry" role="row">
                          <span role="cell">{shortDate(e.work_date)}</span>
                          <span role="cell" className="ts-entry-job"><JobName job={e} /></span>
                          <span role="cell"><span className="ts-tag">{e.work_type}</span></span>
                          <span role="cell" className="ts-mono">{hhmm(e.start_time)}–{hhmm(e.finish_time)}</span>
                          <span role="cell" className="ts-mono"><b>{formatHours(e.minutes)}</b></span>
                          <span role="cell" className="ts-entry-note">{e.description || ""}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <ExportCard monday={monday} team={team} />
    </>
  );
}

// Download every entry from one date to another: an Excel workbook (an
// Entries sheet, one row per entry, and a Summary sheet of hours per job, per
// worker, and per job per worker) or a plain CSV. Hours only.
function ExportCard({ monday, team }) {
  const [from, setFrom] = useState(monday);
  const [to, setTo] = useState(addDays(monday, 6));
  const [busy, setBusy] = useState(null);   // "xlsx" | "csv" while preparing
  const [note, setNote] = useState("");

  // Follow the week shown above until the dates are changed by hand.
  const followed = useRef(true);
  useEffect(() => {
    if (followed.current) { setFrom(monday); setTo(addDays(monday, 6)); }
  }, [monday]);

  const download = async (kind) => {
    setNote("");
    if (!from || !to || from > to) { setNote("Pick a start date on or before the end date."); return; }
    setBusy(kind);
    try {
      const rows = await listEntries(from, to);
      const names = new Map((team || []).map((o) => [o.id, o.name]));
      const blob = kind === "xlsx"
        ? new Blob([timesheetWorkbook(rows, names, from, to)], { type: XLSX_TYPE })
        : new Blob([entriesCsv(rows, names)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = kind === "xlsx" ? xlsxFileName(from, to) : csvFileName(from, to);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setNote(rows.length ? `Downloaded ${rows.length} ${rows.length === 1 ? "entry" : "entries"}.` : "Downloaded. There are no entries in those dates.");
    } catch (err) {
      setNote(entryErrorMessage(err).replace("Couldn't save.", "Couldn't download."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="ts-card ts-export">
      <CardHead title="Export hours" sub="Excel: every entry, plus a summary per job and per worker. CSV: every entry. Pick the week above, or any dates." />
      <div className="ts-export-body">
        <label className="ts-field">
          <span className="ts-label">From</span>
          <input type="date" value={from} onChange={(e) => { followed.current = false; setFrom(e.target.value); }} />
        </label>
        <label className="ts-field">
          <span className="ts-label">To</span>
          <input type="date" value={to} onChange={(e) => { followed.current = false; setTo(e.target.value); }} />
        </label>
        <button type="button" className="ts-btn is-primary" onClick={() => download("xlsx")} disabled={!!busy}>
          <FileSpreadsheet strokeWidth={2} /><span>{busy === "xlsx" ? "Preparing…" : "Download Excel"}</span>
        </button>
        <button type="button" className="ts-btn is-primary" onClick={() => download("csv")} disabled={!!busy}>
          <Download strokeWidth={2} /><span>{busy === "csv" ? "Preparing…" : "Download CSV"}</span>
        </button>
      </div>
      {note && <p className="ts-export-note" role="status">{note}</p>}
    </section>
  );
}
