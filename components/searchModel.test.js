import { test } from "node:test";
import assert from "node:assert/strict";

import { filterSearch } from "./searchModel.ts";

const ITEMS = [
  { kind: "borrower", label: "Harbor Logistics", sublabel: "Freight and logistics", href: "/" },
  { kind: "borrower", label: "Coastal Marine", sublabel: "Marine services", href: "/" },
  { kind: "case", label: "Northgate Foods — Q2 2026", sublabel: "recommends escalate", href: "/casefiles/abc" },
  { kind: "document", label: "Amendment No. 2", sublabel: "Harbor Logistics · amendment", href: "/documents" },
];

test("an empty query returns the list (capped)", () => {
  assert.equal(filterSearch(ITEMS, "").length, ITEMS.length);
  assert.equal(filterSearch(ITEMS, "   ", 2).length, 2);
});

test("every term must match (AND), across label or sublabel", () => {
  assert.deepEqual(filterSearch(ITEMS, "harbor").map((i) => i.label), ["Harbor Logistics", "Amendment No. 2"]);
  // "harbor amendment": only the document matches both terms.
  assert.deepEqual(filterSearch(ITEMS, "harbor amendment").map((i) => i.label), ["Amendment No. 2"]);
});

test("a label match outranks a sublabel-only match", () => {
  // "marine" is in Coastal Marine's label and nowhere else.
  const r = filterSearch(ITEMS, "marine");
  assert.equal(r[0].label, "Coastal Marine");
});

test("a case is findable by borrower and period", () => {
  assert.deepEqual(filterSearch(ITEMS, "northgate q2").map((i) => i.kind), ["case"]);
});

test("no match returns empty", () => {
  assert.deepEqual(filterSearch(ITEMS, "zzzzz"), []);
});
