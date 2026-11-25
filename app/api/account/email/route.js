import { NextResponse } from "next/server";
import { bearer, userFromToken, returnOrigin } from "@/lib/billing";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isOperativeUser, NOT_FOR_OPERATIVES } from "@/lib/timesheets/operative";
import { CONFIRM_MESSAGES } from "@/lib/emailConfirm";
import { emailStatus, sendConfirmLink, changeAccountEmail } from "@/lib/emailConfirmServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };
const reply = (body, status = 200, headers = {}) => NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });

// POST /api/account/email (Bearer: the signed-in account's Supabase access token)
//   { action: "status" }          200 { confirmed, email, sentAt?, sendError? }
//                                 (sends the first link if none has gone yet)
//   { action: "resend" }          200 { ok, sentAt } | 429 { error, retryAfterSec }
//   { action: "change", email }   200 { ok, email, sentAt?, sendError? }
//                                 for an account that hasn't confirmed yet
//   401 / 400 / 403 / 409 / 5xx { error } (plain words)
// Rules: lib/emailConfirm.js; server side: lib/emailConfirmServer.js.
export async function POST(req) {
  try {
    const user = await userFromToken(bearer(req));
    if (!user) return reply({ error: CONFIRM_MESSAGES.SIGN_IN }, 401);
    const body = await req.json().catch(() => ({}));
    // A Timesheets worker's login: nothing to confirm here, nothing to pay.
    if (isOperativeUser(user)) {
      return body.action === "status" ? reply({ confirmed: true, operative: true }) : reply({ error: NOT_FOR_OPERATIVES }, 403);
    }
    const admin = getSupabaseAdmin();
    const origin = returnOrigin(req);

    if (body.action === "status") return reply(await emailStatus(admin, user, origin));

    if (body.action === "resend") {
      const s = await sendConfirmLink(admin, user, origin);
      if (s.ok) return reply({ ok: true, sentAt: s.sentAt });
      return reply({ error: s.error }, s.status, s.retryAfterSec ? { "Retry-After": String(s.retryAfterSec) } : {});
    }

    if (body.action === "change") {
      const c = await changeAccountEmail(admin, user, body.email, origin);
      if (c.ok) return reply(c);
      return reply({ error: c.error }, c.status, c.retryAfterSec ? { "Retry-After": String(c.retryAfterSec) } : {});
    }

    return reply({ error: CONFIRM_MESSAGES.FAILED }, 400);
  } catch (e) {
    console.error("[account/email]", e?.name || "error");
    return reply({ error: CONFIRM_MESSAGES.FAILED }, 500);
  }
}
