import { LessonList } from "@/components/LessonList";
import { isAnalystReasoning, lessonSource, recordedOutcome, type LessonRow } from "@/lib/lessons";
import { anonReader } from "@/lib/supabase/anon";
import { quarterLabel } from "@/lib/tests/extract-financials";

export const dynamic = "force-dynamic";

const num = (v: unknown): number | null => (v == null ? null : Number(v));

const must = (res: { data: unknown; error: { message: string } | null }, what: string): unknown => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data ?? null;
};

interface ReviewRow {
  id: string;
  casefile_id: string;
  decision: string;
  reason: string | null;
  corrected_outcome: string | null;
  pattern_tag: string | null;
  lesson_text: string | null;
  created_at: string | null;
}
interface CasefileRow { id: string; exception_id: string; run_id: string; recommendation: string | null }
interface ExceptionRow { id: string; facility_id: string; test_period_end: string; computed_dscr: number | null; required_dscr: number | null; reported_dscr: number | null }
interface FacilityRow { id: string; borrower_name: string }

/**
 * Prior cases (audit 3.7 / §2). A review's reasoning is embedded as a lesson and
 * retrieved on similar later cases — this screen is that memory made legible.
 *
 * IT DOES NOT CLAIM THEY ARE ALL ANALYST JUDGEMENT. The eval harness writes
 * reviews through the same path an analyst does, so most stored lessons were
 * produced by a script. Those are labelled as evaluation examples, because the
 * same rows are retrieved into live investigations and an unearned claim here
 * would travel with them.
 */
export default async function LessonsPage() {
  const db = anonReader();
  const [reviewsRes, casefilesRes, exceptionsRes, facilitiesRes] = await Promise.all([
    db
      .from("reviews")
      .select("id, casefile_id, decision, reason, corrected_outcome, pattern_tag, lesson_text, created_at")
      .not("lesson_text", "is", null)
      .order("created_at", { ascending: false }),
    db.from("casefiles").select("id, exception_id, run_id, recommendation"),
    db.from("exceptions").select("id, facility_id, test_period_end, computed_dscr, required_dscr, reported_dscr"),
    db.from("facilities").select("id, borrower_name"),
  ]);

  const reviews = (must(reviewsRes, "reviews") ?? []) as ReviewRow[];
  const casefiles = new Map(((must(casefilesRes, "casefiles") ?? []) as CasefileRow[]).map((c) => [c.id, c]));
  const exceptions = new Map(((must(exceptionsRes, "exceptions") ?? []) as ExceptionRow[]).map((e) => [e.id, e]));
  const nameOf = new Map(((must(facilitiesRes, "facilities") ?? []) as FacilityRow[]).map((f) => [f.id, f.borrower_name]));

  const rows: LessonRow[] = reviews.map((r) => {
    const cf = casefiles.get(r.casefile_id) ?? null;
    const ex = cf ? (exceptions.get(cf.exception_id) ?? null) : null;
    const source = lessonSource(cf?.run_id ?? null, r.decision);
    return {
      id: r.id,
      borrower: ex ? (nameOf.get(ex.facility_id) ?? "Unknown borrower") : "Unknown borrower",
      period: ex ? quarterLabel(ex.test_period_end) : "—",
      source,
      patternTag: r.pattern_tag,
      outcome: recordedOutcome(r.decision, r.corrected_outcome, cf?.recommendation ?? null),
      // Only the analyst's own words qualify. A system-composed summary is kept
      // below, under Record details, where it is not mistaken for judgement.
      analystReasoning: isAnalystReasoning(source, r.reason) ? r.reason : null,
      storedText: r.lesson_text,
      casefileId: r.casefile_id,
      createdAt: r.created_at,
      initialDscr: num(ex?.computed_dscr),
      minimumDscr: num(ex?.required_dscr),
      reportedDscr: num(ex?.reported_dscr),
    };
  });

  return (
    <div className="space-y-6">
      <header className="max-w-prose space-y-1">
        <p className="text-label text-text-muted">Investigation memory</p>
        <h1 className="text-title text-text">Lessons from prior cases</h1>
        <p className="pt-1 text-body text-text-secondary">
          Review previous decisions and the reasoning behind them. CreditScout retrieves relevant lessons to inform new
          investigations.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-8 text-center">
          <p className="text-body text-text-secondary">No prior cases yet.</p>
          <p className="mt-1 text-label text-text-muted">
            Approve or override a casefile and its record is kept here, ready to inform a similar future case.
          </p>
        </div>
      ) : (
        <LessonList rows={rows} />
      )}

      <p className="text-label text-text-muted">
        <span aria-hidden="true">ⓘ </span>
        Prior cases provide context. Each investigation must verify the current terms and evidence.
      </p>
    </div>
  );
}
