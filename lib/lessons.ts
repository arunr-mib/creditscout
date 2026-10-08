/**
 * How a stored lesson reads to an analyst.
 *
 * The `reviews` table keeps the machine's words: `amendment_addback`,
 * `true_breach`, a decision of `approve`. None of those are what a credit
 * analyst says, and two of them are actively misleading on their own — an
 * `override` tells you a recommendation was rejected but NOT what was recorded
 * instead, and a lesson written by the eval harness is not a decision anyone
 * made. Everything here exists to stop the screen asserting more than the row
 * contains.
 */

export type LessonSource = "approved" | "override" | "evaluation";

export const SOURCE_LABEL: Record<LessonSource, string> = {
  approved: "Approved recommendation",
  override: "Analyst override",
  evaluation: "Evaluation example",
};

/** `casefiles.suggested_tag` / `reviews.pattern_tag` as a credit analyst reads it. */
export const PATTERN_LABEL: Record<string, string> = {
  amendment_addback: "Amendment add-back",
  true_breach: "Confirmed breach",
  period_mismatch: "Period mismatch",
  missing_waiver: "Missing waiver",
  borrower_calc_error: "Borrower calculation error",
  other: "Other pattern",
};

export const patternLabel = (tag: string | null): string | null =>
  tag == null ? null : (PATTERN_LABEL[tag] ?? tag.replace(/_/g, " "));

/**
 * Where the lesson came from.
 *
 * The eval harness writes reviews through the same path an analyst does, so the
 * ONLY thing separating them is the casefile's `run_id`. Without this check the
 * page presents a script's output as a lender's accumulated judgement — and
 * those lessons are retrieved into later investigations, so the claim would
 * compound rather than sit still.
 */
export function lessonSource(runId: string | null, decision: string): LessonSource {
  if (runId != null && runId.startsWith("eval")) return "evaluation";
  return decision === "override" ? "override" : "approved";
}

/**
 * What was actually recorded, which an override does not tell you by itself.
 *
 * `override` means the agent's recommendation was rejected; the outcome is the
 * analyst's `corrected_outcome`. `approve` means the agent's recommendation
 * stood, so the outcome is that recommendation. Either may be absent, and an
 * absent outcome is null — never the other one as a stand-in.
 */
export function recordedOutcome(
  decision: string,
  correctedOutcome: string | null,
  recommendation: string | null,
): string | null {
  if (decision === "override") return correctedOutcome ?? null;
  if (decision === "approve") return recommendation ?? null;
  return null;
}

export const OUTCOME_LABEL: Record<string, string> = {
  resolve: "Exception resolved",
  escalate: "Escalated",
  request: "More documents requested",
  abstain: "No conclusion reached",
};

export const outcomeLabel = (o: string | null): string | null => (o == null ? null : (OUTCOME_LABEL[o] ?? o));

/**
 * Is the stored text an analyst's own reasoning, or the system's summary of the
 * numbers?
 *
 * `storeLesson` composes a summary when a reviewer approves without typing
 * anything, and the eval harness writes its own rationale. Presenting either as
 * "analyst reasoning" is the specific dishonesty this guards: the screen says
 * what it has, and says plainly when it has none.
 */
export function isAnalystReasoning(source: LessonSource, reason: string | null): boolean {
  if (source === "evaluation") return false;
  return typeof reason === "string" && reason.trim() !== "";
}

export interface LessonRow {
  id: string;
  borrower: string;
  period: string;
  source: LessonSource;
  patternTag: string | null;
  outcome: string | null;
  /** The analyst's own words, or null when the record holds only a system summary. */
  analystReasoning: string | null;
  /** Whatever text the row stores, for the expandable detail. */
  storedText: string | null;
  casefileId: string;
  createdAt: string | null;
  /** The quarter's figures. `initial` is the test as approved terms produced it. */
  initialDscr: number | null;
  minimumDscr: number | null;
  reportedDscr: number | null;
}

export interface LessonGroup {
  key: string;
  borrower: string;
  period: string;
  /** Newest first. The first is shown; the rest are "Related records". */
  records: LessonRow[];
}

/**
 * Group repeated borrower/period entries without losing any of them.
 *
 * The same quarter can be reviewed more than once — a re-investigation, or an
 * eval pass over a case an analyst already decided. Collapsing them to one row
 * would hide history; listing them flat buries the borrower under near
 * duplicates. They are grouped, and every record is kept.
 */
export function groupLessons(rows: readonly LessonRow[]): LessonGroup[] {
  const byKey = new Map<string, LessonGroup>();
  for (const r of rows) {
    const key = `${r.borrower}::${r.period}`;
    const held = byKey.get(key);
    if (held) held.records.push(r);
    else byKey.set(key, { key, borrower: r.borrower, period: r.period, records: [r] });
  }
  for (const g of byKey.values()) {
    g.records.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  }
  return [...byKey.values()];
}
