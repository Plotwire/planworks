"use client";
// Pop-ups for the Work Planner: the job menu (right-click / long-press), the
// move-to-date calendar, the delete confirm, the undo / error bar and the
// view-only prompt for lapsed accounts.
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FONTS, COND, SEMI } from "./ui";
import { windowDays, dayLabel, todayISO, parseISO } from "./dates";

const ICON = {
  copy: <path d="M8 8h11v11H8zM5 16V5h11" />,
  move: <path d="M5 12h14M13 6l6 6-6 6" />,
  person: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c1.2-3.6 4-5.5 7-5.5s5.8 1.9 7 5.5" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  undo: <path d="M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  trash: <path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" />,
  tray: <path d="M4 13h4l2 3h4l2-3h4M4 13l2-8h12l2 8v6H4z" />,
};
const Icon = ({ k, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICON[k]}</svg>
);

export function Modal({ P, title, sub, width = 440, onClose, children, z = 60 }) {
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose?.(); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div onClick={(ev) => { if (ev.target === ev.currentTarget) onClose?.(); }} style={{ position: "fixed", inset: 0, background: "rgba(10,20,25,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: z }}>
      <div role="dialog" aria-modal="true" style={{ width, maxWidth: "100%", maxHeight: "92vh", overflow: "auto", background: P.surface, borderRadius: 14, boxShadow: "0 24px 60px -20px rgba(0,0,0,.55)" }}>
        <div style={{ background: P.header, color: P.headerText, padding: "16px 20px" }}>
          <div style={{ fontFamily: SEMI, fontWeight: 700, fontSize: 19 }}>{title}</div>
          {sub && <div style={{ fontSize: 12.5, color: P.headerSub, marginTop: 2 }}>{sub}</div>}
        </div>
        <div style={{ padding: "18px 20px" }}>{children}</div>
      </div>
    </div>
  );
}

export const btn = (P, kind = "plain") => ({
  fontFamily: FONTS, fontWeight: kind === "primary" ? 700 : 600, fontSize: 14, padding: "9px 16px", borderRadius: 8, cursor: "pointer",
  ...(kind === "primary" ? { background: "var(--action, #2C97A8)", color: "var(--action-ink, #1A2530)", border: "1px solid var(--action, #2C97A8)" }
    : kind === "danger" ? { background: "#c0392b", color: "#fff", border: "1px solid #c0392b" }
    : { background: P.surfaceAlt, color: P.ink2, border: "1px solid " + P.line }),
});

// ---- Job menu ---------------------------------------------------------------
// items: the actions to offer, in order; "-" draws a divider.
export function JobMenu({ x, y, job, P, roster, title, items, onPick, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [assignOpen, setAssignOpen] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8));
    const top = y + r.height > window.innerHeight - 8 ? Math.max(8, y - r.height) : y;
    setPos({ left, top });
  }, [x, y, assignOpen]);
  useEffect(() => {
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const key = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    const scroll = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", onClose);
    ref.current?.querySelector("button")?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);
  const row = (key, icon, label, opts = {}) => (
    <button key={key} type="button" role="menuitem" className="wp-mi"
      onClick={() => (key === "assign" ? setAssignOpen((o) => !o) : onPick(key))}
      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: "9px 10px", border: 0, borderRadius: 7, background: "transparent", cursor: "pointer", font: "500 14px " + FONTS, color: opts.danger ? "#c0392b" : P.ink }}>
      <Icon k={icon} />{label}{opts.after}
    </button>
  );
  const done = job.st === "done";
  return (
    <div ref={ref} role="menu" aria-label={"Actions for " + (job.site || "job")}
      style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 80, width: 236, background: P.surface, borderRadius: 11, padding: 6, boxShadow: "0 18px 40px -12px rgba(10,30,40,.5), 0 0 0 1px " + P.line }}>
      <style>{`.wp-mi:hover,.wp-mi:focus-visible{background:${P.menuHover} !important;outline:none}`}</style>
      <div style={{ padding: "6px 10px 8px", borderBottom: "1px solid " + P.line2, marginBottom: 4 }}>
        <div style={{ fontFamily: SEMI, fontWeight: 700, fontSize: 14, color: P.ink, lineHeight: 1.15 }}>{job.site || "Untitled job"}</div>
        <div style={{ fontSize: 11.5, color: P.muted, marginTop: 1 }}>{title}</div>
      </div>
      {items.map((it, i) => {
        if (it === "-") return <div key={"sep" + i} style={{ height: 1, background: P.line2, margin: "4px 4px" }} />;
        if (it === "duplicate") return row("duplicate", "copy", "Duplicate to…");
        if (it === "move") return row("move", "move", "Move to date…");
        if (it === "assign") return (
          <div key="assign">
            {row("assign", "person", "Assign to", { after: <span style={{ marginLeft: "auto", color: P.muted, transform: assignOpen ? "rotate(90deg)" : "none", transition: "transform .12s" }}>{"›"}</span> })}
            {assignOpen && (
              <div style={{ padding: "2px 0 4px 26px" }}>
                {roster.map((c) => (
                  <button key={c.id} type="button" role="menuitemradio" aria-checked={c.id === job.c} className="wp-mi" onClick={() => onPick("assign", c.id)}
                    style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", padding: "7px 10px", border: 0, borderRadius: 7, background: "transparent", cursor: "pointer", font: "500 13.5px " + FONTS, color: P.ink }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: c.color, flex: "none" }} />{c.name}
                    {c.id === job.c && <span style={{ marginLeft: "auto", color: P.accent2 }}><Icon k="check" size={14} /></span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
        if (it === "complete") return row("complete", done ? "undo" : "check", done ? "Mark not complete" : "Mark complete");
        if (it === "edit") return row("edit", "edit", "Edit");
        if (it === "unschedule") return row("unschedule", "tray", "Move to Unscheduled");
        if (it === "delete") return row("delete", "trash", "Delete…", { danger: true });
        return null;
      })}
    </div>
  );
}

// ---- Move to date -------------------------------------------------------------
export function MoveDialog({ P, dark, job, who, onPick, onClose }) {
  const days = windowDays();
  const today = todayISO();
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return (
    <Modal P={P} title="Move to date" sub={(job.site || "This job") + (who ? " · " + who : "") + " · now " + dayLabel(job.date)} width={470} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6 }}>
        {names.map((n) => <div key={n} style={{ textAlign: "center", fontFamily: COND, fontWeight: 700, fontSize: 12.5, letterSpacing: ".05em", textTransform: "uppercase", color: P.muted }}>{n}</div>)}
        {days.map(({ date }) => {
          const d = parseISO(date);
          const on = date === job.date;
          const isToday = date === today;
          const first = d.getDate() === 1 || date === days[0].date;
          return (
            <button key={date} type="button" onClick={() => onPick(date)} aria-pressed={on} title={dayLabel(date)}
              style={{ height: 50, borderRadius: 9, cursor: "pointer", fontFamily: COND, fontWeight: 700, fontSize: 18, lineHeight: 1, background: on ? P.accent2 : P.surface, color: on ? "#fff" : P.ink, border: (isToday ? "2px solid " : "1px solid ") + (isToday ? P.accent : P.line), display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
              {d.getDate()}
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".04em", color: on ? "#e6f7f9" : P.muted, textTransform: "uppercase" }}>{isToday ? "Today" : first ? d.toLocaleString("en-GB", { month: "short" }) : " "}</span>
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 12, color: P.muted, marginTop: 12 }}>The planner shows four weeks from this Monday. The job keeps its person, time and details.</div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}><button type="button" onClick={onClose} style={btn(P)}>Cancel</button></div>
    </Modal>
  );
}

// ---- Confirm --------------------------------------------------------------------
export function ConfirmDialog({ P, title, body, confirmLabel = "Delete", onConfirm, onClose }) {
  const ok = useRef(null);
  useEffect(() => { ok.current?.focus(); }, []);
  return (
    <Modal P={P} title={title} width={420} onClose={onClose} z={90}>
      <div style={{ fontSize: 14, color: P.ink2, lineHeight: 1.5 }}>{body}</div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
        <button type="button" onClick={onClose} style={btn(P)}>Cancel</button>
        <button type="button" ref={ok} onClick={onConfirm} style={btn(P, "danger")}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}

// ---- Undo / error bar -------------------------------------------------------------
// notice: { kind: "undo" | "error" | "info", text }
export function NoticeBar({ P, notice, onUndo, onClose }) {
  if (!notice) return null;
  const err = notice.kind === "error";
  return (
    <div role={err ? "alert" : "status"} aria-live={err ? "assertive" : "polite"}
      style={{ position: "fixed", left: "50%", bottom: 22, transform: "translateX(-50%)", zIndex: 95, maxWidth: "calc(100vw - 24px)", display: "flex", alignItems: "center", gap: 12, padding: "10px 10px 10px 16px", borderRadius: 11, background: "#1C2630", color: "#fff", boxShadow: "0 14px 34px -12px rgba(0,0,0,.55)", borderLeft: err ? "5px solid #e05563" : "5px solid " + P.accent, font: "500 14px " + FONTS }}>
      <span style={{ lineHeight: 1.35 }}>{notice.text}</span>
      {notice.kind === "undo" && (
        <>
          <button type="button" onClick={onUndo} style={{ font: "700 14px " + FONTS, color: "#5FD0E0", background: "rgba(63,183,201,.16)", border: 0, borderRadius: 7, padding: "6px 12px", cursor: "pointer" }}>Undo</button>
          <span style={{ fontSize: 12, color: "#8fa3b3", whiteSpace: "nowrap" }}>Ctrl+Z</span>
        </>
      )}
      <button type="button" onClick={onClose} aria-label="Dismiss" style={{ background: "transparent", border: 0, color: "#8fa3b3", fontSize: 20, lineHeight: 1, cursor: "pointer", padding: "0 6px" }}>{"×"}</button>
    </div>
  );
}

// ---- Lapsed: view-only ---------------------------------------------------------------
export function ViewOnlyPrompt({ P, overdue, onSubscribe, onClose }) {
  return (
    <Modal P={P} title="Your planner is view-only" width={420} onClose={onClose} z={90}>
      <div style={{ fontSize: 14, color: P.ink2, lineHeight: 1.5 }}>
        {overdue
          ? "Your last payment didn’t go through, so the planner is view-only until it’s paid. All your jobs are still here, and your team’s view-only link still works."
          : "Your subscription has ended, so the planner is view-only. All your jobs are still here, and your team’s view-only link still works. Subscribe again to make changes."}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
        <button type="button" onClick={onClose} style={btn(P)}>Not now</button>
        <button type="button" onClick={onSubscribe} style={btn(P, "primary")}>{overdue ? "Pay now" : "Subscribe"}</button>
      </div>
    </Modal>
  );
}
