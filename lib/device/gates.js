"use client";

// The last answers the server gave about the signed-in account -- terms
// accepted, business details filled in, access level -- kept on this device
// so the app opens straight away with weak or no signal, while the same
// checks run again in the background (components/AppShell.jsx,
// lib/useSubscription.js). Only ever an answer the server gave this account;
// a check that fails never writes one. Cleared on sign-out (lib/deviceData.js).

export const GATE_PREFIX = "plotwire:gate:";
const keyFor = (uid, name) => `${GATE_PREFIX}${name}:${uid}`;

export function rememberGate(uid, name, value) {
  if (!uid) return;
  try { localStorage.setItem(keyFor(uid, name), JSON.stringify({ value, at: Date.now() })); } catch { /* storage unavailable */ }
}

export function recallGate(uid, name) {
  if (!uid) return undefined;
  try {
    const raw = localStorage.getItem(keyFor(uid, name));
    return raw ? JSON.parse(raw).value : undefined;
  } catch { return undefined; }
}

export function forgetGate(uid, name) {
  if (!uid) return;
  try { localStorage.removeItem(keyFor(uid, name)); } catch { /* storage unavailable */ }
}
