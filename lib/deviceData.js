// What this device keeps in localStorage after someone signs out.
//
// Signing out removes the Supabase session itself. This clears what the app
// keeps alongside it that can identify a person or a client, so a shared
// device doesn't hand it to the next user:
//   planworks:draft:v1                 crash-recovery copy of the open drawing
//                                      (can hold client names and addresses)
//   plotwire:onboardingSkipped:<uid>   "skipped business details" flags
// planworks:theme (light/dark) is a device preference and is kept.

const SIGN_OUT_KEYS = ["planworks:draft:v1"];
const SIGN_OUT_PREFIXES = ["plotwire:onboardingSkipped:"];

export function clearSignedOutDeviceData() {
  if (typeof window === "undefined") return;
  try {
    const ls = window.localStorage;
    const doomed = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && (SIGN_OUT_KEYS.includes(k) || SIGN_OUT_PREFIXES.some((p) => k.startsWith(p)))) doomed.push(k);
    }
    // Collected first, removed after: removing while iterating shifts indexes.
    doomed.forEach((k) => ls.removeItem(k));
  } catch { /* storage unavailable -- nothing to clear */ }
}
