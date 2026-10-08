import { CitationChip } from "./CitationChip";
import { PROBLEM_HEADLINE, WARNING_LABEL, type RowView } from "./termsReview";

/**
 * One covenant term. The row's whole job is to show, without reading, WHO made
 * the value on it and WHETHER ITS CITATION HOLDS UP:
 *
 *   teal   "model proposed"    the model produced this value
 *   slate  "analyst-corrected" a human changed it; the model's value stays beside it
 *   slate  "approved by"       a human stands behind it
 *   rose   a refusal           no citation, or a citation that does not support the value
 *   amber  "server check"      the deterministic checker said so (design.md §5.6)
 *
 * The dangerous row is a real citation carrying the wrong number: it looks
 * correct to anyone scanning for a missing chip. So an unsupported row opens
 * with what is wrong, then shows the quote it is wrong against, in the row.
 *
 * A row never says it is clean while a server note about it exists. The note
 * sits under the value, where the reader's eye already is.
 */
export function TermRow(props: {
  view: RowView;
  selected: boolean;
  editable: boolean;
  editing: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onUndo: (field: string) => void;
  editedFields: string[];
  /** Set once a person has approved: the row then says a human stands behind it, not only that a model proposed it. */
  approvedBy?: string;
  children?: React.ReactNode;
}) {
  const { view, selected, editable, editing, onSelect, onEdit, onUndo, editedFields, approvedBy, children } = props;
  const { row, state, problems, entry, parts, edited, notes } = view;
  const blocked = state === "no_citation" || state === "unsupported";

  const frame = blocked
    ? "border-2 border-danger bg-danger-bg"
    : state === "edited"
      ? "border border-border border-l-2 border-l-human bg-surface"
      : selected
        ? "border border-border-strong bg-surface-raised"
        : "border border-border bg-surface";

  return (
    <li className={`rounded-md p-3 ${frame}`} aria-current={selected ? "true" : undefined}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-label uppercase tracking-wide text-text-muted">
            {row.label}
            {state === "edited" && <span className="ml-2 normal-case text-human">edited</span>}
          </p>

          {row.absence ? (
            <p className="mt-1 text-body text-text-secondary">{row.absence}</p>
          ) : (
            <div className="mt-1 flex flex-wrap items-baseline gap-x-6 gap-y-1">
              {parts.map(({ spec, text, original }) => (
                <div key={spec.field} className="min-w-0">
                  {parts.length > 1 && <span className="mr-2 text-label text-text-muted">{spec.label}</span>}
                  <span className="break-words font-mono text-num text-text">{text}</span>
                  {original !== undefined && (
                    <span className="ml-2 inline-flex flex-wrap items-baseline gap-2">
                      <span className="rounded-sm bg-human-bg px-1 py-px text-badge text-human">analyst-corrected</span>
                      <span className="text-label text-text-muted">
                        model proposed <span className="font-mono text-model line-through">{original}</span>
                      </span>
                      {editedFields.includes(spec.field) && (
                        <button type="button" onClick={() => onUndo(spec.field)} className="text-label text-text-muted underline hover:text-text">
                          undo
                        </button>
                      )}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {row.citeField !== null && (
          <div className="flex shrink-0 flex-col items-end gap-1">
            <CitationChip citation={entry?.citation} selected={selected} onSelect={onSelect} />
            {approvedBy ? (
              <span className="rounded-sm bg-human-bg px-1 py-px text-badge text-human">approved by {approvedBy}</span>
            ) : edited ? (
              <span className="rounded-sm bg-human-bg px-1 py-px text-badge text-human">analyst-corrected</span>
            ) : (
              entry && <span className="rounded-sm bg-model-bg px-1 py-px text-badge text-model">model proposed</span>
            )}
          </div>
        )}
      </div>

      {blocked && (
        <div role="alert" className="mt-3 space-y-2">
          {problems.length === 0 && (
            <p className="text-card text-danger">
              <span aria-hidden="true">✕ </span>
              {PROBLEM_HEADLINE.no_citation}. This term blocks approval.
            </p>
          )}
          {problems.map((p) => (
            <div key={`${p.violation.field}-${p.violation.reason}`}>
              <p className="text-card text-danger">
                <span aria-hidden="true">✕ </span>
                {PROBLEM_HEADLINE[p.kind]}. This term blocks approval.
              </p>
              <p className="mt-1 text-body text-text-secondary">
                <span className="mr-2 rounded-sm bg-code-bg px-1 py-px font-mono text-badge text-code">
                  <span aria-hidden="true">⟡ </span>refused by an automated check
                </span>
                <span className="font-mono text-label text-text-muted">{p.violation.field}</span> · {p.violation.reason}
              </p>
            </div>
          ))}
          {entry && problems.some((p) => p.kind !== "no_citation") && (
            <div>
              <p className="text-label text-text-muted">The quote it cites ({entry.citation}):</p>
              <p className="mt-1 whitespace-pre-wrap border-l-2 border-danger pl-2 font-mono text-quote text-text-secondary">{entry.quote}</p>
            </div>
          )}
        </div>
      )}

      {notes.length > 0 && (
        <div className="mt-3 space-y-2">
          {!blocked && state !== "edited" && !row.absence && (
            <p className="text-label text-text-muted">
              Automated value checks passed, but raised {notes.length === 1 ? "a note" : `${notes.length} notes`} on this term. Read before trusting it:
            </p>
          )}
          {notes.map((w, i) => (
            <div key={`${w.code}-${i}`} className="rounded-sm border-l-4 border-code bg-code-bg p-2">
              <p className="text-label uppercase tracking-wide text-code">
                <span aria-hidden="true">⟡ </span>
                {WARNING_LABEL[w.code] ?? (w.code === "definition_not_located" ? "Completeness not checked" : w.code)} · by code
              </p>
              <p className="text-body text-text-secondary">{w.message}</p>
            </div>
          ))}
        </div>
      )}

      {state === "ok" && row.citeField !== null && notes.length === 0 && (
        <p className="mt-2 text-label text-text-muted">
          <span aria-hidden="true">✓ </span>
          {row.checkedAgainst ? `checked against ${row.checkedAgainst}` : "supported by the clause it cites"}
        </p>
      )}
      {state === "edited" && (
        <p className="mt-2 text-label text-text-muted">
          Edited by you. The server checks the new value against its quote when you approve.
        </p>
      )}

      {editable && row.fields.length > 0 && !editing && (
        <button
          type="button"
          onClick={onEdit}
          className="mt-3 h-8 rounded-md border border-border-strong px-3 text-label text-text hover:bg-surface-raised"
        >
          Edit
        </button>
      )}
      {children}
    </li>
  );
}
