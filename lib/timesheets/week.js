// Timesheets week maths: dates, hours, totals and the checks before saving an
// entry. Dates are "YYYY-MM-DD" strings: UK days, as the database gives them
// (timesheets_context's today and week_start come from the database clock, so
// a phone with the wrong date can't move a week). Hours only: no pay, cost
// or profit sums anywhere.
//
// Plain functions so tests can run them (tests/timesheets-week.test.mjs).

export const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const DAY_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The database's limits (supabase/timesheets.sql, supabase/timesheets-week.sql).
export const NOTE_LIMIT = 150;

const pad = (n) => String(n).padStart(2, "0");

/** "2026-11-23" -> a Date at midnight UTC (no time-zone surprises). */
export function parseDay(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function dayOf(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function addDays(iso, n) {
  const d = parseDay(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return dayOf(d);
}

/** The Monday of the week a day falls in. */
export function mondayOf(iso) {
  const d = parseDay(iso);
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
}

/** Monday to Sunday of the week starting on `monday`. */
export function weekDays(monday) {
  return [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(monday, i));
}

/** "Mon 23 Nov" */
export function dayLabel(iso) {
  const d = parseDay(iso);
  return `${DAY_SHORT[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "23 – 29 Nov 2026", "30 Nov – 6 Dec 2026", "29 Dec 2025 – 4 Jan 2026" */
export function weekLabel(monday) {
  const a = parseDay(monday);
  const b = parseDay(addDays(monday, 6));
  const am = MONTHS[a.getUTCMonth()], bm = MONTHS[b.getUTCMonth()];
  const ay = a.getUTCFullYear(), by = b.getUTCFullYear();
  if (ay !== by) return `${a.getUTCDate()} ${am} ${ay} – ${b.getUTCDate()} ${bm} ${by}`;
  if (am !== bm) return `${a.getUTCDate()} ${am} – ${b.getUTCDate()} ${bm} ${by}`;
  return `${a.getUTCDate()} – ${b.getUTCDate()} ${bm} ${by}`;
}

/** "07:30" (or "07:30:00" from the database) -> 450 minutes; null if not a time. */
export function toMinutes(time) {
  const m = /^(\d{1,2}):(\d{2})(?::00)?$/.exec(String(time ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** "07:30:00" -> "07:30" (what a time box shows). */
export const hhmm = (time) => (time ? String(time).slice(0, 5) : "");

/** Minutes worked from start to finish; null unless finish is after start. */
export function minutesBetween(start, finish) {
  const a = toMinutes(start), b = toMinutes(finish);
  if (a == null || b == null || b <= a) return null;
  return b - a;
}

/** 510 -> "8h 30m", 480 -> "8h", 30 -> "30m", 0 -> "0h". */
export function formatHours(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(total / 60), m = total % 60;
  if (!h && !m) return "0h";
  if (!m) return `${h}h`;
  if (!h) return `${m}m`;
  return `${h}h ${m}m`;
}

/** 510 -> "8.50" (for spreadsheets). */
export const decimalHours = (minutes) => ((Number(minutes) || 0) / 60).toFixed(2);

/** "001 – Smith, Driffield" */
export const jobLabel = (job) => {
  if (!job) return "";
  if (job.job_number) return `${job.job_number} – ${job.job_name}`;
  // An older "Other" entry (no job) keeps what it was for in its note.
  if (!job.job_id && job.other_note) return `${job.job_name || "Other"} – ${job.other_note}`;
  return job.job_name || "";
};

/**
 * The job dropdown's value for an older entry that has no job ("Other").
 * Workers can't pick it for new hours; it only keeps such an entry as it was.
 */
export const OTHER_JOB = "other";

/**
 * Totals for a list of entries: the week, each day, and each job.
 * byJob is sorted by job number (001 before 002, 2 before 10).
 */
export function totals(entries) {
  const byDay = {};
  const jobs = new Map();
  let week = 0;
  for (const e of entries || []) {
    const mins = Number(e.minutes) || 0;
    week += mins;
    byDay[e.work_date] = (byDay[e.work_date] || 0) + mins;
    const key = e.job_id || `other:${e.job_name}`;
    const j = jobs.get(key) || { key, job_number: e.job_number || "", job_name: e.job_name || "", minutes: 0 };
    j.minutes += mins;
    jobs.set(key, j);
  }
  const byJob = [...jobs.values()].sort((a, b) =>
    a.job_number.localeCompare(b.job_number, "en", { numeric: true, sensitivity: "base" })
    || a.job_name.localeCompare(b.job_name, "en"));
  return { week, byDay, byJob };
}

/**
 * What a worker may do on a day of the week shown:
 *   "open"    add, change and remove entries
 *   "future"  not yet (no future dates)
 *   "locked"  the week has been submitted
 *   "closed"  too long ago, and the boss hasn't reopened the week
 * Mirrors the database rule (ts_may_write), which decides in the end.
 */
export function dayState({ date, today, earliest, weekStatus }) {
  if (date > today) return "future";
  if (weekStatus === "submitted") return "locked";
  if (date < earliest && weekStatus !== "reopened") return "closed";
  return "open";
}

/** Can this week be submitted? Not a week that hasn't started, nor one already in. */
export const canSubmitWeek = ({ monday, thisMonday, weekStatus }) =>
  monday <= thisMonday && weekStatus !== "submitted";

/**
 * An entry ready to save, or what to fix:
 *   { value: { job_id, work_type_id, start_time, finish_time, description } }
 *   { error: "..." }
 * The note is optional: empty becomes null.
 */
export function cleanEntry(form) {
  const job_id = form?.job_id || null;
  const work_type_id = form?.work_type_id || null;
  const start = toMinutes(form?.start_time);
  const finish = toMinutes(form?.finish_time);
  const note = String(form?.description ?? "").replace(/\s+/g, " ").trim();
  // Older entries may have a break taken off; it stays as it is.
  const breakMins = Math.max(0, Number(form?.break_minutes) || 0);
  if (!job_id) return { error: "Pick a job." };
  if (!work_type_id) return { error: "Pick a work type." };
  if (start == null) return { error: "Set a start time." };
  if (finish == null) return { error: "Set a finish time." };
  if (finish <= start) return { error: "Finish must be after start. Past midnight? Put the rest on the next day." };
  if (finish - start <= breakMins) return { error: `This entry has a ${breakMins}-minute break, so it needs to be longer than that.` };
  if (note.length > NOTE_LIMIT) return { error: `Notes can be up to ${NOTE_LIMIT} characters.` };
  return {
    value: {
      job_id: job_id === OTHER_JOB ? null : job_id,
      work_type_id,
      start_time: `${pad(Math.floor(start / 60))}:${pad(start % 60)}`,
      finish_time: `${pad(Math.floor(finish / 60))}:${pad(finish % 60)}`,
      description: note || null,
    },
  };
}

/**
 * Starting values for a new entry on a day, so most days are one tap:
 *   - the first entry of a day copies the latest earlier day's first job,
 *     work type and times this week (or 08:00 to 16:30);
 *   - another entry on the same day starts when the last one finished, on
 *     the same work type, with the job left to pick (it's a different site).
 * A job's own default work type wins when it has one.
 */
export function newEntryDefaults({ date, entries, jobs, types }) {
  // A work type that's since been archived isn't copied (it can't be picked).
  const live = (id) => (id && (!types || types.some((t) => t.id === id)) ? id : "");
  const sameDay = (entries || []).filter((e) => e.work_date === date)
    .sort((a, b) => hhmm(a.start_time).localeCompare(hhmm(b.start_time)));
  if (sameDay.length) {
    const last = sameDay[sameDay.length - 1];
    return { job_id: "", work_type_id: live(last.work_type_id), start_time: hhmm(last.finish_time), finish_time: "", description: "" };
  }
  const earlier = (entries || []).filter((e) => e.work_date < date)
    .sort((a, b) => b.work_date.localeCompare(a.work_date) || hhmm(a.start_time).localeCompare(hhmm(b.start_time)));
  if (earlier.length) {
    const day = earlier[0].work_date;
    const that = earlier.filter((e) => e.work_date === day);
    const first = that[0];
    const lastFinish = that.reduce((most, e) => (hhmm(e.finish_time) > most ? hhmm(e.finish_time) : most), "");
    const job = (jobs || []).find((j) => j.id === first.job_id);
    return {
      job_id: job ? job.id : "",
      work_type_id: live((job && job.default_work_type_id) || first.work_type_id),
      start_time: hhmm(first.start_time),
      finish_time: lastFinish,
      description: "",
    };
  }
  return { job_id: "", work_type_id: "", start_time: "08:00", finish_time: "16:30", description: "" };
}
