"use client";

import { useState } from "react";
import { CalcTable } from "./CalcTable";
import { ClaimList } from "./ClaimList";
import type { CalcSection, ClaimView } from "./casefileModel";
import { ClausePanel } from "./ClausePanel";
import { TraceArc } from "./TraceArc";
import { TraceStep } from "./TraceStep";
import type { LiveTraceView } from "./traceModel";
import type { Clause } from "./termsReview";

type Selection = { key: string; citation: string; quote: string; reason: string };

/**
 * The evidence workspace (audit 3.3 / 3.5): the deterministic calculation and
 * the claims on the LEFT, and a persistent pane on the RIGHT with two tabs —
 * Source (the clause a selected citation resolves to, highlighted) and Trace
 * (what the investigation did). Selecting a citation anywhere opens it in the
 * Source tab; selecting the same one again clears it. The clause was resolved on
 * the server, so one that resolved to nothing says so rather than blanking.
 *
 * Guardrail notices deliberately stay OUT of this pane and in the main flow
 * above the actions — they must always be visible before a decision, never
 * behind a tab.
 */
export function CasefileEvidence(props: {
  sections: CalcSection[];
  claims: ClaimView[];
  clauses: Record<string, Clause | null>;
  trace: LiveTraceView;
}) {
  const { sections, claims, clauses, trace } = props;
  const [selected, setSelected] = useState<Selection | null>(null);
  const [tab, setTab] = useState<"source" | "trace">("source");

  const choose = (key: string, citation: string, quote: string, reason: string) => {
    setTab("source");
    setSelected((cur) => (cur?.key === key ? null : { key, citation, quote, reason }));
  };
  const onPick = (key: string, citation: string, quote: string) => choose(key, citation, quote, `quoted figure · ${citation}`);

  const clause = selected ? (clauses[selected.citation] ?? null) : null;
  const governing = sections.filter((s) => s.governing);
  const earlier = sections.filter((s) => !s.governing);

  // "Used by": how many figures and claims rest on the selected citation (audit 3.5).
  const usedBy = selected
    ? claims.filter((c) => c.citation === selected.citation).length +
      sections.reduce((n, s) => n + s.rows.filter((r) => r.source.kind === "quoted" && r.source.citation === selected.citation).length, 0)
    : 0;

  const tabBtn = (active: boolean) =>
    `px-3 py-2 text-label transition-colors ${active ? "border-b-2 border-model text-text" : "text-text-muted hover:text-text-secondary"}`;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      {/* LEFT — calculation and claims */}
      <div className="min-w-0 space-y-6 lg:col-span-3">
        <section aria-labelledby="calc-heading" className="space-y-2">
          <div className="flex items-baseline gap-3">
            <h2 id="calc-heading" className="text-card text-text">
              {governing.length > 0 ? "Governing calculation" : "Calculation"}
            </h2>
            {governing.length > 0 && <span className="text-label text-text-muted">the figure the recommendation rests on</span>}
          </div>
          <CalcTable sections={governing.length > 0 ? governing : sections} selectedKey={selected?.key ?? null} onSelect={onPick} />
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
          <ClaimList
            claims={claims}
            selectedKey={selected?.key ?? null}
            onSelect={(key, citation, quote, text) => choose(key, citation, quote, `cited by the claim: ${text}`)}
          />
        </section>
      </div>

      {/* RIGHT — persistent evidence pane: Source | Trace */}
      <div className="lg:col-span-2">
        <div className="lg:sticky lg:top-4 overflow-hidden rounded-md border border-border-strong bg-surface">
          <div role="tablist" className="flex border-b border-border">
            <button type="button" role="tab" aria-selected={tab === "source"} onClick={() => setTab("source")} className={tabBtn(tab === "source")}>
              Source
            </button>
            <button type="button" role="tab" aria-selected={tab === "trace"} onClick={() => setTab("trace")} className={tabBtn(tab === "trace")}>
              Trace{trace.steps.length > 0 ? ` · ${trace.steps.length}` : ""}
            </button>
          </div>

          {tab === "source" ? (
            <div className="p-3">
              {selected ? (
                <>
                  {usedBy > 1 && (
                    <p className="mb-2 text-label text-text-muted">
                      Used by {usedBy} figures and claims in this casefile.
                    </p>
                  )}
                  <ClausePanel
                    clause={clause}
                    quote={selected.quote || undefined}
                    reason={selected.reason}
                    unresolved={clause ? undefined : selected.citation}
                    subject={selected.key.startsWith("claim:") ? "claim" : "figure"}
                  />
                </>
              ) : (
                <p className="text-body text-text-muted">
                  Select a citation — a chip in the calculation or a claim — to read the exact clause it rests on, highlighted.
                </p>
              )}
            </div>
          ) : (
            <div className="p-3">
              {trace.steps.length === 0 ? (
                <p className="text-body text-text-muted">No trace was recorded for this investigation.</p>
              ) : (
                <div className="space-y-4">
                  <TraceArc steps={trace.steps} />
                  <ol className="space-y-4">
                    {trace.steps.map((step) => (
                      <TraceStep key={step.n} step={step} />
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
