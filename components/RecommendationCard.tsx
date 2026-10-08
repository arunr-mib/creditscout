"use client";

import { useState } from "react";

/**
 * The recommendation, with the agent's own account one click away.
 *
 * The toggle sits top-right and the prose opens at the FOOT of the card. A
 * `<details>` would have put them adjacent, so expanding pushed the
 * recommendation itself down the page and the card grew from the middle. The
 * state is held here so the two can live apart.
 */
export function RecommendationCard({
  accent,
  headline,
  summary,
  humanReviewRequired,
  onAmendedTerms,
  explanation,
  overridden,
}: {
  accent: string;
  headline: string;
  summary: string | null;
  humanReviewRequired: boolean | null;
  onAmendedTerms: boolean;
  explanation: string | null;
  overridden: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <section
      aria-label="Agent recommendation"
      className={`rounded-lg border border-border-strong border-l-2 ${accent} bg-surface p-4`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-label text-model-bright">CreditScout Agent recommendation</p>
        {explanation && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="shrink-0 text-label text-model-bright underline-offset-2 hover:underline"
          >
            {open ? "Hide" : overridden ? "Read the agent draft that was not accepted" : "Read the agent’s reasoning"}{" "}
            <span aria-hidden="true">{open ? "⌃" : "›"}</span>
          </button>
        )}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h2 className="text-section text-text">{headline}</h2>
        {humanReviewRequired && (
          <span className="inline-flex items-center gap-2 rounded-md border border-success bg-success-bg px-3 py-px text-label text-success">
            <span aria-hidden="true">🔒</span> Human approval required
          </span>
        )}
      </div>

      {summary && <p className="mt-2 max-w-prose text-body text-text-secondary">{summary}</p>}

      {onAmendedTerms && (
        <p className="mt-3 inline-flex items-center gap-2 rounded-md border border-code bg-code-bg px-3 py-1 text-label text-code-bright">
          <span aria-hidden="true">⚠</span> Provisional · amendment not reflected in approved terms
        </p>
      )}

      {open && explanation && (
        <p className="mt-3 max-w-prose border-t border-border pt-3 text-body text-text-secondary">{explanation}</p>
      )}
    </section>
  );
}
