/**
 * The eval scoreboard, as pure functions. No React, no I/O: the Server
 * Component and the Scoreboard only draw what this decides, and `node --test`
 * can exercise every rule here.
 *
 * This is the typed adapter between the `eval_runs.metrics` jsonb and the rows
 * the scoreboard renders. Stage 10's `evals/run.mjs` writes to THIS shape — the
 * metric keys below are the contract. A metric the run did not report renders as
 * missing (an em dash), never as a measured zero: an unrun metric is not a score.
 *
 * The success criteria are spec §2.2. Each maps to one key the eval writes:
 *
 *   false_resolves              gate, must be exactly 0 (spec §2.2 row 1)
 *   calc_accuracy               ratio, target 100% (row 2)
 *   outcome_accuracy            ratio, target ≥ 85% (row 3)
 *   abstain_accuracy            ratio, target ≥ 90% — correct abstain/request on
 *                               incomplete-evidence cases (row 4)
 *   citation_hit_rate           ratio, target ≥ 90% (row 5)
 *   groundedness                reported, no pass/fail (row 6, Foundry judge)
 *   avg_steps                   the memory effect — reported per run; the
 *                               reduction is read ACROSS the cold and warm
 *                               columns, not scored in one cell (row 7)
 *
 * Ratios are stored as fractions in [0,1] (1.0 == 100%); `avg_steps` is a step
 * count. If stage 10 chooses different key names, change them HERE and nowhere
 * else — the components never name a metric key.
 */

/** How a metric's actual is judged. */
export type MetricKind = "gate" | "ratio" | "reported" | "reduction";

/** The colour token an actual cell takes (§12.16). `neutral` is plain text — a reported number with no pass/fail. `missing` is an em dash. */
export type MetricStatus = "success" | "danger" | "neutral" | "missing";

export interface MetricSpec {
  key: string;
  label: string;
  /** Human display of the target, e.g. "≥ 90%", "0", "reported". */
  target: string;
  kind: MetricKind;
  /** For `ratio`: the minimum fraction that counts as met (0.9 == 90%). */
  threshold?: number;
}

/**
 * The metric set, in render order. Order is fixed so cold and warm columns line
 * up row for row; the VALUES are never here — they come from the `metrics`
 * object the eval wrote.
 */
export const METRICS: readonly MetricSpec[] = [
  // Labels are what a risk officer reads, not what the harness calls them.
  { key: "false_resolves", label: "Incorrect resolutions", target: "0", kind: "gate" },
  { key: "calc_accuracy", label: "Calculation accuracy", target: "100%", kind: "ratio", threshold: 1 },
  { key: "outcome_accuracy", label: "Outcome accuracy", target: "≥ 85%", kind: "ratio", threshold: 0.85 },
  { key: "abstain_accuracy", label: "Correct abstention or document request", target: "≥ 90%", kind: "ratio", threshold: 0.9 },
  { key: "citation_hit_rate", label: "Citation hit rate", target: "≥ 90%", kind: "ratio", threshold: 0.9 },
  { key: "groundedness", label: "Groundedness", target: "Report only", kind: "reported" },
  { key: "avg_steps", label: "Avg. steps per case", target: "Lower with lessons", kind: "reduction" },
] as const;

export interface MetricCell {
  key: string;
  label: string;
  target: string;
  kind: MetricKind;
  /** The raw number the eval reported, or null when it reported none for this key. */
  value: number | null;
  /** The formatted actual, or null when missing (the view renders an em dash). */
  display: string | null;
  status: MetricStatus;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A fraction in [0,1] shown as a whole-number percent; e.g. 0.857 -> "86%". */
function asPercent(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** A step count, kept to one decimal only when it has one; e.g. 6 -> "6", 5.5 -> "5.5". */
function asSteps(v: number): string {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function cellFor(spec: MetricSpec, value: number | null): MetricCell {
  const base = { key: spec.key, label: spec.label, target: spec.target, kind: spec.kind };
  if (value === null) return { ...base, value: null, display: null, status: "missing" };

  switch (spec.kind) {
    case "gate":
      // A gate, not a trend: 0 is the only pass, any non-zero fails, with no
      // softening — no amber, no "trending down" (§12.16).
      return { ...base, value, display: String(value), status: value === 0 ? "success" : "danger" };
    case "ratio": {
      const met = value >= (spec.threshold ?? 1);
      return { ...base, value, display: asPercent(value), status: met ? "success" : "danger" };
    }
    case "reported":
      // Groundedness is reported, not graded here — neutral, never coloured pass/fail.
      return { ...base, value, display: asPercent(value), status: "neutral" };
    case "reduction":
      // The memory effect is read across the cold/warm columns; one cell is just
      // the reported average, neutral.
      return { ...base, value, display: asSteps(value), status: "neutral" };
  }
}

/**
 * Map one run's `metrics` jsonb to the fixed row set. A metrics object that is
 * null, not an object, or missing a key yields a `missing` cell for that metric
 * — never a measured zero.
 */
export function scoreboardRows(metrics: unknown): MetricCell[] {
  const m = typeof metrics === "object" && metrics !== null && !Array.isArray(metrics) ? (metrics as Record<string, unknown>) : {};
  return METRICS.map((spec) => {
    const raw = m[spec.key];
    return cellFor(spec, isFiniteNumber(raw) ? raw : null);
  });
}

export interface EvalRunLike {
  mode: "cold" | "warm";
  metrics: unknown;
  created_at: string;
}

export interface ScoreboardState {
  /** "awaiting" until at least one run exists; the view shows the empty state naming the next action. */
  state: "awaiting" | "present";
  cold: EvalRunLike | null;
  warm: EvalRunLike | null;
}

/** The next action the awaiting-eval empty state names (design §8: an empty state states the next action). */
export const RUN_EVAL_HARNESS = "Run the eval harness — stage 10";

/** The latest run per mode. Empty until stage 10 runs the harness, so the honest primary state is `awaiting`. */
export function evalScoreboardState(runs: readonly EvalRunLike[] | null | undefined): ScoreboardState {
  const list = Array.isArray(runs) ? runs : [];
  const latest = (mode: "cold" | "warm"): EvalRunLike | null =>
    list
      .filter((r) => r.mode === mode)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
  const cold = latest("cold");
  const warm = latest("warm");
  return { state: cold || warm ? "present" : "awaiting", cold, warm };
}


// ------------------------------------------------- what the run actually was

/**
 * How many cases a run actually SCORED.
 *
 * Not the length of the array. The oracle lists every labelled case, including
 * ones the run skipped — the five onboarding borrowers are never seeded, so
 * they are listed and not investigated. `outcome_accuracy` is matched over
 * `counted`, so `counted` is the denominator behind the percentages and the
 * only number that belongs beside them. Reporting the array length would make
 * the sample look twice the size it is.
 */
export function caseCount(metrics: unknown): number | null {
  if (typeof metrics !== "object" || metrics === null) return null;
  const cases = (metrics as Record<string, unknown>).cases;
  if (!Array.isArray(cases)) return null;
  return cases.filter((c) => typeof c === "object" && c !== null && (c as Record<string, unknown>).counted === true).length;
}

/**
 * The run's own provenance: when it ran and over how many cases.
 *
 * Shown rather than omitted. A scoreboard with no date and no sample size
 * invites the reader to treat it as a standing property of the product; both
 * facts are in the row the harness wrote, so there is no reason to withhold
 * them — and at n=6 the sample size is the first thing an honest reader wants.
 */
export function runProvenance(runs: readonly EvalRunLike[] | null | undefined): { recordedAt: string | null; cases: number | null } {
  const list = Array.isArray(runs) ? runs : [];
  // BOTH FACTS FROM THE SAME ROW. Taking the newest date and the first
  // non-null case count independently paired "recorded 14 Oct" with a case
  // count from a different, older run — a provenance line that describes no
  // run that ever happened.
  let newest: EvalRunLike | null = null;
  for (const r of list) {
    const at = typeof r.created_at === "string" ? r.created_at : null;
    if (!at) continue;
    const held = typeof newest?.created_at === "string" ? newest.created_at : null;
    if (held === null || at > held) newest = r;
  }
  if (!newest) {
    // No row carries a usable stamp. A case count alone says nothing about
    // when it was measured, so neither is reported.
    return { recordedAt: null, cases: null };
  }
  return { recordedAt: newest.created_at as string, cases: caseCount(newest.metrics) };
}

// ------------------------------------------------ the paired case comparison

/**
 * The two conditions side by side, one row per case.
 *
 * Governance was rendering one table PER RUN — the same ten cases repeated,
 * most of them "not counted" em-dashes, several runs carrying no per-case
 * detail at all. An analyst comparing conditions had to hold two tables in
 * their head and scroll between them.
 *
 * "cold"/"warm" are the harness's words. An analyst reads "without prior
 * lessons" and "with prior lessons"; the identifiers stay in the technical
 * metadata.
 */
export interface CaseComparisonRow {
  caseId: string;
  /** The borrower, when the case id carries one. Fixture ids stay secondary. */
  expected: string | null;
  without: { recommendation: string | null; steps: number | null; matched: boolean | null } | null;
  with_: { recommendation: string | null; steps: number | null; matched: boolean | null } | null;
  /** Scored in at least one condition. Unscored cases are listed once, quietly. */
  counted: boolean;
}

interface RawCase {
  case_id?: unknown;
  expected_outcome?: unknown;
  recommendation?: unknown;
  steps?: unknown;
  outcome_match?: unknown;
  counted?: unknown;
}

const casesOf = (metrics: unknown): RawCase[] => {
  if (typeof metrics !== "object" || metrics === null) return [];
  const c = (metrics as Record<string, unknown>).cases;
  return Array.isArray(c) ? (c as RawCase[]) : [];
};

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * One row per case, both conditions joined on `case_id`.
 *
 * A case present in only one run still appears, with the missing side null —
 * dropping it would silently shrink the comparison.
 */
export function caseComparison(cold: EvalRunLike | null, warm: EvalRunLike | null): CaseComparisonRow[] {
  const c = casesOf(cold?.metrics);
  const w = casesOf(warm?.metrics);
  const order: string[] = [];
  const seen = new Set<string>();
  for (const row of [...c, ...w]) {
    const id = str(row.case_id);
    if (id && !seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  }
  const side = (rows: RawCase[], id: string) => {
    const r = rows.find((x) => str(x.case_id) === id);
    if (!r) return null;
    return {
      recommendation: str(r.recommendation),
      steps: num(r.steps),
      matched: typeof r.outcome_match === "boolean" ? r.outcome_match : null,
    };
  };
  return order.map((id) => {
    const inCold = c.find((x) => str(x.case_id) === id);
    const inWarm = w.find((x) => str(x.case_id) === id);
    return {
      caseId: id,
      expected: str(inCold?.expected_outcome) ?? str(inWarm?.expected_outcome),
      without: side(c, id),
      with_: side(w, id),
      counted: inCold?.counted === true || inWarm?.counted === true,
    };
  });
}

/**
 * The honest one-line read of the pair.
 *
 * Never asserts that lessons CAUSED a difference: two runs of five cases cannot
 * support that, and the measured history (60/100/60 cold across three runs) is
 * why. It states what changed and leaves the inference to the reader.
 */
export function comparisonSummary(
  cold: EvalRunLike | null,
  warm: EvalRunLike | null,
): { headline: string; detail: string } | null {
  const rows = caseComparison(cold, warm).filter((r) => r.counted);
  if (rows.length === 0) return null;
  const hit = (s: { matched: boolean | null } | null) => (s?.matched === true ? 1 : 0);
  const cHits = rows.reduce((n, r) => n + hit(r.without), 0);
  const wHits = rows.reduce((n, r) => n + hit(r.with_), 0);
  const d = wHits - cHits;
  const headline =
    d === 0
      ? "Both conditions matched the same number of expected outcomes"
      : d > 0
        ? "The run with prior lessons matched more expected outcomes"
        : "The run with prior lessons matched fewer expected outcomes";
  const word = Math.abs(d) === 1 ? "outcome" : "outcomes";
  const detail =
    d === 0
      ? `${cHits} of ${rows.length} scored cases in each condition.`
      : `${Math.abs(d)} additional expected ${word} ${d > 0 ? "matched with" : "missed with"} prior lessons, across ${rows.length} scored cases. Two runs cannot show that lessons caused the difference.`;
  return { headline, detail };
}
