import { test } from "node:test";
import assert from "node:assert/strict";

import { filterByLoan, loanParam } from "./loanFilter.ts";

const items = [
  { facility_id: "F1", title: "a" },
  { facility_id: "F5", title: "b" },
  { facility_id: "F5", title: "c" },
];

test("filterByLoan returns every item when no loan is selected", () => {
  assert.deepEqual(filterByLoan(items, null), items);
  assert.deepEqual(filterByLoan(items, undefined), items);
  assert.deepEqual(filterByLoan(items, ""), items);
});

test("filterByLoan keeps only the selected loan's items", () => {
  assert.deepEqual(filterByLoan(items, "F5").map((i) => i.title), ["b", "c"]);
});

test("filterByLoan returns nothing for an unknown loan id", () => {
  assert.deepEqual(filterByLoan(items, "F99"), []);
});

test("loanParam reads a single value, the first of many, or null", () => {
  assert.equal(loanParam({ loan: "F5" }), "F5");
  assert.equal(loanParam({ loan: ["F5", "F7"] }), "F5");
  assert.equal(loanParam({}), null);
  assert.equal(loanParam({ loan: "" }), null);
  assert.equal(loanParam({ loan: [] }), null);
});
