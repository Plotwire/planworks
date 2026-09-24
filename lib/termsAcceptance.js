"use client";

/* ============================================================================
 * Terms acceptance records (public.terms_acceptances, supabase/terms-acceptance.sql)
 * ----------------------------------------------------------------------------
 * Nobody gets into the app without a row for the current LEGAL_VERSION
 * (lib/legal.js). AppShell checks after sign-in and, if there is none, shows
 * the acceptance page (components/TermsGate.jsx) before anything else,
 * including the paywall.
 *
 * Sign-up: the form asks for both acknowledgements, but with email
 * confirmation on there is no session yet, so nothing can be written to the
 * table (RLS needs a signed-in user). The acceptance therefore travels in the
 * new account's sign-up metadata (auth user_metadata, see signupTermsMetadata)
 * and is written as a row on the first sign-in, before the app opens. If that
 * write fails the user sees the acceptance page instead -- never the app.
 * ========================================================================== */

import { supabase } from "@/lib/supabase";
import { LEGAL_VERSION } from "@/lib/legal";

// True if this user has accepted the current version. Throws if the check
// itself fails, so the caller can keep the user on the acceptance page.
export async function hasAcceptedCurrentTerms(userId) {
  const { data, error } = await supabase
    .from("terms_acceptances")
    .select("id")
    .eq("user_id", userId)
    .eq("legal_version", LEGAL_VERSION)
    .limit(1);
  if (error) throw error;
  return data.length > 0;
}

// Record acceptance of the current version. A row that already exists (a
// second tab, a double click) counts as success; any other failure throws.
export async function recordTermsAcceptance(userId) {
  const { error } = await supabase.from("terms_acceptances").insert({
    user_id: userId,
    legal_version: LEGAL_VERSION,
    acknowledged_not_design: true,
    user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
  });
  if (error && error.code !== "23505") throw error; // 23505: already recorded
}

// Stored on a new account by the sign-up form (both boxes ticked). The time
// here is when they ticked; the table row's accepted_at is when it is written.
export function signupTermsMetadata() {
  return {
    terms_version: LEGAL_VERSION,
    terms_acknowledged_not_design: true,
    terms_accepted_at: new Date().toISOString(),
  };
}

// Did this user accept the current version on the sign-up form?
export function acceptedAtSignup(user) {
  const m = user?.user_metadata || {};
  return m.terms_version === LEGAL_VERSION && m.terms_acknowledged_not_design === true;
}
