import { findQuote, type Clause } from "./termsReview";

/**
 * Right pane, docs/design.md §5.4: the clause as written, the quoted span
 * marked. The analyst's job here is a two-second check that the quote is in the
 * clause and says what the term says it does, so the highlight is the point.
 *
 * Verbatim text is monospace (design.md §3) so evidence reads differently from
 * the interface's own prose.
 */
export function ClausePanel(props: {
  clause: Clause | null;
  /** The quote to mark, when the clause is open because a term cites it. */
  quote?: string;
  /** What opened it, in words: "cited for Minimum DSCR", or "not cited by any term". */
  reason?: string;
  /** A citation the term gave that resolves to no clause on file. */
  unresolved?: string;
}) {
  const { clause, quote, reason, unresolved } = props;

  if (unresolved) {
    return (
      <Shell>
        <div role="alert" className="rounded-md border border-danger bg-danger-bg p-3 text-body text-danger">
          <span aria-hidden="true">✕ </span>
          <span className="font-mono">{unresolved}</span> does not resolve to any clause on file for this facility, so
          there is nothing to check this term against.
        </div>
      </Shell>
    );
  }

  if (!clause) {
    return (
      <Shell>
        <p className="text-body text-text-muted">
          Select a citation chip to read the clause it cites with the quoted span marked, or select a clause from the list to read it here.
        </p>
      </Shell>
    );
  }

  const span = quote ? findQuote(clause.content, quote) : null;
  const text = clause.content;

  return (
    <Shell>
      <header className="mb-3 border-b border-border-strong pb-3">
        <p className="text-card text-text">
          {clause.doc_title ?? "Untitled document"} <span className="font-mono text-text-secondary">{clause.section}</span>
        </p>
        <p className="mt-1 font-mono text-label text-text-muted">
          {clause.citation}
          {clause.effective_date ? ` · effective ${clause.effective_date}` : ""}
        </p>
        {reason && <p className="mt-1 text-label text-text-muted">{reason}</p>}
      </header>

      {quote && !span && (
        <div role="alert" className="mb-3 rounded-md border border-danger bg-danger-bg p-3 text-body text-danger">
          <span aria-hidden="true">✕ </span>
          The quote this term cites is not in this clause. Nothing below is highlighted, because nothing here supports the
          term.
        </div>
      )}

      <div id="clause-panel-text" className="whitespace-pre-wrap font-mono text-quote text-text-secondary">
        {span ? (
          <>
            {text.slice(0, span.start)}
            <mark className="border-l-2 border-model bg-model-bg py-px pl-1 text-text">{text.slice(span.start, span.end)}</mark>
            {text.slice(span.end)}
          </>
        ) : (
          text
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <aside
      aria-label="Source clause"
      // Leaves room for the pinned approve bar; a height that depends on the viewport has no token.
      style={{ maxHeight: "calc(100vh - 240px)" }}
      className="sticky top-4 overflow-auto rounded-lg border border-border-strong bg-surface-raised p-4"
    >
      {children}
    </aside>
  );
}
