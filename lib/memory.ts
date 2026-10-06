import type { SupabaseClient } from "@supabase/supabase-js";
import { EMBEDDING_DIMENSIONS, embed as embedTexts } from "./embed.ts";
import { DEFAULT_RUN_ID, searchPastCases, type PastCaseHit } from "./retrieval.ts";
import type { DocumentFacts, ExceptionFacts, FacilityFacts } from "./agent/prompt.ts";

/**
 * Warm memory: what the lender learned the last time something looked like this.
 *
 * `reviews` is empty until stage 9, so `topLessons` returns [] today and every
 * investigation runs cold. That is the point of building it now rather than
 * later — the cold run is the baseline the warm run is measured against, and a
 * baseline collected with a different code path is not a baseline.
 */

export const DEFAULT_LESSON_COUNT = 3;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Db = Pick<SupabaseClient, "from">;

export interface MemoryDeps {
  /** A service-role client. Defaults to `supabaseAdmin()`, loaded lazily so tests never import the server-only module. */
  client?: Db;
  search?: typeof searchPastCases;
  /** Defaults to the Azure embedder. Injected by tests so a lesson can be written without a network. */
  embed?: (texts: string[]) => Promise<number[][]>;
}

/** The exception named no row. A 404, not a 500. */
export class ExceptionNotFound extends Error {
  status = 404;
}

async function defaultClient(): Promise<Db> {
  const { supabaseAdmin } = await import("./supabase/server.ts");
  return supabaseAdmin();
}

const check = <T>(res: { data?: T | null; error: { message: string } | null }, what: string): T | null => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data ?? null;
};

// ------------------------------------------------------------- the profile

export interface ProfileInput {
  industry: string | null;
  computed_dscr: number | null;
  reported_dscr: number | null;
  required_dscr: number | null;
  docTypes: string[];
}

/**
 * The string the lesson search is run against. Spec 4.2 step 2: reported versus
 * required DSCR, the document types on file, and the industry.
 *
 * It is prose rather than JSON on purpose. This text is embedded and compared
 * against analysts' own lesson text, which is prose; punctuation and field
 * names would be most of the vector otherwise.
 *
 * Pure, so it can be tested without a database — which is also why the loader
 * below is a thin shell around it.
 */
export function exceptionProfileText(input: ProfileInput): string {
  const parts: string[] = [];
  parts.push(
    `DSCR covenant exception: computed ${input.computed_dscr ?? "unknown"} against a required minimum of ${input.required_dscr ?? "unknown"}, borrower reported ${input.reported_dscr ?? "none"}.`,
  );
  if (input.computed_dscr !== null && input.reported_dscr !== null) {
    // Which direction the borrower is wrong in is the strongest single signal
    // of which past case this resembles, so it is said in words.
    if (input.reported_dscr > input.computed_dscr) parts.push("The borrower's figure is higher than ours.");
    else if (input.reported_dscr < input.computed_dscr) parts.push("The borrower's figure is lower than ours.");
    else parts.push("The borrower's figure agrees with ours.");
  }
  if (input.industry) parts.push(`Industry: ${input.industry}.`);
  const types = [...new Set(input.docTypes)].sort();
  parts.push(types.length > 0 ? `Documents on file: ${types.join(", ")}.` : "No documents are on file.");
  return parts.join(" ");
}

interface ExceptionRow {
  id: string;
  facility_id: string;
  test_period_end: string;
  computed_dscr: number | string | null;
  reported_dscr: number | string | null;
  required_dscr: number | string | null;
}

/** Postgres `numeric` arrives as a string over the wire; a string DSCR in a prompt is a bug waiting. */
export const toNumber = (v: number | string | null): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export interface ExceptionProfile {
  profile: string;
  exception: ExceptionFacts;
  facility: FacilityFacts;
  documents: DocumentFacts[];
}

/**
 * Loads the exception, its facility and its document inventory, and builds the
 * profile string from them.
 *
 * It returns the rows as well as the string because the caller needs every one
 * of them for the investigation brief, and reading them twice would be two
 * chances for the brief and the profile to describe different facts.
 */
export async function buildExceptionProfile(exceptionId: string, deps: MemoryDeps = {}): Promise<ExceptionProfile> {
  if (typeof exceptionId !== "string" || !UUID.test(exceptionId)) {
    throw new ExceptionNotFound("exception_id must be a UUID");
  }
  const client = deps.client ?? (await defaultClient());

  const row = check(
    await client
      .from("exceptions")
      .select("id, facility_id, test_period_end, computed_dscr, reported_dscr, required_dscr")
      .eq("id", exceptionId)
      .maybeSingle(),
    "read exceptions",
  ) as ExceptionRow | null;
  if (!row) throw new ExceptionNotFound(`No exception ${exceptionId}`);

  const facility = check(
    await client.from("facilities").select("id, borrower_name, industry").eq("id", row.facility_id).maybeSingle(),
    "read facilities",
  ) as FacilityFacts | null;
  if (!facility) throw new ExceptionNotFound(`Exception ${exceptionId} names facility ${row.facility_id}, which does not exist`);

  const documents = (check(
    await client
      .from("documents")
      .select("doc_type, title, effective_date")
      .eq("facility_id", row.facility_id)
      .order("effective_date", { ascending: true }),
    "read documents",
  ) ?? []) as DocumentFacts[];

  const exception: ExceptionFacts = {
    id: row.id,
    test_period_end: row.test_period_end,
    computed_dscr: toNumber(row.computed_dscr),
    reported_dscr: toNumber(row.reported_dscr),
    required_dscr: toNumber(row.required_dscr),
  };

  return {
    profile: exceptionProfileText({
      industry: facility.industry,
      computed_dscr: exception.computed_dscr,
      reported_dscr: exception.reported_dscr,
      required_dscr: exception.required_dscr,
      docTypes: documents.map((d) => d.doc_type),
    }),
    exception,
    facility,
    documents,
  };
}

// ------------------------------------------------------------- the lessons

/**
 * The top lessons for this exception.
 *
 * The search deliberately spans facilities — a lesson from F1 is what speeds up
 * F5, which is the whole memory claim — and is filtered by `run_id` instead, so
 * a cold eval pass cannot see warm lessons. Both filters live inside
 * `match_lessons`; this function must not try to add its own.
 *
 * IT THROWS, and used to swallow. A memory outage must not kill an
 * investigation — the agent can work cold — but deciding that is the caller's
 * job, because the caller is the one holding a casefile to record the
 * degradation on. Swallowing it here returned `[]`, which is indistinguishable
 * from "no lessons on file", and the memory effect is a reported metric: a warm
 * run that silently fell back to cold would still be measured as warm. See
 * `startInvestigation`, which catches this and writes a visible trace entry.
 */
export async function topLessons(
  facilityId: string,
  profile: string,
  k: number = DEFAULT_LESSON_COUNT,
  deps: MemoryDeps = {},
  runId: string = DEFAULT_RUN_ID,
): Promise<PastCaseHit[]> {
  return (deps.search ?? searchPastCases)({ facilityId, exceptionProfile: profile, k, runId });
}

// ------------------------------------------------------ writing a lesson

/** The separator between the parts of an override lesson: reason, tag, case summary. */
export const LESSON_SEPARATOR = " \u00b7 ";

export interface CaseSummaryInput {
  borrower_name: string | null;
  test_period_end: string | null;
  computed_dscr: number | null;
  reported_dscr: number | null;
  required_dscr: number | null;
  recommendation: string | null;
  suggested_tag: string | null;
}

/**
 * The one-line case summary a review writes to `casefiles.summary`, which
 * `match_lessons` serves back to later investigations as `case_summary`.
 *
 * Nothing wrote `summary` before a review does (investigation writes the raw
 * agent answer to `agent_output` instead, on purpose), so the review builds it,
 * and builds it from STRUCTURED, already-logged facts only: the figures are the
 * calculator's columns on the exception, never a number lifted from model
 * prose. A missing figure is said to be unknown, never rendered as zero. One
 * line, no newlines, because it is embedded and shown inside a numbered list.
 */
export function caseSummaryText(input: CaseSummaryInput): string {
  const who = input.borrower_name ?? "Unknown borrower";
  const period = input.test_period_end ? `quarter ending ${input.test_period_end}` : "unknown quarter";
  const fig = (n: number | null) => (n === null ? "unknown" : String(n));
  const rec = input.recommendation ?? "no recommendation";
  const tag = input.suggested_tag ? ` (${input.suggested_tag})` : "";
  return (
    `${who}, ${period}: computed DSCR ${fig(input.computed_dscr)} against a required ${fig(input.required_dscr)}, ` +
    `borrower reported ${input.reported_dscr === null ? "none" : input.reported_dscr}; the system recommended ${rec}${tag}.`
  );
}

export interface LessonCasefile {
  /** The one-line case summary. Never defaulted: a lesson with no case in it is not stored. */
  summary: string | null;
}

export interface Lesson {
  lesson_text: string | null;
  lesson_embedding: number[] | null;
}

/**
 * What text becomes the lesson, and its embedding. Spec 4.4.
 *
 *   approve       the case summary as it stands: "the system was right".
 *   override      the analyst's reason VERBATIM, then the confirmed tag, then the
 *                 case summary. The analyst's own words are the learning input, so
 *                 the reason is a literal prefix, never trimmed or paraphrased.
 *   request_docs  nothing learned yet. {null, null}, and the embedder is not called.
 *
 * `match_lessons` only ever returns a review row carrying BOTH fields (I-7), so
 * both come out of here together or this throws. It never returns text with no
 * vector, a placeholder vector, or a vector of the wrong size: a review that
 * looked recorded but could not be retrieved is the failure this exists to
 * prevent. The caller must treat a throw as "do not record the review".
 */
export async function storeLesson(
  casefile: LessonCasefile,
  decision: "approve" | "override" | "request_docs",
  input: { reason?: string | null; confirmedTag?: string | null },
  deps: MemoryDeps = {},
): Promise<Lesson> {
  if (decision === "request_docs") return { lesson_text: null, lesson_embedding: null };

  const summary = typeof casefile.summary === "string" ? casefile.summary : "";
  if (summary.trim() === "") throw new Error("storeLesson: the casefile has no one-line summary to learn from");

  let lessonText: string;
  if (decision === "approve") {
    lessonText = summary;
  } else if (decision === "override") {
    const { reason, confirmedTag } = input;
    if (typeof reason !== "string" || reason.trim() === "") throw new Error("storeLesson: an override lesson needs the analyst's reason");
    if (typeof confirmedTag !== "string" || confirmedTag.trim() === "") throw new Error("storeLesson: an override lesson needs the confirmed tag");
    lessonText = [reason, confirmedTag, summary].join(LESSON_SEPARATOR);
  } else {
    throw new Error(`storeLesson: unknown decision ${String(decision)}`);
  }

  const vectors = await (deps.embed ?? embedTexts)([lessonText]);
  const vector = vectors?.[0];
  if (vectors?.length !== 1 || !Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`storeLesson: the embedder did not return one ${EMBEDDING_DIMENSIONS}-dimension vector`);
  }
  return { lesson_text: lessonText, lesson_embedding: vector };
}
