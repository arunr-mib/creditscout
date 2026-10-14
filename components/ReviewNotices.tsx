import { CONSEQUENCE_LABEL, CONSEQUENCE_NOTE, noticeHeadline, splitFieldPath } from "./noticeGroups";
import { splitWarnings, type Warning } from "./termsReview";

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
      {notRun.length > 0 && (
        <p className="text-label uppercase tracking-wide text-text-muted">{CONSEQUENCE_LABEL.acknowledge}</p>
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

      {(boarding.length > 0 || (warnings !== null && notes.length > 0)) && (
        <Group consequence="information">
          {boarding.map((b) => (
            <li key={b.title} className="rounded-md border border-border bg-surface p-3">
              {/* "Not boarded · by code" named an internal state in our own
                  vocabulary. What the analyst needs is what this proposal does
                  about it. */}
              <p className="text-body font-medium text-text">
                {b.inTerms ? "Amendment included in this proposal" : "Amendment not included in this proposal"}
              </p>
              <p className="mt-1 text-body text-text-secondary">
                {b.title} is not incorporated into the approved terms
                {b.effectiveDate ? ` (effective ${b.effectiveDate})` : ""}.{" "}
                {/* Judged by document title (see amendmentsNotBoarded): "includes" claims
                    the terms NAME the amendment, not that every provision of it is reflected. */}
                {b.inTerms
                  ? "The proposal includes changes from this amendment. Approving it means every test from that date on uses the amended covenant."
                  : "This proposal does not include it. Approving it leaves the amendment on file and still not incorporated."}
              </p>
            </li>
          ))}
          {warnings !== null &&
            notes.map((w, i) => {
              const { path, rest } = splitFieldPath(w.message ?? "");
              return (
                <li key={`${w.code}-${i}`} className="rounded-md border border-border bg-surface p-3">
                  <p className="text-body font-medium text-text">{noticeHeadline(w)}</p>
                  <p className="mt-1 text-body text-text-secondary">{rest}</p>
                  {w.citation && (
                    <button
                      type="button"
                      onClick={() => onOpenCitation(w.citation as string)}
                      className="mt-2 rounded-md border border-border-strong px-2 py-px text-label text-model-bright hover:bg-model-bg"
                    >
                      Open {w.citation}
                    </button>
                  )}
                  {/* The field path is true and is not what an analyst reads
                      first. It led every one of these notices. */}
                  {path && (
                    <details className="mt-1">
                      <summary className="cursor-pointer list-none text-label text-text-muted underline-offset-2 hover:underline marker:content-['']">
                        <span aria-hidden="true">▸ </span>Technical details
                      </summary>
                      <dl className="mt-1 grid gap-x-4 sm:grid-cols-[max-content_1fr]">
                        <dt className="text-label text-text-muted">Field</dt>
                        <dd className="font-mono text-label text-text-secondary">{path}</dd>
                        <dt className="text-label text-text-muted">Check</dt>
                        <dd className="font-mono text-label text-text-secondary">{w.code}</dd>
                      </dl>
                    </details>
                  )}
                </li>
              );
            })}
        </Group>
      )}

      {note && <p className="text-label text-text-muted">{note}</p>}

      {warnings !== null && notes.length === 0 && boarding.length === 0 && (
        <p className="rounded-md border border-border bg-surface p-3 text-body text-text-secondary">
          Automated checks found no issues with these terms.
        </p>
      )}
    </section>
  );
}

/**
 * One consequence, with its heading said once. Grouping is the point: an
 * analyst reads "Requires acknowledgment" and knows what the list below asks of
 * them, instead of inferring it from the colour of each box.
 */
function Group({ consequence, children }: { consequence: "must_resolve" | "acknowledge" | "information"; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-label uppercase tracking-wide text-text-muted">{CONSEQUENCE_LABEL[consequence]}</p>
      <p className="mt-px text-label text-text-muted">{CONSEQUENCE_NOTE[consequence]}</p>
      <ul className="mt-2 space-y-2">{children}</ul>
    </div>
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
