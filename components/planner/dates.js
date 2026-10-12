// Date helpers for the Work Planner. Dates are "YYYY-MM-DD" strings (the
// database's job_date), in the browser's own time zone.
import { currentMonday, toISODate, boardPos } from "@/lib/planner";

const DAY3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const parseISO = (iso) => new Date(iso + "T00:00:00");

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

// Whole days from a to b (b - a).
export function diffDays(a, b) {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000);
}

export const todayISO = () => toISODate(new Date());

// "Tue 13 Oct"
export function dayLabel(iso) {
  if (!iso) return "no date";
  const d = parseISO(iso);
  return DAY3[d.getDay()] + " " + d.getDate() + " " + MON[d.getMonth()];
}

// Weekday of a date: 0 = Monday ... 6 = Sunday.
export const weekday = (iso) => (parseISO(iso).getDay() + 6) % 7;

// Which days the planner shows (the account's "days" setting), as weekday
// numbers. A day that isn't picked still shows in any week where a job starts
// or ends on it, so nothing is ever hidden.
export const DAY_SETS = { "mon-fri": [0, 1, 2, 3, 4], "mon-sat": [0, 1, 2, 3, 4, 5], "mon-sun": [0, 1, 2, 3, 4, 5, 6] };
export const DEFAULT_DAYS = "mon-sun";
export const shownDays = (setting) => new Set(DAY_SETS[setting] || DAY_SETS[DEFAULT_DAYS]);
const ALL_DAYS = new Set(DAY_SETS["mon-sun"]);

// The date of a board column: week w (0 = this week), day d (0 = Monday).
export function cellDate(w, d) {
  const m = currentMonday();
  m.setDate(m.getDate() + w * 7 + d);
  return toISODate(m);
}

// The days of the four weeks the board covers (days: which weekdays; all seven by default).
export function windowDays(days = ALL_DAYS) {
  const out = [];
  for (let w = 0; w < 4; w++) for (let d = 0; d < 7; d++) if (days.has(d)) out.push({ w, d, date: cellDate(w, d) });
  return out;
}

// The days a job is on the board: [{ w, d, date }]. Its first and last day,
// and the shown days in between, so a Friday-to-Monday job is four days with
// weekends shown and two (Friday, Monday) on a Monday-to-Friday planner.
export function jobCells(job, days = ALL_DAYS) {
  if (!job.date) return [];
  const last = job.end && job.end > job.date ? job.end : job.date;
  const out = [];
  for (let iso = job.date, guard = 0; iso <= last && guard < 400; iso = addDays(iso, 1), guard++) {
    if (iso === job.date || iso === last || days.has(weekday(iso))) out.push({ ...boardPos(iso), date: iso });
  }
  return out;
}

// n shown days on from iso (back, if n is negative), skipping days not shown.
export function addWorkDays(iso, n, days = ALL_DAYS) {
  const step = n < 0 ? -1 : 1;
  let left = Math.abs(n), d = iso;
  for (let guard = 0; left > 0 && guard < 400; guard++) { d = addDays(d, step); if (days.has(weekday(d))) left--; }
  return d;
}

// How many days a job is on the board (1 for a one-day or unscheduled job).
export const jobLength = (job, days) => (job.date ? jobCells(job, days).length : 1);

// The last day of a job that starts on `start` and runs `len` shown days (null for one day).
export const endFor = (start, len, days) => (len > 1 ? addWorkDays(start, len - 1, days) : null);

// Start time "08:30" -> minutes, for ordering a day; no time sorts last.
export function timeKey(t) {
  const m = /^(\d{1,2})[:.]?(\d{2})?/.exec(String(t || "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2] || 0) : 24 * 60 + 1;
}

// A day's jobs in the order they show: a set order first (sort_order, from
// moving a job within the day), then by start time, then by name.
export function sortDay(list) {
  return list.slice().sort((a, b) => {
    const ao = a.order != null, bo = b.order != null;
    if (ao && bo && a.order !== b.order) return a.order - b.order;
    if (ao !== bo) return ao ? -1 : 1;
    const t = timeKey(a.t) - timeKey(b.t);
    if (t) return t;
    return String(a.site || "").localeCompare(String(b.site || ""));
  });
}
