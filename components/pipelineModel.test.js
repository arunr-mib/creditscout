import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LANES,
  PIPELINE_REFRESH_MS,
  RECOMMENDATION_LABEL,
  barGeometry,
  hasRunningInvestigation,
  latestSteps,
  pipelineLanes,
  traceStepCount,
} from "./pipelineModel.ts";
import { activityTitle } from "./traceModel.ts";

const row = (over = {}) => ({
  facilityId: "F1",
  borrower: "Harbor Logistics",
  industry: null,
  termsVersion: 1,
  hasApprovedTerms: true,
  ours: 1.12,
  theirs: 1.3,
  required: 1.25,
  status: "breach_investigate",
  casefileId: null,
  exceptionId: "e1",
  exceptionStatus: "new",
  recommendation: null,
  ...over,
});

const laneOf = (over, steps) => {
  const lanes = pipelineLanes([row(over)], steps);
  const hit = lanes.filter((l) => l.cards.length > 0);
  assert.equal(hit.length, 1);
  return { key: hit[0].key, card: hit[0].cards[0] };
};

test("LANES: five lanes with their titles and empty copy", () => {
  assert.deepEqual(
    LANES.map((l) => [l.key, l.title, l.empty]),
    [
      ["investigate", "Needs investigating", "Nothing waiting."],
      ["working", "CreditScout working", "Nothing running. An investigation runs here while its casefile is open."],
      ["decision", "Awaiting your decision", "Nothing waiting for you."],
      ["decided", "Decided", "Nothing decided this quarter yet."],
      ["also", "Also in the book", "Nothing else on the book."],
    ],
  );
  assert.equal(PIPELINE_REFRESH_MS, 5000);
});

test("lane mapping: breach_investigate -> investigate / investigate", () => {
  const { key, card } = laneOf({ status: "breach_investigate" });
  assert.equal(key, "investigate");
  assert.equal(card.action, "investigate");
  assert.equal(card.note, null);
});

test("lane mapping: investigating -> working, opens the casefile", () => {
  const { key, card } = laneOf({ status: "investigating", casefileId: "c1", exceptionStatus: "investigating" });
  assert.equal(key, "working");
  assert.equal(card.action, "open");
  assert.equal(card.note, null);
});

test("lane mapping: investigation_paused -> working, paused note, open", () => {
  const { key, card } = laneOf({ status: "investigation_paused", casefileId: "c1" });
  assert.equal(key, "working");
  assert.equal(card.note, "Investigation paused");
  assert.equal(card.action, "open");
});

test("lane mapping: in_review -> decision / review", () => {
  const { key, card } = laneOf({ status: "in_review", casefileId: "c1", recommendation: "resolve" });
  assert.equal(key, "decision");
  assert.equal(card.action, "review");
  assert.equal(card.recommendation, "resolve");
  assert.equal(card.note, null);
});

test("lane mapping: awaiting_docs -> decision, held note, review", () => {
  const { key, card } = laneOf({ status: "awaiting_docs", casefileId: "c1" });
  assert.equal(key, "decision");
  assert.equal(card.note, "Held for borrower documents");
  assert.equal(card.action, "review");
});

test("lane mapping: decided -> decided; open only with a casefile", () => {
  const withCf = laneOf({ status: "decided", casefileId: "c1", exceptionStatus: "closed" });
  assert.equal(withCf.key, "decided");
  assert.equal(withCf.card.action, "open");
  const without = laneOf({ status: "decided", casefileId: null, exceptionStatus: "closed" });
  assert.equal(without.card.action, null);
});

test("compliant and not_tested land in the also lane, with no action and no other lane touched", () => {
  const lanes = pipelineLanes([
    row({ facilityId: "F7", status: "compliant", casefileId: null, exceptionId: null, exceptionStatus: null }),
    row({ facilityId: "F9", status: "not_tested", ours: null, theirs: null, casefileId: null, exceptionId: null, exceptionStatus: null }),
  ]);
  assert.deepEqual(lanes.map((l) => l.key), ["investigate", "working", "decision", "decided", "also"]);
  for (const l of lanes.filter((l) => l.key !== "also")) assert.deepEqual(l.cards, []);
  const also = lanes.find((l) => l.key === "also").cards;
  assert.deepEqual(also.map((c) => [c.facilityId, c.status, c.action, c.recommendationLabel, c.note]), [
    ["F7", "compliant", null, null, null],
    ["F9", "not_tested", null, null, null],
  ]);
});

test("card carries the row's figures and ids", () => {
  const { card } = laneOf({ status: "in_review", casefileId: "c1" });
  assert.equal(card.facilityId, "F1");
  assert.equal(card.borrower, "Harbor Logistics");
  assert.equal(card.ours, 1.12);
  assert.equal(card.theirs, 1.3);
  assert.equal(card.required, 1.25);
  assert.equal(card.status, "in_review");
  assert.equal(card.casefileId, "c1");
  assert.equal(card.exceptionId, "e1");
  assert.equal(card.exceptionStatus, "new");
});

test("reopened: a new exception that already has a casefile", () => {
  const failed = laneOf({ status: "breach_investigate", casefileId: null, exceptionStatus: "new" });
  assert.equal(failed.key, "investigate");
  assert.equal(failed.card.action, "investigate");
  assert.equal(failed.card.reopened, false);
  const reopened = laneOf({ status: "breach_investigate", casefileId: "c9", exceptionStatus: "new" });
  assert.equal(reopened.card.reopened, true);
  const noException = laneOf({ status: "breach_investigate", casefileId: "c9", exceptionStatus: null });
  assert.equal(noException.card.reopened, false);
});

test("stepsByCasefile fills the matching card; others get []", () => {
  const rows = [
    row({ facilityId: "F1", status: "investigating", casefileId: "c1" }),
    row({ facilityId: "F3", status: "investigating", casefileId: "c2" }),
    row({ facilityId: "F5", status: "breach_investigate" }),
  ];
  const lanes = pipelineLanes(rows, new Map([["c1", ["a", "b"]]]));
  const working = lanes.find((l) => l.key === "working").cards;
  assert.deepEqual(working.find((c) => c.facilityId === "F1").steps, ["a", "b"]);
  assert.deepEqual(working.find((c) => c.facilityId === "F3").steps, []);
  assert.deepEqual(lanes.find((l) => l.key === "investigate").cards[0].steps, []);
  // The map is optional.
  assert.deepEqual(pipelineLanes(rows)[1].cards[0].steps, []);
});

test("barGeometry: the loan's own minimum sits at the midpoint", () => {
  assert.deepEqual(barGeometry(1.12, 1.25), { fillPct: 44.8, minPct: 50 });
  assert.equal(barGeometry(1.59, 1.35).fillPct, 58.9);
  assert.equal(barGeometry(4, 1.25).fillPct, 100);
  assert.equal(barGeometry(0, 1.25).fillPct, 0);
  assert.equal(barGeometry(-1, 1.25).fillPct, 0);
});

test("barGeometry: a missing number or non-positive minimum draws no bar", () => {
  assert.equal(barGeometry(null, 1.25), null);
  assert.equal(barGeometry(1.1, null), null);
  assert.equal(barGeometry(1.1, 0), null);
});

test("latestSteps: titles of the last n tools, newest last", () => {
  const trace = [{ tool: "search_documents" }, { tool: "dscr_calculator" }, { tool: "search_past_cases" }];
  assert.deepEqual(latestSteps(trace, 2), [activityTitle("dscr_calculator"), activityTitle("search_past_cases")]);
  assert.equal(latestSteps(trace).length, 3);
  assert.deepEqual(latestSteps(trace, 1), [activityTitle("search_past_cases")]);
});

test("latestSteps: non-array input is empty", () => {
  assert.deepEqual(latestSteps(null), []);
  assert.deepEqual(latestSteps(undefined), []);
  assert.deepEqual(latestSteps({ tool: "x" }), []);
  assert.deepEqual(latestSteps("nope"), []);
});

test("traceStepCount: counts tool entries, ignores junk and non-arrays", () => {
  assert.equal(traceStepCount([{ tool: "a" }, { tool: "b" }, null, { x: 1 }]), 2);
  assert.equal(traceStepCount(null), 0);
  assert.equal(traceStepCount({ tool: "x" }), 0);
});

test("stepCountByCasefile fills card.stepCount; default 0", () => {
  const rows = [
    row({ facilityId: "F1", status: "investigating", casefileId: "c1" }),
    row({ facilityId: "F3", status: "investigating", casefileId: "c2" }),
  ];
  const working = pipelineLanes(rows, undefined, new Map([["c1", 4]]))[1].cards;
  assert.equal(working.find((c) => c.facilityId === "F1").stepCount, 4);
  assert.equal(working.find((c) => c.facilityId === "F3").stepCount, 0);
  assert.equal(pipelineLanes(rows)[1].cards[0].stepCount, 0);
});

test("hasRunningInvestigation: only `investigating` polls, a paused card does not", () => {
  const lanesOf = (...statuses) =>
    pipelineLanes(statuses.map((status, i) => row({ facilityId: `F${i}`, status, casefileId: `c${i}` })));
  assert.equal(hasRunningInvestigation(lanesOf("investigating")), true);
  assert.equal(hasRunningInvestigation(lanesOf("investigation_paused")), false);
  assert.equal(hasRunningInvestigation(lanesOf("investigation_paused", "investigating")), true);
  assert.equal(hasRunningInvestigation(lanesOf("in_review", "decided")), false);
  assert.equal(hasRunningInvestigation(lanesOf()), false);
});

test("recommendationLabel: readable in the decision lane, absent elsewhere", () => {
  assert.deepEqual(RECOMMENDATION_LABEL, {
    resolve: "Resolve",
    escalate: "Escalate",
    request: "Request documents",
    abstain: "No recommendation",
  });
  for (const [rec, label] of Object.entries(RECOMMENDATION_LABEL)) {
    const { card } = laneOf({ status: "in_review", casefileId: "c1", recommendation: rec });
    assert.equal(card.recommendationLabel, label);
  }
  assert.equal(laneOf({ status: "in_review", casefileId: "c1", recommendation: null }).card.recommendationLabel, null);
  assert.equal(laneOf({ status: "in_review", casefileId: "c1", recommendation: "bogus" }).card.recommendationLabel, null);
});

test("recommendationLabel: a decided card shows no agent recommendation", () => {
  const { key, card } = laneOf({ status: "decided", casefileId: "c1", exceptionStatus: "closed", recommendation: "resolve" });
  assert.equal(key, "decided");
  assert.equal(card.recommendationLabel, null);
});
