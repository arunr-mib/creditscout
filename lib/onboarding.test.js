import { test } from "node:test";
import assert from "node:assert/strict";
import { validateNewLoan, onboardingStep } from "./onboarding.ts";

test("validateNewLoan trims and accepts a real borrower name", () => {
  const r = validateNewLoan({ borrower_name: "  Summit Freight  ", industry: "Logistics" });
  assert.deepEqual(r, { ok: true, value: { borrower_name: "Summit Freight", industry: "Logistics" } });
});

test("validateNewLoan rejects a blank or whitespace name, with no value", () => {
  for (const name of ["", "   ", undefined, 42]) {
    const r = validateNewLoan({ borrower_name: name });
    assert.equal(r.ok, false);
    assert.match(r.error, /borrower name/i);
  }
});

test("validateNewLoan treats a blank industry as null, never empty string", () => {
  assert.deepEqual(validateNewLoan({ borrower_name: "X", industry: "   " }), { ok: true, value: { borrower_name: "X", industry: null } });
});

test("onboardingStep: no agreement yet -> documents", () => {
  assert.equal(onboardingStep({ documents: [], terms: [] }), "documents");
  assert.equal(onboardingStep({ documents: [{ doc_type: "financials" }], terms: [] }), "documents");
});

test("onboardingStep: agreement present, not yet approved -> terms", () => {
  assert.equal(onboardingStep({ documents: [{ doc_type: "agreement" }], terms: [] }), "terms");
  assert.equal(onboardingStep({ documents: [{ doc_type: "agreement" }], terms: [{ status: "proposed" }] }), "terms");
});

test("onboardingStep: an approved terms row -> done (never re-propose)", () => {
  assert.equal(onboardingStep({ documents: [{ doc_type: "agreement" }], terms: [{ status: "superseded" }, { status: "approved" }] }), "done");
});
