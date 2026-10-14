import { test } from "node:test";
import assert from "node:assert/strict";

import { DATE_LABEL, TERMS_STATUS_LABEL, countPendingUpdates, dateLabel, hasPendingUpdate, longDate, money, summariseTerms } from "./terms-labels.ts";

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

// ------------------------------------------- the terms themselves, readable

import { FACILITIES, termsFor } from "../data/facilities.js";

test("summariseTerms: reads the real seeded terms, not a hand-written fixture", () => {
  // The screen said everything ABOUT a version and nothing IN it.
  const f5 = FACILITIES.find((f) => f.id === "F5");
  const v1 = f5.terms_versions.find((v) => v.version === 1);
  const lines = summariseTerms(termsFor(v1, f5.quarters[0]));
  const by = (label) => lines.filter((l) => l.label === label);

  assert.equal(by("Minimum DSCR")[0].value, "1.25x");
  assert.equal(by("Minimum DSCR")[0].citation, "CA §7.11");
  assert.equal(by("Measurement basis")[0].value, "TTM");
  assert.match(by("Permitted add-back")[0].value, /dry-dock and vessel overhaul charges — capped at \$500,000/);
  assert.match(by("Debt service")[0].value, /scheduled principal, cash interest/);
});

test("summariseTerms: an add-back with no cap reads UNCAPPED, never blank", () => {
  // The documented trap: a missing `cap` means uncapped. Read as zero — or left
  // blank for a reader to assume — it flips a correct resolve into a false
  // escalation.
  const lines = summariseTerms({
    numerator: { addbacks: [{ name: "restructuring charges", cap: null, citation: "Amd 2 §3(a)" }] },
  });
  const a = lines.find((l) => l.label === "Permitted add-back");
  assert.equal(a.value, "restructuring charges — uncapped");
  assert.equal(a.citation, "Amd 2 §3(a)");

  const missing = summariseTerms({ numerator: { addbacks: [{ name: "x" }] } });
  assert.match(missing.find((l) => l.label === "Permitted add-back").value, /uncapped/);
});

test("summariseTerms: no add-backs is stated, not left to inference", () => {
  const lines = summariseTerms({ numerator: { addbacks: [], base: "Consolidated EBITDA" } });
  assert.equal(lines.find((l) => l.label === "Permitted add-backs").value, "None");
});

test("summariseTerms: a malformed or empty terms object yields nothing rather than 'undefined'", () => {
  assert.deepEqual(summariseTerms(null), []);
  assert.deepEqual(summariseTerms("not terms"), []);
  assert.deepEqual(summariseTerms([]), []);
  assert.deepEqual(summariseTerms({}), [{ label: "Permitted add-backs", value: "None", citation: null }]);
});

test("money formats a cap the way a credit document does", () => {
  assert.equal(money(500000), "$500,000");
  assert.equal(money(800000), "$800,000");
});

test("dateLabel: a document's date is named for what it IS, not 'effective' for everything", () => {
  // Every row said "Effective date". For a financial statement that column
  // holds the end of the period reported, which is a different fact.
  assert.equal(dateLabel("agreement"), "Effective date");
  assert.equal(dateLabel("amendment"), "Effective date");
  assert.equal(dateLabel("financials"), "Period ended");
  assert.equal(dateLabel("compliance_certificate"), "Reporting period");
  assert.equal(dateLabel("waiver"), "Dated");
});

test("dateLabel: an unknown document type gets a neutral label, never a wrong one", () => {
  assert.equal(dateLabel("something_new"), "Date");
  assert.equal(dateLabel(null), "Date");
});

test("every seeded document type has a date label", () => {
  for (const t of ["agreement", "amendment", "waiver", "financials", "compliance_certificate"]) {
    assert.notEqual(DATE_LABEL[t], undefined, t);
  }
});

test("hasPendingUpdate: a proposed version counts, not only an unboarded amendment", () => {
  // The chip said "Updates pending · 2" while three rows showed one. It counted
  // unboarded amendments; the rows ALSO showed proposed versions.
  assert.equal(hasPendingUpdate({ unboarded: [], versions: [{ status: "proposed" }, { status: "approved" }] }), true);
  assert.equal(hasPendingUpdate({ unboarded: ["Amendment No. 2"], versions: [{ status: "approved" }] }), true);
  assert.equal(hasPendingUpdate({ unboarded: [], versions: [{ status: "approved" }] }), false);
});

test("countPendingUpdates reconciles with what the rows show", () => {
  const cards = [
    { unboarded: ["Amendment No. 2"], versions: [{ status: "approved" }] },
    { unboarded: [], versions: [{ status: "proposed" }, { status: "approved" }] },
    { unboarded: [], versions: [{ status: "approved" }] },
  ];
  assert.equal(countPendingUpdates(cards), 2);
  assert.equal(cards.filter(hasPendingUpdate).length, countPendingUpdates(cards), "the count IS the filter");
});
