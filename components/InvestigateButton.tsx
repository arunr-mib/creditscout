"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { investigateException } from "@/app/actions";
import { isReopened } from "./portfolioModel";

/**
 * Starts an investigation for an exception and takes the analyst to it. It goes
 * through a Server Action, not a browser fetch, because the investigate route is
 * gated by the server-side shared key (review finding I-4). Investigating the
 * same exception twice returns the same casefile, so a double click is safe.
 *
 * A reopened exception (a breach that was closed and a later re-run reopened,
 * F7) reads visibly distinct from a fresh one — it already carries a casefile,
 * and the marker surfaces that history so the analyst can pick up where the last
 * review left off.
 */
export function InvestigateButton(props: { exceptionId: string; status: string; hasCasefile: boolean }) {
  const { exceptionId, status, hasCasefile } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const reopened = isReopened({ status }, hasCasefile);

  function go() {
    setError(null);
    startTransition(async () => {
      const result = await investigateException(exceptionId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // The casefile page shows the live, polling trace while the investigation
      // runs (F9d), then the recommendation once it concludes. One URL.
      router.push(`/casefiles/${result.casefileId}`);
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      {reopened && (
        <span
          className="rounded-sm border border-border-strong px-1 py-px text-badge uppercase tracking-wider text-text-muted"
          title="This breach was closed and a later test reopened it. Its earlier casefile is linked."
        >
          reopened
        </span>
      )}
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className="rounded-md border border-model bg-model px-3 py-1 text-body font-medium leading-5 text-bg transition-colors duration-fast ease-out disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "Starting…" : reopened ? "Resume investigation" : "Investigate"}
      </button>
      {error && (
        <span role="alert" className="text-label text-danger">
          <span aria-hidden="true">✕ </span>
          {error}
        </span>
      )}
    </span>
  );
}
