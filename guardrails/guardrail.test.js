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
  // Accepted residue: 1.31 IS the logged DSCR, so "from 1.31 to 1.00" reads as a ratio pair.
  assert.equal(verdict("Coverage went from 1.31 to 1.00"), "resolve");
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
