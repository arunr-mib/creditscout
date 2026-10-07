import { DocumentList, type DocumentView } from "@/components/DocumentList";
import { InvestigateButton } from "@/components/InvestigateButton";
import { RunTestButton } from "@/components/RunTestButton";
import { TestResultCard } from "@/components/TestResultCard";
import { UploadPackage, type UploadFacility } from "@/components/UploadPackage";
import { computeKpis, isReopened, runDisabledReason } from "@/components/portfolioModel";
import { anonReader } from "@/lib/supabase/anon";
import { quarterLabel } from "@/lib/tests/extract-financials";

export const dynamic = "force-dynamic";

const must = (res: { data: unknown; error: { message: string } | null }, what: string): unknown => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data ?? null;
};

const num = (v: unknown): number | null => (v == null ? null : Number(v));

interface FacilityRow {
  id: string;
  borrower_name: string;
  industry: string | null;
}
interface TestRow {
  id: string;
  facility_id: string;
  test_period_end: string;
  computed_dscr: number | null;
  reported_dscr: number | null;
  threshold: number;
  passed: boolean | null;
  variance_flagged: boolean | null;
  calc_id: string | null;
  calc_error: string | null;
}
interface ExceptionRow {
  id: string;
  facility_id: string;
  status: string;
  test_period_end: string;
  computed_dscr: number | null;
  reported_dscr: number | null;
  required_dscr: number | null;
  test_id: string;
}
interface CasefileRow {
  id: string;
  exception_id: string;
  status: string;
  steps_count: number | null;
}
interface TermsRow {
  facility_id: string;
  terms: unknown;
  status: string;
}

/** Last day of the quarter before `today` (UTC): the most recent complete test period. */
function latestCompleteQuarterEnd(today: Date): string {
  const q = Math.floor(today.getUTCMonth() / 3); // 0..3
  // The end of the previous quarter.
  const year = q === 0 ? today.getUTCFullYear() - 1 : today.getUTCFullYear();
  const endMonthDay = ["12-31", "03-31", "06-30", "09-30"][q];
  return `${year}-${endMonthDay}`;
}

/**
 * The portfolio queue — the analyst's landing screen (design.md §7, §12).
 *
 * Server Component: it only reads, with the anon key under the RLS read policy.
 * Every write (running a test, starting an investigation, uploading a package)
 * goes through a route handler or a Server Action on the service role.
 */
export default async function Home() {
  const db = anonReader();

  const [facilitiesRes, testsRes, exceptionsRes, documentsRes, casefilesRes, termsRes] = await Promise.all([
    db.from("facilities").select("id, borrower_name, industry").order("borrower_name", { ascending: true }),
    db.from("tests").select("id, facility_id, test_period_end, computed_dscr, reported_dscr, threshold, passed, variance_flagged, calc_id, calc_error").eq("run_id", "demo"),
    db.from("exceptions").select("id, facility_id, status, test_period_end, computed_dscr, reported_dscr, required_dscr, test_id"),
    db.from("documents").select("id, facility_id, doc_type, title, effective_date").order("effective_date", { ascending: true }),
    db.from("casefiles").select("id, exception_id, status, steps_count").eq("run_id", "demo"),
    db.from("covenant_terms").select("facility_id, terms, status").eq("status", "approved"),
  ]);

  const facilities = ((must(facilitiesRes, "select facilities") ?? []) as FacilityRow[]);
  const tests = ((must(testsRes, "select tests") ?? []) as TestRow[]).map((t) => ({
    ...t,
    computed_dscr: num(t.computed_dscr),
    reported_dscr: num(t.reported_dscr),
    threshold: Number(t.threshold),
  }));
  // Exceptions have no run_id of their own — it lives on their test. Scope the
  // queue to the demo run by keeping only exceptions whose test is a demo test,
  // or a verification run's exception (e.g. verify-8c) would surface here as a
  // duplicate breach row for the same borrower and period.
  const demoTestIds = new Set(tests.map((t) => t.id));
  const exceptions = ((must(exceptionsRes, "select exceptions") ?? []) as ExceptionRow[]).filter((e) =>
    demoTestIds.has(e.test_id),
  );
  const documents = (must(documentsRes, "select documents") ?? []) as (DocumentView & { facility_id: string })[];
  const casefiles = (must(casefilesRes, "select casefiles") ?? []) as CasefileRow[];
  const approvedTerms = (must(termsRes, "select covenant_terms") ?? []) as TermsRow[];

  const kpis = computeKpis({ exceptions, casefiles, tests });

  // The quarter the queue is showing and the run button targets: the most recent
  // period any test was run for, else the last complete calendar quarter.
  const periods = tests.map((t) => t.test_period_end).sort();
  const targetPeriod = periods[periods.length - 1] ?? latestCompleteQuarterEnd(new Date());

  // A casefile per exception (if any), so a new exception with one reads as reopened.
  const casefileByException = new Map<string, CasefileRow>();
  for (const c of casefiles) if (!casefileByException.has(c.exception_id)) casefileByException.set(c.exception_id, c);

  const uploadFacilities: UploadFacility[] = facilities.map((f) => ({ id: f.id, borrower_name: f.borrower_name }));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-title text-text">Portfolio</h1>
          <p className="text-body text-text-secondary">
            Every quarterly test is computed by code from approved terms. The borrower&apos;s figure is evidence to
            reconcile against, never the trigger.
          </p>
        </div>
        <RunTestButton
          label={`Run ${quarterLabel(targetPeriod)}`}
          endpoint="/api/tests/run-quarter"
          body={{ test_period_end: targetPeriod }}
        />
      </div>

      <section aria-label="Portfolio summary" className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi label="Open exceptions" value={kpis.openExceptions} empty="None open" />
        <Kpi label="Pending review" value={kpis.pendingReview} empty="None waiting" />
        <Kpi
          label="Avg steps / case"
          value={kpis.avgSteps}
          empty="No case reviewed yet"
        />
        <Kpi label={`Facilities tested · ${quarterLabel(targetPeriod)}`} value={kpis.facilitiesTested} empty="Run the quarter to begin" />
      </section>

      <UploadPackage facilities={uploadFacilities} />

      <section aria-label="Borrowers" className="space-y-6">
        {facilities.length === 0 ? (
          <p className="text-body text-text-secondary">
            No facilities on file. Board a covenant to add one.
          </p>
        ) : (
          facilities.map((f) => {
            const terms = approvedTerms.find((t) => t.facility_id === f.id) ?? null;
            const hasApprovedTerms = terms != null;
            const facilityDocs = documents.filter((d) => d.facility_id === f.id);
            const test = tests.find((t) => t.facility_id === f.id && t.test_period_end === targetPeriod) ?? null;
            const facilityExceptions = exceptions
              .filter((e) => e.facility_id === f.id && e.status !== "closed")
              .sort((a, b) => b.test_period_end.localeCompare(a.test_period_end));

            return (
              <article key={f.id} className="space-y-4 rounded-lg border border-border-strong bg-surface p-5">
                <header className="flex flex-wrap items-baseline justify-between gap-3">
                  <h2 className="text-section text-text">
                    {f.borrower_name}
                    {f.industry && <span className="ml-2 text-label text-text-muted">{f.industry}</span>}
                  </h2>
                  <RunTestButton
                    label={test ? `Re-run ${quarterLabel(targetPeriod)}` : `Run ${quarterLabel(targetPeriod)}`}
                    endpoint="/api/tests/run"
                    body={{ facility_id: f.id, test_period_end: targetPeriod }}
                    disabledReason={runDisabledReason({ hasApprovedTerms })}
                  />
                </header>

                {test ? (
                  <TestResultCard
                    test={{
                      borrower: f.borrower_name,
                      period: quarterLabel(test.test_period_end),
                      computed_dscr: test.computed_dscr,
                      reported_dscr: test.reported_dscr,
                      threshold: test.threshold,
                      passed: test.passed,
                      variance_flagged: test.variance_flagged,
                      calc_id: test.calc_id,
                      calc_error: test.calc_error,
                    }}
                  />
                ) : (
                  <p className="text-body text-text-muted">
                    No test for {quarterLabel(targetPeriod)} yet.{" "}
                    {hasApprovedTerms ? "Run it to see where this borrower stands." : "Approve covenant terms, then run it."}
                  </p>
                )}

                {facilityExceptions.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-label uppercase tracking-wide text-text-muted">Open exceptions</h3>
                    {facilityExceptions.map((e) => {
                      const casefile = casefileByException.get(e.id);
                      return (
                        <div
                          key={e.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface-raised p-3"
                        >
                          <span className="text-body text-text-secondary">
                            {quarterLabel(e.test_period_end)} —{" "}
                            <span className="font-mono text-text">
                              ours {num(e.computed_dscr)?.toFixed(2) ?? "—"}
                            </span>{" "}
                            vs required{" "}
                            <span className="font-mono text-text">{num(e.required_dscr)?.toFixed(2) ?? "—"}</span>
                            {isReopened(e, casefile != null) && (
                              <span className="ml-2 text-label text-text-muted">· reopened by a later breach</span>
                            )}
                          </span>
                          <InvestigateButton exceptionId={e.id} status={e.status} hasCasefile={casefile != null} />
                        </div>
                      );
                    })}
                  </div>
                )}

                <div>
                  <h3 className="mb-2 text-label uppercase tracking-wide text-text-muted">Documents on file</h3>
                  <DocumentList
                    documents={facilityDocs.map((d) => ({ id: d.id, title: d.title, doc_type: d.doc_type, effective_date: d.effective_date }))}
                    approvedTerms={terms}
                  />
                </div>
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}

/** One KPI tile. A zero/absent value names the next action rather than showing a bare 0 (design §8). */
function Kpi({ label, value, empty }: { label: string; value: number | null; empty: string }) {
  const show = value != null && value > 0;
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <p className="text-label uppercase tracking-wide text-text-muted">{label}</p>
      {show ? (
        <p className="mt-1 font-mono text-title text-text">{value}</p>
      ) : (
        <p className="mt-1 text-body text-text-muted">{empty}</p>
      )}
    </div>
  );
}
