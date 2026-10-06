import { test } from "node:test";
import assert from "node:assert/strict";

import { FACILITIES } from "../data/facilities.js";
import {
  ANALYST_CORRECTED,
  TermsError,
  applyEdits,
  checkTermsProvenance,
  dayBefore,
  loadSourceChunks,
  nextVersion,
  quoteContainsDate,
  runApprove,
  runPropose,
  supersede,
  termsInForce,
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
  assert.match(r.violations[0].reason, /is not the minimum/);
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
  const done = await supersede(db, F3_ID, "2026-04-01", { exceptId: P2 });
  assert.deepEqual(done, [{ id: P1, version: 1 }]);
  const [w] = db.writes;
  assert.deepEqual(w.patch, { status: "superseded", effective_to: "2026-03-31" });
  assert.deepEqual(Object.keys(w.patch).sort(), ["effective_to", "status"]);
});

test("supersede refuses to create a window that ends before it starts", async () => {
  const db = dbWithV1AndProposedV2();
  await assert.rejects(supersede(db, F3_ID, "2023-09-20", { exceptId: P2 }), (e) => e instanceof TermsError && e.status === 422);
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

test("a race on the unique version key is a 409, and the earlier version is untouched", async () => {
  // Between this analyst's read and write, another approval takes version 2.
  let fired = false;
  const base = dbWithV1AndProposedV2();
  const raced = fakeDb({
    covenant_terms: base.tables.covenant_terms,
    beforeWrite: ({ tables, op }) => {
      if (op === "update" && !fired) {
        fired = true;
        tables.covenant_terms.push(proposedRow({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", version: 2, status: "approved", effective_from: "2026-05-01", extra: { approved_by: "other", approved_at: NOW } }));
      }
    },
  });
  raced.tables.doc_chunks.push(amendmentChunk);

  const r = await approve(raced, { terms_id: P2, approved_by: "B. Checker" });
  assert.equal(fired, true);
  assert.equal(r.status, 409);
  const v1 = raced.tables.covenant_terms.find((x) => x.id === P1);
  assert.equal(v1.status, "approved", "v1 was not superseded by the loser");
  assert.equal(v1.effective_to, null);
  assert.equal(raced.tables.covenant_terms.find((x) => x.id === P2).status, "proposed");
  assert.equal(raced.writes.length, 0, "the losing approval wrote nothing");
});

test("if the supersede step fails after the claim, it says so, v2 stays approved, and every period still resolves correctly", async () => {
  let updates = 0;
  const base = dbWithV1AndProposedV2();
  const db = fakeDb({
    covenant_terms: base.tables.covenant_terms,
    beforeWrite: ({ op }) => {
      if (op === "update" && (updates += 1) === 2) throw new Error("connection lost"); // the 2nd write is the supersede
    },
  });
  db.tables.doc_chunks.push(amendmentChunk);

  const r = await approve(db, { terms_id: P2, approved_by: "B. Checker" });
  assert.equal(r.status, 500);
  assert.match(r.body.error, /Version 2 is approved, but the previous version could not be marked superseded/);
  assert.equal(db.tables.covenant_terms.find((x) => x.id === P2).status, "approved");
  assert.equal(db.tables.covenant_terms.find((x) => x.id === P1).status, "approved", "v1 still open-ended");
  // Two open-ended rows, yet nothing is mis-governed: the newer wins only where it has started.
  assert.equal((await termsInForce(db, F3_ID, "2026-03-31")).version, 1);
  assert.equal((await termsInForce(db, F3_ID, "2026-06-30")).version, 2);
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
  assert.deepEqual(r, { status: 200, body: { found: false, reason: "No minimum DSCR clause." } });
  assert.deepEqual(db.writes, []);
  assert.equal(db.tables.covenant_terms.length, 0);
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

test("the corpus fixture really holds chunks for all three facilities", () => {
  for (const f of FACILITIES) assert.ok(chunkRows(f).length > 5, f.id);
});
