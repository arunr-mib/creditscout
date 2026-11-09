"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { InvestigateButton } from "./InvestigateButton";
import { RunTestButton } from "./RunTestButton";
import { headroomOf } from "./queueFilterModel";
import {
  TEST_RESULT_LABEL,
  reviewStatusOf,
  runDisabledReason,
  testResultOf,
  type PortfolioRow,
  type TestResult,
} from "./portfolioModel";

/**
 * The risk-sorted queue table: every loan the caller hands it, one row each,
 * graded by what the analyst must do next.
 *
 * Presentational only — `rows` arrives already filtered, searched and sorted
 * (the filter bar and `queueFilterModel` own that). This component draws
 * what it is given, in that order, and nothing else.
 *
 * TEST RESULT AND REVIEW STATUS ARE SEPARATE COLUMNS, deliberately. A failing
 * quarter stays a "Breach" after a decision is recorded on it; collapsing
 * the two is how a screen ends up implying a breach stopped failing because
 * someone wrote down what they decided about it. Both are derived by
 * `portfolioModel`, never here.
 */

const dscr = (v: number | null): string => (v == null ? "—" : `${v.toFixed(2)}x`);

/**
 * Softly tinted, not outlined: on a light canvas a saturated outline reads as
 * an alert on every row. The glyph differs per state as well as the colour —
 * meaning is never carried by hue alone (design.md §2).
 */
const RESULT_TONE: Record<TestResult, string> = {
  below_minimum: "bg-danger-bg text-danger",
  meets_minimum: "bg-success-bg text-success",
  not_tested: "bg-surface-raised text-text-muted",
};
const RESULT_GLYPH: Record<TestResult, string> = {
  below_minimum: "▼",
  meets_minimum: "✓",
  not_tested: "–",
};

// `model*` is retired from the workspace (design.md §1) — the agent's own
// tone now reads in `agent-ink`, matching `AgentTag`, not the old teal.
const REVIEW_TONE: Record<string, string> = {
  human: "text-text",
  model: "text-agent-ink",
  code: "text-code-bright",
  muted: "text-text-muted",
};

const HEADROOM_TONE: Record<"pos" | "neg", string> = {
  pos: "text-success",
  neg: "text-danger",
};

// Mint marks the one action that opens the next piece of work on this screen
// — never a status, matching `PipelineCard`'s `ACTION_LINK`.
const MINT_ACTION =
  "inline-flex w-full items-center justify-center whitespace-nowrap rounded-lg border border-transparent bg-mint px-3 py-2 text-body font-medium leading-5 text-text transition-colors duration-fast ease-out hover:bg-mint-hover";

// Every other action still opens or re-runs something, but it is not THE
// primary call to act on this row — bordered neutral, matching the compact
// variant `RunTestButton` already uses for its own re-run action.
const NEUTRAL_ACTION =
  "inline-flex w-full items-center justify-center whitespace-nowrap rounded-lg border border-text bg-surface px-3 py-2 text-body font-medium leading-5 text-text transition-colors duration-fast ease-out hover:bg-surface-raised";

export function QueueTable({
  rows,
  targetPeriod,
  targetLabel,
}: {
  rows: PortfolioRow[];
  /** Raw YYYY-MM-DD, for the run action body. */
  targetPeriod: string;
  /** Human label of the period under test, e.g. "Q2 2026". */
  targetLabel: string;
}) {
  const router = useRouter();

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-card">
      <table className="w-full border-collapse text-left">
        <thead className="bg-surface-raised">
          <tr className="text-label uppercase tracking-wide text-text-muted">
            <th className="whitespace-nowrap px-3 py-2 font-medium">Borrower</th>
            <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Computed</th>
            <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Reported</th>
            <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Minimum</th>
            <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Variance</th>
            <th className="whitespace-nowrap px-3 py-2 font-medium">Result</th>
            <th className="whitespace-nowrap px-3 py-2 font-medium">Status</th>
            <th className="whitespace-nowrap px-3 py-2 font-medium">Next action</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-6 text-body text-text-muted">
                No loans match that filter.
              </td>
            </tr>
          )}
          {rows.map((r) => {
            const result = testResultOf(r);
            const review = reviewStatusOf(r);
            const headroom = headroomOf(r.ours, r.required);
            const navigable = r.casefileId != null;

            return (
              <tr
                key={r.facilityId}
                onClick={navigable ? () => router.push(`/casefiles/${r.casefileId}`) : undefined}
                className={`border-t border-border transition-colors duration-fast hover:bg-surface-raised ${
                  navigable ? "cursor-pointer" : ""
                }`}
              >
                <td className="px-3 py-3">
                  <p className="text-body text-text">{r.borrower}</p>
                  <p className="text-label text-text-muted">
                    {r.industry ?? "—"}
                    {r.termsVersion != null && <span className="ml-2 tabular-nums">· Terms v{r.termsVersion}</span>}
                  </p>
                </td>
                <td className="px-3 py-3 text-right text-num tabular-nums text-text">{dscr(r.ours)}</td>
                <td className="px-3 py-3 text-right text-num tabular-nums text-text-secondary">{dscr(r.theirs)}</td>
                <td className="px-3 py-3 text-right text-num tabular-nums text-text-secondary">{dscr(r.required)}</td>
                <td className={`px-3 py-3 text-right text-num tabular-nums ${headroom ? HEADROOM_TONE[headroom.tone] : "text-text-muted"}`}>
                  {headroom ? headroom.text : "—"}
                </td>
                <td className="px-3 py-3">
                  <span className={`inline-flex whitespace-nowrap items-center gap-2 rounded px-2 py-px text-label ${RESULT_TONE[result]}`}>
                    <span aria-hidden="true">{RESULT_GLYPH[result]}</span>
                    {TEST_RESULT_LABEL[result]}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <p className={`text-body ${REVIEW_TONE[review.tone]}`}>{review.label}</p>
                  {review.detail && <p className="text-label text-text-secondary">{review.detail}</p>}
                </td>
                <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                  {/* One width for the column whichever component renders the
                      action — Investigate and Run are their own components
                      and were sizing themselves. */}
                  <div className="w-[124px] [&>*]:w-full [&_a]:w-full [&_button]:w-full [&_button]:justify-center">
                    <RowAction row={r} targetPeriod={targetPeriod} targetLabel={targetLabel} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One action per row, named for what it does next.
 *
 * A loan with no approved terms gets "Review terms" rather than a disabled run
 * button: nothing can be tested until someone approves its covenant, so the
 * covenant is the work.
 *
 * Only the two statuses that put fresh work in front of the analyst — a
 * breach with no casefile yet, and a casefile ready for review — get the
 * mint fill. Everything else opens or re-runs something that is already
 * underway or already settled, so it stays bordered neutral.
 */
function RowAction({ row, targetPeriod, targetLabel }: { row: PortfolioRow; targetPeriod: string; targetLabel: string }) {
  // "Q2 2026" -> "Q2". Guards against a label with no space.
  const shortQuarter = targetLabel.split(" ")[0] || targetLabel;

  switch (row.status) {
    case "breach_investigate":
      return <InvestigateButton exceptionId={row.exceptionId!} status={row.exceptionStatus ?? "new"} hasCasefile={false} />;
    case "in_review":
      return (
        <Link href={`/casefiles/${row.casefileId}`} className={MINT_ACTION}>
          Review
        </Link>
      );
    case "investigating":
      return (
        <Link href={`/casefiles/${row.casefileId}`} className={NEUTRAL_ACTION}>
          Watch live
        </Link>
      );
    // Opening it resumes the drive, so the action is the resume.
    case "investigation_paused":
      return (
        <Link href={`/casefiles/${row.casefileId}`} className={NEUTRAL_ACTION}>
          Resume
        </Link>
      );
    case "awaiting_docs":
      return row.casefileId ? (
        <Link href={`/casefiles/${row.casefileId}`} className={NEUTRAL_ACTION}>
          Open casefile
        </Link>
      ) : (
        <span className="text-label text-text-muted">Awaiting documents</span>
      );
    case "decided":
      // `casefileId` is null when the exception was closed without one. The
      // grading above should prevent that reaching here; this makes a
      // regression a visibly inert cell rather than a link to /casefiles/null.
      return row.casefileId ? (
        <Link href={`/casefiles/${row.casefileId}`} className={NEUTRAL_ACTION}>
          View decision
        </Link>
      ) : (
        <span className="text-label text-text-muted">Closed</span>
      );
    default: {
      // compliant / not_tested
      if (!row.hasApprovedTerms) {
        return (
          <Link href={`/facilities/${row.facilityId}/covenant-setup`} className={NEUTRAL_ACTION}>
            Review terms
          </Link>
        );
      }
      return (
        <RunTestButton
          // Quarter only, no year: "Re-run Q2 2026" wraps to two lines in the
          // fixed-width action cell. The year is already in the page eyebrow.
          compact
          label={row.status === "compliant" ? `Re-run ${shortQuarter}` : `Run ${shortQuarter}`}
          endpoint="/api/tests/run"
          body={{ facility_id: row.facilityId, test_period_end: targetPeriod }}
          disabledReason={runDisabledReason({ hasApprovedTerms: row.hasApprovedTerms })}
        />
      );
    }
  }
}
