// Shared by lib/terms.test.js and lib/agent/tools/definition-agent.test.js.
// Not a test file (no .test.js), so `npm test` does not run it.
//
// Chunks are the REAL generated documents run through the real chunker, so a
// citation here resolves exactly as it does against the database.

import { FACILITIES, clauses } from "../data/facilities.js";
import { renderDocument } from "../data/generate.mjs";
import { chunkBySection } from "./chunk.ts";
import { citationFor } from "./retrieval.ts";

export const FACILITY_ID = { F1: "11111111-1111-4111-8111-111111111111", F3: "33333333-3333-4333-8333-333333333333", F5: "55555555-5555-4555-8555-555555555555" };
export const facility = (id) => FACILITIES.find((f) => f.id === id);

/** doc_chunks rows for one facility: every document, including the ones that must never source terms. */
export function chunkRows(f) {
  return f.documents.flatMap((doc) =>
    chunkBySection(renderDocument(f, doc), {
      facility_id: FACILITY_ID[f.id],
      document_id: doc.file,
      doc_type: doc.doc_type,
      doc_title: doc.title,
    }).map((c) => ({ content: c.content, metadata: c.metadata })),
  );
}

/** What searchDocuments returns, optionally filtered by doc type. */
export function hitsFor(f, docTypes = null) {
  return chunkRows(f)
    .filter((r) => !docTypes || docTypes.includes(r.metadata.doc_type))
    .map((r) => ({
      content: r.content,
      citation: citationFor(r.metadata.doc_type, r.metadata.doc_title, r.metadata.section),
      section: r.metadata.section,
      doc_title: r.metadata.doc_title,
      doc_type: r.metadata.doc_type,
      // loadSourceChunks brings this along from `documents`; precedence between two
      // documents defining the same term is decided by date, so the fixture must too.
      effective_date: f.documents.find((d) => d.title === r.metadata.doc_title)?.effective_date ?? null,
      score: 0.9,
    }));
}

/** The fixture's terms and citations for a version, as the agent would return them (no `file`, null period). */
export function proposalFor(f, version) {
  const v = f.terms_versions.find((x) => x.version === version);
  const terms = structuredClone(v.terms);
  terms.test_period.period_end = null;
  return {
    terms,
    source_citations: v.source_citations.map(({ field, citation, quote }) => ({ field, citation, quote })),
  };
}

export { clauses };

// ------------------------------------------------------- in-memory Supabase

const UNIQUE = { code: "23505", message: "duplicate key value violates unique constraint" };
const CHECK = { code: "23514", message: "new row violates check constraint" };

/** Reads `metadata->>facility_id` style columns. */
const read = (row, col) => {
  const m = /^(\w+)->>(\w+)$/.exec(col);
  return m ? row[m[1]]?.[m[2]] : row[col];
};

/**
 * Just enough of the Supabase client for lib/terms.ts, enforcing the schema's
 * constraints on covenant_terms so a write that production would reject fails
 * here too: UNIQUE (facility_id, version), the one-approved-row-per-facility
 * partial index of migration 0007, the status enum, NOT NULL effective_from, and
 * "approved needs approved_by and approved_at".
 *
 * `writes` records every insert and update, so a test can assert that a refusal
 * wrote NOTHING. `beforeWrite` lets a test slip a conflicting row in first.
 */
export function fakeDb({ facilityKey = "F3", covenant_terms = [], beforeWrite = null } = {}) {
  const f = facility(facilityKey);
  const tables = {
    covenant_terms: covenant_terms.map((r) => structuredClone(r)),
    doc_chunks: chunkRows(f),
    documents: f.documents.map((d) => ({ facility_id: FACILITY_ID[facilityKey], doc_type: d.doc_type, title: d.title, effective_date: d.effective_date })),
  };
  const writes = [];
  let n = 0;

  const validate = (row, others) => {
    if (row.effective_from == null) return CHECK;
    if (!["proposed", "approved", "superseded"].includes(row.status)) return CHECK;
    if (row.status === "approved" && (row.approved_by == null || row.approved_at == null)) return CHECK;
    if (others.some((o) => o.facility_id === row.facility_id && o.version === row.version)) return UNIQUE;
    // supabase/migrations/0007: at most one approved row per facility.
    if (row.status === "approved" && others.some((o) => o.facility_id === row.facility_id && o.status === "approved")) {
      return { ...UNIQUE, message: 'duplicate key value violates unique constraint "covenant_terms_one_approved_per_facility"' };
    }
    return null;
  };

  function from(table) {
    const filters = [];
    let op = "select";
    let patch = null;
    let order = null;
    let single = null;
    let projection = null;

    const matches = (r) =>
      filters.every(([kind, col, val]) => {
        const v = read(r, col);
        if (kind === "eq") return v === val;
        if (kind === "neq") return v !== val;
        if (kind === "in") return val.includes(v);
        if (kind === "lte") return v <= val;
        return true;
      });

    const execute = () => {
      const rows = tables[table];
      if (op === "insert") {
        beforeWrite?.({ table, op, tables });
        const row = { id: `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`, effective_to: null, approved_by: null, approved_at: null, ...patch };
        const err = table === "covenant_terms" ? validate(row, rows) : null;
        if (err) return { data: null, error: err };
        writes.push({ table, op, row: structuredClone(row) });
        rows.push(row);
        return { data: [row], error: null };
      }
      if (op === "update") {
        beforeWrite?.({ table, op, tables });
        const hit = rows.filter(matches);
        const updated = [];
        for (const r of hit) {
          const next = { ...r, ...patch };
          const err = table === "covenant_terms" ? validate(next, rows.filter((o) => o !== r)) : null;
          if (err) return { data: null, error: err };
          updated.push([r, next]);
        }
        for (const [r, next] of updated) {
          writes.push({ table, op, id: r.id, patch: structuredClone(patch) });
          Object.assign(r, next);
        }
        return { data: updated.map(([r]) => r), error: null };
      }
      let out = rows.filter(matches);
      if (order) out = [...out].sort((a, b) => (a[order.col] < b[order.col] ? 1 : -1) * (order.ascending ? -1 : 1));
      return { data: out, error: null };
    };

    const finish = () => {
      const { data, error } = execute();
      if (error) return { data: null, error };
      const shaped = (data ?? []).map((r) => (projection ? Object.fromEntries(projection.map((c) => [c, r[c]])) : r));
      if (single === "single") return shaped.length === 1 ? { data: structuredClone(shaped[0]), error: null } : { data: null, error: { message: "expected one row" } };
      if (single === "maybe") return { data: shaped[0] ? structuredClone(shaped[0]) : null, error: null };
      return { data: structuredClone(shaped), error: null };
    };

    const q = {
      select(cols) {
        // Reads return whole rows (a superset of what is asked). A select after a write is a projection.
        if (op !== "select" && typeof cols === "string" && cols.trim() !== "*") projection = cols.split(",").map((c) => c.trim());
        return q;
      },
      insert(row) { op = "insert"; patch = row; return q; },
      update(p) { op = "update"; patch = p; return q; },
      eq(col, val) { filters.push(["eq", col, val]); return q; },
      neq(col, val) { filters.push(["neq", col, val]); return q; },
      in(col, val) { filters.push(["in", col, val]); return q; },
      lte(col, val) { filters.push(["lte", col, val]); return q; },
      order(col, o) { order = { col, ascending: o?.ascending !== false }; return q; },
      single() { single = "single"; return q; },
      maybeSingle() { single = "maybe"; return q; },
      then(resolve, reject) { return Promise.resolve().then(finish).then(resolve, reject); },
    };
    return q;
  }

  return { from, tables, writes };
}

/** A proposed covenant_terms row as the propose route stores it. */
export function proposedRow({ facilityKey = "F3", id, version = 1, version_of = 1, effective_from, terms, source_citations, status = "proposed", extra = {} }) {
  const f = facility(facilityKey);
  const p = proposalFor(f, version_of);
  return {
    id,
    facility_id: FACILITY_ID[facilityKey],
    version,
    effective_from: effective_from ?? f.terms_versions.find((x) => x.version === version_of).effective_from,
    effective_to: null,
    terms: terms ?? p.terms,
    source_citations: source_citations ?? p.source_citations,
    status,
    approved_by: null,
    approved_at: null,
    ...extra,
  };
}
