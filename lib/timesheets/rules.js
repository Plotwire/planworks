// The rules for the owner's Jobs and Work types lists. The limits match
// supabase/timesheets.sql: the database enforces them whatever happens here,
// and these give a clear message first.

export const LIMITS = { jobNumber: 30, jobName: 120, siteAddress: 200, workType: 40 };

const text = (v) => String(v ?? "").trim();

// { value } ready to save, or { error } saying what to fix.
export function cleanJob(form) {
  const job_number = text(form?.job_number);
  const job_name = text(form?.job_name);
  const site_address = text(form?.site_address);
  const default_work_type_id = form?.default_work_type_id || null;
  if (!job_number) return { error: "Enter a job number." };
  if (job_number.length > LIMITS.jobNumber) return { error: `Job numbers can be up to ${LIMITS.jobNumber} characters.` };
  if (!job_name) return { error: "Enter a job name." };
  if (job_name.length > LIMITS.jobName) return { error: `Job names can be up to ${LIMITS.jobName} characters.` };
  if (site_address.length > LIMITS.siteAddress) return { error: `Site addresses can be up to ${LIMITS.siteAddress} characters.` };
  return { value: { job_number, job_name, site_address: site_address || null, default_work_type_id } };
}

export function cleanWorkTypeName(name) {
  const value = text(name);
  if (!value) return { error: "Enter a name for the work type." };
  if (value.length > LIMITS.workType) return { error: `Work type names can be up to ${LIMITS.workType} characters.` };
  return { value };
}

// 2 before 10, and 001 before 002.
export const byJobNumber = (a, b) =>
  a.job_number.localeCompare(b.job_number, "en", { numeric: true, sensitivity: "base" });

export const byWorkTypeOrder = (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "en");

// Where a new work type goes: after the last one.
export const nextSortOrder = (types) => types.reduce((most, t) => Math.max(most, t.sort_order), 0) + 1;

// What to tell the owner when a save was refused.
export function saveErrorMessage(err, duplicateMessage) {
  if (err?.code === "23505") return duplicateMessage;
  if (err?.code === "42501") return "Timesheets isn't switched on for this account.";
  if (/failed to fetch|network|load failed/i.test(String(err?.message || ""))) {
    return "Couldn't save. Check your connection and try again.";
  }
  return "Couldn't save. Nothing was changed.";
}
