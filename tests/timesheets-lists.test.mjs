// The owner's Jobs and Work types lists, and who gets to see them. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LIMITS, byJobNumber, byWorkTypeOrder, cleanJob, cleanWorkTypeName, nextSortOrder, saveErrorMessage,
} from "../lib/timesheets/rules.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (file) => readFileSync(path.join(root, file), "utf8");

function filesUnder(relative) {
  const full = path.join(root, relative);
  if (!existsSync(full)) return [];
  if (statSync(full).isFile()) return [relative];
  return readdirSync(full).flatMap((name) => filesUnder(path.join(relative, name)));
}

const job = { job_number: "001", job_name: "Test job", site_address: "", default_work_type_id: "type-1" };

test("a job is tidied before saving, with a blank address left empty", () => {
  assert.deepEqual(cleanJob({ ...job, job_number: "  001 ", job_name: " Test job  ", site_address: "  " }), {
    value: { job_number: "001", job_name: "Test job", site_address: null, default_work_type_id: "type-1" },
  });
  assert.equal(cleanJob({ ...job, site_address: " 1 Test Road " }).value.site_address, "1 Test Road");
});

test("a job needs a number and a name", () => {
  assert.equal(cleanJob({ ...job, job_number: "   " }).error, "Enter a job number.");
  assert.equal(cleanJob({ ...job, job_name: "" }).error, "Enter a job name.");
  assert.equal(cleanJob(null).error, "Enter a job number.");
});

test("a job's default work type is optional, and None saves as empty", () => {
  assert.equal(cleanJob({ ...job, default_work_type_id: "" }).error, undefined);
  assert.equal(cleanJob({ ...job, default_work_type_id: "" }).value.default_work_type_id, null);
  assert.equal(cleanJob({ ...job, default_work_type_id: null }).value.default_work_type_id, null);
  assert.equal(cleanJob(job).value.default_work_type_id, "type-1");
});

test("over-long job details are refused", () => {
  assert.match(cleanJob({ ...job, job_number: "x".repeat(LIMITS.jobNumber + 1) }).error, /up to 30/);
  assert.match(cleanJob({ ...job, job_name: "x".repeat(LIMITS.jobName + 1) }).error, /up to 120/);
  assert.match(cleanJob({ ...job, site_address: "x".repeat(LIMITS.siteAddress + 1) }).error, /up to 200/);
  assert.ok(cleanJob({ ...job, job_number: "x".repeat(LIMITS.jobNumber) }).value);
});

test("a work type needs a name of the right length", () => {
  assert.deepEqual(cleanWorkTypeName("  Testing "), { value: "Testing" });
  assert.equal(cleanWorkTypeName("   ").error, "Enter a name for the work type.");
  assert.match(cleanWorkTypeName("x".repeat(LIMITS.workType + 1)).error, /up to 40/);
});

test("the limits match the database", () => {
  const sql = read("supabase/timesheets.sql");
  assert.match(sql, new RegExp(`job_number\\s+text not null check \\(char_length\\(trim\\(job_number\\)\\) between 1 and ${LIMITS.jobNumber}\\)`));
  assert.match(sql, new RegExp(`job_name\\s+text not null check \\(char_length\\(trim\\(job_name\\)\\) between 1 and ${LIMITS.jobName}\\)`));
  assert.match(sql, new RegExp(`site_address text check \\(char_length\\(site_address\\) <= ${LIMITS.siteAddress}\\)`));
  assert.match(sql, new RegExp(`name\\s+text not null check \\(char_length\\(trim\\(name\\)\\) between 1 and ${LIMITS.workType}\\)`));
});

test("jobs sort by number as people read them", () => {
  const sorted = (list) => list.map((job_number) => ({ job_number })).sort(byJobNumber).map((j) => j.job_number);
  assert.deepEqual(sorted(["10", "2", "1"]), ["1", "2", "10"]);
  assert.deepEqual(sorted(["002", "001", "010"]), ["001", "002", "010"]);
});

test("work types keep their order and a new one goes last", () => {
  const types = [{ name: "B", sort_order: 2 }, { name: "A", sort_order: 1 }, { name: "C", sort_order: 2 }];
  assert.deepEqual([...types].sort(byWorkTypeOrder).map((t) => t.name), ["A", "B", "C"]);
  assert.equal(nextSortOrder(types), 3);
  assert.equal(nextSortOrder([]), 1);
});

test("a refused save says why", () => {
  assert.equal(saveErrorMessage({ code: "23505" }, "Already used."), "Already used.");
  assert.equal(saveErrorMessage({ code: "42501" }, "x"), "Timesheets isn't switched on for this account.");
  assert.equal(saveErrorMessage({ message: "TypeError: Failed to fetch" }, "x"), "Couldn't save. Check your connection and try again.");
  assert.equal(saveErrorMessage({ code: "23514" }, "x"), "Couldn't save. Nothing was changed.");
  assert.equal(saveErrorMessage(null, "x"), "Couldn't save. Nothing was changed.");
});

test("the rail item only shows for accounts with the add-on", () => {
  assert.match(read("components/HomeScreen.jsx"), /timesheets\.status === "on" && <div className="navitem" title="Timesheets"/);
});

test("accounts without the add-on are sent back to the dashboard", () => {
  const home = read("components/timesheets/TimesheetsHome.jsx");
  assert.match(home, /access\.status === "off"\) onNotAllowed/);
});

test("jobs and work types are never deleted from the app", () => {
  assert.doesNotMatch(read("lib/timesheets/lists.js"), /\.delete\(/);
});

test("nothing is hard-coded to one business", () => {
  const code = ["app/time", "app/timesheets", "components/timesheets", "lib/timesheets"].flatMap(filesUnder);
  assert.ok(code.length > 0);
  const offenders = code.filter((file) => /price work|day work|variation|snagging/i.test(read(file)));
  assert.deepEqual(offenders, []);
});
