/**
 * CreditScout — the three synthetic facilities (F1, F3, F5).
 *
 * This file is the single source of truth for everything the generator writes
 * and the seed inserts. Documents never carry a figure that is not here.
 *
 * Each facility owns:
 *   - a LIST of covenant-terms versions. F1 and F5 each carry one version that
 *     is on file but NOT boarded (`boarded: false`). That is the whole twist:
 *     the approved terms and the amendment on file disagree, and the agent's job
 *     is to notice. Nothing in this repo may board those versions.
 *   - a LIST of quarterly tests, each with the financials, the borrower's
 *     reported ratio and the expected result.
 *   - the documents that exist on file.
 *
 * Plain ESM, zero dependencies. SYNTHETIC DATA ONLY: borrowers, lender and all
 * figures are invented.
 */

export const MARKER = "SYNTHETIC — FOR DEMONSTRATION";
export const LENDER_NAME = "Fairhaven Commercial Bank";

/** Policy value `variance_tolerance` (supabase/migrations/0003_policy_seed.sql). */
export const VARIANCE_TOLERANCE = 0.05;

// ------------------------------------------------------------------ formatting

/** 4020000 -> "4,020,000". US thousands separators, no currency symbol. */
export function fmtAmount(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 1.25 -> "1.25". Ratios always print to two places. */
export function fmtRatio(n) {
  return n.toFixed(2);
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-06-30" -> "June 30, 2026" */
export function longDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** "2026-06-30" -> "Q2 2026" (fiscal year is the calendar year here). */
export function quarterLabel(periodEnd) {
  const [y, m] = periodEnd.split("-").map(Number);
  return `Q${Math.ceil(m / 3)} ${y}`;
}

// ------------------------------------------------------------ clause sentences
//
// The exact sentences that carry a cited fact. The generator prints them and the
// fixture quotes them, so a citation can only ever be verbatim. Each cited
// number is followed by a word that cannot be read as a scale suffix (k/m/b/x).

export const clauses = {
  threshold: (min) =>
    `The Borrower shall not permit the Debt Service Coverage Ratio, tested as of the last day of each fiscal quarter on a trailing four-quarter basis, to be less than ${fmtRatio(min)} to 1.00.`,

  debtService:
    '"Debt Service" means, for any period, the sum of (i) scheduled principal payments on Indebtedness and (ii) cash interest paid on Indebtedness, in each case during that period.',

  coverageRatio:
    '"Debt Service Coverage Ratio" means, for any period, the ratio of (i) Consolidated EBITDA for that period, plus any add-back permitted by Section 7.11, minus Unfinanced Capital Expenditures and cash taxes paid during that period, to (ii) Debt Service for that period.',

  addback: (name, cap) =>
    `the Borrower may add back ${name}, to the extent deducted in determining net income, in an aggregate amount not to exceed $${fmtAmount(cap)} for any test period`,

  amendmentEffective: (iso) =>
    `This Amendment No. 2 is effective as of ${longDate(iso)}`,
};

// ------------------------------------------------------------------- terms

const AGREEMENT = "agreement.txt";
const AMENDMENT = "amendment-no-2.txt";

const DEDUCTIONS = ["unfinanced_capex", "cash_taxes"];
const DENOMINATOR = ["scheduled_principal", "cash_interest"];
const THRESHOLD = 1.25;

function addback(name, cap, citation) {
  return { name, amount_source: "financials", cap, citation };
}

/**
 * The §4.2 terms schema. `period_end` is only a default here: a versioned terms
 * row governs many quarters, so use `termsFor` to get the one for a given test.
 */
function buildTerms({ addbacks, amendments }) {
  return {
    test_period: { basis: "TTM", period_end: "2026-06-30" },
    threshold: { min_dscr: THRESHOLD, citation: "CA §7.11" },
    numerator: {
      base: "Consolidated EBITDA",
      addbacks,
      deductions: [...DEDUCTIONS],
    },
    denominator: { components: [...DENOMINATOR], citation: "CA §1.01" },
    effective_amendments: amendments,
  };
}

const AMD2 = (effective) => ({
  doc: "Amendment No. 2",
  effective,
  citation: "Amd 2 §1",
});

/** Citations every version shares: threshold, denominator, deductions. */
function baseCitations() {
  return [
    { field: "threshold.min_dscr", citation: "CA §7.11", file: AGREEMENT, quote: clauses.threshold(THRESHOLD) },
    { field: "denominator.components", citation: "CA §1.01", file: AGREEMENT, quote: clauses.debtService },
    { field: "numerator.deductions", citation: "CA §1.01", file: AGREEMENT, quote: clauses.coverageRatio },
  ];
}

function amendmentEffectiveCitation(iso) {
  return {
    field: "effective_amendments[0].effective",
    citation: "Amd 2 §1",
    file: AMENDMENT,
    quote: clauses.amendmentEffective(iso),
  };
}

// ----------------------------------------------------------------- facilities

const F1_RESTRUCTURING = "restructuring charges";
const F1_RESTRUCTURING_CAP = 500000;

const F3_OWNER_COMP = "owner compensation normalisation";

const F5_DRYDOCK = "dry-dock and vessel overhaul charges";
const F5_DRYDOCK_CAP = 500000;
const F5_FUEL = "fuel hedging mark-to-market losses";
const F5_FUEL_CAP = 800000;
const F5_SERVICE = { scheduled_principal: 3000000, cash_interest: 1440000 };

const F1 = {
  id: "F1",
  borrower_name: "Harbor Logistics",
  industry: "Freight and logistics",
  sender_domain: "harborlogistics.example",
  twist:
    "Covenant boarding lag. Amendment No. 2 (effective 2026-04-01) permits a restructuring add-back capped at $500,000. It is on file but not boarded; approved terms are still v1. The borrower also computed without it, so both sides report the same failing number and only the unboarded amendment explains the gap.",
  pattern_tag: "amendment_addback",
  expected_outcome: "resolve",
  terms_versions: [
    {
      version: 1,
      effective_from: "2024-03-15",
      boarded: true,
      terms: buildTerms({ addbacks: [], amendments: [] }),
      source_citations: baseCitations(),
    },
    {
      version: 2,
      effective_from: "2026-04-01",
      boarded: false,
      terms: buildTerms({
        addbacks: [addback(F1_RESTRUCTURING, F1_RESTRUCTURING_CAP, "Amd 2 §3(a)")],
        amendments: [AMD2("2026-04-01")],
      }),
      source_citations: [
        ...baseCitations(),
        {
          field: "numerator.addbacks[0].cap",
          citation: "Amd 2 §3(a)",
          file: AMENDMENT,
          quote: clauses.addback(F1_RESTRUCTURING, F1_RESTRUCTURING_CAP),
        },
        amendmentEffectiveCitation("2026-04-01"),
      ],
    },
  ],
  quarters: [
    {
      period_end: "2026-06-30",
      reported_dscr: 1.12,
      financials: {
        ebitda: 4020000,
        addback_amounts: { [F1_RESTRUCTURING]: 620000 },
        unfinanced_capex: 300000,
        cash_taxes: 250000,
        scheduled_principal: 2000000,
        cash_interest: 1100000,
      },
      // What the borrower itself added back in its certificate: nothing.
      certificate_addbacks: {},
      expected: {
        computed_dscr: 1.12,
        passed: false,
        remapped_dscr: 1.28,
        variance_flagged: false,
        raises_exception: true,
      },
    },
  ],
  documents: [
    { doc_type: "agreement", title: "Credit Agreement", effective_date: "2024-03-15", file: AGREEMENT },
    { doc_type: "amendment", title: "Amendment No. 2", effective_date: "2026-04-01", file: AMENDMENT },
    { doc_type: "financials", title: "Financials — Q2 2026", effective_date: "2026-06-30", period_end: "2026-06-30", file: "financials-2026-06-30.txt" },
    { doc_type: "compliance_certificate", title: "Compliance Certificate — Q2 2026", effective_date: "2026-06-30", period_end: "2026-06-30", file: "compliance-certificate-2026-06-30.txt" },
  ],
};

const F3 = {
  id: "F3",
  borrower_name: "Northgate Foods",
  industry: "Food distribution",
  sender_domain: "northgatefoods.example",
  twist:
    "Unsupported add-back, false-compliant certificate. The borrower adds back an owner-compensation normalisation that appears nowhere in the agreement, and certifies 1.31 (compliant). Applying the actual covenant gives 1.08, a breach. An unexecuted waiver request letter is on file, dated after the period and unsigned by the lender; a requested waiver is not a granted waiver.",
  pattern_tag: "true_breach",
  expected_outcome: "escalate",
  terms_versions: [
    {
      version: 1,
      effective_from: "2023-09-20",
      boarded: true,
      terms: buildTerms({ addbacks: [], amendments: [] }),
      source_citations: baseCitations(),
    },
  ],
  quarters: [
    {
      period_end: "2026-06-30",
      reported_dscr: 1.31,
      financials: {
        ebitda: 2884000,
        addback_amounts: { [F3_OWNER_COMP]: 530000 },
        unfinanced_capex: 220000,
        cash_taxes: 180000,
        scheduled_principal: 1600000,
        cash_interest: 700000,
      },
      certificate_addbacks: { [F3_OWNER_COMP]: 530000 },
      expected: {
        computed_dscr: 1.08,
        passed: false,
        remapped_dscr: null,
        variance_flagged: true,
        raises_exception: true,
      },
    },
  ],
  documents: [
    { doc_type: "agreement", title: "Credit Agreement", effective_date: "2023-09-20", file: AGREEMENT },
    // The schema has no `waiver_request` type; the title carries the distinction.
    { doc_type: "waiver", title: "Waiver Request Letter — unexecuted", effective_date: "2026-08-12", file: "waiver-request-letter.txt" },
    { doc_type: "financials", title: "Financials — Q2 2026", effective_date: "2026-06-30", period_end: "2026-06-30", file: "financials-2026-06-30.txt" },
    { doc_type: "compliance_certificate", title: "Compliance Certificate — Q2 2026", effective_date: "2026-06-30", period_end: "2026-06-30", file: "compliance-certificate-2026-06-30.txt" },
  ],
};

const f5Dry = addback(F5_DRYDOCK, F5_DRYDOCK_CAP, "CA §7.11(b)(i)");
const f5DryCite = {
  field: "numerator.addbacks[0].cap",
  citation: "CA §7.11(b)(i)",
  file: AGREEMENT,
  quote: clauses.addback(F5_DRYDOCK, F5_DRYDOCK_CAP),
};

const F5 = {
  id: "F5",
  borrower_name: "Coastal Marine",
  industry: "Marine services and vessel operations",
  sender_domain: "coastalmarine.example",
  twist:
    "Three quarters, three outcomes, one facility. Q4 2025 agrees and is compliant. Q1 2026 the borrower takes the full $900,000 dry-dock add-back where the agreement caps it at $500,000; both clear 1.25 and the variance is logged, not investigated. Q2 2026 repeats F1's pattern: Amendment No. 2 adds a second add-back and is on file but not boarded.",
  pattern_tag: "amendment_addback",
  expected_outcome: "resolve",
  terms_versions: [
    {
      version: 1,
      effective_from: "2024-08-01",
      boarded: true,
      // The $500,000 cap lives in the ORIGINAL credit agreement, not an amendment.
      terms: buildTerms({ addbacks: [f5Dry], amendments: [] }),
      source_citations: [...baseCitations(), f5DryCite],
    },
    {
      version: 2,
      effective_from: "2026-04-01",
      boarded: false,
      terms: buildTerms({
        addbacks: [f5Dry, addback(F5_FUEL, F5_FUEL_CAP, "Amd 2 §3(a)")],
        amendments: [AMD2("2026-04-01")],
      }),
      source_citations: [
        ...baseCitations(),
        f5DryCite,
        {
          field: "numerator.addbacks[1].cap",
          citation: "Amd 2 §3(a)",
          file: AMENDMENT,
          quote: clauses.addback(F5_FUEL, F5_FUEL_CAP),
        },
        amendmentEffectiveCitation("2026-04-01"),
      ],
    },
  ],
  quarters: [
    {
      period_end: "2025-12-31",
      reported_dscr: 1.41,
      financials: {
        ebitda: 6720000,
        addback_amounts: { [F5_DRYDOCK]: 300000 },
        unfinanced_capex: 400000,
        cash_taxes: 360000,
        ...F5_SERVICE,
      },
      certificate_addbacks: { [F5_DRYDOCK]: 300000 },
      expected: {
        computed_dscr: 1.41,
        passed: true,
        remapped_dscr: null,
        variance_flagged: false,
        raises_exception: false,
      },
    },
    {
      period_end: "2026-03-31",
      reported_dscr: 1.38,
      financials: {
        ebitda: 6028000,
        addback_amounts: { [F5_DRYDOCK]: 900000 },
        unfinanced_capex: 420000,
        cash_taxes: 380000,
        ...F5_SERVICE,
      },
      // The borrower took the full 900,000; the cap holds it to 500,000.
      certificate_addbacks: { [F5_DRYDOCK]: 900000 },
      expected: {
        computed_dscr: 1.29,
        passed: true,
        remapped_dscr: null,
        variance_flagged: true,
        raises_exception: false,
      },
    },
    {
      period_end: "2026-06-30",
      reported_dscr: 1.3,
      financials: {
        // Both caps bind here, on purpose: 520,000 -> 500,000 and 950,000 -> 800,000.
        ebitda: 5313000,
        addback_amounts: { [F5_DRYDOCK]: 520000, [F5_FUEL]: 950000 },
        unfinanced_capex: 450000,
        cash_taxes: 390000,
        ...F5_SERVICE,
      },
      // The borrower knew about the amendment and added back at the capped amounts.
      certificate_addbacks: { [F5_DRYDOCK]: F5_DRYDOCK_CAP, [F5_FUEL]: F5_FUEL_CAP },
      expected: {
        computed_dscr: 1.12,
        passed: false,
        remapped_dscr: 1.3,
        variance_flagged: true,
        raises_exception: true,
      },
    },
  ],
  documents: [
    { doc_type: "agreement", title: "Credit Agreement", effective_date: "2024-08-01", file: AGREEMENT },
    { doc_type: "amendment", title: "Amendment No. 2", effective_date: "2026-04-01", file: AMENDMENT },
    ...["2025-12-31", "2026-03-31", "2026-06-30"].flatMap((periodEnd) => [
      { doc_type: "financials", title: `Financials — ${quarterLabel(periodEnd)}`, effective_date: periodEnd, period_end: periodEnd, file: `financials-${periodEnd}.txt` },
      { doc_type: "compliance_certificate", title: `Compliance Certificate — ${quarterLabel(periodEnd)}`, effective_date: periodEnd, period_end: periodEnd, file: `compliance-certificate-${periodEnd}.txt` },
    ]),
  ],
};

export const FACILITIES = [F1, F3, F5];

// -------------------------------------------------------------------- helpers

/** Terms for one specific test: the version's terms with that quarter's period_end. */
export function termsFor(version, quarter) {
  const terms = structuredClone(version.terms);
  terms.test_period.period_end = quarter.period_end;
  return terms;
}

/** Versions in force at a period end, newest first. ISO dates compare as strings. */
function inForce(facility, periodEnd) {
  return facility.terms_versions
    .filter((v) => v.effective_from <= periodEnd)
    .sort((a, b) => b.version - a.version);
}

/** The terms a quarter is tested against: the newest BOARDED version in force. */
export function boardedVersionFor(facility, quarter) {
  return inForce(facility, quarter.period_end).find((v) => v.boarded) ?? null;
}

/** An in-force version that is on file but not boarded, if any. */
export function unboardedVersionFor(facility, quarter) {
  return inForce(facility, quarter.period_end).find((v) => !v.boarded) ?? null;
}
