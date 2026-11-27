// Remove the email check (branch remove-email-check, 27 Nov 2026): Plotwire's
// confirmation emails didn't reliably arrive and were stopping people paying,
// so confirming an email address is no longer part of the customer journey.
// Subscribe goes straight to Stripe; there's no dashboard note and nothing is
// emailed. The tables and the confirm page stay in place, unused.
// Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const path = (f) => new URL(`../${f}`, import.meta.url);
const read = (f) => readFileSync(path(f), "utf8");

test("checkout goes to Stripe without asking about the email address", () => {
  const route = read("app/api/billing/checkout/route.js");
  assert.doesNotMatch(route, /isEmailConfirmed|emailConfirm|confirmEmail|CONFIRM_MESSAGES/);
  // Still: signed in, and not a Timesheets worker's login, then Stripe.
  const signedIn = route.indexOf("userFromToken(bearer(req))");
  const operative = route.indexOf("isOperativeUser(user)");
  const stripe = route.indexOf("beginCheckout(user");
  assert.ok(signedIn > 0 && operative > signedIn && stripe > operative);
});

test("the Subscribe screen always shows Subscribe, straight to checkout", () => {
  const pay = read("components/Paywall.jsx");
  assert.doesNotMatch(pay, /needsConfirm|emailConfirm|confirmEmail|CONFIRM_MESSAGES|Resend link|confirm-box/);
  assert.match(pay, /onClick=\{overdue \? payInBilling : choose\}/);
  assert.match(pay, /await startCheckout\(\)/);
  assert.doesNotMatch(read("lib/billingClient.js"), /confirmEmail/);
});

test("no confirm-your-email note on the dashboard, and nothing asks or emails", () => {
  assert.doesNotMatch(read("components/HomeScreen.jsx"), /ConfirmEmailBanner|emailConfirm/);
  assert.doesNotMatch(read("components/AppShell.jsx"), /useEmailConfirm|emailConfirm/);
  for (const gone of ["components/ConfirmEmailBanner.jsx", "lib/useEmailConfirm.js", "app/api/account/email/route.js"]) {
    assert.equal(existsSync(path(gone)), false, `${gone} is removed`);
  }
});

test("left in place, unused: the tables' SQL and the confirm page for links already sent", () => {
  for (const f of ["supabase/signup-straight-in.sql", "supabase/signup-straight-in-switch.sql",
    "supabase/signup-straight-in-undo.sql", "app/confirm-email/page.jsx", "app/api/account/confirm-email/route.js"]) {
    assert.equal(existsSync(path(f)), true, `${f} is still there`);
  }
  assert.match(read("components/AppShell.jsx"), /"\/confirm-email",/, "the page still opens signed out");
});

test("unchanged: the security check on sign-up and password reset, and worker invites", () => {
  const login = read("components/LoginScreen.jsx");
  const signUp = login.slice(login.indexOf("const signUp = async"), login.indexOf("const sendReset = async"));
  assert.match(signUp, /\.\.\.captcha,/);
  const reset = login.slice(login.indexOf("const sendReset = async"));
  assert.match(reset, /resetPasswordForEmail\([\s\S]*?\.\.\.captcha,/);
  assert.equal(existsSync(path("app/api/timesheets/join/route.js")), true);
  assert.equal(existsSync(path("app/api/timesheets/team/route.js")), true);
});
