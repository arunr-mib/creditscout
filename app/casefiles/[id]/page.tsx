import { notFound } from "next/navigation";
import { CasefileView, type ReviewRecord } from "@/components/CasefileView";
import { LiveTrace } from "@/components/LiveTrace";
import { buildLiveTrace } from "@/components/traceModel";
import {
  calcSectionsOf,
  citationsOnScreen,
  claimsOf,
  clauseMap,
  humanReviewPolicy,
  noticesOf,
  seenSimilarCount,
  type CalcLogRow,
} from "@/components/casefileModel";
import type { Clause } from "@/components/termsReview";
import { loadFacilityChunks } from "@/lib/agent/evidence";
import { termsInForce } from "@/lib/terms";
import { currentCasefileId } from "@/lib/casefile-current";
import { anonReader } from "@/lib/supabase/anon";
import { quarterLabel } from "@/lib/tests/extract-financials";

export const dynamic = "force-dynamic";
// The pollInvestigation / reviewCasefile / reinvestigate Server Actions hosted
// here await a sync drive of up to ~25s; raise the cap above Vercel's 10s
// default (60s is the Hobby ceiling). Reads still return fast.
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const must = (res: { data: unknown; error: { message: string } | null }, what: string): unknown => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data ?? null;
};

interface CasefileRow {
  exception_id: string;
  status: string;
  trace: unknown;
  recommendation: string | null;
  explanation: string | null;
  claims: unknown;
  calc_ids: string[] | null;
  missing_evidence: unknown;
  suggested_tag: string | null;
  guardrail_notes: unknown;
}
interface ExceptionRow {
  facility_id: string;
  test_period_end: string;
  status: string;
}

/**
 * The casefile review screen (spec 4.4, 7.3). Server Component: it only reads,
 * with the anon key under the RLS read policy. The one write, the analyst's
 * decision, is a Server Action on the service role (`app/casefiles/actions.ts`).
 */
export default async function CasefilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const db = anonReader();

  const casefile = must(await db.from("casefiles").select("*").eq("id", id).maybeSingle(), "select casefiles") as CasefileRow | null;
  if (!casefile) notFound();

  const exception = must(
    await db.from("exceptions").select("id, facility_id, test_period_end, status").eq("id", casefile.exception_id).maybeSingle(),
    "select exceptions",
  ) as ExceptionRow | null;
  if (!exception) throw new Error(`Casefile ${id} names exception ${casefile.exception_id}, which does not exist`);

  // While the investigation runs, this same URL shows the live, polling trace
  // (F9d) rather than a recommendation there is not one of yet. A terminal
  // status falls through to the concluded view below; `failed` renders its
  // failed state there too. One URL per casefile.
  if (casefile.status === "investigating") {
    const facility = must(
      await db.from("facilities").select("borrower_name").eq("id", exception.facility_id).maybeSingle(),
      "select facilities",
    ) as { borrower_name: string } | null;
    return (
      <LiveTrace
        casefileId={id}
        borrower={facility?.borrower_name ?? "Unknown borrower"}
        period={quarterLabel(exception.test_period_end)}
        trace={buildLiveTrace(casefile.trace)}
      />
    );
  }

  const calcIds = Array.isArray(casefile.calc_ids) ? casefile.calc_ids : [];
  const [facility, calcs, policy, reviews, chunks, governingTerms] = await Promise.all([
    db.from("facilities").select("borrower_name").eq("id", exception.facility_id).maybeSingle(),
    calcIds.length > 0
      ? db.from("calc_log").select("calc_id, inputs, outputs, created_at").in("calc_id", calcIds).order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as CalcLogRow[], error: null }),
    db.from("policy").select("key, value").eq("key", "require_human_review"),
    db.from("reviews").select("decision, reason, corrected_outcome, pattern_tag, created_at").eq("casefile_id", id).order("created_at", { ascending: false }).limit(1),
    loadFacilityChunks(db, exception.facility_id),
    // The approved terms version in force for the test period — the one the test
    // was computed on. Resilient: a lookup failure just omits it from the header.
    termsInForce(db, exception.facility_id, exception.test_period_end).catch(() => null),
  ]);

  const claims = claimsOf(casefile.claims);
  const sections = calcSectionsOf((must(calcs, "select calc_log") ?? []) as CalcLogRow[]);

  // Resolved here so the browser never receives every chunk the facility has.
  const clauses = clauseMap(
    citationsOnScreen(claims, sections),
    chunks.map((c): Clause => ({ citation: c.citation, doc_title: c.doc_title, doc_type: c.doc_type, section: c.section, content: c.content })),
  );

  const supersededBy = casefile.status === "superseded" ? await currentCasefileId(db, casefile.exception_id) : null;

  return (
    <CasefileView
      view={{
        casefileId: id,
        exceptionId: casefile.exception_id,
        supersededBy,
        status: casefile.status,
        borrower: (must(facility, "select facilities") as { borrower_name: string } | null)?.borrower_name ?? "Unknown borrower",
        period: quarterLabel(exception.test_period_end),
        recommendation: casefile.recommendation ?? null,
        explanation: casefile.explanation ?? null,
        seenSimilar: seenSimilarCount(casefile.trace),
        claims,
        sections,
        clauses,
        missingEvidence: Array.isArray(casefile.missing_evidence) ? casefile.missing_evidence.filter((m: unknown): m is string => typeof m === "string") : [],
        notes: noticesOf(casefile.guardrail_notes),
        suggestedTag: casefile.suggested_tag ?? null,
        termsVersion: governingTerms?.version ?? null,
        termsStatus: governingTerms?.status ?? null,
        humanReviewRequired: humanReviewPolicy(must(policy, "select policy") as { key: string; value: unknown }[] | null),
        review: (((must(reviews, "select reviews") ?? []) as ReviewRecord[])[0]) ?? null,
        exceptionStatus: exception.status ?? null,
      }}
    />
  );
}
