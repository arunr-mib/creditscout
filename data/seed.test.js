import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { FACILITIES } from "./facilities.js";
import { SEED_APPROVER, seedFacilities } from "./seed.mjs";

/** Minimal in-memory stand-in for the slice of the Supabase client the seed uses. */
function fakeClient() {
  const tables = { facilities: [], documents: [], covenant_terms: [] };
  let n = 0;
  return {
    tables,
    from(table) {
      const filters = [];
      return {
        select() {
          return this;
        },
        eq(k, v) {
          filters.push([k, v]);
          return this;
        },
        async maybeSingle() {
          const rows = tables[table].filter((r) => filters.every(([k, v]) => r[k] === v));
          return { data: rows[0] ?? null, error: null };
        },
        insert(row) {
          const stored = { id: `id-${(n += 1)}`, ...row };
          tables[table].push(stored);
          return {
            select: () => ({ single: async () => ({ data: { id: stored.id }, error: null }) }),
          };
        },
      };
    },
  };
}

const NOW = "2026-10-05T00:00:00.000Z";

test("seed inserts 3 facilities, 16 documents and only the 3 boarded terms rows", async () => {
  const client = fakeClient();
  const created = await seedFacilities(client, { now: NOW });
  assert.deepEqual(created, { facilities: 3, documents: 16, covenant_terms: 3 });
  assert.deepEqual(client.tables.facilities.map((r) => r.borrower_name), [
    "Harbor Logistics", "Northgate Foods", "Coastal Marine",
  ]);
});

test("seed never boards an amendment: every covenant_terms row is v1, approved, with approver and time", async () => {
  const client = fakeClient();
  await seedFacilities(client, { now: NOW });
  const rows = client.tables.covenant_terms;
  assert.equal(rows.length, 3);
  for (const r of rows) {
    assert.equal(r.version, 1);
    assert.equal(r.status, "approved");
    assert.equal(r.approved_by, SEED_APPROVER);
    assert.equal(r.approved_at, NOW);
    assert.deepEqual(r.terms.effective_amendments, [], "a boarded v1 mentions no amendment");
  }
  assert.deepEqual(rows.map((r) => r.effective_from), ["2024-03-15", "2023-09-20", "2024-08-01"]);
  // The amendment documents are on file even though their terms are not.
  assert.equal(client.tables.documents.filter((d) => d.doc_type === "amendment").length, 2);
});

test("seed writes documents with the schema's columns and effective dates", async () => {
  const client = fakeClient();
  await seedFacilities(client, { now: NOW });
  const waiver = client.tables.documents.find((d) => d.doc_type === "waiver");
  assert.equal(waiver.title, "Waiver Request Letter — unexecuted");
  assert.equal(waiver.effective_date, "2026-08-12");
  const f1 = client.tables.facilities.find((r) => r.borrower_name === "Harbor Logistics");
  assert.equal(client.tables.documents.filter((d) => d.facility_id === f1.id).length, 4);
  assert.equal(f1.sender_domain, "harborlogistics.example");
});

test("seed is idempotent: a second run creates nothing", async () => {
  const client = fakeClient();
  await seedFacilities(client, { now: NOW });
  const again = await seedFacilities(client, { now: NOW });
  assert.deepEqual(again, { facilities: 0, documents: 0, covenant_terms: 0 });
  assert.equal(client.tables.facilities.length, 3);
  assert.equal(client.tables.documents.length, 16);
  assert.equal(client.tables.covenant_terms.length, 3);
});

test("seed surfaces a database error instead of swallowing it", async () => {
  const client = fakeClient();
  client.from = () => ({
    select() { return this; },
    eq() { return this; },
    maybeSingle: async () => ({ data: null, error: { message: "boom" } }),
  });
  await assert.rejects(seedFacilities(client, { facilities: FACILITIES }), /select facilities: boom/);
});

test("the CLI exits with a clear error when the Supabase env vars are missing", () => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL("./seed.mjs", import.meta.url))], {
    env: { PATH: process.env.PATH },
    encoding: "utf8",
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set/);
});
