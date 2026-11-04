// The daily billing check must read the database fresh (see the comment on
// fetchCache in app/api/admin/reconcile/route.js). Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the reconciliation route opts out of Next's fetch cache", () => {
  const route = readFileSync(new URL("../app/api/admin/reconcile/route.js", import.meta.url), "utf8");
  assert.match(route, /^export const fetchCache = "force-no-store";$/m);
});
