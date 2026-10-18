"use client";

/* ============================================================================
 * lib/authUser.js -- who is signed in, without needing signal
 * ----------------------------------------------------------------------------
 * The signed-in user's id comes from the session kept on this device
 * (getSession), not from asking the server (getUser): one round trip fewer
 * on every save and load, and it works with no signal. The database checks
 * the real token on every request anyway (RLS), so the id is only what rows
 * are stamped and filtered with.
 *
 * With no signal at the moment the session's token needs renewing, Supabase
 * answers "no session" with a retryable error. That isn't "signed out": the
 * session is still kept, and renews when signal returns. currentUserId then
 * throws a "no signal" error, so callers wait and retry (lib/device/outbox)
 * instead of saying "Not signed in".
 * ========================================================================== */

export function isRetryableAuthError(error) {
  if (!error) return false;
  if (error.name === "AuthRetryableFetchError" || error.status === 0) return true;
  return /failed to fetch|fetch failed|networkerror|network request failed|load failed|timed? ?out/i.test(String(error.message || ""));
}

export function noSignalError() {
  return Object.assign(new Error("Failed to fetch (no signal to renew the sign-in)"), { status: 0, noSignal: true });
}

export async function currentUserId(client) {
  const { data, error } = await client.auth.getSession();
  const id = data?.session?.user?.id;
  if (id) return id;
  if (isRetryableAuthError(error)) throw noSignalError();
  return null;
}

// The session Supabase keeps in this browser's storage, read directly: the
// signed-in account while the server can't be reached to renew it. Null once
// signed out (Supabase deletes it then). Only ever used to show this
// device's own copies; every request to the server still needs a valid token.
export function keptSession() {
  if (typeof window === "undefined") return null;
  try {
    let k = null;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (url) k = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
    if (!k || localStorage.getItem(k) === null) {
      k = Object.keys(localStorage).find((x) => /^sb-[^-]+-auth-token$/.test(x)) || null;
    }
    if (!k) return null;
    const s = JSON.parse(localStorage.getItem(k) || "null");
    if (!s || !s.refresh_token) return null;
    let user = s.user || null;
    if (!user) {
      const u = JSON.parse(localStorage.getItem(k + "-user") || "null");
      user = u?.user || u || null;
    }
    return user && user.id ? { ...s, user } : null;
  } catch {
    return null;
  }
}
