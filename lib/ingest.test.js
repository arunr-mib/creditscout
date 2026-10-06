import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";

import { renderAll } from "../data/generate.mjs";
import { DocumentError } from "./pdf.ts";
import { MAX_BYTES, ingestDocument } from "./ingest.ts";

// No network and no database: Supabase is a recording fake, fetch is stubbed.

const FACILITY_ID = "11111111-1111-4111-8111-111111111111";
const EXISTING_DOC_ID = "22222222-2222-4222-8222-222222222222";
const agreement = new TextEncoder().encode(
  renderAll().find((d) => d.facility === "F1" && d.file === "agreement.txt").text,
);

function fakeClient({ facility = { id: FACILITY_ID }, existingDoc = null } = {}) {
  const writes = [];
  const from = (table) => {
    const q = { table, op: "select", filters: [] };
    const b = {
      select: () => b,
      order: () => b,
      limit: () => b,
      eq: (col, val) => (q.filters.push([col, val]), b),
      not: (...args) => ((q.not = args), b),
      insert: (row) => ((q.op = "insert"), (q.row = row), writes.push(q), b),
      delete: () => ((q.op = "delete"), writes.push(q), b),
      maybeSingle: () => Promise.resolve({ data: table === "facilities" ? facility : existingDoc, error: null }),
      then: (res, rej) => Promise.resolve({ data: null, error: null }).then(res, rej),
    };
    return b;
  };
  return { from, writes };
}

const realFetch = globalThis.fetch;
const realEnv = { ...process.env };
let embedCalls;

function stubEmbeddings({ dims = 1536, status = 200 } = {}) {
  globalThis.fetch = async (_url, init) => {
    const input = JSON.parse(init.body).input;
    embedCalls.push(input.length);
    if (status !== 200) return { ok: false, status, text: async () => "boom" };
    return {
      ok: true,
      status,
      json: async () => ({
        data: input.map((_, index) => ({ index, embedding: new Array(dims).fill(0.01) })),
      }),
    };
  };
}

beforeEach(() => {
  embedCalls = [];
  process.env.AZURE_OPENAI_ENDPOINT = "https://example.invalid/";
  process.env.AZURE_OPENAI_API_KEY = "test-key";
  process.env.AZURE_EMBEDDING_DEPLOYMENT = "text-embedding-3-small";
  stubEmbeddings();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...realEnv };
});

const input = (client, over = {}) => ({
  client,
  facilityId: FACILITY_ID,
  docType: "agreement",
  title: "Credit Agreement",
  effectiveDate: "2024-03-15",
  bytes: agreement,
  filename: "agreement.txt",
  ...over,
});

test("a new document: inserts the row, then chunks with full metadata and 1536-d embeddings", async () => {
  const client = fakeClient();
  const r = await ingestDocument(input(client));
  assert.equal(r.reused_document, false);
  assert.equal(r.chunks_created, 15);

  const [docInsert, chunkInsert] = client.writes;
  assert.equal(docInsert.table, "documents");
  assert.equal(docInsert.row.id, r.document_id);
  assert.equal(docInsert.row.source, "upload");
  assert.equal(chunkInsert.table, "doc_chunks");
  assert.equal(chunkInsert.row.length, 15);
  for (const row of chunkInsert.row) {
    assert.equal(row.document_id, r.document_id);
    assert.equal(row.embedding.length, 1536);
    assert.equal(row.metadata.facility_id, FACILITY_ID);
    assert.equal(row.metadata.document_id, r.document_id);
    assert.equal(row.metadata.doc_type, "agreement");
    assert.equal(row.metadata.doc_title, "Credit Agreement");
  }
});

test("an existing document row is reused, not duplicated, and its old chunks are replaced after the new ones land", async () => {
  const client = fakeClient({ existingDoc: { id: EXISTING_DOC_ID } });
  const r = await ingestDocument(input(client));
  assert.equal(r.reused_document, true);
  assert.equal(r.document_id, EXISTING_DOC_ID);

  assert.equal(client.writes.filter((w) => w.table === "documents").length, 0, "no documents write");
  assert.deepEqual(client.writes.map((w) => `${w.op} ${w.table}`), ["insert doc_chunks", "delete doc_chunks"]);

  const [insert, del] = client.writes;
  assert.ok(insert.row.every((row) => row.metadata.document_id === EXISTING_DOC_ID));
  assert.deepEqual(del.filters, [["document_id", EXISTING_DOC_ID]]);
  const keep = insert.row.map((row) => row.id).join(",");
  assert.deepEqual(del.not, ["id", "in", `(${keep})`], "delete spares exactly the rows just inserted");
});

test("an embedding failure writes nothing: no orphan documents row", async () => {
  stubEmbeddings({ status: 500 });
  const client = fakeClient();
  await assert.rejects(ingestDocument(input(client)), /Embedding request failed \(500\)/);
  assert.deepEqual(client.writes, []);
});

test("a wrong embedding dimension is an error, and writes nothing", async () => {
  stubEmbeddings({ dims: 3072 });
  const client = fakeClient();
  await assert.rejects(ingestDocument(input(client)), /3072 dimensions.*1536/);
  assert.deepEqual(client.writes, []);
});

test("an image-only PDF is rejected before anything is embedded or written", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]).drawRectangle({ x: 10, y: 10, width: 100, height: 100 });
  const client = fakeClient();
  await assert.rejects(
    ingestDocument(input(client, { bytes: await pdf.save(), filename: "scan.pdf" })),
    (err) => err instanceof DocumentError && /scan\.pdf/.test(err.message),
  );
  assert.deepEqual(client.writes, []);
  assert.deepEqual(embedCalls, [], "no embedding spend on a rejected file");
});

test("validation rejects before parsing: empty, oversized, bad doc_type, bad facility_id, unknown facility", async () => {
  const client = fakeClient();
  const status = async (over, c = client) => {
    try {
      await ingestDocument(input(c, over));
    } catch (err) {
      assert.ok(err instanceof DocumentError, String(err));
      return err.status;
    }
    assert.fail("expected a rejection");
  };
  assert.equal(await status({ bytes: new Uint8Array(0) }), 400);
  assert.equal(await status({ bytes: new Uint8Array(MAX_BYTES + 1) }), 413);
  assert.equal(await status({ docType: "memo" }), 400);
  assert.equal(await status({ facilityId: "F1" }), 400);
  assert.equal(await status({ title: "  " }), 400);
  assert.equal(await status({ effectiveDate: "March 2024" }), 400);
  assert.equal(await status({}, fakeClient({ facility: null })), 404);
  assert.deepEqual(client.writes, []);
  assert.deepEqual(embedCalls, []);
});

test("embeddings are requested in batches, in order", async () => {
  await ingestDocument(input(fakeClient()));
  assert.deepEqual(embedCalls, [15]);
  embedCalls = [];
  const big = new TextEncoder().encode(Array.from({ length: 40 }, (_, i) => `§${i + 1} Heading.\nBody ${i}.`).join("\n"));
  await ingestDocument(input(fakeClient(), { bytes: big }));
  assert.deepEqual(embedCalls, [16, 16, 8]);
});
