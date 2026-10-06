import { bySection, groupOf, type ClauseGroup, type UncitedClause, type Warning } from "./termsReview";

const GROUP_TITLE: Record<ClauseGroup, string> = {
  amendment: "Amendments",
  covenant: "Definitions and the financial covenant article",
  other: "Other sections",
};

export const clauseKeyOf = (c: { doc_title: string | null; section: string | null }) => `${c.doc_title}|${c.section}`;

/**
 * Clauses no term cites.
 *
 * Provenance can prove that a value the model stated is supported by its quote.
 * It can never prove the model did not leave something out: a permitted
 * add-back, a cap, a carve-out. The only thing that catches an omission is a
 * person reading a clause no term mentions, so this section is the control, not
 * a detail panel. It always renders, it says what it is and is not claiming, and
 * it tells the reader which clauses the model never even saw.
 *
 * The list is the full set of agreement and amendment clauses the server holds
 * for this facility, not only what retrieval returned: retrieval is five queries
 * of a handful of clauses each, and a clause it never surfaced is exactly the one
 * that would otherwise appear nowhere.
 */
export function UncitedClauses(props: {
  uncited: UncitedClause[];
  /** How many agreement and amendment clauses are on file at all. */
  totalOnFile: number;
  /** Whether it is known which clauses the model was shown. */
  shownKnown: boolean;
  warnings: Warning[];
  opened: ReadonlySet<string>;
  selectedKey: string | null;
  onOpen: (clause: UncitedClause) => void;
}) {
  const { uncited, totalOnFile, shownKnown, warnings, opened, selectedKey, onOpen } = props;
  const groups: ClauseGroup[] = ["amendment", "covenant", "other"];
  const neverShown = uncited.filter((c) => c.shown === false).length;
  const openedCount = uncited.filter((c) => opened.has(clauseKeyOf(c))).length;

  return (
    <section id="uncited-clauses" aria-labelledby="uncited-title" className="space-y-3 rounded-md border border-border-strong border-l-4 border-l-code p-4">
      <div>
        <h2 id="uncited-title" className="text-section text-text">
          Clauses retrieved but not cited
        </h2>
        <p className="mt-1 text-body text-text-secondary">
          Every clause of the agreement and its amendments that the server holds for this facility and that no term cites
          ({totalOnFile} on file). This is the full set, not only what the model retrieved. Nothing has checked these: read
          them for an add-back, a cap or a carve-out that no term mentions.
        </p>
        <p className="mt-1 text-label text-text-muted">
          Waiver letters, compliance certificates and financials are not source documents and are not listed, and neither are
          one-line headings with nothing under them. Only the
          clauses on file when this page loaded are listed. A cited clause can still hold a paragraph no term rests on; the
          clause panel marks those.
        </p>
        {uncited.length > 0 && (
          <p className="mt-2 font-mono text-label text-code">
            <span aria-hidden="true">⟡ </span>counted by code · {uncited.length} clause{uncited.length === 1 ? "" : "s"} no term cites
            {shownKnown ? ` · ${neverShown} never shown to the model` : ""} · {openedCount} opened by you on this screen
          </p>
        )}
      </div>

      {totalOnFile === 0 && (
        <p role="alert" className="rounded-md border border-danger bg-danger-bg p-3 text-body text-danger">
          <span aria-hidden="true">✕ </span>
          No agreement or amendment clauses are on file for this facility, so there is nothing here to read. Do not treat
          that as a clean result.
        </p>
      )}
      {totalOnFile > 0 && uncited.length === 0 && (
        <p className="rounded-md border border-border-strong bg-surface p-3 text-body text-text-secondary">
          Every agreement and amendment clause on file is cited by at least one term. That does not show the terms are
          complete; read each cited clause in full, including the paragraphs the panel marks as resting on no term.
        </p>
      )}

      {groups.map((g) => {
        const items = uncited.filter((c) => groupOf(c) === g).sort(bySection);
        if (items.length === 0) return null;
        return (
          <div key={g}>
            <h3 className="text-label uppercase tracking-wide text-text-muted">
              {GROUP_TITLE[g]} ({items.length})
            </h3>
            <ul className="mt-2 space-y-2">
              {items.map((c) => {
                const key = clauseKeyOf(c);
                const [first, ...rest] = c.content.trim().split("\n");
                const flagged = warnings.filter((w) => w.citation === c.citation && w.code !== "definition_not_located");
                return (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => onOpen(c)}
                      aria-pressed={selectedKey === key}
                      className={`block w-full rounded-md border p-3 text-left transition-colors duration-fast ease-out hover:bg-surface-raised ${
                        selectedKey === key ? "border-model bg-surface-raised" : "border-border bg-surface"
                      }`}
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-label text-model">{c.citation} ↗</span>
                        {c.shown === false && (
                          <span className="rounded-sm bg-code-bg px-1 py-px font-mono text-badge text-code">
                            <span aria-hidden="true">⟡ </span>the model was not shown this clause
                          </span>
                        )}
                        {c.shown === true && <span className="text-badge text-text-muted">shown to the model</span>}
                        {opened.has(key) && <span className="text-badge text-human">opened</span>}
                      </span>
                      <span className="mt-1 block font-mono text-quote text-text-secondary">{first}</span>
                      {rest.join(" ").trim() !== "" && (
                        <span className="mt-1 block font-mono text-quote text-text-muted">
                          {rest.join(" ").trim().slice(0, 200)}
                          {rest.join(" ").trim().length > 200 ? "…" : ""}
                        </span>
                      )}
                    </button>
                    {flagged.map((w, i) => (
                      <p key={i} className="mt-1 rounded-sm border-l-4 border-code bg-code-bg p-2 text-body text-text-secondary">
                        <span className="font-mono text-label text-code">
                          <span aria-hidden="true">⟡ </span>flagged by the server&rsquo;s check ·{" "}
                        </span>
                        {w.message}
                      </p>
                    ))}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
