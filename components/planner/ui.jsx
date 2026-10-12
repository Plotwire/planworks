"use client";
// The Work Planner's look: fonts, palette, status pills and the job card.
import React from "react";

export const FONTS = "var(--font-barlow), system-ui, sans-serif";
export const COND = "var(--font-barlow-condensed), var(--font-barlow), sans-serif";
export const SEMI = "var(--font-barlow-semi-condensed), var(--font-barlow), sans-serif";

export function palette(dark) {
  return dark
    ? { page: "#0E141B", surface: "#16202B", surfaceAlt: "#111A22", line: "#2A3947", line2: "#202C38", ink: "#E7EDF3", ink2: "#B6C2CE", muted: "#8595A3", header: "#12202B", headerText: "#EAF6F7", headerSub: "#8fb9bf", accent: "#3FB7C9", accent2: "#2C97A8", accentInk: "#052a30", activeTabBg: "#2C97A8", activeTabInk: "#04252b", today: "#12303a", cell: "#16202B", cellNarrow: "#131d26", rowSep: "#243341", colHead: "#12202B", drop: "rgba(63,183,201,.16)", amber: "#F2B233", amberBg: "#2b2412", amberLine: "#8a6a1e", menuHover: "#1f2d3a" }
    : { page: "#e9eef0", surface: "#ffffff", surfaceAlt: "#f2f6f7", line: "#cfd8da", line2: "#dbe3e4", ink: "#203038", ink2: "#3a4a52", muted: "#6f7d84", header: "#2C3E50", headerText: "#ffffff", headerSub: "#b7c6d2", accent: "#3FB7C9", accent2: "#2C97A8", accentInk: "#08313a", activeTabBg: "#2C97A8", activeTabInk: "#ffffff", today: "#eaf6f7", cell: "#ffffff", cellNarrow: "#f6f9fa", rowSep: "#d3dcde", colHead: "#2C3E50", drop: "rgba(63,183,201,.12)", amber: "#F2B233", amberBg: "#FFF8EC", amberLine: "#E6A23C", menuHover: "#EAF6F7" };
}

export const STATUS_TEXT = { booked: "Booked", done: "Done", cancelled: "Cancelled" };
export function statusStyle(k, dark) {
  const L = { booked: { bg: "#eef1f3", fg: "#4a5560" }, done: { bg: "#e4f3ea", fg: "#1f7a44" }, cancelled: { bg: "#fbe6e6", fg: "#c0392b" } };
  const D = { booked: { bg: "#243341", fg: "#aab6c0" }, done: { bg: "#123726", fg: "#4ecb86" }, cancelled: { bg: "#3a1e22", fg: "#e79aa0" } };
  return (dark ? D : L)[k] || (dark ? D.booked : L.booked);
}

export function Pill({ k, dark }) {
  const s = statusStyle(k, dark);
  return <span style={{ display: "inline-block", font: "600 10px/1 " + FONTS, letterSpacing: ".04em", textTransform: "uppercase", padding: "3px 6px", borderRadius: 4, background: s.bg, color: s.fg }}>{STATUS_TEXT[k] || k}</span>;
}

export const lbl = (P) => ({ fontFamily: COND, fontWeight: 600, fontSize: 12, letterSpacing: ".05em", textTransform: "uppercase", color: P.muted });

// state: "lifted" (held on iPad), "source" (being dragged: a faded outline is
// left behind), "ghost" (the copy that follows the pointer). clash: the person
// is double-booked that day. seg: { i, n } for one day of a multi-day job.
// stretch: pointer-down handler for the handle on the right edge that
// stretches the job across days (shown on the day the job ends).
export function JobCard({ j, cdef, P, dark, state = null, clash = false, seg = null, handlers = null, interactive = false, stretch = null }) {
  const c = cdef[j.c] || { color: P.muted };
  const cancelled = j.st === "cancelled";
  const imp = !!j.imp && !cancelled;
  const RED = dark ? "#e05563" : "#c0392b";
  const RED_BG = dark ? "#2a171a" : "#fdf0f0";
  const sub = [j.addr, j.cust].filter((x) => x && x !== "—").join(" · ") + (j.notes ? " — " + j.notes : "");
  const warn = clash && !cancelled;
  const border = imp ? RED : warn ? P.amberLine : P.line;
  const bg = imp ? RED_BG : warn ? P.amberBg : P.surface;
  const ghost = state === "ghost";
  const source = state === "source";
  const liftedState = state === "lifted";
  return (
    <div
      {...(handlers || {})}
      tabIndex={interactive ? 0 : undefined}
      role={interactive ? "button" : undefined}
      aria-label={interactive ? `${j.site || "Job"}, ${j.t || "no time"}. Press Enter to edit, or the menu key for more.` : undefined}
      className={interactive ? "wp-card" : undefined}
      style={{
        cursor: interactive ? (ghost ? "grabbing" : "pointer") : "default",
        background: bg,
        // Longhands only: React warns when a shorthand and a side change together.
        borderStyle: source ? "dashed dashed dashed solid" : "solid",
        borderWidth: source ? "1.5px 1.5px 1.5px 4px" : "1px 1px 1px 4px",
        borderColor: [source ? P.accent2 : border, source ? P.accent2 : border, source ? P.accent2 : border, imp ? RED : c.color].join(" "),
        borderRadius: 6, padding: "7px 8px 8px", marginBottom: ghost ? 0 : 6,
        opacity: source ? 0.35 : cancelled ? 0.6 : 1,
        transform: ghost ? "rotate(-2deg)" : liftedState ? "scale(1.04)" : "none",
        boxShadow: ghost ? "0 18px 34px -12px rgba(10,30,40,.5)" : liftedState ? "0 10px 24px -8px rgba(10,30,40,.4), 0 0 0 2px " + P.accent : "none",
        transition: "transform .12s ease, box-shadow .12s ease",
        userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none",
        position: "relative",
        paddingRight: stretch ? 16 : 8,
      }}>
      {seg && seg.i > 1 && <span aria-hidden="true" title="Continues from the day before" style={{ position: "absolute", left: -2, top: "50%", transform: "translate(-50%,-50%)", width: 14, height: 14, borderRadius: 999, background: P.accent2, color: "#fff", font: "700 11px/13px " + FONTS, textAlign: "center", zIndex: 1 }}>{"‹"}</span>}
      {seg && seg.i < seg.n && <span aria-hidden="true" title="Continues the next day" style={{ position: "absolute", right: -8, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, borderRadius: 999, background: P.accent2, color: "#fff", font: "700 11px/13px " + FONTS, textAlign: "center", zIndex: 1 }}>{"›"}</span>}
      {stretch && (
        <span className="wp-grip" data-multi={seg && seg.n > 1 ? "" : undefined} title="Drag to stretch across days" aria-label="Stretch across days" onPointerDown={stretch}
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 12, borderRadius: "0 5px 5px 0", cursor: "ew-resize", touchAction: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ width: 4, height: 16, borderLeft: "1.5px solid currentColor", borderRight: "1.5px solid currentColor" }} />
        </span>
      )}
      {/* Wraps in a narrow column (the weekend): the flags drop below the time. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "3px 6px" }}>
        <span style={{ fontFamily: COND, fontWeight: 700, fontSize: 14, color: imp ? RED : P.accent2 }}>{j.t || "—"}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {warn && <span title="This person has another job at the same time that day" style={{ font: "700 9px/1.15 " + FONTS, letterSpacing: ".06em", textTransform: "uppercase", padding: "3px 5px", borderRadius: 999, background: P.amber, color: "#1A2530" }}>{"⚠ Double-booked"}</span>}
          {imp && <span style={{ font: "700 9px/1 " + FONTS, letterSpacing: ".08em", textTransform: "uppercase", padding: "3px 5px", borderRadius: 3, background: RED, color: "#fff" }}>{"Important"}</span>}
          <Pill k={j.st} dark={dark} />
        </div>
      </div>
      <div style={{ fontFamily: SEMI, fontWeight: 700, fontSize: 13.5, color: cancelled ? P.muted : (imp ? RED : P.ink), lineHeight: 1.15, textDecoration: cancelled ? "line-through" : "none" }}>{j.site || "Untitled job"}</div>
      <div style={{ fontFamily: COND, fontWeight: 600, fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: P.muted, marginTop: 1 }}>
        {j.type}{seg && seg.n > 1 ? <span style={{ marginLeft: 6, color: P.accent2 }}>{"Day " + seg.i + " of " + seg.n}</span> : null}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: P.ink2, marginTop: 3, lineHeight: 1.3 }}>{sub}</div>}
    </div>
  );
}
