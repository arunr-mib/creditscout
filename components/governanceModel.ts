/**
 * The governance policy table, as pure functions. No React, no I/O: the
 * GovernancePanel only draws what this decides, and `node --test` can exercise
 * the mapping here.
 *
 * Every value comes from the `policy` table (key text pk, value jsonb). Nothing
 * is hardcoded: this maps the rows the Server Component read into render rows,
 * and marks the ONE key that is a regulatory boundary — `require_human_review` —
 * as locked, so it routes to `LockedPolicyValue` and renders as structurally
 * impossible to change (design §5.9 / §12.18).
 */

/** The key the Risk Officer cannot change: a regulatory boundary, not a setting. */
export const LOCKED_KEY = "require_human_review";

/**
 * Render order for the known keys. Unknown keys (a future policy row) are
 * appended in table order, so a new lever still shows rather than vanishing.
 * This orders rows; it never supplies a value.
 */
const PREFERRED_ORDER = [
  "variance_tolerance",
  "escalate_if_breach_margin_over",
  "prohibited_actions",
  "max_steps",
  LOCKED_KEY,
] as const;

/** How the value should be drawn — the panel renders a list for an array, a scalar otherwise, and routes the locked boolean to LockedPolicyValue. */
export type PolicyValueKind = "locked" | "list" | "scalar";

export interface PolicyRow {
  key: string;
  /** The raw jsonb value as read from the table. Never defaulted or invented. */
  value: unknown;
  locked: boolean;
  kind: PolicyValueKind;
}

export interface PolicyTableRow {
  key: string;
  value: unknown;
}

function kindOf(key: string, value: unknown): PolicyValueKind {
  if (key === LOCKED_KEY) return "locked";
  if (Array.isArray(value)) return "list";
  return "scalar";
}

/**
 * Map the policy table rows to render rows, in a stable order, carrying each
 * value straight through from the table. The locked key is flagged so the panel
 * routes it to `LockedPolicyValue`; a `require_human_review` that is missing or
 * not `true` is reported as read, never faked into a locked `true`.
 */
export function policyRows(rows: readonly PolicyTableRow[] | null | undefined): PolicyRow[] {
  const list = Array.isArray(rows) ? rows : [];
  const byKey = new Map<string, unknown>();
  for (const r of list) if (r && typeof r.key === "string" && !byKey.has(r.key)) byKey.set(r.key, r.value);

  const ordered: string[] = [];
  for (const k of PREFERRED_ORDER) if (byKey.has(k)) ordered.push(k);
  for (const k of byKey.keys()) if (!ordered.includes(k)) ordered.push(k);

  return ordered.map((key) => {
    const value = byKey.get(key);
    return { key, value, locked: key === LOCKED_KEY, kind: kindOf(key, value) };
  });
}

/** The locked value the panel hands LockedPolicyValue: `true`/`false` read from the table, or null when the row is absent or non-boolean. */
export function lockedBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
