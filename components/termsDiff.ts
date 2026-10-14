/**
 * What changes if this proposal is approved.
 *
 * THE GAP THIS FILLS: the review screen showed the PROPOSED terms, each beside
 * its clause, and nothing else. The analyst approving v2 could read every line
 * and still not know which of them differed from the v1 that had been governing
 * tests for two years. Approval is the moment a person takes responsibility for
 * a change, and the change itself was the one thing not on the page.
 *
 * Pure, and deliberately conservative:
 *   - add-backs and amendments are aligned BY NAME, not by index. An add-back
 *     inserted at position 0 shifts every later index; a positional diff would
 *     report four changes where there is one addition.
 *   - an add-back that exists only in the proposal is an ADDITION, and one that
 *     exists only in the approved version is a REMOVAL. Neither is shown as a
 *     value changing from nothing.
 *   - with no approved version at all, nothing is "changed": every term is new,
 *     and the screen says that rather than marking the whole table as a diff.
 */
import { getAt, valueText, type Terms } from "./termsReview.ts";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export type ChangeKind = "same" | "changed" | "added" | "removed";

export interface TermChange {
  /** Stable across renders; also the field path when there is one. */
  id: string;
  label: string;
  /** As it reads in the approved version, or null when the term is new. */
  approved: string | null;
  /** As it reads in the proposal, or null when the proposal drops it. */
  proposed: string | null;
  kind: ChangeKind;
  /** The field whose citation supports the proposed value, for the source link. */
  citeField: string | null;
}

const SCALARS: { field: string; label: string }[] = [
  { field: "threshold.min_dscr", label: "Minimum DSCR" },
  { field: "test_period.basis", label: "Measurement period" },
  { field: "numerator.base", label: "Numerator base" },
  { field: "numerator.deductions", label: "Deductions from the numerator" },
  { field: "denominator.components", label: "Debt service components" },
];

const listOf = (terms: Terms | null, path: string): Record<string, unknown>[] => {
  const v = terms ? getAt(terms, path) : undefined;
  return Array.isArray(v) ? v.filter(isObj) : [];
};

const nameOf = (row: Record<string, unknown>, key: string): string =>
  typeof row[key] === "string" ? (row[key] as string) : "";

function compare(id: string, label: string, before: unknown, after: unknown, citeField: string | null): TermChange {
  const a = before === undefined ? null : valueText(id, before);
  const b = after === undefined ? null : valueText(id, after);
  const kind: ChangeKind = a === null && b === null ? "same" : a === null ? "added" : b === null ? "removed" : a === b ? "same" : "changed";
  return { id, label, approved: a, proposed: b, kind, citeField };
}

export function termsDiff(approved: Terms | null, proposed: Terms): TermChange[] {
  const out: TermChange[] = [];
  for (const s of SCALARS) {
    out.push(compare(s.field, s.label, approved ? getAt(approved, s.field) : undefined, getAt(proposed, s.field), s.field));
  }

  // Add-backs, aligned by name. The CAP is the figure that decides a test, so
  // it is the value compared; an uncapped add-back reads as uncapped, never 0.
  const before = listOf(approved, "numerator.addbacks");
  const after = listOf(proposed, "numerator.addbacks");
  const names = [...new Set([...before.map((r) => nameOf(r, "name")), ...after.map((r) => nameOf(r, "name"))])].filter((n) => n !== "");
  for (const name of names) {
    const i = after.findIndex((r) => nameOf(r, "name") === name);
    const b = before.find((r) => nameOf(r, "name") === name);
    const field = i >= 0 ? `numerator.addbacks[${i}].cap` : null;
    out.push(
      compare(
        field ?? `addback:${name}`,
        `Add-back cap · ${name}`,
        b ? ("cap" in b ? b.cap : undefined) : undefined,
        i >= 0 ? ("cap" in after[i] ? after[i].cap : undefined) : undefined,
        field,
      ),
    );
  }

  // Amendments the version carries, aligned by document title.
  const ab = listOf(approved, "effective_amendments");
  const aa = listOf(proposed, "effective_amendments");
  const docs = [...new Set([...ab.map((r) => nameOf(r, "doc")), ...aa.map((r) => nameOf(r, "doc"))])].filter((d) => d !== "");
  for (const doc of docs) {
    const i = aa.findIndex((r) => nameOf(r, "doc") === doc);
    const b = ab.find((r) => nameOf(r, "doc") === doc);
    const field = i >= 0 ? `effective_amendments[${i}].effective` : null;
    out.push(
      compare(
        field ?? `amendment:${doc}`,
        `Amendment applied · ${doc}`,
        b ? b.effective : undefined,
        i >= 0 ? aa[i].effective : undefined,
        field,
      ),
    );
  }
  return out;
}

/** Just the lines that differ — what "highlight changes only" needs. */
export function changedOnly(rows: readonly TermChange[]): TermChange[] {
  return rows.filter((r) => r.kind !== "same");
}

/**
 * One sentence over the table. Says "no approved version" rather than "no
 * changes" when there is nothing to compare against: those are opposite
 * situations and reading one as the other would let a first approval through as
 * if it changed nothing.
 */
export function changeSummary(approved: Terms | null, rows: readonly TermChange[]): string {
  if (!approved) return "No approved version exists yet. Every term below is new.";
  const changed = changedOnly(rows);
  if (changed.length === 0) return "No term differs from the approved version.";
  const n = changed.length;
  return `${n} ${n === 1 ? "term differs" : "terms differ"} from the approved version.`;
}
