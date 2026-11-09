"use client";

import { BreachIcon, ComplianceIcon, TermsIcon } from "./queueIcons";
import { QUEUE_FILTERS, type QueueFilter } from "./queueFilterModel";
import type { queueCounts } from "./portfolioModel";

type Counts = ReturnType<typeof queueCounts>;
type Lens = "table" | "kanban";

/** Which `queueCounts()` field feeds each pill's count. */
const COUNT_KEY: Record<QueueFilter, keyof Counts> = {
  all: "total",
  needs_review: "readyForReview",
  breaches: "breaches",
  compliant: "compliant",
  terms: "termsApprovalNeeded",
};

/** "All loans" and "Needs review" stay unmarked: the word alone is the filter. */
const FILTER_ICON: Partial<Record<QueueFilter, (props: { className?: string }) => React.JSX.Element>> = {
  breaches: BreachIcon,
  compliant: ComplianceIcon,
  terms: TermsIcon,
};

/**
 * The Exceptions queue's filter bar: five status pills, a borrower search box,
 * and the table/kanban lens toggle. Purely presentational — every click goes
 * back up to `ExceptionsQueue`, which owns `filter`/`query`/`lens` state and
 * does the actual filtering (`queueFilterModel`). No data shaping here.
 */
export function QueueFilterBar({
  counts,
  active,
  onFilter,
  query,
  onQuery,
  lens,
  onLens,
}: {
  counts: Counts;
  active: QueueFilter;
  onFilter: (f: QueueFilter) => void;
  query: string;
  onQuery: (q: string) => void;
  lens: Lens;
  onLens: (l: Lens) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter loans">
        {QUEUE_FILTERS.map((f) => {
          const Icon = FILTER_ICON[f.key];
          const isActive = f.key === active;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => onFilter(f.key)}
              aria-pressed={isActive}
              className={`flex items-center gap-2 rounded-full px-3 py-1 text-body transition-colors duration-fast ${
                isActive
                  ? "bg-mint text-text"
                  : "border border-border-strong text-text-secondary hover:border-text hover:text-text"
              }`}
            >
              {Icon && <Icon className="h-4 w-4" />}
              <span>{f.label}</span>
              <span
                className={`rounded-full px-1 text-badge tabular-nums ${
                  isActive ? "bg-text/10 text-text" : "bg-surface-raised text-text-muted"
                }`}
              >
                {counts[COUNT_KEY[f.key]]}
              </span>
            </button>
          );
        })}
      </div>

      <label className="min-w-0 flex-1">
        <span className="sr-only">Search borrowers</span>
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search borrowers…"
          className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-body text-text placeholder:text-text-muted"
        />
      </label>

      <div className="flex shrink-0 items-center gap-1 rounded-full border border-border-strong p-1" role="group" aria-label="View">
        {(
          [
            { key: "table", label: "Table" },
            { key: "kanban", label: "Kanban" },
          ] as const
        ).map((l) => (
          <button
            key={l.key}
            type="button"
            onClick={() => onLens(l.key)}
            aria-pressed={lens === l.key}
            className={`rounded-full px-3 py-1 text-body transition-colors duration-fast ${
              lens === l.key ? "bg-brand text-brand-on" : "text-text-secondary hover:text-text"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}
