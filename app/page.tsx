import Link from "next/link";
import { PortfolioTable } from "@/components/PortfolioTable";
import { RunTestButton } from "@/components/RunTestButton";
import { UploadPackage, type UploadFacility } from "@/components/UploadPackage";
import { currentCasefiles, portfolioRows, queueCounts } from "@/components/portfolioModel";
import { anonReader } from "@/lib/supabase/anon";
import { quarterLabel } from "@/lib/tests/extract-financials";

export const dynamic = "force-dynamic";
// The investigateException / run Server Actions hosted on this route can exceed
// Vercel's 10s default; 60s is the Hobby ceiling. Reads still return fast.
export const maxDuration = 60;

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
  recommendation: string | null;
  steps_count: number | null;
  created_at: string | null;
  /** When the run last advanced. A gap means the browser driving it went away. */
  last_step_at: string | null;
}
interface TermsRow {
  facility_id: string;
  terms: unknown;
  status: string;
  version: number;
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
 * One triage table: every borrower, graded by what the analyst has to do next,
 * sortable, with a one-click action per row. Reads only, with the anon key under
 * the RLS read policy; every write goes through a route handler or Server Action
 * on the service role.
 */
export default async function Home() {
  const db = anonReader();

  const [facilitiesRes, testsRes, exceptionsRes, casefilesRes, termsRes] = await Promise.all([
    db.from("facilities").select("id, borrower_name, industry").order("borrower_name", { ascending: true }),
    db.from("tests").select("id, facility_id, test_period_end, computed_dscr, reported_dscr, threshold, passed, variance_flagged, calc_id, calc_error").eq("run_id", "demo"),
    db.from("exceptions").select("id, facility_id, status, test_period_end, computed_dscr, reported_dscr, required_dscr, test_id"),
    db.from("casefiles").select("id, exception_id, status, recommendation, steps_count, created_at, last_step_at").eq("run_id", "demo"),
    db.from("covenant_terms").select("facility_id, terms, status, version").eq("status", "approved"),
  ]);

  const facilities = (must(facilitiesRes, "select facilities") ?? []) as FacilityRow[];
  const tests = ((must(testsRes, "select tests") ?? []) as TestRow[]).map((t) => ({
    ...t,
    computed_dscr: num(t.computed_dscr),
    reported_dscr: num(t.reported_dscr),
    threshold: Number(t.threshold),
  }));
  const demoTestIds = new Set(tests.map((t) => t.id));
  const exceptions = ((must(exceptionsRes, "select exceptions") ?? []) as ExceptionRow[]).filter((e) => demoTestIds.has(e.test_id));
  const casefiles = (must(casefilesRes, "select casefiles") ?? []) as CasefileRow[];
  const approvedTerms = (must(termsRes, "select covenant_terms") ?? []) as TermsRow[];

  const periods = tests.map((t) => t.test_period_end).sort();
  const targetPeriod = periods[periods.length - 1] ?? latestCompleteQuarterEnd(new Date());
  const targetLabel = quarterLabel(targetPeriod);

  const casefileByException = currentCasefiles(casefiles);
  const rows = portfolioRows({
    facilities,
    exceptions,
    casefileByException,
    tests,
    approvedTerms,
    targetPeriod,
  });

  const counts = queueCounts(rows);
  const uploadFacilities: UploadFacility[] = facilities.map((f) => ({ id: f.id, borrower_name: f.borrower_name }));

  return (
    <div className="space-y-8">
      {/* ---------------------------------------------------------------- header */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-prose space-y-1">
            <p className="text-label text-text-muted">Covenant monitoring · {targetLabel}</p>
            <h1 className="text-title text-text">Credit Analysis Queue</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/borrowers/new" className="rounded-md border border-border-strong px-4 py-2 text-body font-medium leading-5 text-text transition-colors duration-fast hover:border-model">
              + Add borrower
            </Link>
            {/* The period this runs is in the eyebrow above, so the button names
                the action rather than repeating the quarter. */}
            <RunTestButton label="Run Covenant Tests" endpoint="/api/tests/run-quarter" body={{ test_period_end: targetPeriod }} showPlay />
          </div>
        </div>
        <p className="max-w-prose text-body text-text-secondary">
          Monitor covenant tests, investigate exceptions, and review recommendations with the evidence at hand.
        </p>

        <SummaryStrip
          items={[
            { label: "ready for analyst review", value: counts.readyForReview },
            // Counted separately and deliberately: an open breach with no
            // casefile is work, and the band used to omit it entirely.
            { label: "awaiting investigation", value: counts.awaitingInvestigation },
            // A ratio, not a bare count: "3" alone never says how much of the
            // book is still untested.
            { label: "loans tested", value: `${counts.tested} of ${counts.total}` },
            { label: "awaiting terms approval", value: counts.termsApprovalNeeded },
          ]}
        />
      </header>

      {/* -------------------------------------------------------- portfolio table */}
      <section aria-label="Loans" className="space-y-2">
        {facilities.length === 0 ? (
          <p className="text-body text-text-secondary">No loans on file. Board a covenant to add one.</p>
        ) : (
          <PortfolioTable rows={rows} targetPeriod={targetPeriod} targetLabel={targetLabel} />
        )}
      </section>

      {/* -------------------------------------------------------------- upload */}
      {/* The panel carries its own heading; a second one above it said the
          same words twice. */}
      <section aria-label="Add borrower documents">
        <UploadPackage facilities={uploadFacilities} />
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

/**
 * The header KPIs as raised tiles (dark-native depth: surface-raised, no shadow).
 *
 * "Avg steps / case" is deliberately NOT here: it measures the agent, not the
 * portfolio, and belongs with the eval scoreboard on Governance (review 3).
 */
/**
 * The work in front of the analyst, as one line rather than four tiles.
 *
 * The tiles were the largest thing on a screen whose job is the table beneath
 * them, and they pushed the queue below the fold. A zero is kept visually quiet
 * — nothing is drawn to a count of nothing to do.
 */
function SummaryStrip({
  items,
}: {
  items: { label: string; value: number | string }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3">
      {items.map((s, i) => {
        const zero = s.value === 0 || s.value === "0";
        return (
          // A divider is a border, not a character: as text it is read out by a
          // screen reader and audited for contrast it can never meet.
          <div key={s.label} className={`flex items-baseline gap-2 ${i > 0 ? "border-l border-border pl-6" : ""}`}>
            <span className={`text-num tabular-nums ${zero ? "text-text-muted" : "text-text"}`}>{s.value}</span>
            <span className={`text-body ${zero ? "text-text-muted" : "text-text-secondary"}`}>{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}
