import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { inviteEmail, senderName } from "@/lib/timesheets/invites";

// Server side of worker invites (app/api/timesheets/team, app/api/timesheets/join).
//
// The emailed link carries a random code; the database only ever holds its
// SHA-256 fingerprint (timesheet_invites.token_hash), so the code can't be
// read back out of it.
//
// Emails go through Resend (plotwire.uk is verified there), the same way as
// the billing report (lib/billingReconcile.js):
//   RESEND_API_KEY           needed; without it nothing is invited
//   TIMESHEETS_EMAIL_ADDRESS optional sender address (default
//                            timesheets@plotwire.uk), shown as
//                            "<company> via Plotwire"

const RESEND_URL = "https://api.resend.com/emails";
const DEFAULT_ADDRESS = "timesheets@plotwire.uk";

export const hashInviteCode = (code) => createHash("sha256").update(String(code)).digest("hex");

/** A new invite code and its fingerprint. */
export function newInviteCode() {
  const code = randomBytes(32).toString("base64url");
  return { code, hash: hashInviteCode(code) };
}

export const inviteEmailReady = () => Boolean(process.env.RESEND_API_KEY);

/** The owner's business name (their business details), or "". */
export async function companyNameOf(admin, ownerId) {
  const { data } = await admin.from("company_profile").select("company_name").eq("user_id", ownerId).maybeSingle();
  return String(data?.company_name || "").trim();
}

/**
 * Send one invite. true when Resend took it. One retry on a network error,
 * a 429 or a 5xx, with the same Idempotency-Key so it never goes twice.
 * Nothing personal is logged.
 */
export async function sendInviteEmail({ to, replyTo, company, name, link, idempotencyKey }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const address = process.env.TIMESHEETS_EMAIL_ADDRESS || DEFAULT_ADDRESS;
  const { subject, text, html } = inviteEmail({ company, name, link });
  const body = { from: `${senderName(company)} <${address}>`, to: [to], subject, text, html };
  if (replyTo) body.reply_to = replyTo;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(RESEND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `plotwire-invite-${idempotencyKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) return true;
      console.error("[timesheets/invite] Resend answered", res.status);
      if (res.status !== 429 && res.status < 500) return false;
    } catch (e) {
      console.error("[timesheets/invite] couldn't reach Resend:", e?.name || "error");
    }
    if (attempt === 1) await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}
