import { activityAttribution, activitySummary, type TraceStepView } from "./traceModel";

/**
 * The investigation as a one-line plan, above the steps — so the trace reads as
 * an orchestration the agent carried out, not a log of calls. Renders nothing
 * until there is at least one step, so the live screen's "starting…" state is
 * not pre-empted by an empty plan.
 */
export function TraceArc({ steps }: { steps: TraceStepView[] }) {
  // `activitySummary`, not `investigationArc`: it counts a refused calculation
  // as an ATTEMPT. "1 calculation" over a step that produced no ratio is the
  // same false impression on a concluded case as on a live one.
  const summary = activitySummary(steps);
  if (!summary) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <p className="text-label text-text-muted">Investigation activity</p>
      <p className="mt-1 text-body text-text-secondary">{summary}</p>
      {/* Said ONCE, above the list, instead of implied by a badge on every row.
          A column of identical CODE tags read as "no reasoning happened" when
          the agent had in fact chosen every call. */}
      <p className="mt-1 text-label text-text-muted">{activityAttribution(steps)}</p>
    </div>
  );
}
