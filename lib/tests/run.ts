import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeDscr } from "../../calc/dscr.js";
import { isIsoDate, termsInForce, validateTerms, type TermsRow } from "../terms.ts";
import { readReportedDscr } from "./certificate.ts";
import {
  INPUT_LABELS,
  isQuarterEnd,
  normaliseLabel,
  readLabeledFigures,
  type Figure,
  type InputName,
  type LabeledFigures,
} from "./extract-financials.ts";

/**
 * The quarterly test. No model is involved anywhere in this file.
 *
 * For a borrower and a period: load the APPROVED terms in force, read the
 * financials with their citations, have the calculator produce OUR DSCR, and
 * reconcile the borrower's reported figure against it.
 *
 *   - OUR number decides `passed`. The borrower's figure is read, compared and
 *     recorded, and it never reaches the pass/fail decision.
 *   - Only approved terms govern. If none is in force the run is refused; it
 *     never falls back to a proposed row.
 *   - A missing input is missing evidence. It becomes `calc_error` with a NULL
 *     DSCR and NO exception: a zero in its place would fabricate a breach.
 *
 * Nothing here computes, rounds or adjusts a DSCR; that is `calc/dscr.js`.
 */

type Db = Pick<SupabaseClient, "from">;

export const DEFAULT_RUN_ID = "demo";
const MAX_RUN_ID_LENGTH = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const NO_APPROVED_TERMS = "Approve covenant terms first.";

/** An error that maps straight onto an HTTP status. */
export class RunTestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type Outcome = "compliant" | "variance_logged" | "exception" | "calc_error";

export interface TestResult {
  test_id: string;
  run_id: string;
  facility_id: string;
  test_period_end: string;
  covenant_terms_id: string;
  terms_version: number;
  /** OUR number. Null only when `calc_error` is set. */
  computed_dscr: number | null;
  /** The borrower's. Evidence only. Null when no certificate figure could be read. */
  reported_dscr: number | null;
  threshold: number;
  passed: boolean | null;
  /** computed - reported. Null when either side is missing. */
  variance: number | null;
  variance_flagged: boolean;
  calc_id: string | null;
  calc_error: string | null;
  outcome: Outcome;
  exception_id?: string;
}

export interface RunDeps {
  /** A service-role client. Defaults to `supabaseAdmin()`, loaded lazily so tests never import the server-only module. */
  client?: Db;
  newId?: () => string;
  loadTerms?: typeof termsInForce;
  readFigures?: typeof readLabeledFigures;
  readReported?: typeof readReportedDscr;
}

async function defaultClient(): Promise<Db> {
  const { supabaseAdmin } = await import("../supabase/server.ts");
  return supabaseAdmin();
}

// ------------------------------------------------------------- reconciliation

export interface Reconciliation {
  variance: number | null;
  variance_flagged: boolean;
  /** Ours passes and the borrower says it fails. */
  borrower_reports_failure: boolean;
  raise_exception: boolean;
  outcome: Outcome;
}

/** The tests table holds four decimals; compare in whole units of that so 1.35 - 1.30 is exactly 0.05, not 0.05000000000000004. */
const UNIT = 10_000;
const units = (x: number): number => Math.round(x * UNIT);

/**
 * Spec §4.1b. `passed` comes from the calculator and is taken as given: the
 * reported figure appears only in the variance and the self-reported-failure
 * check, never in the decision of whether WE pass.
 *
 *   ours fails                           -> exception
 *   ours passes, borrower reports failure -> exception (they may know something the documents do not show)
 *   ours passes, borrower overstates      -> variance logged, no exception
 *   ours passes, within tolerance         -> compliant, no action
 */
export function reconcile(input: {
  computed: number;
  passed: boolean;
  threshold: number;
  reported: number | null;
  tolerance: number;
}): Reconciliation {
  const { computed, passed, threshold, reported, tolerance } = input;
  if (reported === null) {
    return {
      variance: null,
      variance_flagged: false,
      borrower_reports_failure: false,
      raise_exception: !passed,
      outcome: passed ? "compliant" : "exception",
    };
  }
  const gap = units(computed) - units(reported);
  const variance = gap / UNIT;
  const variance_flagged = Math.abs(gap) > units(tolerance);
  const borrower_reports_failure = passed && units(reported) < units(threshold);
  const raise_exception = !passed || borrower_reports_failure;
  const outcome: Outcome = raise_exception ? "exception" : variance_flagged ? "variance_logged" : "compliant";
  return { variance, variance_flagged, borrower_reports_failure, raise_exception, outcome };
}

// -------------------------------------------------------------------- inputs

function validate(facilityId: unknown, periodEnd: unknown, runId: unknown): { facilityId: string; periodEnd: string; runId: string } {
  if (typeof facilityId !== "string" || !UUID.test(facilityId)) throw new RunTestError(400, "facility_id must be a UUID");
  if (!isIsoDate(periodEnd)) throw new RunTestError(400, "test_period_end must be a YYYY-MM-DD date");
  if (!isQuarterEnd(periodEnd)) {
    throw new RunTestError(400, "test_period_end must be a quarter end (03-31, 06-30, 09-30 or 12-31)");
  }
  const id = runId === undefined || runId === null ? DEFAULT_RUN_ID : runId;
  if (typeof id !== "string" || id.trim() === "" || id.length > MAX_RUN_ID_LENGTH) {
    throw new RunTestError(400, `run_id must be a non-empty string of at most ${MAX_RUN_ID_LENGTH} characters`);
  }
  return { facilityId, periodEnd, runId: id };
}

async function readTolerance(client: Db): Promise<number> {
  const { data, error } = await client.from("policy").select("value").eq("key", "variance_tolerance").maybeSingle();
  if (error) throw new Error(`read policy: ${error.message}`);
  const v = (data as { value?: unknown } | null)?.value;
  // The Risk Officer's lever. If it is absent or malformed there is no safe default to invent.
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
    throw new Error("policy.variance_tolerance is missing or not a non-negative number");
  }
  return v;
}

/** What the calculator is given, and the citation behind each figure in it. */
function assembleFinancials(
  terms: Record<string, unknown>,
  read: LabeledFigures,
): { financials: Record<string, unknown>; citations: Record<string, unknown>; relevantProblems: string[] } {
  const financials: Record<string, unknown> = {};
  const citations: Record<string, unknown> = {};
  const addbackAmounts: Record<string, number> = {};
  const addbackCitations: Record<string, { citation: string; quote: string }> = {};

  const cite = (f: Figure) => ({ citation: f.citation, quote: f.quote });
  for (const name of Object.keys(INPUT_LABELS) as InputName[]) {
    const f = read.inputs[name];
    if (f) {
      financials[name] = f.value;
      citations[name] = cite(f);
    }
  }

  // The TERMS name the add-backs that count. The financials may list others
  // (F1's restructuring charges are on file but not in the boarded v1 terms);
  // those are not read in, which is exactly what keeps the boarding-lag test honest.
  const named: string[] = [];
  const numerator = terms.numerator as { addbacks?: { name?: unknown }[] } | undefined;
  for (const a of numerator?.addbacks ?? []) {
    if (typeof a?.name !== "string") continue;
    const key = normaliseLabel(a.name);
    named.push(key);
    const f = read.addbacks[key];
    if (f) {
      addbackAmounts[a.name] = f.value;
      addbackCitations[a.name] = cite(f);
    }
  }
  financials.addback_amounts = addbackAmounts;
  citations.addbacks = addbackCitations;

  const relevant = new Set<string>([...Object.keys(INPUT_LABELS), ...named]);
  const relevantProblems = read.problems.filter((p) => relevant.has(p.field)).map((p) => {
    const label = p.field in INPUT_LABELS ? INPUT_LABELS[p.field as InputName] : p.field;
    return `${label}: ${p.reason}`;
  });
  return { financials, citations, relevantProblems };
}

function failMessage(e: { error: string }, problems: string[]): string {
  return problems.length > 0 ? `${e.error} (${problems.join("; ")})` : e.error;
}

const check = <T>(res: { data?: T | null; error: { message: string } | null }, what: string): T | null => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data ?? null;
};

// ------------------------------------------------------------------- the flow

export async function runTest(
  facilityId: string,
  periodEnd: string,
  runId?: string,
  deps: RunDeps = {},
): Promise<TestResult> {
  const input = validate(facilityId, periodEnd, runId);
  const client = deps.client ?? (await defaultClient());

  // 1. Approved terms in force for the period, or refuse. `termsInForce` reads
  //    approved and superseded rows only, so a proposed row cannot arrive here;
  //    the explicit status check is a second lock on the control, not a substitute.
  const row = await (deps.loadTerms ?? termsInForce)(client, input.facilityId, input.periodEnd);
  if (!row || (row.status !== "approved" && row.status !== "superseded")) {
    throw new RunTestError(409, `No approved covenant terms are in force for ${input.periodEnd}. ${NO_APPROVED_TERMS}`);
  }
  // A versioned row governs many quarters; the period is set per test.
  const terms: Record<string, unknown> = {
    ...row.terms,
    test_period: { ...(row.terms.test_period as object), period_end: input.periodEnd },
  };
  // A test row cannot exist without a threshold, so there is nothing to record against.
  const threshold = (terms.threshold as { min_dscr?: unknown } | undefined)?.min_dscr;
  if (typeof threshold !== "number" || !Number.isFinite(threshold)) {
    throw new Error(`approved terms ${row.id} carry no numeric threshold`);
  }

  // 2. Evidence: our figures with their citations, and the borrower's.
  const tolerance = await readTolerance(client);
  const read = await (deps.readFigures ?? readLabeledFigures)(input.facilityId, input.periodEnd);
  const reportedFigure = await (deps.readReported ?? readReportedDscr)(input.facilityId, input.periodEnd);
  const reported = reportedFigure ? reportedFigure.value : null;
  const { financials, citations, relevantProblems } = assembleFinancials(terms, read);

  // 3. Our number. Malformed terms and missing inputs are both missing evidence.
  const shape = validateTerms(terms);
  const calcId = (deps.newId ?? randomUUID)();
  const calc = shape.valid
    ? (computeDscr(terms, financials, { calcId }) as Record<string, any>)
    : { error: `approved terms failed shape validation: ${shape.errors.join("; ")}` };

  const base = {
    facility_id: input.facilityId,
    covenant_terms_id: row.id,
    test_period_end: input.periodEnd,
    run_id: input.runId,
  };
  const testsKey = "facility_id,test_period_end,run_id";

  // -- calculator refused: record why, no number, no exception.
  if ("error" in calc) {
    const calcError = failMessage(calc as { error: string }, relevantProblems);
    const rowOut = {
      ...base,
      computed_dscr: null,
      reported_dscr: reported,
      threshold,
      passed: null,
      variance: null,
      variance_flagged: false,
      calc_id: null,
      calc_error: calcError,
    };
    const saved = check(
      await client.from("tests").upsert(rowOut, { onConflict: testsKey }).select("id").single(),
      "write tests",
    ) as { id: string };
    return {
      test_id: saved.id,
      run_id: input.runId,
      facility_id: input.facilityId,
      test_period_end: input.periodEnd,
      covenant_terms_id: row.id,
      terms_version: row.version,
      computed_dscr: null,
      reported_dscr: reported,
      threshold,
      passed: null,
      variance: null,
      variance_flagged: false,
      calc_id: null,
      calc_error: calcError,
      outcome: "calc_error",
    };
  }

  const rec = reconcile({
    computed: calc.dscr,
    passed: calc.pass,
    threshold: calc.threshold,
    reported,
    tolerance,
  });

  // 4. Log first. A number nobody can trace is one the guardrail cannot vouch for.
  check(
    await client.from("calc_log").insert({
      calc_id: calcId,
      casefile_id: null,
      test_id: null, // linked below: the tests row does not exist yet, and tests.calc_id needs this row first
      inputs: {
        terms,
        financials,
        citations,
        reported: reportedFigure
          ? { dscr: reportedFigure.value, citation: reportedFigure.citation, quote: reportedFigure.quote }
          : null,
      },
      outputs: calc,
      calculator_version: calc.calculator_version,
    }),
    "write calc_log",
  );

  // 5. The test row. Upsert on the unique key, so a re-run updates rather than duplicates.
  //    Every column is written, so a re-run can never leave a stale value behind.
  const saved = check(
    await client
      .from("tests")
      .upsert(
        {
          ...base,
          computed_dscr: calc.dscr,
          reported_dscr: reported,
          threshold: calc.threshold,
          passed: calc.pass,
          variance: rec.variance,
          variance_flagged: rec.variance_flagged,
          calc_id: calcId,
          calc_error: null,
        },
        { onConflict: testsKey },
      )
      .select("id")
      .single(),
    "write tests",
  ) as { id: string };
  check(await client.from("calc_log").update({ test_id: saved.id }).eq("calc_id", calcId), "link calc_log to test");

  // 6. The exception, once per test.
  let exceptionId: string | undefined;
  if (rec.raise_exception) {
    const figures = {
      computed_dscr: calc.dscr,
      reported_dscr: reported,
      required_dscr: calc.threshold,
    };
    const existing = check(
      await client.from("exceptions").select("id").eq("test_id", saved.id).limit(1).maybeSingle(),
      "read exceptions",
    ) as { id: string } | null;
    if (existing) {
      // Refresh the figures only. The status belongs to the analyst's workflow.
      check(await client.from("exceptions").update(figures).eq("id", existing.id), "update exceptions");
      exceptionId = existing.id;
    } else {
      const created = check(
        await client
          .from("exceptions")
          .insert({ facility_id: input.facilityId, test_id: saved.id, test_period_end: input.periodEnd, ...figures })
          .select("id")
          .single(),
        "write exceptions",
      ) as { id: string };
      exceptionId = created.id;
    }
  }

  return {
    test_id: saved.id,
    run_id: input.runId,
    facility_id: input.facilityId,
    test_period_end: input.periodEnd,
    covenant_terms_id: row.id,
    terms_version: row.version,
    computed_dscr: calc.dscr,
    reported_dscr: reported,
    threshold: calc.threshold,
    passed: calc.pass,
    variance: rec.variance,
    variance_flagged: rec.variance_flagged,
    calc_id: calcId,
    calc_error: null,
    outcome: rec.outcome,
    ...(exceptionId ? { exception_id: exceptionId } : {}),
  };
}
