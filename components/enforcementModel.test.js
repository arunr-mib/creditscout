import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ENFORCEMENT_ACTION_LABEL, ENFORCEMENT_RULES } from "./enforcementModel.ts";

/**
 * The list on screen must name checks the code actually emits. A rule renamed
 * in guardrails/ and left stale here would have Governance describing an
 * enforcement that no longer exists — the one screen that must not overstate.
 */
const SOURCES = [
  "guardrails/guardrail.js",
  "guardrails/policy.js",
  "guardrails/terms-drift.js",
  "lib/agent/enforce.ts",
  "lib/agent/evidence.ts",
].map((p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")).join("\n");

test("every listed rule names a check the code emits", () => {
  for (const rule of ENFORCEMENT_RULES) {
    assert.ok(
      SOURCES.includes(`"${rule.check}"`),
      `${rule.check} is listed on Governance but no longer appears in the enforcement code`,
    );
  }
});

test("the list is complete for the guardrail layer", () => {
  // Caught by building this panel: the first count was four. These six are what
  // the casefile can actually show as a validation notice.
  const listed = ENFORCEMENT_RULES.map((r) => r.check).sort();
  assert.deepEqual(listed, [
    "calc_id_unknown",
    "figure_traceable",
    "quote_verbatim",
    "resolve_requires_evidence",
    "schema",
    "terms_differ_from_approved",
  ]);
});

test("every rule has an action label and no empty prose", () => {
  for (const rule of ENFORCEMENT_RULES) {
    assert.ok(ENFORCEMENT_ACTION_LABEL[rule.action], `${rule.check} has no action label`);
    assert.ok(rule.title.trim().length > 0 && rule.detail.trim().length > 0, `${rule.check} is missing copy`);
  }
});
