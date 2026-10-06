import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { applyTermsDrift, compareTermsToApproved, figuresIn, ratiosIn } from "./terms-drift.js";
import { extractFigures, verifyTermsProvenance } from "./guardrail.js";

// Real clause text from the synthetic corpus, so a rule that passes here passes
// on the documents the live runs read.
const AMD2_S3 =
  "§3 Amendment to Section 7.11.\n(a) Section 7.11(b) of the Credit Agreement is amended so that, in addition to any add-back already permitted there, the Borrower may add back restructuring charges, to the extent deducted in determining net income, in an aggregate amount not to exceed $500,000 for any test period.";
const AMD2_S1 =
  "§1 Effective Date and Scope.\nThis Amendment No. 2 is effective as of April 1, 2026 and amends the Credit Agreement dated as of March 15, 2024 (the \"Credit Agreement\").";
const CA_711 =
  "§7.11 Debt Service Coverage Ratio.\n(a) Minimum Ratio. The Borrower shall not permit the Debt Service Coverage Ratio, tested as of the last day of each fiscal quarter on a trailing four-quarter basis, to be less than 1.25 to 1.00.\n(b) Adjustments. No add-back or other adjustment shall be made to Consolidated EBITDA for purposes of this Section 7.11, except as expressly provided in this Agreement as amended in writing.";
const CC_S3 = "§3 Add-Backs Applied\nAdd-back applied — owner compensation normalisation: 530,000";
const FIN_S2 = "§2 Add-Back Items\nAmounts incurred during the period, before any limit under the Credit Agreement.\nOwner compensation normalisation: 530,000";

const chunk = (citation, content, doc_type, doc_title) => ({ citation, content, doc_type, doc_title });
const F1_CHUNKS = [
  chunk("Amd 2 §3(a)", AMD2_S3, "amendment", "Amendment No. 2"),
  chunk("Amd 2 §1", AMD2_S1, "amendment", "Amendment No. 2"),
  chunk("CA §7.11(a)", CA_711, "agreement", "Credit Agreement"),
];

/** The approved v1 terms exactly as boarded live for F1 and F3. */
const APPROVED = {
  numerator: { base: "Consolidated EBITDA", addbacks: [], deductions: ["unfinanced_capex", "cash_taxes"] },
  threshold: { citation: "CA §7.11", min_dscr: 1.25 },
  denominator: { citation: "CA §1.01", components: ["scheduled_principal", "cash_interest"] },
  test_period: { basis: "TTM", period_end: "2026-06-30" },
  effective_amendments: [],
};
const withAddback = (ab, over = {}) => ({
  ...APPROVED,
  numerator: { ...APPROVED.numerator, addbacks: [ab] },
  ...over,
});

const F1_CITATIONS = [
  {
    field: "numerator.addbacks[0].cap",
    citation: "Amd 2 §3(a)",
    quote:
      "the Borrower may add back restructuring charges, to the extent deducted in determining net income, in an aggregate amount not to exceed $500,000 for any test period.",
  },
  { field: "effective_amendments[0].effective", citation: "Amd 2 §1", quote: "This Amendment No. 2 is effective as of April 1, 2026" },
];
const F1_GOVERNING = withAddback(
  { name: "restructuring charges", amount_source: "financials", cap: 500000, citation: "Amd 2 §3(a)" },
  { effective_amendments: [{ doc: "Amendment No. 2", effective: "2026-04-01", citation: "Amd 2 §1" }] },
);

/** The live false-resolve shape: the borrower's add-back, uncapped, which no clause permits. */
const A1_GOVERNING = withAddback({ name: "owner compensation normalisation", cap: null });

const resolveCase = { recommendation: "resolve", explanation: "x", claims: [] };

// ----------------------------------------------------------- equal: no note

test("equal terms produce no note, whatever the citation labels and list order say", () => {
  // KEEPS ALLOWING: the baseline calculation the orchestrator runs on the boarded
  // terms. Live it sends them back without effective_amendments, with other
  // citation labels and the lists in another order; none of that is a term.
  const restated = {
    numerator: { base: "Consolidated EBITDA", addbacks: [], deductions: ["cash_taxes", "unfinanced_capex"] },
    threshold: { min_dscr: 1.25, citation: "CA §7.11(a)" },
    denominator: { components: ["cash_interest", "scheduled_principal"] },
    test_period: { basis: "TTM", period_end: "2026-06-30" },
  };
  const drift = compareTermsToApproved(restated, APPROVED, [], []);
  assert.equal(drift.equal, true);
  assert.deepEqual(drift.notes, []);
  assert.deepEqual(applyTermsDrift(resolveCase, drift), { casefile: resolveCase, notes: [] });
});

test("THE TRAP: an absent cap and a null cap are the same uncapped add-back, never zero", () => {
  const approved = withAddback({ name: "dry-dock and vessel overhaul charges", cap: null, amount_source: "financials", citation: "CA §7.11(b)(i)" });
  const governing = withAddback({ name: "Dry-dock and vessel overhaul charges" });
  assert.equal(compareTermsToApproved(governing, approved, [], []).equal, true);
  // ...and a cap of 0 is a cap, not "uncapped".
  const zero = withAddback({ name: "dry-dock and vessel overhaul charges", cap: 0 });
  assert.equal(compareTermsToApproved(zero, approved, [], []).equal, false);
});

test("numbers are compared after normalisation, never as text", () => {
  const noisy = { ...APPROVED, threshold: { min_dscr: 1.25 + 1e-12 } };
  assert.equal(compareTermsToApproved(noisy, APPROVED, [], []).equal, true);
  // the quote writes "$500,000"; the term is 500000
  assert.equal(compareTermsToApproved(F1_GOVERNING, APPROVED, F1_CITATIONS, F1_CHUNKS).verified, true);
});

// --------------------------------------------- the two mandatory mirror tests

test("MIRROR F1: Amendment No. 2's capped add-back, quoted, FLAGS and the resolve stands", () => {
  const drift = compareTermsToApproved(F1_GOVERNING, APPROVED, F1_CITATIONS, F1_CHUNKS);
  assert.equal(drift.verified, true);
  assert.deepEqual(drift.notes.map((n) => [n.layer, n.check, n.action]), [["guardrail", "terms_differ_from_approved", "flag"]]);
  assert.match(drift.notes[0].detail, /restructuring charges.*Amd 2 §3\(a\)/);
  const { casefile, notes } = applyTermsDrift(resolveCase, drift);
  assert.equal(casefile.recommendation, "resolve", "a verified re-mapping must still resolve");
  assert.equal(notes.length, 1);
});

test("MIRROR A-1: an uncapped add-back no quoted clause permits, reaching a pass, ESCALATES", () => {
  const drift = compareTermsToApproved(A1_GOVERNING, APPROVED, [], []);
  assert.equal(drift.verified, false);
  assert.deepEqual(drift.notes.map((n) => [n.layer, n.check, n.action]), [["guardrail", "terms_unverified", "escalate"]]);
  assert.match(drift.notes[0].detail, /owner compensation normalisation.*uncapped/);
  const { casefile } = applyTermsDrift(resolveCase, drift);
  assert.equal(casefile.recommendation, "escalate", "a fabricated pass was let through as a resolve");
});

// ------------------------------------------------ what "backed" means, rule by rule

test("rule 2: the borrower's own documents can state an add-back but never permit one", () => {
  // REFUSES: F3's certificate and financials name the add-back and its amount.
  // Without the document-type rule a CAPPED version of it would read as backed.
  const capped = withAddback({ name: "owner compensation normalisation", cap: 530000 });
  const fromBorrower = [
    chunk("CC Q2 2026 §3", CC_S3, "compliance_certificate", "Compliance Certificate — Q2 2026"),
    chunk("Fin Q2 2026 §2", FIN_S2, "financials", "Financials — Q2 2026"),
  ];
  const cites = [
    { citation: "CC Q2 2026 §3", quote: "Add-back applied — owner compensation normalisation: 530,000" },
    { citation: "Fin Q2 2026 §2", quote: "Owner compensation normalisation: 530,000" },
  ];
  assert.equal(compareTermsToApproved(capped, APPROVED, cites, fromBorrower).verified, false);
  assert.equal(compareTermsToApproved(A1_GOVERNING, APPROVED, cites, fromBorrower).verified, false);

  // KEEPS ALLOWING: the identical words, in an amendment, do back it.
  const asAmendment = [chunk("Amd 3 §1", CC_S3, "amendment", "Amendment No. 3")];
  assert.equal(compareTermsToApproved(capped, APPROVED, [{ citation: "Amd 3 §1", quote: cites[0].quote }], asAmendment).verified, true);
});

test("rule 1: a citation with no chunk fetched for this facility backs nothing", () => {
  // The caller fetches by THIS facility only, so another borrower's clause
  // arrives as no chunk at all.
  assert.equal(compareTermsToApproved(F1_GOVERNING, APPROVED, F1_CITATIONS, []).verified, false);
});

test("rule 3: a quote that is not verbatim in its chunk backs nothing", () => {
  const fabricated = [
    { citation: "Amd 2 §3(a)", quote: "the Borrower may add back restructuring charges in an aggregate amount not to exceed $500,000 for any test period." },
    F1_CITATIONS[1],
  ];
  assert.equal(compareTermsToApproved(F1_GOVERNING, APPROVED, fabricated, F1_CHUNKS).verified, false);
  // tolerant of PDF whitespace, exactly as the guardrail's quote match is
  const rewrapped = [{ ...F1_CITATIONS[0], quote: F1_CITATIONS[0].quote.replace(/ /g, "  \n") }, F1_CITATIONS[1]];
  assert.equal(compareTermsToApproved(F1_GOVERNING, APPROVED, rewrapped, F1_CHUNKS).verified, true);
});

test("an empty quote backs nothing, though every chunk 'contains' it: rule 4 finds nothing in it", () => {
  const empty = [{ citation: "Amd 2 §3(a)", quote: "   " }, F1_CITATIONS[1]];
  assert.equal(compareTermsToApproved(F1_GOVERNING, APPROVED, empty, F1_CHUNKS).verified, false);
  for (const governing of [{ ...APPROVED, threshold: { min_dscr: 1.2 } }, { ...APPROVED, effective_amendments: [{ doc: "Amendment No. 2", effective: "2026-04-01" }] }]) {
    assert.equal(compareTermsToApproved(governing, APPROVED, [{ citation: "Amd 2 §1", quote: "" }], F1_CHUNKS).verified, false);
  }
});

test("rule 4, add-back: the quote must name it, and a numeric cap must be in it", () => {
  const renamed = withAddback({ name: "integration costs", cap: 500000 });
  assert.equal(compareTermsToApproved(renamed, APPROVED, F1_CITATIONS, F1_CHUNKS).verified, false);
  const raised = withAddback({ name: "restructuring charges", cap: 620000 });
  assert.equal(compareTermsToApproved(raised, APPROVED, F1_CITATIONS, F1_CHUNKS).verified, false);
  const uncapped = withAddback({ name: "restructuring charges", cap: null });
  assert.equal(compareTermsToApproved(uncapped, APPROVED, F1_CITATIONS, F1_CHUNKS).verified, false, "a capped clause cannot back an uncapped add-back");
  // KEEPS ALLOWING the correct cap, case-insensitively named
  const right = withAddback({ name: "Restructuring Charges", cap: 500000 });
  assert.equal(compareTermsToApproved(right, APPROVED, F1_CITATIONS, F1_CHUNKS).verified, true);
});

test("rule 4, add-back: a cap that belongs to a DIFFERENT add-back in the same quote is refused", () => {
  const both = "The Borrower may add back restructuring charges, up to $500,000; and fuel hedging losses, up to $800,000.";
  const chunks = [chunk("Amd 4 §2", both, "amendment", "Amendment No. 4")];
  const cites = [{ citation: "Amd 4 §2", quote: both }];
  const swapped = { ...APPROVED, numerator: { ...APPROVED.numerator, addbacks: [{ name: "restructuring charges", cap: 800000 }, { name: "fuel hedging losses", cap: 800000 }] } };
  assert.equal(compareTermsToApproved(swapped, APPROVED, cites, chunks).verified, false);
  const paired = { ...APPROVED, numerator: { ...APPROVED.numerator, addbacks: [{ name: "restructuring charges", cap: 500000 }, { name: "fuel hedging losses", cap: 800000 }] } };
  assert.equal(compareTermsToApproved(paired, APPROVED, cites, chunks).verified, true);
});

test("rule 4, add-back: uncapped needs words saying so, and a chunk that caps it refuses", () => {
  const without = "The Borrower may add back integration costs without limit.";
  const ok = compareTermsToApproved(withAddback({ name: "integration costs", cap: null }), APPROVED, [{ citation: "Amd 5 §1", quote: without }], [chunk("Amd 5 §1", without, "amendment", "Amendment No. 5")]);
  assert.equal(ok.verified, true);
  // a quote cut away from the limit that follows it
  const full = "The Borrower may add back integration costs without limit\nintegration costs shall not exceed $250,000 in any test period.";
  const cut = compareTermsToApproved(withAddback({ name: "integration costs", cap: null }), APPROVED, [{ citation: "Amd 5 §1", quote: "The Borrower may add back integration costs without limit" }], [chunk("Amd 5 §1", full, "amendment", "Amendment No. 5")]);
  assert.equal(cut.verified, false);
});

test("rule 4, threshold: a value must be stated AS the ratio, so 1.00 is not backed by '1.25 to 1.00'", () => {
  const lowered = { ...APPROVED, threshold: { min_dscr: 1.0 } };
  const cites = [{ citation: "CA §7.11(a)", quote: "to be less than 1.25 to 1.00." }];
  assert.equal(compareTermsToApproved(lowered, APPROVED, cites, F1_CHUNKS).verified, false);
  // A figure that is IN the quote but not stated as a ratio is not a minimum.
  const fee = "The Borrower shall pay a commitment fee of 0.50 percent per annum.";
  const halved = compareTermsToApproved({ ...APPROVED, threshold: { min_dscr: 0.5 } }, APPROVED, [{ citation: "Amd 7 §1", quote: fee }], [chunk("Amd 7 §1", fee, "amendment", "Amendment No. 7")]);
  assert.equal(halved.verified, false, "a stray 0.50 backed a threshold");
  // KEEPS ALLOWING a threshold an amendment really states
  const amended = "Section 7.11(a) is amended so that the Debt Service Coverage Ratio shall not be less than 1.20 to 1.00.";
  const r = compareTermsToApproved({ ...APPROVED, threshold: { min_dscr: 1.2 } }, APPROVED, [{ citation: "Amd 6 §1", quote: amended }], [chunk("Amd 6 §1", amended, "amendment", "Amendment No. 6")]);
  assert.equal(r.verified, true);
});

test("rule 4, amendment: the quote must be in THAT amendment and state ITS date", () => {
  const governing = (doc, effective) => ({ ...APPROVED, effective_amendments: [{ doc, effective }] });
  const cites = [F1_CITATIONS[1]];
  assert.equal(compareTermsToApproved(governing("Amendment No. 2", "2026-04-01"), APPROVED, cites, F1_CHUNKS).verified, true);
  assert.equal(compareTermsToApproved(governing("Amendment No. 3", "2026-04-01"), APPROVED, cites, F1_CHUNKS).verified, false, "a fabricated amendment");
  assert.equal(compareTermsToApproved(governing("Amendment No. 2", "2026-03-01"), APPROVED, cites, F1_CHUNKS).verified, false, "the wrong date");
});

test("rule 4, deduction and component: an added one needs a clause naming it", () => {
  const extra = { ...APPROVED, numerator: { ...APPROVED.numerator, deductions: ["unfinanced_capex", "cash_taxes", "dividends"] } };
  assert.equal(compareTermsToApproved(extra, APPROVED, [{ citation: "CA §7.11(a)", quote: "Consolidated EBITDA" }], F1_CHUNKS).verified, false);
  const def = "\"Debt Service Coverage Ratio\" means the ratio of Consolidated EBITDA minus cash taxes paid to Debt Service.";
  const noTaxes = { numerator: { addbacks: [], deductions: [] }, threshold: { min_dscr: 1.25 }, denominator: { components: ["scheduled_principal", "cash_interest"] } };
  const addTaxes = { ...noTaxes, numerator: { addbacks: [], deductions: ["cash_taxes"] } };
  assert.equal(compareTermsToApproved(addTaxes, noTaxes, [{ citation: "CA §1.01", quote: def }], [chunk("CA §1.01", def, "agreement", "Credit Agreement")]).verified, true);
});

test("a REMOVED executable term is never backed, whatever is quoted; a dropped amendment entry is only recorded", () => {
  // REFUSES: dropping a deduction or a component raises the ratio exactly as a
  // fabricated add-back does, and no quote can prove a term stopped applying.
  const noCapex = { ...APPROVED, numerator: { ...APPROVED.numerator, deductions: ["cash_taxes"] } };
  const quoted = [{ citation: "CA §7.11(a)", quote: "to be less than 1.25 to 1.00." }];
  assert.equal(compareTermsToApproved(noCapex, APPROVED, quoted, F1_CHUNKS).verified, false);
  const noInterest = { ...APPROVED, denominator: { components: ["scheduled_principal"] } };
  assert.equal(compareTermsToApproved(noInterest, APPROVED, quoted, F1_CHUNKS).verified, false);
  const approvedWith = withAddback({ name: "dry-dock and vessel overhaul charges", cap: 500000 });
  assert.equal(compareTermsToApproved(APPROVED, approvedWith, quoted, F1_CHUNKS).verified, false);

  // KEEPS ALLOWING: the amendment list is documentary. Dropping an entry, or
  // not stating the list at all, cannot move a figure, so it flags rather than
  // escalates — and leaving the key out is not even a difference.
  const approvedAmended = { ...APPROVED, effective_amendments: [{ doc: "Amendment No. 2", effective: "2026-04-01" }] };
  const dropped = compareTermsToApproved({ ...APPROVED, effective_amendments: [] }, approvedAmended, [], []);
  assert.equal(dropped.verified, true);
  assert.equal(dropped.notes[0].check, "terms_differ_from_approved");
  const { effective_amendments, ...unstated } = APPROVED;
  assert.equal(compareTermsToApproved(unstated, approvedAmended, [], []).equal, true);
});

test("fail closed: unreadable terms, or no approved terms in force, are unverified", () => {
  for (const [g, a] of [[null, APPROVED], [{ threshold: {} }, APPROVED], [withAddback({ name: "x", cap: "500,000" }), APPROVED], [APPROVED, null]]) {
    const drift = compareTermsToApproved(g, a, F1_CITATIONS, F1_CHUNKS);
    assert.equal(drift.verified, false);
    assert.equal(drift.notes[0].check, "terms_unverified");
    assert.equal(applyTermsDrift(resolveCase, drift).casefile.recommendation, "escalate");
  }
});

test("only a resolve is downgraded; the note says when it left a recommendation alone", () => {
  const drift = compareTermsToApproved(A1_GOVERNING, APPROVED, [], []);
  for (const recommendation of ["request", "escalate", "abstain"]) {
    const { casefile, notes } = applyTermsDrift({ ...resolveCase, recommendation }, drift);
    assert.equal(casefile.recommendation, recommendation, `${recommendation} was changed`);
    assert.equal(notes[0].action, "escalate");
    assert.match(notes[0].detail, new RegExp(`recommendation was "${recommendation}", which this check does not change`));
  }
  // and the drift's own notes are not mutated by applying them
  assert.doesNotMatch(drift.notes[0].detail, /which this check does not change/);
});

// ---------------------------------------- the duplicated readings stay in step

function corpus() {
  const root = join(import.meta.dirname, "..", "data", "facilities");
  const texts = [];
  for (const f of readdirSync(root, { withFileTypes: true })) {
    if (!f.isDirectory()) continue;
    for (const file of readdirSync(join(root, f.name))) if (file.endsWith(".txt")) texts.push(readFileSync(join(root, f.name, file), "utf8"));
  }
  assert.ok(texts.length >= 16, `the corpus was not found (${texts.length} texts)`);
  return [
    ...texts,
    ...texts.flatMap((t) => t.split("\n")),
    "The covenant floor is (0.50 to 1.00) and coverage is 1.12.",
    "minimum (1.25x); net loss (1,200); (the floor is 0.50); $4.25m; 2.5k; 1.31:1; 1.25 times",
    "EBITDA fell from 2,400,000 to 1,900,000 in Q2 2026 per §7.11(b) and Section 1.01 on 2026-06-30",
  ];
}

test("figuresIn reads every corpus text exactly as the guardrail's extractFigures does", () => {
  for (const text of corpus()) assert.deepEqual(figuresIn(text), extractFigures(text), text.slice(0, 80));
});

test("ratiosIn backs a threshold exactly when verifyTermsProvenance would", () => {
  const values = [1, 1.12, 1.2, 1.25, 1.31, 0.5, 2.5];
  let compared = 0;
  let ratios = 0;
  for (const quote of corpus()) {
    for (const v of values) {
      if (!extractFigures(quote).some((n) => Math.abs(n - v) < 1e-9)) continue;
      const guardrail = verifyTermsProvenance({ threshold: { min_dscr: v } }, [{ field: "threshold.min_dscr", citation: "X", quote }], [{ citation: "X", content: quote }]).valid;
      const mine = ratiosIn(quote).some((n) => Math.abs(n - v) < 1e-9);
      assert.equal(mine, guardrail, `${v} in ${JSON.stringify(quote.slice(0, 80))}`);
      compared += 1;
      if (mine) ratios += 1;
    }
  }
  // Not vacuous: both verdicts occur, many times over.
  assert.ok(compared > 20 && ratios > 5 && compared - ratios > 5, `compared ${compared}, ratios ${ratios}`);
});
