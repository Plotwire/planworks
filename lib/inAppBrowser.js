// Instagram, Facebook, Messenger and TikTok open links in their own built-in
// browser rather than the phone's. That gets in the way of signing up: the
// confirmation email's link opens in the phone's own browser, not back inside
// the app, so the account is confirmed and signed in over there while the
// app's page still shows the sign-in form. The two browsers don't share a
// sign-in, so it's easy to end up signed in in one and stuck in the other.
//
// The sign-in page (components/LoginScreen.jsx) shows nothing up front. On
// Android, in Instagram, Facebook or Messenger, it offers one small "Open in
// Chrome" button (canOpenInChrome, chromeIntentUrl); and only when it's
// needed (email not confirmed, or "Check your email" after signing up) a
// one-line tip. instrumentation-client.ts tags Sentry events with the app's
// name and drops the errors these browsers' own scripts throw.
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
 * messenger, tiktok) pretends to be that app's browser, for testing.
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

// "Open in Chrome": Android only (an iPhone has no way for a page to open
// Safari), and only in the apps whose built-in browser hands an intent://
// link to Android: Instagram, Facebook and Messenger. TikTok's doesn't do
// that reliably, so it gets no button rather than one that may do nothing.
const CHROME_APPS = ["Instagram", "Facebook", "Messenger"];

/** True when the sign-in page should offer "Open in Chrome". */
export function canOpenInChrome(found) {
  return Boolean(found && found.os === "android" && CHROME_APPS.includes(found.app));
}

/**
 * The sign-in page as an Android link that opens it in Chrome
 * (intent://...;package=com.android.chrome). If Chrome isn't there, Android
 * opens the same address in the phone's usual browser instead
 * (S.browser_fallback_url). `origin` is e.g. "https://app.plotwire.uk"; the
 * link goes to sign-in (?login=1, past the Coming Soon page), never to an
 * address that carries a token.
 */
export function chromeIntentUrl(origin) {
  const page = new URL("/?login=1", origin);
  const scheme = page.protocol.replace(":", "");
  return `intent://${page.host}${page.pathname}${page.search}#Intent;scheme=${scheme};package=com.android.chrome;`
    + `S.browser_fallback_url=${encodeURIComponent(page.href)};end`;
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
