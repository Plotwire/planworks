"use client";

/* ============================================================================
 * lib/cad/sketchStore.js - cloud save/load for CAD floor-plan sketches.
 *
 * Mirrors lib/db.js (projects) but against its own public.sketches table, so
 * sketches are fully isolated from the electrical projects schema. Each row is
 * scoped to the signed-in user by Supabase row-level security.
 * ========================================================================= */

import { supabase } from "@/lib/supabase";
import { saveError } from "@/lib/writeErrors";

function client() {
  if (!supabase) throw new Error("Cloud storage isn't configured yet.");
  return supabase;
}

async function currentUserId() {
  const { data } = await client().auth.getUser();
  return data?.user?.id || null;
}

// The user_id filters below are a second lock behind RLS (which is the real
// boundary): the client only ever asks for its own rows.

export async function listSketches() {
  if (!supabase) return [];
  try {
    const user_id = await currentUserId();
    if (!user_id) return [];
    const { data, error } = await client()
      .from("sketches")
      .select("id, name, updated_at")
      .eq("user_id", user_id)
      .order("updated_at", { ascending: false });
    if (error) { console.warn("listSketches:", error.message); return []; }
    return (data || []).map((r) => ({ id: r.id, name: r.name, updatedAt: r.updated_at }));
  } catch (e) {
    console.warn("listSketches failed:", e.message);
    return [];
  }
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

export async function insertSketch(name, data) {
  const user_id = await currentUserId();
  if (!user_id) throw new Error("Not signed in.");
  const { data: row, error } = await client()
    .from("sketches")
    .insert({ user_id, name: name || "Untitled sketch", data })
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
