import type { SupabaseClient } from "@supabase/supabase-js";
import { embed as embedTexts } from "./embed.ts";
import { DOC_TYPES } from "./ingest.ts";

/**
 * The Supabase side of the agent's two search tools.
 *
 * The two searches are deliberately OPPOSITE on scope, which looks like an
 * inconsistency when read side by side and is not:
 *
 *   searchDocuments   is filtered to ONE facility. A document chunk is one
 *                     borrower's confidential agreement; returning it in another
 *                     borrower's casefile is the worst bug available here.
 *   searchPastCases   is NOT filtered by facility. A lesson is the lender's own
 *                     accumulated judgement, and the whole memory effect is that
 *                     an override on one borrower (F1) speeds up the next (F5).
 *                     `facility_id` is context only. What it IS filtered by is
 *                     `run_id`, so a cold eval pass never sees warm lessons.
 *
 * Both filters live inside their SQL function (match_doc_chunks,
 * match_lessons), so a caller cannot forget one. Never hand-roll the query.
 */

export { DOC_TYPES };

export const DEFAULT_K = 8;
/** Beyond this a caller is not retrieving evidence, it is dumping a table. */
export const MAX_K = 50;
export const MAX_QUERY_LENGTH = 2000;
export const DEFAULT_RUN_ID = "demo";
const DEFAULT_LESSON_K = 3;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bad input from the caller. The route turns it into a 400; it never reaches the database. */
export class InputError extends Error {
  status = 400;
}

export interface RetrievalDeps {
  /** A service-role client. Defaults to `supabaseAdmin()`, loaded lazily. */
  client?: Pick<SupabaseClient, "rpc">;
  embed?: (texts: string[]) => Promise<number[][]>;
}

export interface DocumentHit {
  content: string;
  citation: string;
  section: string | null;
  doc_title: string | null;
  doc_type: string | null;
  score: number;
}

export interface PastCaseHit {
  lesson_text: string | null;
  pattern_tag: string | null;
  case_summary: string | null;
  similarity: number;
}

async function defaultClient(): Promise<Pick<SupabaseClient, "rpc">> {
  const { supabaseAdmin } = await import("./supabase/server.ts");
  return supabaseAdmin();
}

// ------------------------------------------------------------------ validation

function requireFacilityId(v: unknown): string {
  if (typeof v !== "string" || !UUID.test(v)) throw new InputError("facility_id must be a UUID");
  return v;
}

function requireText(v: unknown, field: string): string {
  if (typeof v !== "string" || v.trim() === "") throw new InputError(`${field} must be a non-empty string`);
  if (v.length > MAX_QUERY_LENGTH) throw new InputError(`${field} must be at most ${MAX_QUERY_LENGTH} characters`);
  return v.trim();
}

/** A positive integer, defaulting when absent. Larger than MAX_K is capped; anything else non-integer is rejected. */
function requireK(v: unknown, fallback: number): number {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) throw new InputError("k must be a positive integer");
  return Math.min(v, MAX_K);
}

/** `undefined`/`null`/`[]` all mean "no filter". An unknown type is rejected, not silently matched to nothing. */
function requireDocTypes(v: unknown): string[] | null {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v)) throw new InputError("doc_types must be an array");
  const known: readonly string[] = DOC_TYPES;
  for (const t of v) {
    if (typeof t !== "string" || !known.includes(t)) {
      throw new InputError(`doc_types entries must be one of: ${DOC_TYPES.join(", ")}`);
    }
  }
  return v.length === 0 ? null : [...new Set(v as string[])];
}

// -------------------------------------------------------------------- citation

/**
 * The string an agent cites, and the string the guardrail later matches a quote
 * against. It is the vocabulary `resolveCitation` (lib/chunk.ts) parses back to
 * this document and section, so the two must change together:
 *
 *   agreement, "Credit Agreement", "§7.11"                  -> "CA §7.11"
 *   amendment, "Amendment No. 2",  "§3"                     -> "Amd 2 §3"
 *   financials, "Financials — Q2 2026", "§1"                -> "Fin Q2 2026 §1"
 *   compliance_certificate, "Compliance Certificate — Q2 2026", "§2" -> "CC Q2 2026 §2"
 *   waiver, "Waiver Request Letter — unexecuted", "§1"      -> "WR §1"
 *
 * A document whose title fits none of these falls back to its full title, which
 * is unique but not parseable; the corpus-wide round-trip test fails if a
 * seeded document ever lands there.
 */
export function citationFor(docType: string | null, docTitle: string | null, section: string | null): string {
  const sec = section ?? "";
  const title = docTitle ?? "";
  let prefix: string | null = null;
  if (docType === "agreement" && title === "Credit Agreement") {
    prefix = "CA";
  } else if (docType === "amendment") {
    const m = /^Amendment No\. (\d+)$/.exec(title);
    if (m) prefix = `Amd ${m[1]}`;
  } else if (docType === "financials") {
    const m = /^Financials — (Q[1-4] \d{4})$/.exec(title);
    if (m) prefix = `Fin ${m[1]}`;
  } else if (docType === "compliance_certificate") {
    const m = /^Compliance Certificate — (Q[1-4] \d{4})$/.exec(title);
    if (m) prefix = `CC ${m[1]}`;
  } else if (docType === "waiver" && title === "Waiver Request Letter — unexecuted") {
    prefix = "WR";
  }
  return `${prefix ?? (title || docType || "")} ${sec}`.trim();
}

// ---------------------------------------------------------------------- search

interface DocChunkRow {
  content: string;
  doc_title: string | null;
  section: string | null;
  doc_type: string | null;
  similarity: number;
}

export interface SearchDocumentsInput {
  facilityId: unknown;
  query: unknown;
  docTypes?: unknown;
  k?: unknown;
}

export async function searchDocuments(input: SearchDocumentsInput, deps: RetrievalDeps = {}): Promise<DocumentHit[]> {
  // Everything is validated before anything is embedded or queried, so a
  // malformed facility_id can never become an unfiltered search.
  const facilityId = requireFacilityId(input.facilityId);
  const query = requireText(input.query, "query");
  const docTypes = requireDocTypes(input.docTypes);
  const k = requireK(input.k, DEFAULT_K);

  const [vector] = await (deps.embed ?? embedTexts)([query]);
  const client = deps.client ?? (await defaultClient());
  const { data, error } = await client.rpc("match_doc_chunks", {
    query_embedding: vector,
    p_facility_id: facilityId,
    match_count: k,
    p_doc_types: docTypes,
  });
  if (error) throw new Error(`match_doc_chunks: ${error.message}`);

  return ((data ?? []) as DocChunkRow[]).map((r) => ({
    content: r.content,
    citation: citationFor(r.doc_type, r.doc_title, r.section),
    section: r.section,
    doc_title: r.doc_title,
    doc_type: r.doc_type,
    score: r.similarity,
  }));
}

interface LessonRow {
  lesson_text: string | null;
  pattern_tag: string | null;
  case_summary: string | null;
  similarity: number;
}

export interface SearchPastCasesInput {
  facilityId: unknown;
  exceptionProfile: unknown;
  k?: unknown;
  runId?: unknown;
}

export async function searchPastCases(input: SearchPastCasesInput, deps: RetrievalDeps = {}): Promise<PastCaseHit[]> {
  // Validated as context, then deliberately not passed to the search. See the
  // header comment: memory crosses facilities.
  requireFacilityId(input.facilityId);
  const profile = requireText(input.exceptionProfile, "exception_profile");
  const k = requireK(input.k, DEFAULT_LESSON_K);
  const runId = input.runId === undefined || input.runId === null ? DEFAULT_RUN_ID : requireText(input.runId, "run_id");

  const [vector] = await (deps.embed ?? embedTexts)([profile]);
  const client = deps.client ?? (await defaultClient());
  const { data, error } = await client.rpc("match_lessons", {
    query_embedding: vector,
    p_run_id: runId,
    match_count: k,
  });
  if (error) throw new Error(`match_lessons: ${error.message}`);

  return ((data ?? []) as LessonRow[]).map((r) => ({
    lesson_text: r.lesson_text,
    pattern_tag: r.pattern_tag,
    case_summary: r.case_summary,
    similarity: r.similarity,
  }));
}
