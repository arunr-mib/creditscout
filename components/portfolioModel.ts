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
