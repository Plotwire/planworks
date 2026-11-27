// Confirming an email address after sign-up (branch signup-straight-in).
//
// NOT IN USE since remove-email-check (27 Nov 2026): confirmation emails
// didn't reliably arrive and blocked people from paying, so nothing sends
// links or checks them any more; Subscribe goes straight to Stripe. Only
// app/confirm-email/page.jsx still uses this file, so links already sent
// still open. Kept, with the tables, in case it comes back.
//
// People who sign up go straight into Plotwire (Try mode). Their email
// address only has to be confirmed before they subscribe. With Supabase's
// "Confirm email" turned off, Supabase marks every new account confirmed the
// moment it's made, so Plotwire keeps its own record (supabase/
// signup-straight-in.sql: email_confirmations, email_confirm_links) and sends
// its own link, which works in any browser without signing in.
//
// The rules and wording live here, as plain functions, so tests can run them
// (tests/signup-straight-in.test.mjs). The server side is
// lib/emailConfirmServer.js; the screens are components/ConfirmEmailBanner.jsx,
// components/Paywall.jsx and app/confirm-email/page.jsx.

export const CONFIRM_PATH = "/confirm-email";
export const LINK_DAYS = 7;
export const RESEND_WAIT_SECONDS = 60;
export const LINKS_PER_DAY = 10;
// Supabase's own record counts as a real confirmation only when it came at
// least this long after the account was made: someone clicked an emailed
// link (Supabase's "Confirm your email", or a password reset). With "Confirm
// email" off, Supabase marks a new account confirmed in the same instant it
// makes it.
export const SUPABASE_LINK_SECONDS = 10;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const normEmail = (e) => String(e ?? "").trim().toLowerCase();

/** The "Change email" box, tidied: { value } or { error }. */
export function cleanNewEmail(email, current = "") {
  const e = normEmail(email);
  if (e.length > 254 || !EMAIL_RE.test(e)) return { error: "Enter a full email address, like name@example.com." };
  if (e === normEmail(current)) return { error: "That's the address we already have. Check it, or press Resend." };
  return { value: e };
}

const ms = (t) => (t ? new Date(t).getTime() : NaN);

/** Supabase recorded a confirmation that someone clicked a link for. */
export function supabaseConfirmedByLink(user) {
  const made = ms(user?.created_at), confirmed = ms(user?.email_confirmed_at);
  if (!Number.isFinite(made) || !Number.isFinite(confirmed)) return false;
  return confirmed - made >= SUPABASE_LINK_SECONDS * 1000;
}

/**
 * Is this account's current email address confirmed?
 *   row: its email_confirmations row, or null when it has none.
 * A row decides when there is one: confirmed only if it was confirmed for the
 * address the account has now. With no row (everyone from before the
 * switch-over), Supabase's own record decides, as above.
 */
export function emailConfirmed(user, row) {
  if (!user || !normEmail(user.email)) return false;
  if (row) return Boolean(row.confirmed_at) && normEmail(row.email) === normEmail(user.email);
  return supabaseConfirmedByLink(user);
}

/** A link code is 32 random bytes, base64url: 43 characters. */
export const isConfirmCode = (s) => typeof s === "string" && /^[A-Za-z0-9_-]{43}$/.test(s);

/** The link in the email: https://app.plotwire.uk/confirm-email?code=<code> */
export function confirmLink(origin, code) {
  return `${new URL(CONFIRM_PATH, origin).href}?code=${code}`;
}

/**
 * May another link be sent? sentAt: when this account's links were sent
 * (any order). { ok: true } or { ok: false, reason: "wait" | "limit",
 * retryAfterSec }.
 */
export function sendAllowed(sentAt, now = Date.now()) {
  const times = (sentAt || []).map(ms).filter(Number.isFinite);
  const last = times.length ? Math.max(...times) : -Infinity;
  const wait = Math.ceil((last + RESEND_WAIT_SECONDS * 1000 - now) / 1000);
  if (wait > 0) return { ok: false, reason: "wait", retryAfterSec: wait };
  const today = times.filter((t) => now - t < 24 * 3600 * 1000);
  if (today.length >= LINKS_PER_DAY) {
    const oldest = Math.min(...today);
    return { ok: false, reason: "limit", retryAfterSec: Math.max(1, Math.ceil((oldest + 24 * 3600 * 1000 - now) / 1000)) };
  }
  return { ok: true };
}

// What people are told (the banner, the Subscribe screen, the link page).
export const CONFIRM_MESSAGES = {
  BEFORE_PAYING: "Confirm your email address before you subscribe.",
  WAIT: "We sent a link a moment ago. Wait a minute, then try again.",
  LIMIT: `That's ${LINKS_PER_DAY} links today, the most for one day. Try again tomorrow.`,
  NO_EMAIL: "Confirmation emails aren't set up on this site yet. Try again later.",
  EMAIL_FAILED: "The email didn't go. Wait a minute, then press Resend.",
  ALREADY_CONFIRMED: "Your email address is already confirmed.",
  EMAIL_TAKEN: "That email already has a Plotwire account. Use a different one.",
  CHANGE_NOT_ALLOWED: "Your email address is confirmed, so it can't be changed here.",
  SIGN_IN: "Please sign in again.",
  FAILED: "Something went wrong. Try again in a minute.",
};

/** The message for a refused send ({ reason }). */
export const sendRefusal = (verdict) => (verdict?.reason === "limit" ? CONFIRM_MESSAGES.LIMIT : CONFIRM_MESSAGES.WAIT);

/**
 * What the link page says. state: confirmed | already | expired | changed |
 * invalid | failed.
 */
export function linkPage(state) {
  switch (state) {
    case "confirmed":
      return { ok: true, title: "Email confirmed", text: "Thanks. You can subscribe to Plotwire whenever you're ready. You can close this tab, or carry on into Plotwire." };
    case "already":
      return { ok: true, title: "Email already confirmed", text: "This address was confirmed already, so there's nothing more to do." };
    case "expired":
      return { ok: false, title: "This link has run out", text: `Links work for ${LINK_DAYS} days. Sign in to Plotwire and press Resend in the note on your dashboard to get a new one.` };
    case "changed":
      return { ok: false, title: "This link is for an old address", text: "The account's email address has been changed since this link was sent. Use the link sent to the new address." };
    case "failed":
      return { ok: false, title: "Couldn't confirm just now", text: "Check your connection, then open the link again." };
    default:
      return { ok: false, title: "This link doesn't work", text: "Check you opened the whole link from the email. If it still doesn't work, sign in to Plotwire and press Resend in the note on your dashboard." };
  }
}

// ------------------------------------------------------------------ the email

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const oneLine = (s) => String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

/** The confirmation email: { subject, text, html }. name: their name, if known. */
export function confirmationEmail({ name, link }) {
  const first = oneLine(name).split(" ")[0].slice(0, 40) || "there";
  const subject = "Confirm your email for Plotwire";
  const text = [
    `Hi ${first},`,
    "",
    "Please confirm your email address for your Plotwire account. You'll need to before you subscribe.",
    "Open this link to confirm it (any device or browser is fine, you don't need to be signed in):",
    "",
    link,
    "",
    `The link works for ${LINK_DAYS} days. If you didn't create a Plotwire account, you can ignore this email.`,
    "",
    "Plotwire · admin@plotwire.uk",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#F4F6F9;font-family:Arial,Helvetica,sans-serif;color:#0E141B">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F9;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border:1px solid #E6EBF1;border-radius:12px">
<tr><td style="padding:28px 32px 8px;font-size:22px;color:#1A2530">Plot<strong style="color:#2C97A8">wire</strong></td></tr>
<tr><td style="padding:8px 32px 0">
<h1 style="margin:0 0 12px;font-size:20px;color:#1A2530">Confirm your email</h1>
<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#3A4654">Hi ${esc(first)},</p>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#3A4654">Please confirm your email address for your Plotwire account. You&rsquo;ll need to before you subscribe. Any device or browser is fine, and you don&rsquo;t need to be signed in.</p>
</td></tr>
<tr><td style="padding:0 32px">
<a href="${esc(link)}" style="display:inline-block;background:#2C97A8;color:#1A2530;font-size:15px;font-weight:bold;text-decoration:none;padding:13px 26px;border-radius:10px">Confirm my email</a>
</td></tr>
<tr><td style="padding:20px 32px 0;font-size:13px;line-height:1.6;color:#697785">Or copy this link into your browser:<br><a href="${esc(link)}" style="color:#22808F;word-break:break-all">${esc(link)}</a></td></tr>
<tr><td style="padding:16px 32px 28px;font-size:13px;line-height:1.6;color:#697785">The link works for ${LINK_DAYS} days. If you didn't create a Plotwire account, you can ignore this email.</td></tr>
</table>
<p style="margin:16px 0 0;font-size:12px;color:#9AA6B2">Plotwire &middot; admin@plotwire.uk</p>
</td></tr></table></body></html>`;
  return { subject, text, html };
}
