/**
 * The words the product uses for covenant-term state, in one place.
 *
 * "Boarded" is our word, not an analyst's, and it was appearing in two screens
 * with two different phrasings. These strings are shared by the documents
 * library and the covenant-terms screen so the two cannot drift apart.
 */

export const TERMS_PENDING = "Terms update pending";
export const TERMS_INCLUDED = "Included in approved terms";
export const NOT_BOARDED_TOOLTIP = "This amendment is on file but is not reflected in approved covenant terms.";

/** `covenant_terms.status` as an analyst reads it. */
export const TERMS_STATUS_LABEL: Record<string, string> = {
  approved: "Approved",
  proposed: "Pending approval",
  superseded: "Superseded",
};

/**
 * "Apr 1, 2026" for prose and for a column people read rather than sort.
 *
 * Parsed as UTC on purpose: `new Date("2026-04-01")` is already UTC midnight,
 * so formatting it in a western timezone renders the day before — an
 * effective date that is wrong by a day is a real error on a credit screen.
 * A value that will not parse is returned untouched rather than guessed at.
 */
export function longDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
