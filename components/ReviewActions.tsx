"use client";

import { useState, useTransition } from "react";
import { reviewCasefile } from "@/app/casefiles/actions";
import type { ReviewOutcome } from "@/lib/review-action";
import { humanReviewNotice, type OverrideDraft } from "./casefileModel";
import { LockedPolicyValue } from "./LockedPolicyValue";
import { OverrideDialog } from "./OverrideDialog";

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
export function ReviewActions(props: { casefileId: string; suggestedTag: string | null; humanReviewRequired: boolean | null }) {
  const { casefileId, suggestedTag, humanReviewRequired } = props;
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

  return (
    <footer className="sticky bottom-0 z-10 rounded-md border border-border-strong border-t-2 bg-surface-raised p-4">
      <div className="mb-3 space-y-1">
        <LockedPolicyValue name="require_human_review" value={humanReviewRequired} />
        <p className="text-label text-text-muted">{notice.text}</p>
      </div>

      {outcome && !dialog && <OutcomeNote outcome={outcome} />}

      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={pending} onClick={() => send("approve")} className={`${button} border-model bg-model text-bg`}>
          {pending ? "Sending…" : "Approve"}
        </button>
        <button type="button" disabled={pending} onClick={() => { setOutcome(null); setDialog(true); }} className={`${button} border-border-strong text-text`}>
          Override
        </button>
        <button type="button" disabled={pending} onClick={() => send("request_docs")} className={`${button} border-border-strong text-text`}>
          Request docs
        </button>
      </div>

      <OverrideDialog
        open={dialog}
        suggestedTag={suggestedTag}
        sending={pending}
        error={dialogError}
        onCancel={() => setDialog(false)}
        onSubmit={(draft) => send("override", draft)}
      />
    </footer>
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
