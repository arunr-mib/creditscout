/** Pure validation for a new loan. No I/O, so it is unit-testable. */
export function validateNewLoan(input: { borrower_name?: unknown; industry?: unknown }):
  | { ok: true; value: { borrower_name: string; industry: string | null } }
  | { ok: false; error: string } {
  const name = typeof input.borrower_name === "string" ? input.borrower_name.trim() : "";
  if (name === "") return { ok: false, error: "A borrower name is required." };
  const industryRaw = typeof input.industry === "string" ? input.industry.trim() : "";
  return { ok: true, value: { borrower_name: name, industry: industryRaw === "" ? null : industryRaw } };
}
