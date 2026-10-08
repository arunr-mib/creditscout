"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { InvestigateButton } from "./InvestigateButton";
import { RunTestButton } from "./RunTestButton";
import {
  TEST_RESULT_LABEL,
  queueCounts,
  reviewStatusOf,
  runDisabledReason,
  testResultOf,
  type PortfolioRow,
  type TestResult,
} from "./portfolioModel";

/**
 * The credit analysis queue: every loan, graded by what the analyst must do
 * next, with one action per row.
 *
 * TEST RESULT AND REVIEW STATUS ARE SEPARATE COLUMNS, deliberately. A failing
 * quarter stays "Below minimum" after a decision is recorded on it; collapsing
 * the two is how a screen ends up implying a breach stopped failing because
 * someone wrote down what they decided about it.
 *
 * Both columns are derived by `portfolioModel`, never here.
 */

const dscr = (v: number | null): string => (v == null ? "—" : `${v.toFixed(2)}x`);

const RESULT_TONE: Record<TestResult, string> = {
  below_minimum: "border-danger bg-danger-bg text-danger",
  meets_minimum: "border-success bg-success-bg text-success",
  not_tested: "border-border-strong text-text-muted",
};

const REVIEW_TONE: Record<string, string> = {
  human: "text-text",
  model: "text-model-bright",
  code: "text-code-bright",
  muted: "text-text-muted",
};

const DETAIL_TONE: Record<string, string> = {
  "Suggests resolution": "text-success",
  "Suggests escalation": "text-danger",
};

type Filter = "all" | "review" | "untested";

export function PortfolioTable({
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
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => queueCounts(rows), [rows]);

  const view = useMemo(() => {
    const byFilter =
      filter === "review"
        ? rows.filter((r) => r.status === "in_review")
        : filter === "untested"
          ? rows.filter((r) => testResultOf(r) === "not_tested")
          : rows;
    const q = query.trim().toLowerCase();
    return q === "" ? byFilter : byFilter.filter((r) => r.borrower.toLowerCase().includes(q));
  }, [rows, filter, query]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
            All loans · {counts.total}
          </FilterChip>
          <FilterChip active={filter === "review"} onClick={() => setFilter("review")}>
            Ready for review · {counts.readyForReview}
          </FilterChip>
          <FilterChip active={filter === "untested"} onClick={() => setFilter("untested")}>
            Untested · {counts.untested}
          </FilterChip>
        </div>
        <label className="flex items-center gap-2">
          <span className="sr-only">Search borrowers</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search borrowers…"
            className="w-64 rounded-md border border-border-strong bg-surface px-3 py-2 text-body text-text placeholder:text-text-muted"
          />
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border-strong bg-surface">
        <table className="w-full border-collapse text-left">
          <thead className="bg-surface-raised">
            <tr className="text-label text-text-muted">
              <th className="whitespace-nowrap px-4 py-3 font-medium">Borrower</th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-medium">Computed DSCR</th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-medium">Reported DSCR</th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-medium">Minimum</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">Test result</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">Review status</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">Next action</th>
            </tr>
          </thead>
          <tbody>
            {view.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-body text-text-muted">
                  No loans match that filter.
                </td>
              </tr>
            )}
            {view.map((r) => {
              const result = testResultOf(r);
              const review = reviewStatusOf(r);
              return (
                <tr key={r.facilityId} className="border-t border-border transition-colors duration-fast hover:bg-surface-raised">
                  <td className="px-4 py-3">
                    <p className="text-body text-text">{r.borrower}</p>
                    <p className="text-label text-text-muted">
                      {r.industry ?? "—"}
                      {r.termsVersion != null && <span className="ml-2 font-mono">· Terms v{r.termsVersion}</span>}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-num tabular-nums text-text">{dscr(r.ours)}</td>
                  <td className="px-4 py-3 text-right font-mono text-num tabular-nums text-text-secondary">{dscr(r.theirs)}</td>
                  <td className="px-4 py-3 text-right font-mono text-num tabular-nums text-text-secondary">{dscr(r.required)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex whitespace-nowrap items-center gap-2 rounded-full border px-3 py-px text-label ${RESULT_TONE[result]}`}>
                      <span aria-hidden="true">●</span>
                      {TEST_RESULT_LABEL[result]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className={`text-body ${REVIEW_TONE[review.tone]}`}>{review.label}</p>
                    {review.detail && (
                      <p className={`text-label ${DETAIL_TONE[review.detail] ?? "text-text-muted"}`}>{review.detail}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <RowAction row={r} targetPeriod={targetPeriod} targetLabel={targetLabel} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-label text-text-muted">
        <span aria-hidden="true">ⓘ </span>
        Test results reflect the approved terms used for the selected period.
      </p>
    </div>
  );
}

/**
 * One action per row, named for what it does next.
 *
 * A loan with no approved terms gets "Review terms" rather than a disabled run
 * button: nothing can be tested until someone approves its covenant, so the
 * covenant is the work.
 */
function RowAction({ row, targetPeriod, targetLabel }: { row: PortfolioRow; targetPeriod: string; targetLabel: string }) {
  // One width for every row action so the column reads as a column. Without it
  // "Review" sat visibly narrower than "View decision" and "Review terms".
  const base =
    "inline-flex min-w-[132px] items-center justify-center whitespace-nowrap rounded-md border border-border-strong px-3 py-2 text-body leading-5 transition-colors duration-fast";
  const primary = `${base} bg-human font-medium text-bg hover:bg-text`;
  const secondary = `${base} text-text hover:bg-surface-raised`;

  switch (row.status) {
    case "breach_investigate":
      return <InvestigateButton exceptionId={row.exceptionId!} status={row.exceptionStatus ?? "new"} hasCasefile={false} />;
    case "in_review":
      return (
        <Link href={`/casefiles/${row.casefileId}`} className={primary}>
          Review
        </Link>
      );
    case "investigating":
      return (
        <Link href={`/casefiles/${row.casefileId}`} className={secondary}>
          Watch live
        </Link>
      );
    case "awaiting_docs":
      return (
        <Link href={`/casefiles/${row.casefileId}`} className={secondary}>
          Open casefile
        </Link>
      );
    case "decided":
      return (
        <Link href={`/casefiles/${row.casefileId}`} className={secondary}>
          View decision
        </Link>
      );
    default: {
      // compliant / not_tested
      if (!row.hasApprovedTerms) {
        return (
          <Link href={`/facilities/${row.facilityId}/covenant-setup`} className={secondary}>
            Review terms
          </Link>
        );
      }
      return (
        <RunTestButton
          label={row.status === "compliant" ? `Re-run ${targetLabel}` : `Run ${targetLabel}`}
          endpoint="/api/tests/run"
          body={{ facility_id: row.facilityId, test_period_end: targetPeriod }}
          disabledReason={runDisabledReason({ hasApprovedTerms: row.hasApprovedTerms })}
        />
      );
    }
  }
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-2 text-label transition-colors duration-fast ${
        active ? "border-model bg-model-bg text-model-bright" : "border-border text-text-muted hover:text-text-secondary"
      }`}
    >
      {children}
    </button>
  );
}
