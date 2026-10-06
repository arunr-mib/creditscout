import type { SupabaseClient } from "@supabase/supabase-js";
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
const toNumber = (v: number | string | null): number | null => {
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
 * A memory outage is not an investigation failure. If the search throws, the
 * investigation runs cold rather than not at all: a slower correct answer beats
 * no answer, and the lessons are an accelerant, not evidence.
 */
export async function topLessons(
  facilityId: string,
  profile: string,
  k: number = DEFAULT_LESSON_COUNT,
  deps: MemoryDeps = {},
  runId: string = DEFAULT_RUN_ID,
): Promise<PastCaseHit[]> {
  try {
    return await (deps.search ?? searchPastCases)({ facilityId, exceptionProfile: profile, k, runId });
  } catch (err) {
    console.error("topLessons failed; the investigation will run cold", err);
    return [];
  }
}
