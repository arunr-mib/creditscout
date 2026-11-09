import { test } from "node:test";
import assert from "node:assert/strict";

import { driftByFacility, hasDrift } from "./driftModel.ts";

test("hasDrift: no history, or a single quarter, is not drift", () => {
  assert.equal(hasDrift([]), false);
  assert.equal(hasDrift([{ period: "2026-06-30", computed: 1.12 }]), false);
});

test("hasDrift: sorts by period internally — latest below earliest is drift", () => {
  const unsorted = [
    { period: "2025-12-31", computed: 1.41 },
    { period: "2026-06-30", computed: 1.12 },
    { period: "2026-03-31", computed: 1.29 },
  ];
  assert.equal(hasDrift(unsorted), true);
});

test("hasDrift: an unsorted input that only the period sort gets right", () => {
  // Taken as given, the first and last rows are 1.12 and 1.29 (no drift). Sorted, it is 1.41 -> 1.29.
  const unsorted = [
    { period: "2026-06-30", computed: 1.12 },
    { period: "2025-12-31", computed: 1.41 },
    { period: "2026-03-31", computed: 1.29 },
  ];
  assert.equal(hasDrift(unsorted), true);
});

test("hasDrift: does not mutate the caller's array", () => {
  const unsorted = [
    { period: "2026-06-30", computed: 1.12 },
    { period: "2025-12-31", computed: 1.41 },
  ];
  const before = unsorted.map((p) => p.period);
  hasDrift(unsorted);
  assert.deepEqual(unsorted.map((p) => p.period), before);
});

test("hasDrift: latest at or above earliest is improving, not drift", () => {
  assert.equal(
    hasDrift([
      { period: "2026-03-31", computed: 1.1 },
      { period: "2026-06-30", computed: 1.2 },
    ]),
    false,
  );
  assert.equal(
    hasDrift([
      { period: "2026-03-31", computed: 1.2 },
      { period: "2026-06-30", computed: 1.2 },
    ]),
    false,
  );
});

test("hasDrift: a missing computed value at either end is never a decline", () => {
  assert.equal(
    hasDrift([
      { period: "2025-12-31", computed: null },
      { period: "2026-06-30", computed: 1.12 },
    ]),
    false,
  );
  assert.equal(
    hasDrift([
      { period: "2025-12-31", computed: 1.41 },
      { period: "2026-06-30", computed: null },
    ]),
    false,
  );
});

test("driftByFacility: groups by facility and flags only the declining one", () => {
  const coastal = "619d51ba-0000-4000-8000-000000000005";
  const other = "7e2a0c11-0000-4000-8000-000000000001";
  const tests = [
    { facility_id: coastal, test_period_end: "2026-06-30", computed_dscr: 1.12 },
    { facility_id: coastal, test_period_end: "2025-12-31", computed_dscr: 1.41 },
    { facility_id: coastal, test_period_end: "2026-03-31", computed_dscr: 1.29 },
    { facility_id: other, test_period_end: "2026-06-30", computed_dscr: 1.3 },
  ];
  const drift = driftByFacility(tests);
  assert.ok(drift instanceof Map);
  assert.equal(drift.get(coastal), true);
  assert.equal(drift.get(other), false);
});
