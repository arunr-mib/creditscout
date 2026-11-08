"use client";

import { useEffect, useRef, useState } from "react";
import {
  CORRECTED_OUTCOMES,
  OUTCOME_CHOICE,
  OUTCOME_LABEL,
  TAGS,
  overrideBlockers,
  tagLabel,
  type OverrideDraft,
} from "./casefileModel";

/**
 * Recording a decision that differs from the recommendation.
 *
 * THE DECISION COMES FIRST. The dialog used to ask for the rationale before the
 * outcome, which is backwards: an analyst knows what they have decided before
 * they can explain it, and writing the reason first turns the task into an
 * essay with no subject.
 *
 * THE REASON IS THE LESSON. It is stored verbatim and retrieved on similar
 * cases, so the dialog says so, and the text is sent exactly as typed: checked
 * trimmed, never sent trimmed. Whitespace is not a reason.
 *
 * ERRORS APPEAR AFTER THE ANALYST ACTS, never before. The previous version
 * listed three red failures the moment it opened, which reads as an accusation
 * for having done nothing yet. Each field reports itself once it has been
 * touched, or once submit has been attempted.
 *
 * A native <dialog> opened with showModal(), so the browser traps focus,
 * restores it on close, and Escape works — no custom focus handling to get wrong.
 */
export function OverrideDialog(props: {
  open: boolean;
  suggestedTag: string | null;
  sending: boolean;
  /** A refusal from the server, shown inside the dialog so the analyst's draft is not lost. */
  error: string | null;
  /** Context, so the analyst can see what they are deciding against. */
  borrower?: string | null;
  period?: string | null;
  currentRecommendation?: string | null;
  onCancel: () => void;
  onSubmit: (draft: OverrideDraft) => void;
}) {
  const { open, suggestedTag, sending, error, borrower, period, currentRecommendation, onCancel, onSubmit } = props;
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<OverrideDraft>({ reason: "", confirmedTag: "", correctedOutcome: "" });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const blockers = overrideBlockers(draft);
  const show = (key: string) => attempted || touched[key];

  const missingOutcome = draft.correctedOutcome === "";
  const missingReason = draft.reason.trim() === "";
  const missingTag = draft.confirmedTag === "";

  const field =
    "mt-1 block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-body text-text";
  const err = "mt-1 text-label text-danger";

  return (
    <dialog
      ref={ref}
      onClose={onCancel}
      aria-labelledby="override-title"
      className="m-auto w-full max-w-dialog rounded-2xl border border-border bg-surface p-6 text-text-secondary shadow-raised backdrop:bg-brand/60"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setAttempted(true);
          if (blockers.length === 0 && !sending) onSubmit(draft);
        }}
        className="space-y-4"
      >
        <div>
          <h2 id="override-title" className="text-section text-text">Record a different decision</h2>
          {(borrower || currentRecommendation) && (
            <p className="mt-1 text-label text-text-muted">
              {borrower}
              {period ? ` · ${period}` : ""}
              {currentRecommendation ? (
                <>
                  {borrower ? " · " : ""}Current recommendation:{" "}
                  <span className="text-text">{currentRecommendation}</span>
                </>
              ) : null}
            </p>
          )}
        </div>

        {/* 1. WHAT you decided. A radio group, not a dropdown: three options
            with consequences are a choice to read, not a list to open. */}
        <fieldset onBlur={() => setTouched((t) => ({ ...t, outcome: true }))}>
          <legend className="text-label text-text-muted">Your decision</legend>
          <div className="mt-1 space-y-2">
            {CORRECTED_OUTCOMES.map((o) => (
              <label
                key={o}
                className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${
                  draft.correctedOutcome === o ? "border-text bg-surface-raised" : "border-border-strong bg-surface"
                }`}
              >
                <input
                  type="radio"
                  name="override-outcome"
                  value={o}
                  checked={draft.correctedOutcome === o}
                  onChange={() => setDraft({ ...draft, correctedOutcome: o })}
                  className="mt-1"
                />
                <span>
                  <span className="block text-body font-medium text-text">{OUTCOME_CHOICE[o].title}</span>
                  <span className="block text-label text-text-muted">{OUTCOME_CHOICE[o].detail}</span>
                </span>
              </label>
            ))}
          </div>
          {show("outcome") && missingOutcome && <p className={err}>Choose the decision you reached</p>}
        </fieldset>

        {/* 2. WHY. Only now, when there is a decision to explain. */}
        <div>
          <label htmlFor="override-reason" className="block text-label text-text-muted">
            Decision rationale <span className="text-text-muted">— required</span>
          </label>
          <p className="mt-1 text-label text-text-muted">
            Explain why your decision differs from the recommendation. Reference relevant documents, calculations, or
            unresolved issues.
          </p>
          <textarea
            id="override-reason"
            value={draft.reason}
            onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
            onBlur={() => setTouched((t) => ({ ...t, reason: true }))}
            rows={5}
            placeholder="Describe the evidence supporting your decision…"
            aria-required="true"
            aria-describedby="override-lesson"
            className={field}
          />
          {show("reason") && missingReason && <p className={err}>Enter a decision rationale</p>}
          <p id="override-lesson" className="mt-1 text-label text-text-muted">
            Saved to the casefile. May be retrieved as context for similar investigations.
          </p>
        </div>

        {/* 3. Categorisation, in the analyst's vocabulary rather than the
            model's. The identifier still travels in the value. */}
        <div>
          <label htmlFor="override-tag" className="block text-label text-text-muted">Case category</label>
          <select
            id="override-tag"
            value={draft.confirmedTag}
            onChange={(e) => setDraft({ ...draft, confirmedTag: e.target.value })}
            onBlur={() => setTouched((t) => ({ ...t, tag: true }))}
            className={field}
          >
            <option value="">Choose a category</option>
            {TAGS.map((t) => (
              <option key={t} value={t}>
                {tagLabel(t)}
                {t === suggestedTag ? " — suggested" : ""}
              </option>
            ))}
          </select>
          {show("tag") && missingTag && <p className={err}>Choose a case category</p>}
          <p className="mt-1 text-label text-text-muted">
            {suggestedTag ? (
              <>
                Suggested by CreditScout: <span className="text-text">{tagLabel(suggestedTag)}</span>. Confirm or change
                it.
              </>
            ) : (
              "CreditScout suggested no category. Choose the one that fits."
            )}
          </p>
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-danger bg-danger-bg p-3 text-body text-danger">
            <span aria-hidden="true">✕ </span>{error}
          </p>
        )}

        <p className="text-label text-text-muted">
          Recording a decision does not change approved covenant terms or clear outstanding review items.
        </p>

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="rounded-lg border border-border-strong px-4 py-2 text-body font-medium leading-5 text-text">
            Cancel
          </button>
          <button
            type="submit"
            disabled={sending}
            className="rounded-lg border border-transparent bg-mint px-4 py-2 text-body font-medium leading-5 text-text hover:bg-mint-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sending ? "Recording…" : "Record decision"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
