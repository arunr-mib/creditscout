"use client";

import { useState } from "react";
import Link from "next/link";
import { CalcTable } from "./CalcTable";
import { ClaimList } from "./ClaimList";
import { GuardrailNotice } from "./GuardrailNotice";
import { TraceArc } from "./TraceArc";
import { TraceStep } from "./TraceStep";
import type { Clause } from "./termsReview";
import type { LiveTraceView } from "./traceModel";
import type { AmendmentStatus, CalcSection, ClaimView, InvestigationSummary, Notice } from "./casefileModel";

/**
 * What the investigation found, and what the analyst still has to check.
 *
 * THE CALCULATION LIVES INSIDE THE FINDING THAT PRODUCED IT. It used to sit in
 * a long table below the fold, which meant the figure and the reason for it
 * were never on screen together. Each step now opens its own calculation in
 * place, so "the original calculation returned 1.12x" and the rows that produce
 * 1.12x are one click apart.
 *
 * Every number here was computed by `investigationSummary` from the calculation
 * log and the guardrail's notes. This component chooses layout, never meaning.
 */
export function CasefileFindings({
  summary,
  sections,
  amendments,
  notes,
  claims,
  clauses,
  trace,
  termsVersion,
  facilityId,
  missingEvidence,
}: {
  summary: InvestigationSummary;
  sections: CalcSection[];
  amendments: AmendmentStatus[];
  notes: Notice[];
  claims: ClaimView[];
  clauses: Record<string, Clause | null>;
  trace: LiveTraceView;
  termsVersion: number | null;
  facilityId: string;
  missingEvidence: string[];
}) {
  const [openStep, setOpenStep] = useState<number | null>(null);
  const [showCitations, setShowCitations] = useState(false);
  const [showNotices, setShowNotices] = useState(false);
  const [evidenceTab, setEvidenceTab] = useState<"evidence" | "activity">("evidence");

  const sectionFor = (calcId: string | null) => (calcId ? (sections.find((s) => s.calcId === calcId) ?? null) : null);
  const linkLabel = (kind: string) =>
    kind === "initial" ? "View calculation" : kind === "addback" ? "View evidence" : "View recalculation";

  const unboarded = amendments.filter((a) => a.effectiveForPeriod && !a.boarded);
  const termsNote = notes.find((n) => n.check === "terms_differ_from_approved") ?? null;

  // items-start: without it the grid stretches every column to the tallest, so a
  // single finding left a panel of empty white and the investigation read as
  // incomplete. Panels are content-sized.
  return (
    <div className="grid items-start gap-4 lg:grid-cols-3">
      {/* ------------------------------------------------ what the agent found */}
      <section aria-label="Investigation findings" className="min-w-0 rounded-lg border border-border bg-surface shadow-card lg:col-span-2">
        <h2 className="border-b border-border-strong px-4 py-3 text-card text-text">Investigation findings</h2>

        <ol className="px-4 py-3">
          {summary.steps.map((step, i) => {
            const open = openStep === step.n;
            const sec = sectionFor(step.calcId);
            const last = i === summary.steps.length - 1;
            return (
              <li key={step.n} className="relative pb-4 last:pb-0">
                {/* The connector: the findings are a sequence, and the arrow is
                    what says so without a sentence. */}
                {!last && (
                  <span aria-hidden="true" className="absolute left-3 top-7 flex h-full w-px flex-col items-center bg-border-strong">
                    <span className="absolute -bottom-1 text-label text-border-strong">▼</span>
                  </span>
                )}
                <div className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className="relative z-10 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-model bg-model-bg font-mono text-label text-model-bright"
                  >
                    {step.n}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <p className="text-body font-medium text-text">{step.title}</p>
                      {(sec || step.kind === "addback") && (
                        <button
                          type="button"
                          onClick={() => setOpenStep(open ? null : step.n)}
                          aria-expanded={open}
                          className="shrink-0 text-label text-model-bright underline-offset-2 hover:underline"
                        >
                          {open ? "Hide" : linkLabel(step.kind)} <span aria-hidden="true">{open ? "⌃" : "›"}</span>
                        </button>
                      )}
                    </div>
                    <p className="mt-1 max-w-prose text-body text-text-secondary">{step.detail}</p>

                    {open && sec && (
                      <div className="mt-3">
                        <CalcTable sections={[sec]} selectedKey={null} onSelect={() => {}} />
                      </div>
                    )}
                    {open && step.kind === "addback" && termsNote && (
                      <p className="mt-3 rounded-md border-l-2 border-l-code bg-code-bg p-3 text-quote text-text-secondary">
                        {termsNote.detail}
                      </p>
                    )}

                    {/* Citations open in the same place, on the same gesture as
                        the evidence above them — the clause a claim rests on is
                        no use three sections away from the claim. */}
                    {step.kind === "addback" && claims.length > 0 && (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => setShowCitations((v) => !v)}
                          aria-expanded={showCitations}
                          className="text-label text-model-bright underline-offset-2 hover:underline"
                        >
                          {showCitations ? "Hide citations" : `View citations · ${claims.length}`}{" "}
                          <span aria-hidden="true">{showCitations ? "⌃" : "›"}</span>
                        </button>
                        {showCitations && (
                          <div className="mt-3">
                            <ClaimList claims={claims} selectedKey={null} onSelect={() => {}} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        {summary.comparison.length > 1 && (
          <details className="border-t border-border-strong">
            {/* Collapsed by default: the figure strip above already states both
                figures, so this is the detail behind a summary the analyst has
                already read. */}
            <summary className="cursor-pointer list-none px-4 py-3 text-card text-text marker:content-['']">
              Calculation comparison <span aria-hidden="true" className="text-label text-model-bright">›</span>
            </summary>
            <div className="px-4 pb-4">
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full border-collapse text-left">
                <thead className="bg-model-bg/50">
                  <tr className="text-label uppercase tracking-wide text-model-bright">
                    <th className="px-3 py-2 font-medium">Basis</th>
                    <th className="px-3 py-2 text-right font-medium">DSCR</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.comparison.map((row) => (
                    <tr key={row.basis} className="border-t border-border">
                      <td className="px-3 py-2 text-body text-text">{row.basis}</td>
                      <td className="px-3 py-2 text-right font-mono text-num tabular-nums text-text">
                        {row.dscr == null ? "—" : `${row.dscr.toFixed(2)}x`}
                      </td>
                      <td className="px-3 py-2">
                        <Pill status={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </div>
          </details>
        )}
      </section>

      {/* ------------------------------------ supporting evidence + attention */}
      <div className="min-w-0 space-y-4">
        {amendments.length > 0 && (
          <section aria-label="Supporting evidence" className="rounded-lg border border-border bg-surface shadow-card">
            <div role="tablist" className="flex border-b border-border-strong">
              <button
                type="button"
                role="tab"
                aria-selected={evidenceTab === "evidence"}
                onClick={() => setEvidenceTab("evidence")}
                className={`px-4 py-3 text-card transition-colors ${evidenceTab === "evidence" ? "border-b-2 border-model text-text" : "text-text-muted hover:text-text-secondary"}`}
              >
                Supporting evidence
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={evidenceTab === "activity"}
                onClick={() => setEvidenceTab("activity")}
                className={`px-4 py-3 text-card transition-colors ${evidenceTab === "activity" ? "border-b-2 border-model text-text" : "text-text-muted hover:text-text-secondary"}`}
              >
                Agent activity{trace.steps.length > 0 ? ` · ${trace.steps.length}` : ""}
              </button>
            </div>
            {evidenceTab === "activity" ? (
              <div className="space-y-3 px-4 py-3">
                {trace.steps.length === 0 ? (
                  <p className="text-body text-text-muted">No activity was recorded for this investigation.</p>
                ) : (
                  <>
                    <TraceArc steps={trace.steps} />
                    <ol className="space-y-4">
                      {trace.steps.map((st) => (
                        <TraceStep key={st.n} step={st} />
                      ))}
                    </ol>
                  </>
                )}
              </div>
            ) : (
            <ul className="space-y-3 px-4 py-3">
              {amendments.map((a) => (
                <li key={a.title}>
                  <p className="text-body text-text">{a.title}</p>
                  {a.effectiveDate && <p className="text-label text-text-muted">Effective {a.effectiveDate}</p>}
                  <p className={`mt-1 text-label ${a.boarded ? "text-success" : a.effectiveForPeriod ? "text-code-bright" : "text-text-muted"}`}>
                    {a.boarded
                      ? "Included in approved terms"
                      : a.effectiveForPeriod
                        ? "Not reflected in approved terms"
                        : "Effective after this period"}
                  </p>
                  {summary.addback && a.effectiveForPeriod && !a.boarded && (
                    <p className="mt-2 text-label text-text-secondary">
                      {summary.addback.name}
                      {summary.addback.cap != null && ` add-back capped at $${summary.addback.cap.toLocaleString("en-US")}`}
                      {summary.addback.cap == null && " add-back, no cap stated"}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            )}
          </section>
        )}

        <section aria-label="Outstanding review items" className="rounded-lg border border-border bg-surface shadow-card">
          <h2 className="border-b border-border-strong px-4 py-3 text-card text-text">Outstanding review items</h2>
          <div className="space-y-3 px-4 py-3">
            {unboarded.map((a) => (
              <div key={a.title} className="flex gap-3">
                <span aria-hidden="true" className="text-card text-code-bright">⚠</span>
                <div className="min-w-0">
                  <p className="text-body text-text">Amendment review pending</p>
                  <p className="mt-1 text-label text-text-muted">
                    {a.title} is not reflected in approved terms{termsVersion != null ? ` v${termsVersion}` : ""}.
                  </p>
                  <Link
                    href={`/facilities/${facilityId}/covenant-setup`}
                    className="mt-2 inline-flex rounded-md border border-border-strong px-3 py-1 text-label text-text hover:bg-surface-raised"
                  >
                    Review amendment and terms
                  </Link>
                </div>
              </div>
            ))}

            {notes.length > 0 && (
              <div className={unboarded.length > 0 ? "border-t border-border pt-4" : ""}>
                <div className="flex items-start justify-between gap-3">
                  <p className="text-body text-text-secondary">
                    {notes.length} validation notice{notes.length === 1 ? "" : "s"} to review
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowNotices((v) => !v)}
                    aria-expanded={showNotices}
                    className="shrink-0 text-label text-model-bright underline-offset-2 hover:underline"
                  >
                    {showNotices ? "Hide" : "View"} notice{notes.length === 1 ? "" : "s"}
                  </button>
                </div>
                {/* Opens HERE, in the box. Sending the analyst down the page to
                    read what must be read before deciding is how it goes unread. */}
                {showNotices && (
                  <div className="mt-3 space-y-2 text-quote">
                    {notes.map((n, i) => (
                      <GuardrailNotice key={`${n.check}-${i}`} notice={n} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {missingEvidence.length > 0 && (
              <div className="border-t border-border pt-4">
                <p className="text-body text-text">Evidence the agent says is not on file</p>
                <ul className="mt-1 space-y-1">
                  {missingEvidence.map((m, i) => (
                    <li key={i} className="text-label text-text-muted">{m}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Pill({ status }: { status: string }) {
  const tone =
    status === "below_minimum" ? "border-danger bg-danger-bg text-danger"
      : status === "meets_minimum" ? "border-success bg-success-bg text-success"
        : status === "provisional" ? "border-code bg-code-bg text-code-bright"
          : "border-border-strong text-text-muted";
  const label =
    status === "below_minimum" ? "Below minimum"
      : status === "meets_minimum" ? "Meets minimum"
        : status === "provisional" ? "Provisional"
          : "Not computed";
  return <span className={`inline-flex whitespace-nowrap rounded border px-3 py-px text-label ${tone}`}>{label}</span>;
}
