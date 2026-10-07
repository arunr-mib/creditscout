"use client";

import { useTransition } from "react";
import { reviewCasefile } from "@/app/casefiles/actions";
import type { ReviewOutcome } from "@/lib/review-action";
import { useState } from "react";

/**
 * The repair reachable from the read-only view. A decision was recorded but its
 * exception close failed (`submitReview` answered 500 WITH a `review_id`), so the
 * active action bar that would have carried the warning has unmounted and the
 * analyst would otherwise never learn the exception is still open.
 *
 * Re-invoking the review Server Action on an already-decided casefile hits F9a's
 * idempotent repair path (`repairException` → 200 `{repaired:true}`), which closes
 * the exception. The decision itself is already recorded and never rewritten; the
 * decision value sent here only has to pass request validation, so `approve` (no
 * extra fields) is used regardless of how the casefile was actually decided.
 */
export function FinishClosing({ casefileId }: { casefileId: string }) {
  const [pending, start] = useTransition();
  const [outcome, setOutcome] = useState<ReviewOutcome | null>(null);

  const finish = () =>
    start(async () => {
      let result: ReviewOutcome;
      try {
        result = await reviewCasefile({ casefileId, decision: "approve" });
      } catch {
        result = { kind: "failed", message: "The repair could not be sent. Check your connection, then try again." };
      }
      setOutcome(result);
    });

  const failed = outcome && (outcome.kind === "failed" || outcome.kind === "refused" || outcome.kind === "not_found");

  return (
    <div className="mt-3 space-y-2">
      <button
        type="button"
        disabled={pending}
        onClick={finish}
        className="rounded-md border border-border-strong px-4 py-2 text-body font-medium leading-5 text-text disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "Finishing…" : "Finish closing the exception"}
      </button>
      {outcome && !failed && (
        <p role="status" className="text-body text-text-secondary">
          {outcome.kind === "already_reviewed" || outcome.kind === "decided"
            ? "The exception close has been retried. Reload if this notice is still shown."
            : null}
        </p>
      )}
      {failed && (
        <p role="alert" className="rounded-md border border-danger bg-danger-bg p-3 text-body text-danger">
          <span aria-hidden="true">✕ </span>
          {outcome.message}
        </p>
      )}
    </div>
  );
}
