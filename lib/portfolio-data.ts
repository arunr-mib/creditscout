import { cache } from "react";
import { currentCasefiles, portfolioRows, queueCounts, type PortfolioRow } from "@/components/portfolioModel";
import { driftByFacility } from "@/components/driftModel";
import { anonReader } from "@/lib/supabase/anon";
import { quarterLabel } from "@/lib/tests/extract-financials";

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

export interface PortfolioData {
  rows: PortfolioRow[];
  facilities: { id: string; borrower_name: string; industry: string | null }[];
  targetPeriod: string;
  targetLabel: string;
  counts: ReturnType<typeof queueCounts>;
  /** `trace` for the casefiles that are investigating right now; every other casefile is absent. */
  traceByCasefile: Map<string, unknown>;
  /** Per facility: the computed DSCR has fallen across the quarterly test history. */
  drift: Map<string, boolean>;
}

/**
 * The whole portfolio read, once per request: the layout (for the rail) and the
 * page both call this and share the result. Reads only, with the anon key under
 * the RLS read policy.
 */
export const loadPortfolio = cache(async (): Promise<PortfolioData> => {
  const db = anonReader();

  const [facilitiesRes, testsRes, exceptionsRes, casefilesRes, termsRes, tracesRes] = await Promise.all([
    db.from("facilities").select("id, borrower_name, industry").order("borrower_name", { ascending: true }),
    db.from("tests").select("id, facility_id, test_period_end, computed_dscr, reported_dscr, threshold, passed, variance_flagged, calc_id, calc_error").eq("run_id", "demo"),
    db.from("exceptions").select("id, facility_id, status, test_period_end, computed_dscr, reported_dscr, required_dscr, test_id"),
    db.from("casefiles").select("id, exception_id, status, recommendation, steps_count, created_at, last_step_at").eq("run_id", "demo"),
    db.from("covenant_terms").select("facility_id, terms, status, version").eq("status", "approved"),
    db.from("casefiles").select("id, trace").eq("run_id", "demo").eq("status", "investigating"),
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
  const traces = (must(tracesRes, "select casefile traces") ?? []) as { id: string; trace: unknown }[];

  const periods = tests.map((t) => t.test_period_end).sort();
  const targetPeriod = periods[periods.length - 1] ?? latestCompleteQuarterEnd(new Date());
  const targetLabel = quarterLabel(targetPeriod);
  const drift = driftByFacility(tests);

  const casefileByException = currentCasefiles(casefiles);
  const rows = portfolioRows({
    facilities,
    exceptions,
    casefileByException,
    tests,
    approvedTerms,
    targetPeriod,
  });

  return {
    rows,
    facilities,
    targetPeriod,
    targetLabel,
    counts: queueCounts(rows),
    traceByCasefile: new Map(traces.map((c) => [c.id, c.trace])),
    drift,
  };
});
