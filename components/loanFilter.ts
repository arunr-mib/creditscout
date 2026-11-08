/**
 * The portfolio rail doubles as a loan filter on Documents and Covenant terms:
 * it links to `/documents?loan=F5`, and the page narrows to that loan. These two
 * helpers are the page side of that contract, kept pure so they can be tested.
 */

/** The `loan` search param as a single facility id, or null when absent or empty. */
export function loanParam(searchParams: Record<string, string | string[] | undefined>): string | null {
  const raw = searchParams.loan;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ? value : null;
}

/** Items for the selected loan; every item when no loan is selected. */
export function filterByLoan<T extends { facility_id: string }>(items: T[], loan: string | null | undefined): T[] {
  return loan ? items.filter((i) => i.facility_id === loan) : items;
}
