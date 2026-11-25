// Inviting workers by email (Timesheets → Workers → Invite worker) and the
// page an invite link opens (/time/join). The rules themselves are in the
// database (supabase/timesheets-invites.sql); this is the wording, the email
// and the link. Plain functions so tests can run them
// (tests/timesheets-invites.test.mjs).

export const JOIN_PATH = "/time/join";
export const INVITE_DAYS = 7;
export const PASSWORD_MIN = 8;
export const SIGN_IN_PATH = "/time";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The Invite form, tidied: { value: { name, email } } or { error }. */
export function cleanInvite({ name, email } = {}) {
  const n = String(name ?? "").replace(/\s+/g, " ").trim();
  const e = String(email ?? "").trim().toLowerCase();
  if (!n) return { error: "Enter their name." };
  if (n.length > 80) return { error: "Names can be up to 80 characters." };
  if (e.length > 254 || !EMAIL_RE.test(e)) return { error: "Enter a full email address, like name@example.com." };
  return { value: { name: n, email: e } };
}

export const isUuid = (s) => typeof s === "string" && UUID_RE.test(s);

/** An invite code is 32 random bytes, base64url: 43 characters. */
export const isInviteCode = (s) => typeof s === "string" && /^[A-Za-z0-9_-]{43}$/.test(s);

/** The link in the email: https://app.plotwire.uk/time/join?invite=<code> */
export function inviteLink(origin, code) {
  return `${new URL(JOIN_PATH, origin).href}?invite=${code}`;
}

// What the boss is told when something is refused (the database's reasons).
export const TEAM_MESSAGES = {
  TS_INVITE_CUSTOMER: "That email already has its own Plotwire customer account, and a customer can't also be someone's worker. Ask them for a different email address.",
  TS_INVITE_SELF: "That's your own email. Invite your worker with theirs.",
  TS_INVITE_OTHER_COMPANY: "That email is already a worker for another company on Plotwire.",
  TS_INVITE_ALREADY_ON_TEAM: "They're already on your team.",
  TS_INVITE_TOO_SOON: "That invite was only just sent. Wait a minute, then try again.",
  TS_INVITE_LIMIT: "That's 30 invites today, the most for one day. Try again tomorrow.",
  TS_INVITE_BAD_NAME: "Enter their name.",
  TS_INVITE_BAD_EMAIL: "Enter a full email address, like name@example.com.",
  TS_INVITE_NOT_PENDING: "That invite isn't waiting any more. Refresh the page.",
  TS_INVITE_ACCEPTED: "They've already accepted the invite. Use Remove instead.",
  TS_NOT_ON_TEAM: "They're not on your team any more. Refresh the page.",
  TS_NO_ADDON: "Timesheets isn't switched on for this account.",
  NOT_A_WORKER_LOGIN: "That login isn't a worker's, so nothing was removed.",
  NO_EMAIL: "Invite emails aren't set up on this site yet, so nothing was sent.",
  EMAIL_FAILED: "They're on your list, but the email didn't go. Wait a minute, then press Resend.",
  SIGN_IN: "Please sign in again.",
  FAILED: "Something went wrong. Nothing was changed.",
};

/** The message for a database refusal (its message is the code), or FAILED. */
export function teamMessage(errorOrCode) {
  const code = typeof errorOrCode === "string" ? errorOrCode : errorOrCode?.message;
  return TEAM_MESSAGES[code] || TEAM_MESSAGES.FAILED;
}

/**
 * What the invite page says when the link can't be used.
 * state: invalid | used | expired | off | other
 */
export function joinProblem(state, company) {
  const who = String(company || "").trim() || "your employer";
  switch (state) {
    case "expired":
      return { title: "This invite has run out", text: `Invites last ${INVITE_DAYS} days. Ask ${who} to send it again.`, signIn: false };
    case "off":
      return { title: "Timesheets isn't switched on", text: `Ask ${who} about it.`, signIn: false };
    case "other":
      return {
        title: "This email already has a Plotwire account",
        text: `A Plotwire customer account can't also be a worker's. Ask ${who} to invite a different email address.`,
        signIn: false,
      };
    default:
      return {
        title: "This invite link doesn't work",
        text: "It's been used already, cancelled, or replaced by a newer one. If you've set up already, sign in.",
        signIn: true,
      };
  }
}

/** Same rule as signing up (components/LoginScreen.jsx). */
export function passwordProblem(password) {
  return String(password || "").length < PASSWORD_MIN
    ? `Use a password of at least ${PASSWORD_MIN} characters.` : "";
}

// ------------------------------------------------------------------ the email

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// One line, no control characters (for a subject or a sender name).
const oneLine = (s) => String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

/** The sender's name: "<company> via Plotwire". */
export function senderName(company) {
  const name = oneLine(company).replace(/["<>,;:\\]/g, "").slice(0, 60).trim();
  return name ? `${name} via Plotwire` : "Plotwire Timesheets";
}

/** The invite email: { subject, text, html }. */
export function inviteEmail({ company, name, link }) {
  const who = oneLine(company) || "Your employer";
  const first = oneLine(name).split(" ")[0] || "there";
  const subject = `${who} has invited you to Plotwire Timesheets`.slice(0, 150);
  const text = [
    `Hi ${first},`,
    "",
    `${who} uses Plotwire to record the hours you work and the jobs you work on.`,
    "Open this link on your phone to set your password and see your timesheet:",
    "",
    link,
    "",
    `The link works for ${INVITE_DAYS} days. If you weren't expecting this, you can ignore this email.`,
    "",
    `Sent by Plotwire for ${who}.`,
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#F4F6F9;font-family:Arial,Helvetica,sans-serif;color:#0E141B">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E6EBF1">
<tr><td style="background:#2C3E50;color:#FFFFFF;padding:16px 22px;font-size:17px;font-weight:bold">${esc(who)}</td></tr>
<tr><td style="padding:22px;font-size:15px;line-height:1.55">
<p style="margin:0 0 12px">Hi ${esc(first)},</p>
<p style="margin:0 0 18px">${esc(who)} uses Plotwire to record the hours you work and the jobs you work on. Tap the button to set your password and see your timesheet.</p>
<p style="margin:0 0 22px"><a href="${esc(link)}" style="display:inline-block;background:#2C97A8;color:#0E141B;text-decoration:none;font-weight:bold;padding:13px 22px;border-radius:10px">Set up my timesheet</a></p>
<p style="margin:0 0 6px;font-size:13px;color:#697785">Or copy this link into your phone's browser:</p>
<p style="margin:0 0 18px;font-size:13px;word-break:break-all"><a href="${esc(link)}" style="color:#22808F">${esc(link)}</a></p>
<p style="margin:0;font-size:13px;color:#697785">The link works for ${INVITE_DAYS} days. If you weren't expecting this, you can ignore this email.</p>
</td></tr>
<tr><td style="padding:14px 22px;border-top:1px solid #EEF2F6;font-size:12px;color:#9AA6B2">Sent by Plotwire for ${esc(who)}.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}

/**
 * An Android link that opens this page in Chrome (for the built-in browsers
 * of Instagram, Facebook and Messenger; lib/inAppBrowser.js says when). The
 * invite link carries its code; opening it doesn't use the invite up.
 */
export function chromeIntentFor(href) {
  const page = new URL(href);
  const scheme = page.protocol.replace(":", "");
  return `intent://${page.host}${page.pathname}${page.search}#Intent;scheme=${scheme};package=com.android.chrome;`
    + `S.browser_fallback_url=${encodeURIComponent(page.href)};end`;
}
