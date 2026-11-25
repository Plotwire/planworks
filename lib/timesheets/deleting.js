// What the boss is told before deleting something in Timesheets (a job, a
// work type, a removed worker's record or one entry), and after. The delete
// itself is in the database (supabase/timesheets-delete.sql). Plain functions
// so tests can run them (tests/timesheets-delete.test.mjs).

import { dayLabel, parseDay } from "./week.js";

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** 2520 -> "42 hours", 510 -> "8 hours 30 minutes", 30 -> "30 minutes". */
export function hoursPhrase(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return plural(m, "minute", "minutes");
  return m ? `${plural(h, "hour", "hours")} ${plural(m, "minute", "minutes")}` : plural(h, "hour", "hours");
}

// "Tue 24 Nov 2026" (the app's own day label, so it reads the same everywhere).
const longDate = (iso) => {
  const d = parseDay(iso);
  return Number.isNaN(d.getTime()) ? String(iso || "") : `${dayLabel(iso)} ${d.getUTCFullYear()}`;
};

/**
 * The warning, from the database's preview ({ entries, minutes, workers,
 * jobs_using }). kind: job | work_type | worker | entry. `name` is the
 * worker's name, for a worker or an entry.
 */
export function deleteWarning(kind, preview, { name = "", date = "" } = {}) {
  const entries = Number(preview?.entries) || 0;
  const hours = hoursPhrase(preview?.minutes);
  const workers = plural(Number(preview?.workers) || 0, "worker", "workers");
  const jobsUsing = Number(preview?.jobs_using) || 0;
  const lines = [];
  if (kind === "job") {
    lines.push(entries
      ? `This job has ${hours} from ${workers}. Deleting it deletes those hours permanently.`
      : "No hours have been recorded against this job.");
  } else if (kind === "work_type") {
    lines.push(entries
      ? `This work type is on ${hours} from ${workers}. Deleting it deletes those hours permanently.`
      : "No hours have been recorded with this work type.");
    if (jobsUsing === 1) lines.push("1 job has it as its default work type; it'll be left with no default.");
    else if (jobsUsing > 1) lines.push(`${jobsUsing} jobs have it as their default work type; they'll be left with no default.`);
  } else if (kind === "worker") {
    lines.push(entries
      ? `${name || "This worker"}'s record has ${hours}. Deleting it deletes those hours permanently.`
      : `${name || "This worker"} has no hours recorded.`);
  } else {
    lines.push(`This deletes ${hours}${date ? ` on ${longDate(date)}` : ""}${name ? ` for ${name}` : ""}, permanently.`);
  }
  lines.push("This can't be undone.");
  return lines;
}

/** The dialog's title. */
export function deleteTitle(kind, label) {
  if (kind === "job") return `Delete job ${label}?`;
  if (kind === "work_type") return `Delete the work type "${label}"?`;
  if (kind === "worker") return `Delete ${label}'s record?`;
  return "Delete this entry?";
}

/** What went wrong, in plain words. */
export function deleteErrorMessage(err) {
  const text = `${err?.message || ""} ${err?.details || ""}`;
  if (/failed to fetch|network|load failed/i.test(text)) return "Couldn't reach Plotwire. Check your connection and try again. Nothing was deleted.";
  if (/TS_DELETE_NOT_REMOVED/.test(text)) return "They're still on your team. Remove them first, then their record can be deleted.";
  if (/TS_DELETE_NOT_FOUND/.test(text)) return "That's already gone. Refresh the page.";
  if (/TS_NO_ADDON/.test(text)) return "Timesheets isn't switched on for this account.";
  return "Couldn't delete it. Nothing was changed.";
}
