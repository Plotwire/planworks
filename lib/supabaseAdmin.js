import "server-only";
import { createClient } from "@supabase/supabase-js";

// Service-role client — bypasses RLS, so it must ONLY ever run server-side
// (API routes). The key lives in Vercel env vars, never in client code or git.
// The "server-only" import above makes the build fail if a browser file ever
// imports this module.
// Lazily constructed so a build without the env var doesn't crash.
let _admin = null;

export function getSupabaseAdmin() {
  if (!_admin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Supabase admin env vars are not set");
    _admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _admin;
}
