import { splitWarnings, WARNING_LABEL, type Warning } from "./termsReview";

/**
 * What the server's own checks said about the proposal.
 *
 * Two kinds, and they must not look alike:
 *
 *   - `definition_not_located` says a check DID NOT RUN. The server could not
 *     find the clause that defines the ratio, so nothing verified that the
 *     proposal left nothing out. Silence there reads as a clean pass, which is
 *     the exact failure this screen exists to prevent, so it is loud, it is
 *     above the terms, and approval waits for the analyst to say they read the
 *     definition themselves.
 *   - Everything else is a note: where the document, not the model, leaves the
 *     machine check short of conclusive.
 *
 * Not amber: docs/design.md §5.6 would colour a code-raised notice amber, but no
 * calculation happens on this screen and amber is held for computed values here.
 */
export function ReviewNotices(props: {
  /** null: the server gave no list at all, which is not the same as an empty one. */
  warnings: Warning[] | null;
  note?: string;
  confirmed: ReadonlySet<string>;
  locked: boolean;
  onConfirm: (key: string, on: boolean) => void;
  onOpenCitation: (citation: string) => void;
}) {
  const { warnings, note, confirmed, locked, onConfirm, onOpenCitation } = props;
  const { notRun, notes } = warnings ? splitWarnings(warnings) : { notRun: [], notes: [] };

  return (
    <section aria-label="Checks raised by the server" className="space-y-3">
      {warnings === null && (
        <NotRun
          title="The server did not report its completeness checks"
          message="No list of checks came back with this proposal, so there is no evidence that any ran. Treat completeness as unchecked."
          k="all"
          label="every list in these terms"
          confirmed={confirmed}
          locked={locked}
          onConfirm={onConfirm}
        />
      )}
      {notRun.map((w) => (
        <NotRun
          key={`${w.code}-${w.field}`}
          title={`Completeness not checked${w.field ? `: ${w.field}` : ""}`}
          message={w.message}
          k={w.field ?? "all"}
          label={w.field ?? "this list"}
          confirmed={confirmed}
          locked={locked}
          onConfirm={onConfirm}
        />
      ))}

      {note && <p className="text-label text-text-muted">{note}</p>}

      {warnings !== null && (
        <div className="rounded-md border border-border-strong bg-surface-raised p-3">
          <p className="text-card text-text">Notes from the server&rsquo;s checks ({notes.length})</p>
          {notes.length === 0 ? (
            <p className="mt-1 text-body text-text-secondary">
              None raised. That is not a statement that nothing is missing: read the clauses that no term cites, below.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {notes.map((w, i) => (
                <li key={`${w.code}-${i}`} className="border-l-2 border-human pl-2">
                  <p className="text-label uppercase tracking-wide text-text-muted">{WARNING_LABEL[w.code] ?? w.code}</p>
                  <p className="text-body text-text-secondary">{w.message}</p>
                  {w.citation && (
                    <button
                      type="button"
                      onClick={() => onOpenCitation(w.citation as string)}
                      className="mt-1 rounded-sm border border-border-strong px-2 py-px font-mono text-label text-model hover:bg-model-bg"
                    >
                      {w.citation} ↗
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function NotRun(props: {
  title: string;
  message: string;
  k: string;
  label: string;
  confirmed: ReadonlySet<string>;
  locked: boolean;
  onConfirm: (key: string, on: boolean) => void;
}) {
  const { title, message, k, label, confirmed, locked, onConfirm } = props;
  return (
    <div role="alert" className="rounded-md border-2 border-danger bg-danger-bg p-4">
      <p className="text-card text-danger">
        <span aria-hidden="true">✕ </span>
        {title}
      </p>
      <p className="mt-2 text-body text-text-secondary">{message}</p>
      <p className="mt-2 text-body text-text-secondary">
        Nothing has verified that {label} is complete. If you approve these terms you are the only check on it, and the
        approved record will show that the check did not run.
      </p>
      <label className="mt-3 flex items-start gap-2 text-body text-text">
        <input
          type="checkbox"
          className="mt-1"
          checked={confirmed.has(k)}
          disabled={locked}
          onChange={(e) => onConfirm(k, e.target.checked)}
        />
        I have read the definition myself and checked that {label} is complete. I am responsible for it.
      </label>
    </div>
  );
}
