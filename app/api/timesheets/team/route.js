import { NextResponse } from "next/server";
import { bearer, userFromToken, returnOrigin } from "@/lib/billing";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isOperativeUser, NOT_FOR_OPERATIVES } from "@/lib/timesheets/operative";
import { cleanInvite, inviteLink, isUuid, teamMessage, TEAM_MESSAGES } from "@/lib/timesheets/invites";
import { companyNameOf, inviteEmailReady, newInviteCode, sendInviteEmail } from "@/lib/timesheets/inviteServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };
const reply = (body, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

// POST /api/timesheets/team (Bearer: the boss's Supabase access token)
//   { action: "invite", name, email }   invite a worker (or send a waiting invite again)
//   { action: "resend", operativeId }   send a waiting invite again, with a new link
//   { action: "cancel", operativeId }   cancel an invite nobody has accepted
//   { action: "remove", operativeId }   take a worker off the team: their login is
//                                       deleted (they can't sign in), their name and
//                                       hours stay in the boss's records
// 200 { ok, outcome? } | 4xx/5xx { error } (plain words for the boss).
// The database decides every rule (supabase/timesheets-invites.sql): the add-on,
// whose team, a customer's email refused, one invite a minute, 30 a day.
export async function POST(req) {
  try {
    const user = await userFromToken(bearer(req));
    if (!user) return reply({ error: TEAM_MESSAGES.SIGN_IN }, 401);
    if (isOperativeUser(user)) return reply({ error: NOT_FOR_OPERATIVES }, 403);

    const body = await req.json().catch(() => ({}));
    const admin = getSupabaseAdmin();

    if (body.action === "invite" || body.action === "resend") {
      if (!inviteEmailReady()) return reply({ error: TEAM_MESSAGES.NO_EMAIL }, 503);
      const { code, hash } = newInviteCode();
      let row;
      if (body.action === "invite") {
        const clean = cleanInvite(body);
        if (clean.error) return reply({ error: clean.error }, 400);
        const { data, error } = await admin.rpc("timesheet_invite_create", {
          p_owner: user.id, p_name: clean.value.name, p_email: clean.value.email, p_token_hash: hash,
        });
        if (error) return reply({ error: teamMessage(error) }, 409);
        row = data;
      } else {
        if (!isUuid(body.operativeId)) return reply({ error: TEAM_MESSAGES.TS_INVITE_NOT_PENDING }, 400);
        const { data, error } = await admin.rpc("timesheet_invite_resend", {
          p_owner: user.id, p_operative: body.operativeId, p_token_hash: hash,
        });
        if (error) return reply({ error: teamMessage(error) }, 409);
        row = data;
      }
      const sent = await sendInviteEmail({
        to: row.email,
        replyTo: user.email,
        company: await companyNameOf(admin, user.id),
        name: row.name,
        link: inviteLink(returnOrigin(req), code),
        idempotencyKey: hash.slice(0, 32),
      });
      if (!sent) return reply({ error: TEAM_MESSAGES.EMAIL_FAILED, saved: true }, 502);
      return reply({ ok: true, outcome: row.outcome || "resent" });
    }

    if (body.action === "cancel") {
      if (!isUuid(body.operativeId)) return reply({ error: TEAM_MESSAGES.TS_INVITE_NOT_PENDING }, 400);
      const { error } = await admin.rpc("timesheet_invite_cancel", { p_owner: user.id, p_operative: body.operativeId });
      if (error) return reply({ error: teamMessage(error) }, 409);
      return reply({ ok: true });
    }

    if (body.action === "remove") {
      if (!isUuid(body.operativeId)) return reply({ error: TEAM_MESSAGES.TS_NOT_ON_TEAM }, 400);
      const { data: op, error: readError } = await admin.from("timesheet_operatives")
        .select("id, user_id, status").eq("id", body.operativeId).eq("owner_id", user.id).maybeSingle();
      if (readError) throw readError;
      if (!op || op.status === "removed") return reply({ error: TEAM_MESSAGES.TS_NOT_ON_TEAM }, 409);
      // Their login goes first, so access ends even if the next step fails
      // (running Remove again finishes it). Only ever a worker's login.
      if (op.user_id) {
        const { data: found } = await admin.auth.admin.getUserById(op.user_id);
        if (found?.user) {
          if (!isOperativeUser(found.user)) return reply({ error: TEAM_MESSAGES.NOT_A_WORKER_LOGIN }, 409);
          const { error: deleteError } = await admin.auth.admin.deleteUser(op.user_id);
          if (deleteError) throw deleteError;
        }
      }
      const { error } = await admin.rpc("timesheet_remove_worker", { p_owner: user.id, p_operative: op.id });
      if (error) return reply({ error: teamMessage(error) }, 409);
      return reply({ ok: true });
    }

    return reply({ error: TEAM_MESSAGES.FAILED }, 400);
  } catch (e) {
    console.error("[timesheets/team]", e?.code || e?.name || "error");
    return reply({ error: TEAM_MESSAGES.FAILED }, 500);
  }
}
