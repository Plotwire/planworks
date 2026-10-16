"use client";

/* ============================================================================
 * Company profile — the account's own business details.
 * ----------------------------------------------------------------------------
 * One row per user in public.company_profile, one private logo per user in the
 * company-logos bucket. Both are locked to the owning account by RLS at the
 * database level (see supabase/company-profile-setup.sql) — the user_id set
 * here is for addressing the right row, NOT the security boundary. Even a
 * tampered client can only ever read or write its own row.
 *
 * The logo lives in Storage and the row keeps only its path, so the profile
 * row stays tiny and the bytes are streamed (and cached) by the browser.
 * ========================================================================= */

import { supabase } from "./supabase";
import { currentUserId as userIdFromSession } from "./authUser";
import { resizeImageToDataUrl } from "./titleBlock";

export const LOGO_BUCKET = "company-logos";

// Signed-URL lifetime for displaying the logo. Re-minted every time the screen
// opens, so expiry never bites mid-edit.
const SIGN_TTL = 60 * 60 * 8; // 8 hours

function client() {
  if (!supabase) throw new Error("Cloud storage isn't configured yet.");
  return supabase;
}

// From the session kept on this device (lib/authUser.js): no round trip,
// and "no signal" rather than "Not signed in" while it can't be renewed.
async function currentUserId() {
  return userIdFromSession(client());
}

const uuid = () =>
  (crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);

// The columns the app reads. logo_data_url is a small cached copy of the logo
// used for rendering (see companyProfileToTitleBlock); logo_path remains the
// authoritative pointer into the private bucket. Older databases predate the
// cache column, so every query falls back to the set without it.
// Tried in order, widest first. Each step drops the newest column, so a
// database that hasn't run the latest migration still returns everything it
// does have rather than failing outright.
const COLUMN_SETS = [
  "company_name, address, phone, email, website, company_reg, logo_path, logo_data_url",
  "company_name, address, phone, email, website, logo_path, logo_data_url",
  "company_name, address, phone, email, website, logo_path",
];

export const EMPTY_PROFILE = {
  company_name: "",
  address: "",
  phone: "",
  email: "",
  website: "",
  company_reg: "",
  logo_path: null,
  logo_data_url: null,
};

/** The signed-in user's profile, or EMPTY_PROFILE if they've never saved one. */
export async function getCompanyProfile() {
  const user_id = await currentUserId();
  if (!user_id) throw new Error("You're not signed in.");
  const cl = client();
  let data = null, error = null;
  for (const columns of COLUMN_SETS) {
    ({ data, error } = await cl
      .from("company_profile").select(columns).eq("user_id", user_id).maybeSingle());
    if (!error) break;
    console.warn("getCompanyProfile: retrying with fewer columns:", error.message);
  }
  if (error) throw error;
  return backfillLogoDataUrl({ ...EMPTY_PROFILE, ...(data || {}) }, user_id);
}

/**
 * One-time repair for logos uploaded before logo_data_url existed.
 *
 * Those rows have logo_path set and logo_data_url null, so
 * companyProfileToTitleBlock finds no data-URI and the account's logo simply
 * never appears on their drawings. Re-uploading fixes it, but nobody should
 * have to work that out, so the first profile load repairs it silently.
 *
 * The image is fetched to a BLOB first and only then turned into a data-URI.
 * That matters: the canvas inside resizeImageToDataUrl is fed a data: source,
 * so it is never tainted by the remote origin, which is the whole reason the
 * signed URL cannot be handed to the renderer directly.
 *
 * Entirely best-effort. Any failure -- offline, expired link, column missing,
 * no DOM -- leaves the row exactly as it was and returns the profile unchanged.
 * Loading a profile must never fail because a logo could not be repaired.
 */
async function backfillLogoDataUrl(profile, user_id) {
  if (typeof window === "undefined") return profile;
  if (!profile.logo_path || profile.logo_data_url) return profile;
  try {
    const url = await signCompanyLogo(profile.logo_path);
    if (!url) return profile;
    const res = await fetch(url);
    if (!res.ok) return profile;
    const dataUrl = await resizeImageToDataUrl(await res.blob(), 260);
    if (!dataUrl) return profile;
    const { error } = await client()
      .from("company_profile")
      .update({ logo_data_url: dataUrl })
      .eq("user_id", user_id);
    if (error) {
      console.warn("logo backfill: could not save the cached logo:", error.message);
      // Still hand it back -- this load renders correctly even if the write
      // failed, and the next load will simply try again.
    }
    return { ...profile, logo_data_url: dataUrl };
  } catch (err) {
    console.warn("logo backfill skipped:", err && err.message);
    return profile;
  }
}

/**
 * Whether this account has a company_profile row at all. Deliberately separate
 * from getCompanyProfile(), which can't tell "never filled in" from "filled in
 * with blanks" -- onboarding must only ever trigger on the former.
 *
 * Fails SAFE: any error (not signed in, table missing because the setup SQL
 * hasn't been run) reports true, so a problem here can never trap someone on
 * an onboarding screen or nag them on every login.
 */
export async function hasCompanyProfile() {
  try {
    const user_id = await currentUserId();
    if (!user_id) return true;
    const { data, error } = await client()
      .from("company_profile")
      .select("user_id")
      .eq("user_id", user_id)
      .maybeSingle();
    if (error) { console.warn("hasCompanyProfile:", error.message); return true; }
    return Boolean(data);
  } catch (err) {
    console.warn("hasCompanyProfile failed:", err && err.message);
    return true;
  }
}

/**
 * Write the profile. Upserts on user_id, so the first save creates the row and
 * every later one updates it — there is never a second row for an account.
 * Only the known columns are sent; anything else on the object is ignored.
 */
export async function saveCompanyProfile(profile) {
  const user_id = await currentUserId();
  if (!user_id) throw new Error("You're not signed in.");
  const row = {
    user_id,
    company_name: profile.company_name?.trim() || null,
    address: profile.address?.trim() || null,
    phone: profile.phone?.trim() || null,
    email: profile.email?.trim() || null,
    website: profile.website?.trim() || null,
    company_reg: profile.company_reg?.trim() || null,
    logo_path: profile.logo_path || null,
    logo_data_url: profile.logo_data_url || null,
    updated_at: new Date().toISOString(),
  };
  const cl = client();
  // Mirrors the read ladder: drop the newest column and try again, so a save
  // still lands everything the database does have rather than failing outright.
  let { error } = await cl.from("company_profile").upsert(row, { onConflict: "user_id" });
  for (const drop of ["company_reg", "logo_data_url"]) {
    if (!error) break;
    console.warn("saveCompanyProfile: retrying without", drop + ":", error.message);
    delete row[drop];
    ({ error } = await cl.from("company_profile").upsert(row, { onConflict: "user_id" }));
  }
  if (error) throw error;
}

/**
 * Put a logo in the private bucket under this user's own folder and return its
 * path. The "<uid>/" prefix is what the storage policies check, so a file can
 * only ever be written into the caller's own folder.
 */
export async function uploadCompanyLogo(blob) {
  const uid = await currentUserId();
  if (!uid) throw new Error("You're not signed in.");
  const path = `${uid}/${uuid()}.png`;
  const { error } = await client()
    .storage
    .from(LOGO_BUCKET)
    .upload(path, blob, { contentType: blob.type || "image/png", cacheControl: "3600", upsert: false });
  if (error) throw error;
  return path;
}

/** A short-lived URL for showing a stored logo. Null if it can't be signed. */
export async function signCompanyLogo(path) {
  if (!path) return null;
  try {
    const { data, error } = await client()
      .storage
      .from(LOGO_BUCKET)
      .createSignedUrl(path, SIGN_TTL);
    if (error) return null;
    return data?.signedUrl || null;
  } catch {
    return null;
  }
}
