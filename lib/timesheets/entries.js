"use client";

import { supabase } from "@/lib/supabase";

// Timesheet entries and weeks. The database decides who sees and changes what
// (supabase/timesheets.sql, supabase/timesheets-week.sql): a worker only ever
// gets their own entries and weeks; the owner gets their team's. Nothing here
// widens that, and no call reads anything outside Timesheets.

const ENTRY_COLUMNS =
  "id, operative_id, work_date, job_id, job_number, job_name, work_type_id, work_type, " +
  "start_time, finish_time, break_minutes, minutes, description, other_note";
const WEEK_COLUMNS = "operative_id, week_start, status, submitted_at, reopened_at";
const PAGE = 1000;

function answer({ data, error }) {
  if (error) throw error;
  return data;
}

// Who is signed in, as far as Timesheets goes: role, name, company, and the
// database's today / Monday / earliest open date.
export const getContext = async () => answer(await supabase.rpc("timesheets_context"));

// A worker's drop-downs: their firm's active jobs and work types.
export const getPickLists = async () => answer(await supabase.rpc("timesheets_pick_lists"));

// Entries from one date to another (both included), oldest first. Read in
// pages so a long export never stops at the first thousand rows.
export async function listEntries(from, to) {
  const all = [];
  for (let start = 0; ; start += PAGE) {
    const rows = answer(await supabase.from("timesheet_entries").select(ENTRY_COLUMNS)
      .gte("work_date", from).lte("work_date", to)
      .order("work_date").order("start_time").order("id")
      .range(start, start + PAGE - 1));
    all.push(...rows);
    if (rows.length < PAGE) return all;
  }
}

// A worker's new entry. The database fills in who it belongs to, copies the
// job and work type names, and works out the minutes.
export const addEntry = async (date, value) =>
  answer(await supabase.from("timesheet_entries")
    .insert({ work_date: date, break_minutes: 0, ...value })
    .select(ENTRY_COLUMNS).single());

export const changeEntry = async (id, value) =>
  answer(await supabase.from("timesheet_entries").update(value).eq("id", id)
    .select(ENTRY_COLUMNS).single());

export async function removeEntry(id) {
  const rows = answer(await supabase.from("timesheet_entries").delete().eq("id", id).select("id"));
  if (!rows.length) throw Object.assign(new Error("not removed"), { code: "TS_NOT_REMOVED" });
}

// Submitted (or reopened) weeks starting from one Monday to another.
export const listWeeks = async (fromMonday, toMonday) =>
  answer(await supabase.from("timesheet_weeks").select(WEEK_COLUMNS)
    .gte("week_start", fromMonday).lte("week_start", toMonday));

export const submitWeek = async (monday) =>
  answer(await supabase.rpc("timesheet_submit_week", { p_week_start: monday }));

export const reopenWeek = async (operativeId, monday) =>
  answer(await supabase.rpc("timesheet_reopen_week", { p_operative: operativeId, p_week_start: monday }));

// The owner's team, removed workers included (their hours keep their name).
// has_login: they've accepted their invite (or were set up by hand).
export const listTeam = async () =>
  answer(await supabase.from("timesheet_operatives").select("id, name, status, email, invited_at, user_id"))
    .map(({ user_id, ...o }) => ({ ...o, has_login: Boolean(user_id) }));

// The boss's deletes (supabase/timesheets-delete.sql). kind: job, work_type,
// worker (a removed worker's record) or entry. The preview changes nothing.
export const previewDelete = async (kind, id) =>
  answer(await supabase.rpc("timesheet_delete_preview", { p_kind: kind, p_id: id }));
export const deleteThing = async (kind, id) =>
  answer(await supabase.rpc("timesheet_delete", { p_kind: kind, p_id: id }));

// Every entry a delete would take (all dates), for "Download Excel first".
const DELETE_COLUMN = { job: "job_id", work_type: "work_type_id", worker: "operative_id", entry: "id" };
export async function listEntriesFor(kind, id) {
  const column = DELETE_COLUMN[kind];
  if (!column) return [];
  const all = [];
  for (let start = 0; ; start += PAGE) {
    const rows = answer(await supabase.from("timesheet_entries").select(ENTRY_COLUMNS)
      .eq(column, id)
      .order("work_date").order("start_time").order("id")
      .range(start, start + PAGE - 1));
    all.push(...rows);
    if (rows.length < PAGE) return all;
  }
}

// A worker has seen the privacy notice (lib/timesheets/notice.js): records
// which version, and finishes setting them up.
export const activateWorker = async (version) =>
  answer(await supabase.rpc("timesheet_activate", { p_notice_version: version }));

// What to tell someone when a save, removal, submit or reopen was refused.
export function entryErrorMessage(err) {
  const text = `${err?.message || ""} ${err?.details || ""}`;
  if (/failed to fetch|network|load failed/i.test(text)) return "Couldn't reach Plotwire. Check your signal and try again.";
  if (/TS_WEEK_NOT_STARTED/.test(text)) return "That week hasn't started yet.";
  if (/TS_WEEK_NOT_SUBMITTED/.test(text)) return "That week isn't submitted, so there's nothing to reopen.";
  if (/TS_JOB_ARCHIVED/.test(text)) return "That job has been archived. Pick another.";
  if (/TS_WORK_TYPE_ARCHIVED/.test(text)) return "That work type has been archived. Pick another.";
  if (/TS_NOT_OPERATIVE|TS_NO_ADDON/.test(text)) return "Timesheets isn't set up for this login.";
  // Refused by the rules (42501), or nothing came back (PGRST116): the day is
  // locked or closed, usually because the week was just submitted.
  if (err?.code === "42501" || err?.code === "PGRST116" || err?.code === "TS_NOT_REMOVED") {
    return "This day can't be changed: the week is submitted or too long ago. Ask your boss to reopen it.";
  }
  if (err?.code === "23514") return "Check the times: finish must be after start.";
  return "Couldn't save. Try again.";
}
