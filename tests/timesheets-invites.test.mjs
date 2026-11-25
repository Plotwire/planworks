// Worker invites, the invite page, browsing any week, and the worker privacy
// notice. The rules themselves are in the database and proved by
// supabase/timesheets-invites-test.sql; these check the wording, the email,
// and that the code goes the right way round.
// Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cleanInvite, isInviteCode, isUuid, inviteLink, teamMessage, TEAM_MESSAGES, joinProblem, passwordProblem,
  inviteEmail, senderName, chromeIntentFor, JOIN_PATH, INVITE_DAYS,
} from "../lib/timesheets/invites.js";
import { NOTICE_VERSION, noticeText, needsNotice } from "../lib/timesheets/notice.js";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const codeOnly = (text) => text.split("\n").filter((l) => !/^\s*(\/\/|--|\*|\/\*)/.test(l)).join("\n");

// ------------------------------------------------------------- the invite
test("the invite form is tidied and checked", () => {
  assert.deepEqual(cleanInvite({ name: "  Dave   Smith ", email: " Dave@Example.COM " }).value, { name: "Dave Smith", email: "dave@example.com" });
  assert.match(cleanInvite({ name: " ", email: "a@b.co" }).error, /name/);
  assert.match(cleanInvite({ name: "Dave", email: "dave" }).error, /email/);
  assert.match(cleanInvite({ name: "x".repeat(81), email: "a@b.co" }).error, /80/);
  assert.equal(isInviteCode("A".repeat(43)), true);
  assert.equal(isInviteCode("A".repeat(42)), false);
  assert.equal(isInviteCode("A".repeat(42) + "="), false);
  assert.equal(isUuid("0e6f1f9a-2b1c-4a4e-9d43-8f8e9a2b6c10"), true);
  assert.equal(isUuid("1; drop"), false);
  assert.equal(inviteLink("https://app.plotwire.uk", "abc"), "https://app.plotwire.uk/time/join?invite=abc");
  assert.equal(JOIN_PATH, "/time/join");
  assert.equal(INVITE_DAYS, 7);
});

test("refusals are explained in plain words, and a customer's email is refused clearly", () => {
  assert.match(teamMessage({ message: "TS_INVITE_CUSTOMER" }), /own Plotwire customer account.*can't also be someone's worker/);
  assert.match(teamMessage("TS_INVITE_OTHER_COMPANY"), /another company/);
  assert.match(teamMessage("TS_INVITE_TOO_SOON"), /Wait a minute/);
  assert.match(teamMessage("TS_INVITE_ACCEPTED"), /Remove/);
  assert.equal(teamMessage({ message: "something unexpected" }), TEAM_MESSAGES.FAILED);
  assert.equal(passwordProblem("1234567"), "Use a password of at least 8 characters.");
  assert.equal(passwordProblem("12345678"), "");
});

test("the invite page says why a link can't be used", () => {
  assert.match(joinProblem("expired", "Test Electrical").text, /Ask Test Electrical to send it again/);
  assert.equal(joinProblem("invalid").signIn, true);
  assert.match(joinProblem("other", "Test Electrical").text, /can't also be a worker's/);
  assert.match(joinProblem("expired").text, /your employer/);
});

test("the email: the company's name, the link, nothing that can break out of it", () => {
  const mail = inviteEmail({ company: "Smith & Sons <Electrical>\nX", name: "Dave Smith", link: "https://app.plotwire.uk/time/join?invite=abc" });
  assert.equal(mail.subject, "Smith & Sons <Electrical> X has invited you to Plotwire Timesheets");
  assert.doesNotMatch(mail.subject, /[\r\n]/);
  assert.match(mail.text, /^Hi Dave,/);
  assert.match(mail.text, /https:\/\/app\.plotwire\.uk\/time\/join\?invite=abc/);
  assert.match(mail.text, /works for 7 days/);
  assert.match(mail.html, /Smith &amp; Sons &lt;Electrical&gt; X/);
  assert.doesNotMatch(mail.html, /<Electrical>/);
  assert.match(mail.html, /href="https:\/\/app\.plotwire\.uk\/time\/join\?invite=abc"/);
  assert.doesNotMatch(mail.text + mail.html, /£|\bcost\b|\bprice\b|\brate\b/i);
  assert.equal(senderName('Watts "On" <Co>, Ltd'), "Watts On Co Ltd via Plotwire");
  assert.equal(senderName(""), "Plotwire Timesheets");
  assert.equal(inviteEmail({ company: "", name: "", link: "x" }).subject, "Your employer has invited you to Plotwire Timesheets");
});

test("Open in Chrome carries the invite link over on Android", () => {
  assert.equal(
    chromeIntentFor("https://app.plotwire.uk/time/join?invite=abc"),
    "intent://app.plotwire.uk/time/join?invite=abc#Intent;scheme=https;package=com.android.chrome;"
      + "S.browser_fallback_url=https%3A%2F%2Fapp.plotwire.uk%2Ftime%2Fjoin%3Finvite%3Dabc;end",
  );
});

// --------------------------------------------------------- privacy notice
test("the privacy notice: Joe's wording, the company's name filled in, shown once per version", () => {
  assert.equal(
    noticeText("Test Electrical"),
    "Test Electrical uses Plotwire to record the hours you work and the jobs you work on. This is used to manage jobs, "
    + "check hours and for payroll. Only Test Electrical can see your timesheets; other workers can't. Plotwire stores the "
    + "information securely for Test Electrical. Records are kept for up to 6 years for payroll and tax purposes. You can "
    + "ask Test Electrical for a copy of your records, or to correct them, at any time.",
  );
  assert.match(noticeText(""), /^Your employer uses Plotwire/);
  assert.match(noticeText(null), /Only your employer can see/);
  assert.equal(NOTICE_VERSION, "2026-11-25");
  const worker = { role: "operative", addon: true, status: "active" };
  assert.equal(needsNotice({ ...worker, notice_version: "test" }), true);       // the old label
  assert.equal(needsNotice({ ...worker, notice_version: null }), true);
  assert.equal(needsNotice({ ...worker, status: "invited", notice_version: null }), true);
  assert.equal(needsNotice({ ...worker, notice_version: NOTICE_VERSION }), false);
  assert.equal(needsNotice({ role: "owner", addon: true }), false);
  assert.equal(needsNotice({ ...worker, addon: false, notice_version: null }), false);
  assert.equal(needsNotice(null), false);
});

test("the worker sees the notice before their week, records it, and can read it again", () => {
  const src = read("components/timesheets/OperativeApp.jsx");
  assert.match(src, /const noticeFirst = !failed && needsNotice\(ctx\);/);
  assert.match(src, /await activateWorker\(NOTICE_VERSION\);/);
  assert.match(src, /"I understand"/);
  assert.ok(src.indexOf(") : noticeFirst ? (") < src.indexOf(") : ready ? ("));
  assert.match(src, /onClick=\{\(\) => setShowPrivacy\(true\)\}>Privacy</);
  assert.match(read("lib/timesheets/entries.js"), /supabase\.rpc\("timesheet_activate", \{ p_notice_version: version \}\)/);
});

// ------------------------------------------------------------- the server
test("the boss's team route checks who's asking and lets the database decide", () => {
  const src = read("app/api/timesheets/team/route.js");
  assert.match(src, /const user = await userFromToken\(bearer\(req\)\);/);
  assert.match(src, /if \(isOperativeUser\(user\)\) return reply\(\{ error: NOT_FOR_OPERATIVES \}, 403\);/);
  for (const fn of ["timesheet_invite_create", "timesheet_invite_resend", "timesheet_invite_cancel", "timesheet_remove_worker"]) {
    assert.match(src, new RegExp(`admin\\.rpc\\("${fn}", \\{\\s*p_owner: user\\.id`), fn);
  }
  // Remove: only ever a worker's login is deleted, and before the row is marked.
  assert.match(src, /if \(!isOperativeUser\(found\.user\)\) return reply/);
  assert.ok(src.indexOf("deleteUser(op.user_id)") < src.indexOf('admin.rpc("timesheet_remove_worker"'));
  assert.match(src, /\.eq\("owner_id", user\.id\)/);
  // The code goes in the email only; never back to the browser.
  for (const line of src.split("\n").filter((l) => /reply\(\{/.test(l))) assert.doesNotMatch(line, /\bcode\b|\bhash\b/, line);
});

test("the join route: worker logins only, the link used once, a failed join tidied up", () => {
  const src = read("app/api/timesheets/join/route.js");
  assert.match(src, /app_metadata: \{ plotwire_kind: "operative" \}/);
  assert.match(src, /email_confirm: true/);
  assert.match(src, /look\.login === "other" \? "other"/);
  assert.match(src, /if \(made\) await admin\.auth\.admin\.deleteUser\(userId\)/);
  assert.ok(src.indexOf('"timesheet_invite_lookup"') < src.indexOf("createUser("));
  assert.ok(src.indexOf('"timesheet_invite_accept"') < src.indexOf("generateLink("));
  const server = read("lib/timesheets/inviteServer.js");
  assert.match(server, /^import "server-only";/);
  assert.match(server, /createHash\("sha256"\)/);
  assert.match(server, /randomBytes\(32\)\.toString\("base64url"\)/);
  // Nothing personal in the logs.
  for (const line of (server + src).split("\n").filter((l) => /console\.(error|log|warn)/.test(l))) {
    assert.doesNotMatch(line, /email|replyTo|\bto\b\s*[,)]|row\.|look\.|clean\./i, line);
  }
});

test("an invite link opens without Coming Soon, terms or customer set-up", () => {
  const shell = read("components/AppShell.jsx");
  assert.match(shell, /const PUBLIC_PATHS = \[[\s\S]*?"\/time\/join",[\s\S]*?\];/);
  const page = read("components/timesheets/JoinInvite.jsx");
  assert.match(page, /supabase\.auth\.verifyOtp\(\{ token_hash: res\.token_hash, type: "magiclink" \}\)/);
  assert.match(page, /supabase\.auth\.updateUser\(\{ password \}\)/);
  assert.match(page, /router\.replace\(SIGN_IN_PATH\)/);
  assert.match(page, /canOpenInChrome\(inApp\)/);
  assert.match(page, /rest\.delete\("invite"\);\s*window\.history\.replaceState\(/);
});

// --------------------------------------------------------------- the boss
test("Workers: invite, invites waiting with Resend and Cancel, Remove with a yes, any week", () => {
  const src = read("components/timesheets/WorkersPanel.jsx");
  assert.match(src, /Invite worker/);
  assert.match(src, /await inviteWorker\(clean\.value\.name, clean\.value\.email\)/);
  assert.match(src, /act\(o, "resend"\)/);
  assert.match(src, /act\(o, "cancel"\)/);
  assert.match(src, /act\(person, "remove"\)/);
  assert.match(src, /Their hours stay in your records/);
  assert.match(src, /\.filter\(\(o\) => !isWaiting\(o\) && /);
  assert.match(src, /<input type="date" value=\{monday\} max=\{addDays\(thisMonday, 6\)\} onChange=\{\(e\) => goTo\(e\.target\.value\)\} \/>/);
  assert.match(src, /mon > thisMonday \? thisMonday : mon/);
});

// ------------------------------------------------------------- the database
test("the database change only adds, and only the server can use it", () => {
  const sql = read("supabase/timesheets-invites.sql");
  const code = codeOnly(sql);
  assert.doesNotMatch(code, /\bdrop\s+(table|function|policy|trigger|index|column)\b/i);
  assert.doesNotMatch(code, /\btruncate\b|\bdelete\s+from\s+public\.timesheet_(entries|operatives|jobs|work_types|weeks)\b/i);
  assert.doesNotMatch(code, /\bupdate\s+public\.timesheet_entries\b/i);
  assert.match(code, /revoke all on table public\.timesheet_invites from public, anon, authenticated;/);
  for (const fn of ["timesheet_invite_create(uuid, text, text, text)", "timesheet_invite_resend(uuid, uuid, text)",
                    "timesheet_invite_cancel(uuid, uuid)", "timesheet_invite_lookup(text)",
                    "timesheet_invite_accept(text, uuid)", "timesheet_remove_worker(uuid, uuid)"]) {
    assert.ok(code.includes(`revoke all on function public.${fn}`), fn);
    assert.ok(code.includes(`grant execute on function public.${fn}`), fn);
    assert.doesNotMatch(code, new RegExp(`grant execute on function public\\.${fn.replace(/[()]/g, "\\$&")}\\s+to authenticated`));
  }
  assert.match(code, /raise exception 'TS_INVITE_CUSTOMER'/);
  assert.match(code, /raise exception 'TS_LOGIN_NOT_OPERATIVE'/);
  assert.match(code, /before insert or update of user_id on public\.timesheet_operatives/);
  assert.match(code, /<> 25 then/);
  assert.match(code, /ts_invites_before/);
  const undo = codeOnly(read("supabase/timesheets-invites-undo.sql"));
  assert.equal([...undo.matchAll(/\bdrop function public\./g)].length, 7);
  assert.match(undo, /drop table public\.timesheet_invites;/);
  assert.doesNotMatch(undo, /drop table public\.timesheet_(entries|operatives|jobs|work_types|weeks)\b/);
  const t = read("supabase/timesheets-invites-test.sql");
  for (const check of ["the app cannot run", "refuses: ", "a link that ran out cannot be used", "only a login for the invited email can accept",
                       "a worker row cannot link to a customer''s login", "the notice version they saw is recorded",
                       "removing a worker keeps their name and hours", "no more than 30 invites a day"]) {
    assert.ok(t.includes(check), check);
  }
  assert.match(t, /raise exception 'TEST FINISHED: /);
});
