import { test } from "node:test";
import assert from "node:assert/strict";

import { COUNT_KEY, QUEUE_FILTERS, applyQueueFilter, headroomOf, sortByRisk } from "./queueFilterModel.ts";
import { queueCounts } from "./portfolioModel.ts";

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

test("sortByRisk: worst headroom first within a bucket, tied headroom broken by drift, missing figures last — the real book's shape", () => {
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

  // Open exceptions bucket first (Coastal/Harbor, worse raw headroom than
  // Northgate's displayed -0.17x notwithstanding — a decided breach never
  // outranks open work, owner's call 2026-11-10), decided second, then
  // compliant/untested last.
  const sorted = sortByRisk(input, drift);
  assert.deepEqual(idsOf(sorted), ["f-coastal", "f-harbor", "f-north", "f-peats", "f-testqq"]);
});

test("sortByRisk: a decided breach outranks compliant/untested rows even though it's behind every open exception", () => {
  const decided = { facilityId: "f-decided", borrower: "Decided Co", status: "decided", ours: 1.3, required: 1.4, theirs: 1.3 };
  const open = { facilityId: "f-open", borrower: "Open Co", status: "breach_investigate", ours: 0.5, required: 1.4, theirs: 0.5 };
  const compliant = { facilityId: "f-compliant", borrower: "Compliant Co", status: "compliant", ours: 1.5, required: 1.1, theirs: 1.5 };

  // Decided's own headroom (-0.10) is far better than open's (-0.90), so a
  // pure headroom sort would rank decided ahead of open — the bucket must
  // override that.
  const sorted = sortByRisk([compliant, decided, open], new Map());
  assert.deepEqual(idsOf(sorted), ["f-open", "f-decided", "f-compliant"]);
});

test("sortByRisk: drift tie-break fires even when two loans have different minimums, as long as their displayed headroom is the same", () => {
  // Both round to the same displayed headroom (-0.13x) but have different
  // `required` minimums, so their RAW floating-point differences are not
  // exactly equal (one is -0.1299999999999999, the other -0.13000000000000012
  // — verified in node). Before the fix, `headroomValue` used the raw,
  // unrounded difference, so the comparator saw these as different headrooms
  // and never reached the drift tie-break below — the drift-true loan lost
  // its priority purely to float noise. After the fix, both round to -0.13
  // and the drift tie-break decides, correctly putting the declining loan first.
  const driftTrue = { facilityId: "f-drift-true", borrower: "Drift Co", status: "breach_investigate", ours: 1.12, required: 1.25, theirs: 1.12 };
  const driftFalse = { facilityId: "f-drift-false", borrower: "Steady Co", status: "breach_investigate", ours: 1.22, required: 1.35, theirs: 1.22 };
  const drift = new Map([
    ["f-drift-true", true],
    ["f-drift-false", false],
  ]);

  const sorted = sortByRisk([driftTrue, driftFalse], drift);
  assert.deepEqual(idsOf(sorted), ["f-drift-true", "f-drift-false"]);
});

test("sortByRisk: does not mutate its input array", () => {
  const a = { facilityId: "a", borrower: "A", status: "compliant", ours: 1.5, required: 1.1, theirs: 1.5 };
  const b = { facilityId: "b", borrower: "B", status: "breach_investigate", ours: 1.0, required: 1.25, theirs: 1.0 };
  const input = [a, b];
  const before = idsOf(input);
  const result = sortByRisk(input, new Map());
  assert.deepEqual(idsOf(input), before, "the input array's order must be unchanged");
  assert.notEqual(result, input, "a new array must be returned");
});

// ----------------------------------- pill counts agree with filter results

test("queueCounts and applyQueueFilter agree on every pill's row count — the two must never drift apart", () => {
  // One row of every PortfolioStatus, including both approved- and
  // unapproved-terms variants of "not_tested" (the two reach different
  // `reviewStatusOf` labels but the same status), so every branch of both
  // `queueCounts()` and `applyQueueFilter()` is exercised.
  const rows = [
    { facilityId: "s-breach", borrower: "Breach Co", status: "breach_investigate", hasApprovedTerms: true, ours: 1.1, required: 1.25, theirs: 1.1 },
    { facilityId: "s-review", borrower: "Review Co", status: "in_review", hasApprovedTerms: true, ours: 1.1, required: 1.25, theirs: 1.1 },
    { facilityId: "s-investigating", borrower: "Investigating Co", status: "investigating", hasApprovedTerms: true, ours: 1.1, required: 1.25, theirs: 1.1 },
    { facilityId: "s-paused", borrower: "Paused Co", status: "investigation_paused", hasApprovedTerms: true, ours: 1.1, required: 1.25, theirs: 1.1 },
    { facilityId: "s-awaiting", borrower: "Awaiting Co", status: "awaiting_docs", hasApprovedTerms: true, ours: 1.1, required: 1.25, theirs: 1.1 },
    { facilityId: "s-decided", borrower: "Decided Co", status: "decided", hasApprovedTerms: true, ours: 1.08, required: 1.25, theirs: 1.08 },
    { facilityId: "s-compliant", borrower: "Compliant Co", status: "compliant", hasApprovedTerms: true, ours: 1.3, required: 1.1, theirs: 1.3 },
    { facilityId: "s-not-tested", borrower: "Not Tested Co", status: "not_tested", hasApprovedTerms: true, ours: null, required: null, theirs: null },
    { facilityId: "s-no-terms", borrower: "No Terms Co", status: "not_tested", hasApprovedTerms: false, ours: null, required: null, theirs: null },
  ];
  const counts = queueCounts(rows);
  for (const { key } of QUEUE_FILTERS) {
    assert.equal(
      applyQueueFilter(rows, key, "").length,
      counts[COUNT_KEY[key]],
      `filter "${key}" row count must match queueCounts()["${COUNT_KEY[key]}"]`,
    );
  }
});
