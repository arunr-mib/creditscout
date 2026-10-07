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

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="min-w-0 space-y-6 lg:flex-1">
        <section aria-labelledby="calc-heading" className="space-y-2">
          <h2 id="calc-heading" className="text-card text-text">Calculation</h2>
          <CalcTable
            sections={sections}
            selectedKey={selected?.key ?? null}
            onSelect={(key, citation, quote) => choose(key, citation, quote, `quoted figure · ${citation}`)}
          />
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
