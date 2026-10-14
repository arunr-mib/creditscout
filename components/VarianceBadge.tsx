import { varianceBadge } from "./portfolioModel";

/**
 * design.md §12.2. The signed delta between the borrower's figure and ours. The
 * sign is never dropped: `+` means the borrower overstated. Within tolerance it
 * is muted; beyond tolerance it is amber and says "variance logged", because the
 * tolerance test is a deterministic code decision. It does not render at all
 * when there is no borrower figure — there is no delta to show.
 */
export function VarianceBadge(props: { computed: number | null; reported: number | null; flagged: boolean | null }) {
  const v = varianceBadge(props);
  if (!v) return null;
  if (v.flagged) {
    return (
      <span className="rounded-sm bg-code-bg px-1 py-px text-badge tabular-nums text-code">
        {v.text} · variance logged
      </span>
    );
  }
  return <span className="rounded-sm px-1 py-px text-badge tabular-nums text-text-muted">{v.text}</span>;
}
