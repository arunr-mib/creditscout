import { test } from "node:test";
import assert from "node:assert/strict";

import { LOCKED_KEY, lockedBoolean, policyRows } from "./governanceModel.ts";

const SEED = [
  { key: "variance_tolerance", value: 0.05 },
  { key: "escalate_if_breach_margin_over", value: 0.15 },
  { key: "prohibited_actions", value: ["waive covenant", "amend terms", "contact borrower"] },
  { key: "max_steps", value: 8 },
  { key: "require_human_review", value: true },
];

test("every policy row from the table maps to a render row, value carried straight through", () => {
  const rows = policyRows(SEED);
  assert.equal(rows.length, SEED.length);
  for (const seed of SEED) {
    const row = rows.find((r) => r.key === seed.key);
    assert.ok(row, `row for ${seed.key}`);
    assert.deepEqual(row.value, seed.value, `${seed.key} value is read, not invented`);
  }
});

test("require_human_review is flagged locked and routes to the locked kind", () => {
  const row = policyRows(SEED).find((r) => r.key === LOCKED_KEY);
  assert.equal(row.locked, true);
  assert.equal(row.kind, "locked");
});

test("no other key is locked", () => {
  for (const r of policyRows(SEED)) {
    if (r.key !== LOCKED_KEY) assert.equal(r.locked, false, `${r.key} must not be locked`);
  }
});

test("an array value renders as a list, a scalar as a scalar", () => {
  const rows = policyRows(SEED);
  assert.equal(rows.find((r) => r.key === "prohibited_actions").kind, "list");
  assert.equal(rows.find((r) => r.key === "max_steps").kind, "scalar");
});

test("known keys render in the preferred order; an unknown key is appended, never dropped", () => {
  const withExtra = [...SEED, { key: "future_lever", value: 3 }];
  const rows = policyRows(withExtra);
  assert.equal(rows[rows.length - 1].key, "future_lever");
  assert.equal(rows[0].key, "variance_tolerance");
});

test("values are not hardcoded — a different table value flows through", () => {
  const rows = policyRows([{ key: "max_steps", value: 12 }]);
  assert.equal(rows.find((r) => r.key === "max_steps").value, 12);
});

test("lockedBoolean reads the real boolean, and reports null (not a faked true) when absent or non-boolean", () => {
  assert.equal(lockedBoolean(true), true);
  assert.equal(lockedBoolean(false), false);
  assert.equal(lockedBoolean(undefined), null);
  assert.equal(lockedBoolean("true"), null);
  assert.equal(lockedBoolean(1), null);
});

test("a null/garbage rows input yields no rows, not a throw", () => {
  assert.deepEqual(policyRows(null), []);
  assert.deepEqual(policyRows(undefined), []);
  assert.deepEqual(policyRows(42), []);
});
