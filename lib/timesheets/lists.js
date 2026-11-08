"use client";

import { supabase } from "@/lib/supabase";

// The owner's Jobs and Work types. The database limits every call here to the
// signed-in account and to accounts with the add-on (supabase/timesheets.sql).
// Nothing is ever deleted: jobs and work types are archived.

const JOB_COLUMNS = "id, job_number, job_name, site_address, default_work_type_id, status";
const TYPE_COLUMNS = "id, name, active, sort_order";

function answer({ data, error }) {
  if (error) throw error;
  return data;
}

export const listJobs = async () =>
  answer(await supabase.from("timesheet_jobs").select(JOB_COLUMNS));

export const addJob = async (ownerId, job) =>
  answer(await supabase.from("timesheet_jobs").insert({ owner_id: ownerId, ...job }).select(JOB_COLUMNS).single());

export const changeJob = async (id, patch) =>
  answer(await supabase.from("timesheet_jobs").update(patch).eq("id", id).select(JOB_COLUMNS).single());

export const listWorkTypes = async () =>
  answer(await supabase.from("timesheet_work_types").select(TYPE_COLUMNS));

export const addWorkType = async (ownerId, name, sortOrder) =>
  answer(await supabase.from("timesheet_work_types").insert({ owner_id: ownerId, name, sort_order: sortOrder }).select(TYPE_COLUMNS).single());

export const changeWorkType = async (id, patch) =>
  answer(await supabase.from("timesheet_work_types").update(patch).eq("id", id).select(TYPE_COLUMNS).single());
