"use client";

import { useState } from "react";
import { CalcTable } from "./CalcTable";
import { ClaimList } from "./ClaimList";
import type { CalcSection, ClaimView } from "./casefileModel";
import { ClausePanel } from "./ClausePanel";
import type { Clause } from "./termsReview";

type Selection = { key: string; citation: string; quote: string; reason: string };

/**
 * The calculation table and the claims, with the clause panel beside them. One
 * selection is shared across both, so choosing a chip anywhere deselects the
 * one before it, and choosing the same chip again closes the panel. The clause
 * each citation resolves to was looked up on the server; one that resolved to
 * nothing is `null`, and the panel says so rather than showing a blank.
 */
export function CasefileEvidence(props: {
  sections: CalcSection[];
  claims: ClaimView[];
  clauses: Record<string, Clause | null>;
}) {
  const { sections, claims, clauses } = props;
  const [selected, setSelected] = useState<Selection | null>(null);

  const choose = (key: string, citation: string, quote: string, reason: string) =>
    setSelected((cur) => (cur?.key === key ? null : { key, citation, quote, reason }));

  const clause = selected ? (clauses[selected.citation] ?? null) : null;
  const onPick = (key: string, citation: string, quote: string) => choose(key, citation, quote, `quoted figure · ${citation}`);

  // The governing calculation is the one the recommendation rests on; the
  // earlier ones (the baseline, an intermediate re-map) are how it got there.
  // Lead with the governing one and tuck the rest behind a disclosure so the
  // analyst is not scrolling a 30-row wall to reach the decision.
  const governing = sections.filter((s) => s.governing);
  const earlier = sections.filter((s) => !s.governing);

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="min-w-0 space-y-6 lg:flex-1">
        <section aria-labelledby="calc-heading" className="space-y-2">
          <div className="flex items-baseline gap-3">
            <h2 id="calc-heading" className="text-card text-text">
              {governing.length > 0 ? "Governing calculation" : "Calculation"}
            </h2>
            {governing.length > 0 && (
              <span className="text-label text-text-muted">the figure the recommendation rests on</span>
            )}
          </div>
          <CalcTable
            sections={governing.length > 0 ? governing : sections}
            selectedKey={selected?.key ?? null}
            onSelect={onPick}
          />
          {earlier.length > 0 && (
            <details className="group rounded-md border border-border bg-surface">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-label text-text-muted transition-colors hover:text-text-secondary">
                <span className="transition-transform group-open:rotate-90" aria-hidden="true">›</span>
                Show {earlier.length} earlier calculation{earlier.length > 1 ? "s" : ""} — baseline and intermediate
              </summary>
              <div className="border-t border-border p-3">
                <CalcTable sections={earlier} selectedKey={selected?.key ?? null} onSelect={onPick} />
              </div>
            </details>
          )}
        </section>
        <section aria-labelledby="claims-heading" className="space-y-2">
          <h2 id="claims-heading" className="text-card text-text">Claims and their citations</h2>
          <ClaimList claims={claims} selectedKey={selected?.key ?? null} onSelect={(key, citation, quote, text) => choose(key, citation, quote, `cited by the claim: ${text}`)} />
        </section>
      </div>
      {selected && (
        <div className="w-full lg:max-w-panel lg:flex-1">
          <ClausePanel
            clause={clause}
            quote={selected.quote || undefined}
            reason={selected.reason}
            unresolved={clause ? undefined : selected.citation}
            subject={selected.key.startsWith("claim:") ? "claim" : "figure"}
          />
        </div>
      )}
    </div>
  );
}
