import { activityAttribution, investigationArc, type TraceStepView } from "./traceModel";

/**
 * The investigation as a one-line plan, above the steps — so the trace reads as
 * an orchestration the agent carried out, not a log of calls. Renders nothing
 * until there is at least one step, so the live screen's "starting…" state is
 * not pre-empted by an empty plan.
 */
export function TraceArc({ steps }: { steps: TraceStepView[] }) {
  const arc = investigationArc(steps);
  if (!arc.summary) return null;
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <p className="text-label text-text-muted">Investigation activity</p>
      <p className="mt-1 text-body text-text-secondary">{arc.summary}</p>
      {/* Said ONCE, above the list, instead of implied by a badge on every row.
          A column of identical CODE tags read as "no reasoning happened" when
          the agent had in fact chosen every call. */}
      <p className="mt-1 text-label text-text-muted">{activityAttribution(steps)}</p>
    </div>
  );
}
