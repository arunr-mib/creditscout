import { test } from "node:test";
import assert from "node:assert/strict";

import {
  METRICS,
  RUN_EVAL_HARNESS,
  evalScoreboardState,
  scoreboardRows,
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
