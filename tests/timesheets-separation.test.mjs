// Timesheets is completely separate from the Work Planner. These checks fail
// if the Timesheets install script or any Timesheets code ever mentions it.
// Run: npm test
//
// supabase/timesheets-test.sql is left out on purpose: it reads the planner
// tables to prove an operative sees nothing in them.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const INSTALL = "supabase/timesheets.sql";

// Later batches put their Timesheets code in these folders.
const WATCHED = [
  INSTALL,
  "app/time",
  "app/timesheets",
  "app/api/timesheets",
  "components/timesheets",
  "lib/timesheets",
];

const mentionsPlanner = (text) => /planner/i.test(text);

function filesUnder(relative) {
  const full = path.join(root, relative);
  if (!existsSync(full)) return [];
  if (statSync(full).isFile()) return [relative];
  return readdirSync(full).flatMap((name) => filesUnder(path.join(relative, name)));
}

test("the planner check catches a mention, however it is written", () => {
  assert.equal(mentionsPlanner("select * from planner_jobs"), true);
  assert.equal(mentionsPlanner("the Work Planner list"), true);
  assert.equal(mentionsPlanner("PLANNER"), true);
  assert.equal(mentionsPlanner("timesheet_jobs"), false);
});

test("the Timesheets install script exists", () => {
  assert.equal(existsSync(path.join(root, INSTALL)), true);
});

test("no Timesheets file mentions the planner", () => {
  const offenders = WATCHED.flatMap(filesUnder).filter((file) =>
    mentionsPlanner(readFileSync(path.join(root, file), "utf8")),
  );
  assert.deepEqual(offenders, []);
});
