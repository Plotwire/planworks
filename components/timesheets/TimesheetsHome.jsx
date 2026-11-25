"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { StatusIcon } from "@/components/StatusMark";
import AppRailLinks from "@/components/AppRailLinks";
import { useTimesheetsAddon } from "@/lib/timesheets/useTimesheetsAddon";
import { listJobs, listWorkTypes } from "@/lib/timesheets/lists";
import { getContext, listTeam } from "@/lib/timesheets/entries";
import JobsPanel from "@/components/timesheets/JobsPanel";
import WorkTypesPanel from "@/components/timesheets/WorkTypesPanel";
import WorkersPanel from "@/components/timesheets/WorkersPanel";

const withRow = (list, row) =>
  list.some((x) => x.id === row.id) ? list.map((x) => (x.id === row.id ? row : x)) : [...list, row];

function displayName(user) {
  const meta = user?.user_metadata || {};
  const fromMeta = meta.full_name || meta.name;
  if (fromMeta) return String(fromMeta).trim().split(/\s+/)[0];
  const local = (user?.email || "").split("@")[0].replace(/[._-]+/g, " ").trim();
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : "";
}

// The owner's Timesheets section, in the same frame as the dashboard. Only for
// accounts with the add-on switched on: anyone else gets a short page saying
// it's an add-on, and none of the Timesheets screens. (The database refuses
// them everything anyway.) It needs a connection, so a failed load says so
// rather than showing empty lists.
export default function TimesheetsHome({ onClose }) {
  const { user, theme, toggleTheme, signOut } = useApp();
  const access = useTimesheetsAddon(user?.id);
  const [tab, setTab] = useState("workers");
  const [jobs, setJobs] = useState(null);
  const [types, setTypes] = useState(null);
  const [team, setTeam] = useState(null);
  const [thisMonday, setThisMonday] = useState(null); // from the database clock
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const [j, t, o, ctx] = await Promise.all([listJobs(), listWorkTypes(), listTeam(), getContext()]);
      setJobs(j);
      setTypes(t);
      setTeam(o);
      setThisMonday(ctx?.week_start || null);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => { if (access.status === "on") load(); }, [access.status, load]);

  const failed = access.status === "failed" || loadFailed;
  const ready = access.status === "on" && jobs && types && team && thisMonday && !loadFailed;
  const initials = (displayName(user) || user?.email || "?").slice(0, 2).toUpperCase();

  const count = (list, test) => (list ? list.filter(test).length : "–");
  const tabs = [
    { key: "workers", label: "Workers", n: count(team, (o) => o.status !== "removed") },
    { key: "jobs", label: "Jobs", n: count(jobs, (j) => j.status === "active") },
    { key: "types", label: "Work types", n: count(types, (t) => t.active) },
  ];

  // Nothing of Timesheets shows until the database says the add-on is on.
  if (access.status !== "on") return <AddonOnly status={access.status} onRetry={access.retry} onClose={onClose} />;

  return (
    <div className="pw-ts">
      <style>{CSS}</style>
      <div className="ts-app">
        <aside className="ts-rail">
          <button type="button" className="ts-brandmark" onClick={onClose} title="Plotwire dashboard" aria-label="Plotwire dashboard">
            <svg viewBox="0 0 24 24" fill="none"><path d="M13 2 4 13h6l-1 9 9-11h-6l1-9z" fill="#08313a"/></svg>
          </button>
          <button type="button" className="ts-nav" onClick={onClose} title="Dashboard" aria-label="Dashboard">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>
          </button>
          <AppRailLinks className="ts-nav" />
          <div className="ts-nav is-active" title="Timesheets" aria-current="page">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
          </div>
          <div className="ts-rail-spacer" />
          <div className="ts-rail-avatar" aria-hidden="true">{initials}</div>
        </aside>

        <div className="ts-main">
          <header className="ts-topbar">
            <span className="ts-wordmark">Plot<b>wire</b></span>
            <span className="ts-crumb">Timesheets</span>
            <div className="ts-topbar-right">
              <button type="button" className="ts-icon-btn" onClick={toggleTheme} title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} aria-label="Toggle theme">
                {theme === "dark" ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19"/></svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
                )}
              </button>
              <div className="ts-account" title={user?.email || ""}>
                <div className="ts-account-text">
                  <div className="nm">{displayName(user) || "Account"}</div>
                  <div className="sub">{user?.email || ""}</div>
                </div>
                <div className="pic">{(user?.email || "?").slice(0, 2).toUpperCase()}</div>
              </div>
              <button type="button" className="ts-icon-btn" onClick={signOut} title="Sign out" aria-label="Sign out">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>
              </button>
            </div>
          </header>

          <div className="ts-scroll">
            <div className="ts-wrap">
              <section className="ts-hero">
                <div className="ts-hero-glow" />
                <div className="ts-hero-inner">
                  <div className="ts-eyebrow">Timesheets</div>
                  <h1>Your team&rsquo;s hours</h1>
                  <p>Each worker&rsquo;s week, the jobs they record against, and an export for your spreadsheet.</p>
                </div>
                <div className="ts-stats">
                  <div className="ts-stat"><div className="n">{count(team, (o) => o.status !== "removed")}</div><div className="l">Workers</div></div>
                  <div className="ts-stat"><div className="n">{count(jobs, (j) => j.status === "active")}</div><div className="l">Active jobs</div></div>
                  <div className="ts-stat"><div className="n">{count(types, (t) => t.active)}</div><div className="l">Work types</div></div>
                </div>
              </section>

              {failed ? (
                <div className="ts-failed" role="alert">
                  <StatusIcon tone="red" size={28} />
                  <h3>Couldn&rsquo;t load Timesheets</h3>
                  <p>Check your connection and try again.</p>
                  <button type="button" className="ts-btn is-primary" onClick={access.status === "failed" ? access.retry : load}>Try again</button>
                </div>
              ) : !ready ? (
                <div className="ts-card ts-skel" aria-label="Loading">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="ts-sk-row"><span className="ts-sk w15" /><span className="ts-sk w45" /><span className="ts-sk w20" /></div>
                  ))}
                </div>
              ) : (
                <>
                  <div className="ts-tabs" role="tablist" aria-label="Timesheets sections">
                    {tabs.map((t) => (
                      <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className="ts-tab" onClick={() => setTab(t.key)}>
                        {t.label}<i>{t.n}</i>
                      </button>
                    ))}
                  </div>
                  {tab === "workers" && (
                    <WorkersPanel thisMonday={thisMonday} onTeamChange={() => listTeam().then(setTeam).catch(() => {})} />
                  )}
                  {tab === "jobs" && (
                    <JobsPanel ownerId={user.id} jobs={jobs} types={types} onSaved={(row) => setJobs((l) => withRow(l, row))} />
                  )}
                  {tab === "types" && (
                    <WorkTypesPanel ownerId={user.id} types={types} onSaved={(row) => setTypes((l) => withRow(l, row))} />
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Timesheets without the add-on: a short, plain page. No pop-ups, nothing
// pushy, and no Timesheets data (none is asked for).
function AddonOnly({ status, onRetry, onClose }) {
  return (
    <div className="pw-ts">
      <style>{CSS}</style>
      <main className="ts-gate">
        <div className="ts-gate-brand">Plot<b>wire</b></div>
        {status === "checking" ? (
          <p className="ts-gate-loading" aria-label="Loading">Loading&hellip;</p>
        ) : status === "failed" ? (
          <section className="ts-gate-card" role="alert">
            <StatusIcon tone="red" size={28} />
            <h1>Couldn&rsquo;t check your account</h1>
            <p>Check your connection and try again.</p>
            <div className="ts-gate-actions">
              <button type="button" className="ts-btn is-primary" onClick={onRetry}>Try again</button>
              <button type="button" className="ts-btn is-primary" onClick={onClose}>Back to dashboard</button>
            </div>
          </section>
        ) : (
          <section className="ts-gate-card">
            <span className="ts-gate-ic" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
            </span>
            <h1>Timesheets is an add-on.</h1>
            <p>Contact <a href="mailto:admin@plotwire.uk">admin@plotwire.uk</a> to find out more.</p>
            <div className="ts-gate-actions">
              <button type="button" className="ts-btn is-primary" onClick={onClose}>Back to dashboard</button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

// The same colours, type, rail, top bar, hero and cards as the dashboard
// (components/HomeScreen.jsx).
const CSS = `
.pw-ts{position:fixed; inset:0; z-index:1;
  --ink:#0E141B; --navy:#1A2530; --navy-2:#22303D; --navy-line:#314250;
  --brand:#2C3E50; --teal:#3FB7C9; --teal-600:#2C97A8; --teal-700:#22808F;
  --paper:#F4F6F9; --surface:#FFFFFF; --line:#E6EBF1; --line-2:#EEF2F6;
  --ink-2:#3A4654; --muted:#697785; --muted-2:#9AA6B2; --blueprint:rgba(63,183,201,.14);
  --chip-ink:#08313A; --teal-soft:#E2F4F7; --teal-soft-line:rgba(44,151,168,.32);
  font-family:var(--font-inter),system-ui,sans-serif; color:var(--ink); -webkit-font-smoothing:antialiased}
.pw-ts *{box-sizing:border-box; margin:0; padding:0}
html.dark .pw-ts{--ink:#E7EDF3; --ink-2:#B6C2CE; --muted:#8595A3; --muted-2:#6B7A88;
  --paper:#0E141B; --surface:#16202B; --line:#263441; --line-2:#202C38;
  --navy:#0A1016; --navy-2:#16202B; --navy-line:#283642; --blueprint:rgba(63,183,201,.10);
  --teal-soft:rgba(63,183,201,.14); --teal-soft-line:rgba(63,183,201,.35)}
.pw-ts .ts-app{display:flex; height:100%; width:100%; background:var(--paper)}

.pw-ts .ts-rail{width:74px; flex-shrink:0; background:var(--navy); display:flex; flex-direction:column; align-items:center; padding:18px 0; gap:6px; position:relative}
.pw-ts .ts-rail::after{content:""; position:absolute; inset:0 0 0 auto; width:1px; background:rgba(255,255,255,.05)}
.pw-ts .ts-brandmark{width:42px; height:42px; border:0; border-radius:12px; background:linear-gradient(150deg,var(--teal),var(--teal-700)); display:grid; place-items:center; margin-bottom:18px; box-shadow:0 6px 16px -4px rgba(63,183,201,.5); cursor:pointer}
.pw-ts .ts-brandmark svg{width:22px; height:22px}
.pw-ts .ts-nav{width:46px; height:46px; border:0; border-radius:12px; background:transparent; display:grid; place-items:center; color:#8190a0; cursor:pointer; transition:all .18s ease; position:relative; text-decoration:none}
.pw-ts .ts-nav svg{width:21px; height:21px}
.pw-ts .ts-nav:hover{color:var(--navy); background:var(--teal-600)}
.pw-ts .ts-nav.is-active,.pw-ts .ts-nav.is-active:hover{color:#fff; background:rgba(63,183,201,.16); cursor:default}
.pw-ts .ts-rail-spacer{flex:1}
.pw-ts .ts-rail-avatar{width:40px; height:40px; border-radius:50%; background:var(--navy-2); border:1.5px solid var(--navy-line); color:#cdd6e0; display:grid; place-items:center; font-weight:600; font-size:13px; font-family:var(--font-space-grotesk),sans-serif; margin-top:6px}

.pw-ts .ts-main{flex:1; display:flex; flex-direction:column; min-width:0}
.pw-ts .ts-topbar{height:62px; flex-shrink:0; background:rgba(255,255,255,.85); backdrop-filter:saturate(1.4) blur(10px); border-bottom:1px solid var(--line); display:flex; align-items:center; gap:14px; padding:0 30px}
html.dark .pw-ts .ts-topbar{background:rgba(14,20,27,.82)}
.pw-ts .ts-wordmark{font-family:var(--font-space-grotesk),sans-serif; font-weight:600; font-size:17px; letter-spacing:-.01em}
.pw-ts .ts-wordmark b{color:var(--teal-600); font-weight:600}
.pw-ts .ts-crumb{font-size:13.5px; color:var(--muted); padding-left:14px; border-left:1px solid var(--line)}
.pw-ts .ts-topbar-right{margin-left:auto; display:flex; align-items:center; gap:14px}
.pw-ts .ts-icon-btn{width:38px; height:38px; flex:none; border-radius:10px; border:none; background:var(--action); color:var(--action-ink); display:grid; place-items:center; cursor:pointer; transition:background .16s}
.pw-ts .ts-icon-btn:hover{background:var(--action-hover)}
.pw-ts .ts-icon-btn svg{width:18px; height:18px}
.pw-ts .ts-account{display:flex; align-items:center; gap:10px; padding:5px 6px 5px 12px; border-radius:11px}
.pw-ts .ts-account-text{text-align:right}
.pw-ts .ts-account .nm{font-size:13px; font-weight:500; line-height:1.15}
.pw-ts .ts-account .sub{font-size:11px; color:var(--muted)}
.pw-ts .ts-account .pic{width:32px; height:32px; border-radius:50%; background:var(--brand); color:#fff; display:grid; place-items:center; font-weight:600; font-size:12px; font-family:var(--font-space-grotesk),sans-serif}

.pw-ts .ts-scroll{flex:1; overflow-y:auto; padding:36px 40px 60px}
.pw-ts .ts-wrap{max-width:1080px; margin:0 auto}

.pw-ts .ts-hero{position:relative; overflow:hidden; border-radius:22px; background:linear-gradient(120deg,#1A2530 0%,#233241 60%,#2C4150 100%); padding:32px 34px; margin-bottom:26px; color:#fff; box-shadow:0 18px 40px -12px rgba(16,28,40,.22)}
.pw-ts .ts-hero::before{content:""; position:absolute; inset:0; background-image:linear-gradient(var(--blueprint) 1px,transparent 1px),linear-gradient(90deg,var(--blueprint) 1px,transparent 1px); background-size:26px 26px; -webkit-mask-image:linear-gradient(105deg,transparent 40%,#000 100%); mask-image:linear-gradient(105deg,transparent 40%,#000 100%)}
.pw-ts .ts-hero-glow{position:absolute; right:-80px; top:-90px; width:340px; height:340px; border-radius:50%; background:radial-gradient(circle,rgba(63,183,201,.32),transparent 68%)}
.pw-ts .ts-hero-inner{position:relative}
.pw-ts .ts-eyebrow{font-family:var(--font-jetbrains-mono),monospace; font-size:11.5px; letter-spacing:.16em; text-transform:uppercase; color:var(--teal); margin-bottom:12px}
.pw-ts .ts-hero h1{font-family:var(--font-space-grotesk),sans-serif; font-weight:600; font-size:30px; letter-spacing:-.02em; line-height:1.08; margin-bottom:9px}
.pw-ts .ts-hero p{color:#aab8c6; font-size:14.5px; max-width:430px; line-height:1.55}
.pw-ts .ts-stats{position:relative; display:flex; gap:34px; margin-top:26px; padding-top:22px; border-top:1px solid rgba(255,255,255,.1)}
.pw-ts .ts-stat .n{font-family:var(--font-space-grotesk),sans-serif; font-size:23px; font-weight:600}
.pw-ts .ts-stat .l{font-size:11.5px; color:#93a2b1; margin-top:2px}

.pw-ts .ts-tabs{display:flex; gap:8px; margin:0 2px 14px}
.pw-ts .ts-tab{height:40px; padding:0 12px 0 16px; display:inline-flex; align-items:center; gap:9px; font-family:inherit; font-size:13.5px; font-weight:600; border:1px solid var(--line); border-radius:12px; background:var(--surface); color:var(--ink-2); cursor:pointer; transition:all .16s ease}
.pw-ts .ts-tab:hover{border-color:var(--teal-600)}
.pw-ts .ts-tab i{font-style:normal; font-family:var(--font-jetbrains-mono),monospace; font-size:11px; font-weight:500; padding:2px 7px; border-radius:6px; background:var(--paper); color:var(--ink-2)}
.pw-ts .ts-tab[aria-selected="true"]{background:var(--action); border-color:var(--action); color:var(--action-ink)}
.pw-ts .ts-tab[aria-selected="true"] i{background:rgba(255,255,255,.92); color:var(--navy)}

.pw-ts .ts-card{background:var(--surface); border:1px solid var(--line); border-radius:16px; overflow:hidden; box-shadow:0 1px 2px rgba(16,28,40,.04),0 1px 3px rgba(16,28,40,.06)}
html.dark .pw-ts .ts-card{box-shadow:0 1px 2px rgba(0,0,0,.4)}
/* Card headers: a navy strip (Plotwire's brand navy) with white text. */
.pw-ts .ts-card-head{display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; padding:16px 22px; background:var(--brand); color:#fff}
.pw-ts .ts-card-head h2{font-family:var(--font-space-grotesk),sans-serif; font-weight:600; font-size:17px; letter-spacing:-.01em; color:#fff}
.pw-ts .ts-card-head p{font-size:13px; color:#B7C6D2; margin-top:3px}
.pw-ts .ts-card-tools{display:flex; align-items:center; gap:16px; flex-wrap:wrap}
.pw-ts .ts-card-head .ts-check{color:#D7E2EB}
.pw-ts .ts-card-alert{padding:14px 22px 0}
.pw-ts .ts-card-alert + .ts-card-alert{padding-top:8px}
.pw-ts .ts-card-foot{padding:14px 22px 16px; font-size:12px; line-height:1.5; color:var(--muted); border-top:1px solid var(--line-2)}
.pw-ts .ts-check{display:inline-flex; align-items:center; gap:8px; font-size:13px; color:var(--ink-2); cursor:pointer}
.pw-ts .ts-check input{width:16px; height:16px; accent-color:var(--teal-600)}

/* App standard: solid teal with a dark navy icon. */
.pw-ts .ts-btn{height:36px; padding:0 13px 0 10px; display:inline-flex; align-items:center; justify-content:center; gap:7px; border:none; border-radius:10px; background:var(--action); color:var(--action-ink); font-family:inherit; font-size:12.5px; font-weight:600; cursor:pointer; white-space:nowrap; transition:all .16s ease}
.pw-ts .ts-btn svg{width:16px; height:16px; flex:none; display:block}
.pw-ts .ts-btn:hover:not(:disabled){background:var(--action-hover); transform:translateY(-1px); box-shadow:0 8px 22px -6px color-mix(in srgb, var(--action) 60%, transparent)}
.pw-ts .ts-btn.is-primary{height:42px; padding:0 18px 0 14px; border-radius:12px; font-size:13.5px}
.pw-ts .ts-btn.is-primary svg{width:18px; height:18px}
.pw-ts button:disabled{opacity:.55; cursor:not-allowed}
.pw-ts button:focus-visible,.pw-ts input:focus-visible,.pw-ts select:focus-visible{outline:2px solid var(--teal); outline-offset:2px}

.pw-ts .ts-tr{display:grid; align-items:center; gap:16px; padding:14px 22px; border-top:1px solid var(--line-2); transition:background .14s ease}
.pw-ts .ts-tr.is-job{grid-template-columns:110px minmax(0,1.7fr) minmax(0,1fr) 180px}
.pw-ts .ts-tr.is-type{grid-template-columns:minmax(0,1fr) auto}
.pw-ts .ts-tr:not(.is-head):hover{background:rgba(63,183,201,.06)}
.pw-ts .ts-tr:not(.is-head):not(.is-archived){box-shadow:inset 4px 0 0 var(--teal-600)}
.pw-ts .ts-tr.is-head{padding-top:10px; padding-bottom:10px; background:var(--paper); border-top:1px solid var(--line); border-bottom:1px solid var(--line); font-family:var(--font-jetbrains-mono),monospace; font-size:10.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted)}
.pw-ts .ts-tr.is-head + .ts-tr{border-top:0}
.pw-ts .ts-tr.is-archived .ts-name,.pw-ts .ts-tr.is-archived .ts-type,.pw-ts .ts-tr.is-archived .ts-code{opacity:.62}
.pw-ts .ts-sr{position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%)}
/* Job number chip: teal, dark ink, mono. */
.pw-ts .ts-code{display:inline-block; flex:none; font-family:var(--font-jetbrains-mono),monospace; font-size:12px; font-weight:700; color:var(--chip-ink); background:var(--teal); padding:3px 8px; border-radius:6px; overflow-wrap:anywhere; line-height:1.3}
.pw-ts .ts-jobname{display:inline-flex; align-items:center; gap:8px; min-width:0}
.pw-ts .ts-jobname > span:last-child{overflow-wrap:anywhere}
.pw-ts .ts-tag{display:inline-block; padding:2px 8px; border-radius:999px; background:var(--line-2); color:var(--ink-2); font-size:12px; font-weight:600; white-space:nowrap}
.pw-ts .ts-mono{font-family:var(--font-jetbrains-mono),monospace}
.pw-ts .ts-name{font-size:14.5px; font-weight:600; letter-spacing:-.01em; overflow-wrap:anywhere}
.pw-ts .ts-sub{display:flex; align-items:center; gap:5px; margin-top:3px; font-size:12.5px; color:var(--muted); overflow-wrap:anywhere}
.pw-ts .ts-sub svg{width:13px; height:13px; flex:none; opacity:.7}
.pw-ts .ts-type{font-size:13px; color:var(--ink-2); overflow-wrap:anywhere}
.pw-ts .ts-type.is-none{color:var(--muted-2)}
.pw-ts .ts-badge{display:inline-block; font-family:var(--font-jetbrains-mono),monospace; font-size:10px; font-weight:500; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); background:var(--paper); border:1px solid var(--line); border-radius:6px; padding:2px 6px; margin-left:9px; vertical-align:1.5px}
.pw-ts .ts-actions{display:flex; gap:7px; justify-content:flex-end}

.pw-ts .ts-empty{margin:22px; padding:38px 20px; display:flex; flex-direction:column; align-items:center; text-align:center; border:1.5px dashed var(--line); border-radius:14px}
.pw-ts .ts-empty-ic{width:50px; height:50px; border-radius:14px; background:rgba(63,183,201,.12); color:var(--teal-700); display:grid; place-items:center; margin-bottom:14px}
.pw-ts .ts-empty-ic svg{width:24px; height:24px}
.pw-ts .ts-empty h3,.pw-ts .ts-failed h3{font-family:var(--font-space-grotesk),sans-serif; font-weight:600; font-size:16px; letter-spacing:-.01em}
.pw-ts .ts-empty p,.pw-ts .ts-failed p{font-size:13.5px; color:var(--muted); margin:5px 0 16px; max-width:360px; line-height:1.5}
.pw-ts .ts-failed{display:flex; flex-direction:column; align-items:center; text-align:center; gap:6px; padding:40px 20px; background:var(--surface); border:1px solid var(--line); border-radius:16px}

.pw-ts .ts-skel{padding:8px 22px}
.pw-ts .ts-sk-row{display:flex; gap:24px; padding:18px 0; border-top:1px solid var(--line-2)}
.pw-ts .ts-sk-row:first-child{border-top:0}
.pw-ts .ts-sk{height:12px; border-radius:5px; background:var(--line-2)}
.pw-ts .ts-sk.w15{width:15%} .pw-ts .ts-sk.w45{width:45%} .pw-ts .ts-sk.w20{width:20%}

.pw-ts .ts-alert{display:flex; align-items:flex-start; gap:9px; padding:10px 12px; font-size:13px; line-height:1.4; color:var(--ink); background:#FEF2F2; border:1.5px solid #F87171; border-radius:10px}
html.dark .pw-ts .ts-alert{background:#2E1A1A; border-color:#EF4444}

.pw-ts .ts-dialog-back{position:fixed; inset:0; z-index:60; background:rgba(11,17,23,.55); backdrop-filter:blur(2px); display:grid; place-items:center; padding:20px; overflow:auto}
.pw-ts .ts-dialog{width:100%; max-width:520px; background:var(--surface); color:var(--ink); border:1px solid var(--line); border-radius:16px; padding:22px; display:flex; flex-direction:column; gap:16px; box-shadow:0 24px 60px -12px rgba(11,17,23,.45)}
.pw-ts .ts-dialog-head{display:flex; align-items:center; gap:12px}
.pw-ts .ts-dialog-head h2{font-family:var(--font-space-grotesk),sans-serif; font-size:18px; font-weight:600; letter-spacing:-.01em}
.pw-ts .ts-ic{width:40px; height:40px; flex:none; border-radius:10px; display:grid; place-items:center; background:var(--action); color:var(--action-ink)}
.pw-ts .ts-fields{display:grid; grid-template-columns:150px 1fr; gap:14px}
.pw-ts .ts-field{display:block}
.pw-ts .ts-field.is-wide{grid-column:1 / -1}
.pw-ts .ts-label{display:block; font-size:12px; font-weight:600; color:var(--ink-2); margin-bottom:6px}
.pw-ts input[type="text"],.pw-ts select{width:100%; height:42px; padding:0 12px; font-family:inherit; font-size:14px; color:var(--ink); background:var(--paper); border:1px solid var(--line); border-radius:10px; outline:none; transition:border-color .15s ease, box-shadow .15s ease}
.pw-ts input[type="text"]:focus,.pw-ts select:focus{border-color:var(--teal); box-shadow:0 0 0 3px rgba(63,183,201,.18); outline:none}
.pw-ts .ts-dialog-actions{display:flex; justify-content:flex-end; gap:9px}
.pw-ts .ts-dialog-actions .ts-btn{height:40px; font-size:13px}

/* Workers: each worker's week (components/timesheets/WorkersPanel.jsx). */
.pw-ts .ts-btn.is-quiet{background:var(--line-2); color:var(--ink-2)}
.pw-ts .ts-btn.is-quiet:hover:not(:disabled){background:var(--line); box-shadow:none}
.pw-ts .ts-btn-icon{width:38px; height:38px; padding:0}
.pw-ts .ts-btn-icon svg{width:19px; height:19px}
.pw-ts .ts-weeknav{display:flex; align-items:center; gap:10px}
.pw-ts .ts-weeknav-label{min-width:170px; text-align:center; line-height:1.25}
.pw-ts .ts-weeknav-label span{display:block; font-family:var(--font-jetbrains-mono),monospace; font-size:10.5px; letter-spacing:.12em; text-transform:uppercase; color:#7FD3DF}
.pw-ts .ts-weeknav-label b{font-family:var(--font-space-grotesk),sans-serif; font-size:15px; font-weight:600; color:#fff}

/* One card per worker: navy strip (name, submitted badge, week total),
   then hours per day and per job. */
.pw-ts .ts-workers{display:grid; grid-template-columns:repeat(auto-fill,minmax(min(440px,100%),1fr)); gap:14px; padding:16px}
.pw-ts .ts-worker{background:var(--surface); border:1px solid var(--line); border-radius:14px; overflow:hidden; box-shadow:0 1px 2px rgba(16,28,40,.05),0 3px 10px -4px rgba(16,28,40,.10)}
html.dark .pw-ts .ts-worker{box-shadow:0 1px 2px rgba(0,0,0,.4)}
.pw-ts .ts-worker-head{display:flex; align-items:center; justify-content:space-between; gap:14px; padding:12px 16px; background:var(--brand); color:#fff}
.pw-ts .ts-worker-name{min-width:0}
.pw-ts .ts-worker-name h3{font-family:var(--font-space-grotesk),sans-serif; font-weight:600; font-size:16px; letter-spacing:-.01em; margin-bottom:6px; color:#fff; overflow-wrap:anywhere}
.pw-ts .ts-worker-head .ts-badge{background:rgba(255,255,255,.12); border-color:rgba(255,255,255,.22); color:#D7E2EB}
.pw-ts .ts-pill{display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:700; padding:4px 10px 4px 7px; border-radius:999px}
.pw-ts .ts-pill svg{width:14px; height:14px; flex:none}
.pw-ts .ts-pill.is-green{background:#DCFCE7; color:#14532D}
.pw-ts .ts-pill.is-amber{background:#FEF3C7; color:#78350F}
.pw-ts .ts-worker-total{text-align:right; flex:none}
.pw-ts .ts-worker-total .n{font-family:var(--font-jetbrains-mono),monospace; font-weight:700; font-size:24px; letter-spacing:-.02em; line-height:1.1; color:#fff}
.pw-ts .ts-worker-total .l{margin-top:2px; font-size:10.5px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; color:#B7C6D2}
.pw-ts .ts-worker-body{padding:14px 16px 10px}
.pw-ts .ts-daygrid{display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:6px}
.pw-ts .ts-daycell{display:flex; flex-direction:column; align-items:center; gap:3px; padding:8px 2px; border-radius:10px; background:var(--teal-soft); border:1px solid var(--teal-soft-line)}
.pw-ts .ts-daycell span{font-size:10.5px; font-weight:700; color:var(--ink-2); text-transform:uppercase; letter-spacing:.06em}
.pw-ts .ts-daycell b{font-family:var(--font-jetbrains-mono),monospace; font-size:12.5px; font-weight:700; white-space:nowrap; color:var(--ink)}
.pw-ts .ts-daycell.is-zero{background:var(--paper); border-color:var(--line-2)}
.pw-ts .ts-daycell.is-zero span{color:var(--muted)}
.pw-ts .ts-daycell.is-zero b{color:var(--muted-2); font-weight:500}
.pw-ts .ts-jobtotals{list-style:none; margin-top:12px; display:flex; flex-direction:column; gap:6px}
.pw-ts .ts-jobtotals li{display:flex; align-items:center; justify-content:space-between; gap:12px; font-size:13.5px; color:var(--ink); padding:7px 10px;
  border-radius:8px; background:var(--surface); border:1px solid var(--line); border-left:3px solid var(--teal-600)}
.pw-ts .ts-jobtotals li b{white-space:nowrap; font-family:var(--font-jetbrains-mono),monospace; font-weight:700}
.pw-ts .ts-worker-tools{display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-top:12px}
.pw-ts .ts-linkbtn{display:inline-flex; align-items:center; gap:5px; border:0; background:none; font-family:inherit; font-size:13px; font-weight:600; color:var(--teal-700); cursor:pointer; padding:6px 0}
html.dark .pw-ts .ts-linkbtn{color:var(--teal)}
.pw-ts .ts-linkbtn svg{width:16px; height:16px; transition:transform .15s ease}
.pw-ts .ts-linkbtn svg.is-up{transform:rotate(180deg)}
.pw-ts .ts-ask{display:inline-flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:13px; color:var(--ink-2); margin-left:auto}
/* A worker's entries: day on the left; job and hours, then type and times,
   then the note. */
.pw-ts .ts-entries{margin-top:10px; border:1px solid var(--line); border-radius:12px; overflow:hidden}
.pw-ts .ts-entry{display:grid; grid-template-columns:78px minmax(0,1fr) auto; grid-template-areas:"day job hours" "day type time" "day note note";
  gap:4px 10px; padding:9px 12px; font-size:13px; border-top:1px solid var(--line-2); align-items:center}
.pw-ts .ts-entry > :nth-child(1){grid-area:day; align-self:start; font-weight:600; color:var(--ink-2)}
.pw-ts .ts-entry > :nth-child(2){grid-area:job}
.pw-ts .ts-entry > :nth-child(3){grid-area:type}
.pw-ts .ts-entry > :nth-child(4){grid-area:time; text-align:right; color:var(--muted)}
.pw-ts .ts-entry > :nth-child(5){grid-area:hours; text-align:right}
.pw-ts .ts-entry > :nth-child(6){grid-area:note}
.pw-ts .ts-entry:first-child{border-top:0}
.pw-ts .ts-entry.is-head{display:none}
.pw-ts .ts-entry.is-head + .ts-entry{border-top:0}
.pw-ts .ts-entry-job{font-weight:600; overflow-wrap:anywhere}
.pw-ts .ts-entry-note{color:var(--muted); overflow-wrap:anywhere}
.pw-ts .ts-entry-note:empty{display:none}
.pw-ts .ts-export{margin-top:18px}
.pw-ts .ts-export-body{display:flex; align-items:flex-end; gap:12px; flex-wrap:wrap; padding:20px 22px}
.pw-ts .ts-export-body .ts-field{width:170px}
.pw-ts .ts-export-note{padding:0 22px 18px; font-size:13px; color:var(--muted)}
/* Any week: a date to go to, and back to this week. */
.pw-ts .ts-jump{display:flex; align-items:flex-end; gap:8px}
.pw-ts .ts-jump-date{display:flex; flex-direction:column; gap:3px}
.pw-ts .ts-jump-date span{font-size:10.5px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:#B7C6D2}
.pw-ts .ts-jump-date input{height:38px !important; width:150px !important}
/* Invites waiting, and what just happened. */
.pw-ts .ts-card-done{display:flex; align-items:center; gap:8px; margin:14px 22px 0; padding:9px 12px; border-radius:10px; font-size:13.5px; background:#ECFDF3; border:1.5px solid #4ADE80; color:#14532D}
html.dark .pw-ts .ts-card-done{background:#0F2A1A; color:#BBF7D0}
.pw-ts .ts-waiting{margin:16px 16px 0; border:1px solid var(--line); border-radius:14px; overflow:hidden}
.pw-ts .ts-waiting h3{display:flex; align-items:center; gap:8px; padding:10px 14px; background:var(--paper); border-bottom:1px solid var(--line); font-family:var(--font-jetbrains-mono),monospace; font-size:11px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; color:var(--muted)}
.pw-ts .ts-waiting h3 i{font-style:normal; padding:1px 7px; border-radius:6px; background:var(--teal); color:var(--chip-ink)}
.pw-ts .ts-waiting-row{display:flex; align-items:center; gap:12px; flex-wrap:wrap; padding:12px 14px; border-top:1px solid var(--line-2); box-shadow:inset 4px 0 0 #F59E0B}
.pw-ts .ts-waiting h3 + .ts-waiting-row{border-top:0}
.pw-ts .ts-waiting-who{flex:1; min-width:180px; display:flex; flex-direction:column; gap:2px}
.pw-ts .ts-waiting-who b{font-size:14.5px}
.pw-ts .ts-waiting-who span{font-size:12.5px; color:var(--muted); overflow-wrap:anywhere}
.pw-ts .ts-waiting-actions{display:flex; gap:7px; flex-wrap:wrap; margin-left:auto}
.pw-ts .ts-ask.is-remove{flex-basis:100%; justify-content:flex-end}
.pw-ts .ts-dialog-note{font-size:12.5px; line-height:1.5; color:var(--muted)}
.pw-ts input[type="email"]{width:100%; height:42px; padding:0 12px; font-family:inherit; font-size:14px; color:var(--ink); background:var(--paper); border:1px solid var(--line); border-radius:10px; outline:none}
.pw-ts input[type="email"]:focus{border-color:var(--teal); box-shadow:0 0 0 3px rgba(63,183,201,.18)}
.pw-ts input[type="date"]{width:100%; height:42px; padding:0 12px; font-family:inherit; font-size:14px; color:var(--ink); background:var(--paper); border:1px solid var(--line); border-radius:10px; outline:none}
.pw-ts input[type="date"]:focus{border-color:var(--teal); box-shadow:0 0 0 3px rgba(63,183,201,.18)}

/* Without the add-on (AddonOnly). */
.pw-ts .ts-gate{height:100%; overflow-y:auto; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:22px; padding:40px 16px; background:var(--paper)}
.pw-ts .ts-gate-brand{font-family:var(--font-space-grotesk),sans-serif; font-weight:600; font-size:20px; letter-spacing:-.01em}
.pw-ts .ts-gate-brand b{color:var(--teal-600); font-weight:600}
.pw-ts .ts-gate-loading{font-size:14px; color:var(--muted)}
.pw-ts .ts-gate-card{width:100%; max-width:440px; padding:30px 26px; display:flex; flex-direction:column; align-items:center; gap:10px; text-align:center;
  background:var(--surface); border:1px solid var(--line); border-top:4px solid var(--teal-600); border-radius:16px; box-shadow:0 1px 2px rgba(16,28,40,.05),0 8px 24px -12px rgba(16,28,40,.18)}
.pw-ts .ts-gate-ic{width:48px; height:48px; border-radius:14px; display:grid; place-items:center; background:var(--teal-soft); color:var(--chip-ink)}
html.dark .pw-ts .ts-gate-ic{color:var(--teal)}
.pw-ts .ts-gate-ic svg{width:24px; height:24px}
.pw-ts .ts-gate-card h1{font-family:var(--font-space-grotesk),sans-serif; font-weight:600; font-size:21px; letter-spacing:-.01em}
.pw-ts .ts-gate-card p{font-size:15px; line-height:1.5; color:var(--ink-2)}
.pw-ts .ts-gate-card a{color:inherit; font-weight:600; text-decoration:underline; text-decoration-color:var(--teal-600); text-underline-offset:3px; overflow-wrap:anywhere}
.pw-ts .ts-gate-actions{display:flex; gap:10px; flex-wrap:wrap; justify-content:center; margin-top:8px}

@media (max-width:720px){
  .pw-ts .ts-rail{width:60px}
  .pw-ts .ts-topbar{padding:0 14px; gap:10px}
  .pw-ts .ts-topbar-right{gap:8px}
  .pw-ts .ts-account-text,.pw-ts .ts-crumb{display:none}
  .pw-ts .ts-account{padding:0}
  .pw-ts .ts-scroll{padding:18px 14px 40px}
  .pw-ts .ts-hero{padding:24px; border-radius:18px; margin-bottom:18px}
  .pw-ts .ts-hero h1{font-size:24px}
  .pw-ts .ts-stats{gap:22px; flex-wrap:wrap}
  .pw-ts .ts-card-head{padding:14px 16px}
  .pw-ts .ts-card-alert{padding:12px 16px 0}
  .pw-ts .ts-card-foot{padding:12px 16px 14px}
  .pw-ts .ts-empty{margin:16px}
  .pw-ts .ts-tr{padding:14px 16px}
  .pw-ts .ts-tr.is-head{display:none}
  .pw-ts .ts-tr.is-job{grid-template-columns:1fr; gap:8px}
  .pw-ts .ts-tr.is-job .ts-actions{justify-content:flex-start}
  .pw-ts .ts-fields{grid-template-columns:1fr}
  .pw-ts .ts-tabs{flex-wrap:wrap}
  .pw-ts .ts-jump{width:100%}
  .pw-ts .ts-jump-date{flex:1}
  .pw-ts .ts-jump-date input{width:100% !important}
  .pw-ts .ts-waiting{margin:10px 10px 0}
  .pw-ts .ts-card-done{margin:12px 16px 0}
  .pw-ts .ts-workers{padding:10px; gap:10px}
  .pw-ts .ts-worker-head{padding:12px}
  .pw-ts .ts-worker-body{padding:12px 12px 8px}
  .pw-ts .ts-weeknav{width:100%; justify-content:space-between}
  .pw-ts .ts-weeknav-label{min-width:0}
  .pw-ts .ts-daygrid{gap:4px}
  .pw-ts .ts-daycell{padding:6px 1px}
  .pw-ts .ts-daycell b{font-size:10.5px}
  .pw-ts .ts-entry{grid-template-columns:62px minmax(0,1fr) auto}
  .pw-ts .ts-export-body{padding:16px}
  .pw-ts .ts-export-body .ts-field{width:calc(50% - 6px)}
  .pw-ts .ts-export-note{padding:0 16px 14px}
}
`;
