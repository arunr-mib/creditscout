import type { Refusal } from "./termsReview";

/** What is open for the analyst to read. None of it blocks approval; none of it is nothing. */
export interface OmissionCounts {
  /** Notes the server raised about the terms (not counting a check that did not run). */
  notes: number;
  /** Clauses no term cites. */
  uncited: number;
  /** Of those, how many the model was never shown; null when that was not recorded. */
  neverShown: number | null;
  /** Of those, how many the analyst has opened on this screen. */
  opened: number;
  /** Cited clauses that hold a paragraph no term rests on, and how many such paragraphs. */
  looseClauses: number;
  looseParagraphs: number;
  /** Which cited clauses those paragraphs are in, by citation. */
  looseWhere: string[];
  /** Amendments on file that the terms in force do not carry. */
  unboarded: number;
}

export type ApprovalState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "approved"; version: number; effectiveFrom: string; by: string }
  | { kind: "refused"; refusal: Refusal }
  | { kind: "conflict"; message: string };

/**
 * The footer where a person takes responsibility.
 *
 * Approve is disabled while the client can see a reason, and every reason is
 * written out: a dead button with no explanation is how an analyst concludes
 * the product is broken, or learns to hunt for what unlocks it. But the client
 * seeing no reason is not permission. The request is always sent, and the
 * server's refusal is shown against the rows it names.
 *
 * Four-eyes is RECORDED here, not ENFORCED. The name is typed, not verified, and
 * nothing checks it differs from whoever proposed. The bar says so and does not
 * dress the field up as an identity control.
 */
export function ApproveBar(props: {
  approver: string;
  onApprover: (v: string) => void;
  blockers: string[];
  state: ApprovalState;
  editCount: number;
  omission: OmissionCounts;
  /** Fields the analyst is approving without a completeness check having run. */
  uncheckedLists: string[];
  onApprove: () => void;
  onReload: () => void;
}) {
  const { approver, onApprover, blockers, state, editCount, omission, uncheckedLists, onApprove, onReload } = props;
  const sending = state.kind === "sending";

  if (state.kind === "approved") {
    return (
      <footer className="sticky bottom-0 mt-6 rounded-md border border-border-strong border-t-2 bg-surface-raised p-4">
        <p role="status" className="text-card text-human">
          Approved as version {state.version}, effective from <span className="font-mono">{state.effectiveFrom}</span>, by{" "}
          {state.by}.
        </p>
        <p className="mt-1 text-body text-text-secondary">
          These terms now govern tests from that date. The approver&rsquo;s name was typed, not verified.
        </p>
      </footer>
    );
  }

  const disabled = blockers.length > 0 || sending;

  return (
    <footer className="sticky bottom-0 z-10 mt-6 rounded-md border border-border-strong border-t-2 bg-surface-raised p-4">
      {state.kind === "refused" && <Refused refusal={state.refusal} />}
      {state.kind === "conflict" && (
        <div role="alert" className="mb-4 rounded-md border-2 border-danger bg-danger-bg p-3">
          <p className="text-card text-danger">Someone else approved first, or these terms changed.</p>
          <p className="mt-1 text-body text-text-secondary">{state.message}</p>
          <p className="mt-1 text-body text-text-secondary">
            Your edits are still on this screen and nothing was approved. Reloading shows the current terms and discards
            them.
          </p>
          <button
            type="button"
            onClick={onReload}
            className="mt-3 h-8 rounded-md border border-border-strong px-4 text-body text-text hover:bg-surface"
          >
            Reload current terms
          </button>
        </div>
      )}

      <div className="grid grid-cols-6 items-start gap-6">
        <div className="col-span-2">
          <label className="block text-label uppercase tracking-wide text-text-muted" htmlFor="approver">
            Approver (required)
          </label>
          <input
            id="approver"
            type="text"
            value={approver}
            maxLength={200}
            required
            aria-required="true"
            aria-describedby="approver-note approve-blockers"
            onChange={(e) => onApprover(e.target.value)}
            className="mt-1 block w-full rounded-md border border-border-strong bg-surface px-3 py-1 text-body text-text"
          />
          <p id="approver-note" className="mt-1 text-label text-text-muted">
            A typed name, recorded with the approval. Not a verified identity; nothing checks it is not the proposer.
          </p>
        </div>

        <div id="approve-blockers" className="col-span-3">
          {blockers.length > 0 ? (
            <>
              <p className="text-label uppercase tracking-wide text-text-muted">Approve is disabled because</p>
              <ul className="mt-1 columns-2 gap-6 space-y-1">
                {blockers.map((b) => (
                  <li key={b} className="break-inside-avoid text-body text-text-secondary">
                    <span aria-hidden="true" className="text-danger">
                      ✕{" "}
                    </span>
                    {b}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-label text-text-muted">
              Nothing here blocks approval. That is not permission: the server re-checks every term and refuses what is
              unsupported.
            </p>
          )}
        </div>

        <div className="col-span-1 flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={onApprove}
            disabled={disabled}
            className="h-8 rounded-md bg-model px-4 text-body font-medium text-bg disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sending ? "Sending…" : uncheckedLists.length > 0 ? "Approve without a completeness check" : "Approve terms"}
          </button>
          {editCount > 0 && (
            <span className="text-label text-text-muted">
              {editCount} edit{editCount === 1 ? "" : "s"} will be sent
            </span>
          )}
        </div>
      </div>

      <Open omission={omission} uncheckedLists={uncheckedLists} />
    </footer>
  );
}

/**
 * The counts. Not blocking is true; reading "nothing blocks" as "nothing
 * matters" is the mistake this exists to prevent. Every figure here was counted
 * by code from what is on this screen.
 */
function Open({ omission: o, uncheckedLists }: { omission: OmissionCounts; uncheckedLists: string[] }) {
  const items: string[] = [];
  if (uncheckedLists.length > 0) items.push(`no completeness check ran for ${uncheckedLists.join(", ")}`);
  if (o.unboarded > 0) items.push(`${o.unboarded} amendment${o.unboarded === 1 ? "" : "s"} on file not boarded`);
  if (o.notes > 0) items.push(`${o.notes} note${o.notes === 1 ? "" : "s"} from automated checks`);
  items.push(
    `${o.uncited} clause${o.uncited === 1 ? "" : "s"} no term cites` +
      (o.neverShown !== null && o.uncited > 0 ? `, ${o.neverShown} never shown to the model` : "") +
      `, ${o.opened} opened by you`,
  );
  if (o.looseParagraphs > 0) {
    items.push(`${o.looseParagraphs} paragraph${o.looseParagraphs === 1 ? "" : "s"} in ${o.looseWhere.join(", ")} that no term rests on`);
  }
  return (
    <p className="mt-3 border-t border-border-strong pt-3 font-mono text-label text-code">
      <span aria-hidden="true">⟡ </span>counted by code, open for you to read (none of it blocks approval): {items.join(" · ")}
    </p>
  );
}

function Refused({ refusal }: { refusal: Refusal }) {
  const { status, message, violations, errors } = refusal;
  const headline =
    status === 422
      ? "These terms were refused"
      : status === 400
        ? "The request was rejected"
        : status === 0
          ? "The server could not be reached"
          : `Approval failed (${status})`;
  return (
    <div role="alert" className="mb-4 rounded-md border-2 border-danger bg-danger-bg p-3">
      <p className="text-card text-danger">{headline}. Nothing was approved.</p>
      <p className="mt-1 text-body text-text-secondary">{message}</p>
      {violations.length > 0 && (
        <p className="mt-1 text-body text-text-secondary">
          Each refusal is marked on the term it names, above.
        </p>
      )}
      {errors.length > 0 && (
        <ul className="mt-2 list-inside list-disc font-mono text-quote text-text-secondary">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {status >= 500 && /0008/.test(message) && (
        <p className="mt-2 text-body text-text-secondary">
          This is a setup gap, not a problem with the terms: a database migration has not been applied.
        </p>
      )}
    </div>
  );
}
