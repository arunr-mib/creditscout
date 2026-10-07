import { LockedPolicyValue } from "@/components/LockedPolicyValue";
import { type PolicyRow, type PolicyTableRow, lockedBoolean, policyRows } from "@/components/governanceModel";

/**
 * The Risk Officer's policy, read-only (design.md §5.8 data table, §12.17).
 *
 * Every value is read from the `policy` table and carried through unchanged;
 * nothing here is hardcoded. A policy value is a configured INPUT, not a
 * code-produced output, so values render as plain mono text — never amber
 * (amber marks what code produced). The one regulatory boundary,
 * `require_human_review`, routes to `LockedPolicyValue` and renders as
 * structurally impossible to change.
 */
export function GovernancePanel({ rows }: { rows: PolicyTableRow[] }) {
  const policy = policyRows(rows);

  return (
    <section aria-label="Policy" className="space-y-3">
      <h2 className="text-section text-text">Policy</h2>
      <p className="text-body text-text-secondary">
        Set by the Credit Risk Officer. The agent recommends within these bounds; it never changes them.
      </p>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-2 text-left text-label uppercase tracking-wide text-text-muted">Policy</th>
              <th className="px-4 py-2 text-right text-label uppercase tracking-wide text-text-muted">Value</th>
            </tr>
          </thead>
          <tbody>
            {policy.map((row) => (
              <tr key={row.key} className="h-10 border-b border-border last:border-b-0 hover:bg-surface-raised">
                <td className="px-4 align-middle text-label text-text">{humanKey(row.key)}</td>
                <td className="px-4 py-2 text-right align-middle">
                  <PolicyValue row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PolicyValue({ row }: { row: PolicyRow }) {
  if (row.kind === "locked") {
    return (
      <span className="inline-flex justify-end">
        <LockedPolicyValue name="" value={lockedBoolean(row.value)} />
      </span>
    );
  }
  if (row.kind === "list") {
    const items = Array.isArray(row.value) ? (row.value as unknown[]) : [];
    return (
      <ul className="flex flex-col items-end gap-1">
        {items.map((item, i) => (
          <li key={i} className="font-mono text-num text-text-secondary">
            {String(item)}
          </li>
        ))}
      </ul>
    );
  }
  return <span className="font-mono text-num tabular-nums text-text">{String(row.value)}</span>;
}

/** The seeded keys, read out in plain words; an unknown key falls back to itself. */
function humanKey(key: string): string {
  const map: Record<string, string> = {
    variance_tolerance: "Variance tolerance",
    escalate_if_breach_margin_over: "Escalate if breach margin over",
    prohibited_actions: "Prohibited actions",
    max_steps: "Max investigation steps",
    require_human_review: "Human sign-off",
  };
  return map[key] ?? key;
}
