import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { computeDscr } from "../../../calc/dscr.js";
import { FACILITIES, boardedVersionFor, termsFor } from "../../../data/facilities.js";
import { extractFigures } from "../../../guardrails/guardrail.js";
import { chunkBySection } from "../../chunk.ts";
import { FACILITY_ID, OTHER_FACILITY, fakeDb } from "../fakes.js";
import { toolRequestBody } from "../orchestrator.ts";
import { runDscrCalculator } from "./dscr-calculator.ts";

// No network and no database. The tables are the shared in-memory PostgREST
// fake (`../fakes.js`), and the document chunks are the REAL corpus put through
// the REAL chunker — F1's and F3's together, so every test here is also a test
// that one borrower's financials never vouch for another borrower's figure.

const ROOT = join(import.meta.dirname, "..", "..", "..");
const FACILITY_OF = { F1: FACILITY_ID, F3: OTHER_FACILITY };

function corpus(code) {
  const f = FACILITIES.find((x) => x.id === code);
  return f.documents.flatMap((d) =>
    chunkBySection(readFileSync(join(ROOT, "data", "facilities", code, d.file), "utf8"), {
      facility_id: FACILITY_OF[code],
      document_id: `${code}:${d.title}`,
      doc_type: d.doc_type,
      doc_title: d.title,
    }),
  );
}
const DOC_CHUNKS = [...corpus("F1"), ...corpus("F3")];
/** The text of one chunk, by facility, document title and section. */
const chunkText = (code, title, section) =>
  DOC_CHUNKS.filter((c) => c.metadata.facility_id === FACILITY_OF[code] && c.metadata.doc_title === title && c.metadata.section === section)
    .map((c) => c.content)
    .join("\n");

const F1 = FACILITIES.find((f) => f.id === "F1");
const Q2 = F1.quarters.find((q) => q.period_end === "2026-06-30");
const TERMS = termsFor(boardedVersionFor(F1, Q2), Q2); // F1's boarded v1 terms: no add-backs
const TERMS_V2 = termsFor(F1.terms_versions[1], Q2); // Amendment No. 2 mapped: restructuring charges, cap 500,000
const FINANCIALS = Q2.financials; // includes addback_amounts {"restructuring charges": 620000}
const F3_FINANCIALS = {
  ebitda: 2884000,
  unfinanced_capex: 220000,
  cash_taxes: 180000,
  scheduled_principal: 1600000,
  cash_interest: 700000,
  addback_amounts: { "owner compensation normalisation": 530000 },
};

/** One citation per figure, each naming the financials chunk that states it. */
const CITES = {
  ebitda: "Fin Q2 2026 §1",
  unfinanced_capex: "Fin Q2 2026 §1",
  cash_taxes: "Fin Q2 2026 §1",
  scheduled_principal: "Fin Q2 2026 §1",
  cash_interest: "Fin Q2 2026 §1",
  addback_amounts: { "restructuring charges": "Fin Q2 2026 §2" },
};
const F3_CITES = { ...CITES, addback_amounts: { "owner compensation normalisation": "Fin Q2 2026 §2" } };

const BODY = { terms: TERMS, financials: FINANCIALS, financial_citations: CITES, facility_id: FACILITY_ID };
const FIXED_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CASEFILE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const newDb = () => fakeDb({ doc_chunks: DOC_CHUNKS });
/** Every calc_log insert attempted, in order. */
const logged = (db) => db.writes.filter((w) => w.table === "calc_log" && w.op === "insert").map((w) => w.payload);

const call = async (body, over = {}) => {
  const db = over.client ?? newDb();
  const r = await runDscrCalculator(body, { client: db, newId: () => FIXED_ID, ...over });
  return { ...r, db, rows: logged(db) };
};
const clone = (v) => structuredClone(v);
const without = (obj, key) => {
  const out = clone(obj);
  delete out[key];
  return out;
};

// --------------------------------------------------- the happy path and its log

test("F1 Q2-2026 on v1 terms: 1.12, fail, and the number comes straight from the calculator", async () => {
  const { status, body } = await call(BODY);
  assert.equal(status, 200);
  assert.equal(body.dscr, 1.12);
  assert.equal(body.pass, false);
  assert.equal(body.threshold, 1.25);
  // The wrapper adds, rounds and adjusts nothing: it is exactly what the pure function returns.
  assert.deepEqual(body, computeDscr(TERMS, FINANCIALS, { calcId: FIXED_ID }));
});

test("writes exactly ONE calc_log row, and its calc_id is the one returned", async () => {
  const { body, rows } = await call(BODY);
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.calc_id, body.calc_id);
  assert.equal(row.calc_id, FIXED_ID);
  assert.equal(row.calculator_version, body.calculator_version);
  assert.deepEqual(row.inputs, { terms: TERMS, financials: FINANCIALS, financial_citations: CITES, facility_id: FACILITY_ID });
  assert.deepEqual(row.outputs, body);
  assert.equal(row.casefile_id, null);
});

test("casefile_id is logged when given", async () => {
  const { rows } = await call({ ...BODY, casefile_id: CASEFILE_ID });
  assert.equal(rows[0].casefile_id, CASEFILE_ID);
});

test("the calc_id is minted by the wrapper: a real UUID, fresh each call", async () => {
  const run = () => runDscrCalculator(BODY, { client: newDb() });
  const [a, b] = [await run(), await run()];
  assert.match(a.body.calc_id, UUID);
  assert.match(b.body.calc_id, UUID);
  assert.notEqual(a.body.calc_id, b.body.calc_id);
});

test("a calc_id supplied in the request is ignored: the model cannot choose its own", async () => {
  const { body, rows } = await call({ ...BODY, calc_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
  assert.equal(body.calc_id, FIXED_ID);
  assert.equal(rows[0].calc_id, FIXED_ID);
});

// ------------------------------------- input provenance (spec §4.2): the mirrors

test("MIRROR, the live F1 shape: a pre-capped 500000 cited to the financials is REFUSED, because the financials state 620000", async () => {
  // Every F1 run on gpt-4.1-mini handed the calculator 500000 — the cap, applied
  // by the model — where the financials state 620000. The ratio came out right
  // (the calculator caps anyway), but 500000 is a number the model produced.
  const s2 = chunkText("F1", "Financials — Q2 2026", "§2");
  assert.ok(extractFigures(s2).includes(620000), "fixture: §2 states 620,000");
  assert.ok(!extractFigures(s2).includes(500000), "fixture: §2 does not state 500,000");

  const precapped = { ...FINANCIALS, addback_amounts: { "restructuring charges": 500000 } };
  const { status, body, rows } = await call({ ...BODY, terms: TERMS_V2, financials: precapped });
  assert.equal(status, 200, "missing evidence is something the agent reasons about, not an outage");
  assert.deepEqual(body, { error: 'financials.addback_amounts["restructuring charges"]: 500000 is not stated in Fin Q2 2026 §2' });
  assert.equal(rows.length, 0, "no calc_log row: there is no number to trace");

  // Cited to §1, where the stitched 8b quote began, it is refused just the same.
  const s1 = await call({ ...BODY, terms: TERMS_V2, financials: precapped, financial_citations: { ...CITES, addback_amounts: { "restructuring charges": "Fin Q2 2026 §1" } } });
  assert.match(s1.body.error, /500000 is not stated in Fin Q2 2026 §1/);
  assert.equal(s1.rows.length, 0);
});

test("MIRROR, the correct shape: 620000 cited to Fin Q2 2026 §2 is ACCEPTED, the CALCULATOR applies the cap, and calc_log carries the citations", async () => {
  const { status, body, rows } = await call({ ...BODY, terms: TERMS_V2 });
  assert.equal(status, 200);
  assert.equal(body.dscr, 1.28);
  assert.equal(body.pass, true);
  // The cap is the calculator's job, and it is the calculator that does it:
  // 620,000 claimed, 500,000 applied. 620,000 now traces to this calculation.
  assert.deepEqual(body.components.addbacks["restructuring charges"], { claimed: 620000, applied: 500000, cap: 500000, capped: true });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].inputs.financial_citations, CITES, "the provenance of every input survives into the log");
  assert.equal(rows[0].inputs.financials.addback_amounts["restructuring charges"], 620000);
  assert.equal(rows[0].inputs.facility_id, FACILITY_ID);
});

test("620000 cited to Fin Q2 2026 §1 is refused: §1 does not state it, and each figure is checked against ITS OWN chunk", async () => {
  // The task brief names §1 for 620000; the corpus prints it in §2. Accepting it
  // here would mean a citation only had to name the right document.
  assert.ok(!extractFigures(chunkText("F1", "Financials — Q2 2026", "§1")).includes(620000), "fixture");
  const cites = { ...CITES, addback_amounts: { "restructuring charges": "Fin Q2 2026 §1" } };
  const { body, rows } = await call({ ...BODY, terms: TERMS_V2, financial_citations: cites });
  assert.deepEqual(body, { error: 'financials.addback_amounts["restructuring charges"]: 620000 is not stated in Fin Q2 2026 §1' });
  assert.equal(rows.length, 0);
});

test("MIRROR, the bypass: 500000 cited to the AMENDMENT — where it IS stated, as the cap — is refused: a financial figure must come from a financials chunk", async () => {
  // The next thing a model would find: cite the cap's own clause for the
  // pre-capped figure. The figure check alone would pass it.
  assert.ok(extractFigures(chunkText("F1", "Amendment No. 2", "§3")).includes(500000), "fixture: the amendment states 500,000");
  const precapped = { ...FINANCIALS, addback_amounts: { "restructuring charges": 500000 } };
  const cites = { ...CITES, addback_amounts: { "restructuring charges": "Amd 2 §3" } };
  const { status, body, rows } = await call({ ...BODY, terms: TERMS_V2, financials: precapped, financial_citations: cites });
  assert.equal(status, 200);
  assert.deepEqual(body, { error: 'financials.addback_amounts["restructuring charges"]: Amd 2 §3 is not a financials chunk (it is amendment)' });
  assert.equal(rows.length, 0);
  // A sub-clause citation resolves to the same chunk and is refused the same way.
  const sub = await call({ ...BODY, terms: TERMS_V2, financials: precapped, financial_citations: { ...CITES, addback_amounts: { "restructuring charges": "Amd 2 §3(a)" } } });
  assert.match(sub.body.error, /Amd 2 §3\(a\) is not a financials chunk/);
});

test("the borrower's compliance certificate is not a source either: F3's 530000 is stated in CC §3 and still refused there", async () => {
  // The borrower's figure is evidence to reconcile against, never the source of ours.
  assert.ok(extractFigures(chunkText("F3", "Compliance Certificate — Q2 2026", "§3")).includes(530000), "fixture");
  const cites = { ...F3_CITES, addback_amounts: { "owner compensation normalisation": "CC Q2 2026 §3" } };
  const { body, rows } = await call({ ...BODY, financials: F3_FINANCIALS, financial_citations: cites, facility_id: OTHER_FACILITY });
  assert.deepEqual(body, { error: 'financials.addback_amounts["owner compensation normalisation"]: CC Q2 2026 §3 is not a financials chunk (it is compliance_certificate)' });
  assert.equal(rows.length, 0);
});

test("figures are verified against the facility_id's OWN financials: F3's figures pass for F3 and are refused for F1", async () => {
  const f3 = await call({ ...BODY, financials: F3_FINANCIALS, financial_citations: F3_CITES, facility_id: OTHER_FACILITY });
  assert.equal(f3.status, 200);
  assert.equal(typeof f3.body.dscr, "number", JSON.stringify(f3.body));

  // Same figures, same citations, but F1's documents: "Fin Q2 2026 §1" exists for
  // both borrowers, and only F3's states 2,884,000.
  const asF1 = await call({ ...BODY, financials: F3_FINANCIALS, financial_citations: F3_CITES, facility_id: FACILITY_ID });
  assert.match(asF1.body.error, /^financials\.ebitda: 2884000 is not stated in Fin Q2 2026 §1/);
  assert.equal(asF1.rows.length, 0);

  // And F1's figures, pointed at F3's documents, are refused there.
  const f1AsF3 = await call({ ...BODY, facility_id: OTHER_FACILITY });
  assert.match(f1AsF3.body.error, /^financials\.ebitda: 4020000 is not stated in Fin Q2 2026 §1/);
});

test("THROUGH THE ORCHESTRATOR'S GLUE: a model naming F3 cannot make F3's figures verify on an F1 casefile", async () => {
  // The same pin as orchestrator.test.js, followed into the calculator: the
  // facility the check reads is the casefile's, so the model's choice changes nothing.
  const ctx = { casefileId: CASEFILE_ID, facilityId: FACILITY_ID, runId: "demo", periodEnd: "2026-06-30" };
  const args = { terms: TERMS, financials: F3_FINANCIALS, financial_citations: F3_CITES, facility_id: OTHER_FACILITY };
  const direct = await call(without(args, "casefile_id"));
  assert.equal(typeof direct.body.dscr, "number", "control: named directly, F3's figures DO verify against F3");
  const { status, body, rows } = await call(toolRequestBody("dscr_calculator", args, ctx));
  assert.equal(status, 200);
  assert.match(body.error, /^financials\.ebitda: 2884000 is not stated in Fin Q2 2026 §1/);
  assert.equal(rows.length, 0);
});

test("numbers are compared after normalisation: the chunk prints 4,020,000 and the figure is 4020000", async () => {
  assert.match(chunkText("F1", "Financials — Q2 2026", "§1"), /Consolidated EBITDA: 4,020,000/);
  const ok = await call(BODY);
  assert.equal(ok.body.dscr, 1.12);
  // ...but a figure is never "close enough": the calculator works in cents.
  for (const near of [4020001, 4020000.5, 402000, 40200000]) {
    const { body, rows } = await call({ ...BODY, financials: { ...FINANCIALS, ebitda: near } });
    assert.equal(body.error, `financials.ebitda: ${near} is not stated in Fin Q2 2026 §1`);
    assert.equal(rows.length, 0);
  }
});

test("a missing citation is a 200 naming the field, never a calculation", async () => {
  for (const missing of [undefined, null, "", "   "]) {
    const cites = { ...CITES, ebitda: missing };
    if (missing === undefined) delete cites.ebitda;
    const { status, body, rows } = await call({ ...BODY, financial_citations: cites });
    assert.equal(status, 200);
    assert.deepEqual(body, { error: "financials.ebitda: no citation" }, `ebitda citation ${JSON.stringify(missing)}`);
    assert.equal(rows.length, 0);
  }
  const noAddbackCite = await call({ ...BODY, terms: TERMS_V2, financial_citations: { ...CITES, addback_amounts: {} } });
  assert.deepEqual(noAddbackCite.body, { error: 'financials.addback_amounts["restructuring charges"]: no citation' });
  const noAddbackMap = await call({ ...BODY, terms: TERMS_V2, financial_citations: without(CITES, "addback_amounts") });
  assert.deepEqual(noAddbackMap.body, { error: 'financials.addback_amounts["restructuring charges"]: no citation' });
});

test("every add-back sent needs a citation, even one the terms do not count", async () => {
  // v1 terms name no add-back, so the calculator would ignore this figure. It is
  // still a figure the agent put in front of the calculator, and the log keeps it.
  const { body } = await call({ ...BODY, terms: TERMS, financial_citations: { ...CITES, addback_amounts: {} } });
  assert.deepEqual(body, { error: 'financials.addback_amounts["restructuring charges"]: no citation' });
});

test("every problem is reported at once, in input order, so one step can fix them all", async () => {
  const cites = { ...without(CITES, "cash_taxes"), ebitda: "Amd 2 §3" };
  const financials = { ...FINANCIALS, cash_interest: 1100001 };
  const { status, body, rows } = await call({ ...BODY, financials, financial_citations: cites });
  assert.equal(status, 200);
  assert.equal(
    body.error,
    [
      "financials.ebitda: Amd 2 §3 is not a financials chunk (it is amendment)",
      "financials.cash_taxes: no citation",
      "financials.cash_interest: 1100001 is not stated in Fin Q2 2026 §1",
    ].join("; "),
  );
  assert.equal(rows.length, 0);
});

test("a citation that names no section on file is refused: another quarter, no document, a range", async () => {
  for (const cite of ["Fin Q3 2026 §1", "§1", "Fin Q2 2026 §§1-2", "Fin Q2 2026 PREAMBLE", "the financials", "Fin Q2 2026 §9"]) {
    const { status, body, rows } = await call({ ...BODY, financial_citations: { ...CITES, ebitda: cite } });
    assert.equal(status, 200);
    assert.deepEqual(body, { error: `financials.ebitda: ${cite} names no section on file for this facility` }, cite);
    assert.equal(rows.length, 0);
  }
});

test("a figure that is omitted needs no citation: the calculator reports it missing, as before", async () => {
  const { status, body, rows } = await call({
    ...BODY,
    financials: without(FINANCIALS, "cash_interest"),
    financial_citations: without(CITES, "cash_interest"),
  });
  assert.equal(status, 200);
  assert.deepEqual(body, { error: "missing input: financials.cash_interest" });
  assert.equal(rows.length, 0);
});

test("verification happens BEFORE any calculation: a refused figure never reaches computeDscr's log or a calc_id", async () => {
  const db = newDb();
  let minted = 0;
  const { body } = await call({ ...BODY, financial_citations: { ...CITES, ebitda: "Amd 2 §3" } }, { client: db, newId: () => { minted += 1; return FIXED_ID; } });
  assert.ok(!("calc_id" in body) && !("dscr" in body));
  assert.equal(minted, 0, "a calc_id was minted for a calculation that should never have run");
  assert.deepEqual(db.timeline, ["doc_chunks.select"]);
});

test("a chunk read that fails is a 500 with no number and no internal detail", async () => {
  const db = newDb();
  db.failOnce = { table: "doc_chunks", op: "select", error: { code: "XX000", message: "connection reset" } };
  const { status, body, rows } = await call(BODY, { client: db });
  assert.equal(status, 500);
  assert.ok(!("dscr" in body) && !("calc_id" in body));
  assert.ok(!JSON.stringify(body).includes("connection reset"));
  assert.equal(rows.length, 0);
});

// --------------------------------------------------- calculator errors are evidence

test("a missing financial input is a 200 with an {error} body and NO calc_log row", async () => {
  const { status, body, rows } = await call({ ...BODY, financials: without(FINANCIALS, "cash_interest") });
  assert.equal(status, 200);
  assert.deepEqual(body, { error: "missing input: financials.cash_interest" });
  assert.equal(rows.length, 0);
  assert.ok(!("calc_id" in body) && !("dscr" in body));
});

test("an explicit null input is missing too (200 + error), never zero", async () => {
  const { status, body, rows } = await call({ ...BODY, financials: { ...FINANCIALS, ebitda: null } });
  assert.equal(status, 200);
  assert.match(body.error, /missing input: financials\.ebitda/);
  assert.equal(rows.length, 0);
});

test("an unknown deduction component is a 200 {error}, not a 5xx and not a guess", async () => {
  const terms = clone(TERMS);
  terms.numerator.deductions.push("mystery_cost");
  const { status, body, rows } = await call({ ...BODY, terms });
  assert.equal(status, 200);
  assert.match(body.error, /unknown deduction component/);
  assert.equal(rows.length, 0);
});

test("a non-positive denominator is a 200 {error}", async () => {
  // Zero is not stated in the financials, so the provenance check refuses it
  // first — which is the point: a 0 the documents do not print never reaches the
  // calculator. The calculator's own refusal is pinned by calc/dscr.test.js.
  const { status, body, rows } = await call({ ...BODY, financials: { ...FINANCIALS, scheduled_principal: 0, cash_interest: 0 } });
  assert.equal(status, 200);
  assert.match(body.error, /financials\.scheduled_principal: 0 is not stated in Fin Q2 2026 §1/);
  assert.equal(rows.length, 0);
});

// --------------------------------------------------- malformed input is a 400 naming the field

async function assert400(body, field) {
  const { status, body: out, rows } = await call(body);
  assert.equal(status, 400, JSON.stringify(out));
  assert.match(out.error, new RegExp(field.replace(/[.[\]]/g, "\\$&")));
  assert.equal(rows.length, 0, "a rejected request must not log a calculation");
}

test("400 names the field: body, terms, financials", async () => {
  for (const bad of [null, "text", 42, [], undefined]) await assert400(bad, "request body");
  await assert400(without(BODY, "terms"), "terms");
  await assert400({ ...BODY, terms: [] }, "terms");
  await assert400({ ...BODY, terms: "x" }, "terms");
  await assert400(without(BODY, "financials"), "financials");
  await assert400({ ...BODY, financials: [] }, "financials");
});

test("400 when facility_id is missing or not a UUID: the figures cannot be verified against nothing", async () => {
  await assert400(without(BODY, "facility_id"), "facility_id");
  for (const bad of [null, "", "F1", 7, "Harbor Logistics"]) await assert400({ ...BODY, facility_id: bad }, "facility_id");
});

test("400 when financial_citations is missing or the wrong shape", async () => {
  await assert400(without(BODY, "financial_citations"), "financial_citations");
  for (const bad of [null, [], "Fin Q2 2026 §1", 1]) await assert400({ ...BODY, financial_citations: bad }, "financial_citations");
  await assert400({ ...BODY, financial_citations: { ...CITES, ebitda: 1 } }, "financial_citations.ebitda");
  await assert400({ ...BODY, financial_citations: { ...CITES, ebitda: ["Fin Q2 2026 §1"] } }, "financial_citations.ebitda");
  await assert400({ ...BODY, financial_citations: { ...CITES, addback_amounts: ["Fin Q2 2026 §2"] } }, "financial_citations.addback_amounts");
  await assert400(
    { ...BODY, financial_citations: { ...CITES, addback_amounts: { "restructuring charges": 2 } } },
    'financial_citations.addback_amounts["restructuring charges"]',
  );
});

test("an add-back named like an Object.prototype member is just a name with no citation", async () => {
  // `cites["constructor"]` would otherwise read Object's constructor function.
  const financials = { ...FINANCIALS, addback_amounts: { ...FINANCIALS.addback_amounts, constructor: 620000 } };
  const { status, body } = await call({ ...BODY, financials });
  assert.equal(status, 200);
  assert.deepEqual(body, { error: 'financials.addback_amounts["constructor"]: no citation' });
});

test("400 when add-backs is not an array: the calculator would silently read it as 'no add-backs'", async () => {
  // Proves the hazard is real, then that the wrapper stops it before it can mislead.
  const terms = clone(TERMS_V2);
  const asObject = { ...terms, numerator: { ...terms.numerator, addbacks: { name: "restructuring charges", cap: 500000 } } };
  const silent = computeDscr(asObject, FINANCIALS, { calcId: FIXED_ID });
  assert.equal(silent.dscr, 1.12, "the raw calculator ignores the malformed add-backs");
  await assert400({ ...BODY, terms: asObject }, "terms.numerator.addbacks");
});

test("400 when numerator, add-backs or deductions are OMITTED: the calculator would read them as empty and return a wrong ratio with a calc_id", async () => {
  // Prove the hazard: omit `deductions` and the raw calculator happily skips capex and cash taxes.
  const noDeductions = clone(TERMS);
  delete noDeductions.numerator.deductions;
  const raw = computeDscr(noDeductions, FINANCIALS, { calcId: FIXED_ID });
  assert.equal(raw.dscr, 1.3, "the raw calculator returns a confident, wrong figure");
  assert.notEqual(raw.dscr, 1.12);

  await assert400({ ...BODY, terms: noDeductions }, "terms.numerator.deductions");

  const noAddbacks = clone(TERMS);
  delete noAddbacks.numerator.addbacks;
  await assert400({ ...BODY, terms: noAddbacks }, "terms.numerator.addbacks");

  const noNumerator = clone(TERMS);
  delete noNumerator.numerator;
  await assert400({ ...BODY, terms: noNumerator }, "terms.numerator");

  for (const empty of [null, undefined]) {
    const t = clone(TERMS);
    t.numerator.deductions = empty;
    await assert400({ ...BODY, terms: t }, "terms.numerator.deductions");
  }
});

test("an EXPLICIT empty add-backs list is how 'no add-backs' is stated, and it is accepted", async () => {
  const terms = clone(TERMS);
  terms.numerator.addbacks = [];
  const { status, body } = await call({ ...BODY, terms });
  assert.equal(status, 200);
  assert.equal(body.dscr, 1.12);
});

test("400 when deductions or denominator components are not arrays", async () => {
  const t1 = clone(TERMS);
  t1.numerator.deductions = "unfinanced_capex";
  await assert400({ ...BODY, terms: t1 }, "terms.numerator.deductions");
  const t2 = clone(TERMS);
  t2.denominator.components = "cash_interest";
  await assert400({ ...BODY, terms: t2 }, "terms.denominator.components");
});

test("400 when threshold is malformed", async () => {
  const t1 = clone(TERMS);
  t1.threshold = 1.25;
  await assert400({ ...BODY, terms: t1 }, "terms.threshold");
  const t2 = clone(TERMS);
  t2.threshold.min_dscr = "1.25";
  await assert400({ ...BODY, terms: t2 }, "terms.threshold.min_dscr");
});

test("400 when a figure is present but not a number: no coercion of \"4,020,000\" or \"4020000\"", async () => {
  for (const value of ["4,020,000", "4020000", true, {}, []]) {
    await assert400({ ...BODY, financials: { ...FINANCIALS, ebitda: value } }, "financials.ebitda");
  }
  await assert400({ ...BODY, financials: { ...FINANCIALS, cash_taxes: "250000" } }, "financials.cash_taxes");
});

test("400 when an add-back amount is not a number, naming the add-back", async () => {
  await assert400({ ...BODY, financials: { ...FINANCIALS, addback_amounts: { "restructuring charges": "620000" } } }, 'financials.addback_amounts["restructuring charges"]');
  await assert400({ ...BODY, financials: { ...FINANCIALS, addback_amounts: [620000] } }, "financials.addback_amounts");
});

test("400 when casefile_id is not a UUID", async () => {
  await assert400({ ...BODY, casefile_id: "casefile-1" }, "casefile_id");
  await assert400({ ...BODY, casefile_id: 7 }, "casefile_id");
});

// --------------------------------------------------- logging failures never leak an unlogged number

test("a casefile_id that names no casefile is a 400, and no number is returned", async () => {
  const db = newDb();
  db.failOnce = { table: "calc_log", op: "insert", error: { code: "23503", message: "violates foreign key constraint" } };
  const { status, body } = await call({ ...BODY, casefile_id: CASEFILE_ID }, { client: db });
  assert.equal(status, 400);
  assert.match(body.error, /casefile_id/);
  assert.ok(!("dscr" in body) && !("calc_id" in body));
});

test("any other logging failure is a 500 and returns NO number: a figure nothing can vouch for must not escape", async () => {
  const db = newDb();
  db.failOnce = { table: "calc_log", op: "insert", error: { code: "XX000", message: "connection reset" } };
  const { status, body } = await call(BODY, { client: db });
  assert.equal(status, 500);
  assert.ok(!("dscr" in body) && !("calc_id" in body));
  assert.ok(!JSON.stringify(body).includes("connection reset"), "internal detail must not reach the agent");
});
