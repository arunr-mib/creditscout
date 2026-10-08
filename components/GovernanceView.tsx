"use client";

import { useState } from "react";
import { GovernancePanel } from "./GovernancePanel";
import { Scoreboard } from "./Scoreboard";
import { ENFORCEMENT_ACTION_LABEL, ENFORCEMENT_RULES } from "./enforcementModel";
import type { PolicyTableRow } from "./governanceModel";
import { evalScoreboardState, runProvenance, scoreboardRows, type EvalRunLike } from "./scoreboardModel";

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
              <span aria-hidden="true">🔒</span> Human approval is required for every recommendation.
            </p>
            <span className="rounded-md border border-border-strong px-3 py-px text-label text-text-muted">Locked</span>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section aria-label="Investigation controls" className="rounded-lg border border-border-strong bg-surface">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-strong px-4 py-3">
                <h2 className="text-section text-model-bright">Investigation limits</h2>
                <span className="rounded-md border border-border-strong px-3 py-px text-label text-text-muted">Read-only</span>
              </div>
              <div className="p-4">
                <p className="mb-3 text-body text-text-secondary">
                  Set by the Risk Officer. The agent operates within these limits and cannot change them.
                </p>
                <GovernancePanel rows={policy} bare />
              </div>
            </section>

            {/* The other half of the control set. The limits above are the Risk
                Officer's and can be changed; these cannot be changed by anyone
                without a code change, and they are what the product's claim
                actually rests on. */}
            <section aria-label="Enforcement rules" className="rounded-lg border border-border-strong bg-surface lg:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-strong px-4 py-3">
                <h2 className="text-section text-model-bright">Enforcement rules (always applied)</h2>
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
                          className={`shrink-0 rounded-full border px-2 py-px text-label ${
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

            <section aria-label="Evaluation results" className="rounded-lg border border-border-strong bg-surface">
              <div className="border-b border-border-strong px-4 py-3">
                <h2 className="text-section text-model-bright">Evaluation results</h2>
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
        </>
      ) : (
        <EvaluationDetails runs={runs} />
      )}

      {/* Shown, not withheld: at n=6 the sample size is the first thing an
          honest reader wants, and both facts are in the row the harness wrote. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
        <p className="text-label text-text-muted">
          <span aria-hidden="true">ⓘ </span>
          Evaluation results describe the recorded test runs, not a guarantee of future performance.
        </p>
        <p className="font-mono text-label text-text-muted">
          {recordedAt ? `Recorded ${recordedAt.slice(0, 10)}` : "No run recorded"}
          {cases != null && ` · ${cases} cases scored`}
        </p>
      </div>
    </div>
  );
}

/** The per-case record behind the headline numbers. */
function EvaluationDetails({ runs }: { runs: EvalRunLike[] }) {
  if (runs.length === 0) {
    return <p className="rounded-lg border border-border bg-surface p-6 text-body text-text-muted">No evaluation run recorded yet.</p>;
  }
  return (
    <div className="space-y-4">
      {runs.map((r, i) => {
        const m = (r.metrics ?? {}) as Record<string, unknown>;
        const cases = Array.isArray(m.cases) ? (m.cases as Record<string, unknown>[]) : [];
        return (
          <section key={`${r.mode}-${i}`} className="rounded-lg border border-border-strong bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-strong px-4 py-3">
              <h2 className="text-card text-text">
                {r.mode === "warm" ? "With prior lessons" : "Without prior lessons"}
                <span className="ml-2 font-mono text-label text-text-muted">{r.mode}</span>
              </h2>
              <span className="font-mono text-label text-text-muted">
                {typeof r.created_at === "string" ? r.created_at.slice(0, 19).replace("T", " ") : "—"}
              </span>
            </div>
            {cases.length === 0 ? (
              <p className="p-4 text-body text-text-muted">This run recorded no per-case detail.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead className="bg-model-bg/50">
                    <tr className="text-label uppercase tracking-wide text-model-bright">
                      <th className="px-4 py-2 font-medium">Case</th>
                      <th className="px-4 py-2 font-medium">Expected</th>
                      <th className="px-4 py-2 font-medium">Recommended</th>
                      <th className="px-4 py-2 text-right font-medium">Steps</th>
                      <th className="px-4 py-2 font-medium">Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cases.map((c, j) => {
                      const match = c.outcome_match === true;
                      const counted = c.counted === true;
                      return (
                        <tr key={j} className="border-t border-border">
                          <td className="px-4 py-2 font-mono text-num text-text">{String(c.case_id ?? "—")}</td>
                          <td className="px-4 py-2 text-body text-text-secondary">{String(c.expected_outcome ?? "—")}</td>
                          <td className="px-4 py-2 text-body text-text-secondary">{String(c.recommendation ?? "—")}</td>
                          <td className="px-4 py-2 text-right font-mono text-num tabular-nums text-text-secondary">
                            {c.steps == null ? "—" : String(c.steps)}
                          </td>
                          <td className="px-4 py-2">
                            {!counted ? (
                              <span className="text-label text-text-muted">not counted</span>
                            ) : match ? (
                              <span className="text-label text-success">matched</span>
                            ) : (
                              <span className="text-label text-danger">missed</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
