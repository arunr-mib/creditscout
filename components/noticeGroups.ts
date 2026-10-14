/**
 * The review checklist: what each automated check DEMANDS of the analyst.
 *
 * THE DEFECT: every check arrived as an identical amber box titled with its own
 * code — `CITED CLAUSE IS AMENDED`, `NOT BOARDED · BY CODE` — and led with a
 * field path (`numerator.addbacks[0].cap cites CA §7.11(b)(i)…`). Three
 * consequences that are not alike were styled alike, so an analyst could not
 * tell what had to be resolved from what was worth knowing, and the first thing
 * they read was a JSON path.
 *
 * Grouping is by CONSEQUENCE and comes from the actual validation rules:
 *
 *   must_resolve   approval is refused while it stands (the server re-checks).
 *   acknowledge    approval is permitted only after a deliberate act.
 *   information    true, worth reading, and blocking nothing.
 *
 * Nothing is promoted to a blocker for emphasis. A checklist where everything
 * is a blocker is one an analyst learns to click past.
 */
import type { Warning } from "./termsReview.ts";

export type Consequence = "must_resolve" | "acknowledge" | "information";

export const CONSEQUENCE_LABEL: Record<Consequence, string> = {
  must_resolve: "Must resolve before approval",
  acknowledge: "Requires acknowledgment",
  information: "Information",
};

export const CONSEQUENCE_NOTE: Record<Consequence, string> = {
  must_resolve: "Approval is refused while these stand.",
  acknowledge: "Approval is possible, after you confirm you have checked this yourself.",
  information: "These block nothing. They are what the checks noticed.",
};

/**
 * `definition_not_located` is the only check that withholds a verification
 * rather than reporting a finding: nothing confirmed the proposal left nothing
 * out. That is the one the analyst must take on deliberately.
 */
export function consequenceOf(code: string): Consequence {
  if (code === "definition_not_located") return "acknowledge";
  return "information";
}

/** A leading field path, so the row can lead with the finding instead. */
export function splitFieldPath(message: string): { path: string | null; rest: string } {
  const m = /^([a-z_]+(?:\.[a-z_]+|\[\d+\])+)\s+(.*)$/s.exec(message.trim());
  if (!m) return { path: null, rest: message.trim() };
  const rest = m[2].trim();
  return { path: m[1], rest: rest.charAt(0).toUpperCase() + rest.slice(1) };
}

/**
 * The headline, in terms of what to DO. Derived from the code and — for a
 * clause that an amendment touches — from the field, because "check the amended
 * add-back cap" tells an analyst where to look and "cited clause is amended"
 * does not.
 */
export function noticeHeadline(w: Pick<Warning, "code" | "message">): string {
  const { path } = splitFieldPath(w.message ?? "");
  switch (w.code) {
    case "clause_amended":
      return path && /addbacks\[\d+\]\.cap$/.test(path) ? "Check the amended add-back cap" : "Check the amended clause";
    case "amendment_not_cited":
      return "An amendment on file is not cited by any term";
    case "addback_not_in_terms":
      return "An add-back the documents permit is not in these terms";
    case "definition_superseded":
      return "The cited definition has been superseded";
    case "definition_conflict":
      return "Two documents define the ratio differently";
    case "definition_amendment_partial":
      return "The amendment limits its own effect";
    case "definition_extent_ambiguous":
      return "How far the definition reaches is ambiguous";
    default:
      return "Check this term against its source";
  }
}

/**
 * Paragraphs of a cited clause that no proposed term rests on.
 *
 * A bare count is not a completeness measure, and the old line read like one.
 * It says what the number is and, explicitly, what it is not.
 */
export function coverageLine(paragraphs: number, where: readonly string[]): string | null {
  if (paragraphs <= 0) return null;
  const n = `${paragraphs} source ${paragraphs === 1 ? "paragraph is" : "paragraphs are"} not linked to proposed terms`;
  return where.length > 0 ? `${n}, in ${where.join(", ")}` : n;
}

export const COVERAGE_NOTE =
  "An unlinked paragraph may still carry a provision that belongs in the terms. A coverage count does not establish completeness either way — only reading them does.";
