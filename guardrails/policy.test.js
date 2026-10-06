import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPolicy, DEFAULT_POLICY } from "./policy.js";

const cf = (patch) => ({
  recommendation: "resolve",
  explanation: "Recomputed DSCR is 1.31 against the required 1.25x.",
  claims: [{ text: "The covenant requires 1.25x", citation: "CA §7.11", quote: "q" }],
  steps_count: 4,
  ...patch,
});

const passing = [{ calc_id: "c1", outputs: { dscr: 1.31, threshold: 1.25, pass: true, margin: 0.06 } }];

test("exposes the spec's defaults", () => {
  assert.equal(DEFAULT_POLICY.variance_tolerance, 0.05);
  assert.equal(DEFAULT_POLICY.escalate_if_breach_margin_over, 0.15);
  assert.equal(DEFAULT_POLICY.max_steps, 8);
  assert.equal(DEFAULT_POLICY.require_human_review, true);
});

test("leaves a clean resolve alone", () => {
  const { casefile, notes } = applyPolicy(cf(), DEFAULT_POLICY, passing);
  assert.equal(casefile.recommendation, "resolve");
  assert.equal(notes.length, 0);
});

test("a proposed prohibited action forces escalate", () => {
  for (const phrase of [
    "We recommend the lender waive covenant compliance for this quarter.",
    "Suggest we amend terms to reflect the new basis.",
    "Next step is to contact borrower for clarification.",
  ]) {
    const { casefile, notes } = applyPolicy(cf({ explanation: phrase }), DEFAULT_POLICY, passing);
    assert.equal(casefile.recommendation, "escalate", phrase);
    assert.ok(notes.some((n) => n.check === "prohibited_action"));
  }
});

test("a prohibited action inside a claim is caught too", () => {
  const c = cf({
    claims: [{ text: "The analyst should waive covenant testing", citation: "x", quote: "q" }],
  });
  assert.equal(applyPolicy(c, DEFAULT_POLICY, passing).casefile.recommendation, "escalate");
});

test("a breach deeper than the threshold always escalates", () => {
  const deep = [{ calc_id: "c1", outputs: { dscr: 1.0, threshold: 1.25, pass: false, margin: -0.25 } }];
  const { casefile, notes } = applyPolicy(cf(), DEFAULT_POLICY, deep);
  assert.equal(casefile.recommendation, "escalate");
  assert.ok(notes.some((n) => n.check === "breach_depth"));
});

test("a shallow breach is left to the agent's judgement", () => {
  const shallow = [{ calc_id: "c1", outputs: { dscr: 1.2, threshold: 1.25, pass: false, margin: -0.05 } }];
  assert.equal(applyPolicy(cf(), DEFAULT_POLICY, shallow).casefile.recommendation, "resolve");
});

test("reaching the step cap abstains rather than resolving", () => {
  const { casefile, notes } = applyPolicy(cf({ steps_count: 8 }), DEFAULT_POLICY, passing);
  assert.equal(casefile.recommendation, "abstain");
  assert.ok(notes.some((n) => n.check === "step_cap"));
});

test("policy values override the defaults", () => {
  const strict = { ...DEFAULT_POLICY, escalate_if_breach_margin_over: 0.01 };
  const breach = [{ calc_id: "c1", outputs: { dscr: 1.2, threshold: 1.25, pass: false, margin: -0.05 } }];
  assert.equal(applyPolicy(cf(), strict, breach).casefile.recommendation, "escalate");
});

test("does not mutate the casefile it was given", () => {
  const original = cf({ explanation: "We should waive covenant compliance." });
  const snapshot = JSON.stringify(original);
  applyPolicy(original, DEFAULT_POLICY, passing);
  assert.equal(JSON.stringify(original), snapshot);
});
