import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyGuardrail,
  normaliseNumber,
  extractFigures,
  verifyTermsProvenance,
} from "./guardrail.js";

/** Covers PRD §2.3 behaviours 18–24, plus the S-1 security fix. */

const CHUNKS = [
  {
    citation: "CA §7.11",
    content:
      "Section 7.11 Financial Covenants. The Borrower shall maintain a Debt Service " +
      "Coverage Ratio of not less than 1.25x, tested quarterly on a trailing twelve " +
      "month basis as of the last day of each fiscal quarter.",
  },
  {
    citation: "Amd 2 §3(a)",
    content:
      "Section 3(a). Consolidated EBITDA shall be increased by restructuring charges " +
      "actually incurred, in an aggregate amount not to exceed $500,000.",
  },
];

const CALCS = [
  {
    calc_id: "calc_a1",
    outputs: { dscr: 1.31, threshold: 1.25, pass: true, margin: 0.06 },
  },
];

const base = (patch) => ({
  recommendation: "resolve",
  confidence_basis: "amendment located and applied",
  explanation: "Recomputed DSCR is 1.31 against the required 1.25x.",
  claims: [
    {
      text: "The covenant requires 1.25x",
      citation: "CA §7.11",
      quote: "Debt Service Coverage Ratio of not less than 1.25x",
    },
  ],
  calculations: [{ calc_id: "calc_a1" }],
  missing_evidence: [],
  suggested_tag: "amendment_addback",
  steps_count: 6,
  ...patch,
});

// --- 20. normalisation ------------------------------------------------------
test("normaliseNumber handles the formats credit documents actually use", () => {
  assert.equal(normaliseNumber("1,250,000"), 1250000);
  assert.equal(normaliseNumber("1250000"), 1250000);
  assert.equal(normaliseNumber("1.25"), 1.25);
  assert.equal(normaliseNumber("1.25x"), 1.25);
  assert.equal(normaliseNumber("$4.25m"), 4250000);
  assert.equal(normaliseNumber("$500,000"), 500000);
  assert.equal(normaliseNumber("(1,200)"), -1200);
  assert.equal(normaliseNumber("2.5k"), 2500);
  assert.equal(normaliseNumber("not a number"), null);
  assert.equal(normaliseNumber(""), null);
});

test("extractFigures ignores section references, dates and years", () => {
  // These would otherwise be read as unverified figures and abstain on correct work.
  assert.deepEqual(extractFigures("See CA §7.11 and Amd 2 §3(a)."), []);
  assert.deepEqual(extractFigures("Tested as of 2026-06-30 for Q2 2026."), []);
  assert.deepEqual(extractFigures("Section 1.01 defines the term."), []);
  assert.deepEqual(extractFigures("DSCR of 1.31 against 1.25x"), [1.31, 1.25]);
});

// --- 19. THE critical behaviour --------------------------------------------
test("a figure quoted verbatim from a cited clause is ACCEPTED", () => {
  // The subtlest failure mode in the design: if this abstains, the
  // zero-false-resolve metric reads perfect while the product does nothing.
  const { casefile, notes } = applyGuardrail(base(), CALCS, CHUNKS);
  assert.equal(casefile.recommendation, "resolve");
  assert.equal(notes.filter((n) => n.action === "abstain").length, 0);
});

test("the same figure in a different format is accepted", () => {
  const cf = base({
    explanation: "The permitted add-back is capped at $500,000 under the amendment.",
    claims: [
      {
        text: "Add-backs are capped at 500,000",
        citation: "Amd 2 §3(a)",
        quote: "in an aggregate amount not to exceed $500,000",
      },
    ],
  });
  const { casefile } = applyGuardrail(cf, CALCS, CHUNKS);
  assert.notEqual(casefile.recommendation, "abstain");
});

// --- 18. untraceable figures ------------------------------------------------
test("a figure matching no calculation and no quote forces abstain", () => {
  const cf = base({ explanation: "Recomputed DSCR is 1.47 against the required 1.25x." });
  const { casefile, notes } = applyGuardrail(cf, CALCS, CHUNKS);
  assert.equal(casefile.recommendation, "abstain");
  assert.ok(notes.some((n) => n.check === "figure_traceable"));
  assert.match(notes.find((n) => n.check === "figure_traceable").detail, /1\.47/);
});

// --- 21. fabricated quotes --------------------------------------------------
test("a claim whose quote is absent from the cited chunk is removed", () => {
  const cf = base({
    claims: [
      {
        text: "The covenant requires 1.25x",
        citation: "CA §7.11",
        quote: "the Borrower shall maintain a ratio of not less than 1.40x",
      },
    ],
  });
  const { casefile, notes } = applyGuardrail(cf, CALCS, CHUNKS);
  assert.equal(casefile.claims.length, 0);
  assert.ok(notes.some((n) => n.action === "claim_removed"));
  assert.equal(casefile.recommendation, "abstain", "resolve cannot survive losing all claims");
});

test("a citation with no chunk supplied removes the claim", () => {
  const { casefile, notes } = applyGuardrail(base(), CALCS, []);
  assert.equal(casefile.claims.length, 0);
  assert.match(notes[0].detail, /no chunk supplied/);
});

// --- 22. resolve must be earned --------------------------------------------
test("resolve without a passing calculation is downgraded to escalate", () => {
  const failing = [{ calc_id: "calc_a1", outputs: { dscr: 1.1, threshold: 1.25, pass: false, margin: -0.15 } }];
  const cf = base({ explanation: "Recomputed DSCR is 1.1 against the required 1.25x." });
  const { casefile, notes } = applyGuardrail(cf, failing, CHUNKS);
  assert.equal(casefile.recommendation, "escalate");
  assert.ok(notes.some((n) => n.check === "resolve_requires_evidence"));
});

test("resolve with no cited terms is downgraded to escalate", () => {
  const cf = base({ claims: [], explanation: "Resolved." });
  const { casefile } = applyGuardrail(cf, CALCS, CHUNKS);
  assert.equal(casefile.recommendation, "escalate");
});

// --- whitespace tolerance ---------------------------------------------------
test("quote matching tolerates PDF whitespace and curly quotes", () => {
  const cf = base({
    claims: [
      {
        text: "The covenant requires 1.25x",
        citation: "CA §7.11",
        quote: "Debt  Service\nCoverage   Ratio of not less than 1.25x",
      },
    ],
  });
  const { casefile } = applyGuardrail(cf, CALCS, CHUNKS);
  assert.equal(casefile.claims.length, 1, "whitespace noise must not fail a real quote");
});

// --- S-1: covenant term provenance -----------------------------------------
const TERM_CHUNKS = [
  { citation: "CA §7.11", content: CHUNKS[0].content },
  { citation: "Amd 2 §3(a)", content: CHUNKS[1].content },
];

test("S-1: a term whose value appears in its cited quote is accepted", () => {
  const terms = { threshold: { min_dscr: 1.25 } };
  const cites = [
    {
      field: "threshold.min_dscr",
      citation: "CA §7.11",
      quote: "Debt Service Coverage Ratio of not less than 1.25x",
    },
  ];
  const r = verifyTermsProvenance(terms, cites, TERM_CHUNKS);
  assert.equal(r.valid, true, JSON.stringify(r.violations));
});

test("S-1: a term with a REAL citation but a WRONG value is rejected", () => {
  // The dangerous case: it looks correct. A 0.85 threshold would silently pass
  // every real breach for this borrower, for every future quarter.
  const terms = { threshold: { min_dscr: 0.85 } };
  const cites = [
    {
      field: "threshold.min_dscr",
      citation: "CA §7.11",
      quote: "Debt Service Coverage Ratio of not less than 1.25x",
    },
  ];
  const r = verifyTermsProvenance(terms, cites, TERM_CHUNKS);
  assert.equal(r.valid, false);
  assert.match(r.violations[0].reason, /does not appear in its cited quote/);
});

test("S-1: a term with no citation at all is rejected", () => {
  const r = verifyTermsProvenance({ threshold: { min_dscr: 1.25 } }, [], TERM_CHUNKS);
  assert.equal(r.valid, false);
  assert.match(r.violations[0].reason, /no citation/);
});

test("S-1: a capped add-back verifies against the amendment", () => {
  const terms = {
    threshold: { min_dscr: 1.25 },
    numerator: { addbacks: [{ name: "restructuring charges", cap: 500000 }] },
  };
  const cites = [
    {
      field: "threshold.min_dscr",
      citation: "CA §7.11",
      quote: "Debt Service Coverage Ratio of not less than 1.25x",
    },
    {
      field: "numerator.addbacks[0].cap",
      citation: "Amd 2 §3(a)",
      quote: "in an aggregate amount not to exceed $500,000",
    },
  ];
  const r = verifyTermsProvenance(terms, cites, TERM_CHUNKS);
  assert.equal(r.valid, true, JSON.stringify(r.violations));
});

// --- scale suffixes must be attached to the figure --------------------------
test("a word after a figure is not read as a scale suffix", () => {
  // "$500,000 may be added back" must not become $500bn. The suffix letters
  // b/k/m/x start plenty of words this corpus uses — below, breach, months,
  // minimum, may — and inflating the figure abstains on correct work.
  assert.deepEqual(extractFigures("not to exceed $500,000 may be added back"), [500000]);
  assert.deepEqual(extractFigures("we compute 1.08 below the 1.25 minimum"), [1.08, 1.25]);
  assert.deepEqual(extractFigures("EBITDA for the trailing 12 months"), [12]);
  assert.deepEqual(extractFigures("reported 1.31 but we compute 1.08"), [1.31, 1.08]);
  // attached suffixes still scale
  assert.deepEqual(extractFigures("cap of $4.25m and 2.5k of fees"), [4250000, 2500]);
});

test("a figure quoted from a clause that continues in words is ACCEPTED", () => {
  const chunks = [
    {
      citation: "Amd 2 §3(a)",
      content:
        "Consolidated EBITDA shall be increased by restructuring charges in an " +
        "aggregate amount not to exceed $500,000 may be added back for the period.",
    },
  ];
  const cf = base({
    explanation: "The amendment caps the add-back at $500,000, so DSCR is 1.31.",
    claims: [
      {
        text: "The add-back is capped at $500,000",
        citation: "Amd 2 §3(a)",
        quote: "not to exceed $500,000 may be added back",
      },
    ],
  });
  const { casefile, notes } = applyGuardrail(cf, CALCS, chunks);
  assert.equal(casefile.recommendation, "resolve", JSON.stringify(notes));
});

test("S-1: a cap whose quote continues in words still verifies", () => {
  const chunks = [
    {
      citation: "Amd 2 §3(a)",
      content: "restructuring charges not to exceed $500,000 may be added back",
    },
  ];
  const r = verifyTermsProvenance(
    { numerator: { addbacks: [{ name: "restructuring charges", cap: 500000 }] } },
    [
      {
        field: "numerator.addbacks[0].cap",
        citation: "Amd 2 §3(a)",
        quote: "not to exceed $500,000 may be added back",
      },
    ],
    chunks,
  );
  assert.equal(r.valid, true, JSON.stringify(r.violations));
});

// --- the denominator of a ratio is not a figure ------------------------------
// "not less than 1.25 to 1.00" holds two numbers, and only one is the minimum.
const RATIO_CLAUSE =
  "The Borrower shall not permit the Debt Service Coverage Ratio, tested as of the last day of each fiscal quarter, to be less than 1.25 to 1.00.";
const RATIO_CHUNKS = [{ citation: "CA §7.11", content: RATIO_CLAUSE }];
const thresholdCheck = (value, quote, chunks = RATIO_CHUNKS) =>
  verifyTermsProvenance(
    { threshold: { min_dscr: value } },
    [{ field: "threshold.min_dscr", citation: "CA §7.11", quote }],
    chunks,
  );

test("extractFigures drops the denominator of a stated ratio, and only that", () => {
  assert.deepEqual(extractFigures("to be less than 1.25 to 1.00."), [1.25]);
  assert.deepEqual(extractFigures("a ratio of 1.25 to 1 or better"), [1.25]);
  assert.deepEqual(extractFigures("covenant of 1.25:1"), [1.25]);
  // a 1.00 that is not a denominator stays a figure; so does 1.05 and 12
  assert.deepEqual(extractFigures("a DSCR of 1.00x"), [1]);
  assert.deepEqual(extractFigures("1.25 to 1.05"), [1.25, 1.05]);
  assert.deepEqual(extractFigures("1.25 to 12"), [1.25, 12]);
});

test("S-1: 1.25 verifies against '1.25 to 1.00'; 1.00 does not, even though 1.00 is in the quote", () => {
  assert.equal(thresholdCheck(1.25, RATIO_CLAUSE).valid, true);
  const r = thresholdCheck(1.0, RATIO_CLAUSE);
  assert.equal(r.valid, false);
  assert.equal(r.violations[0].field, "threshold.min_dscr");
});

test("S-1 fails closed: a ratio-free quote cannot support a threshold, whatever number it holds", () => {
  const bare = "to 1.00";
  const r = thresholdCheck(1.0, bare, [{ citation: "CA §7.11", content: RATIO_CLAUSE }]);
  assert.equal(r.valid, false);
  assert.match(r.violations[0].reason, /does not appear in its cited quote|not stated as a minimum ratio/);

  // The number is present in the quote but not stated as a ratio.
  const prose = "The Borrower shall maintain a coverage level of 1.25 at all times.";
  const r2 = thresholdCheck(1.25, prose, [{ citation: "CA §7.11", content: prose }]);
  assert.equal(r2.valid, false);
  assert.match(r2.violations[0].reason, /not stated as a minimum ratio/);
});

test("S-1: the ratio forms 1.25x, 1.25 times, 1.25:1 and '1.25 to 1' all verify", () => {
  for (const quote of ["not less than 1.25x", "not less than 1.25 times", "not less than 1.25:1", "not less than 1.25 to 1"]) {
    assert.equal(thresholdCheck(1.25, quote, [{ citation: "CA §7.11", content: quote }]).valid, true, quote);
  }
});

test("S-1: a quote that states a different minimum is not satisfied by a stray figure", () => {
  const quote = "to be less than 1.35 to 1.00, previously 1.25x";
  const r = thresholdCheck(1.3, quote, [{ citation: "CA §7.11", content: quote }]);
  assert.equal(r.valid, false);
});

test("casefile path: 'requires 1.00x' is not traceable to a clause that says '1.25 to 1.00'", () => {
  const cf = base({
    explanation: "The covenant requires 1.00x and the recomputed DSCR is 1.31.",
    claims: [{ text: "The covenant requires 1.25x", citation: "CA §7.11", quote: "to be less than 1.25 to 1.00" }],
  });
  const { casefile, notes } = applyGuardrail(cf, CALCS, RATIO_CHUNKS);
  assert.equal(casefile.recommendation, "abstain", JSON.stringify(notes));
  assert.match(notes.map((n) => n.detail).join("|"), /unverified figure\(s\): 1/);

  // while the true figure, quoted from the same clause, still passes
  const ok = base({
    explanation: "The covenant requires 1.25x and the recomputed DSCR is 1.31.",
    claims: [{ text: "The covenant requires 1.25x", citation: "CA §7.11", quote: "to be less than 1.25 to 1.00" }],
  });
  assert.equal(applyGuardrail(ok, CALCS, RATIO_CHUNKS).casefile.recommendation, "resolve");
});

// --- N1: the ratio rule must not eat figures that are not ratios -------------
// A false abstain here reads as the model being cautious, and the zero-false-
// resolve metric still reads perfect while the product stops doing anything.
test("N1: 'to 1,900,000' is a figure, not a ratio denominator, and nothing is left behind", () => {
  assert.deepEqual(extractFigures("EBITDA fell from 2,400,000 to 1,900,000"), [2400000, 1900000]);
  assert.deepEqual(extractFigures("EBITDA rose 2,400,000 to 1,900,000"), [2400000, 1900000], "no 'from' needed: the left operand is a grouped number");
  assert.deepEqual(extractFigures("from 12.5 to 1.5"), [12.5, 1.5]);
  assert.deepEqual(extractFigures("1,250,000 to 1"), [1250000, 1], "a grouped left operand is not a ratio's");
  assert.deepEqual(extractFigures("fees went from 3 to 1,200 over the term"), [3, 1200]);
});

test("N1: the casefile path still resolves an explanation that quotes a fall in EBITDA", () => {
  const chunks = [
    { citation: "Fin Q2 2026 §1", content: "Consolidated EBITDA: 1,900,000. Prior period Consolidated EBITDA: 2,400,000." },
    ...RATIO_CHUNKS,
  ];
  const cf = base({
    explanation: "EBITDA fell from 2,400,000 to 1,900,000, and the recomputed DSCR is 1.31 against the required 1.25x.",
    claims: [{ text: "The covenant requires 1.25x", citation: "CA §7.11", quote: "to be less than 1.25 to 1.00" }],
  });
  const { casefile, notes } = applyGuardrail(cf, CALCS, chunks);
  assert.equal(casefile.recommendation, "resolve", JSON.stringify(notes));
});

test("N1: C1 stays closed: the denominator of 1.25 to 1.00 is still not a usable figure, and 1.00x still abstains", () => {
  assert.deepEqual(extractFigures("not less than 1.25 to 1.00"), [1.25]);
  assert.equal(thresholdCheck(1.0, RATIO_CLAUSE).valid, false);
  const bad = base({
    explanation: "The covenant requires 1.00x and the recomputed DSCR is 1.31.",
    claims: [{ text: "The covenant requires 1.25x", citation: "CA §7.11", quote: "to be less than 1.25 to 1.00" }],
  });
  assert.equal(applyGuardrail(bad, CALCS, RATIO_CHUNKS).casefile.recommendation, "abstain");
  const good = base({
    explanation: "The covenant requires 1.25x and the recomputed DSCR is 1.31.",
    claims: [{ text: "The covenant requires 1.25x", citation: "CA §7.11", quote: "to be less than 1.25 to 1.00" }],
  });
  assert.equal(applyGuardrail(good, CALCS, RATIO_CHUNKS).casefile.recommendation, "resolve");
});

// --- N2: wording must decide nothing -----------------------------------------
// "N to 1" is a ratio only if N is one the documents or the calculations state.
// A model's choice of verb cannot make a figure checkable or unchecked.
const explain = (text) =>
  base({
    explanation: `${text}, so the recomputed DSCR is 1.31.`,
    claims: [{ text: "The covenant requires 1.25x", citation: "CA §7.11", quote: "to be less than 1.25 to 1.00" }],
  });
// 0.92 and 1.17 are traceable figures here (a cited chunk states them) but are NOT ratios any
// document states, so what must decide the verdict is the unchecked "1.00", not the first figure.
const WITH_PRIOR = [...RATIO_CHUNKS, { citation: "Fin Q2 2026 §2", content: "Prior-year coverage of 0.92 and 1.17 was reported." }];
const verdict = (text) => applyGuardrail(explain(text), CALCS, WITH_PRIOR).casefile.recommendation;

test("N2: a 1.00 after a number that is not a known ratio is traced like any figure, whatever the surrounding words", () => {
  for (const text of [
    "Coverage rose from 0.92 to 1.00",
    "Coverage was restored from 0.92 to 1.00",
    "Coverage went from approximately 0.92 to 1.00",
    "Coverage improved 0.92 to 1.00",
    "Coverage moved 0.92 to 1.00",
    "Coverage went from $1.17 to 1.00",
    "Coverage was 0.92 to 1.00 last year",
  ]) {
    assert.equal(verdict(text), "abstain", text);
  }
});

test("N2: a known ratio stated as a pair is a ratio, whatever the surrounding words", () => {
  // 1.25 is stated as a ratio by the cited clause; 1.31 is the logged DSCR.
  for (const text of ["The covenant requires 1.25 to 1.00", "The ratio floor is 1.25:1", "Coverage is 1.31 to 1.00 against a floor of 1.25 to 1"]) {
    assert.equal(verdict(text), "resolve", text);
  }
});

test("N2: the accepted residue is EVERY known ratio, not only the logged DSCR", () => {
  // This is the behaviour the code has, written down so nobody reads the rule as
  // narrower than it is. What goes unchecked is only the trailing 1.00.
  //  - 1.31 is the logged DSCR
  //  - 1.25 is the calc threshold AND the clause's own ratio: known in every casefile
  //  - the verb is irrelevant to all of them
  for (const text of ["Coverage went from 1.31 to 1.00", "DSCR fell from 1.25 to 1.00", "DSCR 1.25 to 1.00"]) {
    assert.equal(verdict(text), "resolve", text);
  }
  // A prior quarter's logged DSCR is known too, so it waives its own 1.00.
  const withPrior = [...CALCS, { calc_id: "calc_a0", outputs: { dscr: 1.4, threshold: 1.25, pass: true } }];
  assert.equal(applyGuardrail(explain("DSCR fell from 1.40 to 1.00"), withPrior, WITH_PRIOR).casefile.recommendation, "resolve");
  // Without that prior calculation, 1.40 is not a known ratio and the 1.00 is traced.
  assert.equal(verdict("DSCR fell from 1.40 to 1.00"), "abstain");
});

test("N2: a floor a clause states only as '1.25x' is a known ratio too, so restating it as a pair does not abstain", () => {
  // The false abstain this closes: the clause writes its floor "1.25x"; the calc
  // threshold is a different number; the model restates the floor as "1.25 to
  // 1.00" and used to abstain on the `1`. Documents do use the x / times forms.
  const calcs = [{ calc_id: "calc_b1", outputs: { dscr: 1.31, threshold: 1.1, pass: true } }];
  const chunks = [{ citation: "CA §7.11", content: "The Borrower shall maintain a Debt Service Coverage Ratio of not less than 1.25x at all times." }];
  const cf = base({
    explanation: "The former floor was 1.25 to 1.00 and the recomputed DSCR is 1.31.",
    claims: [{ text: "The covenant requires 1.25x", citation: "CA §7.11", quote: "not less than 1.25x" }],
  });
  assert.equal(applyGuardrail(cf, calcs, chunks).casefile.recommendation, "resolve", "a stated 1.25x floor must not force an abstain when restated as a pair");

  // It stays bounded: a pair whose N no document states as a ratio is still traced.
  const unknown = base({
    explanation: "The former floor was 1.40 to 1.00 and the recomputed DSCR is 1.31.",
    claims: [{ text: "The covenant requires 1.25x", citation: "CA §7.11", quote: "not less than 1.25x" }],
  });
  assert.equal(applyGuardrail(unknown, calcs, chunks).casefile.recommendation, "abstain");
});

test("N2: in a document's text every 'N to 1' is a ratio by its form; a model's text must name a known N", () => {
  assert.deepEqual(extractFigures("coverage was restored from 0.92 to 1.00"), [0.92]);
  assert.deepEqual(extractFigures("coverage was restored from 0.92 to 1.00", []), [0.92, 1]);
  assert.deepEqual(extractFigures("coverage was restored from 0.92 to 1.00", [0.92]), [0.92]);
  assert.deepEqual(extractFigures("requires 1.25 to 1.00", [1.25]), [1.25]);
  assert.deepEqual(extractFigures("requires 1.25 to 1.00", [1.3]), [1.25, 1]);
  // and a quote cannot launder a threshold of 1.00 whatever its verb
  for (const quote of ["restored from 0.92 to 1.00", "from approximately 0.92 to 1.00", "improved 0.92 to 1.00"]) {
    assert.equal(thresholdCheck(1.0, quote, [{ citation: "CA §7.11", content: quote }]).valid, false, quote);
  }
});

// --- E-5: parentheses never make a figure invisible -------------------------
// The rule has two directions and each is tested. It REFUSES a figure hidden in
// brackets that do not wrap it alone; it KEEPS ALLOWING an accounting negative
// and a bracketed ratio, both read as their unbracketed form would be.

test("E-5 refuses: a covenant floor stated in brackets is seen, and an untraceable one abstains", () => {
  // The reproduced bypass: "(0.50 to 1.00)" used to yield no figure at all, so a
  // model could state any floor in brackets and the traceability rule never saw it.
  assert.deepEqual(extractFigures("The covenant floor is (0.50 to 1.00) and coverage is 1.12.", [1.12]), [0.5, 1, 1.12]);
  const calcs = [{ calc_id: "calc_e5", outputs: { dscr: 1.12, threshold: 1.25, pass: false, margin: -0.13 } }];
  const cf = base({
    recommendation: "request",
    explanation: "The covenant floor is (0.50 to 1.00) and coverage is 1.12.",
  });
  const { casefile, notes } = applyGuardrail(cf, calcs, CHUNKS);
  assert.equal(casefile.recommendation, "abstain");
  assert.match(notes.find((n) => n.check === "figure_traceable").detail, /0\.5/);
});

test("E-5 refuses: a half-bracketed figure is read as the figure, not dropped", () => {
  // Any bracket that does not close around the figure itself is not part of it.
  assert.deepEqual(extractFigures("(the floor is 0.50)"), [0.5]);
  assert.deepEqual(extractFigures("(coverage 1.47 at year end)"), [1.47]);
  const cf = base({ explanation: "Recomputed DSCR is 1.31 (the floor is 0.50)." });
  assert.equal(applyGuardrail(cf, CALCS, CHUNKS).casefile.recommendation, "abstain");
});

test("E-5 keeps allowing: a bracketed ratio reads as the ratio, so a quoted floor in brackets does not abstain", () => {
  // HANDOFF 9.4's false abstain: "minimum (1.25x)" read as -1.25.
  assert.deepEqual(extractFigures("minimum (1.25x)"), [1.25]);
  assert.deepEqual(extractFigures("requires (1.25 to 1.00)", [1.25]), [1.25]);
  const cf = base({ explanation: "Recomputed DSCR is 1.31 against the minimum (1.25x), which is (1.25 to 1.00)." });
  const { casefile, notes } = applyGuardrail(cf, CALCS, CHUNKS);
  assert.equal(casefile.recommendation, "resolve", JSON.stringify(notes));
});

test("E-5 keeps allowing: an accounting negative keeps its sign and still matches its statement", () => {
  assert.deepEqual(extractFigures("Net loss (1,200)"), [-1200]);
  const chunks = [...CHUNKS, { citation: "Fin Q2 2026 §1", content: "Net income: (1,200)" }];
  const cf = base({
    explanation: "Recomputed DSCR is 1.31 against the required 1.25x; net income was (1,200).",
    claims: [...base().claims, { text: "Net income was (1,200)", citation: "Fin Q2 2026 §1", quote: "Net income: (1,200)" }],
  });
  assert.equal(applyGuardrail(cf, CALCS, chunks).casefile.recommendation, "resolve");
});

test("E-5: a bracketed PLAIN number keeps the accounting-negative reading and abstains, fail-closed", () => {
  assert.deepEqual(extractFigures("coverage is (1.47)"), [-1.47]);
  const cf = base({ explanation: "Coverage is (1.31) against the required 1.25x." });
  assert.equal(applyGuardrail(cf, CALCS, CHUNKS).casefile.recommendation, "abstain");
});

// --- identifiers are not figures --------------------------------------------
// Each class: what it REFUSES to read as a figure, and what it must KEEP
// reading as one. The keep-allowing half is the one that matters most: an
// identifier rule written too wide makes a real figure invisible.

test("calc ids refuse: a UUID, the id after calc_id / calc id / calculation id, short or full, alone or listed", () => {
  for (const text of [
    "76f4c1f2-75e3-437d-9254-71fd7fa74f53",
    "(calc_id 76f4c1f2-75e3-437d-9254-71fd7fa74f53)",
    "calc_id 76f4c1f2",
    "calc id ebed3d9f",
    "calculation id `2dd96a4c`",
    'calc_id: "967d2b8f"',
    "calc_ids 967d2b8f and 76f4c1f2",
    "calc_ids 967d2b8f, 76f4c1f2",
  ]) assert.deepEqual(extractFigures(text), [], text);
});

test("calc ids keep allowing: the figure after the id, and an all-digit number, which is not a hex id", () => {
  assert.deepEqual(extractFigures("calc_id 76f4c1f2 gives 1.28 against 1.25"), [1.28, 1.25]);
  assert.deepEqual(extractFigures("calc_id: 1250000"), [1250000]);
  assert.deepEqual(extractFigures("calc_ids 967d2b8f, 1250000"), [1250000]);
  assert.deepEqual(extractFigures("the calculation 1.28 passes"), [1.28]);
  assert.deepEqual(extractFigures("EBITDA 4,020,000 less capex 300,000"), [4020000, 300000]);
});

test("dates refuse: ISO, year-month, and a day beside a month name in either order", () => {
  for (const text of ["2026-06-30", "2026-06", "April 1, 2026", "effective April 1", "June 30", "1 April 2026", "30th of June", "Sept. 3", "March 15, 2024", "Jun 30th"]) {
    assert.deepEqual(extractFigures(text), [], text);
  }
});

test("dates keep allowing: a figure near a month that is not its day", () => {
  assert.deepEqual(extractFigures("the DSCR of 1.12 may fall"), [1.12], "the verb 'may' is not May");
  assert.deepEqual(extractFigures("in June EBITDA was 4,020,000"), [4020000]);
  assert.deepEqual(extractFigures("June 1,250,000"), [1250000], "a day is never followed by more digits");
  assert.deepEqual(extractFigures("coverage 1.12 March to June"), [1.12], "a day is never the tail of a decimal");
  assert.deepEqual(extractFigures("12 months"), [12]);
  assert.deepEqual(extractFigures("April 45 units"), [45], "nothing over 31 is a day");
});

test("ordinals and references refuse: version N, vN, Name No. N, sections, articles and their sub-clauses", () => {
  for (const text of [
    "re-board the covenant terms as version 2 for analyst approval",
    "Version 1 terms",
    "the v2 terms",
    "Waiver No. 3",
    "Amendment No. 2",
    "§7.11(b)(2)",
    "Section 7.11(b)(i)",
    "Section 7.11(2)",
    "Art. 5",
    "Amd 2 §3(a)",
    "(a) (i) (b)(i) (iv)",
  ]) assert.deepEqual(extractFigures(text), [], text);
});

test("ordinals and references keep allowing: counts and measures, and a sentence that starts with No.", () => {
  assert.deepEqual(extractFigures("2 versions of the terms"), [2]);
  assert.deepEqual(extractFigures("2 add-backs"), [2]);
  assert.deepEqual(extractFigures("the margin is 2"), [2]);
  assert.deepEqual(extractFigures("The claim was rejected. No. 2 add-backs were claimed."), [2]);
  assert.deepEqual(extractFigures("requires 1.25 to 1.00"), [1.25]);
  assert.deepEqual(extractFigures("not to exceed $500,000"), [500000]);
  assert.deepEqual(extractFigures("Section 7.11 requires 1.25x"), [1.25]);
  // A list is not consumed: its second item has the shape of a ratio.
  assert.deepEqual(extractFigures("Section 7.11 and 1.47"), [1.47]);
});

test("the live F1 explanation: its calc_id and its ISO date are not figures; only the uncited 620,000 abstains", () => {
  // Verbatim from casefile b1d0cf6e. Before the identifier rules the note read
  // "620000, 76, 4, 1, 2, -75, 3, -437, -9254, -71, 7, 74, 53".
  const explanation =
    "The Credit Agreement §7.11 requires a minimum DSCR of 1.25. Amendment No. 2 §3(a), effective 2026-04-01, allows an add-back of restructuring charges up to $500,000. The financials for the trailing twelve months ended 2026-06-30 report Consolidated EBITDA of 4,020,000, unfinanced capex of 300,000, cash taxes of 250,000, scheduled principal of 2,000,000, cash interest of 1,100,000, and restructuring charges of 620,000, capped at 500,000 per the amendment. Applying these terms in dscr_calculator (calc_id 76f4c1f2-75e3-437d-9254-71fd7fa74f53) yields a DSCR of 1.28, which meets the covenant requirement and resolves the exception.";
  const calc = { calc_id: "76f4c1f2", outputs: { dscr: 1.28, threshold: 1.25, pass: true, margin: 0.03, components: { base: 4020000, addbacks: { "restructuring charges": { claimed: 500000, applied: 500000, cap: 500000 } }, deductions: { unfinanced_capex: 300000, cash_taxes: 250000 }, denominator_parts: { scheduled_principal: 2000000, cash_interest: 1100000 } } } };
  const chunks = [{ citation: "Amd 2 §3(a)", content: "the Borrower may add back restructuring charges, in an aggregate amount not to exceed $500,000 for any test period." }];
  const cf = base({ explanation, claims: [{ text: "Amendment No. 2 permits it.", citation: "Amd 2 §3(a)", quote: "not to exceed $500,000" }] });
  const { casefile, notes } = applyGuardrail(cf, [calc], chunks);
  assert.equal(casefile.recommendation, "abstain");
  assert.match(notes.find((n) => n.check === "figure_traceable").detail, /^unverified figure\(s\): 620000 — /);
});

// --- every analyst-facing field is figure-checked ----------------------------

test("REFUSES: an untraceable figure in confidence_basis or missing_evidence abstains, and the note names the field", () => {
  const inBasis = applyGuardrail(base({ confidence_basis: "A DSCR of 1.47 passes." }), CALCS, CHUNKS);
  assert.equal(inBasis.casefile.recommendation, "abstain");
  assert.match(inBasis.notes.find((n) => n.check === "figure_traceable").detail, /confidence_basis: 1\.47/);
  const inMissing = applyGuardrail(base({ missing_evidence: ["A waiver covering the $750,000 add-back"] }), CALCS, CHUNKS);
  assert.equal(inMissing.casefile.recommendation, "abstain");
  assert.match(inMissing.notes.find((n) => n.check === "figure_traceable").detail, /missing_evidence: 750000/);
});

test("KEEPS ALLOWING: logged and quoted figures, and identifiers, in confidence_basis and missing_evidence", () => {
  const cf = base({
    confidence_basis: "Recomputed DSCR of 1.31 against the required 1.25x, with the $500,000 cap applied (calc_id 76f4c1f2).",
    missing_evidence: [
      "Amendment No. 3, if one exists",
      "the Q3 2026 compliance certificate",
      "a waiver countersigned by the lender, dated on or before 2026-06-30 or June 30, 2026",
      "an executed amendment to Section 7.11(b)(i) covering the $500,000 add-back",
    ],
    claims: [...base().claims, { text: "Capped at $500,000", citation: "Amd 2 §3(a)", quote: "in an aggregate amount not to exceed $500,000" }],
  });
  const { casefile, notes } = applyGuardrail(cf, CALCS, CHUNKS);
  assert.equal(casefile.recommendation, "resolve", JSON.stringify(notes));
});

test("REFUSES: an untraceable figure that appears ONLY in a surviving claim's text abstains too", () => {
  // The claim's quote is verbatim, so the claim survives; its TEXT states a
  // figure nothing supports. Text an analyst reads is checked wherever it sits.
  const cf = base({
    claims: [{ text: "The covenant requires 1.25x and coverage was 1.47 last year", citation: "CA §7.11", quote: "Debt Service Coverage Ratio of not less than 1.25x" }],
  });
  const { casefile, notes } = applyGuardrail(cf, CALCS, CHUNKS);
  assert.equal(casefile.claims.length, 1);
  assert.equal(casefile.recommendation, "abstain");
  assert.match(notes.find((n) => n.check === "figure_traceable").detail, /claims: 1\.47/);
});

// --- I-1: a version number is an integer -------------------------------------

test("I-1 refuses: an integer version is an identifier, at a sentence end too", () => {
  for (const text of ["version 2", "Version 1 terms", "the v2 terms", "re-board the covenant terms as version 2.", "use v3."]) {
    assert.deepEqual(extractFigures(text), [], text);
  }
});

test("I-1 keeps allowing: a decimal after 'version' or 'v' is a figure, read exactly as written", () => {
  assert.deepEqual(extractFigures("version 1.47"), [1.47]);
  assert.deepEqual(extractFigures("v1.47"), [1.47]);
  assert.deepEqual(extractFigures("version 1,250,000"), [1250000]);
  // ...so the sentence the review used enforces exactly as its bare form does.
  for (const explanation of [
    "Recomputed DSCR is 1.31 against the required 1.25x. Under the borrower's version 1.47 coverage was higher.",
    "Recomputed DSCR is 1.31 against the required 1.25x. Under the borrower's v1.47 coverage was higher.",
    "Recomputed DSCR is 1.31 against the required 1.25x. Under the borrower's 1.47 coverage was higher.",
  ]) {
    const { casefile, notes } = applyGuardrail(base({ explanation }), CALCS, CHUNKS);
    assert.equal(casefile.recommendation, "abstain", explanation);
    assert.match(notes.find((n) => n.check === "figure_traceable").detail, /1\.47/, explanation);
  }
});

// --- I-2: resolve is earned by the GOVERNING calculation ----------------------

const PASS = { calc_id: "calc_pass", outputs: { dscr: 1.31, threshold: 1.25, pass: true, margin: 0.06 } };
const FAIL = { calc_id: "calc_fail", outputs: { dscr: 1.12, threshold: 1.25, pass: false, margin: -0.13 } };
const both = (patch) => base({ explanation: "Recomputed DSCR is 1.31 against the required 1.25x; the baseline was 1.12.", ...patch });

test("I-2 refuses: a resolve resting on an earlier pass after a LATER fail is escalated", () => {
  const { casefile, notes } = applyGuardrail(both(), [PASS, FAIL], CHUNKS);
  assert.equal(casefile.recommendation, "escalate");
  const n = notes.find((x) => x.check === "resolve_requires_evidence");
  assert.equal(n.action, "escalate");
  assert.match(n.detail, /governing calculation \(calc_fail\).*does not pass/);
});

test("I-2 keeps allowing: F1's shape — boarded fail, then amended pass last — resolves", () => {
  const { casefile, notes } = applyGuardrail(both(), [FAIL, PASS], CHUNKS);
  assert.equal(casefile.recommendation, "resolve", JSON.stringify(notes));
  assert.equal(notes.length, 0);
});

test("I-2: with no calculation at all there is nothing to govern, and resolve is not earned", () => {
  const { casefile, notes } = applyGuardrail(base({ explanation: "No figures." }), [], CHUNKS);
  assert.equal(casefile.recommendation, "escalate");
  assert.equal(notes.find((x) => x.check === "resolve_requires_evidence").detail, "resolve without a passing calculation");
});
