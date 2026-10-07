import { boardingState, type ApprovedTermsLike, type DocLike } from "./portfolioModel";

export interface DocumentView extends DocLike {
  id: string;
}

const DOC_TYPE_LABEL: Record<string, string> = {
  agreement: "Agreement",
  amendment: "Amendment",
  waiver: "Waiver",
  compliance_certificate: "Compliance certificate",
  financials: "Financials",
};

/**
 * design.md §12.5 — the documents on file for a facility, with a boarded? flag.
 *
 * This carries the F1/F5 mechanic. An amendment the approved terms do not yet
 * reflect renders a `not boarded` flag in the code (amber) colour: the term
 * boarded into `covenant_terms` and the amendment on file disagree, and that lag
 * is what the agent is about to catch. The state is DERIVED from the approved
 * terms (`boardingState`), never hardcoded — board the amendment and the flag
 * clears on its own.
 */
export function DocumentList({ documents, approvedTerms }: { documents: DocumentView[]; approvedTerms: ApprovedTermsLike | null }) {
  if (documents.length === 0) {
    return <p className="text-label text-text-muted">No documents on file. Upload the quarterly package to begin.</p>;
  }
  return (
    <table className="w-full border-collapse text-body">
      <thead>
        <tr className="border-b border-border text-left text-label uppercase tracking-wide text-text-muted">
          <th className="py-2 pr-4 font-medium">Document</th>
          <th className="py-2 pr-4 font-medium">Type</th>
          <th className="py-2 pr-4 font-medium">Effective</th>
          <th className="py-2 font-medium">Boarded</th>
        </tr>
      </thead>
      <tbody>
        {documents.map((doc) => {
          const state = boardingState(doc, approvedTerms);
          return (
            <tr key={doc.id} className="border-b border-border">
              <td className="py-2 pr-4 text-text">{doc.title}</td>
              <td className="py-2 pr-4 text-text-secondary">{DOC_TYPE_LABEL[doc.doc_type] ?? doc.doc_type}</td>
              <td className="py-2 pr-4 font-mono text-text-secondary">{doc.effective_date ?? "—"}</td>
              <td className="py-2">
                {state === "not_boarded" ? (
                  <span className="rounded-sm bg-code-bg px-1 py-px font-mono text-badge text-code">not boarded</span>
                ) : state === "boarded" ? (
                  <span className="text-label text-text-muted">boarded</span>
                ) : (
                  <span className="text-label text-text-muted">—</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
