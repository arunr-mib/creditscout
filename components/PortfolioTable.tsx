"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { InvestigateButton } from "./InvestigateButton";
import { RecommendationBadge } from "./RecommendationBadge";
import { RunTestButton } from "./RunTestButton";
import { PORTFOLIO_STATUS, runDisabledReason, type PortfolioRow, type PortfolioStatus } from "./portfolioModel";

/**
 * The portfolio triage table (the Covenant-IQ "borrower table" idea, kept on our
 * dark system and our provenance): every facility, graded by what the analyst
 * must do next, sortable, with a one-click action per row. "Our DSCR" stays
 * amber — the reconcile-vs-reported point survives the table.
 *
 * Depth is dark-native: raised header, a per-row hover lift, and a left status
 * accent. No shadows (design.md §4).
 */

const BADGE_TONE: Record<string, string> = {
  danger: "border-danger bg-danger-bg text-danger",
  human: "border-border-strong bg-human-bg text-human",
  model: "border-model bg-model-bg text-model-bright",
  success: "border-success bg-success-bg text-success",
  muted: "border-border-strong text-text-muted",
};
const EDGE_TONE: Record<string, string> = {
  danger: "border-l-danger",
  human: "border-l-border-strong",
  model: "border-l-model",
  success: "border-l-success",
  muted: "border-l-border",
};

const dscr = (v: number | null): string => (v == null ? "—" : v.toFixed(2));

type SortKey = "status" | "borrower" | "ours" | "theirs";

export function PortfolioTable({
  rows,
  targetPeriod,
  targetLabel,
  nextLabel,
}: {
  rows: PortfolioRow[];
  /** Raw YYYY-MM-DD, for the run action body. */
  targetPeriod: string;
  /** Human label of the period under test, e.g. "Q2 2026". */
  targetLabel: string;
  /** Human label of the next period due. */
  nextLabel: string;
}) {
  const [onlyAction, setOnlyAction] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "status", dir: 1 });

  const view = useMemo(() => {
    const filtered = onlyAction ? rows.filter((r) => PORTFOLIO_STATUS[r.status].needsAction) : rows;
    const by = (r: PortfolioRow): number | string => {
      switch (sort.key) {
        case "borrower": return r.borrower.toLowerCase();
        case "ours": return r.ours ?? -Infinity;
        case "theirs": return r.theirs ?? -Infinity;
        default: return PORTFOLIO_STATUS[r.status].rank;
      }
    };
    return [...filtered].sort((a, b) => {
      const x = by(a);
      const y = by(b);
      return (x < y ? -1 : x > y ? 1 : a.borrower.localeCompare(b.borrower)) * sort.dir;
    });
  }, [rows, onlyAction, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir === 1 ? -1 : 1) as 1 | -1 } : { key, dir: 1 }));

  const actionCount = rows.filter((r) => PORTFOLIO_STATUS[r.status].needsAction).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip active={!onlyAction} onClick={() => setOnlyAction(false)}>All · {rows.length}</FilterChip>
        <FilterChip active={onlyAction} onClick={() => setOnlyAction(true)}>Needs action · {actionCount}</FilterChip>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border-strong bg-surface">
        <table className="w-full border-collapse text-left">
          <thead className="bg-surface-raised">
            <tr className="text-label text-text-muted">
              <Th onClick={() => toggleSort("borrower")} active={sort.key === "borrower"} dir={sort.dir}>Borrower</Th>
              <Th onClick={() => toggleSort("ours")} active={sort.key === "ours"} dir={sort.dir} numeric>Our DSCR</Th>
              <Th numeric>Theirs</Th>
              <Th numeric>Required</Th>
              <Th onClick={() => toggleSort("status")} active={sort.key === "status"} dir={sort.dir}>Status</Th>
              <Th>Next test</Th>
              <Th>Action</Th>
            </tr>
          </thead>
          <tbody>
            {view.map((r) => {
              const meta = PORTFOLIO_STATUS[r.status];
              return (
                <tr key={r.facilityId} className={`border-t border-border border-l-2 ${EDGE_TONE[meta.tone]} transition-colors duration-fast hover:bg-surface-raised`}>
                  <td className="px-4 py-3">
                    <p className="text-body text-text">{r.borrower}</p>
                    <p className="text-label text-text-muted">
                      {r.industry ?? "—"}
                      {r.termsVersion != null && <span className="ml-2 font-mono">Terms v{r.termsVersion}</span>}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-num text-code-bright">{dscr(r.ours)}</td>
                  <td className="px-4 py-3 text-right font-mono text-num text-text-secondary">{r.theirs == null ? "—" : dscr(r.theirs)}</td>
                  <td className="px-4 py-3 text-right font-mono text-num text-text-secondary">{dscr(r.required)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 rounded-sm border px-2 py-px text-label ${BADGE_TONE[meta.tone]}`}>
                      <span aria-hidden="true">{meta.icon}</span>
                      {meta.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-body text-text-secondary">{nextLabel}</p>
                    <p className="text-label text-text-muted">Quarterly</p>
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
    </div>
  );
}

function RowAction({ row, targetPeriod, targetLabel }: { row: PortfolioRow; targetPeriod: string; targetLabel: string }) {
  switch (row.status) {
    case "breach_investigate":
      return <InvestigateButton exceptionId={row.exceptionId!} status={row.exceptionStatus ?? "new"} hasCasefile={false} />;
    case "in_review":
      return (
        <div className="flex flex-wrap items-center gap-3">
          <RecommendationBadge recommendation={row.recommendation} />
          <Link href={`/casefiles/${row.casefileId}`} className="rounded-md border border-border-strong bg-human px-3 py-1 text-body font-medium leading-5 text-bg transition-colors duration-fast hover:bg-text">
            Review
          </Link>
        </div>
      );
    case "investigating":
      return (
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 text-label text-model-bright">
            <span className="inline-block h-2 w-2 rounded-sm bg-model motion-safe:animate-pulse" aria-hidden="true" />
            Investigating
          </span>
          <Link href={`/casefiles/${row.casefileId}`} className="text-label text-text-secondary underline-offset-2 hover:underline">Watch live</Link>
        </div>
      );
    case "awaiting_docs":
    case "decided":
      return (
        <Link href={`/casefiles/${row.casefileId}`} className="text-label text-text-secondary underline-offset-2 hover:underline">
          Open casefile
        </Link>
      );
    default: // compliant / not_tested
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

function Th({ children, onClick, active, dir, numeric }: { children: React.ReactNode; onClick?: () => void; active?: boolean; dir?: 1 | -1; numeric?: boolean }) {
  const align = numeric ? "text-right" : "text-left";
  if (!onClick) return <th className={`px-4 py-3 font-medium ${align}`}>{children}</th>;
  return (
    <th className={`px-4 py-3 font-medium ${align}`}>
      <button type="button" onClick={onClick} className={`inline-flex items-center gap-1 transition-colors hover:text-text-secondary ${active ? "text-text" : ""}`}>
        {children}
        {active && <span aria-hidden="true">{dir === 1 ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-1 text-label transition-colors duration-fast ${active ? "border-border-strong bg-surface-raised text-text" : "border-border text-text-muted hover:text-text-secondary"}`}
    >
      {children}
    </button>
  );
}
