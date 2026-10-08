/**
 * The portfolio queue, as pure functions. No React, no I/O: the Server
 * Component and the Client Components only draw what this decides, and
 * `node --test` can exercise every rule here.
 *
 * What must not be wrong on this screen: which verdict a quarterly test gets,
 * the signed delta between our number and the borrower's, whether a document on
 * file has been boarded into the approved terms (the F1/F5 twist), the KPI
 * aggregations, whether an exception was reopened, and why a run button is
 * disabled. None of these is the control — `runTest` and the guardrails own the
 * numbers; this is the screen's reading of their output.
 */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// ----------------------------------------------------------- the verdict

/** The four states §12.1 draws for a quarterly test. `not_computed` is never 0.00 (§11). */
export type Verdict = "compliant" | "variance" | "breach" | "not_computed";

export interface TestLike {
  computed_dscr: number | null;
  passed: boolean | null;
  variance_flagged: boolean | null;
  calc_error: string | null;
}

/**
 * Classified from the stored test row, never by hand. A missing number comes
 * first: a calc_error, a null DSCR or a null `passed` is "not computed", and the
 * card must render an em dash, not a zero. Then our number decides: `passed`
 * false is a breach (the borrower's figure never enters this). A flagged
 * variance is noted but is not an alarm — the conclusion still stands.
 */
export function verdictOf(test: TestLike): Verdict {
  if (test.calc_error != null || test.computed_dscr == null || test.passed == null) return "not_computed";
  if (test.passed === false) return "breach";
  if (test.variance_flagged === true) return "variance";
  return "compliant";
}

// --------------------------------------------------------- variance badge

export interface VarianceView {
  /** e.g. "Δ +0.09" or "Δ 0.00". The sign is never dropped. */
  text: string;
  /** Beyond tolerance: amber, "variance logged". Within: muted. */
  flagged: boolean;
}

/**
 * §12.2. The signed delta is the borrower's figure relative to OURS
 * (`reported − computed`): a positive sign means the borrower reported a higher
 * ratio than the code computed — they overstated, which is the direction that
 * matters. Absent entirely when there is no borrower figure (or no number of
 * ours to compare against). `flagged` comes from the recorded tolerance test,
 * never recomputed here.
 */
export function varianceBadge(input: {
  computed: number | null;
  reported: number | null;
  flagged: boolean | null;
}): VarianceView | null {
  const { computed, reported } = input;
  if (reported == null || computed == null) return null;
  let delta = Math.round((reported - computed) * 100) / 100;
  if (Object.is(delta, -0)) delta = 0;
  const sign = delta > 0 ? "+" : "";
  return { text: `Δ ${sign}${delta.toFixed(2)}`, flagged: input.flagged === true };
}

// ------------------------------------------------------------- boarding

/** An amendment is either boarded into the approved terms, not boarded, or the flag does not apply. */
export type BoardingState = "boarded" | "not_boarded" | "not_applicable";

export interface DocLike {
  doc_type: string;
  title: string;
  effective_date: string | null;
}

/** Only the `effective_amendments` the approved terms carry matter here. */
export interface ApprovedTermsLike {
  terms: unknown;
}

/**
 * The F1/F5 mechanic, derived — never hardcoded. An amendment document on file
 * is "boarded" only when the approved terms in force actually carry it: an
 * `effective_amendments` entry matching it by document title or by effective
 * date. An amendment on file that the approved terms do not reflect is
 * `not_boarded`, and that lag is exactly what the agent is about to catch and
 * what an analyst should be able to see too. Non-amendment documents never
 * carry the flag.
 *
 * With no approved terms at all, an amendment cannot have been boarded, so it
 * reads `not_boarded`.
 */
export function boardingState(doc: DocLike, approved: ApprovedTermsLike | null): BoardingState {
  if (doc.doc_type !== "amendment") return "not_applicable";
  const terms = approved && isObj(approved.terms) ? approved.terms : null;
  const amendments = terms && Array.isArray(terms.effective_amendments) ? terms.effective_amendments : [];
  const boarded = amendments.some(
    (a: unknown) =>
      isObj(a) &&
      ((typeof a.doc === "string" && a.doc === doc.title) ||
        (typeof a.effective === "string" && doc.effective_date != null && a.effective === doc.effective_date)),
  );
  return boarded ? "boarded" : "not_boarded";
}

// ----------------------------------------------------------------- KPIs

export interface ExceptionLike {
  status: string;
}
export interface CasefileLike {
  status: string;
  steps_count: number | null;
}

export interface KpiView {
  openExceptions: number;
  pendingReview: number;
  /** Null when no case has been through investigation yet — the tile then names the next action. */
  avgSteps: number | null;
  facilitiesTested: number;
}

/** An exception is "open" until it is closed. */
const OPEN_EXCEPTION_STATUSES = ["new", "investigating", "pending_review", "needs_filing"];
/** A case counts toward the step average once it has reached review or a decision. */
const REVIEWED_CASEFILE_STATUSES = ["pending_review", "approved", "overridden"];

export function computeKpis(input: {
  exceptions: ExceptionLike[];
  casefiles: CasefileLike[];
  tests: { facility_id: string }[];
}): KpiView {
  const openExceptions = input.exceptions.filter((e) => OPEN_EXCEPTION_STATUSES.includes(e.status)).length;
  const pendingReview = input.casefiles.filter((c) => c.status === "pending_review").length;
  const reviewed = input.casefiles.filter(
    (c) => REVIEWED_CASEFILE_STATUSES.includes(c.status) && typeof c.steps_count === "number",
  );
  const avgSteps =
    reviewed.length === 0 ? null : Math.round(reviewed.reduce((s, c) => s + (c.steps_count ?? 0), 0) / reviewed.length);
  const facilitiesTested = new Set(input.tests.map((t) => t.facility_id)).size;
  return { openExceptions, pendingReview, avgSteps, facilitiesTested };
}

// ------------------------------------------------------------ reopened

/**
 * F7 reopens a closed breach to status `new` while keeping its linked casefile,
 * and records no explicit "was closed" flag. So the heuristic (ledger carry): an
 * exception back in status `new` that already HAS a linked casefile was
 * reopened — a genuinely fresh exception has no casefile yet.
 */
export function isReopened(exception: { status: string }, hasCasefile: boolean): boolean {
  return exception.status === "new" && hasCasefile;
}

// --------------------------------------------------------- run disabled

/** §12.10's inline reason. A run button is never silently disabled. */
export const APPROVE_TERMS_FIRST = "Approve covenant terms first";

export function runDisabledReason(input: { hasApprovedTerms: boolean }): string | null {
  return input.hasApprovedTerms ? null : APPROVE_TERMS_FIRST;
}

/**
 * One casefile per exception for the queue: the live one — newest that is
 * neither superseded nor failed. `superseded` is history and `failed` is a dead
 * attempt (a re-run that could not start, say); letting either win would feed
 * stale state to `hasCasefile` / `isReopened` and hide the real recommendation.
 * The one-live-per-exception index guarantees at most one such casefile, so an
 * exception whose only casefiles are failed/superseded correctly gets none —
 * which reads as "investigate" rather than a broken run.
 */
export function currentCasefiles<T extends { exception_id: string; status: string; created_at?: string | null }>(
  rows: readonly T[],
): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of rows) {
    if (r.status === "superseded" || r.status === "failed") continue;
    const held = out.get(r.exception_id);
    if (!held || (r.created_at ?? "") > (held.created_at ?? "")) out.set(r.exception_id, r);
  }
  return out;
}

// ------------------------------------------------------- the portfolio table

/**
 * One borrower's standing in the portfolio, graded. The order of the union is
 * the triage order (most urgent first), which `PORTFOLIO_STATUS[...].rank`
 * mirrors so a sort and the badge never disagree.
 */
export type PortfolioStatus =
  | "breach_investigate"
  | "in_review"
  | "investigating"
  | "awaiting_docs"
  | "decided"
  | "compliant"
  | "not_tested";

/**
 * The badge for each status: a word AND an icon, never colour alone (design.md
 * §5). `needsAction` drives the table's "Needs action" filter; `rank` drives its
 * default sort.
 */
export const PORTFOLIO_STATUS: Record<
  PortfolioStatus,
  { label: string; tone: "danger" | "human" | "model" | "success" | "muted"; icon: string; rank: number; needsAction: boolean }
> = {
  breach_investigate: { label: "Breach — investigate", tone: "danger", icon: "↑", rank: 0, needsAction: true },
  in_review: { label: "In review", tone: "human", icon: "•", rank: 1, needsAction: true },
  investigating: { label: "Investigating", tone: "model", icon: "◆", rank: 2, needsAction: true },
  awaiting_docs: { label: "Awaiting docs", tone: "human", icon: "?", rank: 3, needsAction: true },
  decided: { label: "Decided", tone: "muted", icon: "✓", rank: 4, needsAction: false },
  compliant: { label: "Compliant", tone: "success", icon: "✓", rank: 5, needsAction: false },
  not_tested: { label: "Not tested", tone: "muted", icon: "—", rank: 6, needsAction: false },
};

export interface PortfolioRow {
  facilityId: string;
  borrower: string;
  industry: string | null;
  termsVersion: number | null;
  hasApprovedTerms: boolean;
  /** Our code-computed DSCR (amber), the borrower's reported figure, and the requirement. */
  ours: number | null;
  theirs: number | null;
  required: number | null;
  status: PortfolioStatus;
  /** The casefile to open, when an exception has one. */
  casefileId: string | null;
  exceptionId: string | null;
  exceptionStatus: string | null;
  recommendation: string | null;
}

const toNum = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));

/**
 * The portfolio table's rows: every facility, graded by what the analyst has to
 * do next. An OPEN exception decides the status (its casefile's state, or
 * "investigate" when it has none yet); with no open exception, a test for the
 * period reads as "compliant", and no test reads as "not tested". Pure: the page
 * supplies already-filtered open exceptions and the live casefile per exception.
 */
export function portfolioRows(input: {
  facilities: { id: string; borrower_name: string; industry: string | null }[];
  /** ALL exceptions for the demo (open AND closed) — a closed/decided breach must read "Decided", never "Compliant". */
  exceptions: { id: string; facility_id: string; status: string; test_period_end: string; computed_dscr: unknown; reported_dscr: unknown; required_dscr: unknown }[];
  casefileByException: Map<string, { id: string; status: string; recommendation: string | null }>;
  tests: { facility_id: string; test_period_end: string; computed_dscr: number | null; reported_dscr: number | null; threshold: number; passed: boolean | null }[];
  approvedTerms: { facility_id: string; version: number }[];
  targetPeriod: string;
}): PortfolioRow[] {
  const rows = input.facilities.map((f): PortfolioRow => {
    const terms = input.approvedTerms.find((t) => t.facility_id === f.id) ?? null;
    // The exception for THIS period, open or closed — so a decided breach is
    // graded "Decided", not collapsed into "Compliant" because it is no longer open.
    const ex = input.exceptions.find((e) => e.facility_id === f.id && e.test_period_end === input.targetPeriod) ?? null;
    const cf = ex ? input.casefileByException.get(ex.id) ?? null : null;
    const test = input.tests.find((t) => t.facility_id === f.id && t.test_period_end === input.targetPeriod) ?? null;

    let status: PortfolioStatus;
    let ours: number | null;
    let theirs: number | null;
    let required: number | null;
    if (ex) {
      ours = toNum(ex.computed_dscr);
      theirs = toNum(ex.reported_dscr);
      required = toNum(ex.required_dscr);
      status =
        ex.status === "closed"
          ? "decided"
          : !cf
            ? "breach_investigate"
            : cf.status === "pending_review"
              ? "in_review"
              : cf.status === "investigating"
                ? "investigating"
                : cf.status === "awaiting_docs"
                  ? "awaiting_docs"
                  : "decided";
    } else if (test && test.passed === true) {
      // Compliant ONLY on a genuine pass. A failing test always has an exception
      // (handled above), so this branch cannot mislabel a breach.
      ours = test.computed_dscr;
      theirs = test.reported_dscr;
      required = test.threshold;
      status = "compliant";
    } else {
      ours = null;
      theirs = null;
      required = null;
      status = "not_tested";
    }

    return {
      facilityId: f.id,
      borrower: f.borrower_name,
      industry: f.industry,
      termsVersion: terms?.version ?? null,
      hasApprovedTerms: terms != null,
      ours,
      theirs,
      required,
      status,
      casefileId: cf?.id ?? null,
      exceptionId: ex?.id ?? null,
      exceptionStatus: ex?.status ?? null,
      recommendation: cf?.recommendation ?? null,
    };
  });
  // Default order: triage rank, then borrower.
  return rows.sort((a, b) => PORTFOLIO_STATUS[a.status].rank - PORTFOLIO_STATUS[b.status].rank || a.borrower.localeCompare(b.borrower));
}

// -------------------------------------------- test result vs review status

/**
 * THE TEST OUTCOME, which is not the review state.
 *
 * A failing quarter stays failing after an analyst records a decision on it —
 * conflating the two is how a screen ends up claiming a breach was "resolved"
 * when what happened is that a person wrote down what they decided about it.
 */
export type TestResult = "below_minimum" | "meets_minimum" | "not_tested";

export function testResultOf(row: Pick<PortfolioRow, "ours" | "required" | "status">): TestResult {
  if (row.status === "not_tested") return "not_tested";
  if (row.ours == null || row.required == null) return "not_tested";
  return row.ours < row.required ? "below_minimum" : "meets_minimum";
}

export const TEST_RESULT_LABEL: Record<TestResult, string> = {
  below_minimum: "Below minimum",
  meets_minimum: "Meets minimum",
  not_tested: "Not tested",
};

/** What the agent put forward, in an analyst's words. Null when it has not finished. */
const SUGGESTS: Record<string, string> = {
  resolve: "Suggests resolution",
  escalate: "Suggests escalation",
  request: "Suggests requesting documents",
  abstain: "Suggests no conclusion",
};

export interface ReviewStatusView {
  label: string;
  /** The agent's suggestion, shown under the label. Never the decision itself. */
  detail: string | null;
  tone: "human" | "model" | "code" | "muted";
}

/**
 * WHERE THE HUMAN DECISION STANDS.
 *
 * An untested loan with no approved terms is not merely untested — nothing can
 * be tested until someone approves its covenant terms, so that is the state
 * worth naming and the action worth offering.
 */
export function reviewStatusOf(
  row: Pick<PortfolioRow, "status" | "recommendation" | "hasApprovedTerms">,
): ReviewStatusView {
  switch (row.status) {
    case "in_review":
      return { label: "Ready for review", detail: SUGGESTS[row.recommendation ?? ""] ?? null, tone: "human" };
    case "investigating":
      return { label: "Investigating", detail: null, tone: "model" };
    case "awaiting_docs":
      return { label: "Awaiting documents", detail: null, tone: "human" };
    case "decided":
      return { label: "Decision recorded", detail: null, tone: "muted" };
    case "breach_investigate":
      return { label: "Not investigated", detail: null, tone: "code" };
    case "compliant":
      return { label: "No review needed", detail: null, tone: "muted" };
    case "not_tested":
      return row.hasApprovedTerms
        ? { label: "Not tested", detail: null, tone: "muted" }
        : { label: "Terms approval needed", detail: null, tone: "code" };
  }
}

/** Queue-level counts. `tested` is "3 of 5" — loans with a result this period. */
export function queueCounts(rows: readonly PortfolioRow[]): {
  readyForReview: number;
  tested: number;
  total: number;
  termsApprovalNeeded: number;
  untested: number;
} {
  return {
    readyForReview: rows.filter((r) => r.status === "in_review").length,
    tested: rows.filter((r) => testResultOf(r) !== "not_tested").length,
    total: rows.length,
    termsApprovalNeeded: rows.filter((r) => !r.hasApprovedTerms).length,
    untested: rows.filter((r) => testResultOf(r) === "not_tested").length,
  };
}
