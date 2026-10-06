import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveCitation } from "../chunk.ts";
import { citationFor } from "../retrieval.ts";
import { chunksForCitations, SOURCE_DOC_TYPES, type SourceChunk } from "../terms.ts";

/**
 * The evidence the casefile guardrail judges a model's answer against, gathered
 * by code from the database — never taken from the answer itself.
 *
 * Two gathers, each with a scoping rule, and each rule is the decision that
 * defines what "traceable" means (HANDOFF 9.2: whoever chooses the scope
 * defines the truth). Neither scope is chosen by the model:
 *
 *   calcLogForCasefile   which calculations are THIS investigation's (E-1)
 *   chunksForClaims      which document text a claim is checked against (E-4),
 *                        always and only from the exception's own facility
 */

type Db = Pick<SupabaseClient, "from">;

const check = <T>(res: { data?: T | null; error: { message: string } | null }, what: string): T | null => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data ?? null;
};

export interface CalcRow {
  calc_id: string;
  casefile_id: string | null;
  test_id: string | null;
  inputs: { terms?: unknown; financials?: unknown; [k: string]: unknown };
  outputs: { dscr?: number; threshold?: number; pass?: boolean; margin?: number; [k: string]: unknown };
  created_at: string;
}

const CALC_COLUMNS = "calc_id, casefile_id, test_id, inputs, outputs, created_at";

/** Oldest first. Microseconds survive in the string where `Date.parse` drops them, so ties fall back to it. */
function byCreated(a: CalcRow, b: CalcRow): number {
  const d = Date.parse(a.created_at) - Date.parse(b.created_at);
  if (d !== 0 && Number.isFinite(d)) return d;
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
}

/**
 * THIS casefile's calculations (ruling E-1): every `calc_log` row logged against
 * the casefile, UNION the one row that produced the exception being
 * investigated. Ordered by `created_at`; the LAST row is the governing
 * calculation, the one `applyPolicy` judges and the terms comparison reads.
 *
 * WHY THE ORIGINATING ROW IS IN. `lib/tests/run.ts` writes it with
 * `casefile_id: null`, and the brief hands the model its three figures. Leaving
 * it out made an honest restatement of the brief traceable only if a prompt
 * instruction happened to force a baseline re-calculation — a prompt edit away
 * from abstaining on every run.
 *
 * WHAT IT REFUSES: every other row. Not the facility's other quarters, not
 * other terms versions, and not an older re-run of the SAME test: a test
 * re-run inserts a new `calc_log` row each time and `tests.calc_id` names the
 * current one, which is the row whose figures are on the exception. Widening in
 * any of those directions admits figures that were never part of this question
 * as "traceable", which breaks the claim rather than the product.
 *
 * `testId` comes from `exceptions.test_id`, read by the caller. Never from the model.
 */
export async function calcLogForCasefile(client: Db, casefileId: string, testId: string | null): Promise<CalcRow[]> {
  const own = (check(
    await client.from("calc_log").select(CALC_COLUMNS).eq("casefile_id", casefileId).order("created_at", { ascending: true }),
    "read calc_log for the casefile",
  ) ?? []) as CalcRow[];

  let origin: CalcRow[] = [];
  if (typeof testId === "string" && testId !== "") {
    const test = check(await client.from("tests").select("id, calc_id").eq("id", testId).maybeSingle(), "read the originating test") as
      | { id: string; calc_id: string | null }
      | null;
    if (test && typeof test.calc_id === "string" && test.calc_id !== "") {
      origin = (check(
        await client.from("calc_log").select(CALC_COLUMNS).eq("calc_id", test.calc_id).eq("test_id", testId),
        "read the originating calculation",
      ) ?? []) as CalcRow[];
    }
  }

  const seen = new Set<string>();
  const out: CalcRow[] = [];
  for (const row of [...origin, ...own]) {
    if (!row || typeof row.calc_id !== "string" || seen.has(row.calc_id)) continue;
    seen.add(row.calc_id);
    out.push(row);
  }
  return out.sort(byCreated);
}

/** A chunk as the evidence gathers use it: the stored text, with the citation the retrieval layer labels it with. */
export interface FacilityChunk extends SourceChunk {
  facility_id: string;
}

/**
 * Every chunk on file for ONE facility, every document type.
 *
 * The query filters by the facility AND the rows are filtered again in memory.
 * The second filter costs nothing and is the one a test can pin: a chunk from
 * another facility never reaches the guardrail, whatever the query layer does.
 * Cross-facility evidence is the worst bug available in this system — a
 * borrower's confidential agreement verifying another borrower's casefile.
 */
export async function loadFacilityChunks(client: Db, facilityId: string): Promise<FacilityChunk[]> {
  const rows = (check(
    await client.from("doc_chunks").select("content, metadata").eq("metadata->>facility_id", facilityId),
    "read doc_chunks",
  ) ?? []) as { content: string; metadata: { facility_id?: string; doc_type?: string; doc_title?: string; section?: string | null } | null }[];
  return rows
    .filter((r) => r.metadata?.facility_id === facilityId && typeof r.content === "string")
    .map((r) => ({
      facility_id: facilityId,
      content: r.content,
      doc_type: r.metadata?.doc_type ?? null,
      doc_title: r.metadata?.doc_title ?? null,
      section: r.metadata?.section ?? null,
      citation: citationFor(r.metadata?.doc_type ?? null, r.metadata?.doc_title ?? null, r.metadata?.section ?? null),
    }));
}

/**
 * The chunk text behind each claim, keyed by the claim's citation AS WRITTEN
 * (ruling E-4).
 *
 * `guardrail.js` matches a claim's citation as an exact trimmed string, and the
 * definition agent is told to write sub-clauses (`CA §7.11(a)`) where a chunk is
 * a whole section (`CA §7.11`). The guardrail is not changed and the resolver
 * stays outside the import-free file: each citation is resolved with
 * `resolveCitation`, the chunk is found by (document title, section) among THIS
 * facility's chunks, and the map handed to the guardrail is keyed by the
 * original string, so it already matches.
 *
 * This is `chunksForCitations` from `lib/terms.ts` — the same function the
 * boarding path uses, reused rather than mirrored, because its signature takes
 * any `[{citation}]` and a claim is one.
 *
 * A citation that resolves to no document (`CA PREAMBLE`, a bare `§7.11`) gets
 * no chunk, and the guardrail removes the claim. That is deferred D-2, and it
 * stays fail-closed.
 */
export function chunksForClaims(claims: unknown, chunks: readonly FacilityChunk[], facilityId: string): { citation: string; content: string }[] {
  return chunksForCitations(claims, chunks.filter((c) => c.facility_id === facilityId));
}

/**
 * The chunks behind the definition agent's source citations, for the terms
 * comparison (`guardrails/terms-drift.js`): agreements and amendments only,
 * keyed like `chunksForClaims`, and carrying the document type and title the
 * comparison needs (a term can only be granted by an agreement or an amendment,
 * and an amendment's date must be read in THAT amendment).
 *
 * `chunksForCitations` drops both fields, so they are restored from the
 * citation it matched on: it only maps a citation to a chunk whose title and
 * section `resolveCitation` produced, so the resolved title IS the chunk's.
 */
export function chunksForTermsCitations(
  sourceCitations: unknown,
  chunks: readonly FacilityChunk[],
  facilityId: string,
): { citation: string; content: string; doc_type: string | null; doc_title: string | null }[] {
  const sources = chunks.filter(
    (c) => c.facility_id === facilityId && (SOURCE_DOC_TYPES as readonly string[]).includes(c.doc_type ?? ""),
  );
  return chunksForCitations(sourceCitations, sources).map((k) => {
    const r = resolveCitation(k.citation);
    const doc = sources.find((c) => c.doc_title === r.doc_title && c.section === r.section);
    return { ...k, doc_type: doc?.doc_type ?? null, doc_title: doc?.doc_title ?? null };
  });
}

/**
 * `calc_id`s the MODEL listed that are not among the rows this casefile's
 * evidence was gathered from (ruling E-3). The model's array is never
 * authoritative — `casefiles.calc_ids` is written from the rows — so an id it
 * made up, or copied from somewhere else, is recorded for the analyst rather
 * than believed or crashed on.
 */
export function calcIdNotes(calculations: unknown, rows: readonly CalcRow[]): { layer: string; check: string; action: string; detail: string }[] {
  const known = new Set(rows.map((r) => r.calc_id));
  const listed = Array.isArray(calculations) ? calculations : [];
  const unknown = [
    ...new Set(
      listed
        .map((c) => (typeof c === "object" && c !== null ? (c as { calc_id?: unknown }).calc_id : undefined))
        .filter((id): id is string => typeof id === "string" && !known.has(id)),
    ),
  ];
  return unknown.map((id) => ({
    layer: "guardrail",
    check: "calc_id_unknown",
    action: "flag",
    detail: `the answer lists calc_id ${id}, which is not a calculation logged for this casefile or the test that raised it; the calc_ids shown come from the log, not from the answer`,
  }));
}
