import Link from "next/link";
import { DocumentList, type DocumentView } from "@/components/DocumentList";
import { InvestigateButton } from "@/components/InvestigateButton";
import { RecommendationBadge } from "@/components/RecommendationBadge";
import { RunTestButton } from "@/components/RunTestButton";
import { TestResultCard } from "@/components/TestResultCard";
import { UploadPackage, type UploadFacility } from "@/components/UploadPackage";
import { computeKpis, currentCasefiles, isReopened, runDisabledReason } from "@/components/portfolioModel";
import { anonReader } from "@/lib/supabase/anon";
import { quarterLabel } from "@/lib/tests/extract-financials";

export const dynamic = "force-dynamic";
// The investigateException Server Action (startInvestigation) hosted on this
// route can exceed Vercel's 10s default; 60s is the Hobby ceiling. Normal page
// renders still return fast — this only raises the cap.
export const maxDuration = 60;

const must = (res: { data: unknown; error: { message: string } | null }, what: string): unknown => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data ?? null;
};

const num = (v: unknown): number | null => (v == null ? null : Number(v));
const dscr = (v: number | null): string => (v == null ? "—" : v.toFixed(2));

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
  recommendation: string | null;
  steps_count: number | null;
  created_at: string | null;
}
interface TermsRow {
  facility_id: string;
  terms: unknown;
  status: string;
}

/** Last day of the quarter before `today` (UTC): the most recent complete test period. */
function latestCompleteQuarterEnd(today: Date): string {
  const q = Math.floor(today.getUTCMonth() / 3);
  const year = q === 0 ? today.getUTCFullYear() - 1 : today.getUTCFullYear();
  const endMonthDay = ["12-31", "03-31", "06-30", "09-30"][q];
  return `${year}-${endMonthDay}`;
}

/**
 * The portfolio — the analyst's landing screen.
 *
 * It opens with the WORK, not the roster: the exceptions that need a decision or
 * an investigation, triaged by what the analyst has to do next. The borrower
 * roster (with each test's code-computed provenance) sits below, secondary.
 *
 * Server Component: reads only, with the anon key under the RLS read policy.
 * Every write goes through a route handler or a Server Action on the service
 * role.
 */
export default async function Home() {
  const db = anonReader();

  const [facilitiesRes, testsRes, exceptionsRes, documentsRes, casefilesRes, termsRes] = await Promise.all([
    db.from("facilities").select("id, borrower_name, industry").order("borrower_name", { ascending: true }),
    db.from("tests").select("id, facility_id, test_period_end, computed_dscr, reported_dscr, threshold, passed, variance_flagged, calc_id, calc_error").eq("run_id", "demo"),
    db.from("exceptions").select("id, facility_id, status, test_period_end, computed_dscr, reported_dscr, required_dscr, test_id"),
    db.from("documents").select("id, facility_id, doc_type, title, effective_date").order("effective_date", { ascending: true }),
    db.from("casefiles").select("id, exception_id, status, recommendation, steps_count, created_at").eq("run_id", "demo"),
    db.from("covenant_terms").select("facility_id, terms, status").eq("status", "approved"),
  ]);

  const facilities = (must(facilitiesRes, "select facilities") ?? []) as FacilityRow[];
  const tests = ((must(testsRes, "select tests") ?? []) as TestRow[]).map((t) => ({
    ...t,
    computed_dscr: num(t.computed_dscr),
    reported_dscr: num(t.reported_dscr),
    threshold: Number(t.threshold),
  }));
  const demoTestIds = new Set(tests.map((t) => t.id));
  const exceptions = ((must(exceptionsRes, "select exceptions") ?? []) as ExceptionRow[]).filter((e) =>
    demoTestIds.has(e.test_id),
  );
  const documents = (must(documentsRes, "select documents") ?? []) as (DocumentView & { facility_id: string })[];
  const casefiles = (must(casefilesRes, "select casefiles") ?? []) as CasefileRow[];
  const approvedTerms = (must(termsRes, "select covenant_terms") ?? []) as TermsRow[];

  const kpis = computeKpis({ exceptions, casefiles, tests });

  const periods = tests.map((t) => t.test_period_end).sort();
  const targetPeriod = periods[periods.length - 1] ?? latestCompleteQuarterEnd(new Date());

  const casefileByException = currentCasefiles(casefiles);
  const facilityName = new Map(facilities.map((f) => [f.id, f.borrower_name]));

  // Triage every open exception by what the analyst has to do next.
  const open = exceptions.filter((e) => e.status !== "closed");
  const items = open.map((e) => {
    const cf = casefileByException.get(e.id) ?? null;
    const state = !cf
      ? "investigate"
      : cf.status === "pending_review"
        ? "review"
        : cf.status === "investigating"
          ? "running"
          : cf.status === "awaiting_docs"
            ? "docs"
            : "decided"; // approved / overridden
    return { e, cf, state, borrower: facilityName.get(e.facility_id) ?? "Unknown borrower" };
  });
  const group = (s: string) => items.filter((i) => i.state === s);
  const review = group("review");
  const investigate = group("investigate");
  const running = group("running");
  const docs = group("docs");
  const actionable = review.length + investigate.length + running.length + docs.length;

  const uploadFacilities: UploadFacility[] = facilities.map((f) => ({ id: f.id, borrower_name: f.borrower_name }));

  return (
    <div className="space-y-12">
      {/* ---------------------------------------------------------------- header */}
      <header className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-prose space-y-1">
            <p className="text-label text-text-muted">Covenant monitoring · {quarterLabel(targetPeriod)}</p>
            <h1 className="text-title text-text">Portfolio</h1>
          </div>
          <RunTestButton
            label={`Run ${quarterLabel(targetPeriod)}`}
            endpoint="/api/tests/run-quarter"
            body={{ test_period_end: targetPeriod }}
          />
        </div>
        <p className="max-w-prose text-body text-text-secondary">
          Every test is computed by code from approved terms. The borrower&apos;s reported figure is evidence to
          reconcile against — never the trigger.
        </p>

        <StatBand
          stats={[
            { label: "Open exceptions", value: kpis.openExceptions, empty: "None open", tone: kpis.openExceptions ? "danger" : "muted" },
            { label: "Awaiting your review", value: kpis.pendingReview, empty: "None waiting", tone: kpis.pendingReview ? "human" : "muted" },
            { label: "Avg steps / case", value: kpis.avgSteps, empty: "—", tone: "muted" },
            { label: `Facilities tested`, value: kpis.facilitiesTested, empty: "Run the quarter", tone: "muted" },
          ]}
        />
      </header>

      {/* ------------------------------------------------- needs your attention */}
      <section aria-label="Needs your attention" className="space-y-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-section text-text">Needs your attention</h2>
          {actionable > 0 && (
            <span className="font-mono text-num text-text-muted">{actionable} open</span>
          )}
        </div>

        {actionable === 0 ? (
          <div className="rounded-lg border border-border bg-surface p-8 text-center">
            <p className="text-body text-text-secondary">Nothing waiting on you this quarter.</p>
            <p className="mt-1 text-label text-text-muted">
              Run the quarter or upload a borrower&apos;s package to test the next period.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <QueueGroup
              title="Awaiting your review"
              hint="The agent has finished. You decide."
              count={review.length}
            >
              {review.map(({ e, cf, borrower }) => (
                <QueueRow key={e.id} borrower={borrower} period={quarterLabel(e.test_period_end)} edge="human"
                  ours={num(e.computed_dscr)} required={num(e.required_dscr)}>
                  <RecommendationBadge recommendation={cf?.recommendation} />
                  <Link
                    href={`/casefiles/${cf!.id}`}
                    className="rounded-md border border-border-strong bg-human px-3 py-1 text-body font-medium leading-5 text-bg transition-colors duration-fast hover:bg-text"
                  >
                    Review
                  </Link>
                </QueueRow>
              ))}
            </QueueGroup>

            <QueueGroup
              title="Breaches to investigate"
              hint="Code found a shortfall. Start the agent to gather evidence."
              count={investigate.length}
            >
              {investigate.map(({ e, cf, borrower }) => (
                <QueueRow key={e.id} borrower={borrower} period={quarterLabel(e.test_period_end)} edge="danger"
                  ours={num(e.computed_dscr)} required={num(e.required_dscr)}>
                  <InvestigateButton exceptionId={e.id} status={e.status} hasCasefile={cf != null} />
                </QueueRow>
              ))}
            </QueueGroup>

            <QueueGroup title="In progress" hint="The agent is working." count={running.length}>
              {running.map(({ e, cf, borrower }) => (
                <QueueRow key={e.id} borrower={borrower} period={quarterLabel(e.test_period_end)} edge="model"
                  ours={num(e.computed_dscr)} required={num(e.required_dscr)}>
                  <span className="inline-flex items-center gap-2 text-label text-model-bright">
                    <span className="inline-block h-2 w-2 rounded-sm bg-model motion-safe:animate-pulse" aria-hidden="true" />
                    Investigating
                  </span>
                  <Link href={`/casefiles/${cf!.id}`} className="text-label text-text-secondary underline-offset-2 hover:underline">
                    Watch live
                  </Link>
                </QueueRow>
              ))}
            </QueueGroup>

            <QueueGroup title="Awaiting documents" hint="A review asked for more before deciding." count={docs.length}>
              {docs.map(({ e, cf, borrower }) => (
                <QueueRow key={e.id} borrower={borrower} period={quarterLabel(e.test_period_end)} edge="muted"
                  ours={num(e.computed_dscr)} required={num(e.required_dscr)}>
                  <Link href={`/casefiles/${cf!.id}`} className="text-label text-text-secondary underline-offset-2 hover:underline">
                    Open casefile
                  </Link>
                </QueueRow>
              ))}
            </QueueGroup>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------- roster */}
      <section aria-label="Borrowers" className="space-y-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-section text-text">Borrowers</h2>
          <span className="font-mono text-num text-text-muted">{facilities.length}</span>
        </div>

        {facilities.length === 0 ? (
          <p className="text-body text-text-secondary">No facilities on file. Board a covenant to add one.</p>
        ) : (
          <div className="space-y-4">
            {facilities.map((f) => {
              const terms = approvedTerms.find((t) => t.facility_id === f.id) ?? null;
              const hasApprovedTerms = terms != null;
              const facilityDocs = documents.filter((d) => d.facility_id === f.id);
              const test = tests.find((t) => t.facility_id === f.id && t.test_period_end === targetPeriod) ?? null;
              const notBoarded = facilityDocs.length; // detail lives in DocumentList

              return (
                <article key={f.id} className="overflow-hidden rounded-lg border border-border-strong bg-surface">
                  <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border px-5 py-4">
                    <h3 className="text-card text-text">
                      {f.borrower_name}
                      {f.industry && <span className="ml-2 text-label font-normal text-text-muted">{f.industry}</span>}
                    </h3>
                    <RunTestButton
                      label={test ? `Re-run ${quarterLabel(targetPeriod)}` : `Run ${quarterLabel(targetPeriod)}`}
                      endpoint="/api/tests/run"
                      body={{ facility_id: f.id, test_period_end: targetPeriod }}
                      disabledReason={runDisabledReason({ hasApprovedTerms })}
                    />
                  </header>

                  <div className="space-y-4 p-5">
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

                    <details className="group">
                      <summary className="flex cursor-pointer list-none items-center gap-2 text-label text-text-muted transition-colors hover:text-text-secondary">
                        <span className="transition-transform group-open:rotate-90" aria-hidden="true">›</span>
                        Documents on file ({notBoarded})
                      </summary>
                      <div className="mt-3">
                        <DocumentList
                          documents={facilityDocs.map((d) => ({ id: d.id, title: d.title, doc_type: d.doc_type, effective_date: d.effective_date }))}
                          approvedTerms={terms}
                        />
                      </div>
                    </details>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* -------------------------------------------------------------- upload */}
      <section aria-label="Upload a package" className="space-y-3">
        <h2 className="text-section text-text">Add a quarterly package</h2>
        <UploadPackage facilities={uploadFacilities} />
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

/** The header stat band: one bordered strip, dividers between, actionable counts tinted. */
function StatBand({
  stats,
}: {
  stats: { label: string; value: number | null; empty: string; tone: "danger" | "human" | "muted" }[];
}) {
  const tone = { danger: "text-danger", human: "text-human", muted: "text-text" } as const;
  return (
    <div className="grid grid-cols-2 divide-y divide-border rounded-lg border border-border bg-surface sm:grid-cols-4 sm:divide-y-0 sm:divide-x">
      {stats.map((s) => {
        const show = s.value != null && s.value > 0;
        return (
          <div key={s.label} className="px-5 py-4">
            <p className="text-label text-text-muted">{s.label}</p>
            {show ? (
              <p className={`mt-1 font-mono text-title ${tone[s.tone]}`}>{s.value}</p>
            ) : (
              <p className="mt-1 text-body text-text-muted">{s.empty}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A labelled group in the attention queue. Renders nothing when empty. */
function QueueGroup({
  title,
  hint,
  count,
  children,
}: {
  title: string;
  hint: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-3">
        <h3 className="text-label text-text">{title}</h3>
        <span className="text-label text-text-muted">{hint}</span>
      </div>
      <ul className="space-y-2">{children}</ul>
    </div>
  );
}

const EDGE = {
  danger: "border-l-danger",
  human: "border-l-border-strong",
  model: "border-l-model",
  muted: "border-l-border-strong",
} as const;

/** One triage row: borrower + period, the DSCR comparison, then its action(s). */
function QueueRow({
  borrower,
  period,
  ours,
  required,
  edge,
  children,
}: {
  borrower: string;
  period: string;
  ours: number | null;
  required: number | null;
  edge: keyof typeof EDGE;
  children: React.ReactNode;
}) {
  const short = ours != null && required != null ? (ours - required).toFixed(2) : null;
  return (
    <li
      className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-md border border-border border-l-2 ${EDGE[edge]} bg-surface px-4 py-3`}
    >
      <div className="grow">
        <p className="text-card text-text">{borrower}</p>
        <p className="text-label text-text-muted">{period}</p>
      </div>
      <dl className="flex items-center gap-6 font-mono text-num">
        <div>
          <dt className="text-label text-text-muted">Ours</dt>
          <dd className="text-code-bright">{dscr(ours)}</dd>
        </div>
        <div>
          <dt className="text-label text-text-muted">Required</dt>
          <dd className="text-text-secondary">{dscr(required)}</dd>
        </div>
        {short != null && (
          <div>
            <dt className="text-label text-text-muted">Short by</dt>
            <dd className="text-danger">{short}</dd>
          </div>
        )}
      </dl>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </li>
  );
}
