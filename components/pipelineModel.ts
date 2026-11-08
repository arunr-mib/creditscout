/**
 * The home page's deal pipeline, as pure functions. No React, no I/O: the page
 * only draws what this decides.
 *
 * Four lanes sort the loans that need a person or the agent. Compliant and
 * untested loans are not in the pipeline at all — they are the portfolio rail's
 * business, not a lane's. The headroom bar is the loan's own minimum, never a
 * constant: it always sits at the bar's midpoint.
 */

import { isReopened, type PortfolioRow, type PortfolioStatus } from "./portfolioModel.ts";
import { activityTitle } from "./traceModel.ts";

export type LaneKey = "investigate" | "working" | "decision" | "decided";

export const LANES: readonly { key: LaneKey; title: string; empty: string }[] = [
  { key: "investigate", title: "Needs investigating", empty: "Nothing waiting." },
  { key: "working", title: "CreditScout working", empty: "Nothing running. Investigations move here live." },
  { key: "decision", title: "Awaiting your decision", empty: "Nothing waiting for you." },
  { key: "decided", title: "Decided", empty: "Nothing decided this quarter yet." },
];

/** How often the pipeline re-reads while an investigation may be running. */
export const PIPELINE_REFRESH_MS = 5000;

export interface PipelineCard {
  facilityId: string;
  borrower: string;
  ours: number | null;
  theirs: number | null;
  required: number | null;
  status: PortfolioStatus;
  casefileId: string | null;
  exceptionId: string | null;
  exceptionStatus: string | null;
  recommendation: string | null;
  /** A line under the borrower when the lane alone does not say enough. */
  note: string | null;
  action: "investigate" | "review" | "open" | null;
  reopened: boolean;
  /** The agent's latest activity titles, newest last. Empty unless supplied. */
  steps: string[];
}

/** Where each status lands. A status absent from this map is not in the pipeline. */
const LANE_OF: Partial<Record<PortfolioStatus, LaneKey>> = {
  breach_investigate: "investigate",
  investigating: "working",
  investigation_paused: "working",
  in_review: "decision",
  awaiting_docs: "decision",
  decided: "decided",
};

const NOTE_OF: Partial<Record<PortfolioStatus, string>> = {
  investigation_paused: "Investigation paused",
  awaiting_docs: "Held for borrower documents",
};

function actionOf(row: PortfolioRow): PipelineCard["action"] {
  switch (row.status) {
    case "breach_investigate":
      return "investigate";
    case "in_review":
    case "awaiting_docs":
      return "review";
    case "investigation_paused":
      return "open";
    case "decided":
      // Opening a decision needs a casefile to open.
      return row.casefileId ? "open" : null;
    default:
      return null;
  }
}

export function pipelineLanes(
  rows: PortfolioRow[],
  stepsByCasefile?: Map<string, string[]>,
): { key: LaneKey; title: string; empty: string; cards: PipelineCard[] }[] {
  const lanes = LANES.map((l) => ({ ...l, cards: [] as PipelineCard[] }));
  for (const row of rows) {
    const key = LANE_OF[row.status];
    if (!key) continue;
    const reopened = row.exceptionStatus != null && isReopened({ status: row.exceptionStatus }, row.casefileId != null);
    lanes.find((l) => l.key === key)!.cards.push({
      facilityId: row.facilityId,
      borrower: row.borrower,
      ours: row.ours,
      theirs: row.theirs,
      required: row.required,
      status: row.status,
      casefileId: row.casefileId,
      exceptionId: row.exceptionId,
      exceptionStatus: row.exceptionStatus,
      recommendation: row.recommendation,
      note: NOTE_OF[row.status] ?? null,
      action: actionOf(row),
      reopened,
      steps: (row.casefileId && stepsByCasefile?.get(row.casefileId)) || [],
    });
  }
  return lanes;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * The headroom bar. The loan's own minimum is the midpoint, so the fill is
 * `ours / (2 × required)`; a bar short of the tick is a breach whatever the
 * minimum is. No bar when either number is missing or the minimum is not positive.
 */
export function barGeometry(ours: number | null, required: number | null): { fillPct: number; minPct: 50 } | null {
  if (ours == null || required == null || !(required > 0)) return null;
  const fillPct = Math.min(100, Math.max(0, round1((ours / (2 * required)) * 100)));
  return { fillPct, minPct: 50 };
}

/** The titles of the last `n` tool calls in a trace, newest last. */
export function latestSteps(trace: unknown, n = 3): string[] {
  if (!Array.isArray(trace) || n <= 0) return [];
  return trace
    .filter((e): e is { tool: string } => typeof e === "object" && e !== null && typeof (e as { tool?: unknown }).tool === "string")
    .slice(-n)
    .map((e) => activityTitle(e.tool));
}
