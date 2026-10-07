import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CORRECTED_OUTCOMES,
  RECOMMENDATION_BADGE,
  calcRowsFor,
  calcSectionsOf,
  chipCitation,
  citationState,
  citationsOnScreen,
  claimsOf,
  clauseMap,
  formatFigure,
  humanReviewPolicy,
  isRecommendation,
  noticeHeading,
  noticesOf,
  overrideBlockers,
  reviewMode,
  seenSimilarCount,
  seenSimilarLabel,
} from "./casefileModel.ts";
import { memoryLoadedEntry, memoryUnavailableEntry } from "../lib/agent/trace.ts";

const AT = new Date("2026-10-06T00:00:00Z");

// ----------------------------------------------------- recommendation badge

test("the badge map is exhaustive over the four recommendations", () => {
  assert.deepEqual(Object.keys(RECOMMENDATION_BADGE).sort(), ["abstain", "escalate", "request", "resolve"]);
  for (const r of ["resolve", "request", "escalate", "abstain"]) {
    const b = RECOMMENDATION_BADGE[r];
    assert.ok(b.label && b.icon && b.tone, r);
    assert.ok(isRecommendation(r));
  }
  assert.equal(isRecommendation("approve"), false);
  assert.equal(isRecommendation(null), false);
  assert.equal(isRecommendation("toString"), false, "a prototype key is not a recommendation");
});

test("each recommendation has the design.md 5.1 colour and icon", () => {
  assert.match(RECOMMENDATION_BADGE.resolve.tone, /text-success/);
  assert.equal(RECOMMENDATION_BADGE.resolve.icon, "✓");
  assert.match(RECOMMENDATION_BADGE.request.tone, /text-human/);
  assert.equal(RECOMMENDATION_BADGE.request.icon, "?");
  assert.match(RECOMMENDATION_BADGE.escalate.tone, /text-danger/);
  assert.equal(RECOMMENDATION_BADGE.escalate.icon, "↑");
});

test("abstain is the muted token, never danger: abstaining is correct behaviour", () => {
  const abstain = RECOMMENDATION_BADGE.abstain;
  assert.match(abstain.tone, /text-text-muted/);
  assert.doesNotMatch(abstain.tone, /danger/);
  assert.equal(abstain.icon, "—");
});

test("a recommendation is worded as a recommendation, never as a decision", () => {
  for (const r of ["resolve", "request", "escalate"]) assert.match(RECOMMENDATION_BADGE[r].label, /^Recommends /);
  for (const b of Object.values(RECOMMENDATION_BADGE)) assert.doesNotMatch(b.label, /^(Resolved|Escalated|Approved)/);
});

// -------------------------------------------------------------------- claims

test("a claim with an empty citation produces the no-citation state, never nothing", () => {
  for (const empty of ["", "   ", undefined, null, 7, {}]) {
    assert.equal(citationState(empty), "missing", JSON.stringify(empty));
    // `undefined` is what CitationChip draws as the danger "no citation" chip.
    assert.equal(chipCitation(empty), undefined, JSON.stringify(empty));
  }
  assert.equal(citationState("CA §7.11"), "cited");
  assert.equal(chipCitation(" CA §7.11 "), "CA §7.11");
});

test("claimsOf keeps EVERY claim, in order, and marks the uncited one", () => {
  const claims = claimsOf([
    { text: "a", citation: "CA §7.11", quote: "q1" },
    { text: "b", citation: "", quote: "q2" },
    { text: "c", citation: "Amd 2 §3", quote: "q3" },
    null,
    "junk",
  ]);
  assert.deepEqual(claims.map((c) => [c.text, c.cited]), [["a", true], ["b", false], ["c", true]]);
  assert.deepEqual(claimsOf(undefined), []);
  assert.deepEqual(claimsOf({}), []);
});

// ---------------------------------------------------------------- calc table

const CALC = "7b2a3f9e-0000-4000-8000-000000000001";

/** A calc_log row as the agent's calculator tool writes it: string citations under financial_citations. */
const agentRow = (over = {}) => ({
  calc_id: CALC,
  inputs: {
    terms: {},
    financials: { ebitda: 5000000, unfinanced_capex: 300000, scheduled_principal: 1000000, cash_interest: 2000000, addback_amounts: { "restructuring charges": 620000 } },
    financial_citations: { ebitda: "Fin Q2 2026 §2", unfinanced_capex: "Fin Q2 2026 §3", scheduled_principal: "", cash_interest: "Fin Q2 2026 §5", addback_amounts: { "restructuring charges": "Fin Q2 2026 §4" } },
  },
  outputs: {
    components: {
      base: 5000000,
      addbacks: { "restructuring charges": { claimed: 620000, applied: 620000, cap: null, capped: false } },
      deductions: { unfinanced_capex: 300000 },
      denominator_parts: { scheduled_principal: 1000000, cash_interest: 2000000 },
      numerator_total: 5320000,
      denominator_total: 3000000,
    },
    dscr: 1.77,
    threshold: 1.25,
    pass: true,
    margin: 0.52,
  },
  ...over,
});

const byKey = (rows) => Object.fromEntries(rows.map((r) => [r.key, r]));

test("a row is quoted or computed from where its figure sits in the log, not by hand", () => {
  const rows = byKey(calcRowsFor(agentRow()));
  // Inputs read from a document, with a citation in the log: quoted, carrying that citation.
  assert.deepEqual(rows.ebitda.source, { kind: "quoted", citation: "Fin Q2 2026 §2", quote: "" });
  assert.equal(rows["deduction:unfinanced_capex"].source.kind, "quoted");
  assert.equal(rows["addback:restructuring charges:stated"].source.kind, "quoted");
  assert.equal(rows["addback:restructuring charges:stated"].source.citation, "Fin Q2 2026 §4");
  // Figures code produced: computed, carrying the calc_id.
  for (const k of ["addback:restructuring charges:applied", "numerator_total", "denominator_total", "dscr", "threshold", "margin"]) {
    assert.deepEqual(rows[k].source, { kind: "computed", calcId: CALC }, k);
  }
});

test("an input with no citation in the log is `uncited`, never silently sourced", () => {
  const rows = byKey(calcRowsFor(agentRow()));
  // scheduled_principal's citation is the empty string.
  assert.deepEqual(rows["denominator:scheduled_principal"].source, { kind: "uncited" });
  const noCitations = byKey(calcRowsFor(agentRow({ inputs: { terms: {}, financials: {} } })));
  assert.equal(noCitations.ebitda.source.kind, "uncited");
});

test("the quarterly test's citation shape, {citation, quote}, is read too, and the borrower's figure is quoted", () => {
  const row = agentRow({
    inputs: {
      terms: {},
      financials: {},
      citations: { ebitda: { citation: "Fin Q2 2026 §2", quote: "EBITDA: 5,000,000" }, addbacks: { "restructuring charges": { citation: "Fin Q2 2026 §4", quote: "Restructuring charges: 620,000" } } },
      reported: { dscr: 1.31, citation: "CC Q2 2026 §2", quote: "Debt service coverage ratio: 1.31x" },
    },
  });
  const rows = byKey(calcRowsFor(row));
  assert.deepEqual(rows.ebitda.source, { kind: "quoted", citation: "Fin Q2 2026 §2", quote: "EBITDA: 5,000,000" });
  assert.equal(rows["addback:restructuring charges:stated"].source.quote, "Restructuring charges: 620,000");
  assert.equal(rows.reported.value, 1.31);
  assert.equal(rows.reported.source.kind, "quoted", "a borrower's figure is quoted from their certificate, never computed");
  assert.equal(rows.reported.source.citation, "CC Q2 2026 §2");
});

test("a figure the log does not hold is not a row: nothing is defaulted to zero", () => {
  const rows = calcRowsFor({ calc_id: CALC, inputs: null, outputs: { dscr: 1.12 } });
  assert.deepEqual(rows.map((r) => r.key), ["dscr"]);
  assert.deepEqual(calcRowsFor({ calc_id: CALC, inputs: null, outputs: null }), []);
  assert.deepEqual(calcRowsFor({ calc_id: CALC, inputs: null, outputs: { dscr: "1.12", margin: NaN } }), []);
});

test("an uncapped add-back is described as uncapped, not as a cap of zero", () => {
  const rows = byKey(calcRowsFor(agentRow()));
  assert.equal(rows["addback:restructuring charges:applied"].note, "uncapped");
  const capped = agentRow();
  capped.outputs.components.addbacks["restructuring charges"] = { claimed: 620000, applied: 500000, cap: 500000, capped: true };
  assert.equal(byKey(calcRowsFor(capped))["addback:restructuring charges:applied"].note, "cap applied");
  const noField = agentRow();
  noField.outputs.components.addbacks["restructuring charges"] = { claimed: 620000, applied: 620000 };
  assert.equal(byKey(calcRowsFor(noField))["addback:restructuring charges:applied"].note, "uncapped");
});

test("sections are one per logged calculation, oldest first, and the last governs", () => {
  const s = calcSectionsOf([agentRow({ calc_id: "a" }), agentRow({ calc_id: "b" })]);
  assert.deepEqual(s.map((x) => [x.calcId, x.title, x.governing]), [["a", "Calculation 1 of 2", false], ["b", "Calculation 2 of 2", true]]);
  assert.deepEqual(calcSectionsOf([]), []);
});

test("figures format: ratios to two places, amounts grouped, a margin signed", () => {
  assert.equal(formatFigure(1.3, "ratio"), "1.30");
  assert.equal(formatFigure(5320000, "amount"), "5,320,000");
  assert.equal(formatFigure(0.52, "signed-ratio"), "+0.52");
  assert.equal(formatFigure(-0.13, "signed-ratio"), "-0.13");
});

test("the citations the screen can open are each claim's and each quoted figure's, once", () => {
  const claims = claimsOf([{ text: "a", citation: "CA §7.11", quote: "q" }, { text: "b", citation: "", quote: "" }, { text: "c", citation: "CA §7.11", quote: "q" }]);
  const sections = calcSectionsOf([agentRow()]);
  const cites = citationsOnScreen(claims, sections);
  assert.ok(cites.includes("CA §7.11") && cites.includes("Fin Q2 2026 §2"));
  assert.equal(new Set(cites).size, cites.length);
  assert.ok(!cites.includes(""));
});

test("a citation that resolves to no clause is null, so the panel can say so", () => {
  const chunks = [{ citation: "CA §7.11", doc_title: "Credit Agreement", doc_type: "agreement", section: "§7.11", content: "The ratio shall not be less than 1.25x." }];
  const map = clauseMap(["CA §7.11(b)", "CA §9.9", "§7.11", ""], chunks);
  assert.equal(map["CA §7.11(b)"].section, "§7.11");
  assert.equal(map["CA §9.9"], null);
  assert.equal(map["§7.11"], null, "a bare section names no document");
  assert.ok(!("" in map));
});

// ------------------------------------------------------------- guardrail notes

test("every guardrail note becomes a notice, and none is dropped", () => {
  const raw = [
    { layer: "guardrail", check: "traceability", action: "abstain", detail: '"1.47" matches no calculation' },
    { layer: "policy", check: "max_steps", action: "end_run", detail: "stopped at the cap" },
    "junk",
    null,
  ];
  const n = noticesOf(raw);
  assert.equal(n.length, 2);
  assert.equal(noticeHeading(n[0]), "Guardrail · forced abstain");
  assert.equal(noticeHeading(n[1]), "Policy · end run");
  assert.deepEqual(noticesOf([]), [], "no notes is no notices, not an empty box");
  assert.deepEqual(noticesOf(null), []);
  assert.deepEqual(noticesOf({ detail: "x" }), []);
  assert.equal(noticesOf([{ detail: "only a detail" }]).length, 1, "a malformed note is still shown");
});

// ---------------------------------------------------------------- seen similar

test("the badge is absent when zero lessons informed the case", () => {
  for (const none of [0, -1, 1.5, NaN, null, undefined, "2"]) assert.equal(seenSimilarLabel(none), null, String(none));
  assert.equal(seenSimilarLabel(1), "seen similar · 1 prior case");
  assert.equal(seenSimilarLabel(2), "seen similar · 2 prior cases");
});

test("the count is read from the trace written at the start of the run, in all three states", () => {
  assert.equal(seenSimilarCount([memoryLoadedEntry(2, AT)]), 2, "warm");
  assert.equal(seenSimilarCount([]), 0, "cold with nothing on file: no entry, no badge");
  assert.equal(seenSimilarCount([memoryUnavailableEntry("pgvector is down", AT)]), 0, "memory unavailable: no badge");
  assert.equal(seenSimilarLabel(seenSimilarCount([])), null);
  assert.equal(seenSimilarLabel(seenSimilarCount([memoryLoadedEntry(3, AT)])), "seen similar · 3 prior cases");
});

// ---------------------------------------------------------------- review state

test("only pending_review has an active action bar", () => {
  assert.equal(reviewMode("pending_review"), "active");
  for (const s of ["approved", "overridden", "awaiting_docs"]) assert.equal(reviewMode(s), "read_only", s);
  for (const s of ["investigating", "failed", "closed", "", null, undefined, 3]) assert.equal(reviewMode(s), "not_ready", String(s));
});

// -------------------------------------------------------------------- override

test("an override cannot be sent without a reason, a confirmed tag and a corrected outcome", () => {
  const ok = { reason: "We booked the old terms.", confirmedTag: "amendment_addback", correctedOutcome: "resolve" };
  assert.deepEqual(overrideBlockers(ok), []);
  assert.equal(overrideBlockers({ ...ok, reason: "" }).length, 1);
  assert.match(overrideBlockers({ ...ok, reason: "" })[0], /reason/i);
  assert.equal(overrideBlockers({ ...ok, reason: "   \n\t " }).length, 1, "whitespace is not a reason");
  assert.match(overrideBlockers({ ...ok, confirmedTag: "" })[0], /tag/i);
  assert.match(overrideBlockers({ ...ok, confirmedTag: "made_up" })[0], /tag/i);
  assert.match(overrideBlockers({ ...ok, correctedOutcome: "" })[0], /outcome/i);
  assert.match(overrideBlockers({ ...ok, correctedOutcome: "abstain" })[0], /outcome/i);
  assert.equal(overrideBlockers({ reason: "", confirmedTag: "", correctedOutcome: "" }).length, 3);
  assert.deepEqual(CORRECTED_OUTCOMES, ["resolve", "request", "escalate"]);
});

test("the blockers come in the order the dialog asks: reason, tag, outcome", () => {
  const b = overrideBlockers({ reason: "", confirmedTag: "", correctedOutcome: "" });
  assert.match(b[0], /reason/i);
  assert.match(b[1], /tag/i);
  assert.match(b[2], /outcome/i);
});

// ------------------------------------------------------------------ the policy

test("require_human_review is read as the policy holds it, and null when it cannot be", () => {
  assert.equal(humanReviewPolicy([{ key: "require_human_review", value: true }]), true);
  assert.equal(humanReviewPolicy([{ key: "require_human_review", value: false }]), false);
  assert.equal(humanReviewPolicy([{ key: "max_steps", value: 8 }]), null);
  assert.equal(humanReviewPolicy([{ key: "require_human_review", value: "true" }]), null);
  assert.equal(humanReviewPolicy(null), null);
});
