import type { SupabaseClient } from "@supabase/supabase-js";
import { PATTERN_TAGS } from "../guardrails/casefile-schema.js";
import { caseSummaryText, storeLesson, toNumber, type Lesson, type MemoryDeps } from "./memory.ts";

/**
 * The analyst's review: approve, override, or ask for documents. Spec 4.4.
 *
 * This is the only place a human decision enters the system, and the only place
 * a lesson is born. Two rules hold it together:
 *
 *   1. A review that cannot be learned from is not recorded. The lesson is built
 *      and embedded BEFORE anything is written, so an embedding outage is a 500
 *      with the casefile still `pending_review` and no `reviews` row. An approve
 *      or override that looked successful but taught nothing is the failure the
 *      memory effect cannot recover from.
 *   2. Review is read-only once made. A casefile leaves `pending_review` through
 *      a guarded update, so two analysts racing cannot both win.
 *
 * Auth model matches `runApprove`: the analyst is recorded by the UI, not
 * authenticated here.
 */

type Db = Pick<SupabaseClient, "from">;

export type Decision = "approve" | "override" | "request_docs";
const DECISIONS: readonly Decision[] = ["approve", "override", "request_docs"];

/** `exceptions.status` mirrors `casefiles.status` (A-4). Only a decided casefile closes its exception. */
export const EXCEPTION_CLOSED = "closed";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Casefile status after each decision. */
const CASEFILE_STATUS: Record<Decision, string> = {
  approve: "approved",
  override: "overridden",
  request_docs: "awaiting_docs",
};

export interface ReviewInput {
  casefileId: string;
  decision: Decision;
  reason?: string;
  correctedOutcome?: string;
  confirmedTag?: string;
}

export interface ReviewDeps extends MemoryDeps {
  client?: Db;
}

export interface ReviewResult {
  status: number;
  body: Record<string, unknown>;
}

const fail = (status: number, error: string, extra: Record<string, unknown> = {}): ReviewResult => ({
  status,
  body: { error, ...extra },
});

async function defaultClient(): Promise<Db> {
  const { supabaseAdmin } = await import("./supabase/server.ts");
  return supabaseAdmin();
}

const check = <T>(res: { data?: T | null; error: { message: string } | null }, what: string): T | null => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data ?? null;
};

const blank = (v: unknown): boolean => typeof v !== "string" || v.trim() === "";
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

interface CasefileRow {
  id: string;
  status: string;
  exception_id: string;
  suggested_tag: string | null;
  recommendation: string | null;
  summary: string | null;
}

/**
 * The wire shape (`POST /api/review`, snake_case, spec 4.4) mapped to
 * `submitReview`'s. Anything that is not a string where a string belongs is
 * passed on as-is so `submitReview` rejects it by name.
 */
export async function runReview(body: unknown, deps: ReviewDeps = {}): Promise<ReviewResult> {
  if (!isObj(body)) return fail(400, "request body must be a JSON object");
  return submitReview(
    {
      casefileId: body.casefile_id as string,
      decision: body.decision as Decision,
      reason: body.reason as string | undefined,
      correctedOutcome: body.corrected_outcome as string | undefined,
      confirmedTag: body.confirmed_tag as string | undefined,
    },
    deps,
  );
}

export async function submitReview(input: ReviewInput, deps: ReviewDeps = {}): Promise<ReviewResult> {
  const { casefileId, decision, reason, correctedOutcome, confirmedTag } = input;

  // ---- 1. the request itself, before any read.
  if (typeof casefileId !== "string" || !UUID.test(casefileId)) return fail(400, "casefile_id must be a UUID");
  if (!DECISIONS.includes(decision)) return fail(400, `decision must be one of: ${DECISIONS.join(", ")}`);
  if (decision === "override") {
    // The reason IS the lesson: an override without one teaches nothing, so it is refused, not defaulted.
    const missing: string[] = [];
    if (blank(reason)) missing.push("reason");
    if (blank(correctedOutcome)) missing.push("corrected_outcome");
    if (blank(confirmedTag)) missing.push("confirmed_tag");
    if (missing.length > 0) return fail(400, `An override requires ${missing.join(", ")}.`, { missing });
    if (!(PATTERN_TAGS as string[]).includes(confirmedTag as string)) {
      return fail(400, `confirmed_tag must be one of: ${PATTERN_TAGS.join(", ")}`);
    }
  }

  const client = deps.client ?? (await defaultClient());

  // ---- 2. the casefile must exist and be waiting for a human.
  const casefile = check(
    await client
      .from("casefiles")
      .select("id, status, exception_id, suggested_tag, recommendation, summary")
      .eq("id", casefileId)
      .maybeSingle(),
    "read casefiles",
  ) as CasefileRow | null;
  if (!casefile) return fail(404, "No casefile with that id.");
  if (casefile.status !== "pending_review") {
    const decided = ["approved", "overridden", "awaiting_docs"].includes(casefile.status);
    return fail(
      409,
      decided
        ? `This casefile is already ${casefile.status}; a review is read-only once made.`
        : `This casefile is ${casefile.status} and has not reached a recommendation, so it cannot be reviewed.`,
      { casefile_status: casefile.status },
    );
  }

  // ---- 3. the lesson, built and embedded before anything is written.
  const hadSummary = !blank(casefile.summary);
  let summary = casefile.summary;
  let lesson: Lesson = { lesson_text: null, lesson_embedding: null };
  if (decision !== "request_docs") {
    if (!hadSummary) summary = await buildSummary(client, casefile);
    try {
      lesson = await storeLesson({ summary }, decision, { reason, confirmedTag }, deps);
    } catch (err) {
      console.error("review: the lesson could not be built, so nothing was recorded", err);
      return fail(500, "The lesson could not be embedded, so the review was not recorded. The casefile is still pending review.");
    }
  }

  // ---- 4. leave `pending_review`, guarded. The summary is written on the same
  // update: it is the memory surface, and only a review writes it.
  const newStatus = CASEFILE_STATUS[decision];
  const claim: Record<string, unknown> = { status: newStatus };
  const writesSummary = decision !== "request_docs" && !hadSummary;
  if (writesSummary) claim.summary = summary;
  const claimed = check(
    await client.from("casefiles").update(claim).eq("id", casefile.id).eq("status", "pending_review").select("id"),
    "update casefiles",
  ) as { id: string }[] | null;
  if (!claimed || claimed.length === 0) {
    const now = check(await client.from("casefiles").select("status").eq("id", casefile.id).maybeSingle(), "re-read casefiles") as { status: string } | null;
    return fail(409, `This casefile is already ${now?.status ?? "reviewed"}; a review is read-only once made.`, { casefile_status: now?.status ?? null });
  }

  // ---- 5. the review row. If it cannot be written the casefile goes back, so a
  // decided casefile never has no review behind it. `reviews` is append-only, so
  // nothing after this point is ever rolled back.
  let reviewId: string;
  try {
    const row = check(
      await client
        .from("reviews")
        .insert({
          casefile_id: casefile.id,
          decision,
          reason: decision === "override" ? reason : null,
          corrected_outcome: decision === "override" ? correctedOutcome : null,
          pattern_tag: decision === "approve" ? casefile.suggested_tag : decision === "override" ? confirmedTag : null,
          lesson_text: lesson.lesson_text,
          lesson_embedding: lesson.lesson_embedding,
        })
        .select("id")
        .single(),
      "insert reviews",
    ) as { id: string } | null;
    if (!row) throw new Error("insert reviews: no row came back");
    reviewId = row.id;
  } catch (err) {
    // Restores the status READ at the start, not a literal: this puts back what was
    // there and is not a second writer of `pending_review` (enforce.ts owns that).
    const undo: Record<string, unknown> = { status: casefile.status };
    if (writesSummary) undo.summary = casefile.summary;
    try {
      check(await client.from("casefiles").update(undo).eq("id", casefile.id).eq("status", newStatus), "restore casefiles");
    } catch (undoErr) {
      console.error("review: could not put the casefile back to pending_review", undoErr);
    }
    throw err;
  }

  // ---- 6. mirror onto the exception (A-4). `casefiles.status` is authoritative.
  // F7 has no reusable close helper (`retractStaleException` in lib/tests/run.ts
  // closes by test_id and only while `new`, a different case), so the update is
  // written here against the same `closed` status.
  let exceptionStatus: string | null = null;
  if (decision !== "request_docs") {
    try {
      check(await client.from("exceptions").update({ status: EXCEPTION_CLOSED }).eq("id", casefile.exception_id), "close exception");
      exceptionStatus = EXCEPTION_CLOSED;
    } catch (err) {
      console.error("review: recorded, but the exception was not closed", err);
      return fail(500, "The review was recorded, but the exception could not be closed. Check the server log.", {
        review_id: reviewId,
        casefile_status: newStatus,
      });
    }
  }

  return {
    status: 200,
    body: { review_id: reviewId, casefile_id: casefile.id, decision, casefile_status: newStatus, exception_status: exceptionStatus },
  };
}

/** Builds the one-line summary from the exception's calculator figures and the facility. Never from model prose. */
async function buildSummary(client: Db, casefile: CasefileRow): Promise<string> {
  const exception = check(
    await client
      .from("exceptions")
      .select("id, facility_id, test_period_end, computed_dscr, reported_dscr, required_dscr")
      .eq("id", casefile.exception_id)
      .maybeSingle(),
    "read exceptions",
  ) as {
    facility_id: string;
    test_period_end: string;
    computed_dscr: number | string | null;
    reported_dscr: number | string | null;
    required_dscr: number | string | null;
  } | null;
  if (!exception) throw new Error(`Casefile ${casefile.id} names exception ${casefile.exception_id}, which does not exist`);
  const facility = check(
    await client.from("facilities").select("borrower_name").eq("id", exception.facility_id).maybeSingle(),
    "read facilities",
  ) as { borrower_name: string } | null;
  return caseSummaryText({
    borrower_name: facility?.borrower_name ?? null,
    test_period_end: exception.test_period_end,
    computed_dscr: toNumber(exception.computed_dscr),
    reported_dscr: toNumber(exception.reported_dscr),
    required_dscr: toNumber(exception.required_dscr),
    recommendation: casefile.recommendation,
    suggested_tag: casefile.suggested_tag,
  });
}
