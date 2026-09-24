"use client";

import React, { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  loadPlannerJobs, savePlannerJob, deletePlannerJob,
  loadPlannerSettings, savePlannerSettings,
  ensureShareToken, regenerateShareToken, loadSharedPlanner,
} from "@/lib/planner";
import { useApp } from "@/components/AppShell";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TYPES = ["Rewire", "EICR", "Fault", "Consumer Unit", "EV Charger", "Lighting", "Heating", "Solar / Battery", "Inspection", "Snagging", "Callout", "Holiday", "Other"];
const OP_COLORS = ["#2C97A8", "#2f6fed", "#c9721a", "#7c4dd6", "#d23f6a", "#2ca05a", "#b8455f", "#4a6da7", "#c98f1a", "#0e8a8a", "#8a5cd6", "#c0392b"];

const DEFAULT_CONTRACTORS = Array.from({ length: 8 }, (_, i) => ({
  id: `op${i + 1}`,
  name: `Operative ${i + 1}`,
  color: OP_COLORS[i % OP_COLORS.length],
}));

const STATUS_TEXT = { booked: "Booked", done: "Done", cancelled: "Cancelled" };
function statusStyle(k, dark) {
  const L = { booked: { bg: "#eef1f3", fg: "#4a5560" }, done: { bg: "#e4f3ea", fg: "#1f7a44" }, cancelled: { bg: "#fbe6e6", fg: "#c0392b" } };
  const D = { booked: { bg: "#243341", fg: "#aab6c0" }, done: { bg: "#123726", fg: "#4ecb86" }, cancelled: { bg: "#3a1e22", fg: "#e79aa0" } };
  return (dark ? D : L)[k] || (dark ? D.booked : L.booked);
}

const FONTS = "'Barlow', system-ui, sans-serif";
const COND = "'Barlow Condensed', 'Barlow', sans-serif";
const SEMI = "'Barlow Semi Condensed', 'Barlow', sans-serif";

function palette(dark) {
  return dark
    ? { page: "#0E141B", surface: "#16202B", surfaceAlt: "#111A22", line: "#2A3947", line2: "#202C38", ink: "#E7EDF3", ink2: "#B6C2CE", muted: "#8595A3", header: "#12202B", headerText: "#EAF6F7", headerSub: "#8fb9bf", accent: "#3FB7C9", accent2: "#2C97A8", accentInk: "#052a30", activeTabBg: "#2C97A8", activeTabInk: "#04252b", today: "#12303a", cell: "#16202B", cellNarrow: "#131d26", rowSep: "#243341", colHead: "#12202B" }
    : { page: "#e9eef0", surface: "#ffffff", surfaceAlt: "#f2f6f7", line: "#cfd8da", line2: "#dbe3e4", ink: "#203038", ink2: "#3a4a52", muted: "#6f7d84", header: "#2C3E50", headerText: "#ffffff", headerSub: "#b7c6d2", accent: "#3FB7C9", accent2: "#2C97A8", accentInk: "#08313a", activeTabBg: "#2C97A8", activeTabInk: "#ffffff", today: "#eaf6f7", cell: "#ffffff", cellNarrow: "#f6f9fa", rowSep: "#d3dcde", colHead: "#2C3E50" };
}

const fmt = (dt) => dt.getDate() + " " + MON[dt.getMonth()];
const uid = () => "j-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
const cid = () => "c-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

function weekDates() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dow = (today.getDay() + 6) % 7;
  const monday0 = new Date(today);
  monday0.setDate(today.getDate() - dow);
  return { today, monday0 };
}

function Pill({ k, dark }) {
  const s = statusStyle(k, dark);
  return <span style={{ display: "inline-block", font: "600 10px/1 " + FONTS, letterSpacing: ".04em", textTransform: "uppercase", padding: "3px 6px", borderRadius: 4, background: s.bg, color: s.fg }}>{STATUS_TEXT[k] || k}</span>;
}

function JobCard({ j, cdef, P, dark, onClick }) {
  const c = cdef[j.c] || { color: P.muted };
  const cancelled = j.st === "cancelled";
  const imp = !!j.imp && !cancelled;
  const RED = dark ? "#e05563" : "#c0392b";
  const RED_BG = dark ? "#2a171a" : "#fdf0f0";
  const sub = [j.addr, j.cust].filter((x) => x && x !== "\u2014").join(" \u00b7 ") + (j.notes ? " \u2014 " + j.notes : "");
  return (
    <div onClick={onClick} style={{ cursor: "pointer", background: imp ? RED_BG : P.surface, border: "1px solid " + (imp ? RED : P.line), borderLeft: "4px solid " + (imp ? RED : c.color), borderRadius: 6, padding: "7px 8px 8px", marginBottom: 6, opacity: cancelled ? 0.6 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontFamily: COND, fontWeight: 700, fontSize: 14, color: imp ? RED : P.accent2 }}>{j.t}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          {imp && <span style={{ font: "700 9px/1 " + FONTS, letterSpacing: ".08em", textTransform: "uppercase", padding: "3px 5px", borderRadius: 3, background: RED, color: "#fff" }}>{"Important"}</span>}
          <Pill k={j.st} dark={dark} />
        </div>
      </div>
      <div style={{ fontFamily: SEMI, fontWeight: 700, fontSize: 13.5, color: cancelled ? P.muted : (imp ? RED : P.ink), lineHeight: 1.15, textDecoration: cancelled ? "line-through" : "none" }}>{j.site}</div>
      <div style={{ fontFamily: COND, fontWeight: 600, fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: P.muted, marginTop: 1 }}>{j.type}</div>
      {sub && <div style={{ fontSize: 11.5, color: P.ink2, marginTop: 3, lineHeight: 1.3 }}>{sub}</div>}
    </div>
  );
}

const lbl = (P) => ({ fontFamily: COND, fontWeight: 600, fontSize: 12, letterSpacing: ".05em", textTransform: "uppercase", color: P.muted });

// `sharedView`: rendered by the public share route (/planner/view), which sits
// outside every gate (login, terms, paywall). So it is ALWAYS read-only and
// only ever shows the diary behind the link's token (`shared`) -- never the
// viewer's own planner, even when they are signed in and the token is missing.
export default function WorkPlanner({ sharedView = false, shared = null }) {
  const router = useRouter();
  const { theme } = useApp();
  const dark = theme === "dark";
  const readOnly = sharedView;
  const P = palette(dark);

  const [week, setWeek] = useState(0);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [settings, setSettings] = useState({ company: "Your company", title: "Work Planner", contractors: DEFAULT_CONTRACTORS });
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [duplicating, setDuplicating] = useState(null);
  const [sharePanel, setSharePanel] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [mDay, setMDay] = useState(() => { const d = (new Date().getDay() + 6) % 7; return d > 5 ? 0 : d; });
  const [mWho, setMWho] = useState("all");
  const cardRef = useRef(null);
  const gridRef = useRef(null);

  const roster = (settings.contractors && settings.contractors.length) ? settings.contractors : DEFAULT_CONTRACTORS;
  const CDEF = {};
  roster.forEach((c) => { CDEF[c.id] = c; });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (sharedView) {
          const res = shared ? await loadSharedPlanner(shared) : null; // no token: nothing to show
          if (!alive) return;
          if (!res) { setNotFound(true); setJobs([]); }
          else {
            const s = res.settings || {};
            setJobs(res.jobs || []);
            setSettings({ company: s.company || "Work Planner", title: s.title || "Work Planner", contractors: (s.contractors && s.contractors.length) ? s.contractors : DEFAULT_CONTRACTORS });
          }
        } else {
          const [rows, s] = await Promise.all([loadPlannerJobs(), loadPlannerSettings()]);
          if (!alive) return;
          setJobs(rows || []);
          if (s) setSettings({ company: s.company || "Your company", title: s.title || "Work Planner", contractors: (s.contractors && s.contractors.length) ? s.contractors : DEFAULT_CONTRACTORS });
        }
      } catch (e) { console.error(e); if (alive) { setJobs([]); if (sharedView) setNotFound(true); } }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [sharedView, shared]);

  const reload = async () => { try { setJobs(await loadPlannerJobs()); } catch (e) { console.error(e); } };

  const { today, monday0 } = weekDates();
  const weekStart = new Date(monday0); weekStart.setDate(monday0.getDate() + week * 7);
  const weekTitle = "W/C Mon " + weekStart.getDate() + " " + MON[weekStart.getMonth()] + " " + weekStart.getFullYear();
  const days = DAY_NAMES.map((nm, i) => {
    const dt = new Date(weekStart); dt.setDate(weekStart.getDate() + i);
    return { name: nm, date: fmt(dt), narrow: i === 5, isToday: dt.getTime() === today.getTime() };
  });

  const openNew = (c, di) => readOnly ? null : setEditing({ id: uid(), w: week, c, d: di, t: "08:00", site: "", type: "Rewire", addr: "", cust: "", st: "booked", notes: "", imp: false, isNew: true });
  const openEdit = (id) => { if (readOnly) return; const j = jobs.find((x) => x.id === id); if (j) setEditing({ ...j, isNew: false }); };
  const setField = (f, v) => setEditing((e) => ({ ...e, [f]: f === "d" ? Number(v) : v }));

  const commitEdit = async () => {
    const e = editing;
    const clean = { id: e.id, c: e.c, w: e.w, d: e.d, t: e.t, site: e.site, type: e.type, addr: e.addr, cust: e.cust, st: e.st, notes: e.notes, imp: !!e.imp };
    setJobs((prev) => { const i = prev.findIndex((j) => j.id === clean.id); if (i >= 0) { const n = prev.slice(); n[i] = clean; return n; } return [...prev, clean]; });
    setEditing(null);
    try { await savePlannerJob(clean); } catch (err) { alert("Could not save the job: " + (err && err.message ? err.message : err)); reload(); }
  };

  const deleteJob = async () => {
    const id = editing.id;
    setJobs((prev) => prev.filter((j) => j.id !== id));
    setEditing(null);
    try { await deletePlannerJob(id); } catch (err) { alert("Could not delete the job: " + (err && err.message ? err.message : err)); reload(); }
  };

  // ---- Duplicate across contractors / days ----
  const openDuplicate = () => setDuplicating({ base: editing, contractors: [editing.c], days: [editing.d], weeks: [editing.w] });
  const dupToggle = (key, val) => setDuplicating((d) => {
    const has = d[key].includes(val);
    return { ...d, [key]: has ? d[key].filter((x) => x !== val) : [...d[key], val] };
  });
  const dupDaysQuick = (set) => setDuplicating((d) => ({ ...d, days: set }));
  const dupWeeksQuick = (set) => setDuplicating((d) => ({ ...d, weeks: set }));
  const runDuplicate = async () => {
    const d = duplicating; const b = d.base;
    const weeks = (d.weeks && d.weeks.length) ? d.weeks : [b.w];
    const copies = [];
    d.contractors.forEach((c) => weeks.forEach((wk) => d.days.forEach((day) => {
      if (c === b.c && day === b.d && wk === b.w) return; // skip the original cell only
      copies.push({ id: uid(), c, w: wk, d: day, t: b.t, site: b.site, type: b.type, addr: b.addr, cust: b.cust, st: b.st, notes: b.notes, imp: !!b.imp });
    })));
    setJobs((prev) => [...prev, ...copies]);
    setDuplicating(null); setEditing(null);
    try { for (const cp of copies) { await savePlannerJob(cp); } } catch (err) { alert("Some copies didn't save: " + (err && err.message ? err.message : err)); reload(); }
  };

  // ---- Settings (company / title / operatives) ----
  const openSettings = () => setSettingsDraft(JSON.parse(JSON.stringify(settings)));
  const opField = (idx, f, v) => setSettingsDraft((s) => { const cs = s.contractors.slice(); cs[idx] = { ...cs[idx], [f]: v }; return { ...s, contractors: cs }; });
  const opAdd = () => setSettingsDraft((s) => ({ ...s, contractors: [...s.contractors, { id: cid(), name: "New operative", color: OP_COLORS[s.contractors.length % OP_COLORS.length] }] }));
  const opRemove = (idx) => setSettingsDraft((s) => ({ ...s, contractors: s.contractors.filter((_, i) => i !== idx) }));
  const saveSettings = async () => {
    const clean = { company: settingsDraft.company || "", title: settingsDraft.title || "Work Planner", contractors: settingsDraft.contractors.filter((c) => c.name && c.name.trim()).map((c) => ({ id: c.id, name: c.name.trim(), color: c.color || "#9aa5a5" })) };
    // Deliberately NOT falling back to DEFAULT_CONTRACTORS here: what gets
    // saved is what this account actually chose. Writing the defaults in would
    // put the app's placeholder team into someone's own settings row. The board
    // still falls back to the neutral placeholders for DISPLAY (see `roster`),
    // so an empty roster is shown usefully without being persisted as theirs.
    setSettings(clean); setSettingsDraft(null);
    try { await savePlannerSettings(clean); } catch (err) { alert("Could not save settings: " + (err && err.message ? err.message : err)); }
  };

  const openShare = async () => {
    setSharePanel({ loading: true, url: "", copied: false });
    try {
      const token = await ensureShareToken();
      setSharePanel({ loading: false, url: window.location.origin + "/planner/view?t=" + token, copied: false });
    } catch (err) {
      setSharePanel(null);
      alert("Could not create the share link: " + (err && err.message ? err.message : err));
    }
  };
  const copyShare = async () => {
    try { await navigator.clipboard.writeText(sharePanel.url); setSharePanel((p) => ({ ...p, copied: true })); }
    catch { alert("Copy failed \u2014 select the link and copy it manually."); }
  };
  const newShareLink = async () => {
    if (!confirm("Create a new link? Anyone using the old link will lose access.")) return;
    setSharePanel((p) => ({ ...p, loading: true }));
    try {
      const token = await regenerateShareToken();
      setSharePanel({ loading: false, url: window.location.origin + "/planner/view?t=" + token, copied: false });
    } catch (err) { alert("Could not regenerate: " + (err && err.message ? err.message : err)); setSharePanel(null); }
  };

  const exportImage = async () => {
    const card = cardRef.current;
    if (!card || exporting) return;
    setExporting(true);
    const grid = gridRef.current;
    const prevMax = grid ? grid.style.maxHeight : null;
    const prevOv = grid ? grid.style.overflow : null;
    // The board is wider/taller than a phone screen and scrolls. For the image
    // we temporarily un-cap it so the WHOLE board is captured, then restore.
    const prevCardW = card.style.width;
    const prevCardOv = card.style.overflow;
    const prevDisp = card.style.display;
    const prevPos = card.style.position;
    const prevLeft = card.style.left;
    const prevTop = card.style.top;
    const restore = () => {
      if (grid) { grid.style.maxHeight = prevMax; grid.style.overflow = prevOv; }
      card.style.width = prevCardW; card.style.overflow = prevCardOv;
      card.style.display = prevDisp; card.style.position = prevPos;
      card.style.left = prevLeft; card.style.top = prevTop;
    };
    if (grid) { grid.style.maxHeight = "none"; grid.style.overflow = "visible"; }
    // On phones the full board is hidden (the list view is shown instead), so
    // reveal it off-screen at full size just long enough to photograph it.
    card.style.display = "block";
    card.style.position = "fixed";
    card.style.left = "-10000px";
    card.style.top = "0";
    card.style.width = "1300px";
    card.style.overflow = "visible";
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(card, { scale: 2, backgroundColor: P.surface, useCORS: true, windowWidth: 1400 });
      restore();
      canvas.toBlob((blob) => {
        setExporting(false);
        if (!blob) { alert("Could not create image."); return; }
        const fname = "work-planner-week.png";
        let file = null;
        try { file = new File([blob], fname, { type: "image/png" }); } catch (e) {}
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: settings.title || "Work Planner" }).catch(() => {});
        } else {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 3000);
        }
      }, "image/png");
    } catch (e) { restore(); setExporting(false); alert("Could not create image: " + (e && e.message ? e.message : e)); }
  };

  const navBtn = (disabled) => ({ fontFamily: COND, fontWeight: 600, fontSize: 14, padding: "6px 12px", borderRadius: 6, cursor: "pointer", background: "rgba(255,255,255,.14)", color: P.headerText, border: "1px solid rgba(255,255,255,.35)", opacity: disabled ? 0.35 : 1, pointerEvents: disabled ? "none" : "auto" });
  const dayFlex = (narrow) => ({ flex: narrow ? ".62 1 0" : "1 1 0" });
  const fieldStyle = { width: "100%", fontFamily: FONTS, fontSize: 14, padding: "8px 10px", border: "1px solid " + P.line, borderRadius: 7, background: P.surface, color: P.ink, boxSizing: "border-box" };

  if (loading) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: P.page, fontFamily: FONTS, color: P.muted, fontSize: 13 }}>{"Loading planner\u2026"}</div>;
  }

  if (notFound) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: P.page, fontFamily: FONTS, padding: 24 }}>
        <div style={{ maxWidth: 420, textAlign: "center", background: P.surface, border: "1px solid " + P.line, borderRadius: 14, padding: "28px 26px" }}>
          <div style={{ fontFamily: SEMI, fontWeight: 700, fontSize: 20, color: P.ink, marginBottom: 8 }}>{"This link isn\u2019t working"}</div>
          <div style={{ fontSize: 13.5, color: P.ink2, lineHeight: 1.5 }}>{"It may have been replaced with a newer one. Ask the office to send you the current link."}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="wp-page" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, fontFamily: FONTS, background: P.page }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@500;600;700&family=Barlow+Semi+Condensed:wght@600;700&display=swap');
        .wp-page{padding:32px 30px 44px}
        .wp-cname{width:186px;flex:none}
        .wp-row{min-width:940px}
        .wp-wt{min-width:280px}
        .wp-swipe{display:none}
        .wp-mobile{display:none;width:100%;max-width:640px}
        @media (max-width:900px){
          .wp-page{padding:12px 8px 30px}
          .wp-cname{width:112px}
          .wp-row{min-width:820px}
          .wp-wt{min-width:auto;font-size:17px !important}
          .wp-board{display:none}
          .wp-mobile{display:block}
        }
        .wp-cell .wp-add{opacity:0;transition:opacity .12s}
        .wp-cell:hover .wp-add{opacity:1}
        .wp-field:focus{outline:none;border-color:${P.accent2};box-shadow:0 0 0 3px ${dark ? "rgba(63,183,201,.22)" : "rgba(44,151,168,.16)"}}
        .wp-home{display:inline-flex;align-items:center;gap:7px;font-family:${COND};font-weight:700;font-size:14px;letter-spacing:.02em;padding:9px 16px;border-radius:8px;cursor:pointer;background:${P.surface};color:${P.ink};border:1px solid ${P.line};transition:background .15s ease,color .15s ease,border-color .15s ease}
        .wp-home:hover{background:#2C97A8;color:#1A2530;border-color:#2C97A8}
        .wp-home svg{display:block}
      `}</style>

      <div style={{ width: 1300, maxWidth: "100%", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {!readOnly && (
          <button className="wp-home" onClick={() => router.push("/")} title="Back to dashboard" style={{ marginRight: "auto" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            Dashboard
          </button>
        )}
        {readOnly ? (
          <span style={{ fontSize: 12.5, color: P.muted }}>{"Viewing only \u2014 this diary updates automatically when the office changes it."}</span>
        ) : (
          <>
            <span style={{ fontSize: 12.5, color: P.muted }}>{"Send the lads a view-only link, or share this week as an image."}</span>
            <button onClick={openShare} style={{ fontFamily: COND, fontWeight: 700, fontSize: 14, letterSpacing: ".02em", padding: "9px 18px", borderRadius: 8, cursor: "pointer", background: P.surface, color: P.accent2, border: "1px solid " + P.accent2 }}>
              {"Get view-only link \u25b8"}
            </button>
          </>
        )}
        <button onClick={exportImage} style={{ fontFamily: COND, fontWeight: 700, fontSize: 14, letterSpacing: ".02em", padding: "9px 18px", borderRadius: 8, cursor: "pointer", background: P.accent2, color: "#fff", border: "1px solid " + P.accent2 }}>
          {exporting ? "Preparing image\u2026" : "Share this week as image \u25b8"}
        </button>
      </div>

      <div ref={cardRef} className="wp-board" style={{ width: 1300, maxWidth: "100%", background: P.surface, border: "1px solid " + P.line, borderRadius: 14, overflow: "hidden", boxShadow: dark ? "0 16px 44px -22px rgba(0,0,0,.6)" : "0 16px 44px -22px rgba(20,40,50,.35)" }}>
        <div style={{ background: P.header, color: P.headerText, padding: "18px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 13 }}>
            <span style={{ fontFamily: COND, fontWeight: 700, fontSize: 26, letterSpacing: ".02em", textTransform: "uppercase" }}>{settings.company || "Your Company"}</span>
            <span style={{ fontSize: 13, color: P.headerSub, letterSpacing: ".12em", textTransform: "uppercase" }}>{settings.title || "Work Planner"}</span>
            {!readOnly && <button onClick={openSettings} title="Planner settings" style={{ marginLeft: 4, width: 28, height: 28, borderRadius: 7, cursor: "pointer", background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.28)", color: P.headerText, display: "grid", placeItems: "center" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3" /><path d="M19.4 13a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 0 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9 2 2 0 0 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2 2 2 0 0 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
            </button>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button onClick={() => setWeek((w) => Math.max(0, w - 1))} style={navBtn(week === 0)}>{"\u2039 Prev"}</button>
            <div className="wp-wt" style={{ fontFamily: SEMI, fontWeight: 700, fontSize: 21, textAlign: "center" }}>{weekTitle}</div>
            <button onClick={() => setWeek((w) => Math.min(3, w + 1))} style={navBtn(week === 3)}>{"Next \u203a"}</button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, padding: "11px 24px", background: P.surfaceAlt, borderBottom: "1px solid " + P.line2, alignItems: "center", flexWrap: "wrap" }}>
          {[0, 1, 2, 3].map((w) => {
            const s = new Date(monday0); s.setDate(monday0.getDate() + w * 7);
            const active = w === week;
            return (
              <button key={w} onClick={() => setWeek(w)} style={{ fontFamily: COND, fontWeight: 600, fontSize: 13, letterSpacing: ".03em", padding: "6px 13px", borderRadius: 6, cursor: "pointer", background: active ? P.activeTabBg : P.surface, color: active ? P.activeTabInk : P.ink2, border: "1px solid " + (active ? P.activeTabBg : P.line) }}>
                {"Wk " + (w + 1) + " \u00b7 " + fmt(s)}
              </button>
            );
          })}
          <span style={{ fontSize: 12.5, color: P.muted, fontStyle: "italic", marginLeft: 6 }}>{readOnly ? "Rolls automatically \u00b7 view only" : "Rolls automatically. Tap a cell to add a job \u00b7 tap a job to edit."}</span>
          <span className="wp-swipe" style={{ width: "100%", fontSize: 12, color: P.accent2, fontWeight: 600, marginTop: 2 }}>{"\u2194 Swipe the board sideways to see all days"}</span>
        </div>

        <div ref={gridRef} style={{ maxHeight: "62vh", overflow: "auto", position: "relative" }}>
        <div className="wp-row" style={{ display: "flex", alignItems: "stretch", background: P.colHead, position: "sticky", top: 0, zIndex: 3 }}>
          <div className="wp-cname" style={{ padding: "12px 16px", color: P.headerSub, position: "sticky", left: 0, zIndex: 4, backgroundColor: P.colHead, boxShadow: "3px 0 6px -3px rgba(10,25,35,.35)", fontFamily: COND, fontWeight: 600, fontSize: 13, letterSpacing: ".09em", textTransform: "uppercase", borderRight: "2px solid rgba(255,255,255,.22)" }}>Contractor</div>
          {days.map((d, i) => (
            <div key={i} style={{ ...dayFlex(d.narrow), padding: "9px 13px", color: P.headerText, borderRight: "1px solid rgba(255,255,255,.18)", background: d.isToday ? "rgba(63,183,201,.28)" : d.narrow ? "rgba(255,255,255,.08)" : "transparent" }}>
              <div style={{ fontFamily: COND, fontWeight: 700, fontSize: 17, letterSpacing: ".03em" }}>{d.name}</div>
              <div style={{ fontSize: 12, color: P.headerSub }}>{d.date}</div>
              {d.isToday && <div style={{ fontFamily: FONTS, fontWeight: 700, fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", background: P.accent, color: P.accentInk, borderRadius: 3, padding: "1px 6px", marginTop: 3, display: "inline-block" }}>Today</div>}
            </div>
          ))}
        </div>

        {roster.map((c) => (
          <div key={c.id} className="wp-row" style={{ display: "flex", alignItems: "stretch", borderTop: "1px solid " + P.rowSep }}>
            <div className="wp-cname" style={{ padding: "11px 14px", backgroundColor: dark ? P.surfaceAlt : P.surface, backgroundImage: dark ? "none" : "linear-gradient(" + c.color + "14, " + c.color + "14)", borderRight: "2px solid " + P.line, boxShadow: "3px 0 6px -3px rgba(10,25,35,.25)", display: "flex", alignItems: "center", gap: 9, position: "sticky", left: 0, zIndex: 2 }}>
              <span style={{ width: 11, height: 11, borderRadius: 3, background: c.color, flex: "none" }} />
              <span style={{ fontFamily: SEMI, fontWeight: 700, fontSize: 15, lineHeight: 1.1, color: P.ink }}>{c.name}</span>
            </div>
            {days.map((d, di) => {
              const list = jobs.filter((j) => j.w === week && j.c === c.id && j.d === di);
              return (
                <div key={di} className="wp-cell" onClick={(ev) => { if (ev.target.closest("[data-job]")) return; openNew(c.id, di); }}
                  style={{ ...dayFlex(d.narrow), padding: "7px 7px 2px", borderRight: "2px solid " + P.rowSep, minHeight: 82, cursor: readOnly ? "default" : "pointer", background: d.isToday ? P.today : d.narrow ? P.cellNarrow : P.cell }}>
                  {list.map((j) => (<div data-job key={j.id}><JobCard j={j} cdef={CDEF} P={P} dark={dark} onClick={(ev) => { ev.stopPropagation(); openEdit(j.id); }} /></div>))}
                  {!readOnly && <div className="wp-add" style={{ textAlign: "center", color: P.muted, fontFamily: COND, fontWeight: 600, fontSize: 13, padding: "2px 0 4px" }}>+ add job</div>}
                </div>
              );
            })}
          </div>
        ))}

        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "16px 26px", padding: "15px 24px", background: P.surfaceAlt, borderTop: "1px solid " + P.line2, alignItems: "center" }}>
          <span style={{ fontFamily: COND, fontWeight: 600, fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", color: P.muted }}>Key</span>
          {roster.slice(0, 8).map((c) => (
            <span key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 500, color: P.ink }}>
              <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: c.color }} />{c.name}
            </span>
          ))}
          <span style={{ width: 1, height: 16, background: P.line }} />
          {["booked", "done", "cancelled"].map((k) => <Pill key={k} k={k} dark={dark} />)}
          <span style={{ font: "700 9px/1 " + FONTS, letterSpacing: ".08em", textTransform: "uppercase", padding: "3px 5px", borderRadius: 3, background: dark ? "#e05563" : "#c0392b", color: "#fff" }}>{"Important"}</span>
        </div>
      </div>

      {/* Mobile view — phones get a readable, tappable list instead of the grid */}
      <div className="wp-mobile">
        <div style={{ background: P.header, color: P.headerText, borderRadius: "14px 14px 0 0", padding: "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontFamily: COND, fontWeight: 700, fontSize: 20, letterSpacing: ".02em", textTransform: "uppercase" }}>{settings.company || "Your Company"}</span>
            <span style={{ fontSize: 11.5, color: P.headerSub, letterSpacing: ".12em", textTransform: "uppercase" }}>{settings.title || "Work Planner"}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 10 }}>
            <button onClick={() => setWeek((w) => Math.max(0, w - 1))} style={navBtn(week === 0)}>{"\u2039"}</button>
            <div style={{ fontFamily: SEMI, fontWeight: 700, fontSize: 16 }}>{weekTitle}</div>
            <button onClick={() => setWeek((w) => Math.min(3, w + 1))} style={navBtn(week === 3)}>{"\u203a"}</button>
          </div>
        </div>

        <div style={{ background: P.surfaceAlt, borderLeft: "1px solid " + P.line, borderRight: "1px solid " + P.line, padding: "10px 12px", display: "flex", gap: 7, overflowX: "auto" }}>
          {days.map((d, i) => {
            const on = i === mDay;
            return (
              <button key={i} onClick={() => setMDay(i)} style={{ flex: "none", fontFamily: COND, fontWeight: 700, fontSize: 13, padding: "7px 12px", borderRadius: 8, cursor: "pointer", lineHeight: 1.25, textAlign: "center", background: on ? P.activeTabBg : P.surface, color: on ? P.activeTabInk : P.ink2, border: "1px solid " + (on ? P.activeTabBg : P.line) }}>
                <div>{d.name.slice(0, 3)}</div>
                <div style={{ fontSize: 10.5, opacity: .85 }}>{d.date}</div>
                {d.isToday && <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", marginTop: 1 }}>Today</div>}
              </button>
            );
          })}
        </div>

        <div style={{ background: P.surface, borderLeft: "1px solid " + P.line, borderRight: "1px solid " + P.line, borderBottom: "1px solid " + P.line, borderRadius: "0 0 14px 14px", padding: "12px" }}>
          <select value={mWho} onChange={(e) => setMWho(e.target.value)} className="wp-field" style={{ ...fieldStyle, marginBottom: 12 }}>
            <option value="all">All operatives</option>
            {roster.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          {roster.filter((c) => mWho === "all" || c.id === mWho).map((c) => {
            const list = jobs.filter((j) => j.w === week && j.c === c.id && j.d === mDay);
            if (mWho === "all" && !list.length) return null;
            return (
              <div key={c.id} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: c.color, flex: "none" }} />
                  <span style={{ fontFamily: SEMI, fontWeight: 700, fontSize: 15, color: P.ink }}>{c.name}</span>
                  {!readOnly && <button onClick={() => openNew(c.id, mDay)} style={{ marginLeft: "auto", fontFamily: COND, fontWeight: 600, fontSize: 12, padding: "4px 9px", borderRadius: 6, cursor: "pointer", background: P.surfaceAlt, color: P.accent2, border: "1px solid " + P.line }}>+ add</button>}
                </div>
                {list.length ? list.map((j) => (
                  <JobCard key={j.id} j={j} cdef={CDEF} P={P} dark={dark} onClick={() => openEdit(j.id)} />
                )) : (
                  <div style={{ fontSize: 12.5, color: P.muted, fontStyle: "italic", padding: "6px 2px" }}>Nothing booked</div>
                )}
              </div>
            );
          })}

          {mWho === "all" && !jobs.some((j) => j.w === week && j.d === mDay) && (
            <div style={{ textAlign: "center", color: P.muted, fontSize: 13, padding: "18px 0" }}>Nothing booked this day.</div>
          )}
        </div>
      </div>

      {/* Job editor */}
      {editing && (
        <div onClick={(ev) => { if (ev.target === ev.currentTarget) setEditing(null); }} style={{ position: "fixed", inset: 0, background: "rgba(10,20,25,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 50 }}>
          <div style={{ width: 440, maxWidth: "100%", maxHeight: "92vh", overflow: "auto", background: P.surface, borderRadius: 14, boxShadow: "0 24px 60px -20px rgba(0,0,0,.55)" }}>
            <div style={{ background: P.header, color: P.headerText, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontFamily: SEMI, fontWeight: 700, fontSize: 19 }}>{editing.isNew ? "New job" : "Edit job"}</span>
              <span style={{ fontFamily: COND, fontWeight: 600, fontSize: 13, color: P.headerSub }}>{(CDEF[editing.c] ? CDEF[editing.c].name : "") + " \u00b7 " + DAY_NAMES[editing.d]}</span>
            </div>
            <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 13 }}>
              <div style={{ display: "flex", gap: 12 }}>
                <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}><span style={lbl(P)}>Contractor</span><select className="wp-field" style={fieldStyle} value={editing.c} onChange={(e) => setField("c", e.target.value)}>{roster.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}><span style={lbl(P)}>Day</span><select className="wp-field" style={fieldStyle} value={editing.d} onChange={(e) => setField("d", e.target.value)}>{DAY_NAMES.map((n, i) => <option key={i} value={i}>{n}</option>)}</select></label>
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <label style={{ width: 120, display: "flex", flexDirection: "column", gap: 5 }}><span style={lbl(P)}>Start time</span><input className="wp-field" style={fieldStyle} value={editing.t} onChange={(e) => setField("t", e.target.value)} placeholder="08:00" /></label>
                <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}><span style={lbl(P)}>Status</span><select className="wp-field" style={fieldStyle} value={editing.st} onChange={(e) => setField("st", e.target.value)}><option value="booked">Booked</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select></label>
              </div>
              <button onClick={() => setField("imp", !editing.imp)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 12px", borderRadius: 8, cursor: "pointer", textAlign: "left", background: editing.imp ? (dark ? "#2a171a" : "#fdf0f0") : P.surface, border: "1px solid " + (editing.imp ? (dark ? "#e05563" : "#c0392b") : P.line) }}>
                <span style={{ width: 18, height: 18, flex: "none", borderRadius: 4, display: "grid", placeItems: "center", background: editing.imp ? (dark ? "#e05563" : "#c0392b") : "transparent", border: "1.5px solid " + (editing.imp ? (dark ? "#e05563" : "#c0392b") : P.muted), color: "#fff", fontSize: 12, fontWeight: 700 }}>{editing.imp ? "\u2713" : ""}</span>
                <span style={{ fontFamily: FONTS, fontWeight: 600, fontSize: 13.5, color: editing.imp ? (dark ? "#e05563" : "#c0392b") : P.ink2 }}>{"Mark as important (shows red on the board)"}</span>
              </button>
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}><span style={lbl(P)}>Job / site name</span><input className="wp-field" style={fieldStyle} value={editing.site} onChange={(e) => setField("site", e.target.value)} placeholder="e.g. Elm Court rewire" /></label>
              <div style={{ display: "flex", gap: 12 }}>
                <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}><span style={lbl(P)}>Job type</span><select className="wp-field" style={fieldStyle} value={editing.type} onChange={(e) => setField("type", e.target.value)}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
                <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}><span style={lbl(P)}>Customer</span><input className="wp-field" style={fieldStyle} value={editing.cust} onChange={(e) => setField("cust", e.target.value)} placeholder="e.g. Mrs Patel" /></label>
              </div>
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}><span style={lbl(P)}>Address / postcode</span><input className="wp-field" style={fieldStyle} value={editing.addr} onChange={(e) => setField("addr", e.target.value)} placeholder="e.g. 14 Elm Rd, L23" /></label>
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}><span style={lbl(P)}>Notes</span><input className="wp-field" style={fieldStyle} value={editing.notes} onChange={(e) => setField("notes", e.target.value)} placeholder={"e.g. Day 1 \u2014 1st fix"} /></label>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                {!editing.isNew && <button onClick={deleteJob} style={{ fontFamily: FONTS, fontWeight: 600, fontSize: 14, padding: "9px 14px", borderRadius: 8, cursor: "pointer", background: P.surface, color: "#c0392b", border: "1px solid " + (dark ? "#5a2a2e" : "#e6b8b8") }}>Delete</button>}
                <button onClick={openDuplicate} style={{ fontFamily: FONTS, fontWeight: 600, fontSize: 14, padding: "9px 14px", borderRadius: 8, cursor: "pointer", background: P.surface, color: P.accent2, border: "1px solid " + P.accent2 }}>{"Duplicate\u2026"}</button>
                <div style={{ flex: 1 }} />
                <button onClick={() => setEditing(null)} style={{ fontFamily: FONTS, fontWeight: 600, fontSize: 14, padding: "9px 16px", borderRadius: 8, cursor: "pointer", background: dark ? P.surfaceAlt : "#eef1f1", color: P.ink2, border: "1px solid " + P.line }}>Cancel</button>
                <button onClick={commitEdit} style={{ fontFamily: FONTS, fontWeight: 700, fontSize: 14, padding: "9px 18px", borderRadius: 8, cursor: "pointer", background: P.accent2, color: "#fff", border: "1px solid " + P.accent2 }}>Save job</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate panel */}
      {duplicating && (
        <div onClick={(ev) => { if (ev.target === ev.currentTarget) setDuplicating(null); }} style={{ position: "fixed", inset: 0, background: "rgba(10,20,25,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 60 }}>
          <div style={{ width: 460, maxWidth: "100%", maxHeight: "92vh", overflow: "auto", background: P.surface, borderRadius: 14, boxShadow: "0 24px 60px -20px rgba(0,0,0,.55)" }}>
            <div style={{ background: P.header, color: P.headerText, padding: "16px 20px" }}>
              <span style={{ fontFamily: SEMI, fontWeight: 700, fontSize: 19 }}>Duplicate job</span>
              <div style={{ fontSize: 12.5, color: P.headerSub, marginTop: 2 }}>{(duplicating.base.site || "This job") + " \u2014 copy it across people and days"}</div>
            </div>
            <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <div style={{ ...lbl(P), marginBottom: 8 }}>Contractors</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {roster.map((c) => { const on = duplicating.contractors.includes(c.id); return (
                    <button key={c.id} onClick={() => dupToggle("contractors", c.id)} style={{ fontFamily: FONTS, fontWeight: 600, fontSize: 13, padding: "6px 11px", borderRadius: 999, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, background: on ? P.accent2 : P.surface, color: on ? "#fff" : P.ink2, border: "1px solid " + (on ? P.accent2 : P.line) }}>
                      <span style={{ width: 9, height: 9, borderRadius: 2, background: c.color }} />{c.name}
                    </button>
                  ); })}
                </div>
              </div>
              <div>
                <div style={{ ...lbl(P), marginBottom: 8 }}>Days</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                  {DAY_NAMES.map((n, i) => { const on = duplicating.days.includes(i); return (
                    <button key={i} onClick={() => dupToggle("days", i)} style={{ fontFamily: FONTS, fontWeight: 600, fontSize: 13, padding: "6px 11px", borderRadius: 999, cursor: "pointer", background: on ? P.accent2 : P.surface, color: on ? "#fff" : P.ink2, border: "1px solid " + (on ? P.accent2 : P.line) }}>{n.slice(0, 3)}</button>
                  ); })}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => dupDaysQuick([0, 1, 2, 3, 4])} style={{ fontFamily: COND, fontWeight: 600, fontSize: 12, padding: "5px 10px", borderRadius: 6, cursor: "pointer", background: P.surfaceAlt, color: P.ink2, border: "1px solid " + P.line }}>{"Mon\u2013Fri"}</button>
                  <button onClick={() => dupDaysQuick([0, 1, 2, 3, 4, 5])} style={{ fontFamily: COND, fontWeight: 600, fontSize: 12, padding: "5px 10px", borderRadius: 6, cursor: "pointer", background: P.surfaceAlt, color: P.ink2, border: "1px solid " + P.line }}>Whole week</button>
                </div>
              </div>
              <div>
                <div style={{ ...lbl(P), marginBottom: 8 }}>Weeks</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                  {[0, 1, 2, 3].map((wk) => {
                    const on = (duplicating.weeks || []).includes(wk);
                    const ws = new Date(monday0); ws.setDate(monday0.getDate() + wk * 7);
                    return (
                      <button key={wk} onClick={() => dupToggle("weeks", wk)} style={{ fontFamily: FONTS, fontWeight: 600, fontSize: 13, padding: "6px 11px", borderRadius: 999, cursor: "pointer", background: on ? P.accent2 : P.surface, color: on ? "#fff" : P.ink2, border: "1px solid " + (on ? P.accent2 : P.line) }}>
                        {"Wk " + (wk + 1) + " \u00b7 " + fmt(ws)}
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => dupWeeksQuick([0, 1, 2, 3])} style={{ fontFamily: COND, fontWeight: 600, fontSize: 12, padding: "5px 10px", borderRadius: 6, cursor: "pointer", background: P.surfaceAlt, color: P.ink2, border: "1px solid " + P.line }}>All 4 weeks</button>
                  <button onClick={() => dupWeeksQuick([duplicating.base.w])} style={{ fontFamily: COND, fontWeight: 600, fontSize: 12, padding: "5px 10px", borderRadius: 6, cursor: "pointer", background: P.surfaceAlt, color: P.ink2, border: "1px solid " + P.line }}>This week only</button>
                </div>
              </div>
              <div style={{ fontSize: 12.5, color: P.muted }}>Creates a separate, independent copy for every selected person \u00d7 week \u00d7 day (the original stays as-is).</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 2 }}>
                <div style={{ flex: 1 }} />
                <button onClick={() => setDuplicating(null)} style={{ fontFamily: FONTS, fontWeight: 600, fontSize: 14, padding: "9px 16px", borderRadius: 8, cursor: "pointer", background: dark ? P.surfaceAlt : "#eef1f1", color: P.ink2, border: "1px solid " + P.line }}>Cancel</button>
                <button onClick={runDuplicate} style={{ fontFamily: FONTS, fontWeight: 700, fontSize: 14, padding: "9px 18px", borderRadius: 8, cursor: "pointer", background: P.accent2, color: "#fff", border: "1px solid " + P.accent2 }}>Create copies</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Share: view-only link */}
      {sharePanel && (
        <div onClick={(ev) => { if (ev.target === ev.currentTarget) setSharePanel(null); }} style={{ position: "fixed", inset: 0, background: "rgba(10,20,25,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 60 }}>
          <div style={{ width: 480, maxWidth: "100%", background: P.surface, borderRadius: 14, boxShadow: "0 24px 60px -20px rgba(0,0,0,.55)" }}>
            <div style={{ background: P.header, color: P.headerText, padding: "16px 20px" }}>
              <span style={{ fontFamily: SEMI, fontWeight: 700, fontSize: 19 }}>{"View-only link"}</span>
              <div style={{ fontSize: 12.5, color: P.headerSub, marginTop: 2 }}>{"Send this to your operatives \u2014 they can see the diary, not change it."}</div>
            </div>
            <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
              {sharePanel.loading ? (
                <div style={{ fontSize: 13.5, color: P.muted }}>{"Preparing link\u2026"}</div>
              ) : (
                <>
                  <input readOnly value={sharePanel.url} onFocus={(e) => e.target.select()} className="wp-field" style={{ ...fieldStyle, fontFamily: "monospace", fontSize: 12.5 }} />
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button onClick={copyShare} style={{ fontFamily: FONTS, fontWeight: 700, fontSize: 14, padding: "9px 18px", borderRadius: 8, cursor: "pointer", background: P.accent2, color: "#fff", border: "1px solid " + P.accent2 }}>{sharePanel.copied ? "Copied \u2713" : "Copy link"}</button>
                    <a href={"https://wa.me/?text=" + encodeURIComponent("This week's work planner: " + sharePanel.url)} target="_blank" rel="noreferrer" style={{ fontFamily: FONTS, fontWeight: 600, fontSize: 14, padding: "9px 16px", borderRadius: 8, textDecoration: "none", background: P.surfaceAlt, color: P.ink2, border: "1px solid " + P.line }}>{"Send on WhatsApp"}</a>
                    <div style={{ flex: 1 }} />
                    <button onClick={newShareLink} style={{ fontFamily: FONTS, fontWeight: 600, fontSize: 13.5, padding: "9px 14px", borderRadius: 8, cursor: "pointer", background: P.surface, color: "#c0392b", border: "1px solid " + (dark ? "#5a2a2e" : "#e6b8b8") }}>{"New link"}</button>
                  </div>
                  <div style={{ fontSize: 12, color: P.muted, lineHeight: 1.5 }}>{"Anyone with this link can view the diary \u2014 treat it like a key. \u201cNew link\u201d replaces it and stops the old one working."}</div>
                </>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button onClick={() => setSharePanel(null)} style={{ fontFamily: FONTS, fontWeight: 600, fontSize: 14, padding: "9px 16px", borderRadius: 8, cursor: "pointer", background: dark ? P.surfaceAlt : "#eef1f1", color: P.ink2, border: "1px solid " + P.line }}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings: company / title / operatives */}
      {settingsDraft && (
        <div onClick={(ev) => { if (ev.target === ev.currentTarget) setSettingsDraft(null); }} style={{ position: "fixed", inset: 0, background: "rgba(10,20,25,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 60 }}>
          <div style={{ width: 480, maxWidth: "100%", maxHeight: "92vh", overflow: "auto", background: P.surface, borderRadius: 14, boxShadow: "0 24px 60px -20px rgba(0,0,0,.55)" }}>
            <div style={{ background: P.header, color: P.headerText, padding: "16px 20px" }}>
              <span style={{ fontFamily: SEMI, fontWeight: 700, fontSize: 19 }}>Planner settings</span>
            </div>
            <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", gap: 12 }}>
                <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}><span style={lbl(P)}>Company name</span><input className="wp-field" style={fieldStyle} value={settingsDraft.company} onChange={(e) => setSettingsDraft((s) => ({ ...s, company: e.target.value }))} placeholder="e.g. Your Company Ltd" /></label>
                <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}><span style={lbl(P)}>Planner title</span><input className="wp-field" style={fieldStyle} value={settingsDraft.title} onChange={(e) => setSettingsDraft((s) => ({ ...s, title: e.target.value }))} placeholder="Work Planner" /></label>
              </div>
              <div>
                <div style={{ ...lbl(P), marginBottom: 8 }}>Operatives</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {settingsDraft.contractors.map((c, i) => (
                    <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input type="color" value={c.color} onChange={(e) => opField(i, "color", e.target.value)} style={{ width: 34, height: 34, padding: 0, border: "1px solid " + P.line, borderRadius: 7, background: P.surface, cursor: "pointer", flex: "none" }} />
                      <input className="wp-field" style={fieldStyle} value={c.name} onChange={(e) => opField(i, "name", e.target.value)} placeholder="Name" />
                      <button onClick={() => opRemove(i)} title="Remove" style={{ width: 34, height: 34, flex: "none", borderRadius: 7, cursor: "pointer", background: P.surface, color: "#c0392b", border: "1px solid " + (dark ? "#5a2a2e" : "#e6b8b8"), fontSize: 18, lineHeight: 1 }}>{"\u00d7"}</button>
                    </div>
                  ))}
                </div>
                <button onClick={opAdd} style={{ marginTop: 10, fontFamily: FONTS, fontWeight: 600, fontSize: 13.5, padding: "8px 14px", borderRadius: 8, cursor: "pointer", background: P.surfaceAlt, color: P.accent2, border: "1px dashed " + P.accent2 }}>+ Add operative</button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 2 }}>
                <div style={{ flex: 1 }} />
                <button onClick={() => setSettingsDraft(null)} style={{ fontFamily: FONTS, fontWeight: 600, fontSize: 14, padding: "9px 16px", borderRadius: 8, cursor: "pointer", background: dark ? P.surfaceAlt : "#eef1f1", color: P.ink2, border: "1px solid " + P.line }}>Cancel</button>
                <button onClick={saveSettings} style={{ fontFamily: FONTS, fontWeight: 700, fontSize: 14, padding: "9px 18px", borderRadius: 8, cursor: "pointer", background: P.accent2, color: "#fff", border: "1px solid " + P.accent2 }}>Save settings</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
