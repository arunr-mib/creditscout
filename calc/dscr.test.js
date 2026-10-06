import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDscr, roundHalfUp, CALCULATOR_VERSION } from "./dscr.js";

/**
 * Covers PRD §2.3 behaviours 1–10. Every one of these runs with no model call
 * and no network — which is why the deterministic core is the cheapest place
 * to build confidence.
 */

const TERMS = {
  test_period: { basis: "TTM", period_end: "2026-06-30" },
  threshold: { min_dscr: 1.25, citation: "CA §7.11" },
  numerator: {
    base: "Consolidated EBITDA",
    addbacks: [],
    deductions: ["unfinanced_capex", "cash_taxes"],
  },
  denominator: { components: ["scheduled_principal", "cash_interest"] },
};

const FIN = {
  ebitda: 4_250_000,
  addback_amounts: {},
  unfinanced_capex: 300_000,
  cash_taxes: 250_000,
  scheduled_principal: 2_600_000,
  cash_interest: 1_030_000,
};

const opts = { calcId: "calc_test" };
const withTerms = (patch) => ({ ...TERMS, ...patch });
const withFin = (patch) => ({ ...FIN, ...patch });

// --- 1. happy path ----------------------------------------------------------
test("computes DSCR from terms and financials", () => {
  const r = computeDscr(TERMS, FIN, opts);
  // (4,250,000 − 300,000 − 250,000) / (2,600,000 + 1,030,000) = 3,700,000/3,630,000
  assert.equal(r.dscr, 1.02);
  assert.equal(r.threshold, 1.25);
  assert.equal(r.pass, false);
  assert.equal(r.margin, -0.23);
  assert.equal(r.calc_id, "calc_test");
  assert.equal(r.calculator_version, CALCULATOR_VERSION);
});

// --- 2. half-up rounding ----------------------------------------------------
test("rounds half-up, not to even, and not via float multiplication", () => {
  assert.equal(roundHalfUp(1.2549, 2), 1.25);
  assert.equal(roundHalfUp(1.255, 2), 1.26);
  assert.equal(roundHalfUp(1.005, 2), 1.01); // Math.round(1.005*100)/100 gives 1.00
  assert.equal(roundHalfUp(2.675, 2), 2.68); // classic float trap
  assert.equal(roundHalfUp(-1.255, 2), -1.26);
});

// --- 3. add-back caps -------------------------------------------------------
test("applies the add-back cap", () => {
  const terms = withTerms({
    numerator: {
      ...TERMS.numerator,
      addbacks: [{ name: "restructuring charges", cap: 500_000 }],
    },
  });
  const fin = withFin({ addback_amounts: { "restructuring charges": 800_000 } });
  const r = computeDscr(terms, fin, opts);
  assert.equal(r.components.addbacks["restructuring charges"].applied, 500_000);
  assert.equal(r.components.addbacks["restructuring charges"].claimed, 800_000);
  assert.equal(r.components.addbacks["restructuring charges"].capped, true);
});

// --- 4. absent / null cap means UNCAPPED ------------------------------------
test("treats an absent cap as uncapped", () => {
  const terms = withTerms({
    numerator: { ...TERMS.numerator, addbacks: [{ name: "one-time items" }] },
  });
  const fin = withFin({ addback_amounts: { "one-time items": 900_000 } });
  const r = computeDscr(terms, fin, opts);
  assert.equal(r.components.addbacks["one-time items"].applied, 900_000);
  assert.equal(r.components.addbacks["one-time items"].capped, false);
});

test("treats a null cap as uncapped", () => {
  const terms = withTerms({
    numerator: {
      ...TERMS.numerator,
      addbacks: [{ name: "one-time items", cap: null }],
    },
  });
  const fin = withFin({ addback_amounts: { "one-time items": 900_000 } });
  const r = computeDscr(terms, fin, opts);
  assert.equal(r.components.addbacks["one-time items"].applied, 900_000);
});

// --- 5. negative EBITDA is a result, not an error ---------------------------
test("returns a negative DSCR when EBITDA is negative", () => {
  const r = computeDscr(TERMS, withFin({ ebitda: -1_000_000 }), opts);
  assert.ok(r.dscr < 0, `expected a negative DSCR, got ${r.dscr}`);
  assert.equal(r.pass, false);
  assert.equal(r.error, undefined);
});

// --- 6. denominator guards --------------------------------------------------
test("errors when the denominator is zero", () => {
  const fin = withFin({ scheduled_principal: 0, cash_interest: 0 });
  assert.match(computeDscr(TERMS, fin, opts).error, /denominator/);
});

test("errors when the denominator is negative", () => {
  const fin = withFin({ scheduled_principal: -100, cash_interest: 0 });
  assert.match(computeDscr(TERMS, fin, opts).error, /denominator/);
});

// --- 7. missing inputs are NEVER defaulted to zero --------------------------
test("errors when a required financial input is missing", () => {
  const fin = withFin({});
  delete fin.cash_interest;
  const r = computeDscr(TERMS, fin, opts);
  assert.match(r.error, /missing input: financials\.cash_interest/);
  assert.equal(r.dscr, undefined);
});

test("errors when a required financial input is not a finite number", () => {
  for (const bad of [null, undefined, NaN, Infinity, "4250000"]) {
    const r = computeDscr(TERMS, withFin({ ebitda: bad }), opts);
    assert.match(r.error, /missing input: financials\.ebitda/, `for ${String(bad)}`);
  }
});

// --- 8. add-back named in terms but absent from financials ------------------
test("errors when an add-back named in terms has no figure in financials", () => {
  const terms = withTerms({
    numerator: {
      ...TERMS.numerator,
      addbacks: [{ name: "restructuring charges", cap: 500_000 }],
    },
  });
  const r = computeDscr(terms, FIN, opts); // addback_amounts is {}
  assert.match(r.error, /missing input: financials\.addback_amounts\["restructuring charges"\]/);
});

// --- 9. unknown component names --------------------------------------------
test("errors on an unknown deduction name", () => {
  const terms = withTerms({
    numerator: { ...TERMS.numerator, deductions: ["management_fees"] },
  });
  assert.match(computeDscr(terms, FIN, opts).error, /unknown deduction component/);
});

test("errors on an unknown denominator component name", () => {
  const terms = withTerms({ denominator: { components: ["balloon_payment"] } });
  assert.match(computeDscr(terms, FIN, opts).error, /unknown denominator component/);
});

test("errors when the denominator lists no components", () => {
  const terms = withTerms({ denominator: { components: [] } });
  assert.match(computeDscr(terms, FIN, opts).error, /at least one component/);
});

// --- 10. calc_id is injected, never generated -------------------------------
test("errors when calcId is not supplied", () => {
  assert.match(computeDscr(TERMS, FIN, {}).error, /calcId is required/);
  assert.match(computeDscr(TERMS, FIN, undefined).error, /calcId is required/);
  assert.match(computeDscr(TERMS, FIN, { calcId: "" }).error, /calcId is required/);
});

// --- purity -----------------------------------------------------------------
test("does not mutate its inputs", () => {
  const terms = withTerms({
    numerator: {
      ...TERMS.numerator,
      addbacks: [{ name: "restructuring charges", cap: 500_000 }],
    },
  });
  const fin = withFin({ addback_amounts: { "restructuring charges": 800_000 } });
  const termsBefore = JSON.stringify(terms);
  const finBefore = JSON.stringify(fin);
  computeDscr(terms, fin, opts);
  assert.equal(JSON.stringify(terms), termsBefore);
  assert.equal(JSON.stringify(fin), finBefore);
});

// --- the amendment-add-back behaviour --------------------------------------
// Figures chosen to isolate the behaviour. F1's ACTUAL numbers come from the
// synthetic facilities (F2) and are graded against the owner's independently
// computed spreadsheet — not asserted here, which would only prove the
// calculator agrees with itself.
test("a capped add-back can turn a breach into a pass", () => {
  const fin = withFin({
    ebitda: 3_350_000,
    addback_amounts: { "restructuring charges": 800_000 },
    unfinanced_capex: 300_000,
    cash_taxes: 250_000,
    scheduled_principal: 1_800_000,
    cash_interest: 700_000,
  });

  // Pre-amendment: no add-back permitted. 2,800,000 / 2,500,000 = 1.12
  const pre = computeDscr(TERMS, fin, { calcId: "calc_pre" });
  assert.equal(pre.dscr, 1.12);
  assert.equal(pre.pass, false);

  // Post-amendment: 800k claimed, capped at 500k. 3,300,000 / 2,500,000 = 1.32
  const post = computeDscr(
    withTerms({
      numerator: {
        ...TERMS.numerator,
        addbacks: [{ name: "restructuring charges", cap: 500_000 }],
      },
    }),
    fin,
    { calcId: "calc_post" },
  );

  assert.equal(post.dscr, 1.32);
  assert.equal(post.pass, true);
  assert.equal(post.components.addbacks["restructuring charges"].capped, true);
  assert.ok(post.dscr > pre.dscr, "a permitted add-back must raise the ratio");
});

// --- 11. ambiguous terms are refused, not guessed ---------------------------
test("errors when the same add-back is named twice in terms", () => {
  // `financials.addback_amounts` is keyed by name, so a repeated name cannot
  // mean two different figures — it is a mapping error. Adding the same figure
  // twice would overstate the numerator and log only one of the two entries,
  // leaving the components unable to reconcile with the total.
  const r = computeDscr(
    withTerms({
      numerator: {
        ...TERMS.numerator,
        addbacks: [
          { name: "restructuring charges", cap: 500_000, citation: "CA §1.01" },
          { name: "restructuring charges", cap: 500_000, citation: "Amd 2 §3(a)" },
        ],
      },
    }),
    withFin({ addback_amounts: { "restructuring charges": 500_000 } }),
    opts,
  );
  assert.ok(r.error, "a duplicate add-back name must not silently double-count");
  assert.match(r.error, /duplicate add-back/);
});

test("errors when the same deduction is named twice in terms", () => {
  const r = computeDscr(
    withTerms({
      numerator: { ...TERMS.numerator, deductions: ["cash_taxes", "cash_taxes"] },
    }),
    FIN,
    opts,
  );
  assert.ok(r.error);
  assert.match(r.error, /duplicate deduction/);
});

test("errors when the same denominator component is named twice", () => {
  const r = computeDscr(
    withTerms({ denominator: { components: ["cash_interest", "cash_interest"] } }),
    FIN,
    opts,
  );
  assert.ok(r.error);
  assert.match(r.error, /duplicate denominator component/);
});
