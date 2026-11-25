// The boss's delete tools in Timesheets: jobs, work types, single entries and
// removed workers' records. The rules are in the database and proved by
// supabase/timesheets-delete-test.sql; these check the wording, the order of
// things (password first), and that nothing else can delete.
// Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { hoursPhrase, deleteWarning, deleteTitle, deleteErrorMessage } from "../lib/timesheets/deleting.js";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const codeOnly = (text) => text.split("\n").filter((l) => !/^\s*(\/\/|--|\*|\/\*)/.test(l)).join("\n");

// ------------------------------------------------------------ the wording
test("hours read the way Joe says them", () => {
  assert.equal(hoursPhrase(2520), "42 hours");
  assert.equal(hoursPhrase(60), "1 hour");
  assert.equal(hoursPhrase(510), "8 hours 30 minutes");
  assert.equal(hoursPhrase(90), "1 hour 30 minutes");
  assert.equal(hoursPhrase(30), "30 minutes");
  assert.equal(hoursPhrase(1), "1 minute");
  assert.equal(hoursPhrase(0), "0 minutes");
});

test("the warning says exactly what goes", () => {
  assert.deepEqual(deleteWarning("job", { entries: 12, minutes: 2520, workers: 3 }), [
    "This job has 42 hours from 3 workers. Deleting it deletes those hours permanently.",
    "This can't be undone.",
  ]);
  assert.deepEqual(deleteWarning("job", { entries: 0, minutes: 0, workers: 0 }), [
    "No hours have been recorded against this job.", "This can't be undone.",
  ]);
  assert.deepEqual(deleteWarning("work_type", { entries: 1, minutes: 120, workers: 1, jobs_using: 1 }), [
    "This work type is on 2 hours from 1 worker. Deleting it deletes those hours permanently.",
    "1 job has it as its default work type; it'll be left with no default.",
    "This can't be undone.",
  ]);
  assert.match(deleteWarning("work_type", { entries: 0, jobs_using: 3 })[1], /^3 jobs have it as their default/);
  assert.equal(deleteWarning("worker", { entries: 4, minutes: 600, workers: 1 }, { name: "Dave Smith" })[0],
    "Dave Smith's record has 10 hours. Deleting it deletes those hours permanently.");
  assert.equal(deleteWarning("entry", { entries: 1, minutes: 510, workers: 1 }, { name: "Dave Smith", date: "2026-11-24" })[0],
    "This deletes 8 hours 30 minutes on Tue 24 Nov 2026 for Dave Smith, permanently.");
  assert.equal(deleteTitle("job", "001 – Smith, Driffield"), "Delete job 001 – Smith, Driffield?");
  assert.equal(deleteTitle("worker", "Dave Smith"), "Delete Dave Smith's record?");
  assert.match(deleteErrorMessage({ message: "TS_DELETE_NOT_REMOVED" }), /Remove them first/);
  assert.match(deleteErrorMessage({ message: "TypeError: Failed to fetch" }), /Nothing was deleted/);
  assert.equal(deleteErrorMessage({ message: "something else" }), "Couldn't delete it. Nothing was changed.");
});

// ---------------------------------------------------------- the dialog
test("every delete asks for the password first, like deleting a drawing", () => {
  const src = read("components/timesheets/DeleteDialog.jsx");
  assert.match(src, /import \{ verifyPassword \} from "@\/lib\/db";/);
  assert.match(src, /<Turnstile ref=\{turnstile\} action="delete"/);
  const check = src.indexOf("await verifyPassword(password, captchaToken)");
  const del = src.indexOf("await deleteThing(kind, id)");
  assert.ok(check > 0 && del > check, "the password is checked before anything is deleted");
  assert.match(src.slice(check, del), /if \(!check\.ok\) \{[\s\S]*?return;/);
  assert.match(src, /disabled=\{busy \|\| !preview \|\| !password \|\| captchaPending\(captchaStatus\)\}/);
  // The warning comes from the database's count, with the hours to download first.
  assert.match(src, /previewDelete\(kind, id\)/);
  assert.match(src, /Download Excel first/);
  assert.match(src, /listEntriesFor\(kind, id\)/);
  assert.match(read("lib/timesheets/entries.js"), /supabase\.rpc\("timesheet_delete", \{ p_kind: kind, p_id: id \}\)/);
});

test("jobs and work types: archived ones folded away, and a Delete on each", () => {
  for (const [file, kind] of [["components/timesheets/JobsPanel.jsx", "job"], ["components/timesheets/WorkTypesPanel.jsx", "work_type"]]) {
    const src = read(file);
    assert.match(src, /const \[showArchived, setShowArchived\] = useState\(false\);/, file);
    assert.match(src, /\{showArchived && \(/, file);
    assert.match(src, /aria-expanded=\{showArchived\}/, file);
    assert.match(src, /onClick=\{\(\) => setDeleting\((j|t)\)\}/, file);
    assert.match(src, new RegExp(`<DeleteDialog kind="${kind}"`), file);
    assert.doesNotMatch(src, /\bShowArchived\b/, file);   // the old tick-box
  }
});

test("workers: a clear Removed badge, and only a removed worker's record can be deleted", () => {
  const src = read("components/timesheets/WorkersPanel.jsx");
  assert.match(src, /person\.status === "removed" \? \(\s*<span className="ts-pill is-grey"><UserMinus strokeWidth=\{2\.2\} \/>Removed<\/span>/);
  assert.match(src, /\{person\.status === "removed" && \(\s*<button[\s\S]{0,200}?setDeleting\(\{ kind: "worker"/);
  assert.match(src, /setDeleting\(\{ kind: "entry", id: e\.id/);
  assert.match(read("components/timesheets/TimesheetsHome.jsx"), /\.pw-ts \.ts-pill\.is-grey\{/);
});

test("nothing else in the app deletes Timesheets data", () => {
  // The boss deletes only through timesheet_delete; a worker only their own
  // entry (removeEntry, which the database allows in an open week only).
  const files = readdirSync(new URL("../lib/timesheets/", import.meta.url)).map((f) => `lib/timesheets/${f}`);
  const deletes = files.flatMap((f) => [...codeOnly(read(f)).matchAll(/\.delete\(\)/g)].map(() => f));
  assert.deepEqual(deletes, ["lib/timesheets/entries.js"]);
  assert.match(read("lib/timesheets/entries.js"), /export async function removeEntry\(id\) \{[\s\S]*?from\("timesheet_entries"\)\.delete\(\)/);
});

// ------------------------------------------------------------- the database
test("the database change only adds functions, and only an owner with the add-on can use them", () => {
  const sql = read("supabase/timesheets-delete.sql");
  const code = codeOnly(sql);
  assert.doesNotMatch(code, /\bdrop\s+(table|function|policy|trigger|index|column)\b|\btruncate\b|\balter\s+table\b|\bcreate\s+policy\b|\bcreate\s+table\s+public\./i);
  // Every delete or update sits inside a function, scoped to the signed-in owner.
  const outside = code.replace(/\$\$[\s\S]*?\$\$/g, "");
  assert.doesNotMatch(outside, /\bdelete\s+from\s+public\.|\bupdate\s+public\./i);
  for (const line of code.split("\n").filter((l) => /\bdelete from public\./.test(l))) {
    assert.match(line, /owner_id = me/, line);
  }
  assert.match(code, /if me is null or not public\.ts_addon_active\(me\) then\s+raise exception 'TS_NO_ADDON'/);
  assert.match(code, /raise exception 'TS_DELETE_NOT_REMOVED'/);
  assert.match(code, /delete from public\.timesheet_entry_changes h where h\.owner_id = me and h\.entry_id = any\(ids\);/);
  assert.match(code, /revoke all on function public\.ts_delete_entries\(uuid, text, uuid\)\s+from public, anon, authenticated;/);
  assert.match(code, /revoke all on function public\.timesheet_delete\(text, uuid\)\s+from public, anon;/);
  assert.match(code, /<> b\.functions \+ 3 then/);
  const undo = codeOnly(read("supabase/timesheets-delete-undo.sql"));
  assert.equal([...undo.matchAll(/\bdrop function public\./g)].length, 3);
  assert.doesNotMatch(undo, /\bdrop table\b|\bdelete from\b/i);
  const t = read("supabase/timesheets-delete-test.sql");
  for (const check of ["signed-out visitors cannot delete", "a worker cannot delete a job", "another firm cannot delete this firm''s job",
                       "someone still on the team cannot be deleted", "deleting a job takes its entries and nothing else",
                       "the deleted hours'' history goes too", "deleting a removed worker takes their record and hours only",
                       "a worker still deletes their own entry in an open week", "another firm''s data never changes"]) {
    assert.ok(t.includes(check), check);
  }
});
