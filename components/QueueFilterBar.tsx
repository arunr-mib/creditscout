"use client";

type Lens = "table" | "kanban";

/**
 * The Exceptions queue's search box and table/kanban lens toggle. The five
 * status filters moved into the portfolio rail (owner's call, 2026-11-09) —
 * this keeps only the two controls that don't belong in a left-nav list:
 * free-text search and the view switch. Purely presentational — every click
 * goes back up to `ExceptionsQueue`, which owns `query`/`lens` state.
 */
export function QueueFilterBar({
  query,
  onQuery,
  lens,
  onLens,
}: {
  query: string;
  onQuery: (q: string) => void;
  lens: Lens;
  onLens: (l: Lens) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
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
              lens === l.key ? "bg-mint text-text" : "text-text-secondary hover:text-text"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}
