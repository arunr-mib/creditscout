"use client";

import { useState } from "react";
import Link from "next/link";
import { CalcTable } from "./CalcTable";
import { ClaimList } from "./ClaimList";
import { GuardrailNotice } from "./GuardrailNotice";
import { TraceArc } from "./TraceArc";
import { TraceStep } from "./TraceStep";
import { activityState, type LiveTraceView } from "./traceModel";
import { dateLabel, longDate } from "@/lib/terms-labels";
import type { AmendmentStatus, CalcSection, ClaimView, InvestigationSummary, Notice } from "./casefileModel";

/**
 * What the investigation found, what it rests on, and what is still open.
 *
 * THE CALCULATION LIVES INSIDE THE FINDING THAT PRODUCED IT. It used to sit in
 * a long table below the fold, which meant the figure and the reason for it
 * were never on screen together. Each finding opens its own calculation in
 * place, so "the original calculation returned 1.12x" and the rows that produce
 * 1.12x are one click apart.
 *
 * REBUILT 2026-10-14 against the reference composition. What went:
 *   - the numbered timeline with connector arrows. The findings are a sequence
 *     of three short rows; a rail and chevrons were more structure than the
 *     content carries.
 *   - the tabs over the evidence column. Two tabs to hold one list of documents
 *     and one activity log, where the list is what an analyst opens and the log
 *     is what they occasionally check.
 *   - monospace figures and three colours of state pill in the comparison.
 *
 * Every number here was computed by `investigationSummary` from the calculation
 * log and the guardrail's notes. This component chooses layout, never meaning.
 */

/** The mark on a finding. Outline, tinted once — it labels the kind, not a verdict. */
const STEP_ICON: Record<string, string> = {
  initial: "⌕",
  addback: "§",
  recalculation: "=",
};

export function CasefileFindings({
  summary,
  sections,
  amendments,
  notes,
  claims,
  trace,
  termsVersion,
  facilityId,
  missingEvidence,
  amendmentEffect,
  documents,
}: {
  summary: InvestigationSummary;
  sections: CalcSection[];
  amendments: AmendmentStatus[];
  notes: Notice[];
  claims: ClaimView[];
  trace: LiveTraceView;
  termsVersion: number | null;
  facilityId: string;
  missingEvidence: string[];
  /** Why the pending amendment does not change this period's result. */
  amendmentEffect?: string | null;
  documents: { id: string; title: string; docType: string | null; date: string | null }[];
}) {
  const [openStep, setOpenStep] = useState<number | null>(null);
  const [showCitations, setShowCitations] = useState(false);
  const [showNotices, setShowNotices] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [allDocs, setAllDocs] = useState(false);

  const sectionFor = (calcId: string | null) => (calcId ? (sections.find((s) => s.calcId === calcId) ?? null) : null);
  const linkLabel = (kind: string) =>
    kind === "initial" ? "View calculation" : kind === "addback" ? "View evidence" : "View recalculation";

  const unboarded = amendments.filter((a) => a.effectiveForPeriod && !a.boarded);
  const termsNote = notes.find((n) => n.check === "terms_differ_from_approved") ?? null;
  const unboardedTitles = new Set(unboarded.map((a) => a.title));
  // The step the citations hang off: the one that weighed the evidence, or the
  // last one when the investigation had no such step.
  const citationStep =
    summary.steps.find((st) => st.kind === "addback")?.n ?? summary.steps[summary.steps.length - 1]?.n ?? null;
  const shownDocs = allDocs ? documents : documents.slice(0, EVIDENCE_SHOWN);

  // items-start: without it the grid stretches every column to the tallest, so a
  // single finding left a panel of empty white and the investigation read as
  // incomplete. Panels are content-sized.
  return (
    <div className="grid items-start gap-4 lg:grid-cols-3">
      {/* ------------------------------------------------ what the agent found */}
      <section aria-label="Investigation findings" className="min-w-0 rounded-lg border border-border-strong bg-surface shadow-card lg:col-span-2">
        <h2 className="px-6 pb-3 pt-4 text-section font-bold text-text">Investigation findings</h2>

        <ol className="px-6">
          {summary.steps.map((step, i) => {
            const open = openStep === step.n;
            const sec = sectionFor(step.calcId);
            const detail = step.kind === "addback" && amendmentEffect ? amendmentEffect : step.detail;
            return (
              <li key={step.n} className={i > 0 ? "border-t border-border py-3" : "pb-3"}>
                <div className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-surface-raised text-label text-text-muted"
                  >
                    {STEP_ICON[step.kind] ?? "·"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <p className="text-body font-bold text-text">{step.title}</p>
                      {(sec || step.kind === "addback") && (
                        <button
                          type="button"
                          onClick={() => setOpenStep(open ? null : step.n)}
                          aria-expanded={open}
                          className="shrink-0 text-body text-model-bright underline-offset-2 hover:underline"
                        >
                          {open ? "Hide" : linkLabel(step.kind)} <span aria-hidden="true">{open ? "⌃" : "→"}</span>
                        </button>
                      )}
                    </div>
                    <p className="mt-1 max-w-prose text-body text-text-secondary">{detail}</p>

                    {open && sec && (
                      <div className="mt-3">
                        <CalcTable sections={[sec]} selectedKey={null} onSelect={() => {}} />
                      </div>
                    )}
                    {open && step.kind === "addback" && termsNote && (
                      <p className="mt-3 rounded-md border border-border bg-surface-raised p-3 text-quote text-text-secondary">
                        {termsNote.detail}
                      </p>
                    )}

                    {/* Citations open in the same place, on the same gesture as
                        the evidence above them — the clause a claim rests on is
                        no use three sections away from the claim.
                        ON THE STEP THAT CARRIES THE EVIDENCE, or on the last
                        step when no step does: a true breach (F3) has no
                        add-back step, and its cited quotes had no route in at
                        all. */}
                    {step.n === citationStep && claims.length > 0 && (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => setShowCitations((v) => !v)}
                          aria-expanded={showCitations}
                          className="text-label text-text-muted underline-offset-2 hover:text-text-secondary hover:underline"
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
          <div className="border-t border-border px-6 py-3">
            {/* VISIBLE, not behind a disclosure. This is the central evidence
                for the decision — what the test produced under which basis.
                Quiet, though: three coloured pills on three rows made a
                two-line table look like a dashboard. */}
            <h3 className="text-label font-semibold uppercase tracking-wide text-text">Calculation comparison</h3>
            <table className="mt-2 w-full border-collapse text-left">
              <tbody>
                {summary.comparison.map((row) => (
                  <tr key={row.basis} className="border-t border-border first:border-t-0">
                    <td className="py-1 pr-4 text-body text-text">{row.basis}</td>
                    <td className="py-1 pr-4 text-right text-body tabular-nums text-text">
                      {row.dscr == null ? "—" : `${row.dscr.toFixed(2)}x`}
                    </td>
                    <td className={`py-1 text-right text-body ${row.status === "provisional" ? "text-code-bright" : "text-text-secondary"}`}>
                      {STATE_LABEL[row.status] ?? row.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-label text-text-muted">Each row is a logged calculation with its own calc_id.</p>
          </div>
        )}

        {/* The agent's steps: available, and not a tab competing with the
            evidence an analyst actually opens. */}
        {trace.steps.length > 0 && (
          <div className="border-t border-border px-6 py-2">
            <button
              type="button"
              onClick={() => setShowActivity((v) => !v)}
              aria-expanded={showActivity}
              className="text-label text-text-muted underline-offset-2 hover:text-text-secondary hover:underline"
            >
              {showActivity ? "Hide agent activity" : `Agent activity · ${trace.steps.length} steps`}{" "}
              <span aria-hidden="true">{showActivity ? "⌃" : "›"}</span>
            </button>
            {showActivity && (
              <div className="mt-3 space-y-3">
                <TraceArc steps={trace.steps} />
                <ol className="space-y-0">
                  {trace.steps.map((st, i) => (
                    // `state`, or every row reads "Completed" — including a
                    // calculator call that returned `missing input: …` and
                    // produced no ratio at all.
                    <TraceStep key={st.n} step={st} state={activityState(st)} last={i === trace.steps.length - 1} />
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ------------------------------------ supporting evidence + attention */}
      <div className="min-w-0 space-y-4">
        {documents.length > 0 && (
          <section aria-label="Supporting evidence" className="rounded-lg border border-border-strong bg-surface shadow-card">
            <h2 className="px-6 pb-3 pt-4 text-section font-bold text-text">Supporting evidence</h2>
            {/* The governing documents first, and the rest on request. A loan
                with four quarters of filings listed nine rows beside a
                three-row finding list, which buried the agreement under the
                statements. */}
            <ul className="px-6">
              {shownDocs.map((d, i) => (
                <li key={d.id} className={`flex items-center gap-3 py-2 ${i > 0 ? "border-t border-border" : ""}`}>
                  <span
                    aria-hidden="true"
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-surface-raised text-label text-text-muted"
                  >
                    ▤
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-semibold text-text" title={d.title}>
                      {d.title}
                    </p>
                    {/* The date NAMED for what it is — an agreement has an
                        effective date, financials a period end. It keeps its
                        own line: folded onto the title it truncated in this
                        column, and a date you cannot read is worse than a date
                        that costs a line. */}
                    {d.date && (
                      <p className="text-label text-text-muted">
                        {dateLabel(d.docType)} {longDate(d.date)}
                      </p>
                    )}
                    {/* The boarding lag, said on the document it is about. */}
                    {unboardedTitles.has(d.title) && (
                      <p className="text-label text-code-bright">Not reflected in approved terms</p>
                    )}
                  </div>
                  {/* The source itself — the passages the agent read, in order. */}
                  <Link
                    href={`/documents/${d.id}`}
                    className="shrink-0 text-body text-model-bright underline-offset-2 hover:underline"
                  >
                    View source <span aria-hidden="true">→</span>
                  </Link>
                </li>
              ))}
            </ul>
            {documents.length > EVIDENCE_SHOWN && (
              <div className="px-6 pb-3 pt-1">
                <button
                  type="button"
                  onClick={() => setAllDocs((v) => !v)}
                  aria-expanded={allDocs}
                  className="text-body text-model-bright underline-offset-2 hover:underline"
                >
                  {allDocs ? "Show fewer documents" : `Show all ${documents.length} documents`}{" "}
                  <span aria-hidden="true">{allDocs ? "⌃" : "›"}</span>
                </button>
              </div>
            )}
          </section>
        )}

        <section
          id="outstanding"
          aria-label="Outstanding review items"
          className="scroll-mt-4 rounded-lg border border-border-strong bg-surface shadow-card"
        >
          <h2 className="px-6 pb-3 pt-4 text-section font-bold text-text">Outstanding review items</h2>
          <div className="space-y-3 px-6 pb-4">
            {unboarded.length === 0 && notes.length === 0 && missingEvidence.length === 0 && (
              <p className="text-body text-text-muted">Nothing is outstanding on this casefile.</p>
            )}

            {unboarded.map((a) => (
              <div key={a.title}>
                <p className="text-body font-semibold text-text">Amendment review pending</p>
                <p className="mt-1 text-body text-text-secondary">
                  {a.title} is not reflected in approved terms{termsVersion != null ? ` v${termsVersion}` : ""}.
                </p>
                <Link
                  href={`/facilities/${facilityId}/covenant-setup`}
                  className="mt-1 inline-flex text-body text-model-bright underline-offset-2 hover:underline"
                >
                  Review amendment and terms&nbsp;<span aria-hidden="true">→</span>
                </Link>
              </div>
            ))}

            {notes.length > 0 && (
              <div className={unboarded.length > 0 ? "border-t border-border pt-3" : ""}>
                <div className="flex items-start justify-between gap-3">
                  <p className="text-body text-text-secondary">
                    {notes.length} validation notice{notes.length === 1 ? "" : "s"} to review
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowNotices((v) => !v)}
                    aria-expanded={showNotices}
                    className="shrink-0 text-body text-model-bright underline-offset-2 hover:underline"
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
              <div className={unboarded.length > 0 || notes.length > 0 ? "border-t border-border pt-3" : ""}>
                <p className="text-body font-semibold text-text">Evidence the agent says is not on file</p>
                <ul className="mt-1 space-y-1">
                  {missingEvidence.map((m, i) => (
                    <li key={i} className="text-body text-text-secondary">
                      {m}
                    </li>
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

/** How many documents the evidence panel shows before asking. */
const EVIDENCE_SHOWN = 4;

/** The comparison's state, in words. It was three coloured pills on three rows. */
const STATE_LABEL: Record<string, string> = {
  below_minimum: "Below minimum",
  meets_minimum: "Meets minimum",
  provisional: "Provisional",
  unknown: "Not computed",
};
