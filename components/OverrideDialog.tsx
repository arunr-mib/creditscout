"use client";

import { useEffect, useRef, useState } from "react";
import { CORRECTED_OUTCOMES, OUTCOME_LABEL, TAGS, overrideBlockers, type OverrideDraft } from "./casefileModel";

/**
 * design.md 12.12. Three required fields, in this order: the reason, then the
 * suggested tag confirmed, then the corrected outcome. Submit stays disabled
 * until all three are set, and says what is missing rather than sitting dead.
 *
 * THE REASON IS THE LESSON. It is stored verbatim and retrieved on similar
 * cases, so the dialog says that, and the text is sent exactly as typed: it is
 * checked trimmed, never sent trimmed. Whitespace is not a reason.
 *
 * A native <dialog> opened with showModal(), so the browser traps focus and
 * Escape closes it; there is no custom focus handling to get wrong.
 */
export function OverrideDialog(props: {
  open: boolean;
  suggestedTag: string | null;
  sending: boolean;
  /** A refusal from the server, shown inside the dialog so the analyst's draft is not lost. */
  error: string | null;
  onCancel: () => void;
  onSubmit: (draft: OverrideDraft) => void;
}) {
  const { open, suggestedTag, sending, error, onCancel, onSubmit } = props;
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<OverrideDraft>({ reason: "", confirmedTag: "", correctedOutcome: "" });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const blockers = overrideBlockers(draft);
  const field = "mt-1 block w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-body text-text";

  return (
    <dialog
      ref={ref}
      onClose={onCancel}
      aria-labelledby="override-title"
      className="m-auto w-full max-w-dialog rounded-lg border border-border-strong bg-surface-raised p-6 text-text-secondary backdrop:bg-bg/80"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (blockers.length === 0 && !sending) onSubmit(draft);
        }}
        className="space-y-4"
      >
        <h2 id="override-title" className="text-section text-text">Override the recommendation</h2>

        <div>
          <label htmlFor="override-reason" className="block text-label text-text-muted">1. Your reason (required)</label>
          <textarea
            id="override-reason"
            value={draft.reason}
            onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
            rows={4}
            required
            aria-required="true"
            aria-describedby="override-lesson"
            className={field}
          />
          <p id="override-lesson" className="mt-1 text-label text-text-muted">
            Your reasoning is retained and retrieved on similar cases.
          </p>
        </div>

        <div>
          <label htmlFor="override-tag" className="block text-label text-text-muted">2. Confirm the pattern tag</label>
          <select id="override-tag" value={draft.confirmedTag} onChange={(e) => setDraft({ ...draft, confirmedTag: e.target.value })} required className={field}>
            <option value="">Choose a tag</option>
            {TAGS.map((t) => (
              <option key={t} value={t}>
                {t}{t === suggestedTag ? " (suggested by the agent)" : ""}
              </option>
            ))}
          </select>
          <p className="mt-1 text-label text-text-muted">
            {suggestedTag ? <>The agent suggested <span className="font-mono">{suggestedTag}</span>. Choosing a tag confirms it.</> : "The agent suggested no tag. Choose the one that fits."}
          </p>
        </div>

        <div>
          <label htmlFor="override-outcome" className="block text-label text-text-muted">3. Corrected outcome</label>
          <select id="override-outcome" value={draft.correctedOutcome} onChange={(e) => setDraft({ ...draft, correctedOutcome: e.target.value })} required className={field}>
            <option value="">Choose the outcome you reached</option>
            {CORRECTED_OUTCOMES.map((o) => (
              <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>
            ))}
          </select>
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-danger bg-danger-bg p-3 text-body text-danger">
            <span aria-hidden="true">✕ </span>{error}
          </p>
        )}

        <div id="override-blockers" aria-live="polite">
          {blockers.length > 0 && (
            <ul className="space-y-1">
              {blockers.map((b) => (
                <li key={b} className="text-label text-text-muted"><span aria-hidden="true" className="text-danger">✕ </span>{b}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="rounded-md border border-border-strong px-4 py-2 text-body font-medium leading-5 text-text">
            Cancel
          </button>
          <button
            type="submit"
            disabled={blockers.length > 0 || sending}
            aria-describedby="override-blockers"
            className="rounded-md border border-model bg-model px-4 py-2 text-body font-medium leading-5 text-bg disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sending ? "Recording…" : "Record override"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
