import { seenSimilarLabel } from "./casefileModel";

/**
 * design.md 12.3. Teal: the lessons come from analyst reviews the model was
 * shown. Renders ONLY when at least one lesson informed this investigation, and
 * never as an empty pill or "0 prior cases": an empty memory badge implies the
 * feature is broken rather than new. `count` is read from the trace recorded
 * when the investigation started, not recomputed here.
 */
export function SeenSimilarBadge({ count }: { count: number }) {
  const label = seenSimilarLabel(count);
  if (label === null) return null;
  return <span className="inline-flex rounded-sm bg-model-bg px-2 py-px text-badge text-model">{label}</span>;
}
