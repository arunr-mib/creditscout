import { bySection, groupOf, type ClauseGroup, type Clause, type Warning } from "./termsReview";

const GROUP_TITLE: Record<ClauseGroup, string> = {
  amendment: "Amendments",
  covenant: "Definitions and the financial covenant article",
  other: "Other sections",
};

/**
 * Clauses retrieved but not cited.
 *
 * Provenance can prove that a value the model stated is supported by its quote.
 * It can never prove the model did not leave something out: a permitted
 * add-back, a cap, a carve-out. The only thing that catches an omission is a
 * person reading a clause no term mentions, so this section is the control, not
 * a detail panel. It always renders, and it says when it is empty and why.
 */
export function UncitedClauses(props: {
  uncited: Clause[];
  /** How many clauses there were to begin with, so "none left" can be told apart from "none given". */
  totalSeen: number;
  mode: "shown-to-model" | "on-file";
  warnings: Warning[];
  selectedKey: string | null;
  onOpen: (clause: Clause) => void;
}) {
  const { uncited, totalSeen, mode, warnings, selectedKey, onOpen } = props;
  const groups: ClauseGroup[] = ["amendment", "covenant", "other"];

  return (
    <section id="uncited-clauses" aria-labelledby="uncited-title" className="space-y-3">
      <div>
        <h2 id="uncited-title" className="text-section text-text">
          Clauses retrieved but not cited
        </h2>
        <p className="mt-1 text-body text-text-secondary">
          {mode === "shown-to-model"
            ? "These are clauses the model was shown that no term cites. A value can only be checked against a clause it cites, so nothing has checked these. Read them for an add-back, a cap or a carve-out that no term mentions."
            : "What the model was shown was not stored with this proposal, so this lists every agreement and amendment clause on file that no term cites. Nothing has checked them. Read them for an add-back, a cap or a carve-out that no term mentions."}
        </p>
        <p className="mt-1 text-label text-text-muted">
          A clause a term cites can still hold a provision no term uses. Read the whole clause around each highlight, not
          only the highlight.
        </p>
      </div>

      {totalSeen === 0 && (
        <p role="alert" className="rounded-md border border-danger bg-danger-bg p-3 text-body text-danger">
          <span aria-hidden="true">✕ </span>
          No clauses came back with this proposal, so there is nothing here to read. Do not treat that as a clean result.
        </p>
      )}
      {totalSeen > 0 && uncited.length === 0 && (
        <p className="rounded-md border border-border-strong bg-surface p-3 text-body text-text-secondary">
          Every clause listed is cited by at least one term. That does not show the terms are complete; read each cited
          clause in full.
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
                const key = `${c.doc_title}|${c.section}`;
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
                      <span className="font-mono text-label text-model">{c.citation} ↗</span>
                      <span className="mt-1 block font-mono text-quote text-text-secondary">{first}</span>
                      {rest.join(" ").trim() !== "" && (
                        <span className="mt-1 block font-mono text-quote text-text-muted">
                          {rest.join(" ").trim().slice(0, 200)}
                          {rest.join(" ").trim().length > 200 ? "…" : ""}
                        </span>
                      )}
                    </button>
                    {flagged.map((w, i) => (
                      <p key={i} className="mt-1 border-l-2 border-human pl-2 text-label text-text-secondary">
                        The server flagged this clause: {w.message}
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
