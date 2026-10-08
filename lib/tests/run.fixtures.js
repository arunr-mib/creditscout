import { FACILITIES, boardedVersionFor, termsFor } from "../../data/facilities.js";
import { renderDocument } from "../../data/generate.mjs";
import { chunkBySection } from "../chunk.ts";
import { citationFor } from "../retrieval.ts";

// Shared by the stage-7 tests. No network and no database: documents come from
// the generator, the search is a fake over them, and the database is in memory.

export const facility = (id) => FACILITIES.find((f) => f.id === id);
export const quarter = (id, periodEnd) => facility(id).quarters.find((q) => q.period_end === periodEnd);

export const FACILITY_UUID = {
  F1: "b0c54d3f-aa3d-4c02-af90-cbaff0490f60",
  F3: "bddbabec-8625-4a05-8a55-4d02955c7b8d",
  F5: "619d51ba-737c-4289-8f5a-ca288d129cc3",
  F7: "3f7a1c08-5e2b-4d91-9c43-2a6b8e0d7415",
  F8: "8c21d5e7-6b94-4a30-bf15-07d9a3c6e812",
  F9: "d4e9b602-91af-4c57-a8e3-5b17c2f80d96",
};

/** Every chunk of a facility's documents, shaped like `searchDocuments` hits. */
export function hitsFor(id, { mutate } = {}) {
  const f = facility(id);
  const out = [];
  for (const doc of f.documents) {
    let text = renderDocument(f, doc);
    if (mutate) text = mutate(text, doc);
    for (const { content, metadata } of chunkBySection(text, {
      facility_id: FACILITY_UUID[id],
      document_id: doc.file,
      doc_type: doc.doc_type,
      doc_title: doc.title,
    })) {
      out.push({
        content,
        citation: citationFor(metadata.doc_type, metadata.doc_title, metadata.section),
        section: metadata.section,
        doc_title: metadata.doc_title,
        doc_type: metadata.doc_type,
        score: 0.5,
      });
    }
  }
  return out;
}

/** A `searchDocuments` stand-in that honours the doc_types filter and records what it was asked. */
export function fakeSearch(hits) {
  const calls = [];
  const search = async (input) => {
    calls.push(input);
    const types = input.docTypes ?? null;
    return hits.filter((h) => types === null || types.includes(h.doc_type));
  };
  search.calls = calls;
  return search;
}

/** An approved terms row carrying the version the facility has BOARDED for that quarter. */
export function approvedRow(id, periodEnd, over = {}) {
  const q = quarter(id, periodEnd);
  const version = boardedVersionFor(facility(id), q);
  return {
    id: `terms-${id}-v${version.version}`,
    facility_id: FACILITY_UUID[id],
    version: version.version,
    effective_from: version.effective_from,
    effective_to: null,
    terms: termsFor(version, q),
    source_citations: [],
    status: "approved",
    approved_by: "analyst",
    approved_at: "2026-10-05T00:00:00Z",
    ...over,
  };
}

// ----------------------------------------------------------------- in-memory db

/**
 * Just enough of the supabase-js query builder for runTest: select / insert /
 * upsert / update with `eq`, `limit`, `single` and `maybeSingle`. Rows in
 * tables with an `id` column get one assigned, as Postgres would.
 */
export function fakeDb({ tolerance = 0.05, failOn = {} } = {}) {
  const tables = {
    policy: tolerance === null ? [] : [{ key: "variance_tolerance", value: tolerance }],
    tests: [],
    calc_log: [],
    exceptions: [],
    casefiles: [],
  };
  const hasId = new Set(["tests", "exceptions"]);
  let counter = 0;
  const log = [];

  function builder(name) {
    const st = { op: "select", filters: [], payload: null, onConflict: null, returning: false, mode: "many" };
    const b = {
      select() { if (st.op !== "select") st.returning = true; return b; },
      insert(p) { st.op = "insert"; st.payload = p; return b; },
      upsert(p, o) { st.op = "upsert"; st.payload = p; st.onConflict = o?.onConflict; return b; },
      update(p) { st.op = "update"; st.payload = p; return b; },
      eq(col, val) { st.filters.push([col, val]); return b; },
      limit() { return b; },
      single() { st.mode = "single"; return b; },
      maybeSingle() { st.mode = "maybe"; return b; },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };
    const match = (row) => st.filters.every(([c, v]) => row[c] === v);
    function shape(rows) {
      if (st.mode === "many") return { data: rows, error: null };
      if (st.mode === "maybe") return { data: rows[0] ?? null, error: null };
      return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: `expected one row, got ${rows.length}` } };
    }
    function run() {
      log.push({ table: name, op: st.op });
      if (failOn[name] === st.op) return { data: null, error: { message: `forced ${name}.${st.op} failure` } };
      const rows = tables[name];
      if (st.op === "select") return shape(rows.filter(match).map((r) => ({ ...r })));
      if (st.op === "insert") {
        const row = { ...st.payload };
        if (hasId.has(name)) row.id = `${name}-${++counter}`;
        if (name === "exceptions") row.status ??= "new"; // the column default
        rows.push(row);
        return st.returning ? shape([{ ...row }]) : { data: null, error: null };
      }
      if (st.op === "upsert") {
        const cols = st.onConflict.split(",");
        const existing = rows.find((r) => cols.every((c) => r[c] === st.payload[c]));
        if (existing) Object.assign(existing, st.payload);
        else rows.push({ ...st.payload, id: `${name}-${++counter}` });
        const row = existing ?? rows[rows.length - 1];
        return st.returning ? shape([{ ...row }]) : { data: null, error: null };
      }
      if (st.op === "update") {
        rows.filter(match).forEach((r) => Object.assign(r, st.payload));
        return { data: null, error: null };
      }
      throw new Error(`fakeDb: unsupported op ${st.op}`);
    }
    return b;
  }

  return { tables, log, from: builder };
}
