// The owner's Timesheets export: one row per entry, for Excel or any
// spreadsheet. Hours only, no pay or cost.
//
// Columns: Worker, Date, Job number, Job name, Work type, Start, Finish,
// Hours, Note. Dates are YYYY-MM-DD (Excel reads them as dates everywhere),
// hours are decimal (8.50 = 8h 30m) so they add up in a spreadsheet.
//
// Safe to open: a cell that starts with = + - @ (or a tab or return) gets a
// leading apostrophe, so a job name or note can never run as a formula. Every
// cell is quoted. A byte-order mark at the start makes Excel read £ and
// accents correctly.
//
// Plain functions so tests can run them (tests/timesheets-week.test.mjs).
import { decimalHours, hhmm, jobLabel } from "./week.js";

export const CSV_COLUMNS = ["Worker", "Date", "Job number", "Job name", "Work type", "Start", "Finish", "Hours", "Note"];

/** One cell, quoted, and never a formula. */
export function csvCell(value) {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * The whole file. `names` maps an operative's id to their name (a removed
 * worker's name is kept on their record, so their hours still say who).
 * Rows run by date, then worker, then start time.
 */
export function entriesCsv(entries, names) {
  const nameOf = (id) => (names && (names.get ? names.get(id) : names[id])) || "Unknown";
  const rows = [...(entries || [])].sort((a, b) =>
    a.work_date.localeCompare(b.work_date)
    || nameOf(a.operative_id).localeCompare(nameOf(b.operative_id), "en")
    || hhmm(a.start_time).localeCompare(hhmm(b.start_time)));
  const lines = [CSV_COLUMNS.map(csvCell).join(",")];
  for (const e of rows) {
    lines.push([
      nameOf(e.operative_id),
      e.work_date,
      e.job_number || "",
      e.job_number ? e.job_name || "" : jobLabel(e),
      e.work_type || "",
      hhmm(e.start_time),
      hhmm(e.finish_time),
      decimalHours(e.minutes),
      e.description ?? "",
    ].map(csvCell).join(","));
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** "plotwire-timesheets-2026-11-23-to-2026-11-29.csv" */
export const csvFileName = (from, to) =>
  from === to ? `plotwire-timesheets-${from}.csv` : `plotwire-timesheets-${from}-to-${to}.csv`;
