import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isInviteCode } from "@/lib/timesheets/invites";
import { hashInviteCode } from "@/lib/timesheets/inviteServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };
const reply = (body, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

// A brake on scripts hammering "accept" (each one may make a login): per
// address, on this server instance only. The codes themselves can't be
// guessed (32 random bytes).
const recent = new Map();
function allowed(key) {
  const now = Date.now();
  const stamps = (recent.get(key) || []).filter((t) => now - t < 60000);
  stamps.push(now);
  recent.set(key, stamps);
  if (recent.size > 2000) recent.clear();
  return stamps.length <= 10;
}

// POST /api/timesheets/join (no sign-in: the invite code is the proof)
//   { action: "check", invite }   what the link is for, without using it:
//                                 200 { state: "ok", name, email, company }
//                                 200 { state: "invalid" | "used" | "expired" | "off" | "other", company? }
//   { action: "accept", invite }  make the worker's login (marked as a worker),
//                                 link it to the team (the invite is used up),
//                                 and return a one-time sign-in for this browser:
//                                 200 { token_hash, email }   then
//                                 supabase.auth.verifyOtp({ token_hash, type: "magiclink" })
//                                 409 { state } when the link can't be used
// No Coming Soon page, terms or customer set-up: a worker's login never
// reaches them (components/AppShell.jsx).
export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    if (!isInviteCode(body.invite)) return reply({ state: "invalid" });
    const hash = hashInviteCode(body.invite);
    const admin = getSupabaseAdmin();

    const { data: look, error: lookError } = await admin.rpc("timesheet_invite_lookup", { p_token_hash: hash });
    if (lookError) throw lookError;
    const company = look?.company || "";
    // An email that has a customer account can't become a worker's.
    const state = look?.state === "ok" && look.login === "other" ? "other" : look?.state || "invalid";

    if (body.action === "check") {
      return state === "ok"
        ? reply({ state, name: look.name, email: look.email, company })
        : reply({ state, company });
    }
    if (body.action !== "accept") return reply({ state: "invalid" }, 400);

    const who = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!allowed(who)) return reply({ error: "Too many tries. Wait a minute, then try again." }, 429);
    if (state !== "ok") return reply({ state, company }, 409);

    // The worker's login: made now, marked as a worker. A worker login left
    // over from an earlier try at this invite is used again.
    let userId = look.login === "worker" ? look.login_id : null;
    let made = false;
    if (!userId) {
      const { data, error } = await admin.auth.admin.createUser({
        email: look.email,
        email_confirm: true,
        app_metadata: { plotwire_kind: "operative" },
      });
      if (error || !data?.user) {
        // Someone made an account with this email since the check.
        return reply({ state: "other", company }, 409);
      }
      userId = data.user.id;
      made = true;
    }

    const { error: acceptError } = await admin.rpc("timesheet_invite_accept", { p_token_hash: hash, p_user: userId });
    if (acceptError) {
      if (made) await admin.auth.admin.deleteUser(userId).catch(() => {});
      const code = acceptError.message;
      return reply({ state: code === "TS_INVITE_EXPIRED" ? "expired" : code === "TS_NO_ADDON" ? "off" : "invalid", company }, 409);
    }

    // Signed in on this browser, once, with no email round trip.
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: look.email });
    const tokenHash = link?.properties?.hashed_token;
    if (linkError || !tokenHash) return reply({ error: "You're on the team, but signing in didn't work. Go to sign in and use \"Forgot password\".", joined: true }, 500);
    return reply({ token_hash: tokenHash, email: look.email });
  } catch (e) {
    console.error("[timesheets/join]", e?.code || e?.name || "error");
    return reply({ error: "Something went wrong. Try again in a minute." }, 500);
  }
}
