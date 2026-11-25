// Timesheets week: the worker's week view, the boss's view and export, and
// the database change behind them. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  addDays, mondayOf, weekDays, dayLabel, weekLabel, toMinutes, hhmm, minutesBetween, formatHours,
  decimalHours, jobLabel, totals, dayState, canSubmitWeek, cleanEntry, newEntryDefaults, OTHER_JOB,
} from "../lib/timesheets/week.js";
import { csvCell, entriesCsv, csvFileName, CSV_COLUMNS } from "../lib/timesheets/csv.js";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

// ------------------------------------------------------------------ dates
test("weeks run Monday to Sunday, across months and years", () => {
  assert.equal(mondayOf("2026-11-25"), "2026-11-23");
  assert.equal(mondayOf("2026-11-23"), "2026-11-23");
  assert.equal(mondayOf("2026-11-29"), "2026-11-23");
  assert.equal(mondayOf("2027-01-01"), "2026-12-28");
  assert.deepEqual(weekDays("2026-11-30"), ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"]);
  assert.equal(addDays("2026-03-29", 1), "2026-03-30"); // clocks change: still one day
  assert.equal(dayLabel("2026-11-23"), "Mon 23 Nov");
  assert.equal(weekLabel("2026-11-23"), "23 – 29 Nov 2026");
  assert.equal(weekLabel("2026-11-30"), "30 Nov – 6 Dec 2026");
  assert.equal(weekLabel("2026-12-28"), "28 Dec 2026 – 3 Jan 2027");
});

// ------------------------------------------------------------------ hours
test("hours are worked out from start and finish", () => {
  assert.equal(toMinutes("07:30"), 450);
  assert.equal(toMinutes("07:30:00"), 450);
  assert.equal(toMinutes("24:00"), null);
  assert.equal(toMinutes(""), null);
  assert.equal(hhmm("16:30:00"), "16:30");
  assert.equal(minutesBetween("07:30", "16:00"), 510);
  assert.equal(minutesBetween("16:00", "07:30"), null); // night work is two entries
  assert.equal(minutesBetween("08:00", "08:00"), null);
  assert.equal(formatHours(510), "8h 30m");
  assert.equal(formatHours(480), "8h");
  assert.equal(formatHours(30), "30m");
  assert.equal(formatHours(0), "0h");
  assert.equal(decimalHours(510), "8.50");
  assert.equal(decimalHours(20), "0.33");
});

test("a job shows as its number and name", () => {
  assert.equal(jobLabel({ job_number: "001", job_name: "Smith, Driffield" }), "001 – Smith, Driffield");
  assert.equal(jobLabel({ job_number: null, job_name: "Other" }), "Other");
  // An older "Other" entry keeps what it was for.
  assert.equal(jobLabel({ job_id: null, job_number: null, job_name: "Other", other_note: "Van to MOT" }), "Other – Van to MOT");
});

test("totals for the week, each day and each job", () => {
  const entries = [
    { work_date: "2026-11-23", job_id: "a", job_number: "002", job_name: "Jones", minutes: 240 },
    { work_date: "2026-11-23", job_id: "b", job_number: "001", job_name: "Smith", minutes: 270 },
    { work_date: "2026-11-24", job_id: "b", job_number: "001", job_name: "Smith", minutes: 510 },
    { work_date: "2026-11-25", job_id: "c", job_number: "10", job_name: "Ten", minutes: 60 },
  ];
  const t = totals(entries);
  assert.equal(t.week, 1080);
  assert.deepEqual(t.byDay, { "2026-11-23": 510, "2026-11-24": 510, "2026-11-25": 60 });
  assert.deepEqual(t.byJob.map((j) => [j.job_number, j.minutes]), [["001", 780], ["002", 240], ["10", 60]]);
  assert.equal(totals([]).week, 0);
});

// ------------------------------------------------------------ what's open
test("which days a worker can change", () => {
  const base = { today: "2026-11-25", earliest: "2026-11-23" };
  assert.equal(dayState({ ...base, date: "2026-11-25", weekStatus: null }), "open");
  assert.equal(dayState({ ...base, date: "2026-11-23", weekStatus: null }), "open");
  assert.equal(dayState({ ...base, date: "2026-11-26", weekStatus: null }), "future");
  assert.equal(dayState({ ...base, date: "2026-11-24", weekStatus: "submitted" }), "locked");
  assert.equal(dayState({ ...base, date: "2026-11-18", weekStatus: null }), "closed");
  assert.equal(dayState({ ...base, date: "2026-11-18", weekStatus: "reopened" }), "open");
});

test("a week can be submitted once it has started, and not twice", () => {
  assert.equal(canSubmitWeek({ monday: "2026-11-23", thisMonday: "2026-11-23", weekStatus: null }), true);
  assert.equal(canSubmitWeek({ monday: "2026-11-16", thisMonday: "2026-11-23", weekStatus: "reopened" }), true);
  assert.equal(canSubmitWeek({ monday: "2026-11-30", thisMonday: "2026-11-23", weekStatus: null }), false);
  assert.equal(canSubmitWeek({ monday: "2026-11-23", thisMonday: "2026-11-23", weekStatus: "submitted" }), false);
});

// ------------------------------------------------------------- an entry
test("an entry needs a job, a work type, a start and a later finish; the note is optional", () => {
  const ok = { job_id: "j", work_type_id: "w", start_time: "7:30", finish_time: "16:00", description: "  " };
  assert.deepEqual(cleanEntry(ok).value, { job_id: "j", work_type_id: "w", start_time: "07:30", finish_time: "16:00", description: null });
  assert.equal(cleanEntry({ ...ok, description: " Fitted  CU \n" }).value.description, "Fitted CU");
  assert.match(cleanEntry({ ...ok, job_id: "" }).error, /job/);
  assert.match(cleanEntry({ ...ok, work_type_id: "" }).error, /work type/);
  assert.match(cleanEntry({ ...ok, start_time: "" }).error, /start/);
  assert.match(cleanEntry({ ...ok, finish_time: "07:00" }).error, /after start/);
  assert.match(cleanEntry({ ...ok, description: "x".repeat(151) }).error, /150/);
});

test("older entries carry over as they are: an Other job and a break are kept", () => {
  const old = { job_id: OTHER_JOB, work_type_id: "w", start_time: "08:00", finish_time: "16:30", description: "Collected cable", break_minutes: 30 };
  // Saved back with no job (still Other); the break isn't sent, so it stays.
  assert.deepEqual(cleanEntry(old).value, { job_id: null, work_type_id: "w", start_time: "08:00", finish_time: "16:30", description: "Collected cable" });
  // Can't be made shorter than its break.
  assert.match(cleanEntry({ ...old, finish_time: "08:30" }).error, /break/);
  assert.equal(cleanEntry({ ...old, finish_time: "08:31" }).error, undefined);
});

test("a new entry is filled in from what's already there, to save taps", () => {
  const jobs = [{ id: "j1", job_number: "001", job_name: "Smith", default_work_type_id: "dw" }];
  const entries = [
    { work_date: "2026-11-23", job_id: "j1", work_type_id: "pw", start_time: "07:30:00", finish_time: "12:00:00" },
    { work_date: "2026-11-23", job_id: "j2", work_type_id: "pw", start_time: "12:30:00", finish_time: "16:00:00" },
  ];
  // First entry of a later day: Monday's first job (its own work type), Monday's hours.
  assert.deepEqual(newEntryDefaults({ date: "2026-11-24", entries, jobs }),
    { job_id: "j1", work_type_id: "dw", start_time: "07:30", finish_time: "16:00", description: "" });
  // Another entry the same day: starts when the last one finished; job left to pick.
  assert.deepEqual(newEntryDefaults({ date: "2026-11-23", entries, jobs }),
    { job_id: "", work_type_id: "pw", start_time: "16:00", finish_time: "", description: "" });
  // Nothing yet: a normal day, job to pick.
  assert.deepEqual(newEntryDefaults({ date: "2026-11-23", entries: [], jobs }),
    { job_id: "", work_type_id: "", start_time: "08:00", finish_time: "16:30", description: "" });
  // A work type that's since been archived isn't copied.
  const types = [{ id: "dw", name: "Day work" }];
  assert.equal(newEntryDefaults({ date: "2026-11-23", entries, jobs, types }).work_type_id, "");
  assert.equal(newEntryDefaults({ date: "2026-11-24", entries, jobs, types }).work_type_id, "dw");
});

// ------------------------------------------------------------------ export
test("the export: one row per entry, the columns asked for, hours as decimals", () => {
  const names = new Map([["o1", "Dave"], ["o2", "Amy"]]);
  const csv = entriesCsv([
    { operative_id: "o1", work_date: "2026-11-24", job_number: "001", job_name: "Smith, Driffield", work_type: "Price work",
      start_time: "07:30:00", finish_time: "16:00:00", minutes: 510, description: "Second fix" },
    { operative_id: "o2", work_date: "2026-11-23", job_number: "002", job_name: "Jones", work_type: "Day work",
      start_time: "08:00:00", finish_time: "12:00:00", minutes: 240, description: null },
  ], names);
  assert.ok(csv.startsWith("﻿"));
  const lines = csv.slice(1).trimEnd().split("\r\n");
  assert.equal(lines[0], CSV_COLUMNS.map((c) => `"${c}"`).join(","));
  assert.deepEqual(CSV_COLUMNS, ["Worker", "Date", "Job number", "Job name", "Work type", "Start", "Finish", "Hours", "Note"]);
  assert.equal(lines[1], '"Amy","2026-11-23","002","Jones","Day work","08:00","12:00","4.00",""');
  assert.equal(lines[2], '"Dave","2026-11-24","001","Smith, Driffield","Price work","07:30","16:00","8.50","Second fix"');
  assert.equal(lines.length, 3);

  // An older Other entry with a break: hours net of the break, what it was for kept.
  const other = entriesCsv([{ operative_id: "o1", work_date: "2026-11-02", job_id: null, job_number: null, job_name: "Other",
    other_note: "Van to MOT", work_type: "Day work", start_time: "08:00:00", finish_time: "12:30:00", minutes: 240,
    description: "Waited at garage" }], names);
  assert.equal(other.slice(1).trimEnd().split("\r\n")[1],
    '"Dave","2026-11-02","","Other – Van to MOT","Day work","08:00","12:30","4.00","Waited at garage"');
});

test("a cell can never run as a formula in Excel", () => {
  for (const bad of ["=1+1", "+44 7700", "-2", "@SUM(A1)", "\tx", "\rx"]) {
    assert.ok(csvCell(bad).startsWith(`"'`), bad);
  }
  assert.equal(csvCell('He said "hi"'), '"He said ""hi"""');
  assert.equal(csvCell(null), '""');
  assert.equal(csvFileName("2026-11-23", "2026-11-29"), "plotwire-timesheets-2026-11-23-to-2026-11-29.csv");
});

test("no costing or profit maths anywhere in Timesheets", () => {
  for (const file of ["lib/timesheets/week.js", "lib/timesheets/csv.js", "components/timesheets/WorkerWeek.jsx",
                      "components/timesheets/WorkersPanel.jsx", "supabase/timesheets-week.sql"]) {
    // The code itself, not the comments that say there's none.
    const code = read(file).split("\n").filter((l) => !/^\s*(\/\/|--|\*|\/\*)/.test(l)).join("\n");
    assert.doesNotMatch(code, /£|\bcost\b|\bprofit\b|\brate\b|\bwage\b|\bpay rate\b/i, file);
  }
});

// -------------------------------------------------- what a worker can reach
test("the worker's screens only use Timesheets data", () => {
  for (const file of ["components/timesheets/OperativeApp.jsx", "components/timesheets/WorkerWeek.jsx"]) {
    const src = read(file);
    const imports = [...src.matchAll(/^import\b.*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
    for (const from of imports) {
      assert.ok(
        ["react", "next/navigation", "lucide-react", "@/lib/supabase", "@/components/StatusMark"].includes(from)
          || from.startsWith("@/lib/timesheets/") || from.startsWith("@/components/timesheets/"),
        `${file} imports ${from}`,
      );
    }
    assert.doesNotMatch(src, /\.from\("(?!timesheet_)/, `${file} reads a table outside Timesheets`);
  }
  // Every table the data helpers touch is a Timesheets one.
  const tables = [...read("lib/timesheets/entries.js").matchAll(/\.from\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(tables.length > 0);
  for (const t of tables) assert.match(t, /^timesheet_/);
});

test("the worker's week: day cards, add another job, week total, submit, locked when submitted", () => {
  const src = read("components/timesheets/WorkerWeek.jsx");
  assert.match(src, /DAY_LONG\[i\]/);
  assert.match(src, /Add another job/);
  assert.match(src, /Week total/);
  assert.match(src, /submitWeek\(monday\)/);
  assert.match(src, /dayState\(\{ date, today: ctx\.today, earliest: ctx\.earliest_date, weekStatus: status \}\)/);
  assert.match(src, /editable=\{open\}/);
  assert.match(src, /type="time"/);
});

test("the worker's week looks like Plotwire: navy day strips, teal today, chips, a navy total bar, a padlock when submitted", () => {
  const src = read("components/timesheets/WorkerWeek.jsx");
  assert.match(src, /--brand:#2C3E50/);
  assert.match(src, /\.tsw-day-head\{[^}]*background:var\(--brand\); color:#fff\}/);
  assert.match(src, /\.tsw-day\.is-today \.tsw-day-head\{background:var\(--teal-600\); color:var\(--on-teal\)\}/);
  assert.match(src, /\.tsw-foot\{[^}]*background:var\(--brand\); color:#fff;/);
  assert.match(src, /\.tsw-chip\{[^}]*background:var\(--teal\); color:var\(--chip-ink\)/);
  assert.match(src, /<div className="tsw-submitted"><Lock /);
  assert.match(src, /className=\{`tsw-add\$\{items\.length \? "" : " is-first"\}`\}/);
});

test("the boss: workers' weeks, reopen, and the export", () => {
  const src = read("components/timesheets/WorkersPanel.jsx");
  assert.match(src, /reopenWeek\(person\.id, monday\)/);
  assert.match(src, /sum\.byDay\[d\]/);
  assert.match(src, /sum\.byJob\.map/);
  assert.match(src, /entriesCsv\(rows, names\)/);
  assert.match(src, /timesheetWorkbook\(rows, names, from, to\)/);
  assert.match(src, /Download Excel/);
  assert.match(read("components/timesheets/TimesheetsHome.jsx"), /\{ key: "workers", label: "Workers"/);
});

// ------------------------------------------------------- the database change
test("the database change only adds, or makes the note optional, and keeps every entry", () => {
  const sql = read("supabase/timesheets-week.sql");
  const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.doesNotMatch(code, /\bdrop\s+(table|function|policy|trigger|index|column)\b/i);
  assert.doesNotMatch(code, /\bdelete\s+from\b|\btruncate\b/i);
  assert.doesNotMatch(code, /\bupdate\s+public\.timesheet_entries\b/i);
  // The only rule removed is the note's, put back allowing an empty note.
  assert.match(code, /drop constraint %I/);
  assert.match(code, /alter column description drop not null/);
  assert.match(code, /check \(description is null\s+or \(char_length\(description\) between 1 and 150/);
  // Counts and adds up every entry first, and undoes everything if either changes.
  assert.match(code, /create temporary table ts_week_before/);
  assert.match(code, /'the entries changed'/);
  // A submitted week locks the worker's writes; a reopened one opens them.
  assert.match(code, /coalesce\(public\.ts_week_status\(p_operative, p_date\), ''\) <> 'submitted'/);
  assert.match(code, /or public\.ts_week_status\(p_operative, p_date\) = 'reopened'/);
  // The app can only read weeks; submitting and reopening go through functions.
  assert.match(code, /grant select on table public\.timesheet_weeks to authenticated;/);
  assert.match(code, /w\.owner_id = auth\.uid\(\)/);
});

test("the two-worker test covers privacy, submit and reopen", () => {
  const sql = read("supabase/timesheets-week-test.sql");
  for (const check of [
    "worker 2 sees only their own entries",
    "worker 2 cannot change worker 1''s entry",
    "a worker sees nothing in %s",
    "a submitted week cannot be changed",
    "a worker cannot reopen their own week",
    "another firm cannot reopen this firm''s week",
    "the boss reopens a submitted week",
    "a reopened week can be edited",
  ]) assert.ok(sql.includes(check), check);
  assert.match(sql, /raise exception 'TEST FINISHED/);
});
