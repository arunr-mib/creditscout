/**
 * The Exceptions queue's filter bar, search and risk sort, as pure functions.
 * No React, no I/O — the table draws rows this module has already filtered
 * and ordered.
 */

import { OPEN_BREACH_STATUSES, type PortfolioRow, type queueCounts } from "./portfolioModel.ts";

export type QueueFilter = "all" | "needs_review" | "breaches" | "compliant" | "terms";

/** The pill bar, in display order. Counts come from `queueCounts()`. */
export const QUEUE_FILTERS: readonly { key: QueueFilter; label: string }[] = [
  { key: "all", label: "All loans" },
  { key: "needs_review", label: "Needs review" },
  { key: "breaches", label: "Breaches" },
  { key: "compliant", label: "In compliance" },
  { key: "terms", label: "Terms approval" },
];

/** Which `queueCounts()` field feeds each pill's count. */
export const COUNT_KEY: Record<QueueFilter, keyof ReturnType<typeof queueCounts>> = {
  all: "total",
  needs_review: "readyForReview",
  breaches: "breaches",
  compliant: "compliant",
  terms: "termsApprovalNeeded",
};

/**
 * The pill filter, then the search box, in that order. `"all"` applies no
 * status filter at all — the search box alone can still narrow it.
 */
export function applyQueueFilter(rows: PortfolioRow[], filter: QueueFilter, query: string): PortfolioRow[] {
  let out = rows;
  switch (filter) {
    case "all":
      break;
    case "needs_review":
      out = out.filter((r) => r.status === "in_review");
      break;
    case "breaches":
      out = out.filter((r) => OPEN_BREACH_STATUSES.includes(r.status));
      break;
    case "compliant":
      out = out.filter((r) => r.status === "compliant");
      break;
    case "terms":
      out = out.filter((r) => !r.hasApprovedTerms);
      break;
  }
  const q = query.trim().toLowerCase();
  if (q !== "") out = out.filter((r) => r.borrower.toLowerCase().includes(q));
  return out;
}

export interface HeadroomView {
  /** Signed, 2dp, e.g. "+0.24x" or "-0.13x". */
  text: string;
  tone: "pos" | "neg";
}

/**
 * Our number minus the requirement. Null when either figure is missing — a
 * loan with no computed DSCR or no requirement has no headroom to report,
 * never a headroom of zero.
 */
export function headroomOf(ours: number | null, required: number | null): HeadroomView | null {
  if (ours == null || required == null) return null;
  let diff = Math.round((ours - required) * 100) / 100;
  if (Object.is(diff, -0)) diff = 0;
  const tone: "pos" | "neg" = diff >= 0 ? "pos" : "neg";
  const sign = diff >= 0 ? "+" : "-";
  return { text: `${sign}${Math.abs(diff).toFixed(2)}x`, tone };
}

/**
 * Missing headroom sorts after every computed figure, worst first. Rounded
 * the same way `headroomOf` rounds for display, so two loans with different
 * minimums that happen to DISPLAY the same headroom compare as equal here too
 * — otherwise the drift tie-break below never fires for them, because the raw
 * floating-point difference is almost never exactly equal even when the
 * rounded, displayed figure is.
 */
const headroomValue = (row: Pick<PortfolioRow, "ours" | "required">): number =>
  row.ours == null || row.required == null ? Infinity : Math.round((row.ours - row.required) * 100) / 100;

/**
 * The queue's default order: the loan most worth looking at first. Worst
 * headroom leads; at equal headroom a declining loan (drift) outranks a
 * single bad quarter; the final tie-break is the larger gap between what the
 * borrower reported and what we computed — the bigger the discrepancy, the
 * more worth a second look. Loans with no figure at all sort last of all.
 * Returns a new array; `rows` is never mutated.
 */
export function sortByRisk(rows: PortfolioRow[], drift: Map<string, boolean>): PortfolioRow[] {
  return [...rows].sort((a, b) => {
    const ha = headroomValue(a);
    const hb = headroomValue(b);
    if (ha !== hb) return ha - hb;

    const da = drift.get(a.facilityId) ? -1 : 1;
    const db = drift.get(b.facilityId) ? -1 : 1;
    if (da !== db) return da - db;

    // A missing reported or computed figure has no real gap to report — never
    // defaulted to zero, which would otherwise manufacture a large, meaningless
    // "gap" against whichever real number the row does have.
    const gapA = a.theirs == null || a.ours == null ? 0 : Math.abs(a.theirs - a.ours);
    const gapB = b.theirs == null || b.ours == null ? 0 : Math.abs(b.theirs - b.ours);
    return gapB - gapA;
  });
}
