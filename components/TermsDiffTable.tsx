import { changeSummary, changedOnly, termsDiff, type ChangeKind, type TermChange } from "./termsDiff";
import type { Terms } from "./termsReview";

/**
 * What approving this proposal would change, before anyone is asked to approve
 * it (brief §4).
 *
 * The screen showed the proposed terms and their clauses, and nothing about the
 * version they would replace. An analyst could read every line of v2 and still
 * not know which line differed from the v1 that had governed two years of tests.
 *
 * Changes only, by default. The unchanged terms are a click away rather than
 * fifteen rows of noise around the two that matter.
 */

const KIND_LABEL: Record<ChangeKind, string> = {
  same: "Unchanged",
  changed: "Changed",
  added: "Added",
  removed: "Removed",
};

const KIND_TONE: Record<ChangeKind, string> = {
  same: "border-border-strong text-text-muted",
  changed: "border-code bg-code-bg text-code-bright",
  added: "border-code bg-code-bg text-code-bright",
  removed: "border-danger bg-danger-bg text-danger",
};

export function TermsDiffTable(props: {
  approved: { version: number; terms: Terms } | null;
  proposedVersion: number | undefined;
  proposedTerms: Terms;
  /** Opens the clause a proposed value cites. */
  onOpenTerm?: (citeField: string) => void;
}) {
  const { approved, proposedVersion, proposedTerms } = props;
  const rows = termsDiff(approved?.terms ?? null, proposedTerms);
  const changed = changedOnly(rows);
  const unchanged = rows.filter((r) => r.kind === "same");
  const approvedHead = approved ? `Approved v${approved.version}` : "Approved";
  const proposedHead = proposedVersion ? `Proposed v${proposedVersion}` : "Proposed";

  return (
    <section aria-label="What this proposal changes" className="rounded-lg border border-border bg-surface shadow-card">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-section text-text">What this proposal changes</h2>
        <p className="text-label text-text-secondary">{changeSummary(approved?.terms ?? null, rows)}</p>
      </header>

      {changed.length > 0 ? (
        <Table rows={changed} approvedHead={approvedHead} proposedHead={proposedHead} onOpenTerm={props.onOpenTerm} />
      ) : (
        <p className="px-4 py-3 text-body text-text-secondary">
          {approved
            ? "Every term in this proposal matches the approved version. Approving it records a new version with the same terms."
            : "No approved version exists yet, so there is nothing to compare against."}
        </p>
      )}

      {unchanged.length > 0 && (
        <details className="border-t border-border px-4 py-3">
          <summary className="cursor-pointer list-none text-label text-text-muted underline-offset-2 hover:underline marker:content-['']">
            <span aria-hidden="true">▸ </span>
            {unchanged.length} unchanged {unchanged.length === 1 ? "term" : "terms"}
          </summary>
          <div className="mt-2">
            <Table rows={unchanged} approvedHead={approvedHead} proposedHead={proposedHead} onOpenTerm={props.onOpenTerm} bare />
          </div>
        </details>
      )}
    </section>
  );
}

function Table({
  rows,
  approvedHead,
  proposedHead,
  onOpenTerm,
  bare = false,
}: {
  rows: readonly TermChange[];
  approvedHead: string;
  proposedHead: string;
  onOpenTerm?: (citeField: string) => void;
  bare?: boolean;
}) {
  return (
    <div className={bare ? "overflow-x-auto rounded-md border border-border" : "overflow-x-auto"}>
      <table className="w-full border-collapse text-left">
        <thead className="bg-surface-raised">
          <tr className="text-label uppercase tracking-wide text-text-muted">
            <th className="px-4 py-2 font-medium">Term</th>
            <th className="px-4 py-2 font-medium">{approvedHead}</th>
            <th className="px-4 py-2 font-medium">{proposedHead}</th>
            <th className="px-4 py-2 font-medium">Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border align-top">
              <td className="px-4 py-2 text-body text-text">
                {r.label}
                {r.kind !== "same" && (
                  <span className={`ml-2 inline-flex rounded border px-1 py-px text-badge ${KIND_TONE[r.kind]}`}>
                    {KIND_LABEL[r.kind]}
                  </span>
                )}
              </td>
              {/* An absent side is said, not left blank: "—" in a covenant
                  table reads as a value nobody filled in. */}
              <td className="px-4 py-2 text-num tabular-nums text-text-secondary">
                {r.approved ?? <span className="font-sans text-text-muted">not in this version</span>}
              </td>
              <td className={`px-4 py-2 text-num tabular-nums ${r.kind === "same" ? "text-text-secondary" : "text-text"}`}>
                {r.proposed ?? <span className="font-sans text-text-muted">dropped</span>}
              </td>
              <td className="px-4 py-2">
                {r.citeField && onOpenTerm ? (
                  <button
                    type="button"
                    onClick={() => onOpenTerm(r.citeField as string)}
                    className="text-label text-model-bright underline-offset-2 hover:underline"
                  >
                    Open source
                  </button>
                ) : (
                  <span className="text-label text-text-muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
