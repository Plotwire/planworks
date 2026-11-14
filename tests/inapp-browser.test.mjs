// Sign-in refusals get plain messages, Instagram / Facebook / TikTok built-in
// browsers are spotted, and their own script errors are kept out of Sentry.
// Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authFailure, authErrorCode, authReportExtra, NOT_CONFIRMED_MESSAGE } from "../lib/authMessages.js";
import { detectInAppBrowser, inAppBrowserTag, isInAppBridgeNoise, openInBrowserLabel } from "../lib/inAppBrowser.js";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

// Shaped like supabase-js's errors.
const apiError = (code, message, status = 400) => ({ name: "AuthApiError", code, message, status });

test("email not confirmed: the plain message, and the resend button", () => {
  const out = authFailure(apiError("email_not_confirmed", "Email not confirmed"), "signin");
  assert.equal(out.code, "email_not_confirmed");
  assert.equal(out.message, NOT_CONFIRMED_MESSAGE);
  assert.equal(out.message, "Email not confirmed yet. Check your inbox and tap the link, then come back here.");
  assert.equal(out.resend, true);
});

test("only email-not-confirmed offers the resend button", () => {
  for (const code of ["invalid_credentials", "captcha_failed", "over_request_rate_limit", "user_banned"]) {
    assert.equal(authFailure(apiError(code, "x"), "signin").resend, false, code);
  }
});

test("Supabase's own wording never reaches the screen", () => {
  const cases = [
    apiError("invalid_credentials", "Invalid login credentials"),
    apiError("email_not_confirmed", "Email not confirmed"),
    apiError("captcha_failed", "captcha protection: request disallowed (timeout-or-duplicate)"),
    apiError("validation_failed", "Unable to validate email address: invalid format"),
    apiError("user_banned", "User is banned"),
    apiError("over_request_rate_limit", "Request rate limit reached", 429),
    apiError("user_already_exists", "User already registered", 422),
    apiError("email_address_invalid", 'Email address "x@y" is invalid'),
    apiError("over_email_send_rate_limit", "For security purposes, you can only request this after 42 seconds.", 429),
    apiError("something_new", "Some new server wording"),
  ];
  for (const err of cases) {
    for (const step of ["signin", "signup", "reset", "resend", "newpassword"]) {
      const { message } = authFailure(err, step);
      // Our own sentence, always ending with what to do: never Supabase's line as it came.
      assert.ok(message && message !== err.message && /[.!]$/.test(message), `${err.code} / ${step}: ${message}`);
    }
  }
});

test("wrong password says what to do next", () => {
  const { message } = authFailure(apiError("invalid_credentials", "Invalid login credentials"), "signin");
  assert.match(message, /don't match/);
  assert.match(message, /Forgot password/);
});

test("old servers with no code are read from the wording", () => {
  assert.equal(authErrorCode({ message: "Invalid login credentials", status: 400 }), "invalid_credentials");
  assert.equal(authErrorCode({ message: "Email not confirmed", status: 400 }), "email_not_confirmed");
  assert.equal(authErrorCode({ message: "captcha protection: request disallowed", status: 400 }), "captcha_failed");
  assert.equal(authFailure({ message: "Email not confirmed", status: 400 }, "signin").resend, true);
});

test("no signal and server trouble are told apart", () => {
  assert.equal(authErrorCode({ name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 }), "network");
  assert.equal(authErrorCode({ name: "AuthRetryableFetchError", message: "Bad gateway", status: 502 }), "server");
  assert.equal(authErrorCode({ name: "AuthUnknownError", message: "oops", status: 500 }), "server");
  assert.match(authFailure({ name: "AuthRetryableFetchError", message: "Load failed", status: 0 }, "signin").message, /signal/);
});

test("weak passwords: a leaked one is called out", () => {
  const pwned = { name: "AuthWeakPasswordError", code: "weak_password", message: "Password is known to be weak", status: 422, reasons: ["pwned"] };
  assert.match(authFailure(pwned, "signup").message, /data leak/);
  const short = { ...pwned, reasons: ["length"] };
  assert.match(authFailure(short, "signup").message, /too easy to guess/);
});

test("a run-out reset link says so", () => {
  const missing = { name: "AuthSessionMissingError", message: "Auth session missing!", status: 400 };
  assert.match(authFailure(missing, "newpassword").message, /reset link has run out/);
});

test("no error message ever names an email address other than ours", () => {
  const src = read("lib/authMessages.js");
  const emails = src.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  assert.deepEqual([...new Set(emails)], ["admin@plotwire.uk"]);
});

// Typical user agents for each app (format as the apps send them).
const UA = {
  instagramAndroid: "Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 Instagram 352.0.0.38.100 Android (34/14; 450dpi; 1080x2340; samsung; SM-S918B; dm3q; qcom; en_GB; 650786063)",
  instagramIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 345.0.0.32.97 (iPhone15,2; iOS 17_6; en_GB; en-GB; scale=3.00; 1179x2556; 631129587)",
  facebookAndroid: "Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/118.0.5993.111 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/439.0.0.44.117;]",
  facebookIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/440.0.0.33.116;FBBV/545000000;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.1;FBSS/3;FBID/phone;FBLC/en_GB;FBOP/5]",
  messengerAndroid: "Mozilla/5.0 (Linux; Android 13; SM-A536B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/118.0.5993.80 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/431.0.0.29.108;]",
  tiktokAndroid: "Mozilla/5.0 (Linux; Android 13; SM-G991B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36 trill_310903 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly app_version/31.9.3 ByteLocale/en-GB BytedanceWebview/d8a21c6",
  tiktokIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_31.5.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/en Region/GB isDarkMode/0 WKWebView/1 RevealType/Dialog BytedanceWebview/d8a21c6",
  chromeAndroid: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  safariIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
  chromeDesktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  gmailAndroidTab: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
};

test("Instagram, Facebook, Messenger and TikTok are spotted, with the phone type", () => {
  assert.deepEqual(detectInAppBrowser(UA.instagramAndroid), { app: "Instagram", os: "android" });
  assert.deepEqual(detectInAppBrowser(UA.instagramIos), { app: "Instagram", os: "ios" });
  assert.deepEqual(detectInAppBrowser(UA.facebookAndroid), { app: "Facebook", os: "android" });
  assert.deepEqual(detectInAppBrowser(UA.facebookIos), { app: "Facebook", os: "ios" });
  assert.deepEqual(detectInAppBrowser(UA.messengerAndroid), { app: "Messenger", os: "android" });
  assert.deepEqual(detectInAppBrowser(UA.tiktokAndroid), { app: "TikTok", os: "android" });
  assert.deepEqual(detectInAppBrowser(UA.tiktokIos), { app: "TikTok", os: "ios" });
});

test("ordinary browsers get no banner", () => {
  for (const key of ["chromeAndroid", "safariIos", "chromeDesktop", "gmailAndroidTab"]) {
    assert.equal(detectInAppBrowser(UA[key]), null, key);
  }
  assert.equal(detectInAppBrowser(""), null);
  assert.equal(detectInAppBrowser(undefined), null);
});

test("?inapp=instagram shows the banner in any browser, for testing", () => {
  assert.deepEqual(detectInAppBrowser(UA.chromeDesktop, "?inapp=instagram"), { app: "Instagram", os: "other" });
  assert.deepEqual(detectInAppBrowser(UA.chromeAndroid, "?login=1&inapp=tiktok"), { app: "TikTok", os: "android" });
  assert.equal(detectInAppBrowser(UA.chromeDesktop, "?inapp=nonsense"), null);
});

test("the menu item hint matches the phone", () => {
  assert.equal(openInBrowserLabel("android"), "Open in Chrome");
  assert.equal(openInBrowserLabel("ios"), "Open in Safari");
  assert.equal(openInBrowserLabel("other"), "Open in external browser");
});

test("in-app bridge errors are dropped from Sentry", () => {
  for (const msg of [
    "Error: Java object is gone",
    "Error invoking postMessage: Java object is gone",
    "Error invoking postMessage: Java exception was raised during method invocation",
    "Java bridge method invocation error",
    "ReferenceError: Can't find variable: _AutofillCallbackHandler",
    "ReferenceError: Can't find variable: _pcmBridgeCallbackHandler",
  ]) {
    assert.equal(isInAppBridgeNoise(msg), true, msg);
  }
});

test("Plotwire's own errors, including its postMessage use, still reach Sentry", () => {
  for (const msg of [
    "DataCloneError: Failed to execute 'postMessage' on 'BroadcastChannel'",
    "TypeError: Cannot read properties of undefined (reading 'postMessage')",
    "TypeError: Failed to fetch",
    "Invalid login credentials",
  ]) {
    assert.equal(isInAppBridgeNoise(msg), false, msg);
  }
});

test("the browser's Sentry setup uses the filter and the tag", () => {
  const src = read("instrumentation-client.ts");
  assert.match(src, /ignoreErrors:\s*IN_APP_BRIDGE_ERRORS/);
  assert.match(src, /in_app_browser/);
});

test("the sign-in screen shows the banner and never Supabase's raw message", () => {
  const src = read("components/LoginScreen.jsx");
  assert.match(src, /<InAppBrowserBanner \/>/);
  assert.doesNotMatch(src, /error\.message/);
  assert.match(src, /supabase\.auth\.resend\(/);
});

test("Sentry gets a report for email not confirmed, no connection and unmapped errors", () => {
  const reported = [
    apiError("email_not_confirmed", "Email not confirmed"),
    { name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 },
    apiError("request_timeout", "Processing this request timed out", 504),
    apiError("otp_expired", "Token has expired or is invalid", 403),
    apiError("something_new", "Some new server wording"),
    { message: "" },
  ];
  for (const err of reported) {
    for (const step of ["signin", "signup", "reset", "resend", "newpassword"]) {
      assert.equal(authFailure(err, step).report, true, `${err.code || err.name} / ${step}`);
    }
  }
});

test("a wrong password, and every other known refusal, sends no report", () => {
  const quiet = [
    apiError("invalid_credentials", "Invalid login credentials"),
    { message: "Invalid login credentials", status: 400 }, // old server, no code
    apiError("captcha_failed", "captcha protection: request disallowed"),
    apiError("over_request_rate_limit", "Request rate limit reached", 429),
    apiError("over_email_send_rate_limit", "email rate limit exceeded", 429),
    apiError("user_already_exists", "User already registered", 422),
    apiError("weak_password", "Password is known to be weak", 422),
    apiError("email_address_invalid", "Email address is invalid"),
    apiError("validation_failed", "Unable to validate email address: invalid format"),
    apiError("user_banned", "User is banned"),
    { name: "AuthRetryableFetchError", message: "Bad gateway", status: 502 },
  ];
  for (const err of quiet) {
    for (const step of ["signin", "signup", "reset", "resend", "newpassword"]) {
      assert.equal(authFailure(err, step).report, false, `${err.code || err.message} / ${step}`);
    }
  }
});

test("a report never carries an email address", () => {
  const extra = authReportExtra(apiError("something_new", 'Account "jo.bloggs+test@example.co.uk" needs attention', 400));
  assert.equal(extra.message, 'Account "[email]" needs attention');
  assert.equal(extra.error_name, "AuthApiError");
  assert.equal(extra.status, 400);
  assert.doesNotMatch(JSON.stringify(authReportExtra({ message: "a@b.com and c.d@e.org.uk" })), /@/);
  assert.equal(authReportExtra(null).message, "");

  // The sign-in screen's report sends only the code, step and browser type,
  // plus the redacted details: never what was typed in.
  const src = read("components/LoginScreen.jsx");
  const call = src.slice(src.indexOf("Sentry.captureMessage("), src.indexOf("});", src.indexOf("Sentry.captureMessage(")));
  assert.match(call, /auth_reason: code/);
  assert.match(call, /in_app_browser: inAppBrowserTag\(/);
  assert.match(call, /extra: authReportExtra\(err\)/);
  assert.doesNotMatch(call, /\bemail\b|sentTo|password/);
});

test("the in_app_browser tag", () => {
  assert.equal(inAppBrowserTag(UA.instagramAndroid), "instagram");
  assert.equal(inAppBrowserTag(UA.messengerAndroid), "messenger");
  assert.equal(inAppBrowserTag(UA.tiktokIos), "tiktok");
  assert.equal(inAppBrowserTag(UA.chromeAndroid), "no");
  assert.equal(inAppBrowserTag(""), "no");
});

test("the Coming Soon page doesn't call Plotwire a design tool", () => {
  const src = read("components/ComingSoon.jsx");
  assert.doesNotMatch(src, /design/i);
  assert.match(src, /Electrical layouts &amp; quoting/);
});
