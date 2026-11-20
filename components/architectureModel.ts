/**
 * The worked example on /architecture: Coastal Marine, Q2 2026 (test period
 * ended June 30, 2026). Every figure on that page comes from here, and every
 * figure carries the citation it is read from.
 *
 * No imports, so `architectureModel.test.js` can load it under plain Node. That
 * test recomputes both ratios with `calc/dscr.js` from the F5 fixture and checks
 * that each quote below appears VERBATIM in its source file under
 * `data/facilities/F5/`. If a figure or a quote drifts, the test fails — the
 * page must never tell a different story from the product.
 */

export interface Citation {
  id: string;
  /** Document name as an analyst would say it. */
  document: string;
  /** Source file under data/facilities/F5/, for the drift test. */
  file: string;
  /** Section reference, e.g. "§7.11(a)". */
  section: string;
  /** Verbatim text from the document. */
  quote: string;
}

export const CITATIONS: Record<string, Citation> = {
  floor: {
    id: "floor",
    document: "Credit Agreement",
    file: "agreement.txt",
    section: "§7.11(a) Minimum Ratio",
    quote:
      "The Borrower shall not permit the Debt Service Coverage Ratio, tested as of the last day of each fiscal quarter on a trailing four-quarter basis, to be less than 1.25 to 1.00.",
  },
  definition: {
    id: "definition",
    document: "Credit Agreement",
    file: "agreement.txt",
    section: "Definitions: Debt Service Coverage Ratio",
    quote:
      "\"Debt Service Coverage Ratio\" means, for any period, the ratio of (i) Consolidated EBITDA for that period, plus any add-back permitted by Section 7.11, minus Unfinanced Capital Expenditures and cash taxes paid during that period, to (ii) Debt Service for that period.",
  },
  ebitda: {
    id: "ebitda",
    document: "Financial summary, period ended June 30, 2026",
    file: "financials-2026-06-30.txt",
    section: "§1 Debt Service Coverage Inputs",
    quote: "Consolidated EBITDA: 5,313,000",
  },
  drydockIncurred: {
    id: "drydockIncurred",
    document: "Financial summary, period ended June 30, 2026",
    file: "financials-2026-06-30.txt",
    section: "§2 Add-Back Items",
    quote: "Dry-dock and vessel overhaul charges: 520,000",
  },
  drydockCap: {
    id: "drydockCap",
    document: "Credit Agreement",
    file: "agreement.txt",
    section: "§7.11(b)(i) Permitted Add-Backs",
    quote:
      "the Borrower may add back dry-dock and vessel overhaul charges, to the extent deducted in determining net income, in an aggregate amount not to exceed $500,000 for any test period",
  },
  fuelIncurred: {
    id: "fuelIncurred",
    document: "Financial summary, period ended June 30, 2026",
    file: "financials-2026-06-30.txt",
    section: "§2 Add-Back Items",
    quote: "Fuel hedging mark-to-market losses: 950,000",
  },
  fuelCap: {
    id: "fuelCap",
    document: "Amendment No. 2 to Credit Agreement",
    file: "amendment-no-2.txt",
    section: "§3(a) Amendment to Section 7.11",
    quote:
      "the Borrower may add back fuel hedging mark-to-market losses, to the extent deducted in determining net income, in an aggregate amount not to exceed $800,000 for any test period.",
  },
  amendmentEffective: {
    id: "amendmentEffective",
    document: "Amendment No. 2 to Credit Agreement",
    file: "amendment-no-2.txt",
    section: "§1 Effective Date and Scope",
    quote: "This Amendment No. 2 is effective as of April 1, 2026",
  },
  capex: {
    id: "capex",
    document: "Financial summary, period ended June 30, 2026",
    file: "financials-2026-06-30.txt",
    section: "§1 Debt Service Coverage Inputs",
    quote: "Unfinanced Capital Expenditures: 450,000",
  },
  taxes: {
    id: "taxes",
    document: "Financial summary, period ended June 30, 2026",
    file: "financials-2026-06-30.txt",
    section: "§1 Debt Service Coverage Inputs",
    quote: "Cash Taxes Paid: 390,000",
  },
  principal: {
    id: "principal",
    document: "Financial summary, period ended June 30, 2026",
    file: "financials-2026-06-30.txt",
    section: "§1 Debt Service Coverage Inputs",
    quote: "Scheduled Principal Payments: 3,000,000",
  },
  interest: {
    id: "interest",
    document: "Financial summary, period ended June 30, 2026",
    file: "financials-2026-06-30.txt",
    section: "§1 Debt Service Coverage Inputs",
    quote: "Cash Interest Paid: 1,440,000",
  },
  reported: {
    id: "reported",
    document: "Compliance Certificate, period ended June 30, 2026",
    file: "compliance-certificate-2026-06-30.txt",
    section: "§2 Financial Covenant",
    quote: "Reported Debt Service Coverage Ratio: 1.30 to 1.00.",
  },
};

/** A figure that came from CreditScout's own calculator rather than a document. */
export const CALCULATION_SOURCE =
  "CreditScout's calculator: deterministic, logged, rounded half-up to two decimals. Never the model.";

export interface CalcLine {
  label: string;
  /** "+" or "−" for a numerator line; null for a total. */
  sign: "+" | "−" | null;
  amount: number;
  citationId: string | null;
  note?: string;
}

/** The numerator as tested on the boarded terms (v1: only the original agreement's add-back). */
export const AS_TESTED: CalcLine[] = [
  { label: "Consolidated EBITDA", sign: null, amount: 5313000, citationId: "ebitda" },
  { label: "Dry-dock and vessel overhaul add-back", sign: "+", amount: 500000, citationId: "drydockCap", note: "$520,000 incurred, capped at $500,000" },
  { label: "Unfinanced capital expenditures", sign: "−", amount: 450000, citationId: "capex" },
  { label: "Cash taxes paid", sign: "−", amount: 390000, citationId: "taxes" },
];

/** The extra line Amendment No. 2 permits (on file, not yet boarded). */
export const AMENDMENT_LINE: CalcLine = {
  label: "Fuel hedging add-back (Amendment No. 2)",
  sign: "+",
  amount: 800000,
  citationId: "fuelCap",
  note: "$950,000 incurred, capped at $800,000",
};

export const DENOMINATOR: CalcLine[] = [
  { label: "Scheduled principal", sign: null, amount: 3000000, citationId: "principal" },
  { label: "Cash interest", sign: "+", amount: 1440000, citationId: "interest" },
];

export function total(lines: readonly CalcLine[]): number {
  return lines.reduce((s, l) => (l.sign === "−" ? s - l.amount : s + l.amount), 0);
}

/** The headline figures, each as the page prints it. */
export const EXAMPLE = {
  borrower: "Coastal Marine",
  period: "Q2 2026",
  periodEnd: "2026-06-30",
  floor: 1.25,
  numeratorAsTested: 4973000,
  numeratorWithAmendment: 5773000,
  denominator: 4440000,
  computedAsTested: 1.12,
  computedWithAmendment: 1.3,
  reported: 1.3,
} as const;

export function fmtMoney(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

/** $4,973,000 -> "$4.97M". Truncates to two decimals, so the short form never rounds up past the exact figure. */
export function fmtMillions(n: number): string {
  return `$${(Math.floor(n / 10000) / 100).toFixed(2)}M`;
}

export function fmtRatio(n: number): string {
  return `${n.toFixed(2)}x`;
}
