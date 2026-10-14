import { test } from "node:test";
import assert from "node:assert/strict";

import { calcIdNotes, calcLogForCasefile, chunksForCalcProvenance, chunksForClaims, chunksForTermsCitations, loadFacilityChunks } from "./evidence.ts";
import { CASEFILE_ID, FACILITY_ID, OTHER_FACILITY, TEST_ID, fakeDb } from "./fakes.js";

const row = (calc_id, over) => ({ calc_id, casefile_id: null, test_id: null, inputs: { terms: {} }, outputs: { dscr: 1 }, created_at: "2026-10-06T12:00:00.000000+00:00", ...over });

// ------------------------------------------------------------- E-1: the scope

test("E-1: this casefile's rows UNION the one row that raised the exception, oldest first", async () => {
  const db = fakeDb({
    tests: [{ id: TEST_ID, calc_id: "origin" }],
    calc_log: [
      row("mine-2", { casefile_id: CASEFILE_ID, created_at: "2026-10-06T15:17:42.999135+00:00" }),
      row("origin", { test_id: TEST_ID, created_at: "2026-10-06T13:38:44.435877+00:00" }),
      row("mine-1", { casefile_id: CASEFILE_ID, created_at: "2026-10-06T15:16:55.988115+00:00" }),
    ],
  });
  const rows = await calcLogForCasefile(db, CASEFILE_ID, TEST_ID);
  assert.deepEqual(rows.map((r) => r.calc_id), ["origin", "mine-1", "mine-2"]);
});

test("E-1 refuses: another quarter, an older run of the same test, another casefile, an orphan", async () => {
  const db = fakeDb({
    tests: [
      { id: TEST_ID, calc_id: "origin" },
      { id: "other-quarter", calc_id: "q1" },
    ],
    calc_log: [
      row("origin", { test_id: TEST_ID }),
      row("rerun", { test_id: TEST_ID, created_at: "2026-10-06T11:00:00.000000+00:00" }),
      row("q1", { test_id: "other-quarter" }),
      row("theirs", { casefile_id: "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee" }),
      row("orphan"),
    ],
  });
  assert.deepEqual((await calcLogForCasefile(db, CASEFILE_ID, TEST_ID)).map((r) => r.calc_id), ["origin"]);
});

test("E-1: no test, or a test that produced no calculation, adds nothing — and a test row cannot point at another test's calculation", async () => {
  const db = fakeDb({
    tests: [{ id: TEST_ID, calc_id: null }, { id: "t2", calc_id: "belongs-to-t3" }],
    calc_log: [row("belongs-to-t3", { test_id: "t3" }), row("mine", { casefile_id: CASEFILE_ID })],
  });
  assert.deepEqual((await calcLogForCasefile(db, CASEFILE_ID, TEST_ID)).map((r) => r.calc_id), ["mine"]);
  assert.deepEqual((await calcLogForCasefile(db, CASEFILE_ID, null)).map((r) => r.calc_id), ["mine"]);
  assert.deepEqual((await calcLogForCasefile(db, CASEFILE_ID, "t2")).map((r) => r.calc_id), ["mine"], "tests.calc_id named a row linked to another test");
});

test("E-1: the union is ordered by created_at, so a test re-run DURING the investigation sorts last", async () => {
  // The originating row is usually the oldest. Not always: re-running the
  // quarterly test mid-investigation moves tests.calc_id to a newer row, and
  // "the last row governs" has to mean the last row in time.
  const db = fakeDb({
    tests: [{ id: TEST_ID, calc_id: "rerun" }],
    calc_log: [
      row("rerun", { test_id: TEST_ID, created_at: "2026-10-06T16:00:00.000000+00:00" }),
      row("mine", { casefile_id: CASEFILE_ID, created_at: "2026-10-06T15:16:55.988115+00:00" }),
    ],
  });
  assert.deepEqual((await calcLogForCasefile(db, CASEFILE_ID, TEST_ID)).map((r) => r.calc_id), ["mine", "rerun"]);
});

test("E-1: ties at millisecond precision are broken by the microseconds Postgres keeps", async () => {
  const db = fakeDb({
    tests: [{ id: TEST_ID, calc_id: "origin" }],
    calc_log: [
      row("origin", { test_id: TEST_ID, created_at: "2026-10-06T15:16:55.988900+00:00" }),
      row("mine", { casefile_id: CASEFILE_ID, created_at: "2026-10-06T15:16:55.988100+00:00" }),
    ],
  });
  assert.deepEqual((await calcLogForCasefile(db, CASEFILE_ID, TEST_ID)).map((r) => r.calc_id), ["mine", "origin"]);
});

test("a database error is an error, never an empty evidence set", async () => {
  const db = fakeDb();
  db.failOnce = { table: "calc_log", op: "select", error: { message: "timeout" } };
  await assert.rejects(() => calcLogForCasefile(db, CASEFILE_ID, TEST_ID), /timeout/);
  const noTable = fakeDb();
  delete noTable.tables.doc_chunks;
  await assert.rejects(() => loadFacilityChunks(noTable, FACILITY_ID), /does not exist/);
});

// ------------------------------------------------- facility scoping, absolute

const chunk = (facility, doc_type, doc_title, section, content) => ({ content, metadata: { facility_id: facility, doc_type, doc_title, section } });
const BOTH = [
  chunk(FACILITY_ID, "agreement", "Credit Agreement", "§9.01", "Notices to Harbor Logistics, Inc."),
  chunk(OTHER_FACILITY, "agreement", "Credit Agreement", "§9.01", "Notices to Northgate Foods, Inc."),
  chunk(OTHER_FACILITY, "waiver", "Waiver Request Letter — unexecuted", "§2", "This letter is a request only."),
  chunk(FACILITY_ID, "amendment", "Amendment No. 2", "§3", "the Borrower may add back restructuring charges"),
  chunk(FACILITY_ID, "compliance_certificate", "Compliance Certificate — Q2 2026", "§3", "No add-back was applied"),
];

test("facility scoping: a chunk from another facility never comes back, even from a query layer that ignores the filter", async () => {
  // The query filters by facility. The in-memory filter is the one that holds
  // if it ever does not: this client returns EVERY row, whatever was asked.
  const leaky = { from: () => { const b = { select: () => b, eq: () => b, then: (r) => r({ data: BOTH, error: null }) }; return b; } };
  const chunks = await loadFacilityChunks(leaky, FACILITY_ID);
  assert.ok(chunks.length === 3 && chunks.every((c) => c.facility_id === FACILITY_ID), JSON.stringify(chunks));
  assert.ok(!chunks.some((c) => /Northgate/.test(c.content)));
  // and through the faithful fake, which models the JSON-path filter itself
  const viaFake = await loadFacilityChunks(fakeDb({ doc_chunks: BOTH }), OTHER_FACILITY);
  assert.deepEqual(viaFake.map((c) => c.citation).sort(), ["CA §9.01", "WR §2"]);
});

test("facility scoping: a claim citing another facility's clause gets no chunk", async () => {
  const mine = await loadFacilityChunks(fakeDb({ doc_chunks: BOTH }), FACILITY_ID);
  const keyed = chunksForClaims([{ citation: "CA §9.01" }, { citation: "WR §2" }], mine, FACILITY_ID);
  assert.deepEqual(keyed, [{ citation: "CA §9.01", content: "Notices to Harbor Logistics, Inc." }]);
  // handed the wrong facility's list, it still serves only the facility named
  const theirs = await loadFacilityChunks(fakeDb({ doc_chunks: BOTH }), OTHER_FACILITY);
  assert.deepEqual(chunksForClaims([{ citation: "CA §9.01" }], theirs, FACILITY_ID), []);
});

test("E-4: claims are keyed by the citation AS WRITTEN, sub-clause and all, resolved through resolveCitation", async () => {
  const mine = await loadFacilityChunks(fakeDb({ doc_chunks: BOTH }), FACILITY_ID);
  const keyed = chunksForClaims([{ citation: "Amd 2 §3(a)" }, { citation: " Amd 2 §3 " }, { citation: "Amd 2 PREAMBLE" }, { citation: "§3" }], mine, FACILITY_ID);
  assert.deepEqual(keyed.map((k) => k.citation), ["Amd 2 §3(a)", "Amd 2 §3"]);
  assert.ok(keyed.every((k) => k.content === "the Borrower may add back restructuring charges"));
});

test("terms citations: agreements and amendments only, carrying the document the comparison needs", async () => {
  const mine = await loadFacilityChunks(fakeDb({ doc_chunks: BOTH }), FACILITY_ID);
  const keyed = chunksForTermsCitations([{ citation: "Amd 2 §3(a)" }, { citation: "CC Q2 2026 §3" }, { citation: "CA §9.01" }], mine, FACILITY_ID);
  assert.deepEqual(keyed, [
    { citation: "Amd 2 §3(a)", content: "the Borrower may add back restructuring charges", doc_type: "amendment", doc_title: "Amendment No. 2" },
    { citation: "CA §9.01", content: "Notices to Harbor Logistics, Inc.", doc_type: "agreement", doc_title: "Credit Agreement" },
  ]);
});

// ------------------------------------------------------- E-3: calc_id notes

test("E-3: an id the model lists that was never logged here is flagged once; known ids are not", () => {
  const rows = [row("a"), row("b")];
  assert.deepEqual(calcIdNotes([{ calc_id: "a" }, { calc_id: "b" }], rows), []);
  const notes = calcIdNotes([{ calc_id: "a" }, { calc_id: "zzz" }, { calc_id: "zzz" }, {}, null, "a"], rows);
  assert.deepEqual(notes.map((n) => [n.layer, n.check, n.action]), [["guardrail", "calc_id_unknown", "flag"]]);
  assert.match(notes[0].detail, /zzz/);
  assert.deepEqual(calcIdNotes(undefined, rows), []);
});

// ------------------------------------- provenance of the figures WE supplied

/** Chunks shaped as `loadFacilityChunks` returns them (flat, facility_id set). */
const flat = (facility, doc_type, doc_title, section, content) => ({ facility_id: facility, doc_type, doc_title, section, content });

const PROV_CHUNKS = [
  flat(FACILITY_ID, "compliance_certificate", "Compliance Certificate — Q2 2026", "§2", "Reported Debt Service Coverage Ratio: 1.31 to 1.00."),
  flat(FACILITY_ID, "financials", "Financials — Q2 2026", "§2", "Restructuring charges: 620,000"),
  flat(OTHER_FACILITY, "compliance_certificate", "Compliance Certificate — Q2 2026", "§2", "Reported Debt Service Coverage Ratio: 9.99 to 1.00."),
];

/** A `runTest`-written row: it carries the quote and citation behind each figure. */
const TEST_CALC = {
  calc_id: "c0000000-0000-4000-8000-000000000001",
  casefile_id: null,
  test_id: TEST_ID,
  inputs: {
    reported: { dscr: 1.31, quote: "Reported Debt Service Coverage Ratio: 1.31 to 1.00.", citation: "CC Q2 2026 §2" },
    citations: {
      ebitda: { quote: "Consolidated EBITDA: 2,884,000", citation: "Fin Q2 2026 §1" },
      addbacks: { "owner compensation normalisation": { quote: "Restructuring charges: 620,000", citation: "Fin Q2 2026 §2" } },
    },
  },
  outputs: { dscr: 1.08 },
  created_at: "2026-06-30T00:00:00Z",
};

test("the borrower's reported ratio resolves to the certificate chunk that sourced it (eval blocker 7.9)", () => {
  // THE BUG THIS PINS: the brief hands the agent "the borrower reports 1.31",
  // then figure_traceable abstains on 1.31 because the certificate was never
  // in evidence. 3 of 4 misses in the 2026-10-08 live eval.
  const got = chunksForCalcProvenance([TEST_CALC], PROV_CHUNKS, FACILITY_ID);
  const cert = got.find((c) => c.citation === "CC Q2 2026 §2");
  assert.ok(cert, `certificate chunk missing: ${JSON.stringify(got)}`);
  assert.match(cert.content, /1\.31 to 1\.00/);
});

test("a financials figure the agent paraphrased is traceable through its input citation", () => {
  // F1-warm abstained on 620000 — a real figure on a real line, paraphrased
  // rather than quoted. Its provenance was in the same log row all along.
  const got = chunksForCalcProvenance([TEST_CALC], PROV_CHUNKS, FACILITY_ID);
  const fin = got.find((c) => c.citation === "Fin Q2 2026 §2");
  assert.ok(fin, "financials chunk missing");
  assert.match(fin.content, /620,000/);
});

test("provenance is facility-scoped: another borrower's certificate never resolves", () => {
  const got = chunksForCalcProvenance([TEST_CALC], PROV_CHUNKS, FACILITY_ID);
  for (const c of got) assert.doesNotMatch(c.content, /9\.99/, "leaked another facility's figure");
});

test("a calculation with no recorded provenance contributes nothing, and does not throw", () => {
  // Agent-written rows carry financial_citations, not `citations`/`reported`.
  const bare = { ...TEST_CALC, inputs: { terms: {}, financials: { ebitda: 1 } } };
  assert.deepEqual(chunksForCalcProvenance([bare], PROV_CHUNKS, FACILITY_ID), []);
  assert.deepEqual(chunksForCalcProvenance([], PROV_CHUNKS, FACILITY_ID), []);
  assert.deepEqual(chunksForCalcProvenance([{ ...bare, inputs: null }], PROV_CHUNKS, FACILITY_ID), []);
});
