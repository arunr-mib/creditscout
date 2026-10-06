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
      <span className="text-xs font-medium uppercase tracking-wide text-text-muted">
        {label}
      </span>
      <span className="font-mono text-sm font-medium text-code-bright">
        {value.toFixed(2)}
      </span>
      <span className="rounded-sm bg-code-bg px-1.5 py-0.5 font-mono text-[11px] text-code">
        ⟡ computed by code · {calcId}
      </span>
    </span>
  );
}
