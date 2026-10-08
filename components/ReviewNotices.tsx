import { splitWarnings, WARNING_LABEL, type Warning } from "./termsReview";

export interface BoardingNotice {
  title: string;
  effectiveDate: string | null;
  /** Whether the proposed terms carry this amendment. */
  inTerms: boolean;
}

/**
 * What the server's own checks said about the proposal.
 *
 * Every one of these is the deterministic checker speaking, so every one is
 * amber (docs/design.md §5.6: a guardrail is code), marked "by code". The
 * strongest treatment on the page goes to the one that is not a note at all:
 *
 *   `definition_not_located` says NO COMPLETENESS CHECK RAN. The server could not
 *   find the clause that defines the ratio, so nothing verified that the proposal
 *   left nothing out. It is the absence of a verification, which reads as a clean
 *   pass if it is quiet, so it is a full amber box above everything, with its own
 *   heading, and approving under it needs a deliberate act.
 */
export function ReviewNotices(props: {
  /** null: the server gave no list at all, which is not the same as an empty one. */
  warnings: Warning[] | null;
  note?: string;
  boarding: BoardingNotice[];
  confirmed: ReadonlySet<string>;
  locked: boolean;
  onConfirm: (key: string, on: boolean) => void;
  onOpenCitation: (citation: string) => void;
}) {
  const { warnings, note, boarding, confirmed, locked, onConfirm, onOpenCitation } = props;
  const { notRun, notes } = warnings ? splitWarnings(warnings) : { notRun: [], notes: [] };

  return (
    <section aria-label="Automated checks" className="space-y-3">
      {warnings === null && (
        <NotRun
          field="all"
          message="No list of checks came back with this proposal, so there is no evidence that any ran."
          label="every list in these terms"
          confirmed={confirmed}
          locked={locked}
          onConfirm={onConfirm}
        />
      )}
      {notRun.map((w) => (
        <NotRun
          key={`${w.code}-${w.field}`}
          field={w.field ?? "all"}
          message={w.message}
          label={w.field ?? "this list"}
          confirmed={confirmed}
          locked={locked}
          onConfirm={onConfirm}
        />
      ))}

      {boarding.map((b) => (
        <div key={b.title} role="note" className="rounded-md border-l-4 border-code bg-code-bg p-3">
          <p className="text-label uppercase tracking-wide text-code">
            <span aria-hidden="true">⟡ </span>Not boarded · by code
          </p>
          <p className="mt-1 text-body text-text">
            {b.title}
            {b.effectiveDate ? ` (effective ${b.effectiveDate})` : ""} is on file and is not part of the terms in force.
          </p>
          {/* Judged by document title (see amendmentsNotBoarded): "boards it" claims the terms NAME the amendment, not that every provision of it is reflected. */}
          <p className="mt-1 text-body text-text-secondary">
            {b.inTerms
              ? "These proposed terms include it. Approving them boards it: every test from that date on uses the amended covenant."
              : "These proposed terms do not include it. Approving them leaves it on file and still unboarded."}
          </p>
        </div>
      ))}

      {note && <p className="text-label text-text-muted">{note}</p>}

      {warnings !== null && (
        <div className="rounded-md border border-border-strong bg-surface-raised p-3">
          {/* A count of nothing is noise: "(0)" invites the analyst to work out
              what it counts. The number appears only when there is something to
              count. "The server" was ours, not theirs — these are just checks. */}
          <p className="text-card text-text">
            Automated checks{notes.length > 0 ? ` (${notes.length})` : ""}{" "}
            <span className="rounded-sm bg-code-bg px-1 py-px font-mono text-badge text-code">
              <span aria-hidden="true">⟡ </span>by code
            </span>
          </p>
          {notes.length === 0 ? (
            <p className="mt-1 text-body text-text-secondary">No issues found.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {notes.map((w, i) => (
                <li key={`${w.code}-${i}`} className="rounded-sm border-l-4 border-code bg-code-bg p-2">
                  <p className="text-label uppercase tracking-wide text-code">
                    <span aria-hidden="true">⟡ </span>
                    {WARNING_LABEL[w.code] ?? w.code}
                  </p>
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
  field: string;
  message: string;
  label: string;
  confirmed: ReadonlySet<string>;
  locked: boolean;
  onConfirm: (key: string, on: boolean) => void;
}) {
  const { field, message, label, confirmed, locked, onConfirm } = props;
  const on = confirmed.has(field);
  return (
    <div role="alert" className="rounded-md border-2 border-code bg-code-bg p-4">
      <p className="font-mono text-badge uppercase tracking-wide text-code">
        <span aria-hidden="true">⟡ </span>by code · a check did not run
      </p>
      <p className="mt-1 text-section text-text">No completeness check ran for {label}</p>
      <p className="mt-2 text-body text-text">
        This is not a warning about the terms. It means nothing has verified that {label} is complete: nothing has
        checked that the proposal left nothing out.
      </p>
      <p className="mt-2 text-body text-text-secondary">{message}</p>
      <p className="mt-2 text-body text-text-secondary">
        If you approve under this you are the only check on it, and the approved record states that the check did not run.
        The system does not record that you confirmed below.
      </p>
      <label className={`mt-3 flex items-start gap-2 rounded-md border p-3 text-body text-text ${on ? "border-border-strong bg-surface-raised" : "border-code"}`}>
        <input
          type="checkbox"
          className="mt-1"
          checked={on}
          disabled={locked}
          onChange={(e) => onConfirm(field, e.target.checked)}
        />
        <span>
          I have read the definition myself and checked that {label} is complete. I will approve without a completeness
          check, and I am responsible for it.
        </span>
      </label>
    </div>
  );
}
