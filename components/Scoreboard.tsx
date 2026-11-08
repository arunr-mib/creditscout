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
/** `bare` drops the heading: on Governance the card already supplies it. */
export function Scoreboard({ runs, bare = false }: { runs: EvalRunLike[]; bare?: boolean }) {
  const { state, cold, warm } = evalScoreboardState(runs);

  return (
    <section aria-label="Eval scoreboard" className="space-y-3">
      {!bare && <h2 className="text-section text-text">Eval scoreboard</h2>}

      {state === "awaiting" ? (
        <div className="space-y-2 rounded-xl border border-border bg-surface shadow-card p-6">
          <p className="text-body text-text-secondary">Not measured yet.</p>
          <p className="max-w-prose text-label text-text-muted">
            The harness runs every labelled case twice — once with memory cleared (cold) and once with prior analyst
            lessons loaded (warm) — and scores false resolves, calculation accuracy, outcome accuracy, correct
            abstain/request, citation hit rate, groundedness, and the memory effect (average steps, cold vs warm). No
            number is shown as a measured zero until a run exists.
          </p>
          <p className="text-label text-text-muted">{RUN_EVAL_HARNESS}</p>
        </div>
      ) : (
        <ScoreboardTable cold={cold ? scoreboardRows(cold.metrics) : null} warm={warm ? scoreboardRows(warm.metrics) : null} />
      )}
    </section>
  );
}

function ScoreboardTable({ cold, warm }: { cold: MetricCell[] | null; warm: MetricCell[] | null }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      <table className="w-full border-collapse">
        <thead className="bg-surface-raised">
          <tr className="border-b border-border">
            <th className="px-4 py-2 text-left text-label uppercase tracking-wide text-text-muted">Metric</th>
            <th className="px-4 py-2 text-right text-label uppercase tracking-wide text-text-muted">Target</th>
            {/* The analyst-facing names. `cold`/`warm` are the harness's words
                and stay in the metadata line beneath the card's heading. */}
            <th className="px-4 py-2 text-right text-label uppercase tracking-wide text-text-muted">Without lessons</th>
            <th className="px-4 py-2 text-right text-label uppercase tracking-wide text-text-muted">With lessons</th>
          </tr>
        </thead>
        <tbody>
          {METRICS.map((spec, i) => (
            <tr key={spec.key} className="h-12 border-b border-border last:border-b-0 hover:bg-surface-raised">
              <td className="px-4 align-middle text-label text-text">{spec.label}</td>
              <td className="px-4 py-2 text-right align-middle text-num tabular-nums text-text-secondary">
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
    return <td className="px-4 py-2 text-right align-middle text-num tabular-nums text-text-muted">—</td>;
  }
  return (
    <td className={`px-4 py-2 text-right align-middle text-num tabular-nums ${STATUS_CLASS[cell.status]}`}>
      {cell.display}
    </td>
  );
}
