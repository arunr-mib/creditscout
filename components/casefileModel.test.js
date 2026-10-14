import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CORRECTED_OUTCOMES,
  RECOMMENDATION_BADGE,
  amendmentStatuses,
  calcRowsFor,
  calcSectionsOf,
  chipCitation,
  citationState,
  NOTICE_WEIGHT_LABEL,
  OUTCOME_CHOICE,
  groupNotices,
  noticeWeight,
  TAGS,
  TAG_LABEL,
  citationsOnScreen,
  decisionBasis,
  tagLabel,
  claimsOf,
  clauseMap,
  exceptionNeedsClosing,
  formatFigure,
  headlineFor,
  humanReviewNotice,
  humanReviewPolicy,
  isRecommendation,
  addbackFromNote,
  investigationSummary,
  noticeHeading,
  recommendationOverridden,
  noticesOf,
  overrideBlockers,
  reviewMode,
  outstandingSummary,
  statusHeadline,
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
  // Figures code produced: computed, carrying the calc_id. The threshold is NOT
  // here — it is a covenant term, asserted separately below.
  for (const k of ["addback:restructuring charges:applied", "numerator_total", "denominator_total", "dscr", "margin"]) {
    assert.deepEqual(rows[k].source, { kind: "computed", calcId: CALC }, k);
  }
});

test("the required minimum is a covenant term, never computed by code (no amber)", () => {
  // No covenant citation in the log -> a plain approved term, not a code output.
  const plain = byKey(calcRowsFor(agentRow())).threshold;
  assert.equal(plain.value, 1.25);
  assert.deepEqual(plain.source, { kind: "term" });
  assert.notEqual(plain.source.kind, "computed", "the threshold must never render amber 'computed by code'");

  // With the covenant citation in the log (terms.threshold.citation) -> quoted, teal.
  const withCite = agentRow();
  withCite.inputs.terms = { threshold: { min_dscr: 1.25, citation: "CA §7.11" } };
  const quoted = byKey(calcRowsFor(withCite)).threshold;
  assert.deepEqual(quoted.source, { kind: "quoted", citation: "CA §7.11", quote: "" });
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

test("an overruled recommendation is detected from the notice action alone", () => {
  const abstain = { layer: "guardrail", check: "figure_traceable", action: "abstain", detail: "" };
  const escalate = { layer: "guardrail", check: "resolve_requires_evidence", action: "escalate", detail: "" };
  assert.equal(recommendationOverridden([abstain]), true);
  assert.equal(recommendationOverridden([escalate]), true);

  // These record something OTHER than a replaced recommendation. Treating them
  // as an override would brand every capped or unchecked run a rejected draft.
  assert.equal(
    recommendationOverridden([{ layer: "policy", check: "max_steps", action: "end_run", detail: "" }]),
    false,
    "the step cap ends a run; it does not overrule the recommendation",
  );
  assert.equal(recommendationOverridden([{ layer: "policy", check: "p", action: "forced_true", detail: "" }]), false);
  assert.equal(recommendationOverridden([{ layer: "guardrail", check: "c", action: "not_checked", detail: "" }]), false);

  assert.equal(recommendationOverridden([]), false, "a clean casefile is not an overruled one");
  assert.equal(
    recommendationOverridden([{ layer: "policy", check: "max_steps", action: "end_run", detail: "" }, abstain]),
    true,
    "one overruling note among others is still an override",
  );
  // A note so malformed it has no action cannot claim the recommendation was
  // replaced; `noticesOf` already turns a missing action into "".
  assert.equal(recommendationOverridden(noticesOf([{ detail: "only a detail" }])), false);
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

test("the human-review notice is driven by the actual value, never mandatory by default", () => {
  assert.equal(humanReviewNotice(true).mandatory, true);
  assert.match(humanReviewNotice(true).text, /mandatory by policy/i);
  // false must not claim mandatory.
  assert.equal(humanReviewNotice(false).mandatory, false);
  assert.doesNotMatch(humanReviewNotice(false).text, /mandatory by policy/i);
  assert.match(humanReviewNotice(false).text, /does not require/i);
  // null/unreadable must not claim mandatory, and must say it is not readable.
  assert.equal(humanReviewNotice(null).mandatory, false);
  assert.doesNotMatch(humanReviewNotice(null).text, /mandatory by policy/i);
  assert.match(humanReviewNotice(null).text, /not readable/i);
});

// -------------------------------------------- exception-close drift (read-only)

test("a decided casefile whose exception never closed is flagged for repair", () => {
  // The A-4 drift a failed close leaves: decided, exception still pending_review.
  assert.equal(exceptionNeedsClosing("approved", "pending_review"), true);
  assert.equal(exceptionNeedsClosing("overridden", "pending_review"), true);
  // The healthy case: the close succeeded.
  assert.equal(exceptionNeedsClosing("approved", "closed"), false);
  assert.equal(exceptionNeedsClosing("overridden", "closed"), false);
  // A later breach reopened the exception to `new` (F7): a live exception, not
  // drift — must NOT be offered the repair.
  assert.equal(exceptionNeedsClosing("approved", "new"), false);
  assert.equal(exceptionNeedsClosing("approved", "investigating"), false);
  // Not a decided casefile: nothing to reconcile.
  assert.equal(exceptionNeedsClosing("pending_review", "pending_review"), false);
  assert.equal(exceptionNeedsClosing("awaiting_docs", "pending_review"), false);
  assert.equal(exceptionNeedsClosing("approved", null), false);
});

// ----------------------------------------------------------- headlineFor
test("headlineFor pulls the governing calc's DSCR, required, and margin", () => {
  const sections = [
    { calcId: "aaaa1111-0000-0000-0000-000000000000", title: "Calculation 1 of 2", governing: false,
      rows: [{ key: "dscr", label: "Calculated DSCR", value: 1.12, format: "ratio", source: { kind: "computed", calcId: "x" }, note: "breach" }] },
    { calcId: "bbbb2222-0000-0000-0000-000000000000", title: "Calculation 2 of 2", governing: true, rows: [
      { key: "dscr", label: "Calculated DSCR", value: 1.28, format: "ratio", source: { kind: "computed", calcId: "y" }, note: "passes" },
      { key: "threshold", label: "Required minimum", value: 1.25, format: "ratio", source: { kind: "term" } },
      { key: "margin", label: "Margin", value: 0.03, format: "signed-ratio", source: { kind: "computed", calcId: "y" } },
    ] },
  ];
  const h = headlineFor(sections);
  assert.equal(h.dscr, 1.28, "the governing (last) calc's DSCR, not the baseline");
  assert.equal(h.passes, true);
  assert.equal(h.required, 1.25);
  assert.equal(h.margin, 0.03);
  assert.ok(h.calcId.startsWith("bbbb"));
});

test("headlineFor is null when there is no calculation to summarise", () => {
  assert.equal(headlineFor([]), null);
});

// ------------------------------------------------------- amendmentStatuses

test("amendmentStatuses flags an amendment on file but not boarded into the terms", () => {
  const docs = [
    { doc_type: "agreement", title: "Credit Agreement", effective_date: "2025-01-01" },
    { doc_type: "amendment", title: "Amendment No. 2", effective_date: "2026-03-01" },
    { doc_type: "financials", title: "Financials — Q2 2026", effective_date: null },
  ];
  // Governing terms cite no amendment: the boarding lag.
  const r = amendmentStatuses(docs, [], "2026-06-30");
  assert.equal(r.length, 1);
  assert.deepEqual(r[0], { title: "Amendment No. 2", effectiveDate: "2026-03-01", effectiveForPeriod: true, boarded: false });
});

test("amendmentStatuses marks a boarded amendment (title match is case/space-insensitive)", () => {
  const docs = [{ doc_type: "amendment", title: "Amendment No. 2", effective_date: "2026-03-01" }];
  const r = amendmentStatuses(docs, [{ doc: "amendment no. 2 ", effective: "2026-03-01", citation: "Amd 2 §3" }], "2026-06-30");
  assert.equal(r[0].boarded, true);
});

test("amendmentStatuses: an amendment effective after the period does not bear on this test", () => {
  const docs = [{ doc_type: "amendment", title: "Amendment No. 3", effective_date: "2026-09-01" }];
  const r = amendmentStatuses(docs, [], "2026-06-30");
  assert.equal(r[0].effectiveForPeriod, false);
});

// --------------------------------------------- the investigation summary

const sec = (calcId, dscr, governing, threshold) => ({
  calcId,
  title: "",
  governing,
  rows: [
    { key: "dscr", value: dscr, note: threshold != null && dscr != null ? (dscr < threshold ? "breach" : "passes") : null },
    ...(threshold == null ? [] : [{ key: "threshold", value: threshold, note: null }]),
  ],
});

const TERMS_NOTE = {
  layer: "guardrail",
  check: "terms_differ_from_approved",
  action: "flag",
  detail:
    'the governing calculation ran on terms that differ from the approved version: added add-back "fuel hedging mark-to-market losses" (cap 800000) — Amd 2 §3',
};

test("addbackFromNote reads the guardrail's own words, and never invents a cap", () => {
  assert.deepEqual(addbackFromNote(TERMS_NOTE.detail), { name: "fuel hedging mark-to-market losses", cap: 800000 });
  // THE KNOWN TRAP: an add-back with no cap is UNCAPPED. Reading it as 0 flips a
  // correct resolve into a false escalation, so it must stay null.
  assert.deepEqual(addbackFromNote('added add-back "restructuring charges"'), {
    name: "restructuring charges",
    cap: null,
  });
  assert.equal(addbackFromNote("nothing of the sort here"), null);
});

test("the summary is assembled from the calculation log, not written", () => {
  const sections = [sec("c1", 1.12, false, 1.25), sec("c2", 1.3, true, 1.25)];
  const s = investigationSummary(sections, [TERMS_NOTE]);

  assert.equal(s.initial.dscr, 1.12);
  assert.equal(s.governing.dscr, 1.3);
  assert.equal(s.required, 1.25);
  assert.equal(s.onAmendedTerms, true);

  assert.equal(s.steps.length, 3);
  assert.match(s.steps[0].detail, /1\.12x against a 1\.25x minimum/);
  assert.match(s.steps[1].detail, /capped at \$800,000/);
  assert.match(s.steps[2].detail, /1\.30x/);

  // The comparison names the basis of each figure — that pairing is the whole
  // point: 1.30 is NOT what the approved terms produce.
  assert.deepEqual(s.comparison, [
    { basis: "Initial test", dscr: 1.12, status: "below_minimum" },
    { basis: "Amendment scenario", dscr: 1.3, status: "provisional" },
  ]);
});

test("a clean pass with one calculation produces no amendment step and no comparison row", () => {
  const s = investigationSummary([sec("c1", 1.4, true, 1.25)], []);
  assert.equal(s.onAmendedTerms, false);
  assert.equal(s.addback, null);
  assert.equal(s.steps.length, 1);
  assert.equal(s.comparison.length, 1, "nothing to compare against");
  assert.equal(s.comparison[0].status, "meets_minimum");
});

test("a recalculation that did not move the figure earns no third step", () => {
  const s = investigationSummary([sec("c1", 1.12, false, 1.25), sec("c2", 1.12, true, 1.25)], []);
  assert.equal(s.steps.length, 1, "repeating the same figure is not a finding");
});

test("a missing figure is never read as a pass", () => {
  const s = investigationSummary([sec("c1", null, true, 1.25)], []);
  assert.equal(s.comparison[0].status, "unknown");
  assert.match(s.steps[0].detail, /—/);
});

test("the recommendation headline is composed from branches, never generated", () => {
  const above = investigationSummary([sec("c1", 1.12, false, 1.25), sec("c2", 1.3, true, 1.25)], [TERMS_NOTE]);
  assert.equal(
    above.headline,
    "The agent identified an additional permitted add-back and recalculated the DSCR above the minimum.",
  );
  // The same shape that does NOT clear the floor must not claim it did.
  const below = investigationSummary([sec("c1", 1.02, false, 1.25), sec("c2", 1.18, true, 1.25)], [TERMS_NOTE]);
  assert.match(below.headline, /still below the minimum/);
  // No add-back: it STATES THE SITUATION. It used to repeat the first
  // finding's sentence verbatim, so the card and the finding under it said the
  // same words twice.
  const pass = investigationSummary([sec("c1", 1.4, true, 1.25)], []);
  assert.equal(pass.headline, "The covenant test passes under the approved terms.");
  assert.notEqual(pass.headline, pass.steps[0].detail);
  const fail = investigationSummary([sec("c1", 1.12, false, 1.25)], []);
  assert.equal(fail.headline, "The covenant exception remains unresolved under the approved terms.");
  assert.equal(investigationSummary([], []).headline, null);
});

// ------------------------------------------------ the decision narrative

const DB_SUMMARY = (over = {}) => ({
  initial: { calcId: "c1", dscr: 1.12 },
  governing: { calcId: "c2", dscr: 1.12, passes: false },
  required: 1.25,
  onAmendedTerms: false,
  addback: null,
  steps: [],
  comparison: [],
  headline: "",
  ...over,
});

const DB_OVERRIDE = { layer: "guardrail", check: "resolve_requires_evidence", action: "escalate", detail: "the governing calculation does not pass" };

test("decisionBasis: a guardrail override is reported as policy-directed, not as the agent's view", () => {
  // Harbor Logistics, live: the agent drafted `resolve` arguing Amendment No. 2
  // permits a capped add-back, and the guardrail downgraded it. Attributing the
  // escalation to the agent would misdescribe who decided.
  const d = decisionBasis(DB_SUMMARY(), [DB_OVERRIDE], "resolve", 2);
  assert.equal(d.policyDirected, true);
  assert.equal(d.draft, "resolve");
  assert.match(d.overrideReason, /does not pass/);
  assert.equal(d.basis, "1.12x calculated against a 1.25x minimum.");
  assert.equal(d.outstanding, "2 items to review before recording a decision.");
});

const AMD_PENDING = [{ title: "Amendment No. 2", effectiveDate: "2026-04-01", effectiveForPeriod: true, boarded: false }];

test("decisionBasis: the pending amendment is explained as the REASON to escalate, not a doubt about it", () => {
  // The gap the owner identified: an escalation shown beside a pending
  // amendment, with nothing saying how the two relate.
  const d = decisionBasis(
    DB_SUMMARY({ onAmendedTerms: true, addback: { name: "restructuring charges", cap: 500000 } }),
    [DB_OVERRIDE],
    "resolve",
    2,
    AMD_PENDING,
  );
  assert.match(d.amendmentEffect, /Amendment No\. 2/);
  assert.match(d.amendmentEffect, /restructuring charges/);
  assert.match(d.amendmentEffect, /terms in force/);
  assert.match(d.amendmentEffect, /what there is to review/);
});

test("decisionBasis: an unboarded amendment is explained even when no drift note was raised", () => {
  // The live Harbor casefile has notes calc_id_unknown + resolve_requires_evidence
  // and NO terms-drift note, yet the panel beside the recommendation still says
  // "Amendment No. 2 — not reflected in approved terms". Keying only off the
  // note left exactly that case unexplained.
  const d = decisionBasis(DB_SUMMARY(), [DB_OVERRIDE], "resolve", 2, AMD_PENDING);
  assert.match(d.amendmentEffect, /Amendment No\. 2 is on file but is not reflected/);
});

test("decisionBasis: an amendment that is boarded, or not yet effective, is not raised", () => {
  const boarded = [{ title: "Amendment No. 2", effectiveDate: "2026-04-01", effectiveForPeriod: true, boarded: true }];
  const future = [{ title: "Amendment No. 3", effectiveDate: "2027-01-01", effectiveForPeriod: false, boarded: false }];
  assert.equal(decisionBasis(DB_SUMMARY(), [], null, 0, boarded).amendmentEffect, null);
  assert.equal(decisionBasis(DB_SUMMARY(), [], null, 0, future).amendmentEffect, null);
});

test("decisionBasis: says nothing it cannot support", () => {
  // No override -> the recommendation is the agent's own and must not be
  // labelled policy-directed. No drift note -> no amendment sentence at all.
  const d = decisionBasis(DB_SUMMARY(), [], "escalate", 0);
  assert.equal(d.policyDirected, false);
  assert.equal(d.draft, null);
  assert.equal(d.overrideReason, null);
  assert.equal(d.amendmentEffect, null, "no amendment sentence without a drift note");
  assert.equal(d.outstanding, null, "no '0 items' line");
});

test("decisionBasis: a missing figure yields no basis sentence rather than a half-written one", () => {
  const d = decisionBasis(DB_SUMMARY({ governing: null, required: null }), [DB_OVERRIDE], "resolve", 1);
  assert.equal(d.basis, null);
  assert.equal(d.outstanding, "1 item to review before recording a decision.");
});

// -------------------------------------- the analyst's vocabulary, not the model's

test("tagLabel: the pattern tag an analyst confirms is never shown as an identifier", () => {
  // `amendment_addback` is the guardrail enum's and must not change. It is also
  // not something to put in front of a credit analyst.
  assert.equal(tagLabel("amendment_addback"), "Amendment-related add-back");
  assert.equal(tagLabel("true_breach"), "Genuine covenant breach");
  assert.equal(tagLabel("missing_waiver"), "Missing or unexecuted waiver");
});

test("tagLabel: an unmapped tag is humanised rather than leaked raw", () => {
  // PATTERN_TAGS is owned by guardrails/casefile-schema.js. If a value is added
  // there and not here, the dialog must still read as English.
  assert.equal(tagLabel("some_new_pattern"), "Some new pattern");
});

test("every pattern tag the agent can emit has an analyst-facing label", () => {
  // A missing label would surface the identifier in the override dialog.
  for (const t of TAGS) {
    assert.notEqual(TAG_LABEL[t], undefined, `${t} has no analyst-facing label`);
  }
});

test("OUTCOME_CHOICE: each decision is an action with what recording it means", () => {
  for (const o of CORRECTED_OUTCOMES) {
    assert.ok(OUTCOME_CHOICE[o].title.length > 0, `${o} title`);
    assert.match(OUTCOME_CHOICE[o].detail, /^Record that/, `${o} says what recording it does`);
  }
});

// ------------------------------------------------- a superseded casefile is history

test("reviewMode: superseded is HISTORY, not 'not ready'", () => {
  // It rendered a bare "kept as history" notice, so a completed investigation's
  // findings, calculations and agent activity became unreachable the moment a
  // later run replaced it — odd in a product whose claim is that every figure
  // is traceable.
  assert.equal(reviewMode("superseded"), "history");
  assert.equal(reviewMode("pending_review"), "active");
  assert.equal(reviewMode("approved"), "read_only");
  assert.equal(reviewMode("overridden"), "read_only");
  assert.equal(reviewMode("investigating"), "not_ready");
  assert.equal(reviewMode("failed"), "not_ready");
});

test("reviewMode: history is its own mode, so it can never offer the decision actions", () => {
  // The guarantee: a superseded casefile must be readable but not actionable.
  // Sharing `read_only` with approved/overridden would have given it their bar.
  const history = reviewMode("superseded");
  assert.notEqual(history, "active");
  assert.notEqual(history, "read_only");
});

// ------------------------------------------- what a notice actually demands

const notice = (action, check = "x") => ({ layer: "guardrail", check, action, detail: "" });

test("noticeWeight: a rule that CHANGED the recommendation outranks one that flagged it", () => {
  // Every notice rendered with the same weight, so a recommendation a code rule
  // had overridden read identically to an informational flag.
  assert.equal(noticeWeight(notice("abstain")), "changed_the_outcome");
  assert.equal(noticeWeight(notice("escalate")), "changed_the_outcome");
  assert.equal(noticeWeight(notice("claim_removed")), "needs_acknowledgement");
  assert.equal(noticeWeight(notice("retry")), "needs_acknowledgement");
  assert.equal(noticeWeight(notice("flag")), "informational");
});

test("noticeWeight: derived from the recorded action, not the check's name", () => {
  // A new check added to guardrails/ inherits the right grouping with no
  // change here; keying off names would silently drop it into "information".
  assert.equal(noticeWeight(notice("abstain", "some_future_check")), "changed_the_outcome");
});

test("groupNotices: heaviest first, empty groups omitted", () => {
  const groups = groupNotices([notice("flag"), notice("abstain"), notice("claim_removed")]);
  assert.deepEqual(groups.map((g) => g.weight), ["changed_the_outcome", "needs_acknowledgement", "informational"]);
  assert.equal(groups.every((g) => g.notices.length > 0), true);

  const onlyFlags = groupNotices([notice("flag"), notice("flag")]);
  assert.deepEqual(onlyFlags.map((g) => g.weight), ["informational"], "no empty headings");
  assert.deepEqual(groupNotices([]), []);
});

test("every grouping has a label that says what it demands", () => {
  for (const w of ["changed_the_outcome", "needs_acknowledgement", "informational"]) {
    assert.ok(NOTICE_WEIGHT_LABEL[w].length > 0, w);
  }
});

test("outstandingSummary: names what is open, and counts it", () => {
  const amendments = [
    { title: "Amendment No. 2", effectiveDate: "2026-04-01", effectiveForPeriod: true, boarded: false },
    { title: "Amendment No. 1", effectiveDate: "2024-08-01", effectiveForPeriod: true, boarded: true },
  ];
  assert.deepEqual(outstandingSummary(amendments, [{ check: "a" }, { check: "b" }]), {
    label: "Amendment No. 2 · 2 notices",
    count: 3,
  });
});

test("outstandingSummary: a boarded amendment is not outstanding, and nothing open says nothing", () => {
  // A line that always appears is a line nobody reads.
  const boarded = [{ title: "Amendment No. 1", effectiveDate: "2024-08-01", effectiveForPeriod: true, boarded: true }];
  assert.equal(outstandingSummary(boarded, []), null);
  assert.equal(outstandingSummary([], []), null);
  assert.deepEqual(outstandingSummary([], [{ check: "a" }]), { label: "1 notice", count: 1 });
});

test("statusHeadline covers every status the pill can be handed", () => {
  // It fell through to the raw column value, so the screen's one status object
  // read "superseded" — the database's word, in lower case, as a label.
  const CHECKS = {
    investigating: "Investigation running",
    pending_review: "Ready for analyst decision",
    approved: "Approved by an analyst",
    overridden: "Overridden by an analyst",
    awaiting_docs: "Awaiting documents",
    superseded: "Superseded by a later investigation",
    failed: "Investigation failed",
  };
  for (const [status, label] of Object.entries(CHECKS)) {
    assert.equal(statusHeadline(status), label, status);
    assert.doesNotMatch(statusHeadline(status), /_/, `${status} leaks an identifier`);
  }
});
