"use client";

import React from "react";
import Link from "next/link";

// The left rail's buttons, as links, for a screen outside the dashboard (the
// Timesheets page). Same buttons, order and look as the dashboard's rail
// (components/HomeScreen.jsx RailItem): teal icons; with a mouse, hovering
// slides out a teal pill with the name; on touch, the short name sits under
// the icon. The page you're on is highlighted. The styles are the dashboard's
// rail styles, copied into that screen's stylesheet; a test keeps the two the
// same (tests/rail-shared.test.mjs).
//
// Links only. Timesheets uses this so that its own code never names the other
// sections (tests/timesheets-separation.test.mjs). Importing anything from the
// sections themselves would undo that separation, and the same test fails if
// this file does. prefetch is off so that showing the rail loads none of their
// code until someone clicks.
const ITEMS = [
  {
    key: "dashboard", href: "/", name: "Dashboard", short: "Dashboard",
    icon: <><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></>,
  },
  {
    // The dashboard scrolls down to its list of drawings when it opens with #drawings.
    key: "drawings", href: "/#drawings", name: "All drawings", short: "Drawings",
    icon: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>,
  },
  {
    key: "symbols", href: "/symbols", name: "Symbol library", short: "Symbols",
    icon: <><circle cx="7" cy="7" r="3.2"/><rect x="14" y="4" width="6" height="6" rx="1.4"/><path d="M4 15h6v6H4zM14 18h6"/><circle cx="17" cy="18" r="3.2"/></>,
  },
  {
    key: "planner", href: "/planner", name: "Work planner", short: "Planner",
    icon: <><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M7 13h3M7 17h3M14 13h3"/></>,
  },
  {
    key: "timesheets", href: "/timesheets", name: "Timesheets", short: "Timesheets",
    icon: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  },
  {
    key: "presets", href: "/presets", name: "Presets", short: "Presets", round: true,
    icon: <><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/></>,
  },
];

/** The rail's buttons. `current` is the key of the page you're on. */
export default function AppRailLinks({ current }) {
  return ITEMS.map(({ key, href, name, short, icon, round }) => {
    const active = key === current;
    return (
      <Link key={key} href={href} prefetch={false} className={`navitem${active ? " active" : ""}`}
            aria-label={name} aria-current={active ? "page" : undefined}>
        <span className="navpill">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin={round ? "round" : undefined}>{icon}</svg>
          <span className="navname">{name}</span>
        </span>
        <span className="navshort" aria-hidden="true">{short}</span>
      </Link>
    );
  });
}
