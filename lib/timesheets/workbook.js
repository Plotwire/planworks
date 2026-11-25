// The owner's Timesheets export as an Excel workbook. Hours only: no money
// anywhere.
//
//   "Entries"  one row per entry: Worker, Day, Date, Job number, Job name,
//              Work type, Start, Finish, Hours, Note. Dates and times are
//              real Excel dates and times, hours are numbers (8.50 = 8h 30m).
//   "Summary"  hours per job, hours per worker, and a grid of hours per job
//              per worker, each with a total.
//
// Rows follow the CSV export (csv.js): by date, then worker, then start time.
// Hours always come from the entry's minutes (any break already taken off).
//
// Plain functions so tests can run them (tests/timesheets-xlsx.test.mjs).
import { buildXlsx } from "./xlsx.js";
import { DAY_LONG, hhmm, jobLabel, parseDay } from "./week.js";

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** "plotwire-timesheets-2026-11-23-to-2026-11-29.xlsx" */
export const xlsxFileName = (from, to) =>
  from === to ? `plotwire-timesheets-${from}.xlsx` : `plotwire-timesheets-${from}-to-${to}.xlsx`;

const ENTRY_COLUMNS = [
  ["Worker", 22], ["Day", 11], ["Date", 12], ["Job number", 11], ["Job name", 30],
  ["Work type", 14], ["Start", 8], ["Finish", 8], ["Hours", 8], ["Note", 48],
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const bold = (v) => ({ v, bold: true });
const hours = (minutes, isTotal = false) => ({ v: (Number(minutes) || 0) / 60, type: "hours", bold: isTotal });

/** "2026-11-23" -> "23 Nov 2026" */
function longDate(iso) {
  const d = parseDay(iso);
  if (Number.isNaN(d.getTime())) return String(iso ?? "");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const dayName = (iso) => {
  const d = parseDay(iso);
  return Number.isNaN(d.getTime()) ? "" : DAY_LONG[(d.getUTCDay() + 6) % 7];
};

// The job name as the CSV gives it: an older "Other" entry reads
// "Other – <what it was for>".
const jobNameOf = (e) => (e.job_number ? e.job_name || "" : jobLabel(e));

// Entries for the same job share a key; entries with no job are kept apart
// by what they were for.
const jobKey = (e) => (e.job_id ? `job:${e.job_id}` : `other:${jobLabel(e)}`);

/** The whole .xlsx file for the entries between `from` and `to`. */
export function timesheetWorkbook(entries, names, from, to) {
  const nameOf = (id) => (names && (names.get ? names.get(id) : names[id])) || "Unknown";
  const rows = [...(entries || [])].sort((a, b) =>
    a.work_date.localeCompare(b.work_date)
    || nameOf(a.operative_id).localeCompare(nameOf(b.operative_id), "en")
    || hhmm(a.start_time).localeCompare(hhmm(b.start_time)));

  // ---------------------------------------------------------------- Entries
  const entryRows = [ENTRY_COLUMNS.map(([title]) => bold(title))];
  for (const e of rows) {
    entryRows.push([
      nameOf(e.operative_id),
      dayName(e.work_date),
      { v: e.work_date, type: "date" },
      { v: e.job_number ? String(e.job_number) : "", type: "text" },
      jobNameOf(e),
      e.work_type || "",
      { v: hhmm(e.start_time), type: "time" },
      { v: hhmm(e.finish_time), type: "time" },
      hours(e.minutes),
      e.description ?? "",
    ]);
  }

  // ---------------------------------------------------------------- Summary
  const jobs = new Map();
  const workers = new Map();
  let all = 0;
  for (const e of rows) {
    const mins = Number(e.minutes) || 0;
    all += mins;
    const jk = jobKey(e);
    const job = jobs.get(jk) || { number: e.job_number ? String(e.job_number) : "", name: jobNameOf(e), minutes: 0, byWorker: new Map() };
    job.minutes += mins;
    job.byWorker.set(e.operative_id, (job.byWorker.get(e.operative_id) || 0) + mins);
    jobs.set(jk, job);
    const worker = workers.get(e.operative_id) || { id: e.operative_id, name: nameOf(e.operative_id), minutes: 0 };
    worker.minutes += mins;
    workers.set(e.operative_id, worker);
  }
  // Job number order (001 before 002, 2 before 10), jobs with no number last.
  const jobList = [...jobs.values()].sort((a, b) =>
    (a.number ? 0 : 1) - (b.number ? 0 : 1)
    || a.number.localeCompare(b.number, "en", { numeric: true, sensitivity: "base" })
    || a.name.localeCompare(b.name, "en"));
  const workerList = [...workers.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "en") || String(a.id).localeCompare(String(b.id)));

  const dates = from === to ? longDate(from) : `${longDate(from)} to ${longDate(to)}`;
  const summary = [[bold("Timesheets summary")], [dates], []];
  if (!rows.length) {
    summary.push(["No hours in these dates."]);
  } else {
    summary.push([bold("Hours per job")], [bold("Job number"), bold("Job name"), bold("Hours")]);
    for (const j of jobList) summary.push([{ v: j.number, type: "text" }, j.name, hours(j.minutes)]);
    summary.push([bold("Total"), null, hours(all, true)], []);

    summary.push([bold("Hours per worker")], [bold("Worker"), bold("Hours")]);
    for (const w of workerList) summary.push([w.name, hours(w.minutes)]);
    summary.push([bold("Total"), hours(all, true)], []);

    summary.push([bold("Hours per job per worker")],
      [bold("Job number"), bold("Job name"), ...workerList.map((w) => bold(w.name)), bold("Total")]);
    for (const j of jobList) {
      summary.push([
        { v: j.number, type: "text" },
        j.name,
        ...workerList.map((w) => (j.byWorker.has(w.id) ? hours(j.byWorker.get(w.id)) : null)),
        hours(j.minutes),
      ]);
    }
    summary.push([bold("Total"), null, ...workerList.map((w) => hours(w.minutes, true)), hours(all, true)]);
  }
  const workerWidth = (w) => Math.min(24, Math.max(10, w.name.length + 2));

  return buildXlsx([
    { name: "Entries", columns: ENTRY_COLUMNS.map(([, width]) => ({ width })), rows: entryRows, freezeTopRow: true },
    {
      name: "Summary",
      columns: [{ width: 22 }, { width: 30 }, ...workerList.map((w) => ({ width: workerWidth(w) })), { width: 10 }],
      rows: summary,
    },
  ]);
}
