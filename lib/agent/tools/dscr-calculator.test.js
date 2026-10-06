import { test } from "node:test";
import assert from "node:assert/strict";

import { computeDscr } from "../../../calc/dscr.js";
import { FACILITIES, boardedVersionFor, termsFor } from "../../../data/facilities.js";
import { runDscrCalculator } from "./dscr-calculator.ts";

// No network and no database: the client is a recording fake.

const F1 = FACILITIES.find((f) => f.id === "F1");
const Q2 = F1.quarters.find((q) => q.period_end === "2026-06-30");
const TERMS = termsFor(boardedVersionFor(F1, Q2), Q2); // F1's boarded v1 terms
const FINANCIALS = Q2.financials;
const FIXED_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CASEFILE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function fakeClient({ insertError = null } = {}) {
  const inserts = [];
  return {
    inserts,
    from(table) {
      return {
        insert(row) {
          inserts.push({ table, row });
          return Promise.resolve({ error: insertError });
        },
      };
    },
  };
}

const call = (body, over = {}) => {
  const client = over.client ?? fakeClient();
  return runDscrCalculator(body, { client, newId: () => FIXED_ID, ...over }).then((r) => ({ ...r, client }));
};
const clone = (v) => structuredClone(v);

// --------------------------------------------------- the happy path and its log

test("F1 Q2-2026 on v1 terms: 1.12, fail, and the number comes straight from the calculator", async () => {
  const { status, body } = await call({ terms: TERMS, financials: FINANCIALS });
  assert.equal(status, 200);
  assert.equal(body.dscr, 1.12);
  assert.equal(body.pass, false);
  assert.equal(body.threshold, 1.25);
  // The wrapper adds, rounds and adjusts nothing: it is exactly what the pure function returns.
  assert.deepEqual(body, computeDscr(TERMS, FINANCIALS, { calcId: FIXED_ID }));
});

test("writes exactly ONE calc_log row, and its calc_id is the one returned", async () => {
  const { body, client } = await call({ terms: TERMS, financials: FINANCIALS });
  assert.equal(client.inserts.length, 1);
  const [{ table, row }] = client.inserts;
  assert.equal(table, "calc_log");
  assert.equal(row.calc_id, body.calc_id);
  assert.equal(row.calc_id, FIXED_ID);
  assert.equal(row.calculator_version, body.calculator_version);
  assert.deepEqual(row.inputs, { terms: TERMS, financials: FINANCIALS });
  assert.deepEqual(row.outputs, body);
  assert.equal(row.casefile_id, null);
});

test("casefile_id is logged when given", async () => {
  const { client } = await call({ terms: TERMS, financials: FINANCIALS, casefile_id: CASEFILE_ID });
  assert.equal(client.inserts[0].row.casefile_id, CASEFILE_ID);
});

test("the calc_id is minted by the wrapper: a real UUID, fresh each call", async () => {
  const run = () => runDscrCalculator({ terms: TERMS, financials: FINANCIALS }, { client: fakeClient() });
  const [a, b] = [await run(), await run()];
  assert.match(a.body.calc_id, UUID);
  assert.match(b.body.calc_id, UUID);
  assert.notEqual(a.body.calc_id, b.body.calc_id);
});

test("a calc_id supplied in the request is ignored: the model cannot choose its own", async () => {
  const { body, client } = await call({
    terms: TERMS,
    financials: FINANCIALS,
    calc_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  });
  assert.equal(body.calc_id, FIXED_ID);
  assert.equal(client.inserts[0].row.calc_id, FIXED_ID);
});

// --------------------------------------------------- calculator errors are evidence

test("a missing financial input is a 200 with an {error} body and NO calc_log row", async () => {
  const financials = clone(FINANCIALS);
  delete financials.cash_interest;
  const { status, body, client } = await call({ terms: TERMS, financials });
  assert.equal(status, 200);
  assert.deepEqual(body, { error: "missing input: financials.cash_interest" });
  assert.equal(client.inserts.length, 0);
  assert.ok(!("calc_id" in body) && !("dscr" in body));
});

test("an explicit null input is missing too (200 + error), never zero", async () => {
  const { status, body, client } = await call({ terms: TERMS, financials: { ...FINANCIALS, ebitda: null } });
  assert.equal(status, 200);
  assert.match(body.error, /missing input: financials\.ebitda/);
  assert.equal(client.inserts.length, 0);
});

test("an unknown deduction component is a 200 {error}, not a 5xx and not a guess", async () => {
  const terms = clone(TERMS);
  terms.numerator.deductions.push("mystery_cost");
  const { status, body, client } = await call({ terms, financials: FINANCIALS });
  assert.equal(status, 200);
  assert.match(body.error, /unknown deduction component/);
  assert.equal(client.inserts.length, 0);
});

test("a non-positive denominator is a 200 {error}", async () => {
  const { status, body, client } = await call({
    terms: TERMS,
    financials: { ...FINANCIALS, scheduled_principal: 0, cash_interest: 0 },
  });
  assert.equal(status, 200);
  assert.match(body.error, /denominator must be greater than zero/);
  assert.equal(client.inserts.length, 0);
});

// --------------------------------------------------- malformed input is a 400 naming the field

async function assert400(body, field) {
  const { status, body: out, client } = await call(body);
  assert.equal(status, 400);
  assert.match(out.error, new RegExp(field.replace(/[.[\]]/g, "\\$&")));
  assert.equal(client.inserts.length, 0, "a rejected request must not log a calculation");
}

test("400 names the field: body, terms, financials", async () => {
  for (const bad of [null, "text", 42, [], undefined]) await assert400(bad, "request body");
  await assert400({ financials: FINANCIALS }, "terms");
  await assert400({ terms: [], financials: FINANCIALS }, "terms");
  await assert400({ terms: "x", financials: FINANCIALS }, "terms");
  await assert400({ terms: TERMS }, "financials");
  await assert400({ terms: TERMS, financials: [] }, "financials");
});

test("400 when add-backs is not an array: the calculator would silently read it as 'no add-backs'", async () => {
  // Proves the hazard is real, then that the wrapper stops it before it can mislead.
  const terms = clone(F1.terms_versions[1].terms); // v2: one capped add-back
  const asObject = { ...terms, numerator: { ...terms.numerator, addbacks: { name: "restructuring charges", cap: 500000 } } };
  const silent = computeDscr(asObject, FINANCIALS, { calcId: FIXED_ID });
  assert.equal(silent.dscr, 1.12, "the raw calculator ignores the malformed add-backs");
  await assert400({ terms: asObject, financials: FINANCIALS }, "terms.numerator.addbacks");
});

test("400 when numerator, add-backs or deductions are OMITTED: the calculator would read them as empty and return a wrong ratio with a calc_id", async () => {
  // Prove the hazard: omit `deductions` and the raw calculator happily skips capex and cash taxes.
  const noDeductions = clone(TERMS);
  delete noDeductions.numerator.deductions;
  const raw = computeDscr(noDeductions, FINANCIALS, { calcId: FIXED_ID });
  assert.equal(raw.dscr, 1.3, "the raw calculator returns a confident, wrong figure");
  assert.notEqual(raw.dscr, 1.12);

  await assert400({ terms: noDeductions, financials: FINANCIALS }, "terms.numerator.deductions");

  const noAddbacks = clone(TERMS);
  delete noAddbacks.numerator.addbacks;
  await assert400({ terms: noAddbacks, financials: FINANCIALS }, "terms.numerator.addbacks");

  const noNumerator = clone(TERMS);
  delete noNumerator.numerator;
  await assert400({ terms: noNumerator, financials: FINANCIALS }, "terms.numerator");

  for (const empty of [null, undefined]) {
    const t = clone(TERMS);
    t.numerator.deductions = empty;
    await assert400({ terms: t, financials: FINANCIALS }, "terms.numerator.deductions");
  }
});

test("an EXPLICIT empty add-backs list is how 'no add-backs' is stated, and it is accepted", async () => {
  const terms = clone(TERMS);
  terms.numerator.addbacks = [];
  const { status, body } = await call({ terms, financials: FINANCIALS });
  assert.equal(status, 200);
  assert.equal(body.dscr, 1.12);
});

test("400 when deductions or denominator components are not arrays", async () => {
  const t1 = clone(TERMS);
  t1.numerator.deductions = "unfinanced_capex";
  await assert400({ terms: t1, financials: FINANCIALS }, "terms.numerator.deductions");
  const t2 = clone(TERMS);
  t2.denominator.components = "cash_interest";
  await assert400({ terms: t2, financials: FINANCIALS }, "terms.denominator.components");
});

test("400 when threshold is malformed", async () => {
  const t1 = clone(TERMS);
  t1.threshold = 1.25;
  await assert400({ terms: t1, financials: FINANCIALS }, "terms.threshold");
  const t2 = clone(TERMS);
  t2.threshold.min_dscr = "1.25";
  await assert400({ terms: t2, financials: FINANCIALS }, "terms.threshold.min_dscr");
});

test("400 when a figure is present but not a number: no coercion of \"4,020,000\" or \"4020000\"", async () => {
  for (const value of ["4,020,000", "4020000", true, {}, []]) {
    await assert400({ terms: TERMS, financials: { ...FINANCIALS, ebitda: value } }, "financials.ebitda");
  }
  await assert400({ terms: TERMS, financials: { ...FINANCIALS, cash_taxes: "250000" } }, "financials.cash_taxes");
});

test("400 when an add-back amount is not a number, naming the add-back", async () => {
  const financials = { ...FINANCIALS, addback_amounts: { "restructuring charges": "620000" } };
  await assert400({ terms: TERMS, financials }, 'financials.addback_amounts["restructuring charges"]');
  await assert400({ terms: TERMS, financials: { ...FINANCIALS, addback_amounts: [620000] } }, "financials.addback_amounts");
});

test("400 when casefile_id is not a UUID", async () => {
  await assert400({ terms: TERMS, financials: FINANCIALS, casefile_id: "casefile-1" }, "casefile_id");
  await assert400({ terms: TERMS, financials: FINANCIALS, casefile_id: 7 }, "casefile_id");
});

// --------------------------------------------------- logging failures never leak an unlogged number

test("a casefile_id that names no casefile is a 400, and no number is returned", async () => {
  const client = fakeClient({ insertError: { code: "23503", message: "violates foreign key constraint" } });
  const { status, body } = await call({ terms: TERMS, financials: FINANCIALS, casefile_id: CASEFILE_ID }, { client });
  assert.equal(status, 400);
  assert.match(body.error, /casefile_id/);
  assert.ok(!("dscr" in body) && !("calc_id" in body));
});

test("any other logging failure is a 500 and returns NO number: a figure nothing can vouch for must not escape", async () => {
  const client = fakeClient({ insertError: { code: "XX000", message: "connection reset" } });
  const { status, body } = await call({ terms: TERMS, financials: FINANCIALS }, { client });
  assert.equal(status, 500);
  assert.ok(!("dscr" in body) && !("calc_id" in body));
  assert.ok(!JSON.stringify(body).includes("connection reset"), "internal detail must not reach the agent");
});
