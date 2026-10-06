/**
 * CreditScout — synthetic document generator.
 *
 *   node data/generate.mjs        (or: npm run generate:data)
 *
 * Writes data/facilities/F1|F3|F5/*.txt and data/expected-values-template.csv.
 * Plain text only. PDF conversion belongs to stage 4, where the text extractor
 * exists to verify the round trip.
 *
 * Every figure printed here comes from FACILITIES. Nothing numeric is a literal
 * in a template string.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FACILITIES,
  LENDER_NAME,
  MARKER,
  boardedVersionFor,
  clauses,
  fmtAmount,
  fmtRatio,
  longDate,
  quarterLabel,
  unboardedVersionFor,
} from "./facilities.js";

const DATA_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(DATA_DIR, "facilities");
const CSV_PATH = join(DATA_DIR, "expected-values-template.csv");

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const sentenceCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const legalName = (f) => `${f.borrower_name}, Inc.`;

const doc = (f, type) => f.documents.find((d) => d.doc_type === type);
const version = (f, n) => f.terms_versions.find((v) => v.version === n);

// ------------------------------------------------------------- the agreement

function renderAgreement(f) {
  const agreement = doc(f, "agreement");
  const terms = version(f, 1).terms;
  const min = terms.threshold.min_dscr;
  const addbacks = terms.numerator.addbacks;

  const adjustments =
    addbacks.length === 0
      ? [
          "(b) Adjustments. No add-back or other adjustment shall be made to Consolidated EBITDA for purposes of this Section 7.11, except as expressly provided in this Agreement as amended in writing.",
        ]
      : [
          "(b) Permitted Add-Backs. In calculating Consolidated EBITDA for any period:",
          ...addbacks.map(
            (a, i) =>
              `(${["i", "ii", "iii"][i]}) ${clauses.addback(a.name, a.cap)}; and`,
          ),
          `(${["i", "ii", "iii"][addbacks.length]}) no other add-back or adjustment shall be made, except as expressly provided in this Agreement as amended in writing.`,
        ];

  return [
    MARKER,
    "",
    "CREDIT AGREEMENT",
    "",
    `dated as of ${longDate(agreement.effective_date)}`,
    "",
    `between ${legalName(f).toUpperCase()}, as Borrower, and ${LENDER_NAME.toUpperCase()}, as Lender.`,
    "",
    "ARTICLE I — DEFINITIONS",
    "",
    "§1.01 Defined Terms.",
    "As used in this Agreement, the following terms have the meanings set out below.",
    '"Consolidated EBITDA" means, for any period, the consolidated net income of the Borrower for that period plus interest expense, income tax expense, depreciation and amortization, in each case to the extent deducted in determining net income.',
    clauses.debtService,
    clauses.coverageRatio,
    '"Indebtedness" means all obligations of the Borrower for borrowed money, including obligations under the Facility.',
    '"Unfinanced Capital Expenditures" means capital expenditures of the Borrower not financed with Indebtedness.',
    "",
    "§1.02 Accounting Terms.",
    "Accounting terms not defined in this Agreement have the meanings given to them under generally accepted accounting principles consistently applied.",
    "",
    "ARTICLE VI — AFFIRMATIVE COVENANTS",
    "",
    "§6.01 Financial Statements and Compliance Certificates.",
    "The Borrower shall deliver to the Lender, promptly after the end of each fiscal quarter, financial statements for the trailing four quarters and a Compliance Certificate stating the Debt Service Coverage Ratio calculated in accordance with Section 7.11 and the amount of any add-back applied.",
    "",
    "ARTICLE VII — FINANCIAL COVENANTS",
    "",
    "§7.10 Limitation on Liens.",
    "The Borrower shall not create or permit any lien on its assets other than liens permitted by the Lender in writing.",
    "",
    "§7.11 Debt Service Coverage Ratio.",
    `(a) Minimum Ratio. ${clauses.threshold(min)}`,
    ...adjustments,
    "(c) Verification. The Debt Service Coverage Ratio stated in a Compliance Certificate is subject to verification by the Lender against the financial statements delivered under Section 6.01.",
    "",
    "ARTICLE VIII — EVENTS OF DEFAULT",
    "",
    "§8.01 Events of Default.",
    "Each of the following is an Event of Default: (a) the Borrower fails to pay any amount when due; (b) the Borrower fails to comply with Section 7.11; (c) any Compliance Certificate is materially incorrect when delivered.",
    "",
    "§8.02 Waivers and Amendments.",
    "No waiver of any covenant or Event of Default, and no amendment of this Agreement, is effective unless it is in writing and signed by the Lender. A request for a waiver is not a waiver.",
    "",
    "ARTICLE IX — MISCELLANEOUS",
    "",
    "§9.01 Notices.",
    `Notices to the Borrower shall be sent to the attention of the Chief Financial Officer, ${legalName(f)}, at cfo@${f.sender_domain}. Notices to the Lender shall be sent to the attention of the Portfolio Manager, ${LENDER_NAME}.`,
    "",
    "§9.02 Governing Law.",
    "This Agreement is governed by the laws of the State of New York.",
    "",
  ].join("\n");
}

// ----------------------------------------------------------- the amendment

function renderAmendment(f) {
  const agreement = doc(f, "agreement");
  const amendment = doc(f, "amendment");
  const unboarded = f.terms_versions.find((v) => !v.boarded);
  if (!unboarded) throw new Error(`${f.id}: amendment document with no unboarded terms version`);

  const priorNames = new Set(version(f, 1).terms.numerator.addbacks.map((a) => a.name));
  const added = unboarded.terms.numerator.addbacks.filter((a) => !priorNames.has(a.name));

  return [
    MARKER,
    "",
    "AMENDMENT NO. 2 TO CREDIT AGREEMENT",
    "",
    `dated as of ${longDate(amendment.effective_date)}`,
    "",
    `between ${legalName(f).toUpperCase()}, as Borrower, and ${LENDER_NAME.toUpperCase()}, as Lender.`,
    "",
    "§1 Effective Date and Scope.",
    `${clauses.amendmentEffective(amendment.effective_date)} and amends the Credit Agreement dated as of ${longDate(agreement.effective_date)} (the "Credit Agreement").`,
    "",
    "§2 Definitions.",
    "Capitalized terms used and not defined in this Amendment No. 2 have the meanings given to them in the Credit Agreement.",
    "",
    "§3 Amendment to Section 7.11.",
    ...added.map(
      (a, i) =>
        `(${LETTERS[i]}) Section 7.11(b) of the Credit Agreement is amended so that, in addition to any add-back already permitted there, ${clauses.addback(a.name, a.cap)}.`,
    ),
    "",
    "§4 Continuing Effect.",
    "Except as expressly amended by this Amendment No. 2, every term of the Credit Agreement remains in full force and effect.",
    "",
    "Executed by the Borrower and the Lender.",
    "",
  ].join("\n");
}

// ------------------------------------------------------- quarterly documents

const INPUT_LABELS = [
  ["Unfinanced Capital Expenditures", "unfinanced_capex"],
  ["Cash Taxes Paid", "cash_taxes"],
  ["Scheduled Principal Payments", "scheduled_principal"],
  ["Cash Interest Paid", "cash_interest"],
];

/** One labeled line per calculator input. No tables, no columns. */
function renderFinancials(f, q) {
  return [
    MARKER,
    "",
    `${f.borrower_name.toUpperCase()} — TRAILING FOUR-QUARTER FINANCIAL SUMMARY`,
    "",
    `Period ended: ${longDate(q.period_end)}`,
    "Basis: trailing twelve months",
    "",
    "§1 Debt Service Coverage Inputs",
    `Consolidated EBITDA: ${fmtAmount(q.financials.ebitda)}`,
    ...INPUT_LABELS.map(([label, key]) => `${label}: ${fmtAmount(q.financials[key])}`),
    "",
    "§2 Add-Back Items",
    "Amounts incurred during the period, before any limit under the Credit Agreement.",
    ...Object.entries(q.financials.addback_amounts).map(
      ([name, amount]) => `${sentenceCase(name)}: ${fmtAmount(amount)}`,
    ),
    "",
  ].join("\n");
}

function renderCertificate(f, q) {
  const agreement = doc(f, "agreement");
  const min = version(f, 1).terms.threshold.min_dscr;
  const compliant = q.reported_dscr >= min;
  const claimed = Object.entries(q.certificate_addbacks);

  return [
    MARKER,
    "",
    "COMPLIANCE CERTIFICATE",
    "",
    `To: ${LENDER_NAME}, as Lender`,
    `From: ${legalName(f)}, as Borrower`,
    `Re: Credit Agreement dated as of ${longDate(agreement.effective_date)}`,
    "",
    "§1 Test Period",
    `This Compliance Certificate is delivered under Section 6.01 of the Credit Agreement for the test period ended ${longDate(q.period_end)}, measured on a trailing four-quarter basis.`,
    "",
    "§2 Financial Covenant",
    `Required Debt Service Coverage Ratio under Section 7.11: not less than ${fmtRatio(min)} to 1.00.`,
    `Reported Debt Service Coverage Ratio: ${fmtRatio(q.reported_dscr)} to 1.00.`,
    compliant
      ? "Compliance status: IN COMPLIANCE with Section 7.11. The undersigned certifies that no Default or Event of Default has occurred and is continuing."
      : "Compliance status: NOT IN COMPLIANCE with Section 7.11 for this test period.",
    "",
    "§3 Add-Backs Applied",
    ...(claimed.length === 0
      ? ["No add-back was applied in calculating Consolidated EBITDA for this test period."]
      : claimed.map(([name, amount]) => `Add-back applied — ${name}: ${fmtAmount(amount)}`)),
    "",
    "§4 Certification",
    `The undersigned, a duly authorised officer of ${legalName(f)}, certifies that the foregoing is true and correct.`,
    "",
    `${legalName(f).toUpperCase()}`,
    "By: /s/ Chief Financial Officer",
    "Title: Chief Financial Officer",
    "",
  ].join("\n");
}

// -------------------------------------------------------- the waiver request

function renderWaiverRequest(f) {
  const waiver = doc(f, "waiver");
  const agreement = doc(f, "agreement");
  const q = f.quarters[0];

  return [
    MARKER,
    "",
    "WAIVER REQUEST LETTER",
    "",
    longDate(waiver.effective_date),
    "",
    `To: ${LENDER_NAME}, Attention: Portfolio Manager`,
    `From: ${legalName(f)}, Attention: Chief Financial Officer`,
    `Re: Request for waiver of Section 7.11 of the Credit Agreement dated as of ${longDate(agreement.effective_date)} — test period ended ${longDate(q.period_end)}`,
    "",
    "§1 Request",
    `The Borrower respectfully requests that the Lender waive compliance with Section 7.11 of the Credit Agreement for the test period ended ${longDate(q.period_end)}. Without admitting that any Default exists, this request applies to the extent the Lender determines that the Debt Service Coverage Ratio for that period is below the level required by Section 7.11.`,
    "",
    "§2 Status of This Letter",
    "This letter is a request only. It does not waive, amend or modify any term of the Credit Agreement unless and until the Lender countersigns it in accordance with Section 8.02.",
    "",
    "Respectfully submitted,",
    `${legalName(f).toUpperCase()}`,
    "By: /s/ Chief Financial Officer",
    "Title: Chief Financial Officer",
    "",
    "ACKNOWLEDGED AND AGREED:",
    "",
    `${LENDER_NAME.toUpperCase()}, as Lender`,
    "",
    "By: ______________________________",
    "Name: ____________________________",
    "Title: ___________________________",
    "Date: ____________________________",
    "",
  ].join("\n");
}

// ------------------------------------------------------------------ dispatch

/** Text of one fixture document. Throws if it would be written without the marker. */
export function renderDocument(f, d) {
  let text;
  switch (d.doc_type) {
    case "agreement":
      text = renderAgreement(f);
      break;
    case "amendment":
      text = renderAmendment(f);
      break;
    case "waiver":
      text = renderWaiverRequest(f);
      break;
    case "financials":
    case "compliance_certificate": {
      const q = f.quarters.find((x) => x.period_end === d.period_end);
      if (!q) throw new Error(`${f.id}/${d.file}: no quarter ending ${d.period_end}`);
      text = d.doc_type === "financials" ? renderFinancials(f, q) : renderCertificate(f, q);
      break;
    }
    default:
      throw new Error(`${f.id}/${d.file}: cannot render doc_type ${d.doc_type}`);
  }
  if (!text.startsWith(`${MARKER}\n`)) {
    throw new Error(`${f.id}/${d.file}: refusing to write a document without the synthetic marker`);
  }
  return text;
}

// ----------------------------------------------------------------------- CSV

export const CSV_COLUMNS = [
  "case_id", "facility", "borrower", "test_period_end", "threshold", "terms_version_boarded",
  "ebitda", "addbacks", "unfinanced_capex", "cash_taxes", "scheduled_principal", "cash_interest",
  "reported_dscr", "expected_dscr_as_tested", "expected_dscr_remapped",
  "expected_outcome", "expected_tag", "owner_signed_off",
];

const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/** `name=amount (cap N)` for every add-back the owner needs to see, in a quoted list. */
function addbackCell(f, q) {
  const boarded = boardedVersionFor(f, q);
  const unboarded = unboardedVersionFor(f, q);
  const capIn = (v, name) => v?.terms.numerator.addbacks.find((a) => a.name === name)?.cap;
  const parts = Object.entries(q.financials.addback_amounts).map(([name, amount]) => {
    let note = "no clause permits this";
    if (capIn(boarded, name) !== undefined) note = `cap ${capIn(boarded, name)}`;
    else if (capIn(unboarded, name) !== undefined) {
      note = `cap ${capIn(unboarded, name)} under unboarded v${unboarded.version} only`;
    }
    return `${name}=${amount} (${note})`;
  });
  return `"${parts.join("; ")}"`;
}

/**
 * One row per quarterly test. Deliberately carries NO ratio this code computed:
 * the owner fills the two expected columns in a spreadsheet, so the oracle never
 * grades the calculator against itself. The only ratios present are inputs.
 */
export function renderCsv(facilities = FACILITIES) {
  const rows = [CSV_COLUMNS.join(",")];
  for (const f of facilities) {
    for (const q of f.quarters) {
      const boarded = boardedVersionFor(f, q);
      const hasUnboarded = unboardedVersionFor(f, q) !== null;
      const outcome = q.expected.raises_exception
        ? f.expected_outcome
        : q.expected.variance_flagged
          ? "variance_logged_no_investigation"
          : "compliant_no_action";
      const fin = q.financials;
      const cells = [
        `${f.id}-${q.period_end.slice(0, 4)}${quarterLabel(q.period_end).slice(0, 2)}`,
        f.id,
        f.borrower_name,
        q.period_end,
        fmtRatio(boarded.terms.threshold.min_dscr),
        boarded.version,
        fin.ebitda,
        null, // addbacks: written pre-quoted below
        fin.unfinanced_capex,
        fin.cash_taxes,
        fin.scheduled_principal,
        fin.cash_interest,
        fmtRatio(q.reported_dscr),
        "",
        hasUnboarded ? "" : "n/a",
        outcome,
        q.expected.raises_exception ? f.pattern_tag : "n/a",
        "NO",
      ];
      rows.push(
        cells.map((c, i) => (i === 7 ? addbackCell(f, q) : csvCell(c))).join(","),
      );
    }
  }
  return `${rows.join("\n")}\n`;
}

// ---------------------------------------------------------------------- main

/** Render every document. Pure: no filesystem access. */
export function renderAll(facilities = FACILITIES) {
  return facilities.flatMap((f) =>
    f.documents.map((d) => ({ facility: f.id, file: d.file, text: renderDocument(f, d) })),
  );
}

export function generate({ outDir = OUT_DIR, csvPath = CSV_PATH } = {}) {
  const docs = renderAll();
  for (const d of docs) {
    mkdirSync(join(outDir, d.facility), { recursive: true });
    writeFileSync(join(outDir, d.facility, d.file), d.text);
  }
  writeFileSync(csvPath, renderCsv());
  return { documents: docs.length, facilities: FACILITIES.length, csvRows: FACILITIES.flatMap((f) => f.quarters).length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = generate();
  console.log(
    `Wrote ${r.documents} documents across ${r.facilities} facilities to data/facilities/ and ${r.csvRows} rows to data/expected-values-template.csv`,
  );
}
