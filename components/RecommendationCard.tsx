"use client";

import { useState } from "react";

import type { DecisionBasis } from "./casefileModel";

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
  explanation,
  overridden,
  basis,
  facts,
}: {
  accent: string;
  headline: string;
  summary: string | null;
  humanReviewRequired: boolean | null;
  explanation: string | null;
  overridden: boolean;
  basis: DecisionBasis;
  /** The three facts that frame the recommendation. Any may be absent. */
  facts?: { testResult: string | null; termsUsed: string | null; period: string | null };
}) {
  const [open, setOpen] = useState(false);

  return (
    <section
      aria-label="Agent recommendation"
      className={`rounded-lg border border-border-strong border-l-2 ${accent} bg-surface p-4`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-label text-model-bright">
          {basis.policyDirected ? "Policy-directed recommendation" : "CreditScout Agent recommendation"}
        </p>
        {explanation && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="shrink-0 text-label text-model-bright underline-offset-2 hover:underline"
          >
            {open ? "Hide" : overridden ? "View validation history" : "Read the agent’s reasoning"}{" "}
            <span aria-hidden="true">{open ? "⌃" : "›"}</span>
          </button>
        )}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h2 className="text-section text-text">{headline}</h2>
        {humanReviewRequired && (
          <span className="inline-flex items-center gap-2 rounded-md border border-success bg-success-bg px-3 py-px text-label text-success">
            Human approval required
          </span>
        )}
      </div>

      {summary && <p className="mt-2 text-body text-text-secondary">{summary}</p>}

      {/* The three facts an analyst checks before reading anything else: what
          the test said, which terms produced it, and for what period. A strip,
          not prose. */}
      {(facts?.testResult || facts?.termsUsed || facts?.period) && (
        <dl className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-3">
          {facts.testResult && (
            <div>
              <dt className="text-label text-text-muted">Test result</dt>
              <dd className="mt-px text-body text-text">{facts.testResult}</dd>
            </div>
          )}
          {facts.termsUsed && (
            <div className="sm:border-l sm:border-border sm:pl-4">
              <dt className="text-label text-text-muted">Terms used</dt>
              <dd className="mt-px text-body text-text">{facts.termsUsed}</dd>
            </div>
          )}
          {facts.period && (
            <div className="sm:border-l sm:border-border sm:pl-4">
              <dt className="text-label text-text-muted">Reporting period</dt>
              <dd className="mt-px text-body text-text">{facts.period}</dd>
            </div>
          )}
        </dl>
      )}

      {/* WHY this recommendation stands, given everything else on the screen.
          The analyst was being shown an escalation beside a pending amendment
          and open notices with nothing connecting them. Each line renders only
          when the data supports it. */}
      {(basis.basis || basis.amendmentEffect || basis.outstanding) && (
        <dl className="mt-3 space-y-2 border-t border-border pt-3 text-body">
          {basis.basis && (
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-medium text-text">Decision basis:</dt>
              <dd className="text-text-secondary">{basis.basis}</dd>
            </div>
          )}
          {basis.amendmentEffect && (
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-medium text-text">Pending amendment:</dt>
              <dd className="text-text-secondary">{basis.amendmentEffect}</dd>
            </div>
          )}
          {basis.outstanding && (
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-medium text-text">Outstanding review:</dt>
              <dd className="text-text-secondary">{basis.outstanding}</dd>
            </div>
          )}
        </dl>
      )}

      {open && explanation && (
        <div className="mt-3 max-w-prose border-t border-border pt-3 text-body text-text-secondary">
          {basis.policyDirected && basis.draft && (
            <p className="mb-2">
              The agent proposed <span className="font-medium text-text">{basis.draft}</span>
              {basis.overrideReason ? `. A code rule replaced it because ${basis.overrideReason}.` : ". A code rule replaced it."}
            </p>
          )}
          <p>{explanation}</p>
        </div>
      )}
    </section>
  );
}
