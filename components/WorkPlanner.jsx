"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  loadPlannerJobs, savePlannerJobs, deletePlannerJobs,
  loadPlannerSettings, savePlannerSettings,
  ensureShareToken, regenerateShareToken, loadSharedPlanner,
  plannerSchemaV2, boardPos,
} from "@/lib/planner";
import { useApp } from "@/components/AppShell";
import { useTryPrompt, TryPrompt, LOCKED } from "@/components/TryMode";
import { FONTS, COND, SEMI, palette, Pill, JobCard, lbl } from "@/components/planner/ui";
import { addDays, diffDays, dayLabel, cellDate, windowDays, jobCells, sortDay } from "@/components/planner/dates";
import { useJobDrag } from "@/components/planner/useJobDrag";
import { JobMenu, MoveDialog, ConfirmDialog, NoticeBar, ViewOnlyPrompt, btn } from "@/components/planner/PlannerOverlays";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TYPES = ["Rewire", "EICR", "Fault", "Consumer Unit", "EV Charger", "Lighting", "Heating", "Solar / Battery", "Inspection", "Snagging", "Callout", "Holiday", "Other"];
const OP_COLORS = ["#2C97A8", "#2f6fed", "#c9721a", "#7c4dd6", "#d23f6a", "#2ca05a", "#b8455f", "#4a6da7", "#c98f1a", "#0e8a8a", "#8a5cd6", "#c0392b"];

const DEFAULT_CONTRACTORS = Array.from({ length: 8 }, (_, i) => ({
  id: `op${i + 1}`,
  name: `Operative ${i + 1}`,
  color: OP_COLORS[i % OP_COLORS.length],
}));

const fmt = (dt) => dt.getDate() + " " + MON[dt.getMonth()];
const uid = () => "j-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
const cid = () => "c-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const UNDO_LIMIT = 30;

function weekDates() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dow = (today.getDay() + 6) % 7;
  const monday0 = new Date(today);
  monday0.setDate(today.getDate() - dow);
  return { today, monday0 };
}

// Board position (w, d) from the job's date; the date is the truth.
const withPos = (j) => ({ ...j, ...boardPos(j.date) });

// Does a job show in board cell (w, d)? Multi-day jobs show on every day they run.
function covers(j, w, d) {
  if (!j.date) return false;
  if (j.end && j.end > j.date) return jobCells(j).some((p) => p.w === w && p.d === d);
  return j.w === w && j.d === d;
}

// Same job, same values (ignoring the derived w / d)?
const sameJob = (a, b) => {
  if (!a || !b) return a === b;
  const k = ["id", "c", "date", "end", "order", "t", "site", "type", "addr", "cust", "st", "notes", "imp"];
  return k.every((x) => (a[x] ?? null) === (b[x] ?? null));
};

// The message for a change that couldn't be saved.
function failText(err, undoing) {
  const why = err && err.message ? err.message : String(err || "");
  return (undoing ? "Couldn’t undo that, so the job is as it was. " : "Couldn’t save that change, so the job has been put back. ") + why;
}

// `sharedView`: rendered by the public share route (/planner/view), which sits
// outside every gate (login, terms, paywall). So it is ALWAYS read-only and
// only ever shows the diary behind the link's token (`shared`) -- never the
// viewer's own planner, even when they are signed in and the token is missing.
export default function WorkPlanner({ sharedView = false, shared = null }) {
  const router = useRouter();
  const { theme, access = {}, manageBilling } = useApp();
  // Try mode: no share link, no image share. Lapsed: no new share link (the
  // database refuses it too), but the image is theirs to export.
  const tryPrompt = useTryPrompt();
  const dark = theme === "dark";
  const readOnly = sharedView;
  // Lapsed (subscription ended or payment overdue): the planner is view-only,
  // as the database already insists. Say so up front instead of failing saves.
  const lapsed = !sharedView && Boolean(access.readOnly);
  const canEdit = !sharedView && !lapsed;
  const P = palette(dark);

  const [week, setWeek] = useState(0);
  const [jobs, setJobs] = useState([]);
  const [v2, setV2] = useState(false);
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
  const [menu, setMenu] = useState(null);           // { job, x, y }
  const [moving, setMoving] = useState(null);       // job for the move-to-date calendar
  const [confirmDel, setConfirmDel] = useState(null); // job awaiting a confirmed delete
  const [notice, setNotice] = useState(null);       // { kind, text, n }
  const [viewOnly, setViewOnly] = useState(false);  // the lapsed prompt
  const cardRef = useRef(null);
  const gridRef = useRef(null);
  const undoStack = useRef([]);                     // [{ label, changes }]
  const saveChain = useRef(Promise.resolve());
  const lastDrop = useRef(0);
  const noticeSeq = useRef(0);

  const roster = (settings.contractors && settings.contractors.length) ? settings.contractors : DEFAULT_CONTRACTORS;
  const CDEF = {};
  roster.forEach((c) => { CDEF[c.id] = c; });
  const nameOf = (c) => (CDEF[c] ? CDEF[c].name : "");

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
            setV2((res.jobs || []).some((j) => j.order != null));
            setSettings({ company: s.company || "Work Planner", title: s.title || "Work Planner", contractors: (s.contractors && s.contractors.length) ? s.contractors : DEFAULT_CONTRACTORS });
          }
        } else {
          const [rows, s, hasV2] = await Promise.all([loadPlannerJobs(), loadPlannerSettings(), plannerSchemaV2()]);
          if (!alive) return;
          setJobs(rows || []);
          setV2(Boolean(hasV2));
          if (s) setSettings({ company: s.company || "Your company", title: s.title || "Work Planner", contractors: (s.contractors && s.contractors.length) ? s.contractors : DEFAULT_CONTRACTORS });
        }
      } catch (e) { console.error(e); if (alive) { setJobs([]); if (sharedView) setNotFound(true); } }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [sharedView, shared]);

  // ---- Changes: shown at once, saved in order, put back if a save fails ----
  // A change is a list of { before, after } (null before = a new job, null
  // after = a deleted one). Every change goes through commit(), so every one
  // can be undone and none can be lost silently.
  const say = useCallback((kind, text) => { noticeSeq.current += 1; setNotice({ kind, text, n: noticeSeq.current }); }, []);

  const apply = (list, changes, side) => {
    const next = list.slice();
    for (const ch of changes) {
      const id = (ch.before || ch.after).id;
      const want = side === "after" ? ch.after : ch.before;
      const i = next.findIndex((j) => j.id === id);
      if (want) { const v = withPos(want); if (i >= 0) next[i] = v; else next.push(v); }
      else if (i >= 0) next.splice(i, 1);
    }
    return next;
  };

  // Put back only what still shows this change: a later change to the same
  // job (made while this one was saving) is left alone.
  const rollback = (list, changes) => {
    let next = list.slice();
    for (const ch of changes) {
      const id = (ch.before || ch.after).id;
      const i = next.findIndex((j) => j.id === id);
      const now = i >= 0 ? next[i] : null;
      if (!sameJob(now, ch.after)) continue;
      if (ch.before) { const v = withPos(ch.before); if (i >= 0) next[i] = v; else next.push(v); }
      else if (i >= 0) next = next.filter((j) => j.id !== id);
    }
    return next;
  };

  const persist = async (changes) => {
    const ups = changes.map((c) => c.after).filter(Boolean);
    const dels = changes.filter((c) => !c.after && c.before).map((c) => c.before.id);
    if (ups.length) await savePlannerJobs(ups);
    if (dels.length) await deletePlannerJobs(dels);
  };

  const commit = useCallback((label, changes, { undoing = false } = {}) => {
    if (!changes || !changes.length) return;
    setJobs((prev) => apply(prev, changes, "after"));
    const entry = { label, changes };
    if (!undoing) {
      undoStack.current = [...undoStack.current, entry].slice(-UNDO_LIMIT);
      say("undo", label);
    } else {
      say("info", "Undone: " + label.charAt(0).toLowerCase() + label.slice(1));
    }
    const run = async () => {
      try { await persist(changes); }
      catch (err) {
        console.error(err);
        setJobs((prev) => rollback(prev, changes));
        undoStack.current = undoStack.current.filter((e) => e !== entry);
        say("error", failText(err, undoing));
      }
    };
    saveChain.current = saveChain.current.then(run, run);
  }, [say]); // eslint-disable-line react-hooks/exhaustive-deps

  const undo = useCallback(() => {
    const last = undoStack.current[undoStack.current.length - 1];
    if (!last) { say("info", "Nothing to undo"); return; }
    undoStack.current = undoStack.current.slice(0, -1);
    commit(last.label, last.changes.slice().reverse().map((c) => ({ before: c.after, after: c.before })), { undoing: true });
  }, [commit, say]);

  // The bar fades after a while; an error stays a little longer.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice((n) => (n && n.n === notice.n ? null : n)), notice.kind === "error" ? 15000 : 8000);
    return () => clearTimeout(t);
  }, [notice]);

  const blocked = useCallback(() => { if (lapsed) setViewOnly(true); }, [lapsed]);

  const { today, monday0 } = weekDates();
  const weekStart = new Date(monday0); weekStart.setDate(monday0.getDate() + week * 7);
  const weekTitle = "W/C Mon " + weekStart.getDate() + " " + MON[weekStart.getMonth()] + " " + weekStart.getFullYear();
  const days = DAY_NAMES.map((nm, i) => {
    const dt = new Date(weekStart); dt.setDate(weekStart.getDate() + i);
    return { name: nm, date: fmt(dt), iso: cellDate(week, i), narrow: i === 5, isToday: dt.getTime() === today.getTime() };
  });

  // A person's jobs in board cell (w, d), in the order they show.
  const cellJobs = (c, w, d, list = jobs) => sortDay(list.filter((j) => j.c === c && covers(j, w, d)));

  const openNew = (c, date) => {
    if (sharedView) return;
    if (lapsed) { blocked(); return; }
    setEditing({ id: uid(), c, date, end: null, order: null, t: "08:00", site: "", type: "Rewire", addr: "", cust: "", st: "booked", notes: "", imp: false, isNew: true });
  };
  const openEdit = (id) => {
    if (sharedView) return;
    if (lapsed) { blocked(); return; }
    const j = jobs.find((x) => x.id === id);
    if (j) setEditing({ ...j, isNew: false });
  };
  const setField = (f, v) => setEditing((e) => ({ ...e, [f]: v }));

  const cleanJob = (e) => ({ id: e.id, c: e.c, date: e.date, end: e.end || null, order: e.order ?? null, t: e.t, site: e.site, type: e.type, addr: e.addr, cust: e.cust, st: e.st, notes: e.notes, imp: !!e.imp });

  const commitEdit = () => {
    const e = editing;
    const before = e.isNew ? null : jobs.find((j) => j.id === e.id) || null;
    const after = cleanJob(e);
    // A job moved to another day or person takes its place by start time there.
    if (before && (before.date !== after.date || before.c !== after.c)) {
      after.order = null;
      if (before.end && before.date) after.end = addDays(before.end, diffDays(before.date, after.date));
    }
    setEditing(null);
    if (before && sameJob(before, after)) return;
    commit((e.isNew ? "Added " : "Saved ") + (after.site || "the job"), [{ before, after }]);
  };

  // ---- Quick actions (menu, drag) ----
  // Move a job to person c on date (index: its place in that day, from a drag).
  const moveJob = (job, { c, date, index = null }, label = null) => {
    const cur = jobs.find((j) => j.id === job.id) || job;
    const shift = cur.date ? diffDays(cur.date, date) : 0;
    const after = { ...cur, c, date, end: cur.end && cur.date ? addDays(cur.end, shift) : null };
    const samePlace = cur.c === c && cur.date === date;
    const changes = [];
    const pos = boardPos(date);
    if (v2 && index != null) {
      const now = cellJobs(c, pos.w, pos.d);
      const seq = now.filter((j) => j.id !== cur.id);
      seq.splice(Math.min(index, seq.length), 0, after);
      if (samePlace && seq.map((j) => j.id).join() === now.map((j) => j.id).join()) return; // dropped where it was
      seq.forEach((j, i) => {
        const o = i + 1;
        if (j === after) after.order = o;
        else if (j.order !== o) changes.push({ before: j, after: { ...cleanJob(j), order: o } });
      });
    } else {
      if (samePlace) return;
      after.order = null; // it joins the day by start time
    }
    changes.unshift({ before: cur, after: cleanJob(after) });
    const where = samePlace ? "Moved within " + dayLabel(date) : "Moved to " + dayLabel(date) + (cur.c !== c ? " · " + nameOf(c) : "");
    commit(label || where, changes);
  };

  const toggleDone = (job) => {
    const done = job.st === "done";
    commit(done ? "Marked not complete" : "Marked complete", [{ before: job, after: { ...cleanJob(job), st: done ? "booked" : "done" } }]);
  };

  const deleteJob = (job) => {
    setConfirmDel(null);
    setEditing(null);
    commit("Deleted " + (job.site || "the job"), [{ before: jobs.find((j) => j.id === job.id) || job, after: null }]);
  };

  const openMenu = (job, x, y) => {
    if (sharedView) return;
    if (lapsed) { blocked(); return; }
    setMenu({ job, x, y });
  };

  const onMenuPick = (action, arg) => {
    const job = jobs.find((j) => j.id === menu.job.id) || menu.job;
    setMenu(null);
    if (action === "duplicate") openDuplicate(job);
    else if (action === "move") setMoving(job);
    else if (action === "assign") { if (arg !== job.c) moveJob(job, { c: arg, date: job.date }, "Assigned to " + nameOf(arg)); }
    else if (action === "complete") toggleDone(job);
    else if (action === "edit") openEdit(job.id);
    else if (action === "delete") setConfirmDel(job);
  };

  // ---- Drag and drop ----
  // What's under the pointer: a week tab, or a person's day (with the place
  // in that day where the job would go).
  const resolveTarget = (x, y, job) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const tab = el.closest("[data-week-tab]");
    if (tab) return { kind: "tab", w: Number(tab.dataset.weekTab) };
    const cell = el.closest("[data-drop-cell]");
    if (!cell) return null;
    const cards = [...cell.querySelectorAll("[data-card]")].filter((n) => n.dataset.card !== job.id);
    let index = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) { index = i; break; }
    }
    return { kind: "cell", c: cell.dataset.c, w: Number(cell.dataset.w), d: Number(cell.dataset.d), date: cell.dataset.date, index };
  };

  const drag = useJobDrag({
    canDrag: canEdit,
    scrollRef: gridRef,
    resolveTarget,
    onTap: (job) => openEdit(job.id),
    onMenu: (job, x, y) => openMenu(job, x, y),
    onBlocked: () => blocked(),
    onDrop: (job, target) => {
      lastDrop.current = Date.now();
      if (!target || target.kind !== "cell") return;
      moveJob(job, { c: target.c, date: target.date, index: target.index });
    },
  });
  const dragging = drag.drag;
  const over = dragging && dragging.target;

  // Hold a dragged job over a week tab to open that week.
  useEffect(() => {
    if (!over || over.kind !== "tab" || over.w === week) return;
    const t = setTimeout(() => setWeek(over.w), 450);
    return () => clearTimeout(t);
  }, [over && over.kind, over && over.w, week]); // eslint-disable-line react-hooks/exhaustive-deps

  const dropLabel = (() => {
    if (!dragging) return "";
    if (!over) return "Drop on a day";
    if (over.kind === "tab") return over.w === week ? "Week " + (over.w + 1) : "Hold to open week " + (over.w + 1);
    const j = dragging.job;
    if (over.c === j.c && over.date === j.date) return v2 ? "Move within the day" : "Same day";
    return "Move to " + (over.c !== j.c ? nameOf(over.c) + " · " : "") + dayLabel(over.date);
  })();

  const cardHandlers = (j) => (sharedView ? null : {
    onPointerDown: (e) => drag.onPointerDown(e, j),
    onContextMenu: (e) => { e.preventDefault(); if (drag.busy()) return; openMenu(j, e.clientX, e.clientY); },
    onKeyDown: (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openEdit(j.id); }
      else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        openMenu(j, r.left + 24, r.top + 24);
      }
    },
  });

  // Ctrl+Z (Cmd+Z on a Mac) undoes the last change, unless a box is being typed in.
  useEffect(() => {
    if (!canEdit) return;
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || String(e.key).toLowerCase() !== "z") return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (editing || duplicating || settingsDraft || sharePanel || moving || confirmDel || menu) return;
      e.preventDefault();
      undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canEdit, undo, editing, duplicating, settingsDraft, sharePanel, moving, confirmDel, menu]);

  // ---- Duplicate across people / days / weeks ----
  // Opened from the menu or the job form. Starts with the job's own day and
  // week ticked and nobody picked: the usual job is "same day, someone else".
  const openDuplicate = (base) => {
    if (lapsed) { blocked(); return; }
    setDuplicating({ base, contractors: [], days: base.d != null ? [base.d] : [0], weeks: base.w != null && base.w >= 0 ? [base.w] : [0] });
  };
  const dupToggle = (key, val) => setDuplicating((d) => {
    const has = d[key].includes(val);
    return { ...d, [key]: has ? d[key].filter((x) => x !== val) : [...d[key], val] };
  });
  const dupDaysQuick = (set) => setDuplicating((d) => ({ ...d, days: set }));
  const dupWeeksQuick = (set) => setDuplicating((d) => ({ ...d, weeks: set }));
  const dupCopies = (d) => {
    if (!d) return [];
    const b = d.base;
    const span = b.end && b.date ? diffDays(b.date, b.end) : 0;
    const out = [];
    d.contractors.forEach((c) => d.weeks.forEach((wk) => d.days.forEach((day) => {
      const date = cellDate(wk, day);
      if (c === b.c && date === b.date) return; // not on top of the original
      out.push({ ...cleanJob(b), id: uid(), c, date, end: span ? addDays(date, span) : null, order: null });
    })));
    return out;
  };
  const runDuplicate = () => {
    const copies = dupCopies(duplicating);
    setDuplicating(null); setEditing(null);
    if (!copies.length) return;
    const people = [...new Set(copies.map((c) => c.c))];
    const label = copies.length === 1
      ? "Copied to " + nameOf(copies[0].c) + " · " + dayLabel(copies[0].date)
      : "Made " + copies.length + " copies" + (people.length <= 2 ? " for " + people.map(nameOf).join(" and ") : "");
    commit(label, copies.map((c) => ({ before: null, after: c })));
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
    if (access.isTry || access.readOnly) { tryPrompt.show(LOCKED.share); return; }
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
    catch { alert("Copy failed — select the link and copy it manually."); }
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
    if (access.isTry) { tryPrompt.show(LOCKED.share); return; }
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
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: P.page, fontFamily: FONTS, color: P.muted, fontSize: 13 }}>{"Loading planner…"}</div>;
  }

  if (notFound) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: P.page, fontFamily: FONTS, padding: 24 }}>
        <div style={{ maxWidth: 420, textAlign: "center", background: P.surface, border: "1px solid " + P.line, borderRadius: 14, padding: "28px 26px" }}>
          <div style={{ fontFamily: SEMI, fontWeight: 700, fontSize: 20, color: P.ink, marginBottom: 8 }}>{"This link isn’t working"}</div>
          <div style={{ fontSize: 13.5, color: P.ink2, lineHeight: 1.5 }}>{"It may have been replaced with a newer one. Ask the office to send you the current link."}</div>
        </div>
      </div>
    );
  }

  // One person's day on the board: their jobs, plus the drop target while a
  // job is dragged over it.
  const renderCell = (c, d, di) => {
    const list = cellJobs(c.id, week, di);
    const isOver = over && over.kind === "cell" && over.c === c.id && over.w === week && over.d === di;
    const dragId = dragging ? dragging.job.id : null;
    const line = <div key="drop-line" aria-hidden="true" style={{ height: 3, borderRadius: 2, background: P.accent2, margin: "1px 0 6px", position: "relative" }}><span style={{ position: "absolute", left: -3, top: -3, width: 9, height: 9, borderRadius: "50%", background: P.accent2 }} /></div>;
    const out = [];
    let k = 0;
    list.forEach((j) => {
      if (j.id !== dragId) { if (isOver && v2 && over.index === k) out.push(line); k++; }
      out.push(
        <div key={j.id} data-card={j.id}>
          <JobCard j={j} cdef={CDEF} P={P} dark={dark} interactive={!sharedView}
            state={j.id === dragId ? "source" : drag.lifted === j.id ? "lifted" : null}
            handlers={cardHandlers(j)} />
        </div>
      );
    });
    if (isOver && v2 && over.index >= k) out.push(line);
    return (
      <div key={di} className="wp-cell" data-drop-cell data-c={c.id} data-w={week} data-d={di} data-date={d.iso}
        onClick={(ev) => {
          if (ev.target.closest("[data-card]") || Date.now() - lastDrop.current < 400) return;
          openNew(c.id, d.iso);
        }}
        style={{
          ...dayFlex(d.narrow), padding: "7px 7px 2px", borderRight: "2px solid " + P.rowSep, minHeight: 82,
          cursor: readOnly ? "default" : "pointer",
          background: isOver ? P.drop : d.isToday ? P.today : d.narrow ? P.cellNarrow : P.cell,
          outline: isOver ? "2.5px dashed " + P.accent2 : "none", outlineOffset: -4,
        }}>
        {out}
        {!readOnly && <div className="wp-add" style={{ textAlign: "center", color: P.muted, fontFamily: COND, fontWeight: 600, fontSize: 13, padding: "2px 0 4px" }}>+ add job</div>}
      </div>
    );
  };

  const menuItems = ["duplicate", "move", "assign", "complete", "edit", "-", "delete"];
  const dupCount = dupCopies(duplicating).length;
  const windowList = windowDays();

  return (
    <div className={"wp-page" + (dragging ? " wp-dragging" : "")} style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, fontFamily: FONTS, background: P.page }}>
      <style>{`
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
        .wp-dragging .wp-cell .wp-add{opacity:0}
        .wp-card:focus-visible{outline:2.5px solid ${P.accent};outline-offset:2px}
        .wp-field:focus{outline:none;border-color:${P.accent2};box-shadow:0 0 0 3px ${dark ? "rgba(63,183,201,.22)" : "rgba(44,151,168,.16)"}}
        .wp-home{display:inline-flex;align-items:center;gap:7px;font-family:${COND};font-weight:700;font-size:14px;letter-spacing:.02em;padding:9px 16px;border-radius:8px;cursor:pointer;background:${P.surface};color:${P.ink};border:1px solid ${P.line};transition:background .15s ease,color .15s ease,border-color .15s ease}
        .wp-home:hover{background:#2C97A8;color:#1A2530;border-color:#2C97A8}
        .wp-home svg{display:block}
        ${dragging ? "body,body *{cursor:grabbing !important}" : ""}
      `}</style>

      <div style={{ width: 1300, maxWidth: "100%", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {!readOnly && (
          <button className="wp-home" onClick={() => router.push("/")} title="Back to dashboard" style={{ marginRight: "auto" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            Dashboard
          </button>
        )}
        {readOnly ? (
          <span style={{ fontSize: 12.5, color: P.muted }}>{"Viewing only — this diary updates automatically when the office changes it."}</span>
        ) : (
          <>
            <span style={{ fontSize: 12.5, color: P.muted }}>{"Send the lads a view-only link, or share this week as an image."}</span>
            <button onClick={openShare} style={{ fontFamily: COND, fontWeight: 700, fontSize: 14, letterSpacing: ".02em", padding: "9px 18px", borderRadius: 8, cursor: "pointer", background: P.surface, color: P.accent2, border: "1px solid " + P.accent2 }}>
              {"Get view-only link ▸"}
            </button>
          </>
        )}
        <button onClick={exportImage} style={{ fontFamily: COND, fontWeight: 700, fontSize: 14, letterSpacing: ".02em", padding: "9px 18px", borderRadius: 8, cursor: "pointer", background: P.accent2, color: "#fff", border: "1px solid " + P.accent2 }}>
          {exporting ? "Preparing image…" : "Share this week as image ▸"}
        </button>
      </div>

      {lapsed && (
        <div role="status" style={{ width: 1300, maxWidth: "100%", display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10, background: P.amberBg, border: "1px solid " + P.amberLine, color: P.ink, fontSize: 13.5 }}>
          <span style={{ fontWeight: 700 }}>View-only</span>
          <span style={{ color: P.ink2 }}>{access.paymentOverdue ? "Your last payment didn’t go through, so the planner can’t be changed until it’s paid." : "Your subscription has ended, so the planner can’t be changed. All your jobs are still here."}</span>
          <button type="button" onClick={() => setViewOnly(true)} style={{ ...btn(P, "primary"), marginLeft: "auto", padding: "6px 12px", fontSize: 13 }}>{access.paymentOverdue ? "Pay now" : "Subscribe"}</button>
        </div>
      )}

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
            <button onClick={() => setWeek((w) => Math.max(0, w - 1))} style={navBtn(week === 0)}>{"‹ Prev"}</button>
            <div className="wp-wt" style={{ fontFamily: SEMI, fontWeight: 700, fontSize: 21, textAlign: "center" }}>{weekTitle}</div>
            <button onClick={() => setWeek((w) => Math.min(3, w + 1))} style={navBtn(week === 3)}>{"Next ›"}</button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, padding: "11px 24px", background: P.surfaceAlt, borderBottom: "1px solid " + P.line2, alignItems: "center", flexWrap: "wrap" }}>
          {[0, 1, 2, 3].map((w) => {
            const s = new Date(monday0); s.setDate(monday0.getDate() + w * 7);
            const active = w === week;
            const hot = over && over.kind === "tab" && over.w === w;
            return (
              <button key={w} data-week-tab={w} onClick={() => setWeek(w)} style={{ fontFamily: COND, fontWeight: 600, fontSize: 13, letterSpacing: ".03em", padding: "6px 13px", borderRadius: 6, cursor: "pointer", background: active ? P.activeTabBg : hot ? P.drop : P.surface, color: active ? P.activeTabInk : P.ink2, border: (hot ? "2px dashed " : "1px solid ") + (active || hot ? P.activeTabBg : P.line) }}>
                {"Wk " + (w + 1) + " · " + fmt(s)}
              </button>
            );
          })}
          <span style={{ fontSize: 12.5, color: P.muted, fontStyle: "italic", marginLeft: 6 }}>{readOnly ? "Rolls automatically · view only" : "Drag a job to move it · right-click (long-press on iPad) for more · tap a space to add"}</span>
          <span className="wp-swipe" style={{ width: "100%", fontSize: 12, color: P.accent2, fontWeight: 600, marginTop: 2 }}>{"↔ Swipe the board sideways to see all days"}</span>
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
            {days.map((d, di) => renderCell(c, d, di))}
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
            <button onClick={() => setWeek((w) => Math.max(0, w - 1))} style={navBtn(week === 0)}>{"‹"}</button>
            <div style={{ fontFamily: SEMI, fontWeight: 700, fontSize: 16 }}>{weekTitle}</div>
            <button onClick={() => setWeek((w) => Math.min(3, w + 1))} style={navBtn(week === 3)}>{"›"}</button>
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
            const list = cellJobs(c.id, week, mDay);
            if (mWho === "all" && !list.length) return null;
            return (
              <div key={c.id} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: c.color, flex: "none" }} />
                  <span style={{ fontFamily: SEMI, fontWeight: 700, fontSize: 15, color: P.ink }}>{c.name}</span>
                  {!readOnly && <button onClick={() => openNew(c.id, cellDate(week, mDay))} style={{ marginLeft: "auto", fontFamily: COND, fontWeight: 600, fontSize: 12, padding: "4px 9px", borderRadius: 6, cursor: "pointer", background: P.surfaceAlt, color: P.accent2, border: "1px solid " + P.line }}>+ add</button>}
                </div>
                {list.length ? list.map((j) => (
                  <JobCard key={j.id} j={j} cdef={CDEF} P={P} dark={dark} interactive={!sharedView} state={drag.lifted === j.id ? "lifted" : null} handlers={cardHandlers(j)} />
                )) : (
                  <div style={{ fontSize: 12.5, color: P.muted, fontStyle: "italic", padding: "6px 2px" }}>Nothing booked</div>
                )}
              </div>
            );
          })}

          {mWho === "all" && !roster.some((c) => cellJobs(c.id, week, mDay).length) && (
            <div style={{ textAlign: "center", color: P.muted, fontSize: 13, padding: "18px 0" }}>Nothing booked this day.</div>
          )}
        </div>
      </div>

      {/* The card that follows the pointer while dragging */}
      {dragging && (
        <div aria-hidden="true" style={{ position: "fixed", left: dragging.x - dragging.offX, top: dragging.y - dragging.offY, width: dragging.w, zIndex: 100, pointerEvents: "none" }}>
          <JobCard j={dragging.job} cdef={CDEF} P={P} dark={dark} state="ghost" interactive />
          <div style={{ display: "inline-block", marginTop: 8, padding: "5px 10px", borderRadius: 7, background: "#1C2630", color: "#fff", font: "700 12px " + FONTS, whiteSpace: "nowrap", boxShadow: "0 8px 18px -8px rgba(0,0,0,.5)" }}>{dropLabel}</div>
        </div>
      )}

      {menu && (
        <JobMenu x={menu.x} y={menu.y} job={jobs.find((j) => j.id === menu.job.id) || menu.job} P={P} roster={roster}
          title={dayLabel(menu.job.date) + " · " + nameOf(menu.job.c)} items={menuItems}
          onPick={onMenuPick} onClose={() => setMenu(null)} />
      )}

      {moving && (
        <MoveDialog P={P} dark={dark} job={moving} who={nameOf(moving.c)} onClose={() => setMoving(null)}
          onPick={(date) => { const j = moving; setMoving(null); moveJob(j, { c: j.c, date }); }} />
      )}

      {confirmDel && (
        <ConfirmDialog P={P} title="Delete this job?"
          body={<><b>{confirmDel.site || "Untitled job"}</b>{" · " + dayLabel(confirmDel.date) + " · " + nameOf(confirmDel.c)}<br />You can undo it straight after.</>}
          onConfirm={() => deleteJob(confirmDel)} onClose={() => setConfirmDel(null)} />
      )}

      {viewOnly && (
        <ViewOnlyPrompt P={P} overdue={Boolean(access.paymentOverdue)} onClose={() => setViewOnly(false)}
          onSubscribe={() => { setViewOnly(false); (access.paymentOverdue && manageBilling ? manageBilling : access.openSubscribe)?.(); }} />
      )}

      <NoticeBar P={P} notice={notice} onUndo={() => { setNotice(null); undo(); }} onClose={() => setNotice(null)} />

      {/* Job editor */}
      {editing && (
        <div onClick={(ev) => { if (ev.target === ev.currentTarget) setEditing(null); }} style={{ position: "fixed", inset: 0, background: "rgba(10,20,25,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 50 }}>
          <div style={{ width: 440, maxWidth: "100%", maxHeight: "92vh", overflow: "auto", background: P.surface, borderRadius: 14, boxShadow: "0 24px 60px -20px rgba(0,0,0,.55)" }}>
            <div style={{ background: P.header, color: P.headerText, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontFamily: SEMI, fontWeight: 700, fontSize: 19 }}>{editing.isNew ? "New job" : "Edit job"}</span>
              <span style={{ fontFamily: COND, fontWeight: 600, fontSize: 13, color: P.headerSub }}>{nameOf(editing.c) + " · " + dayLabel(editing.date)}</span>
            </div>
            <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 13 }}>
              <div style={{ display: "flex", gap: 12 }}>
                <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}><span style={lbl(P)}>Contractor</span><select className="wp-field" style={fieldStyle} value={editing.c} onChange={(e) => setField("c", e.target.value)}>{roster.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}><span style={lbl(P)}>Day</span>
                  <select className="wp-field" style={fieldStyle} value={editing.date || ""} onChange={(e) => setField("date", e.target.value)}>
                    {editing.date && !windowList.some((x) => x.date === editing.date) && <option value={editing.date}>{dayLabel(editing.date)}</option>}
                    {[0, 1, 2, 3].map((w) => (
                      <optgroup key={w} label={"Week " + (w + 1)}>
                        {windowList.filter((x) => x.w === w).map((x) => <option key={x.date} value={x.date}>{dayLabel(x.date)}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </label>
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <label style={{ width: 120, display: "flex", flexDirection: "column", gap: 5 }}><span style={lbl(P)}>Start time</span><input className="wp-field" style={fieldStyle} value={editing.t} onChange={(e) => setField("t", e.target.value)} placeholder="08:00" /></label>
                <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}><span style={lbl(P)}>Status</span><select className="wp-field" style={fieldStyle} value={editing.st} onChange={(e) => setField("st", e.target.value)}><option value="booked">Booked</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select></label>
              </div>
              <button onClick={() => setField("imp", !editing.imp)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 12px", borderRadius: 8, cursor: "pointer", textAlign: "left", background: editing.imp ? (dark ? "#2a171a" : "#fdf0f0") : P.surface, border: "1px solid " + (editing.imp ? (dark ? "#e05563" : "#c0392b") : P.line) }}>
                <span style={{ width: 18, height: 18, flex: "none", borderRadius: 4, display: "grid", placeItems: "center", background: editing.imp ? (dark ? "#e05563" : "#c0392b") : "transparent", border: "1.5px solid " + (editing.imp ? (dark ? "#e05563" : "#c0392b") : P.muted), color: "#fff", fontSize: 12, fontWeight: 700 }}>{editing.imp ? "✓" : ""}</span>
                <span style={{ fontFamily: FONTS, fontWeight: 600, fontSize: 13.5, color: editing.imp ? (dark ? "#e05563" : "#c0392b") : P.ink2 }}>{"Mark as important (shows red on the board)"}</span>
              </button>
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}><span style={lbl(P)}>Job / site name</span><input className="wp-field" style={fieldStyle} value={editing.site} onChange={(e) => setField("site", e.target.value)} placeholder="e.g. Elm Court rewire" /></label>
              <div style={{ display: "flex", gap: 12 }}>
                <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}><span style={lbl(P)}>Job type</span><select className="wp-field" style={fieldStyle} value={editing.type} onChange={(e) => setField("type", e.target.value)}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
                <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}><span style={lbl(P)}>Customer</span><input className="wp-field" style={fieldStyle} value={editing.cust} onChange={(e) => setField("cust", e.target.value)} placeholder="e.g. Mrs Patel" /></label>
              </div>
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}><span style={lbl(P)}>Address / postcode</span><input className="wp-field" style={fieldStyle} value={editing.addr} onChange={(e) => setField("addr", e.target.value)} placeholder="e.g. 14 Elm Rd, L23" /></label>
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}><span style={lbl(P)}>Notes</span><input className="wp-field" style={fieldStyle} value={editing.notes} onChange={(e) => setField("notes", e.target.value)} placeholder={"e.g. Day 1 — 1st fix"} /></label>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                {!editing.isNew && <button onClick={() => setConfirmDel(jobs.find((j) => j.id === editing.id) || editing)} style={{ fontFamily: FONTS, fontWeight: 600, fontSize: 14, padding: "9px 14px", borderRadius: 8, cursor: "pointer", background: P.surface, color: "#c0392b", border: "1px solid " + (dark ? "#5a2a2e" : "#e6b8b8") }}>Delete</button>}
                {!editing.isNew && <button onClick={() => openDuplicate(withPos(cleanJob(editing)))} style={{ fontFamily: FONTS, fontWeight: 600, fontSize: 14, padding: "9px 14px", borderRadius: 8, cursor: "pointer", background: P.surface, color: P.accent2, border: "1px solid " + P.accent2 }}>{"Duplicate…"}</button>}
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
              <div style={{ fontSize: 12.5, color: P.headerSub, marginTop: 2 }}>{(duplicating.base.site || "This job") + " · " + nameOf(duplicating.base.c) + " · " + dayLabel(duplicating.base.date)}</div>
            </div>
            <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <div style={{ ...lbl(P), marginBottom: 8 }}>Copy to</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {roster.map((c) => { const on = duplicating.contractors.includes(c.id); return (
                    <button key={c.id} onClick={() => dupToggle("contractors", c.id)} aria-pressed={on} style={{ fontFamily: FONTS, fontWeight: 600, fontSize: 14, padding: "8px 13px", borderRadius: 999, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7, background: on ? P.accent2 : P.surface, color: on ? "#fff" : P.ink2, border: "1px solid " + (on ? P.accent2 : P.line) }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: c.color, boxShadow: on ? "0 0 0 1.5px #fff" : "none" }} />{c.name}
                    </button>
                  ); })}
                </div>
              </div>
              <div>
                <div style={{ ...lbl(P), marginBottom: 8 }}>Days</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                  {DAY_NAMES.map((n, i) => { const on = duplicating.days.includes(i); return (
                    <button key={i} onClick={() => dupToggle("days", i)} aria-pressed={on} style={{ fontFamily: FONTS, fontWeight: 600, fontSize: 13, padding: "6px 11px", borderRadius: 999, cursor: "pointer", background: on ? P.accent2 : P.surface, color: on ? "#fff" : P.ink2, border: "1px solid " + (on ? P.accent2 : P.line) }}>{n.slice(0, 3)}</button>
                  ); })}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => dupDaysQuick([0, 1, 2, 3, 4])} style={{ fontFamily: COND, fontWeight: 600, fontSize: 12, padding: "5px 10px", borderRadius: 6, cursor: "pointer", background: P.surfaceAlt, color: P.ink2, border: "1px solid " + P.line }}>{"Mon–Fri"}</button>
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
                      <button key={wk} onClick={() => dupToggle("weeks", wk)} aria-pressed={on} style={{ fontFamily: FONTS, fontWeight: 600, fontSize: 13, padding: "6px 11px", borderRadius: 999, cursor: "pointer", background: on ? P.accent2 : P.surface, color: on ? "#fff" : P.ink2, border: "1px solid " + (on ? P.accent2 : P.line) }}>
                        {"Wk " + (wk + 1) + " · " + fmt(ws)}
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => dupWeeksQuick([0, 1, 2, 3])} style={{ fontFamily: COND, fontWeight: 600, fontSize: 12, padding: "5px 10px", borderRadius: 6, cursor: "pointer", background: P.surfaceAlt, color: P.ink2, border: "1px solid " + P.line }}>All 4 weeks</button>
                  <button onClick={() => dupWeeksQuick([duplicating.base.w >= 0 ? duplicating.base.w : 0])} style={{ fontFamily: COND, fontWeight: 600, fontSize: 12, padding: "5px 10px", borderRadius: 6, cursor: "pointer", background: P.surfaceAlt, color: P.ink2, border: "1px solid " + P.line }}>This week only</button>
                </div>
              </div>
              <div style={{ fontSize: 12.5, color: P.muted }}>{dupCount ? "Creates " + dupCount + (dupCount === 1 ? " copy" : " separate copies") + ". The original stays as it is, and you can undo straight after." : "Pick who to copy it to."}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 2 }}>
                <div style={{ flex: 1 }} />
                <button onClick={() => setDuplicating(null)} style={{ fontFamily: FONTS, fontWeight: 600, fontSize: 14, padding: "9px 16px", borderRadius: 8, cursor: "pointer", background: dark ? P.surfaceAlt : "#eef1f1", color: P.ink2, border: "1px solid " + P.line }}>Cancel</button>
                <button onClick={runDuplicate} disabled={!dupCount} style={{ ...btn(P, "primary"), opacity: dupCount ? 1 : 0.5, cursor: dupCount ? "pointer" : "default" }}>{dupCount > 1 ? "Create " + dupCount + " copies" : "Create copy"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <TryPrompt open={Boolean(tryPrompt.prompt)} title={tryPrompt.prompt?.title} body={tryPrompt.prompt?.body}
        onSubscribe={() => { tryPrompt.hide(); access.openSubscribe?.(); }} onClose={tryPrompt.hide} />

      {/* Share: view-only link */}
      {sharePanel && (
        <div onClick={(ev) => { if (ev.target === ev.currentTarget) setSharePanel(null); }} style={{ position: "fixed", inset: 0, background: "rgba(10,20,25,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 60 }}>
          <div style={{ width: 480, maxWidth: "100%", background: P.surface, borderRadius: 14, boxShadow: "0 24px 60px -20px rgba(0,0,0,.55)" }}>
            <div style={{ background: P.header, color: P.headerText, padding: "16px 20px" }}>
              <span style={{ fontFamily: SEMI, fontWeight: 700, fontSize: 19 }}>{"View-only link"}</span>
              <div style={{ fontSize: 12.5, color: P.headerSub, marginTop: 2 }}>{"Send this to your operatives — they can see the diary, not change it."}</div>
            </div>
            <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
              {sharePanel.loading ? (
                <div style={{ fontSize: 13.5, color: P.muted }}>{"Preparing link…"}</div>
              ) : (
                <>
                  <input readOnly value={sharePanel.url} onFocus={(e) => e.target.select()} className="wp-field" style={{ ...fieldStyle, fontFamily: "monospace", fontSize: 12.5 }} />
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button onClick={copyShare} style={{ fontFamily: FONTS, fontWeight: 700, fontSize: 14, padding: "9px 18px", borderRadius: 8, cursor: "pointer", background: P.accent2, color: "#fff", border: "1px solid " + P.accent2 }}>{sharePanel.copied ? "Copied ✓" : "Copy link"}</button>
                    <a href={"https://wa.me/?text=" + encodeURIComponent("This week's work planner: " + sharePanel.url)} target="_blank" rel="noreferrer" style={{ fontFamily: FONTS, fontWeight: 600, fontSize: 14, padding: "9px 16px", borderRadius: 8, textDecoration: "none", background: P.surfaceAlt, color: P.ink2, border: "1px solid " + P.line }}>{"Send on WhatsApp"}</a>
                    <div style={{ flex: 1 }} />
                    <button onClick={newShareLink} style={{ fontFamily: FONTS, fontWeight: 600, fontSize: 13.5, padding: "9px 14px", borderRadius: 8, cursor: "pointer", background: P.surface, color: "#c0392b", border: "1px solid " + (dark ? "#5a2a2e" : "#e6b8b8") }}>{"New link"}</button>
                  </div>
                  <div style={{ fontSize: 12, color: P.muted, lineHeight: 1.5 }}>{"Anyone with this link can view the diary — treat it like a key. “New link” replaces it and stops the old one working."}</div>
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
                      <button onClick={() => opRemove(i)} title="Remove" style={{ width: 34, height: 34, flex: "none", borderRadius: 7, cursor: "pointer", background: P.surface, color: "#c0392b", border: "1px solid " + (dark ? "#5a2a2e" : "#e6b8b8"), fontSize: 18, lineHeight: 1 }}>{"×"}</button>
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
