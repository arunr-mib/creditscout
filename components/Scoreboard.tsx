import {
  type EvalRunLike,
  type MetricCell,
  type MetricStatus,
  METRICS,
  RUN_EVAL_HARNESS,
  evalScoreboardState,
  scoreboardRows,
} from "@/components/scoreboardModel";

/**
 * The eval scoreboard (design.md §12.16): metric rows name · target · actual,
 * with the cold and warm passes side by side so the memory effect (avg steps)
 * is read across the two columns.
 *
 * The false-resolve row is a GATE, not a trend: exactly 0 is success, any
 * non-zero is danger, with no softening. `eval_runs` is empty until stage 10
 * runs the harness, so the honest primary state is an empty state that names the
 * next action — a metric never reported renders an em dash, never a measured 0.
 */
export function Scoreboard({ runs }: { runs: EvalRunLike[] }) {
  const { state, cold, warm } = evalScoreboardState(runs);

  return (
    <section aria-label="Eval scoreboard" className="space-y-3">
      <h2 className="text-section text-text">Eval scoreboard</h2>

      {state === "awaiting" ? (
        <div className="rounded-lg border border-border bg-surface p-6">
          <p className="text-body text-text-secondary">No eval run yet.</p>
          <p className="mt-1 text-label text-text-muted">{RUN_EVAL_HARNESS}</p>
        </div>
      ) : (
        <ScoreboardTable cold={cold ? scoreboardRows(cold.metrics) : null} warm={warm ? scoreboardRows(warm.metrics) : null} />
      )}
    </section>
  );
}

function ScoreboardTable({ cold, warm }: { cold: MetricCell[] | null; warm: MetricCell[] | null }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="px-4 py-2 text-left text-label uppercase tracking-wide text-text-muted">Metric</th>
            <th className="px-4 py-2 text-right text-label uppercase tracking-wide text-text-muted">Target</th>
            <th className="px-4 py-2 text-right text-label uppercase tracking-wide text-text-muted">Cold</th>
            <th className="px-4 py-2 text-right text-label uppercase tracking-wide text-text-muted">Warm</th>
          </tr>
        </thead>
        <tbody>
          {METRICS.map((spec, i) => (
            <tr key={spec.key} className="h-10 border-b border-border last:border-b-0 hover:bg-surface-raised">
              <td className="px-4 align-middle text-label text-text">{spec.label}</td>
              <td className="px-4 py-2 text-right align-middle font-mono text-num tabular-nums text-text-secondary">
                {spec.target}
              </td>
              <Actual cell={cold ? cold[i] : null} />
              <Actual cell={warm ? warm[i] : null} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATUS_CLASS: Record<MetricStatus, string> = {
  success: "text-success",
  danger: "text-danger",
  neutral: "text-text",
  missing: "text-text-muted",
};

function Actual({ cell }: { cell: MetricCell | null }) {
  // No run for this mode at all, or the metric wasn't reported: an em dash, never 0.
  if (!cell || cell.display === null) {
    return <td className="px-4 py-2 text-right align-middle font-mono text-num tabular-nums text-text-muted">—</td>;
  }
  return (
    <td className={`px-4 py-2 text-right align-middle font-mono text-num tabular-nums ${STATUS_CLASS[cell.status]}`}>
      {cell.display}
    </td>
  );
}
