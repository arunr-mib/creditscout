import { test } from "node:test";
import assert from "node:assert/strict";

import {
  groupLessons,
  isAnalystReasoning,
  lessonSource,
  outcomeLabel,
  patternLabel,
  recordedOutcome,
  RECORD_KIND_LABEL,
  RECORD_KIND_NOTE,
  isReusablePrecedent,
  recordCounts,
  recordKind,
} from "./lessons.ts";

test("a lesson written by the eval harness is never presented as an analyst decision", () => {
  // These lessons are retrieved into later investigations. Mislabelling one as
  // a lender's judgement does not sit still — it compounds.
  assert.equal(lessonSource("eval-20261008T041702Z-warm", "approve"), "evaluation");
  assert.equal(lessonSource("eval-20261008T041702Z-warm", "override"), "evaluation");
  assert.equal(lessonSource("demo", "approve"), "approved");
  assert.equal(lessonSource("demo", "override"), "override");
  assert.equal(lessonSource(null, "approve"), "approved");
});

test("an override does not tell you the outcome; the corrected outcome does", () => {
  assert.equal(recordedOutcome("override", "escalate", "abstain"), "escalate");
  // An approve leaves the agent's recommendation standing.
  assert.equal(recordedOutcome("approve", null, "resolve"), "resolve");
  // Absent is null — never the other value as a stand-in.
  assert.equal(recordedOutcome("override", null, "abstain"), null, "must not fall back to the rejected recommendation");
  assert.equal(recordedOutcome("approve", null, null), null);
  assert.equal(recordedOutcome("request_docs", null, "resolve"), null, "nothing was concluded");
});

test("machine tags become words a credit analyst uses", () => {
  assert.equal(patternLabel("amendment_addback"), "Amendment add-back");
  assert.equal(patternLabel("true_breach"), "Confirmed breach");
  assert.equal(patternLabel(null), null);
  // An unknown tag is still shown, de-underscored, rather than dropped.
  assert.equal(patternLabel("some_new_tag"), "some new tag");
  assert.equal(outcomeLabel("resolve"), "Exception resolved");
  assert.equal(outcomeLabel(null), null);
});

test("a system summary is not analyst reasoning", () => {
  // `storeLesson` composes a summary when a reviewer approves without typing
  // anything; the eval harness writes its own rationale. Neither is an analyst.
  assert.equal(isAnalystReasoning("approved", "The add-back is capped; I accept it."), true);
  assert.equal(isAnalystReasoning("approved", null), false);
  assert.equal(isAnalystReasoning("approved", "   "), false);
  assert.equal(isAnalystReasoning("evaluation", "Eval script: the signed oracle expects resolve."), false);
});

test("repeated borrower/period entries group without losing history", () => {
  const row = (id, borrower, period, createdAt) => ({
    id, borrower, period, createdAt,
    source: "approved", patternTag: null, outcome: null, analystReasoning: null, storedText: null, casefileId: "c",
  });
  const groups = groupLessons([
    row("1", "Harbor Logistics", "Q2 2026", "2026-10-01"),
    row("2", "Northgate Foods", "Q2 2026", "2026-10-02"),
    row("3", "Harbor Logistics", "Q2 2026", "2026-10-03"),
  ]);
  assert.equal(groups.length, 2);
  const harbor = groups.find((g) => g.borrower === "Harbor Logistics");
  assert.equal(harbor.records.length, 2, "both records survive");
  assert.equal(harbor.records[0].id, "3", "newest first");
  assert.deepEqual(groupLessons([]), []);
});

// ------------------------------------------------- what a record actually is

test("recordKind: an approval with no written reasoning is a decision record, not a lesson", () => {
  // The distinction the screen was blurring. A casefile approved without the
  // analyst writing anything records WHAT was decided and nothing about WHY.
  assert.equal(recordKind("approved", null), "decision_record");
  assert.equal(recordKind("approved", "   "), "decision_record");
  assert.equal(recordKind("approved", "The amendment is on file but unboarded."), "analyst_lesson");
});

test("recordKind: an override always carries reasoning, and an eval example never counts as one", () => {
  assert.equal(recordKind("override", "Reported figure traces to the certificate."), "analyst_lesson");
  // The harness writes its own rationale. Presenting it as analyst precedent is
  // the specific dishonesty lessons.ts already guards against.
  assert.equal(recordKind("evaluation", "Eval script: true_breach confirmed against the signed oracle."), "evaluation_example");
});

test("isReusablePrecedent: only an analyst's written reasoning is precedent", () => {
  assert.equal(isReusablePrecedent("analyst_lesson"), true);
  assert.equal(isReusablePrecedent("decision_record"), false);
  assert.equal(isReusablePrecedent("evaluation_example"), false);
});

test("recordCounts: the result line reconciles with what the list actually contains", () => {
  const counts = recordCounts([
    { source: "approved", analystReasoning: "why" },
    { source: "approved", analystReasoning: null },
    { source: "override", analystReasoning: "because" },
    { source: "evaluation", analystReasoning: "Eval script: ..." },
  ]);
  assert.deepEqual(counts, { total: 4, analystLessons: 2, decisionRecords: 1, evaluationExamples: 1 });
  assert.equal(counts.analystLessons + counts.decisionRecords + counts.evaluationExamples, counts.total);
});

test("every record kind has a label and a note explaining what it is", () => {
  for (const k of ["analyst_lesson", "decision_record", "evaluation_example"]) {
    assert.ok(RECORD_KIND_LABEL[k], `${k} label`);
    assert.ok(RECORD_KIND_NOTE[k].length > 20, `${k} note`);
  }
});
