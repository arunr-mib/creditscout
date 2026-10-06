import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCasefileOutput, RECOMMENDATIONS, PATTERN_TAGS } from "./casefile-schema.js";

const good = (patch) => ({
  recommendation: "resolve",
  confidence_basis: "amendment located and applied",
  explanation: "Recomputed DSCR is 1.31 against the required 1.25x.",
  claims: [{ text: "t", citation: "CA §7.11", quote: "q" }],
  calculations: [{ calc_id: "calc_a1" }],
  missing_evidence: [],
  suggested_tag: "amendment_addback",
  ...patch,
});

test("accepts a well-formed output", () => {
  assert.equal(validateCasefileOutput(good()).valid, true);
});

test("exposes the four recommendations and six tags from the spec", () => {
  assert.deepEqual(RECOMMENDATIONS, ["resolve", "request", "escalate", "abstain"]);
  assert.equal(PATTERN_TAGS.length, 6);
});

test("rejects a non-object", () => {
  for (const bad of [null, undefined, "x", 1, []]) {
    assert.equal(validateCasefileOutput(bad).valid, false);
  }
});

test("rejects an unknown recommendation", () => {
  const r = validateCasefileOutput(good({ recommendation: "approve" }));
  assert.equal(r.valid, false);
  assert.match(r.errors.join(" "), /recommendation must be one of/);
});

test("rejects an unknown pattern tag", () => {
  assert.equal(validateCasefileOutput(good({ suggested_tag: "made_up" })).valid, false);
});

test("rejects an explanation over 150 words", () => {
  const r = validateCasefileOutput(good({ explanation: "word ".repeat(151) }));
  assert.equal(r.valid, false);
  assert.match(r.errors.join(" "), /150 words/);
});

test("rejects a claim missing its citation or quote", () => {
  assert.equal(validateCasefileOutput(good({ claims: [{ text: "t" }] })).valid, false);
  assert.equal(
    validateCasefileOutput(good({ claims: [{ text: "t", citation: "c", quote: "" }] })).valid,
    false,
  );
});

test("rejects a calculation without a calc_id", () => {
  assert.equal(validateCasefileOutput(good({ calculations: [{}] })).valid, false);
});

test("collects every error rather than stopping at the first", () => {
  const r = validateCasefileOutput({ recommendation: "nope", suggested_tag: "nope" });
  assert.ok(r.errors.length >= 4, `expected several errors, got ${r.errors.length}`);
});
