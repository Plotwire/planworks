import "server-only";
import { createHash, randomBytes } from "node:crypto";
import {
  normEmail, cleanNewEmail, emailConfirmed, isConfirmCode, confirmLink, sendAllowed, sendRefusal,
  confirmationEmail, CONFIRM_MESSAGES, LINK_DAYS,
} from "@/lib/emailConfirm";

// Server side of confirming an email address (app/api/account/email,
// app/api/account/confirm-email, and the check in app/api/billing/checkout).
// Rules and wording: lib/emailConfirm.js. Tables: supabase/signup-straight-in.sql
// (server only; the service role reads and writes them).
//
// The emailed link carries a random code; the database only ever holds its
// SHA-256 fingerprint (email_confirm_links.token_hash).
//
// Emails go through Resend (plotwire.uk is verified there), like worker
// invites (lib/timesheets/inviteServer.js):
//   RESEND_API_KEY          needed; without it no link is sent
//   ACCOUNT_EMAIL_ADDRESS   optional sender address (default
//                           accounts@plotwire.uk), shown as "Plotwire"
// Nothing personal is logged.

const RESEND_URL = "https://api.resend.com/emails";
const DEFAULT_ADDRESS = "accounts@plotwire.uk";
const REPLY_TO = "admin@plotwire.uk";
const DAY_MS = 24 * 3600 * 1000;

export const confirmEmailReady = () => Boolean(process.env.RESEND_API_KEY);
export const hashConfirmCode = (code) => createHash("sha256").update(String(code)).digest("hex");

function newConfirmCode() {
  const code = randomBytes(32).toString("base64url");
  return { code, hash: hashConfirmCode(code) };
}

// The account's email_confirmations row: { row } (null when it has none), or
// { failed: true } when the table can't be read (e.g. the SQL isn't run yet).
async function readRow(admin, userId) {
  const { data, error } = await admin.from("email_confirmations")
    .select("email, confirmed_at").eq("user_id", userId).maybeSingle();
  return error ? { failed: true } : { row: data || null };
}

async function writeRow(admin, userId, email, confirmedAt) {
  const { error } = await admin.from("email_confirmations").upsert(
    { user_id: userId, email: normEmail(email), confirmed_at: confirmedAt, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  return !error;
}

/**
 * Is this account's email confirmed? For the check before paying. If
 * Plotwire's record can't be read, Supabase's own record decides
 * (lib/emailConfirm.js emailConfirmed).
 */
export async function isEmailConfirmed(admin, user) {
  const r = await readRow(admin, user.id);
  return emailConfirmed(user, r.failed ? null : r.row);
}

async function sendConfirmEmail({ to, name, link, idempotencyKey }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const address = process.env.ACCOUNT_EMAIL_ADDRESS || DEFAULT_ADDRESS;
  const { subject, text, html } = confirmationEmail({ name, link });
  const body = { from: `Plotwire <${address}>`, to: [to], reply_to: REPLY_TO, subject, text, html };
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(RESEND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `plotwire-confirm-${idempotencyKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) return true;
      console.error("[account/email] Resend answered", res.status);
      if (res.status !== 429 && res.status < 500) return false;
    } catch (e) {
      console.error("[account/email] couldn't reach Resend:", e?.name || "error");
    }
    if (attempt === 1) await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

// When this account's links were sent in the last day (for the limits).
async function recentSends(admin, userId) {
  const { data, error } = await admin.from("email_confirm_links")
    .select("created_at").eq("user_id", userId)
    .gte("created_at", new Date(Date.now() - DAY_MS).toISOString());
  return error ? null : (data || []).map((r) => r.created_at);
}

/**
 * Send a new link to the account's current address, within the limits (one a
 * minute, LINKS_PER_DAY a day). { ok, sentAt } or { error, status,
 * retryAfterSec? }.
 */
export async function sendConfirmLink(admin, user, origin) {
  if (!confirmEmailReady()) return { error: CONFIRM_MESSAGES.NO_EMAIL, status: 503 };
  const sent = await recentSends(admin, user.id);
  if (!sent) return { error: CONFIRM_MESSAGES.FAILED, status: 500 };
  const verdict = sendAllowed(sent);
  if (!verdict.ok) return { error: sendRefusal(verdict), status: 429, retryAfterSec: verdict.retryAfterSec };

  const now = new Date();
  const { code, hash } = newConfirmCode();
  const { error } = await admin.from("email_confirm_links").insert({
    token_hash: hash, user_id: user.id, email: normEmail(user.email),
    created_at: now.toISOString(), expires_at: new Date(now.getTime() + LINK_DAYS * DAY_MS).toISOString(),
  });
  if (error) return { error: CONFIRM_MESSAGES.FAILED, status: 500 };
  // Tidy: this account's links that have run out.
  await admin.from("email_confirm_links").delete().eq("user_id", user.id).lt("expires_at", now.toISOString());

  const ok = await sendConfirmEmail({
    to: user.email,
    name: user.user_metadata?.name,
    link: confirmLink(origin, code),
    idempotencyKey: hash.slice(0, 32),
  });
  if (!ok) return { error: CONFIRM_MESSAGES.EMAIL_FAILED, status: 502 };
  return { ok: true, sentAt: now.toISOString() };
}

/**
 * Where this account stands: { confirmed, email, sentAt?, sendError? }.
 * An account that isn't confirmed gets its row (if it has none, or it's for an
 * old address) and, the first time, its first link: so "we've sent a link"
 * is true by the time the note says it.
 */
export async function emailStatus(admin, user, origin) {
  const email = user.email || "";
  const r = await readRow(admin, user.id);
  // Plotwire's record can't be read (not set up yet): nothing to show.
  if (r.failed) return { confirmed: emailConfirmed(user, null), email, unavailable: true };
  if (emailConfirmed(user, r.row)) return { confirmed: true, email };

  if (!r.row || normEmail(r.row.email) !== normEmail(email) || r.row.confirmed_at) {
    if (!(await writeRow(admin, user.id, email, null))) return { confirmed: false, email, sendError: CONFIRM_MESSAGES.FAILED };
  }
  const lastSent = async () => {
    const { data } = await admin.from("email_confirm_links")
      .select("created_at").eq("user_id", user.id).eq("email", normEmail(email))
      .order("created_at", { ascending: false }).limit(1);
    return data?.[0]?.created_at || null;
  };
  let sentAt = await lastSent(), sendError = null;
  if (!sentAt) {
    const s = await sendConfirmLink(admin, user, origin);
    if (s.ok) sentAt = s.sentAt;
    // Two checks at once (two tabs): the other one has just sent it.
    else if (s.status === 429) sentAt = await lastSent();
    if (!sentAt) sendError = s.error;
  }
  return { confirmed: false, email, sentAt, sendError };
}

/**
 * "Change email", for an account that hasn't confirmed yet (a typo at
 * sign-up): the sign-in address changes straight away, and a link goes to
 * the new one. { ok, email, sentAt?, sendError? } or { error, status }.
 */
export async function changeAccountEmail(admin, user, newEmail, origin) {
  const r = await readRow(admin, user.id);
  if (r.failed) return { error: CONFIRM_MESSAGES.FAILED, status: 503 };
  if (emailConfirmed(user, r.row)) return { error: CONFIRM_MESSAGES.CHANGE_NOT_ALLOWED, status: 409 };
  const clean = cleanNewEmail(newEmail, user.email);
  if (clean.error) return { error: clean.error, status: 400 };
  // Each change sends a link, so the same limits apply before anything changes.
  const sent = await recentSends(admin, user.id);
  if (!sent) return { error: CONFIRM_MESSAGES.FAILED, status: 500 };
  const verdict = sendAllowed(sent);
  if (!verdict.ok) return { error: sendRefusal(verdict), status: 429, retryAfterSec: verdict.retryAfterSec };

  // email_confirm: Supabase must still let them sign in with the new address;
  // Plotwire's own record (below) is what says it isn't confirmed.
  const { error } = await admin.auth.admin.updateUserById(user.id, { email: clean.value, email_confirm: true });
  if (error) {
    const taken = /already|exists|registered/i.test(error.message || "") || error.status === 422;
    return { error: taken ? CONFIRM_MESSAGES.EMAIL_TAKEN : CONFIRM_MESSAGES.FAILED, status: taken ? 409 : 500 };
  }
  if (!(await writeRow(admin, user.id, clean.value, null))) return { error: CONFIRM_MESSAGES.FAILED, status: 500 };
  const s = await sendConfirmLink(admin, { ...user, email: clean.value }, origin);
  return s.ok ? { ok: true, email: clean.value, sentAt: s.sentAt } : { ok: true, email: clean.value, sendError: s.error };
}

/**
 * The emailed link, opened in any browser (no sign-in needed). Returns the
 * page's state: confirmed | already | expired | changed | invalid | failed.
 */
export async function confirmByCode(admin, code) {
  if (!isConfirmCode(code)) return "invalid";
  const { data: link, error } = await admin.from("email_confirm_links")
    .select("user_id, email, expires_at").eq("token_hash", hashConfirmCode(code)).maybeSingle();
  if (error) return "failed";
  if (!link) return "invalid";
  const { data: found, error: userError } = await admin.auth.admin.getUserById(link.user_id);
  if (userError || !found?.user) return "invalid";
  const current = normEmail(found.user.email);
  if (current !== normEmail(link.email)) return "changed";
  const r = await readRow(admin, link.user_id);
  if (r.failed) return "failed";
  if (r.row && r.row.confirmed_at && normEmail(r.row.email) === current) return "already";
  if (new Date(link.expires_at).getTime() < Date.now()) return "expired";
  return (await writeRow(admin, link.user_id, current, new Date().toISOString())) ? "confirmed" : "failed";
}
