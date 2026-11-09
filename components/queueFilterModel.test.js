import { test } from "node:test";
import assert from "node:assert/strict";

import { QUEUE_FILTERS, applyQueueFilter, headroomOf, sortByRisk } from "./queueFilterModel.ts";

// ------------------------------------------------------------ QUEUE_FILTERS

test("QUEUE_FILTERS: exactly 5 entries, in this order, with these exact labels", () => {
  assert.deepEqual(QUEUE_FILTERS, [
    { key: "all", label: "All loans" },
    { key: "needs_review", label: "Needs review" },
    { key: "breaches", label: "Breaches" },
    { key: "compliant", label: "In compliance" },
    { key: "terms", label: "Terms approval" },
  ]);
});

// -------------------------------------------------------- applyQueueFilter

const ROWS = [
  { facilityId: "f-harbor", borrower: "Harbor Logistics", status: "breach_investigate", hasApprovedTerms: true, ours: 1.12, required: 1.25, theirs: 1.3 },
  { facilityId: "f-north", borrower: "Northgate Foods", status: "decided", hasApprovedTerms: true, ours: 1.08, required: 1.25, theirs: 1.31 },
  { facilityId: "f-peats", borrower: "Peat's Coffee Company", status: "compliant", hasApprovedTerms: true, ours: 1.19, required: 1.1, theirs: 1.19 },
  { facilityId: "f-aurora", borrower: "Aurora Textiles", status: "not_tested", hasApprovedTerms: false, ours: null, required: null, theirs: null },
  { facilityId: "f-coastal", borrower: "Coastal Marine", status: "in_review", hasApprovedTerms: true, ours: 1.12, required: 1.25, theirs: 1.12 },
];

const idsOf = (rows) => rows.map((r) => r.facilityId);

test("applyQueueFilter: 'all' applies no status filter", () => {
  assert.deepEqual(idsOf(applyQueueFilter(ROWS, "all", "")), idsOf(ROWS));
});

test("applyQueueFilter: 'needs_review' returns only in_review rows", () => {
  assert.deepEqual(idsOf(applyQueueFilter(ROWS, "needs_review", "")), ["f-coastal"]);
});

test("applyQueueFilter: 'breaches' returns breach_investigate and in_review, never decided", () => {
  assert.deepEqual(idsOf(applyQueueFilter(ROWS, "breaches", "")), ["f-harbor", "f-coastal"]);
});

test("applyQueueFilter: 'compliant' returns only the compliant row", () => {
  assert.deepEqual(idsOf(applyQueueFilter(ROWS, "compliant", "")), ["f-peats"]);
});

test("applyQueueFilter: 'terms' returns only the row with no approved terms", () => {
  assert.deepEqual(idsOf(applyQueueFilter(ROWS, "terms", "")), ["f-aurora"]);
});

test("applyQueueFilter: a query narrows by borrower, case-insensitively, after the status filter", () => {
  assert.deepEqual(idsOf(applyQueueFilter(ROWS, "all", "coastal")), ["f-coastal"]);
  assert.deepEqual(idsOf(applyQueueFilter(ROWS, "all", "COASTAL")), ["f-coastal"]);
  // narrows regardless of which status filter is active, as long as the row survives it
  assert.deepEqual(idsOf(applyQueueFilter(ROWS, "breaches", "coastal")), ["f-coastal"]);
});

test("applyQueueFilter: a query matching nothing returns an empty array", () => {
  assert.deepEqual(applyQueueFilter(ROWS, "all", "zzz"), []);
});

// -------------------------------------------------------------- headroomOf

test("headroomOf: negative headroom, signed and 2dp", () => {
  assert.deepEqual(headroomOf(1.12, 1.25), { text: "-0.13x", tone: "neg" });
});

test("headroomOf: positive headroom, signed and 2dp", () => {
  assert.deepEqual(headroomOf(1.59, 1.35), { text: "+0.24x", tone: "pos" });
});

test("headroomOf: null when either figure is missing", () => {
  assert.equal(headroomOf(null, 1.25), null);
  assert.equal(headroomOf(1.1, null), null);
});

// -------------------------------------------------------------- sortByRisk

test("sortByRisk: worst headroom first, tied headroom broken by drift, missing figures last — the real book's shape", () => {
  const northgate = { facilityId: "f-north", borrower: "Northgate Foods", status: "decided", ours: 1.08, required: 1.25, theirs: 1.31 };
  const coastal = { facilityId: "f-coastal", borrower: "Coastal Marine", status: "breach_investigate", ours: 1.12, required: 1.25, theirs: 1.12 };
  const harbor = { facilityId: "f-harbor", borrower: "Harbor Logistics", status: "in_review", ours: 1.12, required: 1.25, theirs: 1.12 };
  const peats = { facilityId: "f-peats", borrower: "Peat's Coffee Company", status: "compliant", ours: 1.19, required: 1.1, theirs: 1.19 };
  const testqq = { facilityId: "f-testqq", borrower: "testqq", status: "not_tested", ours: null, required: null, theirs: null };

  const input = [testqq, peats, harbor, coastal, northgate];
  const drift = new Map([
    ["f-coastal", true],
    ["f-harbor", false],
  ]);

  const sorted = sortByRisk(input, drift);
  assert.deepEqual(idsOf(sorted), ["f-north", "f-coastal", "f-harbor", "f-peats", "f-testqq"]);
});

test("sortByRisk: does not mutate its input array", () => {
  const a = { facilityId: "a", borrower: "A", status: "compliant", ours: 1.5, required: 1.1, theirs: 1.5 };
  const b = { facilityId: "b", borrower: "B", status: "breach_investicate", ours: 1.0, required: 1.25, theirs: 1.0 };
  const input = [a, b];
  const before = idsOf(input);
  const result = sortByRisk(input, new Map());
  assert.deepEqual(idsOf(input), before, "the input array's order must be unchanged");
  assert.notEqual(result, input, "a new array must be returned");
});
