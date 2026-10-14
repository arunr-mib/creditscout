/**
 * Renders a figure produced by DETERMINISTIC CODE.
 *
 * Amber is reserved for this. A number on screen without provenance is a bug,
 * not a style choice — see docs/design.md §1.
 *
 * The props are a union, so the type checker enforces the product rule: a value
 * always arrives with the `calc_id` that produced it, and the absence of a
 * value is stated as an error rather than rendered as a number.
 */
type CalcValueProps = { label: string } & (
  | { value: number; calcId: string; error?: undefined }
  | { value?: undefined; calcId?: undefined; error: string }
);

export function CalcValue(props: CalcValueProps) {
  const { label } = props;

  // No value means the calculator declined to compute. design.md §11: an em
  // dash and the reason, never 0.00 — a zero is a number, and no number exists.
  if (props.value === undefined) {
    return (
      <span className="inline-flex items-baseline gap-2">
        <span className="text-label uppercase tracking-wide text-text-muted">
          {label}
        </span>
        <span className="text-num tabular-nums text-text-muted">—</span>
        <span className="rounded-sm bg-danger-bg px-1 py-px font-mono text-badge text-danger">
          <span aria-hidden="true">⟡ </span>
          not computed · {props.error}
        </span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-baseline gap-2">
      <span className="text-label uppercase tracking-wide text-text-muted">
        {label}
      </span>
      <span className="text-num tabular-nums text-code-bright">
        {props.value.toFixed(2)}
      </span>
      <CalcBadge calcId={props.calcId} />
    </span>
  );
}

/**
 * The provenance badge on its own, for a table that keeps the value and its
 * source in separate columns (CalcTable). It is the same badge CalcValue draws,
 * so a computed figure reads identically wherever it appears.
 */
export function CalcBadge({ calcId }: { calcId: string }) {
  // Show a SHORT, readable reference (calc_xxxxxxxx), consistent with the
  // casefile banner. The full id is the audit anchor, so it stays available on
  // hover rather than cluttering the figure with a 36-character UUID.
  return (
    <span className="rounded-sm bg-code-bg px-1 py-px font-mono text-badge text-code" title={`calculation ${calcId}`}>
      <span aria-hidden="true">⟡ </span>
      computed by code · calc_{calcId.slice(0, 8)}
    </span>
  );
}
