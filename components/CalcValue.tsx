/**
 * Renders a figure produced by DETERMINISTIC CODE.
 *
 * Amber is reserved for this. A number on screen without provenance is a bug,
 * not a style choice — see docs/design.md §1.
 */
export function CalcValue({
  label,
  value,
  calcId,
}: {
  label: string;
  value: number;
  calcId: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-2">
      <span className="text-label uppercase tracking-wide text-text-muted">
        {label}
      </span>
      <span className="font-mono text-num text-code-bright">
        {value.toFixed(2)}
      </span>
      <span className="rounded-sm bg-code-bg px-1 py-px font-mono text-badge text-code">
        ⟡ computed by code · {calcId}
      </span>
    </span>
  );
}
