// Sign-up straight in (branch signup-straight-in): people go straight into
// Plotwire after signing up, and only have to confirm their email before they
// subscribe. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  emailConfirmed, supabaseConfirmedByLink, cleanNewEmail, sendAllowed, sendRefusal, confirmLink,
  isConfirmCode, confirmationEmail, linkPage, normEmail, CONFIRM_MESSAGES, CONFIRM_PATH,
  RESEND_WAIT_SECONDS, LINKS_PER_DAY, LINK_DAYS, SUPABASE_LINK_SECONDS,
} from "../lib/emailConfirm.js";

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const at = (iso, plusSeconds = 0) => new Date(new Date(iso).getTime() + plusSeconds * 1000).toISOString();
const MADE = "2026-11-25T10:00:00.000Z";

test("with no Plotwire record, Supabase's own counts only when someone clicked a link", () => {
  // "Confirm email" off: Supabase marks the account confirmed as it makes it.
  const autoConfirmed = { email: "a@b.co", created_at: MADE, email_confirmed_at: at(MADE, 0.004) };
  assert.equal(emailConfirmed(autoConfirmed, null), false);
  // Clicked Supabase's link (or a reset link) some time after signing up.
  const clicked = { email: "a@b.co", created_at: MADE, email_confirmed_at: at(MADE, 95) };
  assert.equal(emailConfirmed(clicked, null), true);
  assert.equal(supabaseConfirmedByLink({ created_at: MADE, email_confirmed_at: at(MADE, SUPABASE_LINK_SECONDS) }), true);
  assert.equal(supabaseConfirmedByLink({ created_at: MADE, email_confirmed_at: at(MADE, SUPABASE_LINK_SECONDS - 1) }), false);
  assert.equal(supabaseConfirmedByLink({ created_at: MADE, email_confirmed_at: null }), false);
  assert.equal(emailConfirmed({ email: "", created_at: MADE, email_confirmed_at: at(MADE, 99) }, null), false);
});

test("a Plotwire record decides when there is one, and only for the address the account has now", () => {
  const user = { email: "Jo@Example.co.uk", created_at: MADE, email_confirmed_at: at(MADE, 3600) };
  assert.equal(emailConfirmed(user, { email: "jo@example.co.uk", confirmed_at: at(MADE, 60) }), true);
  // Stuck accounts let in at the switch-over: Supabase says confirmed, the row says not yet.
  assert.equal(emailConfirmed(user, { email: "jo@example.co.uk", confirmed_at: null }), false);
  // Confirmed for an old address, then changed: not confirmed for the new one.
  assert.equal(emailConfirmed(user, { email: "old@example.co.uk", confirmed_at: at(MADE, 60) }), false);
});

test("Change email: a full address, and a different one", () => {
  assert.deepEqual(cleanNewEmail("  New@Example.CO.uk ", "old@example.co.uk"), { value: "new@example.co.uk" });
  assert.ok(cleanNewEmail("nope", "old@example.co.uk").error);
  assert.ok(cleanNewEmail("Old@Example.co.uk", "old@example.co.uk").error);
  assert.equal(normEmail(" A@B.Co "), "a@b.co");
});

test("links: one a minute, and a cap per day", () => {
  const now = Date.parse("2026-11-25T12:00:00Z");
  assert.deepEqual(sendAllowed([], now), { ok: true });
  const justNow = sendAllowed([new Date(now - 20_000).toISOString()], now);
  assert.equal(justNow.ok, false);
  assert.equal(justNow.reason, "wait");
  assert.equal(justNow.retryAfterSec, RESEND_WAIT_SECONDS - 20);
  assert.equal(sendRefusal(justNow), CONFIRM_MESSAGES.WAIT);
  const many = Array.from({ length: LINKS_PER_DAY }, (_, i) => new Date(now - (i + 2) * 3600_000).toISOString());
  const capped = sendAllowed(many, now);
  assert.equal(capped.reason, "limit");
  assert.equal(sendRefusal(capped), CONFIRM_MESSAGES.LIMIT);
  // Yesterday's don't count.
  assert.deepEqual(sendAllowed(many.map((t) => new Date(Date.parse(t) - 24 * 3600_000).toISOString()), now), { ok: true });
});

test("the link: the app's own page, a 43-character code, works for a week", () => {
  assert.equal(confirmLink("https://app.plotwire.uk", "A".repeat(43)), `https://app.plotwire.uk${CONFIRM_PATH}?code=${"A".repeat(43)}`);
  assert.equal(isConfirmCode("a-b_C".padEnd(43, "x")), true);
  assert.equal(isConfirmCode("short"), false);
  assert.equal(isConfirmCode("x".repeat(42) + "!"), false);
  assert.equal(LINK_DAYS, 7);
});

test("the email: their first name, the link, plain words, nothing unescaped", () => {
  const link = "https://app.plotwire.uk/confirm-email?code=" + "b".repeat(43);
  const mail = confirmationEmail({ name: "Sam <b>Spark</b>", link });
  assert.equal(mail.subject, "Confirm your email for Plotwire");
  assert.ok(mail.text.includes(link) && mail.html.includes(link));
  assert.ok(mail.text.startsWith("Hi Sam"));
  assert.equal(mail.html.includes("<b>Spark"), false);
  assert.ok(confirmationEmail({ link }).text.startsWith("Hi there"));
  // An electrical layout tool: no sizing, design or compliance wording.
  assert.doesNotMatch(mail.text + mail.html, /\b(design|compliance|compliant|sizing|regulation)/i);
  // No link to the electrical business behind it.
  assert.doesNotMatch(mail.text + mail.html, /watts|wattson/i);
});

test("the link page says what happened, and never whose address it was", () => {
  for (const s of ["confirmed", "already"]) assert.equal(linkPage(s).ok, true);
  for (const s of ["expired", "changed", "invalid", "failed", "nonsense"]) assert.equal(linkPage(s).ok, false);
  assert.match(linkPage("expired").text, /Resend/);
});

// ---- the app and server, checked in their source (they need a browser / Supabase)

// The check before paying, the dashboard note and the sending were taken out
// by remove-email-check: tests/remove-email-check.test.mjs.

test("the confirmation link works signed out, in any browser", () => {
  assert.match(read("components/AppShell.jsx"), /"\/confirm-email",/);
  const confirmRoute = read("app/api/account/confirm-email/route.js");
  assert.doesNotMatch(confirmRoute, /bearer\(|userFromToken/);
  assert.doesNotMatch(confirmRoute, /email:/, "it never answers with the address");
  // Only a fingerprint of the code is stored.
  assert.match(read("lib/emailConfirmServer.js"), /createHash\("sha256"\)/);
});

test("sign-up keeps its security check, and goes straight in when Supabase gives a session", () => {
  const login = read("components/LoginScreen.jsx");
  const signUp = login.slice(login.indexOf("const signUp = async"), login.indexOf("const sendReset = async"));
  assert.match(signUp, /\.\.\.captcha,/);
  assert.match(signUp, /if \(data\?\.user && !data\?\.session\)/);
});

test("the database files: server only, a self-check, an undo, no real addresses", () => {
  const sql = read("supabase/signup-straight-in.sql");
  for (const t of ["email_confirmations", "email_confirm_links"]) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security;`));
    assert.match(sql, new RegExp(`revoke all on table public\\.${t} from anon, authenticated;`));
  }
  assert.match(sql, /self-check failed/);
  assert.match(read("supabase/signup-straight-in-undo.sql"), /drop table public\.email_confirmations;/);
  const sw = read("supabase/signup-straight-in-switch.sql");
  // The "not confirmed yet" rows are written before anyone is let in.
  assert.ok(sw.indexOf("insert into public.email_confirmations") < sw.indexOf("update auth.users"));
  const everything = ["", "-switch", "-undo", "-test", "-test-account"]
    .map((s) => read(`supabase/signup-straight-in${s}.sql`)).join("\n");
  const addresses = everything.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  assert.deepEqual(addresses.filter((a) => !/@example\.invalid$/i.test(a)), []);
  assert.match(read("supabase/signup-straight-in-test-account.sql"), /TEST_EMAIL_HERE/);
});
