import { test } from "node:test";
import assert from "node:assert/strict";

import {
  METRICS,
  RUN_EVAL_HARNESS,
  caseCount,
  evalScoreboardState,
  runProvenance,
  scoreboardRows,
  caseComparison,
  comparisonSummary,
} from "./scoreboardModel.ts";

// ------------------------------------------------------------- scoreboardRows

test("every metric maps to a row in a fixed order", () => {
  const rows = scoreboardRows({});
  assert.equal(rows.length, METRICS.length);
  assert.deepEqual(
    rows.map((r) => r.key),
    METRICS.map((m) => m.key),
  );
});

test("a metric the run did not report is missing (em dash), never a measured zero", () => {
  const rows = scoreboardRows({}); // nothing reported
  for (const r of rows) {
    assert.equal(r.value, null, `${r.key} value`);
    assert.equal(r.display, null, `${r.key} display`);
    assert.equal(r.status, "missing", `${r.key} status`);
  }
});

test("the false-resolve gate is success ONLY at exactly 0", () => {
  const atZero = scoreboardRows({ false_resolves: 0 }).find((r) => r.key === "false_resolves");
  assert.equal(atZero.status, "success");
  assert.equal(atZero.display, "0");
});

test("the false-resolve gate is danger for ANY non-zero, with no softening", () => {
  for (const n of [1, 2, 7]) {
    const cell = scoreboardRows({ false_resolves: n }).find((r) => r.key === "false_resolves");
    assert.equal(cell.status, "danger", `${n} false resolves must be danger`);
    // never neutral/amber — a gate, not a trend
    assert.notEqual(cell.status, "neutral");
  }
});

test("a ratio metric picks success when it meets its threshold and danger when it misses", () => {
  const met = scoreboardRows({ outcome_accuracy: 0.85 }).find((r) => r.key === "outcome_accuracy");
  assert.equal(met.status, "success");
  assert.equal(met.display, "85%");

  const missed = scoreboardRows({ outcome_accuracy: 0.84 }).find((r) => r.key === "outcome_accuracy");
  assert.equal(missed.status, "danger");
});

test("calc accuracy requires a full 100% to pass", () => {
  assert.equal(scoreboardRows({ calc_accuracy: 1 }).find((r) => r.key === "calc_accuracy").status, "success");
  assert.equal(scoreboardRows({ calc_accuracy: 0.99 }).find((r) => r.key === "calc_accuracy").status, "danger");
});

test("groundedness is reported, not graded (neutral, never success/danger)", () => {
  const g = scoreboardRows({ groundedness: 0.5 }).find((r) => r.key === "groundedness");
  assert.equal(g.status, "neutral");
});

test("avg steps is a reported reduction read across columns, not scored in one cell", () => {
  const s = scoreboardRows({ avg_steps: 5.5 }).find((r) => r.key === "avg_steps");
  assert.equal(s.status, "neutral");
  assert.equal(s.display, "5.5");
  assert.equal(scoreboardRows({ avg_steps: 6 }).find((r) => r.key === "avg_steps").display, "6");
});

test("a non-object metrics payload yields all-missing rows, not a throw", () => {
  for (const bad of [null, undefined, 42, "x", [1, 2]]) {
    const rows = scoreboardRows(bad);
    assert.ok(rows.every((r) => r.status === "missing"), `payload ${JSON.stringify(bad)}`);
  }
});

// ------------------------------------------------------- evalScoreboardState

test("the scoreboard is awaiting until at least one run exists, naming the next action", () => {
  assert.equal(evalScoreboardState([]).state, "awaiting");
  assert.equal(evalScoreboardState(null).state, "awaiting");
  assert.equal(RUN_EVAL_HARNESS.length > 0, true);
});

test("the latest run per mode is selected by created_at", () => {
  const runs = [
    { mode: "cold", metrics: { false_resolves: 1 }, created_at: "2026-10-01T00:00:00Z" },
    { mode: "cold", metrics: { false_resolves: 0 }, created_at: "2026-10-05T00:00:00Z" },
    { mode: "warm", metrics: { avg_steps: 5 }, created_at: "2026-10-05T00:00:00Z" },
  ];
  const s = evalScoreboardState(runs);
  assert.equal(s.state, "present");
  assert.equal(s.cold.metrics.false_resolves, 0); // the newer cold run
  assert.equal(s.warm.metrics.avg_steps, 5);
});

test("a run present in only one mode still renders (the other stays null)", () => {
  const s = evalScoreboardState([{ mode: "cold", metrics: {}, created_at: "2026-10-05T00:00:00Z" }]);
  assert.equal(s.state, "present");
  assert.equal(s.warm, null);
});

// -------------------------------------------------------- run provenance

test("the run's date and sample size are read from the row, not omitted", () => {
  // A scoreboard with no date and no n invites the reader to treat it as a
  // standing property of the product. Both facts are already in the row.
  const runs = [
    { mode: "warm", created_at: "2026-10-08T04:17:02Z", metrics: { cases: [{ counted: true }, { counted: true }, { counted: false }] } },
    { mode: "cold", created_at: "2026-10-08T04:11:42Z", metrics: { cases: [{ counted: true }] } },
  ];
  // THE DENOMINATOR, not the array length. The oracle lists cases a run skipped
  // — counting those would make the sample look larger than it was scored over.
  assert.deepEqual(runProvenance(runs), { recordedAt: "2026-10-08T04:17:02Z", cases: 2 });
});

test("provenance of nothing is nulls, never a zero that reads as a measurement", () => {
  assert.deepEqual(runProvenance([]), { recordedAt: null, cases: null });
  assert.deepEqual(runProvenance(null), { recordedAt: null, cases: null });
  assert.equal(caseCount({ cases: "not an array" }), null);
  assert.equal(caseCount({ cases: [{ counted: false }, { counted: false }] }), 0, "listed but never scored");
  assert.equal(caseCount(null), null);
});

// ------------------------------------------------ the paired case comparison

const run = (mode, cases) => ({ mode, created_at: "2026-10-08T03:24:51Z", metrics: { cases } });
const kase = (id, over = {}) => ({ case_id: id, expected_outcome: "resolve", counted: true, outcome_match: true, steps: 6, recommendation: "resolve", ...over });

test("caseComparison: one row per case, both conditions joined — not one table per run", () => {
  // Governance rendered a table PER RUN: the same ten cases repeated, mostly
  // "not counted" dashes, with several runs carrying no per-case detail at all.
  const rows = caseComparison(
    run("cold", [kase("F1-2026Q2", { recommendation: "escalate", outcome_match: false, steps: 5 })]),
    run("warm", [kase("F1-2026Q2", { recommendation: "resolve", outcome_match: true, steps: 8 })]),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].without.recommendation, "escalate");
  assert.equal(rows[0].without.matched, false);
  assert.equal(rows[0].with_.recommendation, "resolve");
  assert.equal(rows[0].with_.matched, true);
  assert.equal(rows[0].expected, "resolve");
});

test("caseComparison: a case present in only one run still appears, with the other side null", () => {
  // Dropping it would silently shrink the comparison.
  const rows = caseComparison(run("cold", [kase("F1-2026Q2")]), run("warm", [kase("F3-2026Q2")]));
  assert.deepEqual(rows.map((r) => r.caseId), ["F1-2026Q2", "F3-2026Q2"]);
  assert.equal(rows[0].with_, null);
  assert.equal(rows[1].without, null);
});

test("caseComparison: an unscored case is marked, not silently counted", () => {
  const rows = caseComparison(run("cold", [kase("VANTAGE-2026Q3", { counted: false, outcome_match: null, steps: null, recommendation: null })]), null);
  assert.equal(rows[0].counted, false);
});

test("comparisonSummary: states what changed and refuses to claim lessons caused it", () => {
  // Three live runs read 60% / 100% / 60% cold while fixes were only added.
  // Two runs of five cases cannot support a causal claim.
  const s = comparisonSummary(
    run("cold", [kase("a", { outcome_match: false }), kase("b")]),
    run("warm", [kase("a", { outcome_match: true }), kase("b")]),
  );
  assert.match(s.headline, /matched more expected outcomes/);
  assert.match(s.detail, /cannot show that lessons caused/);
});

test("comparisonSummary: equal conditions are reported as equal, with the denominator", () => {
  const s = comparisonSummary(run("cold", [kase("a"), kase("b")]), run("warm", [kase("a"), kase("b")]));
  assert.match(s.headline, /same number/);
  assert.match(s.detail, /2 of 2 scored cases/);
});

test("comparisonSummary: nothing scored yields no summary rather than a 0% claim", () => {
  assert.equal(comparisonSummary(null, null), null);
  assert.equal(comparisonSummary(run("cold", [kase("a", { counted: false })]), null), null);
});

test("the date and the sample size describe the SAME run", () => {
  // THE BUG: the newest date and the first non-null case count were collected
  // independently, so the line read "recorded 8 Oct · n=1" where n came from a
  // different, older run. A provenance line that describes no run that happened.
  const runs = [
    { mode: "cold", created_at: "2026-10-01T00:00:00Z", metrics: { cases: [{ counted: true }] } },
    { mode: "warm", created_at: "2026-10-08T04:17:02Z", metrics: { cases: [{ counted: true }, { counted: true }, { counted: true }] } },
  ];
  assert.deepEqual(runProvenance(runs), { recordedAt: "2026-10-08T04:17:02Z", cases: 3 });
});

test("a run with no usable stamp reports neither fact", () => {
  // A case count with no date says nothing about when it was measured.
  assert.deepEqual(runProvenance([{ mode: "warm", created_at: null, metrics: { cases: [{ counted: true }] } }]), {
    recordedAt: null,
    cases: null,
  });
});
