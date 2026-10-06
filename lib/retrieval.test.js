import { test } from "node:test";
import assert from "node:assert/strict";

import { FACILITIES } from "../data/facilities.js";
import { renderDocument } from "../data/generate.mjs";
import { chunkBySection, resolveCitation } from "./chunk.ts";
import {
  DEFAULT_K,
  DEFAULT_RUN_ID,
  DOC_TYPES,
  InputError,
  MAX_K,
  citationFor,
  searchDocuments,
  searchPastCases,
} from "./retrieval.ts";

// No network and no database: the embedder and the Supabase client are fakes
// that record what they were asked. What these tests pin is WHAT IS ASKED of
// the SQL functions; that the functions answer correctly is checked live.

const FACILITY_A = "11111111-1111-4111-8111-111111111111";
const VECTOR = [0.5, 0.25];

function fakes({ rows = [], error = null } = {}) {
  const rpcCalls = [];
  const embedCalls = [];
  return {
    rpcCalls,
    embedCalls,
    deps: {
      embed: async (texts) => (embedCalls.push(texts), texts.map(() => VECTOR)),
      client: {
        rpc: async (name, args) => (rpcCalls.push({ name, args }), { data: rows, error }),
      },
    },
  };
}

const rejects = (promise, pattern) => assert.rejects(promise, (e) => e instanceof InputError && pattern.test(e.message));

// ======================================================== searchDocuments: the RPC contract

test("searchDocuments embeds the query once and calls match_doc_chunks with the facility, k and types", async () => {
  const { deps, rpcCalls, embedCalls } = fakes();
  await searchDocuments(
    { facilityId: FACILITY_A, query: "  debt service coverage ratio minimum ", docTypes: ["agreement"], k: 5 },
    deps,
  );
  assert.deepEqual(embedCalls, [["debt service coverage ratio minimum"]]);
  assert.deepEqual(rpcCalls, [
    {
      name: "match_doc_chunks",
      args: { query_embedding: VECTOR, p_facility_id: FACILITY_A, match_count: 5, p_doc_types: ["agreement"] },
    },
  ]);
});

test("doc_types reaches the RPC, and with none given p_doc_types is null (no filter)", async () => {
  for (const docTypes of [undefined, null, []]) {
    const { deps, rpcCalls } = fakes();
    await searchDocuments({ facilityId: FACILITY_A, query: "q", docTypes }, deps);
    assert.equal(rpcCalls[0].args.p_doc_types, null);
  }
  const { deps, rpcCalls } = fakes();
  await searchDocuments({ facilityId: FACILITY_A, query: "q", docTypes: ["agreement", "amendment", "agreement"] }, deps);
  assert.deepEqual(rpcCalls[0].args.p_doc_types, ["agreement", "amendment"]);
});

test("an unknown doc_type is rejected, not silently matched to nothing", async () => {
  const { deps, rpcCalls } = fakes();
  await rejects(searchDocuments({ facilityId: FACILITY_A, query: "q", docTypes: ["agreemnet"] }, deps), /doc_types/);
  await rejects(searchDocuments({ facilityId: FACILITY_A, query: "q", docTypes: "agreement" }, deps), /doc_types/);
  await rejects(searchDocuments({ facilityId: FACILITY_A, query: "q", docTypes: [7] }, deps), /doc_types/);
  assert.equal(rpcCalls.length, 0);
});

test("every doc_type the schema allows is accepted", async () => {
  const { deps, rpcCalls } = fakes();
  await searchDocuments({ facilityId: FACILITY_A, query: "q", docTypes: [...DOC_TYPES] }, deps);
  assert.deepEqual(rpcCalls[0].args.p_doc_types, [...DOC_TYPES]);
  assert.deepEqual([...DOC_TYPES].sort(), ["agreement", "amendment", "compliance_certificate", "financials", "waiver"]);
});

test("k defaults to 8, and a huge k is capped but never removes the facility filter", async () => {
  const a = fakes();
  await searchDocuments({ facilityId: FACILITY_A, query: "q" }, a.deps);
  assert.equal(a.rpcCalls[0].args.match_count, DEFAULT_K);
  assert.equal(DEFAULT_K, 8);

  for (const k of [MAX_K + 1, 1000, 1e9, Number.MAX_SAFE_INTEGER]) {
    const b = fakes();
    await searchDocuments({ facilityId: FACILITY_A, query: "q", docTypes: [], k }, b.deps);
    assert.equal(b.rpcCalls[0].args.match_count, MAX_K);
    assert.equal(b.rpcCalls[0].args.p_facility_id, FACILITY_A);
  }
});

test("k must be a positive integer", async () => {
  const { deps, rpcCalls } = fakes();
  for (const k of [0, -1, 1.5, "8", NaN, Infinity, true, {}]) {
    await rejects(searchDocuments({ facilityId: FACILITY_A, query: "q", k }, deps), /k must/);
  }
  assert.equal(rpcCalls.length, 0);
});

test("a malformed facility_id is rejected BEFORE anything is embedded or queried: never an unfiltered search", async () => {
  const bad = [
    undefined,
    null,
    "",
    "   ",
    "not-a-uuid",
    FACILITY_A + "x",
    "x" + FACILITY_A,
    FACILITY_A.slice(1),
    `${FACILITY_A}' or '1'='1`,
    "*",
    "%",
    [FACILITY_A],
    { id: FACILITY_A },
    42,
  ];
  for (const facilityId of bad) {
    const { deps, rpcCalls, embedCalls } = fakes();
    await rejects(searchDocuments({ facilityId, query: "q" }, deps), /facility_id/);
    assert.equal(rpcCalls.length, 0, `facility_id ${JSON.stringify(facilityId)} reached the database`);
    assert.equal(embedCalls.length, 0, `facility_id ${JSON.stringify(facilityId)} reached the embedder`);
  }
});

test("a missing, blank or oversized query is rejected", async () => {
  const { deps, rpcCalls } = fakes();
  for (const query of [undefined, null, "", "   ", 7, ["q"], "q".repeat(2001)]) {
    await rejects(searchDocuments({ facilityId: FACILITY_A, query }, deps), /query/);
  }
  assert.equal(rpcCalls.length, 0);
});

test("a database error is thrown (a 500), not returned as an empty result", async () => {
  const { deps } = fakes({ error: { message: "boom" } });
  await assert.rejects(searchDocuments({ facilityId: FACILITY_A, query: "q" }, deps), (e) => {
    return !(e instanceof InputError) && /match_doc_chunks: boom/.test(e.message);
  });
});

test("every searchDocuments call passes the SAME requested facility to the RPC, whatever else varies", async () => {
  const FACILITY_B = "22222222-2222-4222-8222-222222222222";
  for (const facilityId of [FACILITY_A, FACILITY_B]) {
    for (const docTypes of [undefined, [], ["agreement"], [...DOC_TYPES]]) {
      for (const k of [undefined, 1, 8, MAX_K, 10_000]) {
        const { deps, rpcCalls } = fakes();
        await searchDocuments({ facilityId, query: "q", docTypes, k }, deps);
        assert.equal(rpcCalls.length, 1);
        assert.equal(rpcCalls[0].name, "match_doc_chunks");
        assert.equal(rpcCalls[0].args.p_facility_id, facilityId);
      }
    }
  }
});

// ======================================================== searchDocuments: the response

test("maps rows to {content, citation, section, doc_title, doc_type, score}", async () => {
  const { deps } = fakes({
    rows: [
      {
        id: "x",
        document_id: "d",
        content: "§7.11 Financial Covenant ...",
        doc_title: "Credit Agreement",
        section: "§7.11",
        doc_type: "agreement",
        similarity: 0.83,
      },
    ],
  });
  const hits = await searchDocuments({ facilityId: FACILITY_A, query: "q" }, deps);
  assert.deepEqual(hits, [
    {
      content: "§7.11 Financial Covenant ...",
      citation: "CA §7.11",
      section: "§7.11",
      doc_title: "Credit Agreement",
      doc_type: "agreement",
      score: 0.83,
    },
  ]);
});

test("no rows is an empty array", async () => {
  assert.deepEqual(await searchDocuments({ facilityId: FACILITY_A, query: "q" }, fakes({ rows: [] }).deps), []);
  assert.deepEqual(await searchDocuments({ facilityId: FACILITY_A, query: "q" }, fakes({ rows: null }).deps), []);
});

// ======================================================== citations

test("every agreement and amendment chunk in the corpus gets a citation resolveCitation parses back to it", () => {
  let checked = 0;
  for (const facility of FACILITIES) {
    for (const doc of facility.documents) {
      if (doc.doc_type !== "agreement" && doc.doc_type !== "amendment") continue;
      const title = doc.title;
      const chunks = chunkBySection(renderDocument(facility, doc), {
        facility_id: "f",
        document_id: "d",
        doc_type: doc.doc_type,
        doc_title: title,
      });
      for (const { metadata } of chunks) {
        if (!metadata.section || metadata.section === "PREAMBLE") continue; // not a citable section
        const citation = citationFor(metadata.doc_type, metadata.doc_title, metadata.section);
        assert.deepEqual(
          resolveCitation(citation),
          { doc_type: metadata.doc_type, doc_title: metadata.doc_title, section: metadata.section },
          `${facility.id} ${title} ${metadata.section} -> "${citation}"`,
        );
        checked += 1;
      }
    }
  }
  assert.ok(checked > 20, `expected to check the whole corpus, checked ${checked}`);
});

test("the corpus vocabulary: CA §7.11, Amd 2 §3, and ARTICLE headings", () => {
  assert.equal(citationFor("agreement", "Credit Agreement", "§7.11"), "CA §7.11");
  assert.equal(citationFor("amendment", "Amendment No. 2", "§3"), "Amd 2 §3");
  assert.equal(citationFor("agreement", "Credit Agreement", "ARTICLE VII"), "CA ARTICLE VII");
  assert.deepEqual(resolveCitation("Amd 2 §3"), { doc_type: "amendment", doc_title: "Amendment No. 2", section: "§3" });
});

test("citations are unique within a facility, so the guardrail's exact-string match cannot pick the wrong chunk", () => {
  for (const facility of FACILITIES) {
    const seen = new Map();
    for (const doc of facility.documents) {
      const title = doc.title;
      for (const { metadata } of chunkBySection(renderDocument(facility, doc), {
        facility_id: "f",
        document_id: doc.file,
        doc_type: doc.doc_type,
        doc_title: title,
      })) {
        if (!metadata.section) continue;
        const citation = citationFor(metadata.doc_type, metadata.doc_title, metadata.section);
        assert.ok(!seen.has(citation), `${facility.id}: "${citation}" cites both ${seen.get(citation)} and ${doc.file}`);
        seen.set(citation, doc.file);
      }
    }
  }
});

test("a document with no prefix in the resolveCitation vocabulary is cited by its full title", () => {
  assert.equal(citationFor("financials", "Financials — Q2 2026", "§1"), "Financials — Q2 2026 §1");
  assert.equal(citationFor("agreement", "Credit Agreement", null), "CA");
  assert.equal(citationFor(null, null, "§1"), "§1");
});

// ======================================================== searchPastCases

test("searchPastCases calls match_lessons with run_id 'demo' by default and NO facility filter", async () => {
  const { deps, rpcCalls, embedCalls } = fakes();
  await searchPastCases({ facilityId: FACILITY_A, exceptionProfile: "reported 1.12 vs required 1.25" }, deps);
  assert.deepEqual(embedCalls, [["reported 1.12 vs required 1.25"]]);
  assert.deepEqual(rpcCalls, [
    { name: "match_lessons", args: { query_embedding: VECTOR, p_run_id: DEFAULT_RUN_ID, match_count: 3 } },
  ]);
  assert.equal(DEFAULT_RUN_ID, "demo");
  // Memory crosses facilities on purpose; the facility is context, never a filter.
  assert.ok(!("p_facility_id" in rpcCalls[0].args));
});

test("run_id IS a filter: it reaches the RPC", async () => {
  const { deps, rpcCalls } = fakes();
  await searchPastCases({ facilityId: FACILITY_A, exceptionProfile: "p", runId: "eval-cold-1", k: 5 }, deps);
  assert.equal(rpcCalls[0].args.p_run_id, "eval-cold-1");
  assert.equal(rpcCalls[0].args.match_count, 5);
});

test("searchPastCases returns [] on an empty corpus", async () => {
  assert.deepEqual(await searchPastCases({ facilityId: FACILITY_A, exceptionProfile: "p" }, fakes({ rows: [] }).deps), []);
  assert.deepEqual(await searchPastCases({ facilityId: FACILITY_A, exceptionProfile: "p" }, fakes({ rows: null }).deps), []);
});

test("searchPastCases maps rows to {lesson_text, pattern_tag, case_summary, similarity}", async () => {
  const row = { lesson_text: "L", pattern_tag: "amendment_addback", case_summary: "S", similarity: 0.7, extra: "dropped" };
  const hits = await searchPastCases({ facilityId: FACILITY_A, exceptionProfile: "p" }, fakes({ rows: [row] }).deps);
  assert.deepEqual(hits, [{ lesson_text: "L", pattern_tag: "amendment_addback", case_summary: "S", similarity: 0.7 }]);
});

test("searchPastCases rejects bad input before embedding", async () => {
  const { deps, rpcCalls, embedCalls } = fakes();
  await rejects(searchPastCases({ facilityId: "nope", exceptionProfile: "p" }, deps), /facility_id/);
  await rejects(searchPastCases({ facilityId: FACILITY_A, exceptionProfile: "" }, deps), /exception_profile/);
  await rejects(searchPastCases({ facilityId: FACILITY_A, exceptionProfile: "p", k: 0 }, deps), /k must/);
  await rejects(searchPastCases({ facilityId: FACILITY_A, exceptionProfile: "p", runId: "" }, deps), /run_id/);
  assert.equal(rpcCalls.length + embedCalls.length, 0);
});
