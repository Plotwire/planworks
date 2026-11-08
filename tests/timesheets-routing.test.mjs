// A Timesheets operative gets their own screen and is kept away from everything
// that belongs to a paying owner. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { isOperativeUser } from "../lib/timesheets/operative.js";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("only the marker the server sets makes a login an operative", () => {
  assert.equal(isOperativeUser({ app_metadata: { plotwire_kind: "operative" } }), true);
  // A signed-in person can write their own user_metadata.
  assert.equal(isOperativeUser({ user_metadata: { plotwire_kind: "operative" } }), false);
  assert.equal(isOperativeUser({ app_metadata: { plotwire_kind: "owner" } }), false);
  assert.equal(isOperativeUser({ app_metadata: {} }), false);
  assert.equal(isOperativeUser({}), false);
  assert.equal(isOperativeUser(null), false);
  assert.equal(isOperativeUser(undefined), false);
});

for (const route of ["checkout", "portal", "sync"]) {
  test(`the billing ${route} route refuses operatives before doing anything`, () => {
    const body = read(`app/api/billing/${route}/route.js`).split("export async function POST")[1];
    const signedIn = body.indexOf("if (!user)");
    const refused = body.indexOf("if (isOperativeUser(user))");
    const firstWork = body.search(/allowStart\(|allowSync\(|getSupabaseAdmin\(\)|getStripe\(\)|beginCheckout\(|refreshFromStripe\(/);
    assert.ok(signedIn >= 0 && refused > signedIn, "refused straight after the sign-in check");
    assert.ok(firstWork > refused, "refused before Stripe, the database or the rate limit");
    assert.match(body, /isOperativeUser\(user\)\) return NextResponse\.json\(\{ error: NOT_FOR_OPERATIVES \}, \{ status: 403 \}\)/);
  });
}

test("an operative's screen comes before every owner-only gate", () => {
  const shell = read("components/AppShell.jsx");
  const signedOut = shell.indexOf("if (!session) {");
  const operative = shell.indexOf("if (operative) return <OperativeApp");
  const terms = shell.indexOf('if (termsStep === "unknown")');
  assert.ok(signedOut >= 0 && operative > signedOut, "after the sign-in check");
  assert.ok(terms > operative, "before the terms, billing and company details");
});

test("the owner-only steps are told nobody is signed in for an operative", () => {
  const shell = read("components/AppShell.jsx");
  assert.match(shell, /const ownerSession = operative \? null : session;/);
  assert.match(shell, /useSubscription\(BILLING_ENABLED \? ownerSession : null\)/);
  assert.match(shell, /userId: ownerSession\?\.user\?\.id \|\| null/);
  assert.match(shell, /const sessionUserId = ownerSession\?\.user\?\.id \|\| null;/);
  assert.match(shell, /const user = ownerSession\?\.user;/);
  assert.match(shell, /const uid = ownerSession\?\.user\?\.id;/);
});

test("an operative's sign-out leaves this device's saved work alone", () => {
  const app = read("components/timesheets/OperativeApp.jsx");
  assert.doesNotMatch(app, /lib\/device|deviceData/);
  assert.match(app, /auth\.signOut\(\)/);
});

test("the operative address exists", () => {
  assert.equal(existsSync(new URL("../app/time/page.jsx", import.meta.url)), true);
});
