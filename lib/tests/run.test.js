import { test } from "node:test";
import assert from "node:assert/strict";

import { computeDscr } from "../../calc/dscr.js";
import { FACILITIES, boardedVersionFor, termsFor, unboardedVersionFor } from "../../data/facilities.js";
import { NO_APPROVED_TERMS, RunTestError, reconcile, runTest } from "./run.ts";
import { FACILITY_UUID, approvedRow, fakeDb, fakeSearch, hitsFor, facility, quarter } from "./run.fixtures.js";

// No network and no database. The documents are the generated ones, the search
// and the database are fakes, and every expected figure is the one locked in
// data/facilities.js. If a figure here disagrees, the fixture is right.

const CALC_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function setup(id, periodEnd, over = {}) {
  const db = over.db ?? fakeDb(over.dbOptions);
  const search = fakeSearch(over.hits ?? hitsFor(id));
  let n = 0;
  const deps = {
    client: db,
    newId: () => `${CALC_ID.slice(0, -1)}${(n++ % 10).toString()}`,
    loadTerms: async () => over.row === undefined ? approvedRow(id, periodEnd) : over.row,
    readFigures: over.readFigures ?? (async (facilityId, p) => (await import("./extract-financials.ts")).readLabeledFigures(facilityId, p, { search })),
    readReported: over.readReported ?? (async (facilityId, p) => (await import("./certificate.ts")).readReportedDscr(facilityId, p, { search })),
  };
  return { db, deps, run: (runId) => runTest(FACILITY_UUID[id], periodEnd, runId, deps) };
}

// ------------------------------------------------- the five locked tests (§5)

const CASES = FACILITIES.flatMap((f) => f.quarters.map((q) => ({ id: f.id, q })));

for (const { id, q } of CASES) {
  test(`${id} ${q.period_end}: ours ${q.expected.computed_dscr}, ${q.expected.passed ? "passes" : "fails"}, exception ${q.expected.raises_exception}`, async () => {
    // The minimum is per loan, read from the terms that govern this quarter —
    // not a constant, now that the book is not all boarded at the same number.
    const min = termsFor(boardedVersionFor(facility(id), q), q).threshold.min_dscr;
    const { db, run } = setup(id, q.period_end);
    const r = await run();

    assert.equal(r.computed_dscr, q.expected.computed_dscr);
    assert.equal(r.passed, q.expected.passed);
    assert.equal(r.reported_dscr, q.reported_dscr);
    assert.equal(r.variance_flagged, q.expected.variance_flagged);
    assert.equal(r.calc_error, null);
    assert.equal(Boolean(r.exception_id), q.expected.raises_exception);

    assert.equal(db.tables.tests.length, 1);
    assert.equal(db.tables.exceptions.length, q.expected.raises_exception ? 1 : 0);
    const t = db.tables.tests[0];
    assert.equal(t.computed_dscr, q.expected.computed_dscr);
    assert.equal(t.passed, q.expected.passed);
    assert.equal(t.threshold, min);
    assert.equal(t.run_id, "demo");
    assert.equal(t.covenant_terms_id, approvedRow(id, q.period_end).id);
    if (q.expected.raises_exception) {
      const e = db.tables.exceptions[0];
      assert.deepEqual(
        { test_id: e.test_id, computed: e.computed_dscr, reported: e.reported_dscr, required: e.required_dscr, period: e.test_period_end },
        { test_id: t.id, computed: q.expected.computed_dscr, reported: q.reported_dscr, required: min, period: q.period_end },
      );
    }
  });
}

test("F3 headline: the certificate says 1.31 and compliant, and we raise an exception anyway", async () => {
  const { db, run } = setup("F3", "2026-06-30");
  const r = await run();
  assert.equal(r.reported_dscr, 1.31);
  assert.ok(r.reported_dscr >= r.threshold, "the borrower's own figure clears the threshold");
  assert.equal(r.computed_dscr, 1.08);
  assert.equal(r.passed, false);
  assert.equal(r.outcome, "exception");
  assert.ok(r.exception_id);
  assert.equal(db.tables.exceptions.length, 1);
});

test("F1: the unboarded amendment's add-back is on the financials but is not counted, so the test fails on the terms in force", async () => {
  const { db, run } = setup("F1", "2026-06-30");
  const r = await run();
  assert.equal(r.computed_dscr, 1.12); // not 1.28, which is what the unboarded terms would give
  assert.equal(r.passed, false);
  assert.deepEqual(db.tables.calc_log[0].inputs.financials.addback_amounts, {});
});

test("F5 Q1: the borrower overstates beyond tolerance: variance logged, no exception", async () => {
  const { db, run } = setup("F5", "2026-03-31");
  const r = await run();
  assert.equal(r.outcome, "variance_logged");
  assert.equal(r.variance, -0.09); // computed - reported
  assert.equal(r.variance_flagged, true);
  assert.equal(r.exception_id, undefined);
  assert.equal(db.tables.exceptions.length, 0);
});

test("F5 Q4-2025: agreement within tolerance is compliant, no action", async () => {
  const { run } = setup("F5", "2025-12-31");
  const r = await run();
  assert.equal(r.outcome, "compliant");
  assert.equal(r.variance, 0);
  assert.equal(r.variance_flagged, false);
});

// ---------------------------------------------------- the reconciliation table

const base = { computed: 1.4, passed: true, threshold: 1.25, tolerance: 0.05 };

test("reconcile: passes and agrees within tolerance -> compliant, no action", () => {
  const r = reconcile({ ...base, reported: 1.42 });
  assert.deepEqual([r.outcome, r.raise_exception, r.variance_flagged], ["compliant", false, false]);
});

test("reconcile: passes and the borrower overstates beyond tolerance -> variance logged, no exception", () => {
  const r = reconcile({ ...base, reported: 1.5 });
  assert.deepEqual([r.outcome, r.raise_exception, r.variance_flagged, r.variance], ["variance_logged", false, true, -0.1]);
});

test("reconcile: passes and the borrower REPORTS A FAILURE -> exception (owner decision 2026-10-05)", () => {
  const r = reconcile({ ...base, computed: 1.3, reported: 1.2 });
  assert.equal(r.borrower_reports_failure, true);
  assert.deepEqual([r.outcome, r.raise_exception, r.variance_flagged], ["exception", true, true]);
});

test("reconcile: passes, borrower understates but still clears the threshold -> variance logged, no exception", () => {
  const r = reconcile({ ...base, computed: 1.5, reported: 1.3 });
  assert.deepEqual([r.outcome, r.raise_exception, r.variance_flagged], ["variance_logged", false, true]);
});

test("reconcile: ours fails -> exception, whatever the borrower says", () => {
  for (const reported of [null, 1.0, 1.1, 1.25, 1.31, 2.5]) {
    const r = reconcile({ computed: 1.08, passed: false, threshold: 1.25, reported, tolerance: 0.05 });
    assert.equal(r.raise_exception, true, `reported ${reported}`);
    assert.equal(r.outcome, "exception");
  }
});

test("reconcile: the tolerance boundary is exact, not floating-point luck", () => {
  assert.equal(reconcile({ ...base, computed: 1.35, reported: 1.3 }).variance_flagged, false); // exactly 0.05
  assert.equal(reconcile({ ...base, computed: 1.3, reported: 1.35 }).variance_flagged, false);
  assert.equal(reconcile({ ...base, computed: 1.36, reported: 1.3 }).variance_flagged, true);
  assert.equal(reconcile({ ...base, computed: 1.35, reported: 1.3, tolerance: 0.04 }).variance_flagged, true);
});

test("reconcile: a borrower figure exactly at the threshold is not a reported failure", () => {
  assert.equal(reconcile({ ...base, computed: 1.3, reported: 1.25 }).borrower_reports_failure, false);
  assert.equal(reconcile({ ...base, computed: 1.3, reported: 1.24 }).borrower_reports_failure, true);
});

test("reconcile: no certificate figure -> no variance, not flagged, and ours still decides", () => {
  assert.deepEqual(reconcile({ ...base, reported: null }), {
    variance: null,
    variance_flagged: false,
    borrower_reports_failure: false,
    raise_exception: false,
    outcome: "compliant",
  });
  assert.equal(reconcile({ computed: 1.08, passed: false, threshold: 1.25, reported: null, tolerance: 0.05 }).raise_exception, true);
});

test("our number decides: sweeping the borrower's figure never changes `passed`", async () => {
  for (const reported of [0.5, 1.0, 1.24, 1.25, 1.31, 1.9, 99]) {
    for (const [id, period, passed] of [["F3", "2026-06-30", false], ["F5", "2025-12-31", true]]) {
      const { run } = setup(id, period, { readReported: async () => ({ value: reported, citation: "CC Q2 2026 §2", quote: "x" }) });
      const r = await run();
      assert.equal(r.passed, passed, `${id} with reported ${reported}`);
    }
  }
});

// ---------------------------------------------------------- the terms control

test("no approved terms in force -> refused with the message, and nothing is written", async () => {
  const { db, run } = setup("F1", "2026-06-30", { row: null });
  await assert.rejects(run(), (e) => e instanceof RunTestError && e.status === 409 && e.message.includes(NO_APPROVED_TERMS));
  assert.match(NO_APPROVED_TERMS, /^Approve covenant terms first/);
  for (const t of ["tests", "calc_log", "exceptions"]) assert.equal(db.tables[t].length, 0, t);
});

test("a proposed row never governs a test, even if a loader hands one over", async () => {
  const { db, run } = setup("F3", "2026-06-30", { row: approvedRow("F3", "2026-06-30", { status: "proposed", approved_by: null, approved_at: null }) });
  await assert.rejects(run(), (e) => e instanceof RunTestError && e.status === 409);
  assert.equal(db.tables.tests.length, 0);
});

test("a superseded row governs a past period (the version in force then)", async () => {
  const { run } = setup("F5", "2025-12-31", { row: approvedRow("F5", "2025-12-31", { status: "superseded", effective_to: "2026-03-31" }) });
  assert.equal((await run()).computed_dscr, 1.41);
});

test("the default loader is termsInForce: it asks for the facility and period, and only that", async () => {
  const calls = [];
  const db = fakeDb();
  const real = db.from;
  // termsInForce reads covenant_terms with a chain this fake does not model; record the table and stop.
  db.from = (name) => {
    if (name === "covenant_terms") {
      calls.push(name);
      const chain = { select: () => chain, eq: () => chain, in: () => chain, lte: () => chain, order: () => Promise.resolve({ data: [], error: null }) };
      return chain;
    }
    return real(name);
  };
  await assert.rejects(runTest(FACILITY_UUID.F1, "2026-06-30", undefined, { client: db }), (e) => e instanceof RunTestError && e.status === 409);
  assert.deepEqual(calls, ["covenant_terms"]);
});

// ------------------------------------------------- missing is not zero

test("a missing financial input -> calc_error, NULL DSCR, no exception, no zero substituted", async () => {
  const hits = hitsFor("F3", { mutate: (t) => t.replace(/^Cash Taxes Paid:.*\n/m, "") });
  const { db, run } = setup("F3", "2026-06-30", { hits });
  const r = await run();
  assert.equal(r.outcome, "calc_error");
  assert.equal(r.computed_dscr, null);
  assert.equal(r.passed, null);
  assert.match(r.calc_error, /missing input: financials\.cash_taxes/);
  assert.match(r.calc_error, /Cash Taxes Paid: not found/);
  assert.equal(r.exception_id, undefined);
  assert.equal(db.tables.exceptions.length, 0);
  assert.equal(db.tables.calc_log.length, 0, "no number, so nothing to trace");
  const t = db.tables.tests[0];
  assert.equal(t.computed_dscr, null);
  assert.equal(t.calc_id, null);
  assert.equal(t.passed, null);
  assert.equal(t.variance_flagged, false);
  assert.equal(t.reported_dscr, 1.31, "the borrower's figure is still recorded as evidence");
});

test("every one of the five inputs, missing in turn, is refused rather than zeroed", async () => {
  for (const label of [
    "Consolidated EBITDA",
    "Unfinanced Capital Expenditures",
    "Cash Taxes Paid",
    "Scheduled Principal Payments",
    "Cash Interest Paid",
  ]) {
    const hits = hitsFor("F1", { mutate: (t) => t.replace(new RegExp(`^${label}:.*\\n`, "m"), "") });
    const { db, run } = setup("F1", "2026-06-30", { hits });
    const r = await run();
    assert.equal(r.computed_dscr, null, label);
    assert.equal(r.exception_id, undefined, label);
    assert.equal(db.tables.exceptions.length, 0, label);
  }
});

test("an add-back the terms name but the financials do not carry -> calc_error, not an uncounted add-back", async () => {
  // F5 Q2 terms (v1) name the dry-dock add-back; remove it from the financials.
  const hits = hitsFor("F5", { mutate: (t) => t.replace(/^Dry-dock and vessel overhaul charges: 520,000\n/m, "") });
  const { run } = setup("F5", "2026-06-30", { hits });
  const r = await run();
  assert.equal(r.computed_dscr, null);
  assert.match(r.calc_error, /dry-dock and vessel overhaul charges/);
  assert.equal(r.exception_id, undefined);
});

test("no financials document for the period -> calc_error naming the missing document", async () => {
  const { db, run } = setup("F1", "2026-06-30", { hits: hitsFor("F1").filter((h) => h.doc_type !== "financials") });
  const r = await run();
  assert.equal(r.outcome, "calc_error");
  assert.match(r.calc_error, /no "Financials — Q2 2026" document on file/);
  assert.equal(db.tables.exceptions.length, 0);
});

test("approved terms that fail shape validation are missing evidence too, never a guess", async () => {
  const row = approvedRow("F1", "2026-06-30");
  delete row.terms.numerator.deductions; // the calculator would read an absent list as "none"
  const { db, run } = setup("F1", "2026-06-30", { row });
  const r = await run();
  assert.equal(r.computed_dscr, null);
  assert.match(r.calc_error, /failed shape validation/);
  assert.equal(db.tables.exceptions.length, 0);
});

// ------------------------------------------------------- no certificate

test("no certificate -> the test still runs on our number, reported and variance NULL, not flagged", async () => {
  const { db, run } = setup("F3", "2026-06-30", { readReported: async () => null });
  const r = await run();
  assert.equal(r.computed_dscr, 1.08);
  assert.equal(r.passed, false);
  assert.equal(r.reported_dscr, null);
  assert.equal(r.variance, null);
  assert.equal(r.variance_flagged, false);
  assert.ok(r.exception_id);
  assert.equal(db.tables.exceptions[0].reported_dscr, null);
});

test("no certificate and ours passes -> compliant, no exception", async () => {
  const { run } = setup("F5", "2025-12-31", { readReported: async () => null });
  const r = await run();
  assert.deepEqual([r.outcome, r.exception_id], ["compliant", undefined]);
});

// -------------------------------------------------------- the log and its link

test("calc_log carries the number, its inputs with their citations, and the same calc_id as the tests row", async () => {
  const { db, run } = setup("F5", "2026-06-30");
  const r = await run();
  const t = db.tables.tests[0];
  const log = db.tables.calc_log;
  assert.equal(log.length, 1);
  assert.equal(t.calc_id, log[0].calc_id);
  assert.equal(r.calc_id, log[0].calc_id);
  assert.equal(log[0].test_id, t.id);
  assert.equal(log[0].outputs.dscr, 1.12);
  // The row is exactly what the pure calculator returns for the logged inputs.
  assert.deepEqual(log[0].outputs, computeDscr(log[0].inputs.terms, log[0].inputs.financials, { calcId: log[0].calc_id }));
  assert.equal(log[0].inputs.terms.test_period.period_end, "2026-06-30");
  assert.equal(log[0].inputs.citations.ebitda.citation, "Fin Q2 2026 §1");
  assert.equal(log[0].inputs.citations.ebitda.quote, "Consolidated EBITDA: 5,313,000");
  assert.equal(log[0].inputs.citations.addbacks["dry-dock and vessel overhaul charges"].citation, "Fin Q2 2026 §2");
  assert.deepEqual(log[0].inputs.reported, { dscr: 1.3, citation: "CC Q2 2026 §2", quote: "Reported Debt Service Coverage Ratio: 1.30 to 1.00." });
});

test("calc_id is injected, never generated inside the calculator", async () => {
  const { db, run } = setup("F1", "2026-06-30");
  await run();
  assert.match(db.tables.calc_log[0].calc_id, /^aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa\d$/);
});

test("if the calculation cannot be logged, no test row claims it", async () => {
  const { db, run } = setup("F1", "2026-06-30", { dbOptions: { failOn: { calc_log: "insert" } } });
  await assert.rejects(run(), /write calc_log/);
  assert.equal(db.tables.tests.length, 0);
});

// ------------------------------------------------------------- idempotency

test("re-running updates the row: no second tests row and no second exceptions row", async () => {
  const { db, run } = setup("F3", "2026-06-30");
  const first = await run();
  const second = await run();
  assert.equal(db.tables.tests.length, 1);
  assert.equal(db.tables.exceptions.length, 1);
  assert.equal(second.test_id, first.test_id);
  assert.equal(second.exception_id, first.exception_id);
  assert.equal(db.tables.tests[0].calc_id, second.calc_id, "the row points at the latest calculation");
  assert.equal(db.tables.calc_log.length, 2, "the log is append-only: the earlier calculation stays traceable");
});

test("a re-run leaves the analyst's exception status alone", async () => {
  const { db, run } = setup("F3", "2026-06-30");
  await run();
  db.tables.exceptions[0].status = "investigating";
  await run();
  assert.equal(db.tables.exceptions[0].status, "investigating");
});

test("a re-run that now cannot calculate clears the old number rather than leaving it standing", async () => {
  const db = fakeDb();
  await setup("F1", "2026-06-30", { db }).run();
  assert.equal(db.tables.tests[0].computed_dscr, 1.12);
  const hits = hitsFor("F1").filter((h) => h.doc_type !== "financials");
  await setup("F1", "2026-06-30", { db, hits }).run();
  assert.equal(db.tables.tests.length, 1);
  assert.equal(db.tables.tests[0].computed_dscr, null);
  assert.equal(db.tables.tests[0].passed, null);
  assert.equal(db.tables.tests[0].calc_id, null);
  assert.ok(db.tables.tests[0].calc_error);
});

test("run_id separates runs: the same period under another run_id is a different row", async () => {
  const db = fakeDb();
  const { run } = setup("F5", "2025-12-31", { db });
  await run();
  await run("eval-1");
  assert.deepEqual(db.tables.tests.map((t) => t.run_id).sort(), ["demo", "eval-1"]);
});

// -------------------------------------------------------------- the policy

test("the tolerance is read from the policy table, not a constant", async () => {
  // F5 Q1 differs by 0.09: flagged at 0.05, not at 0.10.
  const tight = await setup("F5", "2026-03-31", { dbOptions: { tolerance: 0.05 } }).run();
  const loose = await setup("F5", "2026-03-31", { dbOptions: { tolerance: 0.1 } }).run();
  assert.equal(tight.variance_flagged, true);
  assert.equal(loose.variance_flagged, false);
  assert.equal(loose.outcome, "compliant");
});

test("a missing or malformed tolerance is an error, not a silent default", async () => {
  await assert.rejects(setup("F5", "2026-03-31", { dbOptions: { tolerance: null } }).run(), /variance_tolerance/);
  await assert.rejects(setup("F5", "2026-03-31", { dbOptions: { tolerance: "0.05" } }).run(), /variance_tolerance/);
});

// ------------------------------------------------------------------ input

test("bad input is refused before anything is read or written", async () => {
  const { db, deps } = setup("F1", "2026-06-30");
  const bad = [
    ["not-a-uuid", "2026-06-30", undefined],
    [FACILITY_UUID.F1, "2026-02-30", undefined],
    [FACILITY_UUID.F1, "2026-05-15", undefined], // not a quarter end: would silently test the neighbouring quarter
    [FACILITY_UUID.F1, "2026-06-30", ""],
    [FACILITY_UUID.F1, "2026-06-30", 7],
  ];
  for (const [f, p, r] of bad) {
    await assert.rejects(runTest(f, p, r, deps), (e) => e instanceof RunTestError && e.status === 400, `${f} ${p} ${r}`);
  }
  assert.equal(db.log.length, 0);
});

// ------------------------------------------- a re-run that no longer needs an exception

/** F1 re-tested on the terms the unboarded Amendment No. 2 would give: 1.28, a pass. Built from the fixture; nothing is approved. */
function f1OnAmendedTerms() {
  const q = quarter("F1", "2026-06-30");
  return approvedRow("F1", "2026-06-30", { terms: termsFor(unboardedVersionFor(facility("F1"), q), q) });
}

test("a failing test that re-runs compliant closes its exception, and says nothing new is open", async () => {
  const db = fakeDb();
  const first = await setup("F1", "2026-06-30", { db }).run();
  assert.equal(first.computed_dscr, 1.12);
  assert.equal(db.tables.exceptions[0].status, "new");

  // The amended terms, and no certificate figure to second-guess them.
  const second = await setup("F1", "2026-06-30", { db, row: f1OnAmendedTerms(), readReported: async () => null }).run();
  assert.equal(second.computed_dscr, 1.28);
  assert.equal(second.passed, true);
  assert.equal(second.exception_id, undefined);
  assert.equal(db.tables.tests.length, 1);
  assert.equal(db.tables.exceptions.length, 1, "closed, never deleted");
  assert.equal(db.tables.exceptions[0].id, first.exception_id);
  assert.equal(db.tables.exceptions[0].status, "closed");
});

test("a re-run that ends in calc_error closes the exception too: its numbers are no longer true", async () => {
  const db = fakeDb();
  await setup("F3", "2026-06-30", { db }).run();
  assert.equal(db.tables.exceptions[0].status, "new");
  const hits = hitsFor("F3").filter((h) => h.doc_type !== "financials");
  const r = await setup("F3", "2026-06-30", { db, hits }).run();
  assert.equal(r.outcome, "calc_error");
  assert.equal(db.tables.exceptions.length, 1);
  assert.equal(db.tables.exceptions[0].status, "closed");
});

test("an exception an analyst has already moved on is left alone, however the re-run turns out", async () => {
  for (const status of ["investigating", "pending_review", "closed", "needs_filing"]) {
    for (const rerun of ["compliant", "calc_error"]) {
      const db = fakeDb();
      await setup("F1", "2026-06-30", { db }).run();
      db.tables.exceptions[0].status = status;
      const before = { ...db.tables.exceptions[0] };
      const over = rerun === "compliant"
        ? { row: f1OnAmendedTerms(), readReported: async () => null }
        : { hits: hitsFor("F1").filter((h) => h.doc_type !== "financials") };
      await setup("F1", "2026-06-30", { db, ...over }).run();
      assert.deepEqual(db.tables.exceptions[0], before, `${status} / ${rerun}`);
    }
  }
});

test("a re-run that still warrants the exception keeps it open and does not close it", async () => {
  const db = fakeDb();
  await setup("F1", "2026-06-30", { db }).run();
  // On the amended terms we pass at 1.28, but the borrower's own certificate still reports 1.12: a self-reported breach.
  const r = await setup("F1", "2026-06-30", { db, row: f1OnAmendedTerms() }).run();
  assert.equal(r.passed, true);
  assert.equal(r.outcome, "exception");
  assert.equal(db.tables.exceptions[0].status, "new");
  assert.equal(db.tables.exceptions[0].computed_dscr, 1.28, "figures refreshed");
});

test("a first run that is compliant, or ends in calc_error, writes no exception and closes nothing", async () => {
  const db = fakeDb();
  await setup("F5", "2025-12-31", { db }).run();
  await setup("F3", "2026-06-30", { db, hits: hitsFor("F3").filter((h) => h.doc_type !== "financials") }).run();
  assert.equal(db.tables.exceptions.length, 0);
});

test("only the exception of THIS test is closed", async () => {
  const db = fakeDb();
  await setup("F3", "2026-06-30", { db }).run();
  await setup("F1", "2026-06-30", { db }).run();
  await setup("F1", "2026-06-30", { db, row: f1OnAmendedTerms(), readReported: async () => null }).run();
  assert.deepEqual(db.tables.exceptions.map((e) => [e.facility_id, e.status]), [[FACILITY_UUID.F3, "new"], [FACILITY_UUID.F1, "closed"]]);
});

// -------------------------------------- a closed exception is reopened by a new breach

test("fail, pass, fail: the third run reopens the exception (a breach never sits closed)", async () => {
  const db = fakeDb();
  const noCert = { readReported: async () => null };
  const r1 = await setup("F1", "2026-06-30", { db }).run();
  assert.equal(db.tables.exceptions[0].status, "new");

  const r2 = await setup("F1", "2026-06-30", { db, row: f1OnAmendedTerms(), ...noCert }).run();
  assert.equal(r2.passed, true);
  assert.equal(db.tables.exceptions[0].status, "closed");

  const r3 = await setup("F1", "2026-06-30", { db }).run();
  assert.equal(r3.outcome, "exception");
  assert.equal(r3.exception_id, r1.exception_id);
  assert.equal(db.tables.exceptions.length, 1, "reopened, not duplicated");
  assert.equal(db.tables.exceptions[0].status, "new");
  assert.equal(db.tables.exceptions[0].computed_dscr, 1.12, "with the figures of the run that reopened it");
});

test("the realistic route: a bad ingest closes it via calc_error, the document is fixed, the breach reopens it", async () => {
  const db = fakeDb();
  await setup("F3", "2026-06-30", { db }).run();
  const broken = await setup("F3", "2026-06-30", { db, hits: hitsFor("F3").filter((h) => h.doc_type !== "financials") }).run();
  assert.equal(broken.outcome, "calc_error");
  assert.equal(db.tables.exceptions[0].status, "closed");
  const fixed = await setup("F3", "2026-06-30", { db }).run();
  assert.equal(fixed.computed_dscr, 1.08);
  assert.ok(fixed.exception_id);
  assert.equal(db.tables.exceptions[0].status, "new");
});

test("an exception an ANALYST closed is reopened by a later breach, and its casefile link is kept", async () => {
  const db = fakeDb();
  const first = await setup("F3", "2026-06-30", { db }).run();
  db.tables.exceptions[0].status = "closed";
  db.tables.casefiles.push({ id: "casefile-1", exception_id: first.exception_id, status: "approved", recommendation: "resolve" });
  const casefileBefore = structuredClone(db.tables.casefiles[0]);

  const again = await setup("F3", "2026-06-30", { db }).run();
  assert.equal(again.exception_id, first.exception_id);
  assert.equal(db.tables.exceptions[0].status, "new");
  assert.deepEqual(db.tables.casefiles, [casefileBefore], "the casefile is not touched, deleted or unlinked");
  assert.equal(db.tables.casefiles[0].exception_id, db.tables.exceptions[0].id);
});

test("only a closed exception is reopened: one in progress keeps its status when the breach recurs", async () => {
  for (const status of ["investigating", "pending_review", "needs_filing"]) {
    const db = fakeDb();
    await setup("F3", "2026-06-30", { db }).run();
    db.tables.exceptions[0].status = status;
    await setup("F3", "2026-06-30", { db }).run();
    assert.equal(db.tables.exceptions[0].status, status, status);
  }
});
