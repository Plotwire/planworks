"use client";

import React from "react";
import Link from "next/link";

// Links to two other sections of the app, for the left rail of a screen that
// otherwise has nothing to do with them. Timesheets uses this so that its own
// code never names those sections (tests/timesheets-separation.test.mjs).
//
// Links only. Importing anything from the sections themselves would undo that
// separation, and the same test fails if this file does. prefetch is off so
// that showing the rail loads none of their code until someone clicks.
const LINKS = [
  {
    href: "/symbols",
    label: "Symbol library",
    icon: <><circle cx="7" cy="7" r="3.2"/><rect x="14" y="4" width="6" height="6" rx="1.4"/><path d="M4 15h6v6H4zM14 18h6"/><circle cx="17" cy="18" r="3.2"/></>,
  },
  {
    href: "/planner",
    label: "Work planner",
    icon: <><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M7 13h3M7 17h3M14 13h3"/></>,
  },
];

export default function AppRailLinks({ className }) {
  return LINKS.map(({ href, label, icon }) => (
    <Link key={href} href={href} prefetch={false} className={className} title={label} aria-label={label}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">{icon}</svg>
    </Link>
  ));
}
