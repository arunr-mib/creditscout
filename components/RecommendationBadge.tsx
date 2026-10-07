import { RECOMMENDATION_BADGE, isRecommendation } from "./casefileModel";

/**
 * design.md 5.1. Pill, 12px uppercase. The label says "Recommends ..." because
 * the agent recommends and a human decides. `abstain` is grey, never red:
 * abstaining is correct behaviour. The icon and the words carry the meaning, so
 * colour is never the only signal.
 */
export function RecommendationBadge({ recommendation }: { recommendation: unknown }) {
  if (!isRecommendation(recommendation)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-sm border border-border-strong px-2 py-px text-label uppercase tracking-wider text-text-muted">
        <span aria-hidden="true">—</span>
        No recommendation recorded
      </span>
    );
  }
  const badge = RECOMMENDATION_BADGE[recommendation];
  return (
    <span className={`inline-flex items-center gap-1 rounded-sm px-2 py-px text-label uppercase tracking-wider ${badge.tone}`}>
      <span aria-hidden="true">{badge.icon}</span>
      {badge.label}
    </span>
  );
}
