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
