import { AgentTag } from "./AgentTag";
import { seenSimilarLabel } from "./casefileModel";

/**
 * design.md 12.3. The agent tag: the lessons come from analyst reviews the
 * CreditScout Agent was shown. Renders ONLY when at least one lesson informed this investigation, and
 * never as an empty pill or "0 prior cases": an empty memory badge implies the
 * feature is broken rather than new. `count` is read from the trace recorded
 * when the investigation started, not recomputed here.
 */
export function SeenSimilarBadge({ count }: { count: number }) {
  const label = seenSimilarLabel(count);
  if (label === null) return null;
  return <AgentTag>{label}</AgentTag>;
}
