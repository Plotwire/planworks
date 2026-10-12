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

// The date of a board column: week w (0 = this week), day d (0 = Monday).
export function cellDate(w, d) {
  const m = currentMonday();
  m.setDate(m.getDate() + w * 7 + d);
  return toISODate(m);
}

// Every day the board shows: four weeks of Monday to Saturday.
export function windowDays() {
  const out = [];
  for (let w = 0; w < 4; w++) for (let d = 0; d < 6; d++) out.push({ w, d, date: cellDate(w, d) });
  return out;
}

// The board cells a job covers: [{ w, d }], one per day it runs (a Sunday
// shows on the Saturday, so it isn't listed twice). A one-day job has one.
export function jobCells(job) {
  if (!job.date) return [];
  const last = job.end && job.end > job.date ? job.end : job.date;
  const out = [];
  const seen = new Set();
  for (let iso = job.date, guard = 0; iso <= last && guard < 120; iso = addDays(iso, 1), guard++) {
    const p = boardPos(iso);
    const k = p.w + ":" + p.d;
    if (!seen.has(k)) { seen.add(k); out.push({ ...p, date: iso }); }
  }
  return out;
}

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
