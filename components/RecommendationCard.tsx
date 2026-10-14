"use client";

import { useState } from "react";

import type { DecisionBasis } from "./casefileModel";

/**
 * The recommendation. ONE statement, three facts, one pointer to what is open.
 *
 * WHAT THIS CARD STOPPED DOING, 2026-10-14: it carried a coloured left rule, a
 * green "human approval required" pill, a headline, a summary, and then a
 * three-line definition list (decision basis / pending amendment / outstanding
 * review) that ran to a paragraph. Five things competing to be read first, and
 * a second metric strip underneath the card repeating the same figures.
 *
 * None of that detail is lost — it moved to where it belongs. The basis is the
 * finding that produced it; the amendment is a finding of its own; and what is
 * still open is one line with a link to the items. The card states the
 * recommendation and gets out of the way.
 */

/** The outcome's mark. A tint, not a traffic light: the words carry the verdict. */
const TILE: Record<string, { icon: string; tone: string }> = {
  resolve: { icon: "✓", tone: "border-success bg-success-tile text-success-strong" },
  escalate: { icon: "↗", tone: "border-danger bg-danger-tile text-danger-strong" },
  request: { icon: "⌛", tone: "border-border-strong bg-surface-raised text-human" },
  abstain: { icon: "–", tone: "border-border-strong bg-surface-raised text-text-secondary" },
};

export function RecommendationCard({
  outcome,
  headline,
  summary,
  explanation,
  overridden,
  basis,
  facts,
  outstanding,
}: {
  /** `resolve` | `escalate` | `request` | `abstain` — chooses the mark only. */
  outcome: string;
  headline: string;
  summary: string | null;
  explanation: string | null;
  overridden: boolean;
  basis: DecisionBasis;
  /** The three facts that frame the recommendation. Any may be absent. */
  facts?: { testResult: string | null; termsUsed: string | null; period: string | null };
  /** What is still open, and where to read it. Null when nothing is. */
  outstanding?: { label: string; href: string } | null;
}) {
  const [open, setOpen] = useState(false);
  const tile = TILE[outcome] ?? TILE.abstain;

  return (
    <section aria-label="Agent recommendation" className="rounded-lg border border-border-strong bg-surface shadow-card">
      <div className="px-6 py-6">
        <p className="text-label font-semibold uppercase tracking-[0.12em] text-text">
          {basis.policyDirected ? "Policy-directed recommendation" : "CreditScout recommendation"}
        </p>

        <div className="mt-3 flex items-start gap-4">
          <span
            aria-hidden="true"
            className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-md border-2 text-section font-bold ${tile.tone}`}
          >
            {tile.icon}
          </span>
          <div className="min-w-0">
            <h2 className="text-title font-bold text-text">{headline}</h2>
            {summary && <p className="mt-2 max-w-prose text-body text-text">{summary}</p>}
            {/* The second line is an instruction, not a finding, so it is
                quieter than the one above it. */}
            <p className="mt-1 max-w-prose text-body text-text-muted">
              Review the supporting findings and outstanding items before recording your decision.
            </p>
          </div>
        </div>
      </div>

      {/* The three facts an analyst checks before reading anything else: what
          the test said, which terms produced it, and for what period. */}
      {(facts?.testResult || facts?.termsUsed || facts?.period) && (
        <dl className="grid gap-4 border-t border-border px-6 py-4 sm:grid-cols-3">
          <Fact label="Test result" value={facts.testResult} />
          <Fact label="Terms used" value={facts.termsUsed} divider />
          <Fact label="Reporting period" value={facts.period} divider />
        </dl>
      )}

      {/* ONE line for everything still open, with the way to it. Amber is spent
          here and nowhere else on this screen. */}
      {outstanding && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-4">
          <p className="flex items-center gap-3 text-body text-text">
            <span
              aria-hidden="true"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-code text-badge text-surface"
            >
              !
            </span>
            Outstanding review: {outstanding.label}
          </p>
          <a href={outstanding.href} className="shrink-0 text-body text-model-bright underline-offset-2 hover:underline">
            Review items <span aria-hidden="true">→</span>
          </a>
        </div>
      )}

      {/* The agent's own account, available and not competing with the
          recommendation for the top of the card. */}
      {explanation && (
        <div className="border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="text-label text-text-muted underline-offset-2 hover:text-text-secondary hover:underline"
          >
            {open ? "Hide the agent’s reasoning" : overridden ? "Read the validation history" : "Read the agent’s reasoning"}{" "}
            <span aria-hidden="true">{open ? "⌃" : "›"}</span>
          </button>
          {open && (
            <div className="mt-3 max-w-prose text-body text-text-secondary">
              {basis.policyDirected && basis.draft && (
                <p className="mb-2">
                  The agent proposed <span className="font-medium text-text">{basis.draft}</span>
                  {basis.overrideReason ? `. A code rule replaced it because ${basis.overrideReason}.` : ". A code rule replaced it."}
                </p>
              )}
              <p>{explanation}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Fact({ label, value, divider }: { label: string; value: string | null | undefined; divider?: boolean }) {
  if (!value) return null;
  return (
    <div className={divider ? "sm:border-l sm:border-border sm:pl-6" : undefined}>
      <dt className="text-label font-semibold uppercase tracking-wide text-text">{label}</dt>
      {/* The page's own typeface. A covenant figure set in monospace reads as a
          machine's output, which is the opposite of what this screen claims. */}
      <dd className="mt-1 text-card font-semibold text-text">{value}</dd>
    </div>
  );
}
