"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reinvestigateException } from "@/app/casefiles/actions";

/**
 * Re-runs the investigation on a casefile that has reached an end. The prior
 * casefile is kept, marked superseded; the analyst lands on the new one, which
 * renders live. A slate (human-initiated) control, not teal or amber: the
 * analyst chose to run it.
 *
 * `failed` is the one case where the prior casefile is NOT superseded — a failed
 * attempt never held the live slot, so the retry simply claims a fresh casefile
 * and leaves the failed one as a record. The wording says so, rather than
 * promising a supersede that will not happen.
 */
export function ReinvestigateButton({
  exceptionId,
  awaitingDocs,
  failed = false,
}: {
  exceptionId: string;
  awaitingDocs: boolean;
  failed?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const go = () => {
    setError(null);
    start(async () => {
      let result: Awaited<ReturnType<typeof reinvestigateException>>;
      try {
        result = await reinvestigateException(exceptionId);
      } catch {
        result = { ok: false, error: "The request could not be sent. Check your connection, then try again." };
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/casefiles/${result.casefileId}`);
    });
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className="rounded-lg border border-border-strong bg-surface px-4 py-2 text-body font-medium leading-5 text-text hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "Starting…" : failed ? "Start the investigation again" : awaitingDocs ? "Re-run investigation after documents" : "Re-run investigation"}
      </button>
      {error && (
        <p role="alert" className="rounded-md border border-danger bg-danger-bg p-3 text-body text-danger">
          <span aria-hidden="true">✕ </span>
          {error}
        </p>
      )}
    </div>
  );
}
