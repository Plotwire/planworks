"use client";

/* ============================================================================
 * lib/cad/sketchStore.js - cloud save/load for CAD floor-plan sketches.
 *
 * Mirrors lib/db.js (projects) but against its own public.sketches table, so
 * sketches are fully isolated from the electrical projects schema. Each row is
 * scoped to the signed-in user by Supabase row-level security.
 * ========================================================================= */

import { supabase } from "@/lib/supabase";
import { currentUserId as userIdFromSession } from "../authUser";
import { saveError } from "@/lib/writeErrors";

function client() {
  if (!supabase) throw new Error("Cloud storage isn't configured yet.");
  return supabase;
}

// From the session kept on this device (lib/authUser.js): no round trip,
// and "no signal" rather than "Not signed in" while it can't be renewed.
async function currentUserId() {
  return userIdFromSession(client());
}

// The user_id filters below are a second lock behind RLS (which is the real
// boundary): the client only ever asks for its own rows.

// throwOnError: a list that couldn't be fetched throws instead of looking
// empty (lib/device/sketches.js keeps this device's list then).
export async function listSketches({ throwOnError = false } = {}) {
  if (!supabase) return [];
  try {
    const user_id = await currentUserId();
    if (!user_id) return [];
    const { data, error } = await client()
      .from("sketches")
      .select("id, name, updated_at")
      .eq("user_id", user_id)
      .order("updated_at", { ascending: false });
    if (error) { if (throwOnError) throw error; console.warn("listSketches:", error.message); return []; }
    return (data || []).map((r) => ({ id: r.id, name: r.name, updatedAt: r.updated_at }));
  } catch (e) {
    if (throwOnError) throw e;
    console.warn("listSketches failed:", e.message);
    return [];
  }
}

// One sketch with its name and version, or null if there's no such sketch.
export async function getSketchRecord(id) {
  const user_id = await currentUserId();
  if (!user_id) throw new Error("Not signed in.");
  const { data, error } = await client()
    .from("sketches")
    .select("name, data, updated_at")
    .eq("id", id)
    .eq("user_id", user_id)
    .maybeSingle();
  if (error) throw error;
  return data ? { name: data.name, data: data.data || null, updatedAt: data.updated_at ?? null } : null;
}

export async function getSketchData(id) {
  const user_id = await currentUserId();
  if (!user_id) throw new Error("Not signed in.");
  const { data, error } = await client()
    .from("sketches")
    .select("data")
    .eq("id", id)
    .eq("user_id", user_id)
    .single();
  if (error) throw error;
  return data?.data || null;
}

// id: the new sketch's id, chosen by the app (lib/device/sketches.js), so a
// retried insert can't make a second sketch.
export async function insertSketch(name, data, { id } = {}) {
  const user_id = await currentUserId();
  if (!user_id) throw new Error("Not signed in.");
  const { data: row, error } = await client()
    .from("sketches")
    .insert({ ...(id ? { id } : {}), user_id, name: name || "Untitled sketch", data })
    .select("id")
    .single();
  if (error) throw saveError(error);
  return row.id;
}

export async function updateSketch(id, name, data) {
  const user_id = await currentUserId();
  if (!user_id) throw new Error("Not signed in.");
  const { error } = await client()
    .from("sketches")
    .update({ name, data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user_id);
  if (error) throw saveError(error);
}

export async function deleteSketch(id) {
  const user_id = await currentUserId();
  if (!user_id) throw new Error("Not signed in.");
  const { error } = await client()
    .from("sketches")
    .delete()
    .eq("id", id)
    .eq("user_id", user_id);
  if (error) throw error;
}
