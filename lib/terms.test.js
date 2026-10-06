import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { FACILITIES } from "../data/facilities.js";
import {
  ANALYST_CORRECTED,
  TermsError,
  applyEdits,
  checkTermsProvenance,
  dayBefore,
  isIsoDate,
  loadSourceChunks,
  locateDefinition,
  nextVersion,
  quoteContainsDate,
  runApprove,
  runPropose,
  supersede,
  termsInForce,
  termsWarnings,
  thresholdProvenance,
  validateTerms,
} from "./terms.ts";
import { FACILITY_ID, chunkRows, clauses, facility, fakeDb, hitsFor, proposalFor, proposedRow } from "./terms.fixtures.js";

// No network and no database. The Supabase client is an in-memory fake that
// enforces the schema's constraints, and the chunks are the real generated
// documents run through the real chunker.

const F3 = facility("F3");
const F3_ID = FACILITY_ID.F3;
const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const P2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const NOW = "2026-10-06T09:00:00.000Z";

const clone = (v) => structuredClone(v);
const chunksOf = (key) => hitsFor(facility(key), ["agreement", "amendment"]);
const f3Proposal = () => proposalFor(F3, 1);

/** F3's terms with a (synthetic) Amendment No. 2 on file, so a second version exists. F3 has no real amendment. */
function f3WithAmendment() {
  const { terms, source_citations } = f3Proposal();
  terms.effective_amendments = [{ doc: "Amendment No. 2", effective: "2026-04-01", citation: "Amd 2 §1" }];
  source_citations.push({ field: "effective_amendments[0].effective", citation: "Amd 2 §1", quote: clauses.amendmentEffective("2026-04-01") });
  return { terms, source_citations };
}
const amendmentChunk = {
  content: `§1 Effective Date and Scope.\n${clauses.amendmentEffective("2026-04-01")} and amends the Credit Agreement.`,
  metadata: { facility_id: F3_ID, doc_type: "amendment", doc_title: "Amendment No. 2", section: "§1" },
};

/** A facility with an approved v1 and a proposed v2. */
function dbWithV1AndProposedV2() {
  const v1 = proposedRow({ id: P1, version: 1, status: "approved", extra: { approved_by: "seed: synthetic demo approver", approved_at: "2026-10-01T00:00:00.000Z" } });
  const v2 = f3WithAmendment();
  const db = fakeDb({
    covenant_terms: [v1, proposedRow({ id: P2, version: 2, effective_from: "2026-04-01", terms: v2.terms, source_citations: v2.source_citations })],
  });
  db.tables.doc_chunks.push(amendmentChunk);
  return db;
}

const approve = (db, body) => runApprove(body, { client: db, now: () => NOW });

// ================================================================ validateTerms

test("every fixture terms version, boarded or not, is valid in shape", () => {
  for (const f of FACILITIES) {
    for (const v of f.terms_versions) {
      const r = validateTerms(v.terms);
      assert.deepEqual(r, { valid: true, errors: [] }, `${f.id} v${v.version}: ${r.errors}`);
    }
  }
});

test("validateTerms: an absent addbacks or deductions is an error, an empty array is not", () => {
  const ok = f3Proposal().terms;
  assert.deepEqual(ok.numerator.addbacks, []);
  assert.equal(validateTerms(ok).valid, true);

  const noAddbacks = clone(ok);
  delete noAddbacks.numerator.addbacks;
  assert.match(validateTerms(noAddbacks).errors.join("|"), /numerator\.addbacks is required/);

  const noDeductions = clone(ok);
  delete noDeductions.numerator.deductions;
  assert.match(validateTerms(noDeductions).errors.join("|"), /numerator\.deductions is required/);

  const noAmendments = clone(ok);
  delete noAmendments.effective_amendments;
  assert.match(validateTerms(noAmendments).errors.join("|"), /effective_amendments is required/);
});

test("validateTerms never coerces: a string threshold, a zero threshold and a missing cap are all errors", () => {
  const t = clone(proposalFor(facility("F5"), 1).terms);
  const bad = (mutate, pattern) => {
    const c = clone(t);
    mutate(c);
    const r = validateTerms(c);
    assert.equal(r.valid, false);
    assert.match(r.errors.join("|"), pattern);
  };
  bad((c) => (c.threshold.min_dscr = "1.25"), /threshold\.min_dscr/);
  bad((c) => (c.threshold.min_dscr = 0), /threshold\.min_dscr/);
  bad((c) => (c.threshold.min_dscr = NaN), /threshold\.min_dscr/);
  bad((c) => delete c.numerator.addbacks[0].cap, /addbacks\[0\]\.cap is required/);
  bad((c) => (c.numerator.addbacks[0].cap = "500000"), /addbacks\[0\]\.cap must be a number/);
  bad((c) => (c.numerator.addbacks[0].cap = -1), /addbacks\[0\]\.cap must be a number/);
});

test("validateTerms: cap null is legitimate (uncapped) and is not treated as zero", () => {
  const c = clone(proposalFor(facility("F5"), 1).terms);
  c.numerator.addbacks[0].cap = null;
  assert.equal(validateTerms(c).valid, true);
});

test("validateTerms rejects component names the calculator would refuse, and empty or duplicate components", () => {
  const t = f3Proposal().terms;
  const bad = (mutate, pattern) => {
    const c = clone(t);
    mutate(c);
    assert.match(validateTerms(c).errors.join("|"), pattern);
  };
  bad((c) => (c.numerator.deductions = ["capex"]), /deductions\[0\] must be one of/);
  bad((c) => (c.denominator.components = []), /at least one component/);
  bad((c) => (c.denominator.components = ["scheduled_principal", "scheduled_principal"]), /duplicates/);
  bad((c) => (c.denominator.components = ["ebitda"]), /components\[0\] must be one of/);
});

test("validateTerms: period_end may be null or a real date, never absent or malformed; unknown keys are refused", () => {
  const t = f3Proposal().terms;
  const bad = (mutate, pattern) => {
    const c = clone(t);
    mutate(c);
    assert.match(validateTerms(c).errors.join("|"), pattern);
  };
  bad((c) => delete c.test_period.period_end, /period_end is required/);
  bad((c) => (c.test_period.period_end = "2026-02-30"), /period_end must be/);
  bad((c) => (c.threshold.min_dscr_alt = 1.1), /min_dscr_alt is not part of the terms schema/);
  bad((c) => (c.effective_amendments = [{ doc: "A", effective: "April 1, 2026", citation: "Amd 2 §1" }]), /effective is required and must be a YYYY-MM-DD date/);
  assert.deepEqual(validateTerms(null), { valid: false, errors: ["terms must be an object"] });
  assert.deepEqual(validateTerms([]), { valid: false, errors: ["terms must be an object"] });
});

// ================================================================ nextVersion, dates

test("nextVersion is max + 1, starting at 1", () => {
  assert.equal(nextVersion([]), 1);
  assert.equal(nextVersion([1]), 2);
  assert.equal(nextVersion([1, 2, 5]), 6);
  assert.equal(nextVersion([3, 1]), 4);
  assert.throws(() => nextVersion([0]), TermsError);
  assert.throws(() => nextVersion([1.5]), TermsError);
});

test("dayBefore is calendar arithmetic across month, leap-day and year boundaries", () => {
  assert.equal(dayBefore("2026-04-01"), "2026-03-31");
  assert.equal(dayBefore("2024-03-01"), "2024-02-29");
  assert.equal(dayBefore("2026-01-01"), "2025-12-31");
  assert.throws(() => dayBefore("April 1"), TermsError);
});

test("quoteContainsDate accepts the written forms of a date and rejects other dates", () => {
  assert.equal(quoteContainsDate("effective as of April 1, 2026", "2026-04-01"), true);
  assert.equal(quoteContainsDate("effective 1 April 2026", "2026-04-01"), true);
  assert.equal(quoteContainsDate("effective 2026-04-01", "2026-04-01"), true);
  assert.equal(quoteContainsDate("effective as of April 1, 2026", "2026-05-01"), false);
});

// ================================================================ provenance (S-1)

test("every fixture version, boarded or not, passes provenance against its own facility's real chunks", () => {
  // Pure check, nothing is written. It proves the citation-to-chunk mapping works on
  // sub-clause citations ("CA §7.11(b)(i)", "Amd 2 §3(a)") against the real corpus.
  for (const f of FACILITIES) {
    for (const v of f.terms_versions) {
      const { terms, source_citations } = proposalFor(f, v.version);
      const r = checkTermsProvenance(terms, source_citations, chunksOf(f.id));
      assert.deepEqual(r, { valid: true, violations: [] }, `${f.id} v${v.version}: ${JSON.stringify(r.violations)}`);
    }
  }
});

test("S-1: a real citation with a wrong threshold is refused, and the violation names field, value and reason", () => {
  const { terms, source_citations } = f3Proposal();
  terms.threshold.min_dscr = 0.85;
  const r = checkTermsProvenance(terms, source_citations, chunksOf("F3"));
  assert.equal(r.valid, false);
  assert.deepEqual(r.violations, [{ field: "threshold.min_dscr", value: 0.85, reason: "value 0.85 does not appear in its cited quote" }]);
});

test("S-1: 1.00 is IN the clause ('1.25 to 1.00') but it is not the minimum, so it is refused", () => {
  const { terms, source_citations } = f3Proposal();
  terms.threshold.min_dscr = 1.0;
  const r = checkTermsProvenance(terms, source_citations, chunksOf("F3"));
  assert.equal(r.valid, false);
  assert.equal(r.violations[0].field, "threshold.min_dscr");
  assert.match(r.violations[0].reason, /does not appear in its cited quote/);
});

test("S-1: a wrong add-back cap is refused, indexed by its dotted path", () => {
  const { terms, source_citations } = proposalFor(facility("F5"), 1);
  terms.numerator.addbacks[0].cap = 900000;
  const r = checkTermsProvenance(terms, source_citations, chunksOf("F5"));
  assert.equal(r.valid, false);
  assert.deepEqual(r.violations.map((v) => [v.field, v.value]), [["numerator.addbacks[0].cap", 900000]]);
});

test("S-1: a fabricated quote, an unknown clause, and an absent citation are each refused", () => {
  const fake = f3Proposal();
  fake.source_citations.find((c) => c.field === "threshold.min_dscr").quote = "The Borrower shall maintain a DSCR of not less than 1.25x.";
  assert.match(checkTermsProvenance(fake.terms, fake.source_citations, chunksOf("F3")).violations[0].reason, /quote not found in CA §7\.11/);

  const wrongClause = f3Proposal();
  wrongClause.source_citations.find((c) => c.field === "threshold.min_dscr").citation = "CA §9.99";
  assert.match(checkTermsProvenance(wrongClause.terms, wrongClause.source_citations, chunksOf("F3")).violations[0].reason, /no chunk supplied for CA §9\.99/);

  const none = f3Proposal();
  none.source_citations = none.source_citations.filter((c) => c.field !== "threshold.min_dscr");
  assert.deepEqual(checkTermsProvenance(none.terms, none.source_citations, chunksOf("F3")).violations, [
    { field: "threshold.min_dscr", value: 1.25, reason: "no citation for this term" },
  ]);
});

test("S-1: a non-numeric term the guardrail never walks still needs a citation whose quote is real", () => {
  const noDenominator = f3Proposal();
  noDenominator.source_citations = noDenominator.source_citations.filter((c) => c.field !== "denominator.components");
  const a = checkTermsProvenance(noDenominator.terms, noDenominator.source_citations, chunksOf("F3"));
  assert.deepEqual(a.violations.map((v) => v.field), ["denominator.components"]);

  const fabricated = f3Proposal();
  fabricated.source_citations.find((c) => c.field === "numerator.deductions").quote = "Deductions are capex and taxes.";
  const b = checkTermsProvenance(fabricated.terms, fabricated.source_citations, chunksOf("F3"));
  assert.deepEqual(b.violations.map((v) => v.field), ["numerator.deductions"]);
});

test("S-1: an amendment's effective date must be written in its own quote, because it becomes effective_from", () => {
  const { terms, source_citations } = f3WithAmendment();
  const chunks = [...chunksOf("F3"), { ...amendmentChunk.metadata, content: amendmentChunk.content, citation: "Amd 2 §1" }];
  assert.equal(checkTermsProvenance(terms, source_citations, chunks).valid, true);
  terms.effective_amendments[0].effective = "2026-05-01";
  const r = checkTermsProvenance(terms, source_citations, chunks);
  assert.deepEqual(r.violations.map((v) => v.field), ["effective_amendments[0].effective"]);
});

test("C1: a quote that merely contains '1.00' cannot support a threshold of 1.00 (fails closed), through approve too", async () => {
  // The reviewer's reproduction: min_dscr 1.0 with the quote "to 1.00" was approved.
  const { terms, source_citations } = f3Proposal();
  terms.threshold.min_dscr = 1.0;
  source_citations.find((c) => c.field === "threshold.min_dscr").quote = "to 1.00";
  const r = checkTermsProvenance(terms, source_citations, chunksOf("F3"));
  assert.equal(r.valid, false);
  assert.equal(r.violations[0].field, "threshold.min_dscr");

  const db = fakeDb({ covenant_terms: [proposedRow({ id: P1, version: 1 })] });
  const a = await approve(db, { terms_id: P1, approved_by: "x", edits: [{ field: "threshold.min_dscr", value: 1.0, citation: "CA §7.11", quote: "to 1.00" }] });
  assert.equal(a.status, 422);
  assert.equal(a.body.violations[0].field, "threshold.min_dscr");
  assert.deepEqual(db.writes, []);
});

test("C1: a quote with the right number but no ratio in it is refused, not waved through", () => {
  const { terms, source_citations } = f3Proposal();
  // A real sentence from the agreement that holds 1.25-looking text but states no ratio.
  const prose = "The Borrower shall deliver, promptly after each fiscal quarter, statements for the trailing four quarters.";
  source_citations.find((c) => c.field === "threshold.min_dscr").quote = prose;
  source_citations.find((c) => c.field === "threshold.min_dscr").citation = "CA §6.01";
  const r = checkTermsProvenance(terms, source_citations, chunksOf("F3"));
  assert.equal(r.valid, false);
  assert.equal(r.violations[0].field, "threshold.min_dscr");
});

// ---- I1: names and lists are tied to their quotes, not just numbers

const F5 = facility("F5");
const f5Proposal = (version = 1) => proposalFor(F5, version);
const fields = (r) => r.violations.map((v) => v.field);
const cite = (p, field) => p.source_citations.find((c) => c.field === field);

test("I1: a FABRICATED add-back citing a real sentence is refused (name not in the quote)", () => {
  // The reviewer's case: F3 has no add-backs; adding one that cites §7.11(b)'s real sentence used to be valid.
  const p = f3Proposal();
  p.terms.numerator.addbacks = [{ name: "owner compensation normalisation", amount_source: "financials", cap: null, citation: "CA §7.11" }];
  p.source_citations.push({
    field: "numerator.addbacks[0].cap",
    citation: "CA §7.11",
    quote: "No add-back or other adjustment shall be made to Consolidated EBITDA for purposes of this Section 7.11, except as expressly provided in this Agreement as amended in writing.",
  });
  const r = checkTermsProvenance(p.terms, p.source_citations, chunksOf("F3"));
  assert.equal(r.valid, false);
  assert.deepEqual(fields(r), ["numerator.addbacks[0].name"]);
});

test("I1: an add-back whose name is real and whose number is real still needs the NAME in the quote", () => {
  const p = f5Proposal(1);
  p.terms.numerator.addbacks[0].name = "executive bonuses";
  const r = checkTermsProvenance(p.terms, p.source_citations, chunksOf("F5"));
  assert.deepEqual(fields(r), ["numerator.addbacks[0].name"]);
  assert.match(r.violations[0].reason, /"executive bonuses" does not appear/);
});

test("I1: cap null needs a quote that SAYS uncapped; a capped clause cannot support it", () => {
  const capped = f5Proposal(1);
  capped.terms.numerator.addbacks[0].cap = null; // the clause says not to exceed $500,000
  const r = checkTermsProvenance(capped.terms, capped.source_citations, chunksOf("F5"));
  assert.deepEqual(fields(r), ["numerator.addbacks[0].cap"]);
  assert.match(r.violations[0].reason, /does not say the add-back is uncapped/);

  // (A genuinely uncapped clause supports null: see the "cap null" tests below.)
});

test("I1: a DROPPED denominator component is refused (the quote names cash_interest, the terms do not)", () => {
  const p = f3Proposal();
  p.terms.denominator.components = ["scheduled_principal"];
  const r = checkTermsProvenance(p.terms, p.source_citations, chunksOf("F3"));
  assert.deepEqual(fields(r), ["denominator.components"]);
  assert.match(r.violations[0].reason, /mentions cash_interest but the terms leave it out/);
});

test("I1: REMOVED deductions are refused, and so is a deduction the quote never mentions", () => {
  const removed = f3Proposal();
  removed.terms.numerator.deductions = [];
  const a = checkTermsProvenance(removed.terms, removed.source_citations, chunksOf("F3"));
  assert.deepEqual(fields(a), ["numerator.deductions"]);
  assert.match(a.violations[0].reason, /unfinanced_capex but the terms leave it out; .*cash_taxes but the terms leave it out/);

  const partial = f3Proposal();
  partial.terms.numerator.deductions = ["cash_taxes"];
  assert.match(checkTermsProvenance(partial.terms, partial.source_citations, chunksOf("F3")).violations[0].reason, /unfinanced_capex but the terms leave it out/);

  // A deduction list cited to a clause that is not the definition is refused BY THE CITATION
  // (here, the governing-law section): the server judges completeness against the definition it
  // located itself, so the citation's only remaining job is to point at that definition.
  const invented = f3Proposal();
  Object.assign(cite(invented, "numerator.deductions"), { citation: "CA §9.02", quote: "This Agreement is governed by the laws of the State of New York." });
  const reasons = checkTermsProvenance(invented.terms, invented.source_citations, chunksOf("F3")).violations.map((v) => `${v.field}: ${v.reason}`).join(" | ");
  assert.match(reasons, /numerator\.deductions: this term must cite the clause that defines "Debt Service Coverage Ratio" \(CA §1\.01\), not CA §9\.02/);
});

// Completeness is judged against the DEFINING CLAUSE THE SERVER LOCATED, never
// against anything the proposer chose: not the quote, not a guessed sentence,
// not the cited chunk. Each of those let the proposer pick its own ground truth.
const F3_1_01 = () => chunksOf("F3").find((c) => c.section === "§1.01");
/** F3 chunks with §1.01's text replaced, so a quote can stop at awkward places. */
const withChunk = (section, content) => chunksOf("F3").map((c) => (c.doc_title === "Credit Agreement" && c.section === section ? { ...c, content } : c));
const DS = '"Debt Service" means, for any period, the sum of (i) scheduled principal payments on Indebtedness';
const RATIO = '"Debt Service Coverage Ratio" means, for any period, the ratio of (i) Consolidated EBITDA for that period, plus any add-back permitted by Section 7.11, minus Unfinanced Capital Expenditures';

test("I1 (selective quoting): a quote cut short of the definition cannot hide a dropped component or deduction", () => {
  const dropped = f3Proposal();
  dropped.terms.denominator.components = ["scheduled_principal"]; // cash_interest dropped
  cite(dropped, "denominator.components").quote = DS;
  const a = checkTermsProvenance(dropped.terms, dropped.source_citations, chunksOf("F3"));
  assert.deepEqual(fields(a), ["denominator.components"]);
  assert.match(a.violations[0].reason, /mentions cash_interest but the terms leave it out/);

  const cut = f3Proposal();
  cut.terms.numerator.deductions = ["unfinanced_capex"]; // cash_taxes dropped
  cite(cut, "numerator.deductions").quote = RATIO;
  const b = checkTermsProvenance(cut.terms, cut.source_citations, chunksOf("F3"));
  assert.deepEqual(fields(b), ["numerator.deductions"]);
  assert.match(b.violations[0].reason, /cash_taxes but the terms leave it out/);

  // A cut-short quote that leaves the terms COMPLETE is fine: nothing is hidden.
  const complete = f3Proposal();
  cite(complete, "denominator.components").quote = DS;
  assert.equal(checkTermsProvenance(complete.terms, complete.source_citations, chunksOf("F3")).valid, true);
});

test("I1 (first occurrence): a quote that merely starts with 'Consolidated EBITDA' cannot remove every deduction", () => {
  // "Consolidated EBITDA" first appears in the EBITDA definition, which names no deduction. Judging the
  // enclosing text of that FIRST occurrence passed; the chunk is what is judged.
  const none = f3Proposal();
  none.terms.numerator.deductions = [];
  cite(none, "numerator.deductions").quote = "Consolidated EBITDA";
  const r = checkTermsProvenance(none.terms, none.source_citations, chunksOf("F3"));
  assert.deepEqual(fields(r), ["numerator.deductions"]);
  assert.match(r.violations[0].reason, /unfinanced_capex but the terms leave it out; .*cash_taxes but the terms leave it out/);
});

test("I1 (semicolon and abbreviation): a quote stopping at ';' or 'Inc.' cannot hide what follows it", () => {
  const f = (content) => withChunk("§1.01", content);
  // ';' between the quote and the dropped deduction
  const semi = f3Proposal();
  semi.terms.numerator.deductions = ["unfinanced_capex"];
  const semiChunk = f('"Debt Service Coverage Ratio" means Consolidated EBITDA minus Unfinanced Capital Expenditures; and cash taxes paid. "Debt Service" means scheduled principal payments and cash interest paid.');
  cite(semi, "numerator.deductions").quote = '"Debt Service Coverage Ratio" means Consolidated EBITDA minus Unfinanced Capital Expenditures';
  cite(semi, "denominator.components").quote = '"Debt Service" means scheduled principal payments and cash interest paid.';
  const a = checkTermsProvenance(semi.terms, semi.source_citations, semiChunk);
  assert.deepEqual(fields(a), ["numerator.deductions"]);
  assert.match(a.violations[0].reason, /cash_taxes but the terms leave it out/);

  // an abbreviation ("Inc.") between the quote and the dropped component
  const abbr = f3Proposal();
  abbr.terms.denominator.components = ["scheduled_principal"];
  const abbrChunk = f('"Debt Service Coverage Ratio" means Consolidated EBITDA minus Unfinanced Capital Expenditures and cash taxes paid. "Debt Service" means scheduled principal payments owed by Northgate Foods, Inc. and cash interest paid.');
  cite(abbr, "denominator.components").quote = '"Debt Service" means scheduled principal payments owed by Northgate Foods, Inc.';
  cite(abbr, "numerator.deductions").quote = '"Debt Service Coverage Ratio" means Consolidated EBITDA minus Unfinanced Capital Expenditures and cash taxes paid.';
  const b = checkTermsProvenance(abbr.terms, abbr.source_citations, abbrChunk);
  assert.deepEqual(fields(b), ["denominator.components"]);
  assert.match(b.violations[0].reason, /cash_interest but the terms leave it out/);
});

test("I1 (cap null): a quote that says 'without limit' cannot hide that ANOTHER item of the chunk caps the same add-back", () => {
  // The quote is verbatim and says uncapped. A line further down the same chunk states the limit.
  // Judged against the quote alone, this passes; judged against the chunk, it does not.
  const name = "dry-dock and vessel overhaul charges";
  const uncapped = `the Borrower may add back ${name}, to the extent deducted in determining net income, without limit`;
  const capped = `the Borrower may add back ${name}, to the extent deducted in determining net income, in an aggregate amount not to exceed $500,000 for any test period`;
  const chunk = (...lines) => chunksOf("F5").map((c) => (c.doc_title === "Credit Agreement" && c.section === "§7.11" ? { ...c, content: `§7.11 Debt Service Coverage Ratio.\n${lines.join("\n")}` } : c));
  const p = f5Proposal(1);
  p.terms.numerator.addbacks[0].cap = null;
  cite(p, "numerator.addbacks[0].cap").quote = uncapped;
  cite(p, "numerator.addbacks[0].cap").citation = "CA §7.11";
  // threshold and basis cite §7.11 too, so keep their text in the chunk
  const keep = clauses.threshold(1.25);

  assert.equal(checkTermsProvenance(p.terms, p.source_citations, chunk(keep, uncapped)).valid, true, "uncapped everywhere: fine");
  const r = checkTermsProvenance(p.terms, p.source_citations, chunk(keep, uncapped, capped));
  assert.deepEqual(fields(r), ["numerator.addbacks[0].cap"]);
  assert.match(r.violations[0].reason, /the cited chunk states a limit for this add-back/);
});

test("I1 (cap null): a quote cut away from its limit cannot support cap: null", () => {
  const p = f5Proposal(1);
  p.terms.numerator.addbacks[0].cap = null;
  cite(p, "numerator.addbacks[0].cap").quote = "the Borrower may add back dry-dock and vessel overhaul charges, to the extent deducted in determining net income";
  assert.deepEqual(fields(checkTermsProvenance(p.terms, p.source_citations, chunksOf("F5"))), ["numerator.addbacks[0].cap"]);
});

test("I1 (pairing): a cap must sit in the same list item as its add-back; a swap in a two-add-back clause is refused", () => {
  const A = "restructuring charges";
  const B = "severance costs";
  const clause = `the Borrower may add back ${A}, in an aggregate amount not to exceed $500,000 for any test period; and may add back ${B}, in an aggregate amount not to exceed $800,000 for any test period`;
  const chunks = chunksOf("F5").map((c) => (c.doc_title === "Credit Agreement" && c.section === "§7.11" ? { ...c, content: `${c.content}\n${clause}.` } : c));
  const mk = (capA, capB) => {
    const p = f5Proposal(1);
    p.terms.numerator.addbacks = [
      { name: A, amount_source: "financials", cap: capA, citation: "CA §7.11" },
      { name: B, amount_source: "financials", cap: capB, citation: "CA §7.11" },
    ];
    p.source_citations = [
      ...p.source_citations.filter((c) => !c.field.startsWith("numerator.addbacks")),
      { field: "numerator.addbacks[0].cap", citation: "CA §7.11", quote: clause },
      { field: "numerator.addbacks[1].cap", citation: "CA §7.11", quote: clause },
    ];
    return p;
  };
  const right = mk(500000, 800000);
  assert.equal(checkTermsProvenance(right.terms, right.source_citations, chunks).valid, true);
  const swapped = mk(800000, 500000);
  const r = checkTermsProvenance(swapped.terms, swapped.source_citations, chunks);
  assert.deepEqual(fields(r), ["numerator.addbacks[0].cap", "numerator.addbacks[1].cap"]);
  assert.match(r.violations[0].reason, /cap 800000 sits with another add-back, not with "restructuring charges"/);

  // ", and" delimits too, with no semicolon
  const comma = clause.replace("; and may add back", ", and may add back");
  const chunks2 = chunks.map((c) => (c.section === "§7.11" ? { ...c, content: c.content.replace(clause, comma) } : c));
  const s2 = mk(800000, 500000);
  s2.source_citations.forEach((c) => c.field.startsWith("numerator.addbacks") && (c.quote = comma));
  assert.equal(checkTermsProvenance(s2.terms, s2.source_citations, chunks2).valid, false);
});

// ================================ the server picks the ground truth (round 4)

test("locateDefinition finds the defining clause itself, bounded to that clause, not the whole §1.01 dump", () => {
  const dscr = locateDefinition("Debt Service Coverage Ratio", chunksOf("F3"));
  assert.deepEqual(dscr.map((d) => d.citation), ["CA §1.01"]);
  assert.equal(dscr[0].text, clauses.coverageRatio);
  // The quoted form is self-delimiting: looking for "Debt Service" cannot land
  // inside "Debt Service Coverage Ratio".
  const ds = locateDefinition("Debt Service", chunksOf("F3"));
  assert.deepEqual(ds.map((d) => d.text), [clauses.debtService]);
  // Nothing of §1.01's other definitions is in scope.
  for (const t of [...dscr, ...ds].map((d) => d.text)) {
    assert.ok(!/"Indebtedness" means/.test(t), t);
    assert.ok(!/"Consolidated EBITDA" means/.test(t), t);
  }
  // A section with no definition in it yields nothing, rather than guessing.
  assert.deepEqual(locateDefinition("Debt Service Coverage Ratio", chunksOf("F3").filter((c) => c.section !== "§1.01")), []);
});

test("locateDefinition bounds a definition at the next definition even when they share one line", () => {
  // A PDF that folds a definitions dump onto one line has no line break to stop at.
  const one = [{ citation: "CA §1.01", doc_type: "agreement", doc_title: "Credit Agreement", section: "§1.01", content: `${clauses.coverageRatio} ${clauses.debtService} "Indebtedness" means all obligations for borrowed money.` }];
  assert.equal(locateDefinition("Debt Service Coverage Ratio", one)[0].text, clauses.coverageRatio);
  assert.equal(locateDefinition("Debt Service", one)[0].text, clauses.debtService);
});

test("HOLE: deductions cannot be emptied by citing a chunk that names no deduction (§7.11 on real F3 data)", () => {
  // Round 3 judged completeness against the CITED CHUNK, so the proposer only had
  // to pick a chunk mentioning the base and no deduction. CA §7.11 is exactly that
  // chunk, and it is the one the same proposal already cites for the threshold.
  const p = f3Proposal();
  p.terms.numerator.deductions = [];
  Object.assign(cite(p, "numerator.deductions"), {
    citation: "CA §7.11",
    quote: "No add-back or other adjustment shall be made to Consolidated EBITDA for purposes of this Section 7.11",
  });
  const r = checkTermsProvenance(p.terms, p.source_citations, chunksOf("F3"));
  assert.deepEqual(fields(r), ["numerator.deductions"]);
  assert.match(r.violations[0].reason, /must cite the clause that defines "Debt Service Coverage Ratio" \(CA §1\.01\), not CA §7\.11/);
});

test("the proposer cannot change a completeness verdict by choosing a citation: every choice in the corpus, refused", () => {
  // The invariant, exhaustively. For each real version of each facility, try an
  // incomplete list against EVERY (chunk, line-of-that-chunk) the proposer could
  // cite. None may be accepted. This is the test that fails if ground truth ever
  // goes back to being proposer-chosen.
  const subsets = {
    "numerator.deductions": [[], ["unfinanced_capex"], ["cash_taxes"]],
    "denominator.components": [["scheduled_principal"], ["cash_interest"]],
  };
  const accepted = [];
  let tried = 0;
  for (const key of ["F1", "F3", "F5"]) {
    const f = facility(key);
    const chunks = chunksOf(key);
    for (const v of f.terms_versions) {
      for (const [field, lists] of Object.entries(subsets)) {
        for (const list of lists) {
          for (const ch of chunks) {
            for (const line of ch.content.split("\n").map((l) => l.trim()).filter((l) => l.length > 10)) {
              const p = proposalFor(f, v.version);
              if (field === "numerator.deductions") p.terms.numerator.deductions = list;
              else p.terms.denominator.components = list;
              Object.assign(cite(p, field), { citation: ch.citation, quote: line });
              tried += 1;
              const r = checkTermsProvenance(p.terms, p.source_citations, chunks);
              if (!r.violations.some((x) => x.field === field)) accepted.push(`${key} v${v.version} ${field}=${JSON.stringify(list)} via ${ch.citation}: ${line.slice(0, 50)}`);
            }
          }
        }
      }
    }
  }
  assert.ok(tried > 1000, `the sweep must actually sweep: ${tried}`);
  assert.deepEqual(accepted, []);
});

// --- the mirror: the gate must not refuse CORRECT terms -----------------------

/** A §1.01 whose DSCR definition deducts capex only, next to an unrelated definition that says "taxes paid". */
const DSCR_CAPEX_ONLY = '"Debt Service Coverage Ratio" means, for any period, the ratio of (i) Consolidated EBITDA for that period, plus any add-back permitted by Section 7.11, minus Unfinanced Capital Expenditures during that period, to (ii) Debt Service for that period.';
const NET_INCOME = '"Net Income" means net income after taxes paid in cash.';
const capexOnly101 = () => withChunk("§1.01", ["§1.01 Defined Terms.", NET_INCOME, clauses.debtService, DSCR_CAPEX_ONLY, '"Indebtedness" means all obligations of the Borrower for borrowed money.'].join("\n"));

test("FALSE REFUSAL: an unrelated §1.01 definition that says 'taxes paid' does not force a deduction into correct terms", () => {
  // A real §1.01 is the definitions dump, so this WILL happen on real agreements.
  // Judged against the whole section it refused correct terms, and an analyst who
  // cannot board a covenant at all is pushed to edit terms until the checker is
  // happy — which corrupts the artefact four-eyes exists to protect.
  const p = f3Proposal();
  p.terms.numerator.deductions = ["unfinanced_capex"];
  cite(p, "numerator.deductions").quote = DSCR_CAPEX_ONLY;
  const r = checkTermsProvenance(p.terms, p.source_citations, capexOnly101());
  assert.deepEqual(r, { valid: true, violations: [] });

  // The mirror, on the SAME documents: dropping the deduction the definition does
  // state is still refused. Narrowing the scope did not disarm the check.
  const dropped = f3Proposal();
  dropped.terms.numerator.deductions = [];
  cite(dropped, "numerator.deductions").quote = DSCR_CAPEX_ONLY;
  const bad = checkTermsProvenance(dropped.terms, dropped.source_citations, capexOnly101());
  assert.deepEqual(fields(bad), ["numerator.deductions"]);
  assert.match(bad.violations[0].reason, /mentions unfinanced_capex but the terms leave it out/);

  // And adding one the definition does NOT state is refused too.
  const added = f3Proposal();
  cite(added, "numerator.deductions").quote = DSCR_CAPEX_ONLY;
  assert.match(checkTermsProvenance(added.terms, added.source_citations, capexOnly101()).violations[0].reason, /terms include cash_taxes but .* does not mention it/);
});

const f5WithClause = (clause) => chunksOf("F5").map((c) => (c.doc_title === "Credit Agreement" && c.section === "§7.11" ? { ...c, content: `${c.content}\n${clause}.` } : c));

test("FALSE REFUSAL: a shared cap, a ', and' inside a name, and a quote with the source's line wraps are all allowed", () => {
  const one = (name, cap, quote, chunks) => {
    const p = f5Proposal(1);
    p.terms.numerator.addbacks = [{ name, amount_source: "financials", cap, citation: "CA §7.11" }];
    p.source_citations = [...p.source_citations.filter((c) => !c.field.startsWith("numerator.addbacks")), { field: "numerator.addbacks[0].cap", citation: "CA §7.11", quote }];
    return checkTermsProvenance(p.terms, p.source_citations, chunks);
  };
  // A list of add-backs sharing one cap: the figure sits in no item that names one of them.
  const shared = "the Borrower may add back dry-dock charges, vessel overhaul charges, and hull repair charges, in an aggregate amount not to exceed $500,000 for any test period";
  assert.deepEqual(one("dry-dock charges", 500000, shared, f5WithClause(shared)), { valid: true, violations: [] });
  // A name that itself contains ", and", which the item splitter cuts through.
  const commaAnd = "the Borrower may add back dry-dock, and vessel overhaul charges, in an aggregate amount not to exceed $500,000 for any test period";
  assert.deepEqual(one("dry-dock, and vessel overhaul charges", 500000, commaAnd, f5WithClause(commaAnd)), { valid: true, violations: [] });
  // A quote copied with the source's hard line wrap in the middle of the clause.
  const wrapped = "the Borrower may add back dry-dock and vessel overhaul charges, to the extent deducted in\ndetermining net income, in an aggregate amount not to exceed $500,000 for any test period";
  const wr = f5Proposal(1);
  cite(wr, "numerator.addbacks[0].cap").quote = wrapped;
  assert.deepEqual(checkTermsProvenance(wr.terms, wr.source_citations, f5WithClause(wrapped)), { valid: true, violations: [] });
});

test("the pairing rule still refuses a cap that sits with ANOTHER add-back the terms name", () => {
  // The relaxation above allows a figure in an item naming no other add-back. It
  // must not allow a swap, which is the thing pairing exists to catch.
  const A = "restructuring charges";
  const B = "severance costs";
  const clause = `the Borrower may add back ${A}, in an aggregate amount not to exceed $500,000 for any test period; and may add back ${B}, in an aggregate amount not to exceed $800,000 for any test period`;
  const chunks = f5WithClause(clause);
  const p = f5Proposal(1);
  p.terms.numerator.addbacks = [
    { name: A, amount_source: "financials", cap: 800000, citation: "CA §7.11" },
    { name: B, amount_source: "financials", cap: 500000, citation: "CA §7.11" },
  ];
  p.source_citations = [
    ...p.source_citations.filter((c) => !c.field.startsWith("numerator.addbacks")),
    { field: "numerator.addbacks[0].cap", citation: "CA §7.11", quote: clause },
    { field: "numerator.addbacks[1].cap", citation: "CA §7.11", quote: clause },
  ];
  assert.deepEqual(fields(checkTermsProvenance(p.terms, p.source_citations, chunks)), ["numerator.addbacks[0].cap", "numerator.addbacks[1].cap"]);
});

test("no definition on file: the check does NOT run, does NOT fall back to the cited chunk, and SAYS so", () => {
  // Falling back to the proposer's citation is exactly the bug. Refusing instead
  // would make every agreement drafted without a '"Term" means' clause unboardable.
  // So: no refusal, and a warning that names the check that did not run.
  const prose = '§1.01 Defined Terms.\nThe coverage ratio is Consolidated EBITDA less Unfinanced Capital Expenditures and cash taxes paid, over scheduled principal payments and cash interest paid.';
  const chunks = withChunk("§1.01", prose);
  const quote = prose.split("\n")[1];
  const p = f3Proposal();
  cite(p, "numerator.deductions").quote = quote;
  cite(p, "denominator.components").quote = quote;
  assert.deepEqual(checkTermsProvenance(p.terms, p.source_citations, chunks), { valid: true, violations: [] });

  // An emptied list is NOT refused here, and that is why the warning is loud.
  const emptied = f3Proposal();
  emptied.terms.numerator.deductions = [];
  cite(emptied, "numerator.deductions").quote = quote;
  cite(emptied, "denominator.components").quote = quote;
  assert.equal(checkTermsProvenance(emptied.terms, emptied.source_citations, chunks).valid, true);

  const w = termsWarnings(p.terms, p.source_citations, chunks).filter((x) => x.code === "definition_not_located");
  assert.deepEqual(w.map((x) => x.field), ["numerator.deductions", "denominator.components"]);
  assert.match(w[0].message, /was NOT verified against the document/);
  // With the real §1.01 on file there is nothing to warn about.
  assert.deepEqual(termsWarnings(p.terms, p.source_citations, chunksOf("F3")).filter((x) => x.code === "definition_not_located"), []);
});

/** A restatement of the DSCR definition in an amendment, deducting only what `deducts` names. */
const restatement = (n, effective, deducts) => ({
  citation: `Amd ${n} §2`,
  doc_type: "amendment",
  doc_title: `Amendment No. ${n}`,
  section: "§2",
  effective_date: effective,
  content: `§2 Amended Definition.\n"Debt Service Coverage Ratio" means, for any period, the ratio of (i) Consolidated EBITDA for that period minus ${deducts}, to (ii) Debt Service for that period.`,
});
const quoteOfRestatement = (c) => c.content.split("\n")[1];

test("an amendment that restates a definition supersedes the agreement's wording", () => {
  const amd3 = restatement(3, "2026-04-01", "Unfinanced Capital Expenditures during that period");
  const chunks = [...chunksOf("F3"), amd3];
  assert.deepEqual(locateDefinition("Debt Service Coverage Ratio", chunks).map((d) => d.citation), ["Amd 3 §2"]);
  // So the amended list (capex only) is correct, and the agreement's list is now wrong.
  const amended = f3Proposal();
  amended.terms.numerator.deductions = ["unfinanced_capex"];
  Object.assign(cite(amended, "numerator.deductions"), { citation: "Amd 3 §2", quote: quoteOfRestatement(amd3) });
  assert.equal(checkTermsProvenance(amended.terms, amended.source_citations, chunks).valid, true);
  const stale = f3Proposal();
  assert.ok(fields(checkTermsProvenance(stale.terms, stale.source_citations, chunks)).includes("numerator.deductions"));
});

test("F3: of two amendments restating one definition, the NEWEST governs — not 'any amendment'", () => {
  // Precedence used to be by document TYPE, so both restatements were taken as
  // truth at once: the stale one's words forced a deduction in, and the newest
  // one's list was refused. Wrong in both directions, from documents alone.
  const older = restatement(3, "2026-01-01", "Unfinanced Capital Expenditures and cash taxes paid during that period");
  const newer = restatement(4, "2026-04-01", "Unfinanced Capital Expenditures during that period");
  const chunks = [...chunksOf("F3"), older, newer];
  assert.deepEqual(locateDefinition("Debt Service Coverage Ratio", chunks).map((d) => d.citation), ["Amd 4 §2"]);

  // The newest amendment's list is ACCEPTED (it was refused before).
  const current = f3Proposal();
  current.terms.numerator.deductions = ["unfinanced_capex"];
  Object.assign(cite(current, "numerator.deductions"), { citation: "Amd 4 §2", quote: quoteOfRestatement(newer) });
  assert.deepEqual(checkTermsProvenance(current.terms, current.source_citations, chunks), { valid: true, violations: [] });

  // The superseded amendment's list is REFUSED (it was accepted before), both on
  // the citation and, if it cited the right clause, on completeness.
  const stale = f3Proposal();
  Object.assign(cite(stale, "numerator.deductions"), { citation: "Amd 3 §2", quote: quoteOfRestatement(older) });
  assert.match(checkTermsProvenance(stale.terms, stale.source_citations, chunks).violations.find((v) => v.field === "numerator.deductions").reason, /must cite the clause that defines "Debt Service Coverage Ratio" \(Amd 4 §2\), not Amd 3 §2/);
  const staleList = f3Proposal();
  Object.assign(cite(staleList, "numerator.deductions"), { citation: "Amd 4 §2", quote: quoteOfRestatement(newer) });
  assert.match(checkTermsProvenance(staleList.terms, staleList.source_citations, chunks).violations.find((v) => v.field === "numerator.deductions").reason, /terms include cash_taxes but .* does not mention it/);
});

test("an undated document never outranks a dated one, and a genuine tie is judged against both and reported", () => {
  // An undated amendment cannot be shown to be later than the agreement, so it
  // does not get to replace it silently.
  const undated = { ...restatement(3, null, "Unfinanced Capital Expenditures during that period"), effective_date: null };
  const withUndated = [...chunksOf("F3"), undated];
  assert.deepEqual(locateDefinition("Debt Service Coverage Ratio", withUndated).map((d) => d.citation), ["CA §1.01"]);

  // Two documents dated the same day: both are the ground truth, which fails
  // closed (every word either names must be accounted for), and it is reported.
  const a = restatement(3, "2026-04-01", "Unfinanced Capital Expenditures during that period");
  const b = restatement(4, "2026-04-01", "cash taxes paid during that period");
  const tied = [...chunksOf("F3"), a, b];
  assert.deepEqual(locateDefinition("Debt Service Coverage Ratio", tied).map((d) => d.citation), ["Amd 3 §2", "Amd 4 §2"]);
  const p = f3Proposal();
  Object.assign(cite(p, "numerator.deductions"), { citation: "Amd 3 §2", quote: quoteOfRestatement(a) });
  assert.deepEqual(checkTermsProvenance(p.terms, p.source_citations, tied), { valid: true, violations: [] });
  const half = f3Proposal();
  half.terms.numerator.deductions = ["unfinanced_capex"];
  Object.assign(cite(half, "numerator.deductions"), { citation: "Amd 3 §2", quote: quoteOfRestatement(a) });
  assert.ok(fields(checkTermsProvenance(half.terms, half.source_citations, tied)).includes("numerator.deductions"));
  const w = termsWarnings(p.terms, p.source_citations, tied);
  assert.match(w.find((x) => x.code === "definition_conflict").message, /Amendment No\. 3.*Amendment No\. 4|Amendment No\. 4.*Amendment No\. 3/);
  assert.deepEqual(termsWarnings(p.terms, p.source_citations, chunksOf("F3")).filter((x) => x.code === "definition_conflict"), []);
});

// ---------------- F2: the clause's extent is the document's block ------------

const TWO_1 = '"Debt Service Coverage Ratio" means, for any period, the ratio of (i) Consolidated EBITDA for that period minus Unfinanced Capital Expenditures, to (ii) Debt Service for that period.';
const TWO_2 = "For the avoidance of doubt, cash taxes paid during that period shall also be deducted in clause (i).";

test("F2: a definition written as TWO SENTENCES keeps its second sentence, in both directions", () => {
  // Stopping at the first line-ending full stop was wrong both ways at once: the
  // CORRECT list was refused and the list with cash_taxes dropped was ACCEPTED.
  const chunks = withChunk("§1.01", ["§1.01 Defined Terms.", clauses.debtService, TWO_1, TWO_2, '"Indebtedness" means all obligations for borrowed money.'].join("\n"));
  assert.deepEqual(locateDefinition("Debt Service Coverage Ratio", chunks).map((d) => d.text), [`${TWO_1}\n${TWO_2}`]);

  const verdict = (list) => {
    const p = f3Proposal();
    p.terms.numerator.deductions = list;
    cite(p, "numerator.deductions").quote = TWO_1;
    return checkTermsProvenance(p.terms, p.source_citations, chunks);
  };
  // MUST KEEP ALLOWING: the complete list, quoting only the first sentence.
  assert.deepEqual(verdict(["unfinanced_capex", "cash_taxes"]), { valid: true, violations: [] });
  // MUST REFUSE: the deduction the second sentence adds, dropped.
  assert.match(verdict(["unfinanced_capex"]).violations[0].reason, /mentions cash_taxes but the terms leave it out/);
  assert.match(verdict([]).violations[0].reason, /unfinanced_capex but the terms leave it out; .*cash_taxes but the terms leave it out/);

  // And the human is told the second sentence is what decided it.
  const w = termsWarnings(f3Proposal().terms, f3Proposal().source_citations, chunks);
  const amb = w.find((x) => x.code === "definition_extent_ambiguous");
  assert.ok(amb, JSON.stringify(w));
  assert.match(amb.message, /cash_taxes appears in "Debt Service Coverage Ratio" \(CA §1\.01\) only after its first sentence/);
});

test("F2: a hard wrap after an abbreviation no longer cuts the clause (the 'Inc.' bypass, server-side)", () => {
  const ds = '"Debt Service" means, for any period, the sum of (i) scheduled principal payments on Indebtedness owed by Northgate Foods, Inc.\nand (ii) cash interest paid on Indebtedness, in each case during that period.';
  const chunks = withChunk("§1.01", ["§1.01 Defined Terms.", ds, clauses.coverageRatio, '"Indebtedness" means all obligations for borrowed money.'].join("\n"));
  assert.deepEqual(locateDefinition("Debt Service", chunks).map((d) => d.text), [ds]);
  const verdict = (list) => {
    const p = f3Proposal();
    p.terms.denominator.components = list;
    cite(p, "denominator.components").quote = ds.split("\n")[0];
    return checkTermsProvenance(p.terms, p.source_citations, chunks);
  };
  assert.deepEqual(verdict(["scheduled_principal", "cash_interest"]), { valid: true, violations: [] });
  assert.match(verdict(["scheduled_principal"]).violations[0].reason, /mentions cash_interest but the terms leave it out/);
});

test("F2: a blank line, a heading and an enumerator all end the block; the full stop inside a sentence does not", () => {
  const PROSE = "All computations under this Agreement shall exclude taxes paid in respect of prior periods.";
  const after = (...lines) => withChunk("§1.01", ["§1.01 Defined Terms.", clauses.debtService, TWO_1, ...lines].join("\n"));
  const capexOnly = () => {
    const p = f3Proposal();
    p.terms.numerator.deductions = ["unfinanced_capex"];
    cite(p, "numerator.deductions").quote = TWO_1;
    return p;
  };
  const ok = (chunks) => checkTermsProvenance(capexOnly().terms, capexOnly().source_citations, chunks).valid;
  // Separated the way an agreement separates it — a blank line, a heading, an
  // enumerator — the prose is outside the definition and correct terms pass.
  assert.equal(ok(after("", PROSE)), true, "blank line");
  assert.equal(ok(after("§1.02 Accounting Terms.", PROSE)), true, "heading");
  assert.equal(ok(after(`(b) ${PROSE}`)), true, "enumerator");
  // RESIDUE, stated rather than hidden: prose in the SAME paragraph is taken as
  // part of the definition, so correct terms are refused — and the warning names
  // the exact sentence that did it, which is the repair instruction for a human.
  const same = after(PROSE);
  assert.equal(ok(same), false);
  const w = termsWarnings(capexOnly().terms, capexOnly().source_citations, same);
  assert.match(w.find((x) => x.code === "definition_extent_ambiguous").message, /only after its first sentence: "All computations under this Agreement/);
});

test("F2: all four shapes — a marker opening a line only ends the block after a FINISHED sentence", () => {
  // Round 4 cut at the first line-ending full stop (shapes 1 and 2 broke).
  // Round 5 cut at any heading or enumerator opening a line (shapes 3 and 4
  // broke). Each cut was silent and wrong in both directions at once: the
  // emptied list ACCEPTED, the correct list REFUSED. It takes both a finished
  // sentence and a structural marker.
  const TAIL = "minus Unfinanced Capital Expenditures and cash taxes paid during that period, to (ii) Debt Service for that period.";
  const shapes = {
    // 1. written as two sentences: the second sentence adds a deduction
    "two sentences": [
      '"Debt Service Coverage Ratio" means, for any period, the ratio of (i) Consolidated EBITDA for that period minus Unfinanced Capital Expenditures, to (ii) Debt Service for that period.',
      "For the avoidance of doubt, cash taxes paid during that period shall also be deducted in clause (i).",
    ],
    // 2. a hard wrap just after an abbreviation that ends in a full stop
    "wrap after 'Inc.'": [
      '"Debt Service Coverage Ratio" means, for any period, the ratio of (i) Consolidated EBITDA of Northgate Foods, Inc.',
      TAIL,
    ],
    // 3. a definition carrying its own sub-list
    "sub-list": [
      '"Debt Service Coverage Ratio" means, for any period, the ratio of:',
      `(i) Consolidated EBITDA for that period, ${TAIL}`,
    ],
    // 4. a hard wrap landing a line on an enumerator or a section reference
    "wrap onto '(i)'": ['"Debt Service Coverage Ratio" means, for any period, the ratio of', `(i) Consolidated EBITDA for that period, ${TAIL}`],
    "wrap onto 'Section 7.11'": ['"Debt Service Coverage Ratio" means, for any period, the ratio of (i) Consolidated EBITDA for that period, plus any add-back permitted by', `Section 7.11, ${TAIL}`],
    "wrap onto '7.11(b)'": ['"Debt Service Coverage Ratio" means, for any period, the ratio of (i) Consolidated EBITDA for that period, plus any add-back permitted by Section', `7.11(b), ${TAIL}`],
  };

  for (const [label, [opener, rest]] of Object.entries(shapes)) {
    const chunks = withChunk("§1.01", ["§1.01 Defined Terms.", clauses.debtService, opener, rest, '"Indebtedness" means all obligations for borrowed money.'].join("\n"));
    assert.equal(locateDefinition("Debt Service Coverage Ratio", chunks)[0].text, `${opener}\n${rest}`, `${label}: the clause must keep its continuation`);

    const verdict = (list) => {
      const p = f3Proposal();
      p.terms.numerator.deductions = list;
      cite(p, "numerator.deductions").quote = opener;
      return checkTermsProvenance(p.terms, p.source_citations, chunks);
    };
    // MUST KEEP ALLOWING: the complete list, quoting only the opener line.
    assert.deepEqual(verdict(["unfinanced_capex", "cash_taxes"]), { valid: true, violations: [] }, `${label}: correct terms must be accepted`);
    // MUST REFUSE: the list emptied, and the list with one deduction dropped.
    assert.match(verdict([]).violations[0].reason, /unfinanced_capex but the terms leave it out/, `${label}: an emptied list must be refused`);
    assert.match(verdict(["unfinanced_capex"]).violations[0].reason, /cash_taxes but the terms leave it out/, `${label}: a trimmed list must be refused`);
  }
});

test("F2: a marker after a finished sentence still ends the block, so the condition did not disable the break", () => {
  const ONE = '"Debt Service Coverage Ratio" means, for any period, the ratio of (i) Consolidated EBITDA for that period minus Unfinanced Capital Expenditures, to (ii) Debt Service for that period.';
  const PROSE = "All computations under this Agreement shall exclude taxes paid in respect of prior periods.";
  const capexOnly = () => {
    const p = f3Proposal();
    p.terms.numerator.deductions = ["unfinanced_capex"];
    cite(p, "numerator.deductions").quote = ONE;
    return p;
  };
  const accepted = (...lines) => {
    const chunks = withChunk("§1.01", ["§1.01 Defined Terms.", clauses.debtService, ONE, ...lines].join("\n"));
    const p = capexOnly();
    return checkTermsProvenance(p.terms, p.source_citations, chunks).valid;
  };
  // ONE ends in a full stop, so each of these markers closes the block and the
  // prose after it is outside the definition.
  assert.equal(accepted("§1.02 Accounting Terms.", PROSE), true, "heading");
  assert.equal(accepted(`(b) ${PROSE}`), true, "enumerator");
  assert.equal(accepted(`7.12(a) ${PROSE}`), true, "numbered sub-clause");
  assert.equal(accepted("", PROSE), true, "blank line, which needs no full stop");
  // And the recorded limitation is unchanged: prose in the same paragraph with no
  // marker at all is still read as part of the definition, and still warned.
  assert.equal(accepted(PROSE), false, "same paragraph, no marker: the recorded limitation");
});

test("F2: a one-sentence definition raises no extent warning, so the warning is not noise", () => {
  for (const key of ["F1", "F3", "F5"]) {
    const f = facility(key);
    for (const v of f.terms_versions) {
      const p = proposalFor(f, v.version);
      const w = termsWarnings(p.terms, p.source_citations, chunksOf(key)).map((x) => x.code);
      assert.ok(!w.includes("definition_extent_ambiguous"), `${key} v${v.version}: ${w.join()}`);
      assert.ok(!w.includes("definition_conflict"), `${key} v${v.version}: ${w.join()}`);
      assert.ok(!w.includes("definition_superseded"), `${key} v${v.version}: ${w.join()}`);
    }
  }
});

test("F3: a restatement that limits itself is taken whole, and SAYS so rather than doing it silently", () => {
  const limited = {
    citation: "Amd 3 §2",
    doc_type: "amendment",
    doc_title: "Amendment No. 3",
    section: "§2",
    effective_date: "2026-04-01",
    content: '§2 Amended Definition.\n"Debt Service Coverage Ratio" means, solely for the test period ending June 30, 2026, the ratio of (i) Consolidated EBITDA for that period minus Unfinanced Capital Expenditures, to (ii) Debt Service for that period.',
  };
  const chunks = [...chunksOf("F3"), limited];
  const p = f3Proposal();
  p.terms.numerator.deductions = ["unfinanced_capex"];
  Object.assign(cite(p, "numerator.deductions"), { citation: "Amd 3 §2", quote: limited.content.split("\n")[1] });
  // It governs (it is later), which is why the limitation has to be visible.
  assert.deepEqual(checkTermsProvenance(p.terms, p.source_citations, chunks), { valid: true, violations: [] });
  const w = termsWarnings(p.terms, p.source_citations, chunks);
  assert.match(w.find((x) => x.code === "definition_amendment_partial").message, /limits itself \("solely for"\) but was taken as the whole definition for every period/);
  assert.match(w.find((x) => x.code === "definition_superseded").message, /also defined in Credit Agreement/);
  // An unlimited restatement raises no partial warning.
  const plain = { ...limited, content: limited.content.replace("solely for the test period ending June 30, 2026, ", "") };
  assert.deepEqual(termsWarnings(p.terms, p.source_citations, [...chunksOf("F3"), plain]).filter((x) => x.code === "definition_amendment_partial"), []);
});

// ------------------------------------------- repairing a refused list by hand

test("applyEdits can replace a LIST, so a refused deduction list is repairable instead of a dead end", () => {
  const p = f3Proposal();
  p.terms.numerator.deductions = ["unfinanced_capex"]; // cash_taxes dropped: refused
  const before = checkTermsProvenance(p.terms, p.source_citations, chunksOf("F3"));
  assert.deepEqual(fields(before), ["numerator.deductions"]);

  const edited = applyEdits(p.terms, p.source_citations, [
    { field: "numerator.deductions", value: ["unfinanced_capex", "cash_taxes"], citation: "CA §1.01", quote: clauses.coverageRatio },
  ]);
  assert.deepEqual(edited.terms.numerator.deductions, ["unfinanced_capex", "cash_taxes"]);
  const entry = edited.source_citations.find((c) => c.field === "numerator.deductions");
  assert.equal(entry.provenance, ANALYST_CORRECTED);
  assert.deepEqual(entry.original_value, ["unfinanced_capex"]);
  assert.deepEqual(p.terms.numerator.deductions, ["unfinanced_capex"], "the input is never mutated");
  assert.deepEqual(checkTermsProvenance(edited.terms, edited.source_citations, chunksOf("F3")), { valid: true, violations: [] });
});

test("a list edit is held to the same standard: a wrong list, a shape mismatch and a non-scalar element are all refused", () => {
  const p = f3Proposal();
  // A list edit that is still wrong is still refused by the server-located definition.
  const wrong = applyEdits(p.terms, p.source_citations, [{ field: "numerator.deductions", value: ["unfinanced_capex"], citation: "CA §1.01", quote: clauses.coverageRatio }]);
  assert.deepEqual(fields(checkTermsProvenance(wrong.terms, wrong.source_citations, chunksOf("F3"))), ["numerator.deductions"]);
  // A list where a single value belongs, or the reverse, is a different proposal, not an edit.
  for (const edit of [
    { field: "threshold.min_dscr", value: [1.25], citation: "CA §7.11", quote: clauses.threshold(1.25) },
    { field: "numerator.deductions", value: "unfinanced_capex", citation: "CA §1.01", quote: clauses.coverageRatio },
    { field: "numerator.deductions", value: [{ name: "x" }], citation: "CA §1.01", quote: clauses.coverageRatio },
    { field: "numerator", value: ["x"], citation: "CA §1.01", quote: clauses.coverageRatio },
  ]) {
    assert.throws(() => applyEdits(p.terms, p.source_citations, [edit]), TermsError, JSON.stringify(edit));
  }
});

test("approve: an analyst repairs a refused deduction list with a list edit, and the row records the override", async () => {
  const broken = f3Proposal();
  broken.terms.numerator.deductions = ["unfinanced_capex"];
  const db = fakeDb({ covenant_terms: [proposedRow({ id: P1, version: 1, terms: broken.terms, source_citations: broken.source_citations })] });

  const refused = await approve(db, { terms_id: P1, approved_by: "a.analyst" });
  assert.equal(refused.status, 422);
  assert.deepEqual(refused.body.violations.map((v) => v.field), ["numerator.deductions"]);
  assert.deepEqual(db.writes, [], "nothing is written while it is refused");

  const ok = await approve(db, {
    terms_id: P1,
    approved_by: "a.analyst",
    edits: [{ field: "numerator.deductions", value: ["unfinanced_capex", "cash_taxes"], citation: "CA §1.01", quote: clauses.coverageRatio }],
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const stored = db.tables.covenant_terms[0];
  assert.deepEqual(stored.terms.numerator.deductions, ["unfinanced_capex", "cash_taxes"]);
  const entry = stored.source_citations.find((c) => c.field === "numerator.deductions");
  assert.equal(entry.provenance, ANALYST_CORRECTED);
  assert.deepEqual(entry.original_value, ["unfinanced_capex"]);
});

test("I1: an empty deductions list with no citation is refused, because that is how deductions get dropped", () => {
  const p = f3Proposal();
  p.terms.numerator.deductions = [];
  p.source_citations = p.source_citations.filter((c) => c.field !== "numerator.deductions");
  assert.deepEqual(checkTermsProvenance(p.terms, p.source_citations, chunksOf("F3")).violations.map((v) => v.reason), ["no citation for this term"]);
});

test("I1: base and basis must be stated in the quotes cited for them", () => {
  const base = f3Proposal();
  base.terms.numerator.base = "Adjusted EBITDA";
  assert.deepEqual(fields(checkTermsProvenance(base.terms, base.source_citations, chunksOf("F3"))), ["numerator.base"]);

  // The base is a name, not a completeness question, so its scope is the whole
  // ARTICLE the located definition sits in (still server-chosen). A definition
  // that writes the base once and uses a short form afterwards must not be refused.
  const shortForm = withChunk("§1.01", ['"Consolidated EBITDA" means consolidated net income plus interest, taxes, depreciation and amortization.', '"Debt Service" means scheduled principal payments and cash interest paid.', '"Debt Service Coverage Ratio" means the ratio of (i) EBITDA minus Unfinanced Capital Expenditures and cash taxes paid, to (ii) Debt Service.'].join("\n"));
  const sf = f3Proposal();
  cite(sf, "numerator.deductions").quote = '"Debt Service Coverage Ratio" means the ratio of (i) EBITDA minus Unfinanced Capital Expenditures and cash taxes paid, to (ii) Debt Service.';
  cite(sf, "denominator.components").quote = '"Debt Service" means scheduled principal payments and cash interest paid.';
  assert.deepEqual(checkTermsProvenance(sf.terms, sf.source_citations, shortForm), { valid: true, violations: [] });

  const basis = f3Proposal();
  basis.terms.test_period.basis = "LTM";
  assert.deepEqual(fields(checkTermsProvenance(basis.terms, basis.source_citations, chunksOf("F3"))), ["test_period.basis"]);

  // TTM is not supported by a threshold quote that names no trailing period.
  // A threshold quote naming no trailing period cannot support a TTM basis. (It also loses its number here.)
  const noPeriod = f3Proposal();
  cite(noPeriod, "threshold.min_dscr").quote = "(a) Minimum Ratio. The Borrower shall not permit the Debt Service Coverage Ratio, tested as of the last day of each fiscal quarter";
  assert.ok(fields(checkTermsProvenance(noPeriod.terms, noPeriod.source_citations, chunksOf("F3"))).includes("threshold.min_dscr"));
});

test("I1: an amendment's doc must be the document its date citation points into", () => {
  const { terms, source_citations } = f3WithAmendment();
  terms.effective_amendments[0].doc = "Amendment No. 3";
  const chunks = [...chunksOf("F3"), { ...amendmentChunk.metadata, content: amendmentChunk.content, citation: "Amd 2 §1" }];
  assert.deepEqual(fields(checkTermsProvenance(terms, source_citations, chunks)), ["effective_amendments[0].doc"]);
});

// ---- I3: omission warnings

const codes = (w) => w.map((x) => x.code);

test("I3: an amendment on file that no term cites is flagged", () => {
  const f1 = facility("F1");
  const v1 = proposalFor(f1, 1);
  const w = termsWarnings(v1.terms, v1.source_citations, chunksOf("F1"));
  assert.ok(codes(w).includes("amendment_not_cited"), JSON.stringify(w));
  assert.match(w.find((x) => x.code === "amendment_not_cited").message, /Amendment No\. 2 is on file but no term cites it/);

  // Citing it, or listing it among the effective amendments, clears the warning.
  const v2 = proposalFor(f1, 2);
  assert.ok(!codes(termsWarnings(v2.terms, v2.source_citations, chunksOf("F1"))).includes("amendment_not_cited"));
  // An amendment document with no chunks at all is still known by its title.
  assert.deepEqual(codes(termsWarnings(f3Proposal().terms, f3Proposal().source_citations, chunksOf("F3"), ["Amendment No. 9"])), ["amendment_not_cited"]);
});

test("I3: an add-back the documents permit but no term lists is flagged, by name and clause", () => {
  const v1 = proposalFor(F5, 1);
  const w = termsWarnings(v1.terms, v1.source_citations, chunksOf("F5"));
  const missed = w.filter((x) => x.code === "addback_not_in_terms");
  assert.equal(missed.length, 1);
  assert.match(missed[0].message, /Amd 2 §3 permits an add-back for "fuel hedging mark-to-market losses"/);

  const v2 = proposalFor(F5, 2);
  assert.ok(!codes(termsWarnings(v2.terms, v2.source_citations, chunksOf("F5"))).includes("addback_not_in_terms"));
});

test("I3: a threshold citing the original clause after an amendment restated it is flagged", () => {
  const p = f3Proposal();
  p.source_citations.find((c) => c.field === "threshold.min_dscr").citation = "CA §7.11(a)";
  const restating = {
    doc_type: "amendment", doc_title: "Amendment No. 2", section: "§3", citation: "Amd 2 §3",
    content: "§3 Amendment to Section 7.11.\nSection 7.11(a) of the Credit Agreement is amended and restated to read: not less than 1.35 to 1.00.",
  };
  const w = termsWarnings(p.terms, p.source_citations, [...chunksOf("F3"), restating]);
  const hit = w.find((x) => x.code === "clause_amended");
  assert.ok(hit, JSON.stringify(w));
  assert.equal(hit.field, "threshold.min_dscr");
  assert.match(hit.message, /Amd 2 §3 amends §7\.11\(a\)/);

  // A different sub-clause of the same section is not the clause that was restated.
  const other = f3Proposal();
  other.source_citations.find((c) => c.field === "threshold.min_dscr").citation = "CA §7.11(c)";
  assert.ok(!codes(termsWarnings(other.terms, other.source_citations, [...chunksOf("F3"), restating])).includes("clause_amended"));
});

test("I3: F5's real amendment amends §7.11(b), so the add-back cap citing CA §7.11(b)(i) is flagged for a human", () => {
  const v2 = proposalFor(F5, 2);
  const w = termsWarnings(v2.terms, v2.source_citations, chunksOf("F5"));
  assert.ok(w.some((x) => x.code === "clause_amended" && x.field === "numerator.addbacks[0].cap"), JSON.stringify(w));
});

test("thresholdProvenance looks at the threshold alone", () => {
  const { terms, source_citations } = f3Proposal();
  assert.equal(thresholdProvenance(terms, source_citations, chunksOf("F3")).valid, true);
  terms.threshold.min_dscr = 1.5;
  assert.equal(thresholdProvenance(terms, source_citations, chunksOf("F3")).valid, false);
  // An unrelated defect elsewhere is not the threshold's problem.
  const t2 = f3Proposal();
  t2.source_citations = t2.source_citations.filter((c) => c.field !== "denominator.components");
  assert.equal(thresholdProvenance(t2.terms, t2.source_citations, chunksOf("F3")).valid, true);
});

test("loadSourceChunks reads agreement and amendment text only: a waiver request cannot source terms", async () => {
  const db = fakeDb({ facilityKey: "F3" });
  const loaded = await loadSourceChunks(db, F3_ID);
  assert.ok(loaded.length > 0);
  assert.deepEqual([...new Set(loaded.map((c) => c.doc_type))], ["agreement"]);
  assert.ok(db.tables.doc_chunks.some((r) => r.metadata.doc_type === "waiver"), "the fixture does hold a waiver chunk");
  assert.ok(loaded.every((c) => c.citation.startsWith("CA ")));

  // It also carries each document's effective_date, which is what decides which
  // of two documents defining the same term governs. Without it, precedence has
  // no input and silently falls back to "they all tie".
  const agreementDate = F3.documents.find((d) => d.doc_type === "agreement").effective_date;
  assert.ok(isIsoDate(agreementDate));
  assert.deepEqual([...new Set(loaded.map((c) => c.effective_date))], [agreementDate]);
  assert.deepEqual(locateDefinition("Debt Service Coverage Ratio", loaded).map((d) => [d.doc_title, d.effective_date]), [["Credit Agreement", agreementDate]]);

  // An amendment chunk whose document row is dated later wins on that date alone.
  const f5 = fakeDb({ facilityKey: "F5" });
  const f5Loaded = await loadSourceChunks(f5, FACILITY_ID.F5);
  const dates = new Map(f5Loaded.map((c) => [c.doc_title, c.effective_date]));
  assert.ok(isIsoDate(dates.get("Amendment No. 2")), JSON.stringify([...dates]));
  assert.ok(dates.get("Amendment No. 2") > dates.get("Credit Agreement"));

  // So a citation to the waiver finds no chunk, whatever the quote says.
  const { terms, source_citations } = f3Proposal();
  source_citations.find((c) => c.field === "threshold.min_dscr").citation = "WR §1";
  assert.match(checkTermsProvenance(terms, source_citations, loaded).violations[0].reason, /no chunk supplied for WR §1/);
});

// ================================================================ applyEdits

test("applyEdits marks the field analyst-corrected, keeps the model's value, and mutates nothing", () => {
  const { terms, source_citations } = f3Proposal();
  const beforeT = JSON.stringify(terms);
  const beforeC = JSON.stringify(source_citations);
  const quote = clauses.threshold(1.2);
  const out = applyEdits(terms, source_citations, [{ field: "threshold.min_dscr", value: 1.2, citation: "CA §7.11", quote }]);
  assert.equal(out.terms.threshold.min_dscr, 1.2);
  const entry = out.source_citations.find((c) => c.field === "threshold.min_dscr");
  assert.equal(entry.provenance, ANALYST_CORRECTED);
  assert.equal(entry.original_value, 1.25);
  assert.equal(entry.quote, quote);
  assert.equal(JSON.stringify(terms), beforeT);
  assert.equal(JSON.stringify(source_citations), beforeC);
  // The other citations are untouched and unmarked.
  assert.ok(out.source_citations.filter((c) => c.field !== "threshold.min_dscr").every((c) => c.provenance === undefined));
});

test("applyEdits: a second edit of one field keeps the MODEL's original value", () => {
  const { terms, source_citations } = f3Proposal();
  const q = (n) => clauses.threshold(n);
  const out = applyEdits(terms, source_citations, [
    { field: "threshold.min_dscr", value: 1.2, citation: "CA §7.11", quote: q(1.2) },
    { field: "threshold.min_dscr", value: 1.3, citation: "CA §7.11", quote: q(1.3) },
  ]);
  assert.equal(out.source_citations.filter((c) => c.field === "threshold.min_dscr").length, 1);
  assert.equal(out.source_citations.find((c) => c.field === "threshold.min_dscr").original_value, 1.25);
});

test("applyEdits refuses an edit with no citation or quote, a missing path, or a non-scalar target", () => {
  const { terms, source_citations } = f3Proposal();
  const e = (over) => applyEdits(terms, source_citations, [{ field: "threshold.min_dscr", value: 1.2, citation: "CA §7.11", quote: "q", ...over }]);
  assert.throws(() => e({ quote: "" }), (x) => x instanceof TermsError && x.status === 400 && /citation and a verbatim quote/.test(x.message));
  assert.throws(() => e({ citation: undefined }), TermsError);
  assert.throws(() => e({ field: "threshold.nope" }), (x) => x.status === 400 && /existing scalar/.test(x.message));
  assert.throws(() => e({ field: "numerator.addbacks[3].cap" }), TermsError);
  assert.throws(() => e({ field: "numerator" }), (x) => /existing scalar/.test(x.message));
  assert.throws(() => e({ value: { a: 1 } }), TermsError);
  for (const field of ["threshold..x", "threshold.", ".threshold", "numerator.addbacks[", "numerator.addbacks[x].cap", "[0]"]) {
    assert.throws(() => e({ field }), (x) => x instanceof TermsError && /not a valid path/.test(x.message), field);
  }
  assert.throws(() => applyEdits(terms, source_citations, "nope"), TermsError);
});

// ================================================================ supersede, termsInForce

test("supersede ends the approved version the day before, and its patch never touches terms", async () => {
  const db = dbWithV1AndProposedV2();
  const done = await supersede(db, F3_ID, "2026-04-01");
  assert.deepEqual(done, [{ id: P1, version: 1 }]);
  const [w] = db.writes;
  assert.deepEqual(w.patch, { status: "superseded", effective_to: "2026-03-31" });
  assert.deepEqual(Object.keys(w.patch).sort(), ["effective_to", "status"]);
});

test("supersede refuses to create a window that ends before it starts", async () => {
  const db = dbWithV1AndProposedV2();
  await assert.rejects(supersede(db, F3_ID, "2023-09-20"), (e) => e instanceof TermsError && e.status === 422);
  assert.equal(db.writes.length, 0);
});

test("supersede with nothing approved is a no-op", async () => {
  const db = fakeDb({ covenant_terms: [] });
  assert.deepEqual(await supersede(db, F3_ID, "2026-04-01"), []);
  assert.equal(db.writes.length, 0);
});

// ================================================================ approve: the path

test("first approval becomes v1 and records who and when", async () => {
  const db = fakeDb({ covenant_terms: [proposedRow({ id: P1, version: 1 })] });
  const r = await approve(db, { terms_id: P1, approved_by: "  A. Analyst " });
  assert.deepEqual(r, { status: 200, body: { terms_id: P1, version: 1, effective_from: "2023-09-20", status: "approved" } });
  const row = db.tables.covenant_terms[0];
  assert.equal(row.status, "approved");
  assert.equal(row.approved_by, "A. Analyst");
  assert.equal(row.approved_at, NOW);
  assert.equal(row.effective_to, null);
  assert.equal(db.writes.length, 1, "nothing to supersede, so exactly one write");
});

test("second approval becomes v2, supersedes v1, and leaves v1's terms byte-identical", async () => {
  const db = dbWithV1AndProposedV2();
  const v1Before = JSON.stringify(db.tables.covenant_terms.find((r) => r.id === P1).terms);
  const v1CitesBefore = JSON.stringify(db.tables.covenant_terms.find((r) => r.id === P1).source_citations);

  const r = await approve(db, { terms_id: P2, approved_by: "B. Checker" });
  assert.deepEqual(r, { status: 200, body: { terms_id: P2, version: 2, effective_from: "2026-04-01", status: "approved" } });

  const v1 = db.tables.covenant_terms.find((x) => x.id === P1);
  const v2 = db.tables.covenant_terms.find((x) => x.id === P2);
  assert.equal(v1.status, "superseded");
  assert.equal(v1.effective_to, "2026-03-31");
  assert.equal(JSON.stringify(v1.terms), v1Before);
  assert.equal(JSON.stringify(v1.source_citations), v1CitesBefore);
  assert.equal(v2.status, "approved");
  assert.equal(v2.effective_to, null);
  assert.equal(v2.approved_by, "B. Checker");
  assert.equal(db.tables.covenant_terms.length, 2, "nothing was deleted or duplicated");
  // The only write to v1 is the supersede patch.
  const v1Writes = db.writes.filter((w) => w.id === P1);
  assert.equal(v1Writes.length, 1);
  assert.deepEqual(Object.keys(v1Writes[0].patch).sort(), ["effective_to", "status"]);
});

test("termsInForce: a past period still resolves to the version in force then, not the latest", async () => {
  const db = dbWithV1AndProposedV2();
  await approve(db, { terms_id: P2, approved_by: "B. Checker" });

  const inside = await termsInForce(db, F3_ID, "2025-12-31");
  assert.equal(inside.version, 1);
  assert.equal(inside.status, "superseded", "v1 is superseded yet still governs its own window");
  assert.equal((await termsInForce(db, F3_ID, "2026-03-31")).version, 1, "the last day of v1's window");
  assert.equal((await termsInForce(db, F3_ID, "2026-04-01")).version, 2, "the first day of v2's");
  assert.equal((await termsInForce(db, F3_ID, "2026-06-30")).version, 2);
  assert.equal(await termsInForce(db, F3_ID, "2023-09-19"), null, "before any version existed");
});

test("termsInForce never returns a proposed row, and an unapproved facility has nothing in force", async () => {
  const db = fakeDb({ covenant_terms: [proposedRow({ id: P1, version: 1 })] });
  assert.equal(await termsInForce(db, F3_ID, "2026-06-30"), null);
  await assert.rejects(termsInForce(db, F3_ID, "June 30"), TermsError);
});

// ================================================================ approve: the S-1 gate

test("approve refuses a tampered value with 422, names the field, and writes nothing", async () => {
  const bad = f3Proposal();
  bad.terms.threshold.min_dscr = 0.85; // a real citation, a wrong number
  const db = fakeDb({ covenant_terms: [proposedRow({ id: P1, version: 1, terms: bad.terms, source_citations: bad.source_citations })] });
  const r = await approve(db, { terms_id: P1, approved_by: "A. Analyst" });
  assert.equal(r.status, 422);
  assert.deepEqual(r.body.violations, [{ field: "threshold.min_dscr", value: 0.85, reason: "value 0.85 does not appear in its cited quote" }]);
  assert.deepEqual(db.writes, []);
  assert.equal(db.tables.covenant_terms[0].status, "proposed");
});

test("approve re-verifies against stored chunks, so a client cannot supply its own evidence", async () => {
  // An edit whose quote is invented. The stored chunk does not contain it.
  const db = fakeDb({ covenant_terms: [proposedRow({ id: P1, version: 1 })] });
  const r = await approve(db, {
    terms_id: P1,
    approved_by: "A. Analyst",
    edits: [{ field: "threshold.min_dscr", value: 0.85, citation: "CA §7.11", quote: "The Borrower shall maintain a DSCR of 0.85 to 1.00." }],
  });
  assert.equal(r.status, 422);
  assert.match(r.body.violations[0].reason, /quote not found in CA §7\.11/);
  assert.deepEqual(db.writes, []);
});

test("approve refuses terms that fail shape validation, with 422 and the errors", async () => {
  const bad = f3Proposal();
  delete bad.terms.numerator.addbacks;
  const db = fakeDb({ covenant_terms: [proposedRow({ id: P1, version: 1, terms: bad.terms, source_citations: bad.source_citations })] });
  const r = await approve(db, { terms_id: P1, approved_by: "A. Analyst" });
  assert.equal(r.status, 422);
  assert.match(r.body.errors.join("|"), /numerator\.addbacks is required/);
  assert.deepEqual(db.writes, []);
});

test("approve refuses a missing citation on a non-numeric term even when every number checks out", async () => {
  const bad = f3Proposal();
  bad.source_citations = bad.source_citations.filter((c) => c.field !== "denominator.components");
  const db = fakeDb({ covenant_terms: [proposedRow({ id: P1, version: 1, terms: bad.terms, source_citations: bad.source_citations })] });
  const r = await approve(db, { terms_id: P1, approved_by: "A. Analyst" });
  assert.equal(r.status, 422);
  assert.deepEqual(r.body.violations.map((v) => v.field), ["denominator.components"]);
});

// ================================================================ approve: four-eyes and input

test("approve with no approver is 400, whatever else is true", async () => {
  for (const approved_by of [undefined, null, "", "   ", 42, {}]) {
    const db = fakeDb({ covenant_terms: [proposedRow({ id: P1, version: 1 })] });
    const r = await approve(db, { terms_id: P1, approved_by });
    assert.equal(r.status, 400, JSON.stringify(approved_by));
    assert.match(r.body.error, /approved_by is required/);
    assert.deepEqual(db.writes, []);
    assert.equal(db.tables.covenant_terms[0].status, "proposed");
  }
});

test("approve validates its other input: terms_id, edits, unknown row, wrong status", async () => {
  const db = fakeDb({ covenant_terms: [proposedRow({ id: P1, version: 1 })] });
  assert.equal((await approve(db, { approved_by: "x" })).status, 400);
  assert.equal((await approve(db, { terms_id: "nope", approved_by: "x" })).status, 400);
  assert.equal((await approve(db, null)).status, 400);
  assert.equal((await approve(db, { terms_id: P1, approved_by: "x", edits: "no" })).status, 400);
  assert.equal((await approve(db, { terms_id: P1, approved_by: "x", edits: [{ field: "threshold.min_dscr", value: 1 }] })).status, 400);
  assert.equal((await approve(db, { terms_id: P2, approved_by: "x" })).status, 404);

  assert.equal((await approve(db, { terms_id: P1, approved_by: "x" })).status, 200);
  const again = await approve(db, { terms_id: P1, approved_by: "y" });
  assert.equal(again.status, 409, "an approved row cannot be approved again");
  assert.equal(db.tables.covenant_terms[0].approved_by, "x", "and the original approver is not overwritten");
});

test("approve refuses terms that do not take effect after the version in force", async () => {
  const v1 = proposedRow({ id: P1, version: 1, status: "approved", extra: { approved_by: "seed", approved_at: NOW } });
  const db = fakeDb({ covenant_terms: [v1, proposedRow({ id: P2, version: 2 })] }); // same agreement, same date
  const r = await approve(db, { terms_id: P2, approved_by: "x" });
  assert.equal(r.status, 422);
  assert.match(r.body.error, /not after version 1/);
  assert.deepEqual(db.writes, []);
});

// ================================================================ approve: edits

test("an analyst edit whose number is in its own cited quote is approved and marked analyst-corrected", async () => {
  const db = fakeDb({ covenant_terms: [proposedRow({ id: P1, version: 1 })] });
  const r = await approve(db, { terms_id: P1, approved_by: "x", edits: [{ field: "threshold.min_dscr", value: 1.25, citation: "CA §7.11", quote: clauses.threshold(1.25) }] });
  assert.equal(r.status, 200);
  const stored = db.tables.covenant_terms[0];
  const entry = stored.source_citations.find((c) => c.field === "threshold.min_dscr");
  assert.equal(entry.provenance, "analyst-corrected");
  assert.equal(entry.original_value, 1.25);
});

test("an edit that changes the value to one the clause does not state is refused", async () => {
  const db = fakeDb({ covenant_terms: [proposedRow({ id: P1, version: 1 })] });
  const r = await approve(db, { terms_id: P1, approved_by: "x", edits: [{ field: "threshold.min_dscr", value: 1.1, citation: "CA §7.11", quote: clauses.threshold(1.25) }] });
  assert.equal(r.status, 422);
  assert.deepEqual(r.body.violations.map((v) => [v.field, v.value]), [["threshold.min_dscr", 1.1]]);
  assert.deepEqual(db.writes, []);
});

// ================================================================ approve: races

/** The approve flow's two writes, in order: 1 = supersede the previous version, 2 = claim the new one. */
function dbRacing(onWrite) {
  let updates = 0;
  const base = dbWithV1AndProposedV2();
  const db = fakeDb({
    covenant_terms: base.tables.covenant_terms,
    beforeWrite: (ctx) => ctx.op === "update" && onWrite((updates += 1), ctx),
  });
  db.tables.doc_chunks.push(amendmentChunk);
  return db;
}
const rival = (from) => proposedRow({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", version: 3, status: "approved", effective_from: from, extra: { approved_by: "other", approved_at: NOW } });

test("two approvals racing for one facility: the loser gets a 409, and the previous version ends where the WINNER begins", async () => {
  // Between this analyst's supersede and claim, another analyst's approval (a different
  // proposal, so a different version number: the version key alone would never fire)
  // lands. Only the one-approved-row index stops the second.
  const db = dbRacing((n, { tables }) => {
    if (n === 2) tables.covenant_terms.push(rival("2026-05-01"));
  });
  const r = await approve(db, { terms_id: P2, approved_by: "B. Checker" });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /landed first, and a facility may have only one approved version/, "the index's violation is recognised by name");

  const rows = db.tables.covenant_terms;
  assert.equal(rows.filter((x) => x.status === "approved").length, 1, "exactly one approved version");
  assert.equal(rows.find((x) => x.id === P2).status, "proposed", "the loser stays proposed");
  const v1 = rows.find((x) => x.id === P1);
  assert.equal(v1.status, "superseded");
  assert.equal(v1.effective_to, "2026-04-30", "v1's window ends the day before the winner's terms, not the loser's");
  assert.equal(await termsInForce(db, F3_ID, "2026-04-30").then((x) => x.version), 1);
  assert.equal(await termsInForce(db, F3_ID, "2026-05-01").then((x) => x.version), 3);
});

test("if the winner retired v1 first, the loser changes nothing about it", async () => {
  const db = dbRacing((n, { tables }) => {
    if (n === 1) {
      // The winner got there first: v1 is already superseded with the winner's date, and the winner is approved.
      const v1 = tables.covenant_terms.find((x) => x.id === P1);
      Object.assign(v1, { status: "superseded", effective_to: "2026-04-30" });
      tables.covenant_terms.push(rival("2026-05-01"));
    }
  });
  const r = await approve(db, { terms_id: P2, approved_by: "B. Checker" });
  assert.equal(r.status, 409);
  assert.equal(db.tables.covenant_terms.find((x) => x.id === P1).effective_to, "2026-04-30");
  assert.equal(db.writes.length, 0, "the loser wrote nothing at all");
});

test("if the claim fails and nobody else was approved, the previous version governs again", async () => {
  const db = dbRacing((n) => {
    if (n === 2) throw new Error("connection lost");
  });
  await assert.rejects(approve(db, { terms_id: P2, approved_by: "B. Checker" }), /connection lost/);
  const v1 = db.tables.covenant_terms.find((x) => x.id === P1);
  assert.equal(v1.status, "approved");
  assert.equal(v1.effective_to, null);
  assert.equal(db.tables.covenant_terms.find((x) => x.id === P2).status, "proposed");
  assert.equal((await termsInForce(db, F3_ID, "2026-06-30")).version, 1, "the borrower is never left with nothing in force");
});

test("if superseding fails, nothing was approved and nothing changed", async () => {
  const db = dbRacing((n) => {
    if (n === 1) throw new Error("connection lost");
  });
  await assert.rejects(approve(db, { terms_id: P2, approved_by: "B. Checker" }), /connection lost/);
  assert.equal(db.tables.covenant_terms.find((x) => x.id === P1).status, "approved");
  assert.equal(db.tables.covenant_terms.find((x) => x.id === P2).status, "proposed");
  assert.deepEqual(db.writes, []);
});

test("the database guard exists: migration 0007 is a partial unique index on approved rows, one per facility", () => {
  const sql = readFileSync(new URL("../supabase/migrations/0007_one_approved_version.sql", import.meta.url), "utf8");
  assert.match(sql, /create unique index if not exists covenant_terms_one_approved_per_facility/i);
  assert.match(sql, /on covenant_terms \(facility_id\)\s+where status = 'approved'/i);
});

test("approving a row someone else already approved is a 409, not a second approval", async () => {
  const db = fakeDb({ covenant_terms: [proposedRow({ id: P1, version: 1, status: "approved", extra: { approved_by: "first", approved_at: NOW } })] });
  const r = await approve(db, { terms_id: P1, approved_by: "second" });
  assert.equal(r.status, 409);
  assert.equal(db.tables.covenant_terms[0].approved_by, "first");
});

// ================================================================ propose

const GOOD = () => ({ found: true, ...f3Proposal() });

test("propose writes one PROPOSED row at the next version, never an approved one, and returns provenance", async () => {
  const db = fakeDb({ covenant_terms: [] });
  const r = await runPropose({ facility_id: F3_ID }, { client: db, propose: async () => GOOD() });
  assert.equal(r.status, 200);
  assert.equal(r.body.version, 1);
  assert.equal(r.body.effective_from, "2023-09-20");
  assert.deepEqual(r.body.provenance, { valid: true, violations: [] });
  assert.deepEqual(r.body.terms, GOOD().terms);
  assert.equal(db.tables.covenant_terms.length, 1);
  const row = db.tables.covenant_terms[0];
  assert.equal(row.id, r.body.terms_id);
  assert.equal(row.status, "proposed");
  assert.equal(row.approved_by, null);
  assert.equal(row.approved_at, null);
  assert.equal(db.writes.length, 1);
});

test("propose takes the next version above everything on file, and does not touch what is there", async () => {
  const existing = proposedRow({ id: P1, version: 1, status: "approved", extra: { approved_by: "seed", approved_at: NOW } });
  const db = fakeDb({ covenant_terms: [existing] });
  const before = JSON.stringify(db.tables.covenant_terms[0]);
  const r = await runPropose({ facility_id: F3_ID }, { client: db, propose: async () => GOOD() });
  assert.equal(r.body.version, 2);
  assert.equal(JSON.stringify(db.tables.covenant_terms[0]), before);
  assert.equal(db.writes.every((w) => w.op === "insert"), true);
});

test("two proposals racing for one version: the loser gets a 409, not a 500", async () => {
  const db = fakeDb({
    covenant_terms: [],
    beforeWrite: ({ tables, op }) => {
      if (op === "insert") tables.covenant_terms.push(proposedRow({ id: P2, version: 1 }));
    },
  });
  const r = await runPropose({ facility_id: F3_ID }, { client: db, propose: async () => GOOD() });
  assert.equal(r.status, 409);
});

test("propose of a proposal with a wrong value still returns it, flagged, so the screen can show the offending term", async () => {
  const db = fakeDb({ covenant_terms: [] });
  const bad = GOOD();
  bad.terms.threshold.min_dscr = 0.85;
  const r = await runPropose({ facility_id: F3_ID }, { client: db, propose: async () => bad });
  assert.equal(r.status, 200);
  assert.equal(r.body.provenance.valid, false);
  assert.deepEqual(r.body.provenance.violations.map((v) => v.field), ["threshold.min_dscr"]);
  // Writing it is safe: the approve route refuses it.
  assert.equal(db.tables.covenant_terms[0].status, "proposed");
  const approved = await approve(db, { terms_id: r.body.terms_id, approved_by: "x" });
  assert.equal(approved.status, 422);
});

test("propose: 'no DSCR covenant found' is a 200 with a reason, and writes no row", async () => {
  const db = fakeDb({ covenant_terms: [] });
  const r = await runPropose({ facility_id: F3_ID }, { client: db, propose: async () => ({ found: false, reason: "No minimum DSCR clause." }) });
  assert.deepEqual(r, { status: 200, body: { found: false, reason: "No minimum DSCR clause.", excerpts: [] } });
  assert.deepEqual(db.writes, []);
  assert.equal(db.tables.covenant_terms.length, 0);
});

test("I3: propose returns every excerpt the model saw, and the omission warnings", async () => {
  const f1 = facility("F1");
  const db = fakeDb({ facilityKey: "F1", covenant_terms: [] });
  const excerpts = hitsFor(f1, ["agreement", "amendment"]).map(({ citation, doc_title, doc_type, section, content }) => ({ citation, doc_title, doc_type, section, content }));
  // The model proposes F1's v1 terms and misses the amendment that is on file.
  const proposal = { found: true, ...proposalFor(f1, 1), excerpts };
  const r = await runPropose({ facility_id: FACILITY_ID.F1 }, { client: db, propose: async () => proposal });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.excerpts, excerpts);
  assert.ok(r.body.excerpts.some((e) => e.citation === "Amd 2 §3" || e.doc_title === "Amendment No. 2"));
  // Three independent signals that the terms omit the amendment on file.
  assert.deepEqual(r.body.warnings.map((w) => w.code).sort(), ["addback_not_in_terms", "amendment_not_cited", "clause_amended"]);
  // Warnings are for the human, not a refusal: the proposal is stored and provenance is still valid.
  assert.equal(r.body.provenance.valid, true);
  assert.equal(db.tables.covenant_terms[0].status, "proposed");
});

test("propose with no excerpts from the agent returns an empty list, never undefined", async () => {
  const db = fakeDb({ covenant_terms: [] });
  const r = await runPropose({ facility_id: F3_ID }, { client: db, propose: async () => GOOD() });
  assert.deepEqual(r.body.excerpts, []);
  assert.deepEqual(r.body.warnings, []);
});

test("propose rejects a bad facility_id with 400 before calling the agent, and a malformed agent answer with 502 and no row", async () => {
  const db = fakeDb({ covenant_terms: [] });
  let called = 0;
  const propose = async () => (called++, GOOD());
  assert.equal((await runPropose({ facility_id: "nope" }, { client: db, propose })).status, 400);
  assert.equal((await runPropose({}, { client: db, propose })).status, 400);
  assert.equal((await runPropose("x", { client: db, propose })).status, 400);
  assert.equal(called, 0);

  const malformed = GOOD();
  delete malformed.terms.numerator.deductions;
  const r = await runPropose({ facility_id: F3_ID }, { client: db, propose: async () => malformed });
  assert.equal(r.status, 502);
  assert.deepEqual(db.writes, []);
});

test("propose cannot be tricked into approving: nothing in it can produce status approved", async () => {
  const db = fakeDb({ covenant_terms: [] });
  const sneaky = { ...GOOD(), status: "approved", approved_by: "model" };
  await runPropose({ facility_id: F3_ID }, { client: db, propose: async () => sneaky });
  assert.equal(db.tables.covenant_terms[0].status, "proposed");
  assert.equal(db.tables.covenant_terms[0].approved_by, null);
});

test("propose refuses when no effective date can be derived rather than guessing one", async () => {
  const db = fakeDb({ covenant_terms: [] });
  db.tables.documents.forEach((d) => (d.effective_date = null));
  const r = await runPropose({ facility_id: F3_ID }, { client: db, propose: async () => GOOD() });
  assert.equal(r.status, 422);
  assert.deepEqual(db.writes, []);
});

// ====================== F1: the warnings are ON the row, not only on the screen

test("migration 0008 adds covenant_terms.warnings, nullable and with no default", () => {
  const sql = readFileSync(new URL("../supabase/migrations/0008_terms_warnings.sql", import.meta.url), "utf8");
  assert.match(sql, /alter table covenant_terms\s+add column if not exists warnings jsonb;/i);
  // A `not null default '[]'` would backfill rows approved before the column with
  // "checked, nothing found" — the exact silent claim the column exists to stop.
  assert.ok(!/default/i.test(sql.replace(/^--.*$/gm, "")), "the statement must carry no default");
  assert.match(sql, /comment on column covenant_terms\.warnings/i);
});

test("propose records the warnings ON the row it writes", async () => {
  const db = fakeDb({ covenant_terms: [] });
  db.tables.doc_chunks.push(amendmentChunk); // an amendment on file that F3's terms do not cite
  const r = await runPropose({ facility_id: F3_ID }, { client: db, propose: async () => ({ found: true, ...f3Proposal() }) });
  assert.equal(r.status, 200);
  const stored = db.tables.covenant_terms[0];
  assert.deepEqual(stored.warnings.map((w) => w.code), ["amendment_not_cited"]);
  assert.deepEqual(stored.warnings, r.body.warnings, "the row and the response say the same thing");
});

test("approve RECOMPUTES the warnings from the database, never trusting the stored or submitted ones", async () => {
  // The proposed row claims a clean bill of health. The client sits between
  // propose and approve, so the stored value is evidence of nothing.
  const lying = proposedRow({ id: P1, version: 1, extra: { warnings: [] } });
  const db = fakeDb({ covenant_terms: [lying] });
  db.tables.doc_chunks.push(amendmentChunk);
  const r = await approve(db, { terms_id: P1, approved_by: "a.analyst" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const stored = db.tables.covenant_terms[0];
  assert.deepEqual(stored.warnings.map((w) => w.code), ["amendment_not_cited"]);
  assert.match(stored.warnings[0].message, /Amendment No\. 2 is on file but no term cites it/);
  // And it is written in the same patch that approves the row, so an approved row
  // can never exist without its warning record.
  const claim = db.writes.find((w) => w.patch.status === "approved");
  assert.ok("warnings" in claim.patch, JSON.stringify(Object.keys(claim.patch)));
});

test("an approved row records that the completeness check DID NOT RUN, so silence cannot read as a pass", async () => {
  // This is the case the column exists for. A year later an auditor must be able
  // to tell "the machine could not find the definition" from "the machine passed it".
  const prose = "§1.01 Defined Terms.\nThe coverage ratio is Consolidated EBITDA less Unfinanced Capital Expenditures and cash taxes paid, over scheduled principal payments and cash interest paid.";
  const p = f3Proposal();
  for (const field of ["numerator.deductions", "denominator.components"]) cite(p, field).quote = prose.split("\n")[1];
  const db = fakeDb({ covenant_terms: [proposedRow({ id: P1, version: 1, terms: p.terms, source_citations: p.source_citations })] });
  for (const c of db.tables.doc_chunks) if (c.metadata.section === "§1.01" && c.metadata.doc_type === "agreement") c.content = prose;

  const r = await approve(db, { terms_id: P1, approved_by: "a.analyst" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const stored = db.tables.covenant_terms[0];
  assert.deepEqual(stored.warnings.map((w) => `${w.code}:${w.field}`), ["definition_not_located:numerator.deductions", "definition_not_located:denominator.components"]);
  assert.match(stored.warnings[0].message, /was NOT verified against the document/);

  // The mirror: with the real §1.01 on file the same terms record [] — "the
  // checks ran and raised nothing" — which is a different statement from null.
  const clean = fakeDb({ covenant_terms: [proposedRow({ id: P1, version: 1 })] });
  const ok = await approve(clean, { terms_id: P1, approved_by: "a.analyst" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(clean.tables.covenant_terms[0].warnings, []);
});

test("approve recomputes the warnings against the terms AS EDITED, not as proposed", async () => {
  const broken = f3Proposal();
  broken.terms.numerator.deductions = ["unfinanced_capex"]; // refused until repaired
  const db = fakeDb({ covenant_terms: [proposedRow({ id: P1, version: 1, terms: broken.terms, source_citations: broken.source_citations, extra: { warnings: null } })] });
  db.tables.doc_chunks.push(amendmentChunk);
  const r = await approve(db, {
    terms_id: P1,
    approved_by: "a.analyst",
    edits: [{ field: "numerator.deductions", value: ["unfinanced_capex", "cash_taxes"], citation: "CA §1.01", quote: clauses.coverageRatio }],
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(db.tables.covenant_terms[0].warnings.map((w) => w.code), ["amendment_not_cited"]);
});

test("if covenant_terms.warnings is missing, propose fails naming the migration rather than dropping the record", async () => {
  const db = fakeDb({ covenant_terms: [] });
  const from = db.from.bind(db);
  db.from = (table) => {
    const q = from(table);
    if (table !== "covenant_terms") return q;
    const insert = q.insert.bind(q);
    q.insert = (row) => {
      const chain = insert(row);
      const fail = { data: null, error: { code: "PGRST204", message: "Could not find the 'warnings' column of 'covenant_terms' in the schema cache" } };
      return { ...chain, select: () => ({ single: async () => fail, maybeSingle: async () => fail }) };
    };
    return q;
  };
  const r = await runPropose({ facility_id: F3_ID }, { client: db, propose: async () => ({ found: true, ...f3Proposal() }) });
  assert.equal(r.status, 500);
  assert.match(r.body.error, /apply supabase\/migrations\/0008_terms_warnings\.sql/);
});

test("the corpus fixture really holds chunks for all three facilities", () => {
  for (const f of FACILITIES) assert.ok(chunkRows(f).length > 5, f.id);
});
