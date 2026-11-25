// The worker privacy notice (Joe's wording, 25 Nov 2026). Shown once to each
// worker the first time they sign in, with "I understand"; the version they
// saw is recorded on their team record (timesheet_activate). Viewable again
// from the "Privacy" link on their week screen.
//
// Changing the wording? Change NOTICE_VERSION too, and every worker sees the
// new notice once at their next sign-in.
//
// Plain functions so tests can run them (tests/timesheets-invites.test.mjs).

export const NOTICE_VERSION = "2026-11-25";

/**
 * The notice with the company's name filled in (from the boss's business
 * details). With no name on record it says "your employer".
 */
export function noticeText(company) {
  const name = String(company || "").trim();
  const Start = name || "Your employer";
  const mid = name || "your employer";
  return `${Start} uses Plotwire to record the hours you work and the jobs you work on. `
    + "This is used to manage jobs, check hours and for payroll. "
    + `Only ${mid} can see your timesheets; other workers can't. `
    + `Plotwire stores the information securely for ${mid}. `
    + "Records are kept for up to 6 years for payroll and tax purposes. "
    + `You can ask ${mid} for a copy of your records, or to correct them, at any time.`;
}

/** Should this worker see the notice before their week? */
export function needsNotice(ctx) {
  return Boolean(
    ctx && ctx.role === "operative" && ctx.addon
    && (ctx.status === "invited" || ctx.status === "active")
    && ctx.notice_version !== NOTICE_VERSION,
  );
}
