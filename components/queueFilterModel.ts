/**
 * The Exceptions queue's filter bar, search and risk sort, as pure functions.
 * No React, no I/O — the table draws rows this module has already filtered
 * and ordered.
 */

import type { PortfolioRow, PortfolioStatus } from "./portfolioModel.ts";

export type QueueFilter = "all" | "needs_review" | "breaches" | "compliant" | "terms";

/** The pill bar, in display order. Counts come from `queueCounts()`. */
export const QUEUE_FILTERS: readonly { key: QueueFilter; label: string }[] = [
  { key: "all", label: "All loans" },
  { key: "needs_review", label: "Needs review" },
  { key: "breaches", label: "Breaches" },
  { key: "compliant", label: "In compliance" },
  { key: "terms", label: "Terms approval" },
];

/**
 * Same open-work set `queueCounts().breaches` counts: an open breach,
 * anything mid-investigation, or sitting in review. A `decided` breach has
 * already been through a human decision and does not belong here.
 */
const OPEN_BREACH_STATUSES: readonly PortfolioStatus[] = [
  "breach_investigate",
  "in_review",
  "investigating",
  "investigation_paused",
  "awaiting_docs",
];

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

/** Missing headroom sorts after every computed figure, worst first. */
const headroomValue = (row: Pick<PortfolioRow, "ours" | "required">): number =>
  row.ours == null || row.required == null ? Infinity : row.ours - row.required;

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

    const gapA = Math.abs((a.theirs ?? 0) - (a.ours ?? 0));
    const gapB = Math.abs((b.theirs ?? 0) - (b.ours ?? 0));
    return gapB - gapA;
  });
}
