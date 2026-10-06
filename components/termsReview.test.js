import { test } from "node:test";
import assert from "node:assert/strict";

import {
  amendmentDocs,
  amendmentsNotBoarded,
  applyLocalEdits,
  blockers,
  buildRows,
  clausesOnFile,
  isHeadingOnly,
  classify,
  clauseFor,
  findQuote,
  paragraphsOf,
  quotesForClause,
  readRefusal,
  reviewRows,
  splitWarnings,
  uncitedClauses,
  unrestedParagraphs,
  valueText,
  warningsForRow,
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

test("nothing with text is dropped: with no citations at all every clause that has a body is listed once", () => {
  const seen = sourceClauses("F3");
  const listed = uncitedClauses([], seen);
  assert.equal(listed.length, clausesOnFile(seen));
  assert.equal(new Set(listed.map((c) => `${c.doc_title}|${c.section}`)).size, listed.length, "each once");
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

// ------------------------------------------------ F-3: notes live on their rows

test("a note about a cited clause is attached to the row that cites it, so the row cannot claim to be clean", () => {
  const p = proposalFor(facility("F1"), 1);
  const w = termsWarnings(p.terms, p.source_citations, sourceClauses("F1"), ["Amendment No. 2"]);
  const { views } = reviewRows({ terms: p.terms, citations: p.source_citations, violations: [], edits: {}, staleFields: none, warnings: w });
  const threshold = views.find((v) => v.row.id === "threshold");
  assert.equal(threshold.state, "ok", "its value checks passed");
  assert.ok(threshold.notes.some((n) => n.code === "clause_amended"), "but it carries the note that its clause is amended");
  // The add-back the amendment permits lands on the add-backs row, which is where its absence is.
  assert.ok(views.find((v) => v.row.id === "addbacks-none").notes.some((n) => n.code === "addback_not_in_terms"));
  assert.ok(views.find((v) => v.row.id === "amendments-none").notes.some((n) => n.code === "amendment_not_cited"));
  // And it does not land on unrelated rows.
  assert.deepEqual(views.find((v) => v.row.id === "denominator").notes, []);
});

test("definition_not_located attaches to the list it did not check", () => {
  const rows = buildRows(proposalFor(facility("F3"), 1).terms);
  const w = [{ code: "definition_not_located", field: "numerator.deductions", message: "m" }];
  const got = rows.filter((r) => warningsForRow(r, w).length > 0).map((r) => r.id);
  assert.deepEqual(got.sort(), ["base", "deductions"], "the list itself, and the base that is checked against the same article");
});

test("an edited row, even one the server refused, says analyst-corrected and not only model proposed", () => {
  const p = proposalFor(facility("F3"), 1);
  const edits = { "threshold.min_dscr": { field: "threshold.min_dscr", value: 0.85, citation: "CA \u00a77.11", quote: "to be less than 1.25 to 1.00" } };
  const violations = [{ field: "threshold.min_dscr", reason: "value 0.85 does not appear in its cited quote" }];
  const { views } = reviewRows({ terms: p.terms, citations: p.source_citations, violations, edits, staleFields: none });
  const row = views.find((v) => v.row.id === "threshold");
  assert.equal(row.state, "unsupported");
  assert.equal(row.edited, true);
});

// ------------------------------------------------------ F-2: not boarded

test("an amendment on file that the approved terms do not carry is not boarded; one they carry is", () => {
  const docs = [
    { id: "1", title: "Credit Agreement", doc_type: "agreement", effective_date: "2024-03-15" },
    { id: "2", title: "Amendment No. 2", doc_type: "amendment", effective_date: "2026-04-01" },
    { id: "3", title: "Waiver Request Letter \u2014 unexecuted", doc_type: "waiver", effective_date: "2026-08-12" },
  ];
  assert.deepEqual(amendmentsNotBoarded(docs, new Set()).map((d) => d.title), ["Amendment No. 2"], "only amendments are ever flagged");
  assert.deepEqual(amendmentsNotBoarded(docs, new Set(["Amendment No. 2"])), []);
  const v1 = facility("F1").terms_versions.find((v) => v.version === 1).terms;
  assert.deepEqual(amendmentDocs(v1), [], "F1's approved v1 carries no amendment: that is the twist");
  assert.deepEqual(amendmentDocs({ effective_amendments: [{ doc: "Amendment No. 2", effective: "2026-04-01", citation: "x" }] }), ["Amendment No. 2"]);
});

// -------------------------------------------- F-4: the universe is what is on file

test("a clause retrieval never surfaced still appears, marked as never shown to the model", () => {
  const p = proposalFor(facility("F1"), 1);
  const universe = sourceClauses("F1");
  const retrieved = universe.filter((c) => c.section === "\u00a77.11" || c.section === "\u00a71.01"); // all the model saw
  const uncited = uncitedClauses(p.source_citations, universe, retrieved);
  const amd = uncited.find((c) => c.doc_type === "amendment" && /\u00a73/.test(c.citation));
  assert.ok(amd, "Amendment §3 is listed though retrieval returned nothing of it");
  assert.equal(amd.shown, false);
  assert.ok(uncited.every((c) => c.shown === false), "nothing outside the retrieved set was shown");
  // When it was not recorded, the screen must not guess.
  assert.ok(uncitedClauses(p.source_citations, universe, null).every((c) => c.shown === null));
});

// -------------------------------------------- F-5: paragraphs inside a cited clause

test("paragraphs of a cited clause that no quote touches are marked, and the heading is not", () => {
  const text = "\u00a77.11 Debt Service Coverage Ratio.\n(a) Minimum Ratio. Not less than the stated ratio.\n(b) Adjustments. An add-back may be permitted.\n(c) Verification. Stated in a certificate.";
  const quote = findQuote(text, "Not less than the stated ratio.");
  const paras = paragraphsOf(text, [quote]);
  assert.deepEqual(paras.map((p) => [p.heading, p.rested]), [[true, false], [false, true], [false, false], [false, false]]);
  assert.equal(text.slice(paras[2].start, paras[2].end), "(b) Adjustments. An add-back may be permitted.");
});

test("on the real F3 agreement, \u00a77.11(b) and (c) rest on no term when only (a) is quoted", () => {
  const p = proposalFor(facility("F3"), 1);
  const universe = sourceClauses("F3");
  const clause = clauseFor("CA \u00a77.11", universe);
  const quotes = quotesForClause(clause, p.source_citations);
  assert.ok(quotes.length >= 1);
  const spans = quotes.map((q) => findQuote(clause.content, q)).filter(Boolean);
  const loose = paragraphsOf(clause.content, spans).filter((x) => !x.heading && !x.rested);
  assert.ok(loose.length >= 1, "the paragraphs after the minimum-ratio sentence are unrested");
  const counts = unrestedParagraphs(p.source_citations, universe);
  assert.ok(counts.paragraphs >= loose.length && counts.clauses >= 1);
});

test("a quote that is not in the clause rests on nothing, so every paragraph is unrested", () => {
  const text = "(a) one.\n(b) two.";
  assert.deepEqual(paragraphsOf(text, []).map((p) => p.rested), [false, false]);
});

// ------------------------------------- heading-only chunks are not clauses (N-1)

test("a one-line heading is not an uncited clause; a heading with text under it is", () => {
  assert.equal(isHeadingOnly("ARTICLE VII \u2014 FINANCIAL COVENANTS"), true);
  assert.equal(isHeadingOnly("\u00a77.11 Debt Service Coverage Ratio."), true);
  assert.equal(isHeadingOnly("\u00a77.11 Debt Service Coverage Ratio.\n(a) Minimum Ratio. Not less than."), false);
  assert.equal(isHeadingOnly("CREDIT AGREEMENT dated as of September 20, 2023."), false, "a preamble is text");
});

test("headings are left out of the uncited list and its count, and the count of clauses on file", () => {
  const universe = sourceClauses("F1");
  const all = new Set(universe.map((c) => `${c.doc_title}|${c.section}`)).size;
  const headings = universe.filter((c) => isHeadingOnly(c.content)).length;
  assert.ok(headings > 0, "the real F1 corpus does contain heading-only chunks");
  const uncited = uncitedClauses([], universe);
  assert.equal(uncited.length, all - headings);
  assert.ok(uncited.every((c) => !isHeadingOnly(c.content)));
  assert.equal(clausesOnFile(universe), all - headings);
});

// ------------------------------------- the bar names where to look (item 3)

test("the unrested-paragraph count names the clause, not only a number", () => {
  const p = proposalFor(facility("F3"), 1);
  const counts = unrestedParagraphs(p.source_citations, sourceClauses("F3"));
  assert.ok(counts.paragraphs >= 1);
  assert.ok(counts.where.includes("CA \u00a77.11"), JSON.stringify(counts.where));
  assert.equal(counts.where.length, counts.clauses);
});
