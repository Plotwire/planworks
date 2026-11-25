// Timesheets is a paid add-on: only accounts with it switched on ever see it.
// These checks read the code; supabase/timesheets-addon-test.sql proves the
// database side with real accounts (ordinary/Try mode, billing-exempt, paying,
// add-on ended).
// Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (file) => readFileSync(path.join(root, file), "utf8");
const filesUnder = (relative) => {
  const full = path.join(root, relative);
  if (!existsSync(full)) return [];
  if (statSync(full).isFile()) return [relative];
  return readdirSync(full).flatMap((name) => filesUnder(path.join(relative, name)));
};
const codeOnly = (text) => text.split("\n").filter((l) => !/^\s*(\/\/|--|\*|\/\*)/.test(l)).join("\n");

test("the app only treats the add-on as on when the database says so", () => {
  const hook = read("lib/timesheets/useTimesheetsAddon.js");
  assert.match(hook, /supabase\.rpc\("timesheets_context"\)/);
  assert.match(hook, /const on = data\?\.role === "owner" && data\?\.addon === true;/);
  // A failed check is never read as on, and nothing else (Try mode, billing
  // exempt, a subscription) is looked at.
  assert.match(hook, /status: error \? "failed" : on \? "on" : "off"/);
  assert.doesNotMatch(codeOnly(hook), /billing|exempt|subscription|my_access|try_?mode|\bplan\b/i);
});

test("the database's add-on check reads only the add-on list", () => {
  const sql = read("supabase/timesheets.sql");
  const fn = sql.slice(sql.indexOf("create function public.ts_addon_active"), sql.indexOf("$$;", sql.indexOf("create function public.ts_addon_active")));
  assert.match(fn, /from public\.addon_entitlements e/);
  assert.match(fn, /e\.addon = 'timesheets'/);
  assert.match(fn, /e\.ends_at is null or e\.ends_at > now\(\)/);
  assert.doesNotMatch(fn, /billing_exempt|subscriptions|try/i);
});

test("nothing switches the add-on on automatically", () => {
  // No app code writes the add-on list: it's switched on by hand, per account.
  const code = ["app", "components", "lib"].flatMap(filesUnder).filter((f) => /\.(js|jsx|mjs|ts|tsx)$/.test(f));
  assert.ok(code.length > 0);
  assert.deepEqual(code.filter((f) => /addon_entitlements/.test(read(f))), []);
  // No other SQL (Try mode, billing, exempt accounts) touches it.
  const sql = filesUnder("supabase").filter((f) => f.endsWith(".sql") && !/[\\/]timesheets[^\\/]*\.sql$/.test(f));
  assert.ok(sql.length > 0);
  assert.deepEqual(sql.filter((f) => /addon_entitlements/.test(read(f))), []);
});

test("the dashboard rail shows Timesheets only with the add-on", () => {
  const home = read("components/HomeScreen.jsx");
  const items = [...home.matchAll(/title="Timesheets"/g)];
  assert.equal(items.length, 1);
  assert.match(home, /timesheets\.status === "on" && <div className="navitem" title="Timesheets"/);
  // The Timesheets page's own rail is only drawn once the add-on is on.
  const ts = read("components/timesheets/TimesheetsHome.jsx");
  assert.ok(ts.indexOf('if (access.status !== "on") return <AddonOnly') < ts.indexOf('<aside className="ts-rail">'));
});

test("a worker's login only ever gets their own timesheet screen", () => {
  const shell = read("components/AppShell.jsx");
  assert.match(shell, /if \(operative && !isPublic && !recovery && pathname !== OPERATIVE_HOME\) router\.replace\(OPERATIVE_HOME\)/);
  assert.match(read("lib/timesheets/operative.js"), /export const OPERATIVE_HOME = "\/time";/);
});

test("the no-add-on database test covers each kind of account and every refusal", () => {
  const sql = read("supabase/timesheets-addon-test.sql");
  for (const label of ["an ordinary account (Try mode)", "a billing-exempt account", "an account whose add-on has ended", "an account with a paid subscription"]) {
    assert.ok(sql.includes(label), label);
  }
  for (const check of ["is told the add-on is off", "gets empty drop-down lists", "reads none of another account''s Timesheets",
                       "cannot add a job", "cannot add a work type", "cannot add an entry", "cannot switch the add-on on",
                       "cannot read the add-on list", "cannot submit a week", "cannot reopen a week"]) {
    assert.ok(sql.includes(check), check);
  }
  assert.match(sql, /raise exception 'TEST FINISHED: /);
  assert.doesNotMatch(codeOnly(sql), /\bcommit\b/i);
});
