import { test } from "node:test";
import assert from "node:assert/strict";

import {
  APPROVE_TERMS_FIRST,
  PORTFOLIO_STATUS,
  boardingState,
  computeKpis,
  isReopened,
  portfolioRows,
  runDisabledReason,
  varianceBadge,
  verdictOf,
} from "./portfolioModel.ts";

// ------------------------------------------------------------- the verdict

const row = (over = {}) => ({ computed_dscr: 1.4, passed: true, variance_flagged: false, calc_error: null, ...over });

test("verdictOf: our number clears the threshold and agrees -> compliant", () => {
  assert.equal(verdictOf(row()), "compliant");
});

test("verdictOf: our number fails -> breach, whatever the borrower said", () => {
  assert.equal(verdictOf(row({ computed_dscr: 1.08, passed: false })), "breach");
  // the borrower's figure never enters the classifier
  assert.equal(verdictOf(row({ computed_dscr: 1.08, passed: false, variance_flagged: true })), "breach");
});

test("verdictOf: our number passes but the variance is flagged -> variance, not an alarm", () => {
  assert.equal(verdictOf(row({ variance_flagged: true })), "variance");
});

test("verdictOf: a calc_error, a null DSCR or a null passed is not_computed (never a verdict on 0)", () => {
  assert.equal(verdictOf(row({ calc_error: "missing input: financials.cash_taxes", computed_dscr: null, passed: null })), "not_computed");
  assert.equal(verdictOf(row({ computed_dscr: null, passed: null })), "not_computed");
  assert.equal(verdictOf(row({ passed: null })), "not_computed");
});

// --------------------------------------------------------- variance badge

test("varianceBadge: positive delta means the borrower overstated, and keeps its + sign", () => {
  // borrower reports 1.31, we computed 1.08 -> +0.23
  assert.deepEqual(varianceBadge({ computed: 1.08, reported: 1.31, flagged: true }), { text: "Δ +0.23", flagged: true });
});

test("varianceBadge: a negative delta keeps its sign too", () => {
  assert.deepEqual(varianceBadge({ computed: 1.31, reported: 1.08, flagged: true }), { text: "Δ -0.23", flagged: true });
});

test("varianceBadge: exact agreement is Δ 0.00, never -0.00, and not flagged", () => {
  assert.deepEqual(varianceBadge({ computed: 1.12, reported: 1.12, flagged: false }), { text: "Δ 0.00", flagged: false });
});

test("varianceBadge: absent when there is no borrower figure, or no number of ours", () => {
  assert.equal(varianceBadge({ computed: 1.12, reported: null, flagged: false }), null);
  assert.equal(varianceBadge({ computed: null, reported: 1.12, flagged: false }), null);
});

// ------------------------------------------------------------- boarding

const AMD2 = { title: "Amendment No. 2", doc_type: "amendment", effective_date: "2026-05-01" };

test("boardingState: an amendment on file that the approved terms do not carry -> not_boarded (the F1/F5 twist)", () => {
  const approvedWithout = { terms: { effective_amendments: [] } };
  assert.equal(boardingState(AMD2, approvedWithout), "not_boarded");
  // and with no approved terms at all it still cannot have been boarded
  assert.equal(boardingState(AMD2, null), "not_boarded");
});

test("boardingState: the flag clears once the amendment is boarded, matched by title or by effective date", () => {
  const byTitle = { terms: { effective_amendments: [{ doc: "Amendment No. 2", effective: "2099-01-01", citation: "Amd 2 §1" }] } };
  const byDate = { terms: { effective_amendments: [{ doc: "Some other name", effective: "2026-05-01", citation: "Amd 2 §1" }] } };
  assert.equal(boardingState(AMD2, byTitle), "boarded");
  assert.equal(boardingState(AMD2, byDate), "boarded");
});

test("boardingState: non-amendment documents never carry the flag", () => {
  assert.equal(boardingState({ title: "Credit Agreement", doc_type: "agreement", effective_date: "2024-01-01" }, { terms: { effective_amendments: [] } }), "not_applicable");
  assert.equal(boardingState({ title: "Financials Q2", doc_type: "financials", effective_date: null }, null), "not_applicable");
});

// ----------------------------------------------------------------- KPIs

test("computeKpis: open exceptions, pending review, average steps and facilities tested from seeded rows", () => {
  const k = computeKpis({
    exceptions: [{ status: "new" }, { status: "investigating" }, { status: "closed" }, { status: "needs_filing" }],
    casefiles: [
      { status: "pending_review", steps_count: 6 },
      { status: "approved", steps_count: 4 },
      { status: "investigating", steps_count: 2 }, // not yet reviewed: excluded from the average
    ],
    tests: [{ facility_id: "a" }, { facility_id: "a" }, { facility_id: "b" }],
  });
  assert.equal(k.openExceptions, 3); // the closed one is not open
  assert.equal(k.pendingReview, 1);
  assert.equal(k.avgSteps, 5); // (6 + 4) / 2
  assert.equal(k.facilitiesTested, 2); // distinct facilities
});

test("computeKpis: avgSteps is null when no case has been reviewed yet (the tile names the next action)", () => {
  const k = computeKpis({ exceptions: [], casefiles: [{ status: "investigating", steps_count: 3 }], tests: [] });
  assert.equal(k.avgSteps, null);
  assert.equal(k.facilitiesTested, 0);
});

// ------------------------------------------------------------ reopened

test("isReopened: a new exception with a linked casefile was reopened; a fresh one has no casefile yet", () => {
  assert.equal(isReopened({ status: "new" }, true), true);
  assert.equal(isReopened({ status: "new" }, false), false);
  // once it is being worked, it is not "reopened" in the queue sense
  assert.equal(isReopened({ status: "investigating" }, true), false);
  assert.equal(isReopened({ status: "closed" }, true), false);
});

// --------------------------------------------------------- run disabled

test("runDisabledReason: a facility with no approved terms is disabled WITH the inline reason", () => {
  assert.equal(runDisabledReason({ hasApprovedTerms: false }), APPROVE_TERMS_FIRST);
  assert.match(APPROVE_TERMS_FIRST, /approve covenant terms first/i);
});

test("runDisabledReason: a facility with approved terms is not disabled", () => {
  assert.equal(runDisabledReason({ hasApprovedTerms: true }), null);
});

import { currentCasefiles } from "./portfolioModel.ts";

test("I-2: the queue picks the newest non-superseded casefile, whatever order rows arrive in", () => {
  const rows = [
    { id: "old", exception_id: "e1", status: "superseded", created_at: "2026-10-05T10:00:00Z" },
    { id: "new", exception_id: "e1", status: "pending_review", created_at: "2026-10-05T09:00:00Z" },
    { id: "older", exception_id: "e1", status: "approved", created_at: "2026-10-01T09:00:00Z" },
    { id: "only-sup", exception_id: "e2", status: "superseded", created_at: "2026-10-05T10:00:00Z" },
  ];
  const m = currentCasefiles(rows);
  assert.equal(m.get("e1").id, "new");
  assert.equal(m.has("e2"), false);
});

test("the live casefile wins over a NEWER failed one (a dead re-run must not shadow it)", () => {
  // The one-live-per-exception index allows many failed rows alongside the live
  // one; a failed re-run that could not start is newer but must not be returned.
  const rows = [
    { id: "live", exception_id: "e1", status: "pending_review", created_at: "2026-10-06T10:00:00Z" },
    { id: "dead1", exception_id: "e1", status: "failed", created_at: "2026-10-07T09:00:00Z" },
    { id: "dead2", exception_id: "e1", status: "failed", created_at: "2026-10-07T10:00:00Z" },
    { id: "only-failed", exception_id: "e2", status: "failed", created_at: "2026-10-07T10:00:00Z" },
  ];
  const m = currentCasefiles(rows);
  assert.equal(m.get("e1").id, "live", "the pending_review casefile, not the newer failed one");
  assert.equal(m.has("e2"), false, "an exception with only failed casefiles reads as investigate");
});

// ----------------------------------------------------------- portfolioRows

const FACILITIES = [
  { id: "f-harbor", borrower_name: "Harbor Logistics", industry: "Freight" },
  { id: "f-north", borrower_name: "Northgate Foods", industry: "Food" },
  { id: "f-coastal", borrower_name: "Coastal Marine", industry: "Marine" },
  { id: "f-new", borrower_name: "Aurora Textiles", industry: "Textiles" },
];
const TERMS = [
  { facility_id: "f-harbor", version: 1 },
  { facility_id: "f-north", version: 1 },
  { facility_id: "f-coastal", version: 1 },
]; // f-new has no approved terms

test("portfolioRows grades each facility by what the analyst must do next", () => {
  const openExceptions = [
    { id: "x-harbor", facility_id: "f-harbor", status: "pending_review", computed_dscr: "1.12", reported_dscr: "1.12", required_dscr: "1.25" },
    { id: "x-coastal", facility_id: "f-coastal", status: "new", computed_dscr: "1.08", reported_dscr: "1.30", required_dscr: "1.25" },
  ];
  const casefileByException = new Map([
    ["x-harbor", { id: "cf-harbor", status: "pending_review", recommendation: "escalate" }],
    // x-coastal has no casefile yet -> breach_investigate
  ]);
  const tests = [
    { facility_id: "f-north", test_period_end: "2026-06-30", computed_dscr: 1.4, reported_dscr: 1.41, threshold: 1.25 },
  ];
  const rows = portfolioRows({ facilities: FACILITIES, openExceptions, casefileByException, tests, approvedTerms: TERMS, targetPeriod: "2026-06-30" });
  const byId = Object.fromEntries(rows.map((r) => [r.facilityId, r]));

  assert.equal(byId["f-coastal"].status, "breach_investigate"); // open exception, no casefile
  assert.equal(byId["f-harbor"].status, "in_review");           // casefile pending_review
  assert.equal(byId["f-north"].status, "compliant");            // a test, no exception
  assert.equal(byId["f-new"].status, "not_tested");             // nothing

  // Figures come from the exception for a breach, the test for compliant.
  assert.equal(byId["f-coastal"].ours, 1.08);
  assert.equal(byId["f-coastal"].required, 1.25);
  assert.equal(byId["f-north"].ours, 1.4);
  // Approved-terms flag drives whether a Run is allowed.
  assert.equal(byId["f-new"].hasApprovedTerms, false);
  assert.equal(byId["f-harbor"].hasApprovedTerms, true);
});

test("portfolioRows is sorted by triage rank, most urgent first", () => {
  const openExceptions = [
    { id: "x-coastal", facility_id: "f-coastal", status: "new", computed_dscr: 1.08, reported_dscr: 1.3, required_dscr: 1.25 },
  ];
  const rows = portfolioRows({ facilities: FACILITIES, openExceptions, casefileByException: new Map(), tests: [], approvedTerms: TERMS, targetPeriod: "2026-06-30" });
  // Coastal (breach_investigate, rank 0) must come before the not_tested ones.
  assert.equal(rows[0].facilityId, "f-coastal");
  assert.ok(PORTFOLIO_STATUS[rows[0].status].rank <= PORTFOLIO_STATUS[rows[rows.length - 1].status].rank);
});
