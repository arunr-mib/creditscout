import { test } from "node:test";
import assert from "node:assert/strict";

import { FACILITIES } from "../../data/facilities.js";
import { resolveCitation } from "../chunk.ts";
import { readReportedDscr } from "./certificate.ts";
import {
  INPUT_LABELS,
  isQuarterEnd,
  normaliseLabel,
  parseAmount,
  quarterLabel,
  readLabeledFigures,
} from "./extract-financials.ts";
import { FACILITY_UUID, fakeSearch, hitsFor } from "./run.fixtures.js";

// No network and no database: the search is a fake over the generated documents.

const INPUT_NAMES = Object.keys(INPUT_LABELS);

// ------------------------------------------------------------------ parsing

test("parseAmount reads plain numbers and refuses everything else", () => {
  assert.equal(parseAmount("4,020,000"), 4020000);
  assert.equal(parseAmount("620000"), 620000);
  assert.equal(parseAmount("-120,000"), -120000);
  assert.equal(parseAmount("1,250.50"), 1250.5);
  for (const bad of ["", "n/a", "$4,020,000", "(120,000)", "4M", "4,02,000", "1,2345", "4.0.1", "4 020 000"]) {
    assert.equal(parseAmount(bad), null, `"${bad}" must not be guessed at`);
  }
});

test("periods: the label matches the document titles, and only quarter ends are tested", () => {
  assert.equal(quarterLabel("2026-06-30"), "Q2 2026");
  assert.equal(quarterLabel("2025-12-31"), "Q4 2025");
  for (const d of ["2026-03-31", "2026-06-30", "2026-09-30", "2026-12-31"]) assert.ok(isQuarterEnd(d), d);
  for (const d of ["2026-05-15", "2026-06-29", "2026-07-01"]) assert.ok(!isQuarterEnd(d), d);
});

// -------------------------------------------------- reading the real documents

test("every quarter of every facility reads back exactly the locked figures, each with a citation and a quote", async () => {
  for (const f of FACILITIES) {
    const search = fakeSearch(hitsFor(f.id));
    for (const q of f.quarters) {
      const read = await readLabeledFigures(FACILITY_UUID[f.id], q.period_end, { search });
      assert.deepEqual(read.problems, [], `${f.id} ${q.period_end}`);
      for (const name of INPUT_NAMES) {
        const fig = read.inputs[name];
        assert.equal(fig.value, q.financials[name], `${f.id} ${q.period_end} ${name}`);
        assert.ok(fig.quote.startsWith(`${INPUT_LABELS[name]}:`), fig.quote);
        // The existing citation vocabulary, and it resolves back to this very document and section.
        assert.match(fig.citation, /^Fin Q[1-4] \d{4} §1$/);
        assert.deepEqual(resolveCitation(fig.citation), {
          doc_type: "financials",
          doc_title: `Financials — ${quarterLabel(q.period_end)}`,
          section: "§1",
        });
      }
      for (const [name, amount] of Object.entries(q.financials.addback_amounts)) {
        const fig = read.addbacks[normaliseLabel(name)];
        assert.equal(fig.value, amount, `${f.id} ${q.period_end} add-back ${name}`);
        assert.match(fig.citation, /^Fin Q[1-4] \d{4} §2$/);
      }
      assert.equal(Object.keys(read.addbacks).length, Object.keys(q.financials.addback_amounts).length);
    }
  }
});

test("the search is scoped to the facility and to financials, and the period picks the document", async () => {
  const search = fakeSearch(hitsFor("F5"));
  const q1 = await readLabeledFigures(FACILITY_UUID.F5, "2026-03-31", { search });
  assert.equal(search.calls.length, 1);
  assert.equal(search.calls[0].facilityId, FACILITY_UUID.F5);
  assert.deepEqual(search.calls[0].docTypes, ["financials"]);
  assert.equal(q1.documentTitle, "Financials — Q1 2026");
  assert.equal(q1.inputs.ebitda.value, 6028000); // not Q2's 5,313,000
  assert.deepEqual(Object.keys(q1.addbacks), ["dry-dock and vessel overhaul charges"]);
});

// ------------------------------------------- what is not readable is never zero

test("a period with no financials document reports every input as a problem and returns no figure", async () => {
  const read = await readLabeledFigures(FACILITY_UUID.F1, "2026-03-31", { search: fakeSearch(hitsFor("F1")) });
  assert.deepEqual(read.inputs, {});
  assert.deepEqual(read.addbacks, {});
  assert.deepEqual(read.problems.map((p) => p.field).sort(), [...INPUT_NAMES].sort());
  assert.match(read.problems[0].reason, /no "Financials — Q1 2026" document on file/);
});

test("an absent label is a problem, and the figure is left out rather than zeroed", async () => {
  const hits = hitsFor("F1", { mutate: (t) => t.replace(/^Cash Taxes Paid:.*\n/m, "") });
  const read = await readLabeledFigures(FACILITY_UUID.F1, "2026-06-30", { search: fakeSearch(hits) });
  assert.ok(!("cash_taxes" in read.inputs));
  assert.equal(read.inputs.ebitda.value, 4020000);
  assert.deepEqual(read.problems, [{ field: "cash_taxes", reason: 'not found in Financials — Q2 2026' }]);
});

test("a label that appears twice with different values is ambiguous: neither is chosen", async () => {
  const hits = hitsFor("F1", {
    mutate: (t, d) => (d.doc_type === "financials" ? t.replace("Cash Taxes Paid: 250,000", "Cash Taxes Paid: 250,000\nCash Taxes Paid: 255,000") : t),
  });
  const read = await readLabeledFigures(FACILITY_UUID.F1, "2026-06-30", { search: fakeSearch(hits) });
  assert.ok(!("cash_taxes" in read.inputs));
  assert.match(read.problems.find((p) => p.field === "cash_taxes").reason, /ambiguous/);
});

test("the same document ingested twice is not ambiguous", async () => {
  const once = hitsFor("F1");
  const twice = [...once, ...once];
  const read = await readLabeledFigures(FACILITY_UUID.F1, "2026-06-30", { search: fakeSearch(twice) });
  assert.deepEqual(read.problems, []);
  assert.equal(read.inputs.cash_taxes.value, 250000);
});

test("a value that is not a plain number is a problem, not a guess", async () => {
  const hits = hitsFor("F3", { mutate: (t) => t.replace("Cash Interest Paid: 700,000", "Cash Interest Paid: n/a") });
  const read = await readLabeledFigures(FACILITY_UUID.F3, "2026-06-30", { search: fakeSearch(hits) });
  assert.ok(!("cash_interest" in read.inputs));
  assert.match(read.problems[0].reason, /"n\/a" is not a plain number/);
});

test("labels match regardless of case and spacing", async () => {
  const hits = hitsFor("F1", { mutate: (t) => t.replace("Consolidated EBITDA:", "consolidated  ebitda:") });
  const read = await readLabeledFigures(FACILITY_UUID.F1, "2026-06-30", { search: fakeSearch(hits) });
  assert.equal(read.inputs.ebitda.value, 4020000);
});

test("a labeled line outside the add-back section is not an add-back", async () => {
  // "Period ended: June 30, 2026" is a labeled line in the preamble; it must never surface as a figure.
  const read = await readLabeledFigures(FACILITY_UUID.F1, "2026-06-30", { search: fakeSearch(hitsFor("F1")) });
  assert.deepEqual(Object.keys(read.addbacks), ["restructuring charges"]);
});

// ---------------------------------------------------------------- certificate

test("the reported DSCR is read from every certificate, with its citation", async () => {
  for (const f of FACILITIES) {
    const search = fakeSearch(hitsFor(f.id));
    for (const q of f.quarters) {
      const fig = await readReportedDscr(FACILITY_UUID[f.id], q.period_end, { search });
      assert.equal(fig.value, q.reported_dscr, `${f.id} ${q.period_end}`);
      assert.match(fig.citation, /^CC Q[1-4] \d{4} §2$/);
      assert.match(fig.quote, /^Reported Debt Service Coverage Ratio: \d\.\d\d to 1\.00\.$/);
      assert.deepEqual(search.calls.at(-1).docTypes, ["compliance_certificate"]);
    }
  }
});

test("no certificate for the period, or no figure on it, is null rather than an error", async () => {
  const search = fakeSearch(hitsFor("F1"));
  assert.equal(await readReportedDscr(FACILITY_UUID.F1, "2026-03-31", { search }), null);
  const stripped = fakeSearch(hitsFor("F1", { mutate: (t) => t.replace(/^Reported Debt Service Coverage Ratio:.*\n/m, "") }));
  assert.equal(await readReportedDscr(FACILITY_UUID.F1, "2026-06-30", { search: stripped }), null);
});

test("a certificate that states two different figures, or an unreadable one, yields no figure", async () => {
  const two = hitsFor("F1", {
    mutate: (t) => t.replace("Reported Debt Service Coverage Ratio: 1.12 to 1.00.", "Reported Debt Service Coverage Ratio: 1.12 to 1.00.\nReported Debt Service Coverage Ratio: 1.40 to 1.00."),
  });
  assert.equal(await readReportedDscr(FACILITY_UUID.F1, "2026-06-30", { search: fakeSearch(two) }), null);
  const junk = hitsFor("F1", { mutate: (t) => t.replace("1.12 to 1.00.", "approximately 1.1") });
  assert.equal(await readReportedDscr(FACILITY_UUID.F1, "2026-06-30", { search: fakeSearch(junk) }), null);
});
