import { findQuote, paragraphsOf, type Clause } from "./termsReview";

/**
 * Right pane, docs/design.md §5.4: the clause as written, the quoted span
 * marked. The analyst's job here is a two-second check that the quote is in the
 * clause and says what the term says it does, so the highlight is the point.
 *
 * It also answers the question a highlight alone cannot: WHICH PARTS OF THIS
 * CLAUSE NO TERM RESTS ON. A term that cites §7.11 for its minimum ratio says
 * nothing about §7.11(b) or (c), and a permitted add-back lives in exactly such
 * a paragraph. Each paragraph that no term's quote touches is marked, by code, so
 * the analyst sees what was left unread by the proposal rather than assuming a
 * cited clause is a covered one.
 *
 * Verbatim text is monospace (design.md §3) so evidence reads differently from
 * the interface's own prose.
 */
export function ClausePanel(props: {
  clause: Clause | null;
  /** The quote to mark strongly, when the clause is open because a term cites it. */
  quote?: string;
  /** Every quote any term cites inside this clause: what the paragraphs are judged against. */
  quotes?: string[];
  /** What opened it, in words: "cited for Minimum DSCR", or "not cited by any term". */
  reason?: string;
  /** A citation the term gave that resolves to no clause on file. */
  unresolved?: string;
}) {
  const { clause, quote, quotes = [], reason, unresolved } = props;

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
          Select a citation chip to read the clause it cites with the quoted span marked, or select a clause from the list
          to read it here.
        </p>
      </Shell>
    );
  }

  const text = clause.content;
  const span = quote ? findQuote(text, quote) : null;
  const spans = quotes.map((q) => findQuote(text, q)).filter((x): x is { start: number; end: number } => x !== null);
  const judged = quotes.length > 0;
  const paras = paragraphsOf(text, spans);
  const loose = judged ? paras.filter((p) => !p.heading && !p.rested).length : 0;
  const body = judged ? paras : [{ start: 0, end: text.length, heading: false, rested: true }];

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
        {judged && (
          <p className={`mt-2 font-mono text-label ${loose > 0 ? "text-code" : "text-text-muted"}`}>
            <span aria-hidden="true">⟡ </span>
            {loose > 0
              ? `by code · ${loose} of ${paras.filter((p) => !p.heading).length} paragraphs of this clause are not rested on by any term`
              : "by code · every paragraph of this clause is touched by some term's quote"}
          </p>
        )}
      </header>

      {quote && !span && (
        <div role="alert" className="mb-3 rounded-md border border-danger bg-danger-bg p-3 text-body text-danger">
          <span aria-hidden="true">✕ </span>
          The quote this term cites is not in this clause. Nothing below is highlighted for it, because nothing here
          supports the term.
        </div>
      )}

      <div id="clause-panel-text" className="font-mono text-quote text-text-secondary">
        {body.map((p, i) => {
          const para = text.slice(p.start, p.end);
          const inside = span && span.start < p.end && span.end > p.start ? { s: Math.max(span.start, p.start) - p.start, e: Math.min(span.end, p.end) - p.start } : null;
          const unrested = judged && !p.heading && !p.rested;
          return (
            <div key={i} className={`whitespace-pre-wrap ${unrested ? "my-2 border-l-4 border-code bg-code-bg p-2" : "my-1"}`}>
              {unrested && (
                <span className="mb-1 block font-mono text-badge uppercase tracking-wide text-code">
                  <span aria-hidden="true">⟡ </span>no term rests on this paragraph
                </span>
              )}
              {inside ? (
                <>
                  {para.slice(0, inside.s)}
                  <mark className="border-l-2 border-model bg-model-bg py-px pl-1 text-text">{para.slice(inside.s, inside.e)}</mark>
                  {para.slice(inside.e)}
                </>
              ) : (
                para
              )}
            </div>
          );
        })}
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
