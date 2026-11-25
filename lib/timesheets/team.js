"use client";

import { supabase } from "@/lib/supabase";

// The boss's team actions and the invite page's calls, through Plotwire's
// server (app/api/timesheets/team, app/api/timesheets/join). Nothing here
// reads or writes the database directly.

async function post(path, body, withSignIn) {
  const headers = { "Content-Type": "application/json" };
  if (withSignIn) {
    const { data } = (await supabase?.auth.getSession()) || {};
    const token = data?.session?.access_token;
    if (!token) throw Object.assign(new Error("Please sign in again."), { status: 401 });
    headers.Authorization = `Bearer ${token}`;
  }
  let res;
  try {
    res = await fetch(path, { method: "POST", headers, body: JSON.stringify(body) });
  } catch {
    throw Object.assign(new Error("Couldn't reach Plotwire. Check your connection and try again."), { network: true });
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || "Something went wrong. Nothing was changed."), { status: res.status, body: json });
  return json;
}

const team = (body) => post("/api/timesheets/team", body, true);
export const inviteWorker = (name, email) => team({ action: "invite", name, email });
export const resendInvite = (operativeId) => team({ action: "resend", operativeId });
export const cancelInvite = (operativeId) => team({ action: "cancel", operativeId });
export const removeWorker = (operativeId) => team({ action: "remove", operativeId });

const join = (body) => post("/api/timesheets/join", body, false);
export const checkInvite = (invite) => join({ action: "check", invite });
export const acceptInvite = (invite) => join({ action: "accept", invite });
