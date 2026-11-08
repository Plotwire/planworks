"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Clock, X } from "lucide-react";
import { useApp } from "@/components/AppShell";
import { StatusIcon } from "@/components/StatusMark";
import { useTimesheetsAddon } from "@/lib/timesheets/useTimesheetsAddon";
import { listJobs, listWorkTypes } from "@/lib/timesheets/lists";
import JobsPanel from "@/components/timesheets/JobsPanel";
import WorkTypesPanel from "@/components/timesheets/WorkTypesPanel";

const TABS = [
  { key: "jobs", label: "Jobs" },
  { key: "types", label: "Work types" },
];

const withRow = (list, row) =>
  list.some((x) => x.id === row.id) ? list.map((x) => (x.id === row.id ? row : x)) : [...list, row];

// The owner's Timesheets section. Only for accounts with the add-on: anyone
// else is sent back to the dashboard. It needs a connection, so a failed load
// says so rather than showing empty lists.
export default function TimesheetsHome({ onClose, onNotAllowed }) {
  const { user } = useApp();
  const access = useTimesheetsAddon(user?.id);
  const [tab, setTab] = useState("jobs");
  const [jobs, setJobs] = useState(null);
  const [types, setTypes] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => { if (access.status === "off") onNotAllowed?.(); }, [access.status, onNotAllowed]);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const [j, t] = await Promise.all([listJobs(), listWorkTypes()]);
      setJobs(j);
      setTypes(t);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => { if (access.status === "on") load(); }, [access.status, load]);

  const failed = access.status === "failed" || loadFailed;
  const ready = access.status === "on" && jobs && types && !loadFailed;

  return (
    <div className="pw-ts">
      <style>{CSS}</style>
      <div className="ts-sheet">
        <header className="ts-head">
          <div className="ts-head-l">
            <span className="ts-ic"><Clock size={19} strokeWidth={1.8}/></span>
            <div>
              <h1>Timesheets</h1>
              <p>Your jobs and work types, for your team to record their hours against.</p>
            </div>
          </div>
          <button type="button" className="ts-close" onClick={onClose} title="Back to dashboard" aria-label="Back to dashboard">
            <X size={19} strokeWidth={2}/>
          </button>
        </header>

        {failed ? (
          <div className="ts-failed" role="alert">
            <StatusIcon tone="red" size={26} />
            <p>Couldn&rsquo;t load Timesheets. Check your connection and try again.</p>
            <button type="button" className="ts-btn" onClick={access.status === "failed" ? access.retry : load}>Try again</button>
          </div>
        ) : !ready ? (
          <div className="ts-loading">Loading&hellip;</div>
        ) : (
          <>
            <div className="ts-tabs" role="tablist" aria-label="Timesheets sections">
              {TABS.map((t) => (
                <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className="ts-tab" onClick={() => setTab(t.key)}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="ts-body">
              {tab === "jobs" && (
                <JobsPanel ownerId={user.id} jobs={jobs} types={types} onSaved={(row) => setJobs((l) => withRow(l, row))} />
              )}
              {tab === "types" && (
                <WorkTypesPanel ownerId={user.id} types={types} onSaved={(row) => setTypes((l) => withRow(l, row))} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const CSS = `
.pw-ts{position:fixed; inset:0; z-index:1; overflow:auto; padding:28px 20px 48px;
  --teal:#3FB7C9; --teal-600:#2C97A8; --teal-700:#22808F; --navy:#1A2530;
  --paper:#F4F6F9; --surface:#FFFFFF; --line:#E6EBF1; --ink:#0E141B; --ink-2:#3A4654; --muted:#697785;
  background:var(--paper); color:var(--ink);
  font-family:var(--font-inter),system-ui,sans-serif; -webkit-font-smoothing:antialiased}
.pw-ts *{box-sizing:border-box; margin:0; padding:0}
html.dark .pw-ts{--paper:#0E141B; --surface:#16202B; --line:#263441; --ink:#E7EDF3; --ink-2:#C3CEDA; --muted:#8B99A8}

.pw-ts .ts-sheet{max-width:880px; margin:0 auto; background:var(--surface); border:1px solid var(--line); border-radius:18px; overflow:hidden}
.pw-ts .ts-head{display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:20px 22px; border-bottom:1px solid var(--line)}
.pw-ts .ts-head-l{display:flex; align-items:center; gap:13px}
.pw-ts .ts-ic{width:40px; height:40px; border-radius:10px; display:flex; align-items:center; justify-content:center; flex:none; background:var(--teal-600); color:var(--navy)}
.pw-ts h1{font-family:var(--font-space-grotesk),system-ui,sans-serif; font-size:18px; font-weight:600; letter-spacing:-.01em}
.pw-ts .ts-head p{font-size:12.5px; color:var(--muted); margin-top:2px}
.pw-ts .ts-close{width:40px; height:40px; flex:none; border:0; border-radius:10px; display:flex; align-items:center; justify-content:center; background:var(--teal-600); color:var(--navy); cursor:pointer; transition:background .15s ease}
.pw-ts .ts-close:hover{background:var(--teal-700)}

.pw-ts .ts-loading{padding:48px 22px; text-align:center; font-size:12px; letter-spacing:.2em; text-transform:uppercase; color:var(--muted)}
.pw-ts .ts-failed{padding:40px 22px; display:flex; flex-direction:column; align-items:center; gap:12px; text-align:center; font-size:14px; color:var(--ink-2)}

.pw-ts .ts-tabs{display:flex; gap:8px; padding:14px 22px 0}
.pw-ts .ts-tab{height:38px; padding:0 16px; font-family:inherit; font-size:13px; font-weight:600; border:1px solid var(--line); border-radius:10px; background:transparent; color:var(--ink-2); cursor:pointer}
.pw-ts .ts-tab:hover{background:var(--paper)}
.pw-ts .ts-tab[aria-selected="true"]{background:var(--teal-600); border-color:var(--teal-600); color:var(--navy)}

.pw-ts .ts-body{padding:18px 22px 24px; display:flex; flex-direction:column; gap:14px}
.pw-ts .ts-tools{display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap}
.pw-ts .ts-hint{font-size:12px; color:var(--muted); line-height:1.45}
.pw-ts .ts-check{display:inline-flex; align-items:center; gap:7px; font-size:12.5px; color:var(--ink-2); cursor:pointer}
.pw-ts .ts-check input{width:16px; height:16px; accent-color:var(--teal-600)}
.pw-ts .ts-error{font-size:12.5px; color:#c0392b}
.pw-ts .ts-empty{padding:26px 12px; text-align:center; font-size:13px; color:var(--muted); border:1px dashed var(--line); border-radius:12px}

/* App standard: solid teal with a dark navy icon. */
.pw-ts .ts-btn{display:inline-flex; align-items:center; justify-content:center; gap:7px; height:38px; padding:0 14px; font-family:inherit; font-size:13px; font-weight:600; border:0; border-radius:10px; background:var(--teal-600); color:var(--navy); cursor:pointer; transition:background .15s ease; white-space:nowrap}
.pw-ts .ts-btn:hover:not(:disabled){background:var(--teal-700)}
.pw-ts .ts-btn.is-small{height:34px; padding:0 11px; font-size:12px}
.pw-ts .ts-btn svg{display:block; flex:none}
.pw-ts button:disabled{opacity:.55; cursor:not-allowed}

.pw-ts .ts-form{display:grid; grid-template-columns:150px 1fr; gap:12px; padding:16px; background:var(--paper); border:1px solid var(--line); border-radius:12px}
.pw-ts .ts-field{display:block}
.pw-ts .ts-field.is-wide{grid-column:1 / -1}
.pw-ts .ts-label{display:block; font-size:12px; font-weight:600; color:var(--ink-2); margin-bottom:6px}
.pw-ts input[type="text"], .pw-ts select{width:100%; height:40px; font-family:inherit; font-size:14px; color:var(--ink); background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:0 12px; outline:none}
.pw-ts input[type="text"]:focus, .pw-ts select:focus{border-color:var(--teal); box-shadow:0 0 0 3px rgba(63,183,201,.18)}
.pw-ts .ts-form-actions{grid-column:1 / -1; display:flex; justify-content:flex-end; gap:8px}
.pw-ts .ts-form .ts-error{grid-column:1 / -1}

.pw-ts .ts-inline{display:flex; gap:8px}
.pw-ts .ts-inline input{flex:1; min-width:0}

.pw-ts .ts-list{display:flex; flex-direction:column; border:1px solid var(--line); border-radius:12px; overflow:hidden}
.pw-ts .ts-row{display:grid; align-items:center; gap:12px; padding:11px 14px; border-top:1px solid var(--line)}
.pw-ts .ts-row:first-child{border-top:0}
.pw-ts .ts-row.is-job{grid-template-columns:96px 1fr 150px auto}
.pw-ts .ts-row.is-type{grid-template-columns:1fr auto}
.pw-ts .ts-row.is-archived{background:var(--paper)}
.pw-ts .ts-num{font-weight:600; font-size:14px; overflow-wrap:anywhere}
.pw-ts .ts-name{font-size:14px; overflow-wrap:anywhere}
.pw-ts .ts-sub{font-size:12px; color:var(--muted); margin-top:2px; overflow-wrap:anywhere}
.pw-ts .ts-type{font-size:12.5px; color:var(--ink-2); overflow-wrap:anywhere}
.pw-ts .ts-badge{display:inline-block; font-size:11px; font-weight:600; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:1px 8px; margin-left:8px; vertical-align:1px}
.pw-ts .ts-actions{display:flex; gap:6px; justify-content:flex-end}

@media (max-width:640px){
  .pw-ts{padding:12px 10px 32px}
  .pw-ts .ts-form{grid-template-columns:1fr}
  .pw-ts .ts-row.is-job{grid-template-columns:1fr}
  .pw-ts .ts-actions{justify-content:flex-start}
}
`;
