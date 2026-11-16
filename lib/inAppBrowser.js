// Instagram, Facebook, Messenger and TikTok open links in their own built-in
// browser rather than the phone's. That gets in the way of signing up: the
// confirmation email's link opens in the phone's own browser, not back inside
// the app, so the account is confirmed and signed in over there while the
// app's page still shows the sign-in form. The two browsers don't share a
// sign-in, so it's easy to end up signed in in one and stuck in the other.
//
// components/InAppBrowserBanner.jsx uses this to ask people to open Plotwire
// in their phone's browser, and instrumentation-client.ts tags Sentry events
// with the app's name and drops the errors these browsers' own scripts throw.
//
// Plotwire doesn't offer Google sign-in. If it ever does, hide that button
// when detectInAppBrowser() finds one of these: Google refuses to sign anyone
// in from an embedded browser (its "403 disallowed_useragent" page).
//
// Plain functions so tests can run them (tests/inapp-browser.test.mjs).

// Order matters: Messenger's user agent also carries Facebook's markers.
const APPS = [
  { app: "Instagram", re: /\bInstagram\b/i },
  { app: "Messenger", re: /MessengerForiOS|MessengerLite|Orca-Android|FBAN\/Messenger/i },
  { app: "Facebook", re: /FBAN\/|FBAV\/|FB_IAB\/|\bFB4A\b|\bFBIOS\b/i },
  { app: "TikTok", re: /musical_ly|BytedanceWebview|\bTikTok\b|\btrill_\d/i },
];

function osOf(ua) {
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  return "other";
}

/**
 * Which app's built-in browser this is, or null for an ordinary browser.
 * `search` is the page's query string: "?inapp=instagram" (or facebook,
 * messenger, tiktok) shows the banner in any browser, for testing.
 * @returns {{ app: string, os: "android" | "ios" | "other" } | null}
 */
export function detectInAppBrowser(ua, search = "") {
  const ua_ = typeof ua === "string" ? ua : "";
  const forced = /[?&]inapp=([a-z]+)/i.exec(typeof search === "string" ? search : "");
  if (forced) {
    const hit = APPS.find((a) => a.app.toLowerCase() === forced[1].toLowerCase());
    if (hit) return { app: hit.app, os: osOf(ua_) };
  }
  if (!ua_) return null;
  const hit = APPS.find((a) => a.re.test(ua_));
  return hit ? { app: hit.app, os: osOf(ua_) } : null;
}

/** Sentry's in_app_browser tag: "instagram", "facebook", ... or "no". */
export function inAppBrowserTag(ua) {
  const found = detectInAppBrowser(ua);
  return found ? found.app.toLowerCase() : "no";
}

/** What the "Open in browser" menu item is likely to say on this phone. */
export function openInBrowserLabel(os) {
  if (os === "android") return "Open in Chrome";
  if (os === "ios") return "Open in Safari";
  return "Open in external browser";
}

// Errors thrown by the apps' own scripts inside their built-in browsers, never
// by Plotwire: the bridge between the page and the app is torn down while the
// page is still running ("Java object is gone" on Android), or an iOS app's
// injected autofill / ad-measurement helper is missing. Sentry drops any event
// whose message matches (Sentry's ignoreErrors). Kept narrow on purpose:
// Plotwire uses postMessage itself (lib/device/outbox.js,
// lib/device/serviceWorker.js), so a bare "postMessage" is NOT filtered.
export const IN_APP_BRIDGE_ERRORS = [
  /Java object is gone/i,
  /Java bridge method invocation error/i,
  /Java exception was raised during method invocation/i,
  /Error invoking postMessage: Java/i,
  /_AutofillCallbackHandler/,
  /_pcmBridgeCallbackHandler/,
];

/** True when Sentry should drop this message as in-app browser noise. */
export function isInAppBridgeNoise(message) {
  const text = typeof message === "string" ? message : "";
  return IN_APP_BRIDGE_ERRORS.some((re) => re.test(text));
}
