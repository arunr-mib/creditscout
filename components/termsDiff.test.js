import { test } from "node:test";
import assert from "node:assert/strict";

import { changeSummary, changedOnly, termsDiff } from "./termsDiff.ts";

const v1 = {
  threshold: { min_dscr: 1.25 },
  test_period: { basis: "TTM" },
  numerator: { base: "Consolidated EBITDA", deductions: ["unfinanced_capex"], addbacks: [{ name: "fuel hedging mark-to-market losses", cap: 800000 }] },
  denominator: { components: ["scheduled_principal", "cash_interest"] },
  effective_amendments: [],
};

const v2 = {
  ...v1,
  numerator: {
    ...v1.numerator,
    addbacks: [
      { name: "dry-dock and vessel overhaul charges", cap: 500000 },
      { name: "fuel hedging mark-to-market losses", cap: 800000 },
    ],
  },
  effective_amendments: [{ doc: "Amendment No. 2", effective: "2026-04-01" }],
};

test("termsDiff: an add-back inserted first is ONE addition, not four changes", () => {
  // THE BUG A POSITIONAL DIFF WOULD HAVE: inserting at index 0 shifts every
  // later add-back, so each would read as a value that changed. Aligned by
  // name, the unchanged one stays unchanged.
  const changed = changedOnly(termsDiff(v1, v2));
  const labels = changed.map((c) => `${c.kind}:${c.label}`);
  assert.deepEqual(labels, [
    "added:Add-back cap · dry-dock and vessel overhaul charges",
    "added:Amendment applied · Amendment No. 2",
  ]);
});

test("termsDiff: an uncapped add-back reads as uncapped, never as zero", () => {
  // The documented trap: no `cap`, or `cap: null`, means UNCAPPED. A diff that
  // printed 0 would show a correct proposal as a tightening.
  const uncapped = { ...v1, numerator: { ...v1.numerator, addbacks: [{ name: "fuel hedging mark-to-market losses", cap: null }] } };
  const row = termsDiff(v1, uncapped).find((r) => r.label.startsWith("Add-back cap"));
  assert.equal(row.approved, "800,000");
  assert.equal(row.proposed, "uncapped (no limit)");
  assert.equal(row.kind, "changed");
});

test("termsDiff: the minimum is compared, not assumed", () => {
  const tighter = { ...v1, threshold: { min_dscr: 1.4 } };
  const row = termsDiff(v1, tighter)[0];
  assert.deepEqual([row.label, row.approved, row.proposed, row.kind], ["Minimum DSCR", "1.25", "1.4", "changed"]);
});

test("termsDiff: a dropped add-back is a removal, not a value going missing", () => {
  const row = termsDiff(v2, v1).find((r) => r.label.includes("dry-dock"));
  assert.equal(row.kind, "removed");
  assert.equal(row.proposed, null);
});

test("changeSummary: no approved version is not the same as no changes", () => {
  // Opposite situations. Reading one as the other would let a FIRST approval
  // through the screen as though it changed nothing.
  assert.match(changeSummary(null, termsDiff(null, v2)), /No approved version exists yet/);
  assert.match(changeSummary(v1, termsDiff(v1, v1)), /No term differs/);
  assert.match(changeSummary(v1, termsDiff(v1, v2)), /^2 terms differ/);
});

test("termsDiff: a change carries the field whose citation supports it", () => {
  const row = termsDiff(v1, v2).find((r) => r.label.includes("dry-dock"));
  assert.equal(row.citeField, "numerator.addbacks[0].cap", "so the source link opens the right clause");
});
