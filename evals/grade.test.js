import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { computeDscr } from "../calc/dscr.js";
import { FACILITIES, ONBOARDING_DEMO_FACILITIES, VARIANCE_TOLERANCE, termsFor } from "../data/facilities.js";
import {
  codePathFor,
  expectedCodePath,
  fixtureFor,
  gradeCalculation,
  gradeLive,
  loadOracle,
  parseCsv,
  renderReport,
  renderResultsCsv,
  summariseCalculation,
  summariseLive,
} from "./grade.mjs";

const ORACLE_PATH = new URL("../data/expected-values-template.csv", import.meta.url);
const ALL_FIXTURES = [...FACILITIES, ...ONBOARDING_DEMO_FACILITIES];
const deps = { computeDscr, termsFor, tolerance: VARIANCE_TOLERANCE };

// ------------------------------------------------------------------ parsing

test("parseCsv keeps commas and doubled quotes inside quoted fields", () => {
  const rows = parseCsv('a,b\n1,"x, y"\n2,"say ""hi"""\n');
  assert.deepEqual(rows, [
    { a: "1", b: "x, y" },
    { a: "2", b: 'say "hi"' },
  ]);
});

test("loadOracle refuses while any row is unsigned — sign-off is per row", () => {
  const text = "case_id,facility,test_period_end,threshold,terms_version_boarded,reported_dscr,expected_dscr_as_tested,expected_dscr_remapped,expected_outcome,expected_tag,owner_signed_off\nA,F1,2026-06-30,1.25,1,1.12,1.12,1.28,resolve,amendment_addback,YES\nB,F3,2026-06-30,1.25,1,1.31,1.08,n/a,escalate,true_breach,NO\n";
  assert.throws(() => loadOracle(text), /unsigned rows: B/);
});

test("loadOracle reads n/a as null and numbers as numbers", () => {
  const text = "case_id,facility,test_period_end,threshold,terms_version_boarded,reported_dscr,expected_dscr_as_tested,expected_dscr_remapped,expected_outcome,expected_tag,owner_signed_off\nA,F3,2026-06-30,1.25,1,1.31,1.08,n/a,escalate,true_breach,YES\n";
  const [row] = loadOracle(text);
  assert.equal(row.expected_dscr_remapped, null);
  assert.equal(row.expected_dscr_as_tested, 1.08);
  assert.equal(row.terms_version_boarded, 1);
  assert.equal(row.expected_tag, "true_breach");
});

test("loadOracle rejects an expected_outcome the product cannot reach", () => {
  const text = "case_id,facility,test_period_end,threshold,terms_version_boarded,reported_dscr,expected_dscr_as_tested,expected_dscr_remapped,expected_outcome,expected_tag,owner_signed_off\nA,F3,2026-06-30,1.25,1,1.31,1.08,n/a,maybe,n/a,YES\n";
  assert.throws(() => loadOracle(text), /unknown expected_outcome/);
});

// ------------------------------------------------------------ the real key

test("the committed oracle is fully signed and has the ten cases", () => {
  const oracle = loadOracle(readFileSync(ORACLE_PATH, "utf8"));
  assert.equal(oracle.length, 10);
  assert.deepEqual(
    oracle.map((r) => r.case_id),
    ["F1-2026Q2", "F3-2026Q2", "F5-2025Q4", "F5-2026Q1", "F5-2026Q2", "ZHATSAPP-2026Q3", "MARCUS-2026Q3", "ORION-2026Q3", "PETWORKS-2026Q3", "VANTAGE-2026Q3"],
  );
});

test("every oracle row maps to a fixture facility and quarter", () => {
  const oracle = loadOracle(readFileSync(ORACLE_PATH, "utf8"));
  for (const row of oracle) {
    const f = fixtureFor(row, ALL_FIXTURES);
    assert.equal(f.error, undefined, f.error);
  }
});

test("the calculator matches the owner's signed figures on every case, as tested and remapped", () => {
  const oracle = loadOracle(readFileSync(ORACLE_PATH, "utf8"));
  const grades = oracle.map((row) => gradeCalculation(row, fixtureFor(row, ALL_FIXTURES), deps));
  const summary = summariseCalculation(grades);
  assert.deepEqual(summary.mismatches, []);
  assert.equal(summary.calc_accuracy, 1);
  assert.equal(summary.code_path_accuracy, 1);
  // 10 as-tested + the two remaps the oracle expects (F1, F5 Q2)
  assert.equal(summary.calc_checks, 12);
});

// ----------------------------------------------------- deterministic rules

test("expectedCodePath: agent outcomes imply an exception; the two code-only outcomes name their path", () => {
  assert.equal(expectedCodePath("resolve"), "exception");
  assert.equal(expectedCodePath("escalate"), "exception");
  assert.equal(expectedCodePath("compliant_no_action"), "compliant");
  assert.equal(expectedCodePath("variance_logged_no_investigation"), "variance_logged");
});

test("codePathFor mirrors the quarterly test: fail -> exception; pass + gap > tolerance -> variance; else compliant", () => {
  assert.equal(codePathFor({ dscr: 1.12, pass: false, reported: 1.12, tolerance: 0.05 }), "exception");
  assert.equal(codePathFor({ dscr: 1.29, pass: true, reported: 1.38, tolerance: 0.05 }), "variance_logged");
  assert.equal(codePathFor({ dscr: 1.41, pass: true, reported: 1.41, tolerance: 0.05 }), "compliant");
  // exactly at the tolerance is NOT flagged (the product uses a strict greater-than)
  assert.equal(codePathFor({ dscr: 1.3, pass: true, reported: 1.35, tolerance: 0.05 }), "compliant");
  // no borrower figure: nothing to reconcile, compliant
  assert.equal(codePathFor({ dscr: 1.41, pass: true, reported: null, tolerance: 0.05 }), "compliant");
});

test("a wrong figure is reported as a mismatch, never silently passed", () => {
  const oracle = loadOracle(readFileSync(ORACLE_PATH, "utf8"));
  const row = { ...oracle[0], expected_dscr_as_tested: 1.13 }; // F1 as tested is 1.12
  const g = gradeCalculation(row, fixtureFor(row, ALL_FIXTURES), deps);
  assert.equal(g.as_tested.match, false);
  assert.match(g.notes[0], /as-tested: computed 1.12, oracle 1.13/);
  const s = summariseCalculation([g]);
  assert.ok(s.calc_accuracy < 1);
});

test("a calculator refusal counts as a wrong figure in the summary", () => {
  const s = summariseCalculation([{ case_id: "X", error: "calculator refused as-tested inputs: missing input" }]);
  assert.equal(s.calc_accuracy, 0);
  assert.equal(s.mismatches.length, 1);
});

// ---------------------------------------------------------------- live gate

const F1 = { case_id: "F1-2026Q2", expected_outcome: "resolve", expected_tag: "amendment_addback" };
const F3 = { case_id: "F3-2026Q2", expected_outcome: "escalate", expected_tag: "true_breach" };
const F5Q4 = { case_id: "F5-2025Q4", expected_outcome: "compliant_no_action", expected_tag: null };
const F5Q1 = { case_id: "F5-2026Q1", expected_outcome: "variance_logged_no_investigation", expected_tag: null };

test("the false-resolve gate fires ONLY on a resolve the owner did not label resolve", () => {
  const onBreach = gradeLive(F3, { test_outcome: "exception", recommendation: "resolve", suggested_tag: "other", steps: 5, casefile_status: "pending_review" });
  assert.equal(onBreach.false_resolve, true);
  assert.equal(onBreach.outcome_match, false);

  const correct = gradeLive(F1, { test_outcome: "exception", recommendation: "resolve", suggested_tag: "amendment_addback", steps: 6, casefile_status: "pending_review" });
  assert.equal(correct.false_resolve, false);
  assert.equal(correct.outcome_match, true);
  assert.equal(correct.tag_match, true);

  const cautious = gradeLive(F1, { test_outcome: "exception", recommendation: "escalate", suggested_tag: "other", steps: 8, casefile_status: "pending_review" });
  assert.equal(cautious.false_resolve, false, "an over-cautious escalate is an outcome miss, not a false resolve");
  assert.equal(cautious.outcome_match, false);
});

test("a code-only case is right when the code took the expected path and started no investigation", () => {
  assert.equal(gradeLive(F5Q4, { test_outcome: "compliant" }).outcome_match, true);
  assert.equal(gradeLive(F5Q1, { test_outcome: "variance_logged" }).outcome_match, true);
  // an investigation that should not have started is wrong even if the agent then says escalate
  const wrong = gradeLive(F5Q4, { test_outcome: "exception", recommendation: "escalate", steps: 4, casefile_status: "pending_review" });
  assert.equal(wrong.outcome_match, false);
  assert.equal(wrong.false_resolve, false);
});

test("a skipped case is not counted — a loan not yet onboarded is not a miss", () => {
  const g = gradeLive({ case_id: "ZHATSAPP-2026Q3", expected_outcome: "compliant_no_action", expected_tag: null }, { skipped: "not in the database" });
  assert.equal(g.counted, false);
  const s = summariseLive([g]);
  assert.equal(s.false_resolves, null);
  assert.equal(s.outcome_accuracy, null);
  assert.deepEqual(s.cases_skipped, ["ZHATSAPP-2026Q3"]);
});

test("summariseLive: the gate counts, accuracy is over counted cases, steps average over investigated ones, unmeasured metrics stay null", () => {
  const grades = [
    gradeLive(F1, { test_outcome: "exception", recommendation: "resolve", suggested_tag: "amendment_addback", steps: 6, casefile_status: "pending_review" }),
    gradeLive(F3, { test_outcome: "exception", recommendation: "escalate", suggested_tag: "true_breach", steps: 4, casefile_status: "pending_review" }),
    gradeLive(F5Q4, { test_outcome: "compliant" }),
    gradeLive(F5Q1, { test_outcome: "compliant" }), // a miss: variance should have been flagged
  ];
  const s = summariseLive(grades);
  assert.equal(s.false_resolves, 0);
  assert.equal(s.outcome_accuracy, 0.75);
  assert.equal(s.avg_steps, 5);
  assert.equal(s.abstain_accuracy, null);
  assert.equal(s.citation_hit_rate, null);
  assert.equal(s.cases_investigated, 2);
});

// ---------------------------------------------------------------- renderers

test("the report renders the HHH scoreboard with an em dash for anything unmeasured", () => {
  const oracle = loadOracle(readFileSync(ORACLE_PATH, "utf8"));
  const calcGrades = oracle.map((row) => gradeCalculation(row, fixtureFor(row, ALL_FIXTURES), deps));
  const calcSummary = summariseCalculation(calcGrades);
  const md = renderReport({ when: "test", oracle, calcSummary, calcGrades, metrics: { cold: { calc_accuracy: 1 }, warm: null } });
  assert.match(md, /\| Honest \| Calculation accuracy \| 100% \| 100% \| — \|/);
  assert.match(md, /\| Harmless \| Zero false resolves \| 0 \| — \| — \|/);
  assert.match(md, /12 of 12 expected figures matched/);
});

test("results.csv has one line per case per pass and carries the oracle beside the actuals", () => {
  const oracle = loadOracle(readFileSync(ORACLE_PATH, "utf8"));
  const calcGrades = oracle.map((row) => gradeCalculation(row, fixtureFor(row, ALL_FIXTURES), deps));
  const csv = renderResultsCsv({ oracle, calcGrades });
  const lines = csv.trim().split("\n");
  assert.equal(lines.length, 1 + oracle.length);
  assert.match(lines[1], /^F1-2026Q2,deterministic,1.12,1.12,true,1.28,1.28,true,resolve/);
});
