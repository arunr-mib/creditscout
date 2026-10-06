import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyLocalEdits,
  blockers,
  buildRows,
  classify,
  clauseFor,
  findQuote,
  readRefusal,
  reviewRows,
  splitWarnings,
  uncitedClauses,
  valueText,
} from "./termsReview.ts";
import { checkTermsProvenance, loadSourceChunks, termsWarnings } from "../lib/terms.ts";
import { FACILITY_ID, chunkRows, facility, fakeDb, proposalFor } from "../lib/terms.fixtures.js";
import { citationFor } from "../lib/retrieval.ts";

// The review logic is drawn on screen, never decided there: what the server
// refuses is what shows. These tests use the real generated agreements and the
// real provenance checker, so the reasons being classified are the reasons the
// server actually gives, not ones invented to fit.

const clausesOf = (key) =>
  chunkRows(facility(key)).map((r) => ({
    content: r.content,
    doc_title: r.metadata.doc_title,
    doc_type: r.metadata.doc_type,
    section: r.metadata.section,
    citation: citationFor(r.metadata.doc_type, r.metadata.doc_title, r.metadata.section),
  }));
const sourceClauses = (key) => clausesOf(key).filter((c) => ["agreement", "amendment"].includes(c.doc_type));

const none = new Set();
const review = (p, extra = {}) =>
  reviewRows({ terms: p.terms, citations: p.source_citations, violations: [], edits: {}, staleFields: none, ...extra });

// ---------------------------------------------------------------- quotes

test("findQuote marks the span as written, through smart quotes, dashes and line wraps", () => {
  const content = "Heading\n“Debt Service” means,\n  for any period — the sum of (i) principal.";
  const at = findQuote(content, '"Debt Service" means, for any period - the sum of');
  assert.ok(at);
  assert.equal(content.slice(at.start, at.end), "“Debt Service” means,\n  for any period — the sum of");
});

test("findQuote returns null for a quote that is not in the clause, and never matches an empty quote", () => {
  assert.equal(findQuote("The Borrower shall not permit 1.25 to 1.00.", "to be less than 1.50"), null);
  assert.equal(findQuote("anything", "   "), null);
});

test("findQuote agrees with the server about what is in a real clause", () => {
  const f = facility("F3");
  const p = proposalFor(f, 1);
  const chunks = sourceClauses("F3");
  for (const c of p.source_citations) {
    const clause = clauseFor(c.citation, chunks);
    assert.ok(clause, `${c.citation} resolves`);
    assert.ok(findQuote(clause.content, c.quote), `${c.field}: the quote is found where the server found it`);
  }
});

// ------------------------------------------------------------ classification

test("classify names the real reasons the provenance checker gives", () => {
  const f = facility("F3");
  const chunks = sourceClauses("F3");
  const p = proposalFor(f, 1);

  const noCite = checkTermsProvenance(p.terms, p.source_citations.filter((c) => c.field !== "threshold.min_dscr"), chunks);
  assert.ok(noCite.violations.length > 0);
  assert.ok(noCite.violations.every((v) => classify(v.reason) === "no_citation"), JSON.stringify(noCite.violations));

  const wrongValue = structuredClone(p.terms);
  wrongValue.threshold.min_dscr = 1.1;
  const absent = checkTermsProvenance(wrongValue, p.source_citations, chunks);
  assert.equal(absent.violations[0].field, "threshold.min_dscr");
  assert.equal(classify(absent.violations[0].reason), "value_absent");

  const fakeQuote = p.source_citations.map((c) => (c.field === "threshold.min_dscr" ? { ...c, quote: "not words from the agreement" } : c));
  const missing = checkTermsProvenance(p.terms, fakeQuote, chunks);
  assert.equal(classify(missing.violations[0].reason), "quote_missing");

  const dropped = structuredClone(p.terms);
  dropped.numerator.deductions = ["unfinanced_capex"];
  const list = checkTermsProvenance(dropped, p.source_citations, chunks);
  assert.equal(classify(list.violations[0].reason), "other");
});

// ----------------------------------------------------------------- rows

test("no add-backs is a row that says so, not a row that disappears", () => {
  const p = proposalFor(facility("F3"), 1);
  const rows = buildRows(p.terms);
  const none = rows.find((r) => r.id === "addbacks-none");
  assert.ok(none, "an empty add-back list still shows");
  assert.equal(none.citeField, null);
  assert.match(none.absence, /None proposed/);
  assert.ok(rows.find((r) => r.id === "amendments-none"));
});

test("a clean proposal reads as ok on every cited row", () => {
  const f = facility("F3");
  const p = proposalFor(f, 1);
  const v = checkTermsProvenance(p.terms, p.source_citations, sourceClauses("F3")).violations;
  assert.deepEqual(v, []);
  const { views, stray } = review(p, { violations: v });
  assert.deepEqual(stray, []);
  for (const view of views.filter((x) => x.row.citeField)) assert.equal(view.state, "ok", view.row.id);
});

test("a term with no citation is blocked, and says no_citation, whatever the server did or did not say", () => {
  const p = proposalFor(facility("F1"), 1);
  const cites = p.source_citations.filter((c) => c.field !== "denominator.components");
  const { views } = review({ ...p, source_citations: cites }, { violations: [] });
  const row = views.find((v) => v.row.id === "denominator");
  assert.equal(row.state, "no_citation");
});

test("a real citation carrying a wrong value is flagged as unsupported, not as sound", () => {
  const f = facility("F3");
  const p = proposalFor(f, 1);
  const terms = structuredClone(p.terms);
  terms.threshold.min_dscr = 1.1;
  const violations = checkTermsProvenance(terms, p.source_citations, sourceClauses("F3")).violations;
  const { views } = reviewRows({ terms, citations: p.source_citations, violations, edits: {}, staleFields: none });
  const row = views.find((v) => v.row.id === "threshold");
  assert.equal(row.state, "unsupported");
  assert.equal(row.problems[0].kind, "value_absent");
  assert.ok(row.entry, "the quote it cites is available to show beside the value");
});

test("a refusal that no row owns is kept, not dropped", () => {
  const p = proposalFor(facility("F3"), 1);
  const { views, stray } = review(p, { violations: [{ field: "malformed", reason: "malformed citation entry" }] });
  assert.deepEqual(stray.map((s) => s.field), ["malformed"]);
  assert.ok(views.length > 0);
  const reasons = blockers({ views, stray, approver: "A. Analyst", unconfirmed: [] });
  assert.ok(reasons.some((r) => r.includes("malformed")));
});

test("an edit shows the model's original beside the correction, and retires the refusal it answers", () => {
  const p = proposalFor(facility("F3"), 1);
  const edits = {
    "threshold.min_dscr": { field: "threshold.min_dscr", value: 1.4, citation: "CA §7.11", quote: "to be less than 1.40 to 1.00" },
  };
  const violations = [{ field: "threshold.min_dscr", reason: "value 1.25 does not appear in its cited quote" }];
  const { views } = reviewRows({ terms: p.terms, citations: p.source_citations, violations, edits, staleFields: new Set(["threshold.min_dscr"]) });
  const row = views.find((v) => v.row.id === "threshold");
  assert.equal(row.state, "edited");
  assert.equal(row.parts[0].text, "1.4");
  assert.equal(row.parts[0].original, "1.25");
  assert.equal(row.entry.citation, "CA §7.11");
  // The same refusal, if the server issues it again after the edit, stands.
  const again = reviewRows({ terms: p.terms, citations: p.source_citations, violations, edits, staleFields: none });
  assert.equal(again.views.find((v) => v.row.id === "threshold").state, "unsupported");
});

test("a list is edited as a list", () => {
  const p = proposalFor(facility("F3"), 1);
  const next = applyLocalEdits(p.terms, {
    "numerator.deductions": { field: "numerator.deductions", value: ["cash_taxes"], citation: "CA §1.01", quote: "q" },
  });
  assert.deepEqual(next.numerator.deductions, ["cash_taxes"]);
  assert.deepEqual(p.terms.numerator.deductions, ["unfinanced_capex", "cash_taxes"], "the proposal is not mutated");
});

test("valueText never turns an uncapped add-back into a number", () => {
  assert.equal(valueText("numerator.addbacks[0].cap", null), "uncapped (no limit)");
  assert.equal(valueText("numerator.addbacks[0].cap", 500000), "500,000");
  assert.equal(valueText("numerator.deductions", []), "none");
  assert.equal(valueText("threshold.min_dscr", 1.25), "1.25");
});

// -------------------------------------------------------------- blockers

test("Approve is blocked, in words, for a missing approver, a missing citation and an unchecked completeness", () => {
  const p = proposalFor(facility("F1"), 1);
  const cites = p.source_citations.filter((c) => c.field !== "denominator.components");
  const { views, stray } = review({ ...p, source_citations: cites });
  const reasons = blockers({ views, stray, approver: "   ", unconfirmed: ["numerator.deductions"] });
  assert.ok(reasons.some((r) => /Debt service components: no citation/.test(r)));
  assert.ok(reasons.some((r) => /numerator\.deductions: completeness was not checked/.test(r)));
  assert.ok(reasons.includes("Enter the approver's name."));
  assert.deepEqual(blockers({ views: review(p).views, stray: [], approver: "A. Analyst", unconfirmed: [] }), []);
});

// ------------------------------------------------------------ omission

test("the clauses no term cites are listed, and the amendment an F1 proposal leaves out is one of them", () => {
  const p = proposalFor(facility("F1"), 1);
  const seen = sourceClauses("F1");
  const uncited = uncitedClauses(p.source_citations, seen);
  assert.ok(uncited.some((c) => c.doc_type === "amendment"), "Amendment No. 2 is not cited by v1 terms");
  assert.ok(!uncited.some((c) => c.citation === "CA §7.11"), "a cited section is not listed");
});

test("an analyst's edit citing a clause counts that clause as cited", () => {
  const p = proposalFor(facility("F1"), 1);
  const seen = sourceClauses("F1");
  const amd = seen.find((c) => c.doc_type === "amendment" && /§/.test(c.citation));
  const before = uncitedClauses(p.source_citations, seen);
  const after = uncitedClauses([...p.source_citations, { citation: amd.citation }], seen);
  assert.equal(after.length, before.length - 1);
});

test("nothing is dropped: with no citations at all every clause is listed once", () => {
  const seen = sourceClauses("F3");
  const sections = new Set(seen.map((c) => `${c.doc_title}|${c.section}`));
  assert.equal(uncitedClauses([], seen).length, sections.size);
});

test("a stored proposal's warnings match what the server computes for the same terms", () => {
  const f = facility("F1");
  const p = proposalFor(f, 1);
  const w = termsWarnings(p.terms, p.source_citations, sourceClauses("F1"), ["Amendment No. 2"]);
  const { notRun, notes } = splitWarnings(w);
  assert.deepEqual(notRun, [], "the definitions are on file, so the completeness check ran");
  assert.ok(notes.some((n) => n.code === "amendment_not_cited"));
});

test("definition_not_located is separated from the notes so it cannot be mistaken for one", () => {
  const { notRun, notes } = splitWarnings([
    { code: "definition_not_located", field: "numerator.deductions", message: "m" },
    { code: "amendment_not_cited", message: "n" },
  ]);
  assert.equal(notRun.length, 1);
  assert.deepEqual(notes.map((n) => n.code), ["amendment_not_cited"]);
});

// ------------------------------------------------------------ refusals

test("readRefusal keeps the server's words and every violation", () => {
  const r = readRefusal(422, { error: "Provenance check failed", violations: [{ field: "threshold.min_dscr", value: 0.85, reason: "value 0.85 does not appear in its cited quote" }] });
  assert.equal(r.status, 422);
  assert.equal(r.violations[0].field, "threshold.min_dscr");
  const shape = readRefusal(422, { error: "The terms fail validation.", errors: ["numerator.base is required"] });
  assert.deepEqual(shape.errors, ["numerator.base is required"]);
  assert.match(readRefusal(500, null).message, /500/);
});

test("the page and the refusal path share one fake: a loaded row round-trips through loadSourceChunks", async () => {
  const db = fakeDb({ facilityKey: "F3" });
  const chunks = await loadSourceChunks(db, FACILITY_ID.F3);
  assert.ok(chunks.length > 0);
  assert.ok(chunks.every((c) => typeof c.citation === "string" && c.citation !== ""));
});

test("a row that borrows another's citation does not inherit that row's refusal", () => {
  const p = proposalFor(facility("F3"), 1);
  const terms = structuredClone(p.terms);
  terms.threshold.min_dscr = 1.1;
  const violations = checkTermsProvenance(terms, p.source_citations, sourceClauses("F3")).violations;
  const { views } = reviewRows({ terms, citations: p.source_citations, violations, edits: {}, staleFields: none });
  assert.equal(views.find((v) => v.row.id === "threshold").state, "unsupported");
  assert.equal(views.find((v) => v.row.id === "basis").state, "ok", "the basis is not the thing that is wrong");
  assert.match(views.find((v) => v.row.id === "basis").row.checkedAgainst, /Minimum DSCR/);
});
