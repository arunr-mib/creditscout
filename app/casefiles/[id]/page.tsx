import { notFound } from "next/navigation";
import { CasefileView, type ReviewRecord } from "@/components/CasefileView";
import { LiveTrace } from "@/components/LiveTrace";
import { buildLiveTrace, evidenceLinks, exceptionFacts } from "@/components/traceModel";
import {
  amendmentStatuses,
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

/** The order an analyst reads a loan's file in. Anything unknown sorts last. */
const DOC_ORDER = ["agreement", "amendment", "financials", "compliance_certificate", "waiver"];
const docRank = (t: string | null): number => {
  // `indexOf` returns -1 for an unknown type, which would sort it FIRST.
  const i = DOC_ORDER.indexOf(t ?? "");
  return i === -1 ? DOC_ORDER.length : i;
};

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
  agent_output: unknown;
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
  /** The figures that raised the exception. The live screen states them; it never recomputes them. */
  computed_dscr: number | null;
  required_dscr: number | null;
}

/**
 * The casefile review screen (spec 4.4, 7.3). Server Component: it only reads,
 * with the anon key under the RLS read policy. The one write, the analyst's
 * decision, is a Server Action on the service role (`app/casefiles/actions.ts`).
 */
/** The recommendation inside the agent's raw answer, if it parses. Never trusted for anything but labelling. */
function draftRecommendationOf(agentOutput: unknown): string | null {
  try {
    const o = typeof agentOutput === "string" ? JSON.parse(agentOutput) : agentOutput;
    const r = (o as { recommendation?: unknown } | null)?.recommendation;
    return typeof r === "string" && r.trim() !== "" ? r : null;
  } catch {
    return null;
  }
}

export default async function CasefilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const db = anonReader();

  const casefile = must(await db.from("casefiles").select("*").eq("id", id).maybeSingle(), "select casefiles") as CasefileRow | null;
  if (!casefile) notFound();

  const exception = must(
    await db
      .from("exceptions")
      .select("id, facility_id, test_period_end, status, computed_dscr, required_dscr")
      .eq("id", casefile.exception_id)
      .maybeSingle(),
    "select exceptions",
  ) as ExceptionRow | null;
  if (!exception) throw new Error(`Casefile ${id} names exception ${casefile.exception_id}, which does not exist`);

  // While the investigation runs, this same URL shows the live, polling trace
  // (F9d) rather than a recommendation there is not one of yet. A terminal
  // status falls through to the concluded view below; `failed` renders its
  // failed state there too. One URL per casefile.
  if (casefile.status === "investigating") {
    // The live screen states the test that raised the exception, says which
    // document types exist (so a missing PASSAGE is never reported as a missing
    // FILING), and resolves each retrievable citation to its document here —
    // the browser is never handed the corpus, only the links.
    const [liveFacility, liveTerms, liveDocs, liveChunks] = await Promise.all([
      db.from("facilities").select("borrower_name").eq("id", exception.facility_id).maybeSingle(),
      termsInForce(db, exception.facility_id, exception.test_period_end).catch(() => null),
      db.from("documents").select("id, title, doc_type").eq("facility_id", exception.facility_id),
      loadFacilityChunks(db, exception.facility_id).catch(() => []),
    ]);
    const docRows = ((must(liveDocs, "select documents") ?? []) as { id: string; title: string; doc_type: string | null }[]);
    const docIdByTitle: Record<string, string> = {};
    for (const d of docRows) if (!(d.title in docIdByTitle)) docIdByTitle[d.title] = d.id;
    const citations = [...new Set(liveChunks.map((c) => c.citation))];
    return (
      <LiveTrace
        casefileId={id}
        borrower={(must(liveFacility, "select facilities") as { borrower_name: string } | null)?.borrower_name ?? "Unknown borrower"}
        period={quarterLabel(exception.test_period_end)}
        trace={buildLiveTrace(casefile.trace)}
        facts={exceptionFacts({
          computed: exception.computed_dscr,
          required: exception.required_dscr,
          termsVersion: liveTerms?.version ?? null,
        })}
        docTypesOnFile={[...new Set(docRows.map((d) => d.doc_type).filter((t): t is string => typeof t === "string"))]}
        evidence={evidenceLinks(citations, liveChunks, docIdByTitle)}
      />
    );
  }

  const calcIds = Array.isArray(casefile.calc_ids) ? casefile.calc_ids : [];
  const [facility, calcs, policy, reviews, chunks, governingTerms, documents] = await Promise.all([
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
    // The facility's documents, for the amendment-status strip: an amendment on
    // file but not reflected in the governing terms is the boarding lag the
    // analyst must see before trusting a narrative that leans on it.
    db.from("documents").select("id, doc_type, title, effective_date").eq("facility_id", exception.facility_id),
  ]);

  const claims = claimsOf(casefile.claims);
  const sections = calcSectionsOf((must(calcs, "select calc_log") ?? []) as CalcLogRow[]);

  // Resolved here so the browser never receives every chunk the facility has.
  const clauses = clauseMap(
    citationsOnScreen(claims, sections),
    chunks.map((c): Clause => ({ citation: c.citation, doc_title: c.doc_title, doc_type: c.doc_type, section: c.section, content: c.content })),
  );

  const supersededBy = casefile.status === "superseded" ? await currentCasefileId(db, casefile.exception_id) : null;

  // The test period's basis (TTM) and the amendment-status strip, from the
  // governing terms and the facility's documents. Both are read-only context.
  const termsObj = (governingTerms?.terms ?? null) as Record<string, unknown> | null;
  const testPeriod = termsObj && typeof termsObj.test_period === "object" && termsObj.test_period !== null ? (termsObj.test_period as Record<string, unknown>) : null;
  const testBasis = testPeriod && typeof testPeriod.basis === "string" ? testPeriod.basis : null;
  const documentRows = (must(documents, "select documents") ?? []) as {
    id: string;
    doc_type: string | null;
    title: string;
    effective_date: string | null;
  }[];
  const amendments = amendmentStatuses(
    documentRows,
    termsObj?.effective_amendments,
    exception.test_period_end,
  );

  return (
    <CasefileView
      view={{
        casefileId: id,
        exceptionId: casefile.exception_id,
        facilityId: exception.facility_id,
        supersededBy,
        status: casefile.status,
        borrower: (must(facility, "select facilities") as { borrower_name: string } | null)?.borrower_name ?? "Unknown borrower",
        period: quarterLabel(exception.test_period_end),
        recommendation: casefile.recommendation ?? null,
        explanation: casefile.explanation ?? null,
        // What the AGENT put forward, before enforcement. Needed to say who
        // decided: a recommendation a code rule produced must not be
        // attributed to the model.
        draftRecommendation: draftRecommendationOf(casefile.agent_output),
        seenSimilar: seenSimilarCount(casefile.trace),
        claims,
        sections,
        clauses,
        trace: buildLiveTrace(casefile.trace),
        missingEvidence: Array.isArray(casefile.missing_evidence) ? casefile.missing_evidence.filter((m: unknown): m is string => typeof m === "string") : [],
        notes: noticesOf(casefile.guardrail_notes),
        suggestedTag: casefile.suggested_tag ?? null,
        termsVersion: governingTerms?.version ?? null,
        termsStatus: governingTerms?.status ?? null,
        testPeriodEnd: exception.test_period_end ?? null,
        testBasis,
        amendments,
        // Every document on file, so the evidence list links to the source
        // rather than naming it. Ordered as the agreement, then what amends it,
        // then the period's filings — the order an analyst reads them in.
        documents: [...documentRows]
          .sort((a, b) => docRank(a.doc_type) - docRank(b.doc_type))
          .map((d) => ({ id: d.id, title: d.title, docType: d.doc_type, date: d.effective_date })),
        humanReviewRequired: humanReviewPolicy(must(policy, "select policy") as { key: string; value: unknown }[] | null),
        review: (((must(reviews, "select reviews") ?? []) as ReviewRecord[])[0]) ?? null,
        exceptionStatus: exception.status ?? null,
      }}
    />
  );
}
