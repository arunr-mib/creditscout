"use client";

import { useState } from "react";

import { AgentTag } from "./AgentTag";
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

/**
 * The outcome's mark: a SOLID fill, deepest ink of its pair, white glyph.
 *
 * It was a pale tint with a coloured glyph, which read as a watermark beside a
 * 28px headline. The fill carries no text of its own, so it is free to go as
 * dark as it likes — white on these two reads 7.9:1 and 9.5:1, where the
 * badge tints elsewhere are pinned near 4.5:1 by the text they carry.
 *
 * `request` and `abstain` stay unfilled on purpose. A filled mark says the
 * agent reached a position; those two are the cases where it did not.
 */
const TILE: Record<string, { icon: string; tone: string }> = {
  resolve: { icon: "✓", tone: "border-success-strong bg-success-strong text-surface" },
  escalate: { icon: "↗", tone: "border-danger-strong bg-danger-strong text-surface" },
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
  basisLine,
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
  /** What the recommendation rests on, as one line: citations · calculations · terms vN. */
  basisLine?: string | null;
  /** The facts that frame the recommendation. Any may be absent. */
  facts?: { testResult: string | null; reportingPeriod?: string | null };
  /** What is still open, and where to read it. Null when nothing is. */
  outstanding?: { label: string; href: string } | null;
}) {
  const [open, setOpen] = useState(false);
  const tile = TILE[outcome] ?? TILE.abstain;

  return (
    <section aria-label="Agent recommendation" className="rounded-2xl bg-sky">
      {/* ONE HEADER ROW. The card was 381px in four stacked bands — a sixth of
          a laptop screen spent before the findings start. The outcome and the
          three facts share a line; nothing was dropped but the instruction to
          read the findings, which the decision block below already gives. */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-3">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden="true"
            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-2 text-body font-bold ${tile.tone}`}
          >
            {tile.icon}
          </span>
          <div className="min-w-0">
            {/* The agent tag says the CreditScout Agent proposed this. When a
                code rule replaced the agent's answer, the agent did not, so the
                eyebrow is plain text. */}
            {basis.policyDirected ? (
              <p className="text-label font-semibold uppercase tracking-[0.12em] text-text-secondary">Policy-directed recommendation</p>
            ) : (
              <AgentTag>CreditScout recommends</AgentTag>
            )}
            <h2 className="mt-1 font-brand text-section font-extrabold text-text">{headline}</h2>
            {basisLine && <p className="mt-px text-body tabular-nums text-text-secondary">{basisLine}</p>}
          </div>
        </div>

        {/* The two facts that used to live in the header's own DSCR figures
            (owner's call, 2026-11-10: those were removed in favour of this
            compact row, now the card's only facts strip). */}
        {(facts?.testResult || facts?.reportingPeriod) && (
          <dl className="flex flex-wrap items-start gap-6">
            <Fact label="Test result" value={facts.testResult} />
            <Fact label="Reporting period" value={facts.reportingPeriod} />
          </dl>
        )}
      </div>

      {/* One row, not two: the summary and the two ways in share a line now
          (owner's call, 2026-11-10 — the card read as three stacked bands
          when the links sat on their own row above the summary). Amber is
          spent here and nowhere else on this screen. */}
      {(summary || outstanding || explanation) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-strong px-6 py-2">
          {summary ? <p className="text-body text-text">{summary}</p> : <span />}
          <span className="flex shrink-0 flex-wrap items-center gap-6">
            {explanation && (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="text-label text-text-secondary underline-offset-2 hover:text-text hover:underline"
              >
                {open ? "Hide the agent’s reasoning" : "Read the agent’s reasoning"}{" "}
                <span aria-hidden="true">{open ? "⌃" : "›"}</span>
              </button>
            )}
            {outstanding && (
              <a href={outstanding.href} className="text-body text-text underline decoration-border-strong underline-offset-2 hover:decoration-text">
                Review items <span aria-hidden="true">→</span>
              </a>
            )}
          </span>
        </div>
      )}

      {open && explanation && (
        <div className="border-t border-border-strong px-6 py-4">
          <div className="max-w-prose text-body text-text-secondary">
            {basis.policyDirected && basis.draft && (
              <p className="mb-2">
                The agent proposed <span className="font-medium text-text">{basis.draft}</span>
                {basis.overrideReason ? `. A code rule replaced it because ${basis.overrideReason}.` : ". A code rule replaced it."}
              </p>
            )}
            <p>{explanation}</p>
          </div>
        </div>
      )}
    </section>
  );
}

/** One fact, label over value. Compact enough to sit three-across in a header row. */
function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-label text-text-secondary">{label}</dt>
      {/* The page’s own typeface. A covenant figure set in monospace reads as a
          machine’s output, which is the opposite of what this screen claims. */}
      <dd className="text-body font-semibold text-text">{value}</dd>
    </div>
  );
}
