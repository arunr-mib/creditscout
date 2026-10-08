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

/** The quarter end after `periodEnd`. DSCR is tested quarterly, so this is the next test. */
function nextQuarterEnd(periodEnd: string): string {
  const d = new Date(`${periodEnd}T00:00:00Z`);
  const nextQ = (Math.floor(d.getUTCMonth() / 3) + 1) % 4;
  const year = nextQ === 0 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
  return `${year}-${["03-31", "06-30", "09-30", "12-31"][nextQ]}`;
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
    db.from("casefiles").select("id, exception_id, status, recommendation, steps_count, created_at").eq("run_id", "demo"),
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
  const nextLabel = quarterLabel(nextQuarterEnd(targetPeriod));

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
    <div className="space-y-12">
      {/* ---------------------------------------------------------------- header */}
      <header className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-prose space-y-1">
            <p className="text-label text-text-muted">DSCR monitoring · {targetLabel}</p>
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

        <StatBand
          stats={[
            { label: "Ready for review", value: String(counts.readyForReview), tone: counts.readyForReview ? "human" : "muted" },
            // A ratio, not a bare count: "3" alone never says how much of the
            // book is still untested.
            { label: "Loans tested", value: `${counts.tested} of ${counts.total}`, tone: "muted" },
            { label: "Terms approval needed", value: String(counts.termsApprovalNeeded), tone: counts.termsApprovalNeeded ? "code" : "muted" },
          ]}
        />
      </header>

      {/* -------------------------------------------------------- portfolio table */}
      <section aria-label="Loans" className="space-y-3">
        {facilities.length === 0 ? (
          <p className="text-body text-text-secondary">No loans on file. Board a covenant to add one.</p>
        ) : (
          <PortfolioTable rows={rows} targetPeriod={targetPeriod} targetLabel={targetLabel} />
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

/**
 * The header KPIs as raised tiles (dark-native depth: surface-raised, no shadow).
 *
 * "Avg steps / case" is deliberately NOT here: it measures the agent, not the
 * portfolio, and belongs with the eval scoreboard on Governance (review 3).
 */
function StatBand({
  stats,
}: {
  stats: { label: string; value: string; tone: "danger" | "human" | "code" | "muted" }[];
}) {
  const tone = { danger: "text-danger", human: "text-human", code: "text-code-bright", muted: "text-text" } as const;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {stats.map((s) => (
        <div key={s.label} className="rounded-lg border border-border-strong bg-surface-raised px-4 py-4">
          <p className="text-label text-text-muted">{s.label}</p>
          <p className={`mt-1 font-mono text-title ${tone[s.tone]}`}>{s.value}</p>
        </div>
      ))}
    </div>
  );
}
