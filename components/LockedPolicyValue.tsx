/**
 * design.md 5.9 / 12.18. A regulatory boundary, so it renders as structurally
 * impossible to change: there is no edit control to grey out, because there is
 * no edit control. `value` is what the policy table holds, shown as read.
 */
export function LockedPolicyValue({ name, value }: { name: string; value: boolean | null }) {
  return (
    <span className="inline-flex cursor-not-allowed items-baseline gap-2 text-text-muted">
      <span className="text-label">{name}</span>
      <span className="font-mono text-num">{value === null ? "not readable" : String(value)}</span>
      <span aria-label="locked, cannot be changed" className="text-label">
        <span aria-hidden="true">🔒 </span>locked
      </span>
    </span>
  );
}
