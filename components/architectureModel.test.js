import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeDscr } from "../calc/dscr.js";
import { FACILITIES } from "../data/facilities.js";
import {
  AMENDMENT_LINE,
  AS_TESTED,
  CITATIONS,
  DENOMINATOR,
  EXAMPLE,
  fmtMillions,
  total,
} from "./architectureModel.ts";

const F5 = FACILITIES.find((f) => f.borrower_name === "Coastal Marine");
const Q2 = F5.quarters.find((q) => q.period_end === EXAMPLE.periodEnd);
const v1 = F5.terms_versions.find((v) => v.version === 1);
const v2 = F5.terms_versions.find((v) => v.version === 2);

test("the page's ratios are what the calculator computes, on boarded v1 and unboarded v2", () => {
  const asTested = computeDscr(v1.terms, Q2.financials, { calcId: "arch-v1" });
  const amended = computeDscr(v2.terms, Q2.financials, { calcId: "arch-v2" });
  assert.equal(asTested.error, undefined);
  assert.equal(amended.error, undefined);
  assert.equal(asTested.dscr, EXAMPLE.computedAsTested);
  assert.equal(amended.dscr, EXAMPLE.computedWithAmendment);
  assert.equal(asTested.components.numerator_total, EXAMPLE.numeratorAsTested);
  assert.equal(amended.components.numerator_total, EXAMPLE.numeratorWithAmendment);
  assert.equal(asTested.components.denominator_total, EXAMPLE.denominator);
  assert.equal(asTested.threshold, EXAMPLE.floor);
  assert.equal(asTested.pass, false);
  assert.equal(amended.pass, true);
});

test("the page's line items add up to its own totals", () => {
  assert.equal(total(AS_TESTED), EXAMPLE.numeratorAsTested);
  assert.equal(total([...AS_TESTED, AMENDMENT_LINE]), EXAMPLE.numeratorWithAmendment);
  assert.equal(total(DENOMINATOR), EXAMPLE.denominator);
});

test("the reported figure matches the fixture", () => {
  assert.equal(Q2.reported_dscr, EXAMPLE.reported);
});

test("the short money form never rounds up past the exact figure", () => {
  assert.equal(fmtMillions(4973000), "$4.97M");
  assert.equal(fmtMillions(4440000), "$4.44M");
});

test("every citation quote appears verbatim in its source document", () => {
  for (const c of Object.values(CITATIONS)) {
    const text = readFileSync(new URL(`../data/facilities/F5/${c.file}`, import.meta.url), "utf8");
    assert.ok(text.includes(c.quote), `${c.id}: quote not found in ${c.file}`);
  }
});

test("every line item cites something that exists", () => {
  for (const line of [...AS_TESTED, AMENDMENT_LINE, ...DENOMINATOR]) {
    assert.ok(line.citationId && CITATIONS[line.citationId], `${line.label} has no citation`);
  }
});
