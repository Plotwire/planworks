"use client";

/* ============================================================================
 * Company logos — two roles, not one list
 * ----------------------------------------------------------------------------
 *   kind = 'company'        exactly one. Renders on a white tile inside the
 *                           teal panel, column 1 of the masthead.
 *   kind = 'accreditation'  up to two. Render on white in column 2.
 *
 * Both caps are enforced by the database (see
 * supabase/company-logos-setup.sql), not just here -- one unique index over
 * (user_id, kind, sort_order), with checks pinning company to slot 0 and
 * accreditations to slots 0 and 1.
 *
 * Bytes live in the existing private company-logos bucket; the row keeps the
 * path plus a small downscaled data_url. Rendering ALWAYS uses the data-URI:
 * a signed URL expires and taints the html2canvas canvas the PDF export
 * depends on.
 *
 * FALLBACK: if this table can't be read -- the setup SQL hasn't been run yet,
 * say -- listCompanyLogos falls back to company_profile.logo_path /
 * logo_data_url and reports it as the single company logo, exactly as
 * getCompanyProfile already falls back when logo_data_url is missing. Those
 * columns are still written, so nothing regresses before the migration runs.
 * ========================================================================= */

import { supabase } from "./supabase";
import { currentUserId as userIdFromSession } from "./authUser";
import { uploadCompanyLogo, signCompanyLogo } from "./companyProfile";

export const KIND_COMPANY = "company";
export const KIND_ACCREDITATION = "accreditation";
export const MAX_ACCREDITATIONS = 2;

const COLUMNS = "id, kind, storage_path, data_url, sort_order";

function client() {
  if (!supabase) throw new Error("Cloud storage isn't configured yet.");
  return supabase;
}

// From the session kept on this device (lib/authUser.js): no round trip,
// and "no signal" rather than "Not signed in" while it can't be renewed.
async function currentUserId() {
  return userIdFromSession(client());
}

/** Sorted: the company logo first, then accreditations by slot. */
function order(rows) {
  return [...rows].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === KIND_COMPANY ? -1 : 1;
    return (a.sort_order || 0) - (b.sort_order || 0);
  });
}

/**
 * Every logo for the signed-in account. Never throws for a missing table --
 * the business screen and the title block both need to render regardless.
 */
// strict: a failure to reach the server throws instead of falling back, so
// the device's kept copy is used (components/AppShell.jsx refreshCompany).
export async function listCompanyLogos({ strict = false } = {}) {
  const user_id = await currentUserId();
  if (!user_id) return [];
  try {
    const { data, error } = await client()
      .from("company_logos")
      .select(COLUMNS)
      .eq("user_id", user_id);
    if (error) throw error;
    return order(data || []);
  } catch (err) {
    if (strict && (err?.status === 0 || /failed to fetch|fetch failed|networkerror|load failed|abort|timed? ?out/i.test(String(err?.message || "")))) throw err;
    console.warn("listCompanyLogos: falling back to company_profile:", err && err.message);
    return fallbackFromProfile(user_id);
  }
}

/** The pre-company_logos shape: one logo, on the profile row. */
async function fallbackFromProfile(user_id) {
  try {
    const { data, error } = await client()
      .from("company_profile")
      .select("logo_path, logo_data_url")
      .eq("user_id", user_id)
      .maybeSingle();
    if (error || !data || !data.logo_path) return [];
    return [{
      id: null,               // no row to delete -- the old columns own it
      kind: KIND_COMPANY,
      storage_path: data.logo_path,
      data_url: data.logo_data_url || null,
      sort_order: 0,
      legacy: true,
    }];
  } catch {
    return [];
  }
}

/**
 * Store a logo in the given role. `dataUrl` is already downscaled by the
 * caller, so the bytes uploaded and the bytes rendered are the same image.
 *
 * A company logo REPLACES the existing one (there can only be one), and an
 * accreditation takes the slot it is given. Both are upserts against the
 * database's own uniqueness rules rather than a read-then-write, so two
 * quick clicks can't produce a duplicate.
 */
export async function saveCompanyLogo({ kind, dataUrl, slot = 0 }) {
  const user_id = await currentUserId();
  if (!user_id) throw new Error("You're not signed in.");
  if (kind !== KIND_COMPANY && kind !== KIND_ACCREDITATION) {
    throw new Error("Unknown logo kind: " + kind);
  }
  const sort_order = kind === KIND_COMPANY ? 0 : Math.max(0, Math.min(MAX_ACCREDITATIONS - 1, slot));

  const storage_path = await uploadCompanyLogo(dataUrlToBlobSafe(dataUrl));
  const row = { user_id, kind, storage_path, data_url: dataUrl, sort_order };

  const { data, error } = await client()
    .from("company_logos")
    // One composite index, (user_id, kind, sort_order), covers both roles.
    // It replaced two partial indexes: PostgREST's onConflict takes column
    // names only and cannot supply the WHERE predicate a partial index needs,
    // so every upsert failed to match one.
    .upsert(row, { onConflict: "user_id,kind,sort_order", ignoreDuplicates: false })
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Remove one logo. The stored object is left in the bucket. */
export async function deleteCompanyLogo(id) {
  if (!id) throw new Error("That logo can't be removed yet — save your details first.");
  const user_id = await currentUserId();
  if (!user_id) throw new Error("You're not signed in.");
  const { data, error } = await client()
    .from("company_logos")
    .delete()
    .eq("id", id)
    .eq("user_id", user_id)
    .select("id");
  if (error) throw error;
  if (!data || data.length !== 1) {
    throw new Error("That logo couldn't be removed — it may already be gone.");
  }
}

/** A signed URL, for the rare case a row has a path but no cached data-URI. */
export async function signLogo(path) {
  return signCompanyLogo(path);
}

// Local copy so this module doesn't pull in the plan-image helpers.
function dataUrlToBlobSafe(dataUrl) {
  const [head, b64] = String(dataUrl || "").split(",");
  const type = (head.match(/data:([^;]+)/) || [])[1] || "image/png";
  const bin = atob(b64 || "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
