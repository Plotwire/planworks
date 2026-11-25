import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { confirmByCode } from "@/lib/emailConfirmServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

// POST /api/account/confirm-email { code }   (no sign-in needed)
// The link in a Plotwire confirmation email, opened in any browser
// (app/confirm-email/page.jsx). The code is 32 random bytes; only its
// fingerprint is stored. Answers 200 { state }: confirmed | already | expired
// | changed | invalid | failed. Never says whose address it was.
export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const state = await confirmByCode(getSupabaseAdmin(), body.code);
    return NextResponse.json({ state }, { headers: NO_STORE });
  } catch (e) {
    console.error("[account/confirm-email]", e?.name || "error");
    return NextResponse.json({ state: "failed" }, { status: 500, headers: NO_STORE });
  }
}
