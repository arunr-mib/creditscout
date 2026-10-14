"use client";

import { useState } from "react";
import { GovernancePanel } from "./GovernancePanel";
import { Scoreboard } from "./Scoreboard";
import { ENFORCEMENT_ACTION_LABEL, ENFORCEMENT_RULES } from "./enforcementModel";
import type { PolicyTableRow } from "./governanceModel";
import { caseComparison,
  comparisonSummary,
  evalScoreboardState, runProvenance, scoreboardRows, type EvalRunLike } from "./scoreboardModel";

/**
 * Policy and performance on one screen.
 *
 * The two halves answer different questions and must not blur: the controls are
 * what the agent MAY do, set by the Risk Officer and read-only here; the
 * evaluation is how it SCORED on recorded runs. Neither is a promise about the
 * next investigation, which is why the footer says so in those words.
 *
 * The callouts under the table name the two results that miss their target.
 * Leaving a reader to work that out from a grid of numbers is how a scoreboard
 * ends up read as a pass.
 */
export function GovernanceView({ policy, runs }: { policy: PolicyTableRow[]; runs: EvalRunLike[] }) {
  const [tab, setTab] = useState<"overview" | "details">("overview");
  const { cold, warm } = evalScoreboardState(runs);
  const { recordedAt, cases } = runProvenance(runs);

  const coldCells = scoreboardRows(cold?.metrics);
  const warmCells = scoreboardRows(warm?.metrics);
  const cell = (key: string, mode: "cold" | "warm") =>
    (mode === "cold" ? coldCells : warmCells).find((c) => c.key === key) ?? null;

  const outcome = { cold: cell("outcome_accuracy", "cold"), warm: cell("outcome_accuracy", "warm") };
  const steps = { cold: cell("avg_steps", "cold"), warm: cell("avg_steps", "warm") };

  const outcomeMisses =
    (outcome.cold?.status === "danger" || outcome.warm?.status === "danger") &&
    (outcome.cold?.display || outcome.warm?.display);
  const noReduction =
    steps.cold?.value != null && steps.warm?.value != null && steps.warm.value >= steps.cold.value;

  const tabBtn = (active: boolean) =>
    `px-4 py-2 text-body transition-colors ${active ? "border-b-2 border-model text-text" : "text-text-muted hover:text-text-secondary"}`;

  return (
    <div className="space-y-6">
      <div role="tablist" className="flex border-b border-border-strong">
        <button type="button" role="tab" aria-selected={tab === "overview"} onClick={() => setTab("overview")} className={tabBtn(tab === "overview")}>
          Overview
        </button>
        <button type="button" role="tab" aria-selected={tab === "details"} onClick={() => setTab("details")} className={tabBtn(tab === "details")}>
          Evaluation details
        </button>
      </div>

      {tab === "overview" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-strong border-l-2 border-l-model bg-surface px-4 py-3">
            <p className="flex items-center gap-3 text-card text-text">
              Human approval is required for every recommendation.
            </p>
            <span className="rounded-md border border-border-strong px-3 py-px text-label text-text-muted">Locked</span>
          </div>

          {/* Limits and evaluation side by side, each as tall as its own content.
              Evaluation used to sit BELOW the full-width enforcement list, which
              left a column of empty space beside the limits card. */}
          <div className="grid items-start gap-6 lg:grid-cols-[55fr_45fr]">
            <section aria-label="Investigation controls" className="rounded-lg border border-border bg-surface shadow-card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-strong px-4 py-3">
                <h2 className="text-section text-text">Investigation limits</h2>
                <span className="rounded-md border border-border-strong px-3 py-px text-label text-text-muted">Read-only</span>
              </div>
              <div className="p-4">
                <p className="mb-3 text-body text-text-secondary">
                  Set by the Risk Officer. The agent operates within these limits and cannot change them.
                </p>
                <GovernancePanel rows={policy} bare />
              </div>
            </section>

            <section aria-label="Evaluation results" className="rounded-lg border border-border bg-surface shadow-card">
              <div className="border-b border-border-strong px-4 py-3">
                <h2 className="text-section text-text">Evaluation results</h2>
                <p className="mt-1 text-body text-text-secondary">
                  Compare runs without prior lessons and with prior lessons.
                </p>
                <p className="mt-1 text-label text-text-muted">
                  Cold: without prior lessons · Warm: with prior lessons
                </p>
              </div>
              <div className="space-y-4 p-4">
                <Scoreboard runs={runs} bare />

                {/* The two results that miss. Named, not left in the grid. */}
                {(outcomeMisses || noReduction) && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {outcomeMisses && (
                      <div className="rounded-md border-l-2 border-l-danger bg-danger-bg p-3">
                        <p className="text-body text-danger">
                          <span aria-hidden="true">⚠ </span>Outcome accuracy below target
                        </p>
                        <p className="mt-1 text-label text-text-secondary">
                          {outcome.cold?.display ?? "—"} cold and {outcome.warm?.display ?? "—"} warm, against a target of
                          at least 85%.
                        </p>
                      </div>
                    )}
                    {noReduction && (
                      <div className="rounded-md border-l-2 border-l-code bg-code-bg p-3">
                        <p className="text-body text-code-bright">
                          <span aria-hidden="true">⚠ </span>No step reduction observed
                        </p>
                        <p className="mt-1 text-label text-text-secondary">
                          Average steps went from {steps.cold?.display} to {steps.warm?.display} with prior lessons.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          </div>


            {/* The other half of the control set. The limits above are the Risk
                Officer's and can be changed; these cannot be changed by anyone
                without a code change, and they are what the product's claim
                actually rests on. */}
            <section aria-label="Enforcement rules" className="rounded-lg border border-border bg-surface shadow-card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-strong px-4 py-3">
                <h2 className="text-section text-text">Enforcement rules (always applied)</h2>
                <span className="rounded-md border border-border-strong px-3 py-px text-label text-text-muted">
                  Not configurable
                </span>
              </div>
              <div className="p-4">
                <p className="mb-3 max-w-prose text-body text-text-secondary">
                  These run on every investigation regardless of the limits above. Nobody can switch them off — each one
                  appears on the casefile as a validation notice when it fires.
                </p>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {ENFORCEMENT_RULES.map((r) => (
                    <li key={r.check} className="rounded-md border border-border bg-surface-raised p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-body text-text">{r.title}</p>
                        <span
                          className={`shrink-0 rounded border px-2 py-px text-label ${
                            r.action === "abstain" || r.action === "escalate"
                              ? "border-danger/40 text-danger"
                              : "border-code/40 text-code-bright"
                          }`}
                        >
                          {ENFORCEMENT_ACTION_LABEL[r.action]}
                        </span>
                      </div>
                      <p className="mt-1 text-label text-text-muted">{r.detail}</p>
                      <p className="mt-2 font-mono text-badge text-text-muted">{r.check}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
        </>
      ) : (
        <EvaluationDetails runs={runs} />
      )}

      {/* Shown, not withheld: at n=6 the sample size is the first thing an
          honest reader wants, and both facts are in the row the harness wrote. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface shadow-card px-4 py-3">
        <p className="text-label text-text-muted">
          <span aria-hidden="true">ⓘ </span>
          Evaluation results describe the recorded test runs, not a guarantee of future performance.
        </p>
        <p className="text-label text-text-muted">
          {recordedAt ? `Recorded ${recordedAt.slice(0, 10)}` : "No run recorded"}
          {cases != null && ` · ${cases} cases scored`}
        </p>
      </div>
    </div>
  );
}

/**
 * The per-case record behind the headline numbers, as ONE paired table.
 *
 * It used to be a table per run: the same ten cases repeated, most of them
 * "not counted" em-dashes, and several runs rendering only "This run recorded
 * no per-case detail." Comparing the two conditions meant holding two tables in
 * your head and scrolling between them.
 *
 * The analyst-facing headings are "Without prior lessons" and "With prior
 * lessons"; `cold`/`warm` are the harness's words and stay in the metadata line.
 */
function EvaluationDetails({ runs }: { runs: EvalRunLike[] }) {
  const { cold, warm } = evalScoreboardState(runs);
  const rows = caseComparison(cold, warm);
  const summary = comparisonSummary(cold, warm);
  const scored = rows.filter((r) => r.counted);
  const unscored = rows.filter((r) => !r.counted);

  if (rows.length === 0) {
    return <p className="rounded-lg border border-border bg-surface shadow-card p-6 text-body text-text-muted">No evaluation run recorded yet.</p>;
  }

  // The Result must describe BOTH conditions. Showing only the warm verdict
  // read "matched" on a case the cold run missed.
  const verdict = (r: { without: { matched: boolean | null } | null; with_: { matched: boolean | null } | null }) => {
    const a = r.without?.matched ?? null;
    const b = r.with_?.matched ?? null;
    if (a === null && b === null) return <span className="text-label text-text-muted">Not measured</span>;
    if (a === b) {
      return a === true
        ? <span className="text-label text-success">matched in both</span>
        : <span className="text-label text-danger">missed in both</span>;
    }
    return (
      <span className="text-label text-code">
        {b === true ? "matched only with lessons" : "matched only without lessons"}
      </span>
    );
  };

  // A case the code decided without an agent was still SCORED. Calling that
  // "Not measured" reads as a gap in the evaluation when it is the design.
  const cellOf = (side: { recommendation: string | null; steps: number | null; matched: boolean | null } | null) =>
    side == null ? <span className="text-text-muted">Not run</span> : side.recommendation == null ? (
      <span className="text-text-muted">No investigation — decided by code</span>
    ) : (
      <>
        <span className="text-text-secondary">{side.recommendation}</span>
        {side.steps != null && <span className="ml-2 text-label tabular-nums text-text-muted">{side.steps} steps</span>}
      </>
    );

  return (
    <div className="space-y-4">
      {summary && (
        <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <h2 className="text-card text-text">{summary.headline}</h2>
          <p className="mt-1 max-w-prose text-body text-text-secondary">{summary.detail}</p>
        </section>
      )}

      <section className="rounded-lg border border-border bg-surface shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="text-card text-text">Case comparison</h2>
          <span className="text-label text-text-muted">
            {cold?.created_at ? cold.created_at.slice(0, 10) : ""} · cold / warm
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead className="bg-surface-raised">
              <tr className="text-label uppercase tracking-wide text-text-muted">
                <th className="px-4 py-2 font-medium">Case</th>
                <th className="px-4 py-2 font-medium">Expected</th>
                <th className="px-4 py-2 font-medium">Without prior lessons</th>
                <th className="px-4 py-2 font-medium">With prior lessons</th>
                <th className="px-4 py-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {scored.map((r) => (
                <tr key={r.caseId} className="border-t border-border">
                  <td className="px-4 py-2 font-mono text-num text-text">{r.caseId}</td>
                  <td className="px-4 py-2 text-body text-text-secondary">{r.expected ?? "Not measured"}</td>
                  <td className="px-4 py-2 text-body">{cellOf(r.without)}</td>
                  <td className="px-4 py-2 text-body">{cellOf(r.with_)}</td>
                  <td className="px-4 py-2">{verdict(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Listed ONCE, quietly, instead of filling both tables with dashes. */}
        {unscored.length > 0 && (
          <p className="border-t border-border px-4 py-3 text-label text-text-muted">
            Not scored in either condition ({unscored.length}): {unscored.map((r) => r.caseId).join(", ")}. The five
            onboarding borrowers are never seeded, so the harness lists them and does not investigate them.
          </p>
        )}
      </section>
    </div>
  );
}
