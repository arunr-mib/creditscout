import { test } from "node:test";
import assert from "node:assert/strict";

import { TERMS_STATUS_LABEL, longDate } from "./terms-labels.ts";

test("longDate renders the stored day, not the day before", () => {
  // The bug this guards: `new Date("2026-04-01")` is UTC midnight, so a
  // machine in a western timezone formats it as March 31.
  assert.equal(longDate("2026-04-01"), "Apr 1, 2026");
  assert.equal(longDate("2024-08-01"), "Aug 1, 2024");
  assert.equal(longDate("2026-01-01"), "Jan 1, 2026");
  assert.equal(longDate("2025-12-31"), "Dec 31, 2025");
});

test("a missing date is the em dash, never today and never a zero", () => {
  assert.equal(longDate(null), "—");
  assert.equal(longDate(undefined), "—");
  assert.equal(longDate(""), "—");
});

test("an unparseable value is returned untouched rather than guessed at", () => {
  assert.equal(longDate("not-a-date"), "not-a-date");
});

test("every stored status has an analyst-facing label", () => {
  for (const status of ["approved", "proposed", "superseded"]) {
    assert.ok(TERMS_STATUS_LABEL[status], `${status} needs a label`);
  }
  assert.equal(TERMS_STATUS_LABEL.proposed, "Pending approval", "'proposed' is our word; an analyst reads approval state");
});
