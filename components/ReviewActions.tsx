"use client";

import { useState, useTransition } from "react";
import { reviewCasefile } from "@/app/casefiles/actions";
import type { ReviewOutcome } from "@/lib/review-action";
import { humanReviewNotice, type OverrideDraft } from "./casefileModel";
import { OverrideDialog } from "./OverrideDialog";

/** The recommendation as one word, for the dialog's context line. */
const RECOMMENDATION_WORD: Record<string, string> = {
  resolve: "Resolve",
  escalate: "Escalate",
  request: "Request documents",
  abstain: "Abstain",
};

/**
 * design.md 12.11. Approve (primary), Override and Request docs (secondary),
 * `gap-3`, pinned to the bottom. The agent recommends and never resolves
 * itself, so `require_human_review` sits beside the buttons as a locked fact,
 * not a dismissible hint.
 *
 * What the screen says after a click keys off the OUTCOME, not off a bare 200:
 * only `decided` means a decision was recorded. `already_reviewed` (someone got
 * there first, or a retry) is not an error: the page re-reads and shows the
 * recorded decision read-only.
 */
/**
 * The primary label says, in an analyst's words, what accepting the
 * recommendation actually records (review 5) — not the internal outcome token.
 * An `escalate` is "Record escalation", not "Approve escalate": nobody approves
 * an escalation, they record one. Falls back to a bare "Approve" for an
 * unrecognised outcome rather than inventing a verb for it.
 */
const APPROVE_LABEL: Record<string, string> = {
  resolve: "Approve exception resolution",
  escalate: "Record escalation",
  request: "Hold for borrower documents",
  abstain: "Record abstention",
};

export function ReviewActions(props: {
  casefileId: string;
  suggestedTag: string | null;
  humanReviewRequired: boolean | null;
  recommendation?: string | null;
  /** Context for the override dialog, so the analyst sees what they decide against. */
  borrower?: string | null;
  period?: string | null;
}) {
  const { casefileId, suggestedTag, humanReviewRequired, recommendation, borrower, period } = props;
  const approveLabel = (recommendation && APPROVE_LABEL[recommendation]) || "Approve";
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState(false);
  const [outcome, setOutcome] = useState<ReviewOutcome | null>(null);

  const send = (decision: "approve" | "override" | "request_docs", draft?: OverrideDraft) =>
    start(async () => {
      let result: ReviewOutcome;
      try {
        // The reason goes exactly as typed.
        result = await reviewCasefile({ casefileId, decision, reason: draft?.reason, correctedOutcome: draft?.correctedOutcome, confirmedTag: draft?.confirmedTag });
      } catch {
        result = { kind: "failed", message: "The review could not be sent. Check your connection, then try again." };
      }
      setOutcome(result);
      if (result.kind === "decided" || result.kind === "already_reviewed") setDialog(false);
    });

  const dialogError = outcome && (outcome.kind === "refused" || outcome.kind === "failed" || outcome.kind === "not_found") ? outcome.message : null;
  const button = "rounded-md border px-4 py-2 text-body font-medium leading-5 disabled:cursor-not-allowed disabled:opacity-40";

  // The wording follows the ACTUAL policy value, never a hard-coded "mandatory".
  const notice = humanReviewNotice(humanReviewRequired);

  // An ordinary section, not a pinned bar. Pinned, it sat over the evidence the
  // decision is supposed to rest on, and followed the analyst down the page
  // like a standing prompt to decide.
  return (
    <section aria-label="Review the recommendation" className="rounded-lg border border-border-strong bg-surface p-6 shadow-card">
      {/* The raw policy key was leaking into the analyst's view. The fact it
          states still holds — `humanReviewNotice` reads the ACTUAL policy
          value, never a hard-coded "mandatory" — it is just said in words. */}
      <div className="mb-4 space-y-1">
        <h2 className="text-section font-bold text-text">Record your decision</h2>
        {/* One line, not three. The instruction to read the findings first is
            said once, on the recommendation card. */}
        <p className="text-body text-text-secondary">Your decision and rationale will be saved to the casefile.</p>
      </div>

      {outcome && !dialog && <OutcomeNote outcome={outcome} />}

      {/* Three actions, three weights: the recommendation, the departure from
            it, and the one that decides nothing. They were three equal
            bordered buttons, which made overriding look like the normal path. */}
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" disabled={pending} onClick={() => send("approve")} className={`${button} border-model bg-model text-bg`}>
          {pending ? "Sending…" : approveLabel}
        </button>
        <button type="button" disabled={pending} onClick={() => { setOutcome(null); setDialog(true); }} className={`${button} border-border-strong bg-surface text-text`}>
          Override recommendation
        </button>
        {/* NOT "Request documents": this records a state, it sends nothing. The
            label must not imply a message went out (review 5). */}
        <button
          type="button"
          disabled={pending}
          onClick={() => send("request_docs")}
          title="Records that this loan is waiting on documents. It does not prepare or send a request to the borrower."
          className="text-body text-text-secondary underline-offset-2 hover:text-text hover:underline disabled:cursor-not-allowed disabled:opacity-40"
        >
          Hold for borrower documents
        </button>
      </div>

      <p className="mt-4 text-label text-text-muted">{notice.text}</p>

      <OverrideDialog
        open={dialog}
        suggestedTag={suggestedTag}
        sending={pending}
        error={dialogError}
        borrower={borrower}
        period={period}
        currentRecommendation={recommendation ? RECOMMENDATION_WORD[recommendation] ?? recommendation : null}
        onCancel={() => setDialog(false)}
        onSubmit={(draft) => send("override", draft)}
      />
    </section>
  );
}

function OutcomeNote({ outcome }: { outcome: ReviewOutcome }) {
  if (outcome.kind === "decided") {
    return (
      <p role="status" className="mb-3 text-body text-text">
        Decision recorded: {outcome.decision.replace("_", " ")}.
        {outcome.warning ? <span className="mt-1 block text-danger">{outcome.warning}</span> : null}
      </p>
    );
  }
  if (outcome.kind === "already_reviewed") {
    return (
      <p role="status" className="mb-3 text-body text-text">
        {outcome.message} Showing the recorded decision.
      </p>
    );
  }
  return (
    <p role="alert" className="mb-3 rounded-md border border-danger bg-danger-bg p-3 text-body text-danger">
      <span aria-hidden="true">✕ </span>{outcome.message}
    </p>
  );
}
