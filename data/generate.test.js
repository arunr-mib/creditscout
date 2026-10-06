import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyTermsProvenance } from "../guardrails/guardrail.js";
import { FACILITIES, MARKER, termsFor } from "./facilities.js";
import { CSV_COLUMNS, generate, renderAll, renderCsv, renderDocument } from "./generate.mjs";

const DATA_DIR = fileURLToPath(new URL("./", import.meta.url));

const byId = (id) => FACILITIES.find((f) => f.id === id);
const docText = (f, file) => renderDocument(f, f.documents.find((d) => d.file === file));
const lines = (text) => text.split("\n");

/** Stand-in for the stage-4 chunker: the text under one section heading. */
function sectionText(text, citation) {
  const num = citation.match(/§(\d+(?:\.\d+)?)/)[1];
  const all = lines(text);
  const start = all.findIndex((l) => l.startsWith(`§${num} `));
  assert.notEqual(start, -1, `no heading §${num} for citation "${citation}"`);
  let end = all.findIndex((l, i) => i > start && /^(§\d|ARTICLE )/.test(l));
  if (end === -1) end = all.length;
  return all.slice(start, end).join("\n");
}

// ------------------------------------------------------------------ marker

test("every document starts with the literal synthetic marker on line 1", () => {
  assert.equal(MARKER, "SYNTHETIC — FOR DEMONSTRATION");
  const docs = renderAll();
  assert.equal(docs.length, 16);
  for (const d of docs) assert.equal(lines(d.text)[0], MARKER, `${d.facility}/${d.file}`);
});

test("the generator throws rather than render a document type it does not know", () => {
  assert.throws(
    () => renderDocument(FACILITIES[0], { doc_type: "mystery", file: "x.txt" }),
    /cannot render doc_type mystery/,
  );
});

// -------------------------------------------------------- structure and facts

test("the agreement has the article and §-section structure the stage-4 chunker splits on", () => {
  for (const f of FACILITIES) {
    const l = lines(docText(f, "agreement.txt"));
    for (const heading of [
      "ARTICLE I — DEFINITIONS",
      "§1.01 Defined Terms.",
      "ARTICLE VII — FINANCIAL COVENANTS",
      "§7.11 Debt Service Coverage Ratio.",
      "ARTICLE VIII — EVENTS OF DEFAULT",
      "§8.01 Events of Default.",
      "ARTICLE IX — MISCELLANEOUS",
      "§9.01 Notices.",
    ]) {
      assert.ok(l.includes(heading), `${f.id} agreement missing "${heading}"`);
    }
  }
});

test("each agreement states the 1.25 threshold under §7.11; only F5's lists a cap there", () => {
  for (const f of FACILITIES) {
    const s711 = sectionText(docText(f, "agreement.txt"), "CA §7.11");
    assert.match(s711, /to be less than 1\.25 to 1\.00\./);
  }
  assert.match(sectionText(docText(byId("F5"), "agreement.txt"), "CA §7.11(b)(i)"), /not to exceed \$500,000 for any test period/);
  assert.doesNotMatch(docText(byId("F1"), "agreement.txt"), /restructuring/i);
  assert.doesNotMatch(docText(byId("F3"), "agreement.txt"), /owner compensation/i);
});

test("F5's cap is in the original agreement; its amendment adds only the second add-back", () => {
  const f = byId("F5");
  assert.doesNotMatch(docText(f, "amendment-no-2.txt"), /dry-dock/);
  assert.match(docText(f, "amendment-no-2.txt"), /fuel hedging mark-to-market losses.*\$800,000/);
});

test("F1's amendment states its effective date, what it amends, the new add-back and cap, and what survives", () => {
  const t = docText(byId("F1"), "amendment-no-2.txt");
  assert.match(t, /This Amendment No\. 2 is effective as of April 1, 2026 and amends the Credit Agreement dated as of March 15, 2024/);
  assert.match(t, /restructuring charges.*\$500,000/);
  assert.match(t, /every term of the Credit Agreement remains in full force and effect/);
});

test("financials print each of the six calculator inputs and each add-back as its own labeled line", () => {
  const l = lines(docText(byId("F1"), "financials-2026-06-30.txt"));
  for (const expected of [
    "Consolidated EBITDA: 4,020,000",
    "Unfinanced Capital Expenditures: 300,000",
    "Cash Taxes Paid: 250,000",
    "Scheduled Principal Payments: 2,000,000",
    "Cash Interest Paid: 1,100,000",
    "Restructuring charges: 620,000",
  ]) {
    assert.ok(l.includes(expected), `missing line "${expected}"`);
  }
  // Every facility, every quarter: all inputs present with thousands separators.
  for (const f of FACILITIES) {
    for (const q of f.quarters) {
      const t = lines(docText(f, `financials-${q.period_end}.txt`));
      const fin = q.financials;
      const sep = (n) => n.toLocaleString("en-US");
      for (const [label, value] of [
        ["Consolidated EBITDA", fin.ebitda],
        ["Unfinanced Capital Expenditures", fin.unfinanced_capex],
        ["Cash Taxes Paid", fin.cash_taxes],
        ["Scheduled Principal Payments", fin.scheduled_principal],
        ["Cash Interest Paid", fin.cash_interest],
      ]) {
        assert.ok(t.includes(`${label}: ${sep(value)}`), `${f.id} ${q.period_end} "${label}"`);
      }
      for (const [name, amount] of Object.entries(fin.addback_amounts)) {
        assert.ok(
          t.includes(`${name.charAt(0).toUpperCase()}${name.slice(1)}: ${sep(amount)}`),
          `${f.id} ${q.period_end} add-back "${name}"`,
        );
      }
    }
  }
});

test("F3's 530,000 sits in the financials as its own line, and the agreement and waiver letter know nothing of it", () => {
  const f = byId("F3");
  assert.ok(lines(docText(f, "financials-2026-06-30.txt")).includes("Owner compensation normalisation: 530,000"));
  assert.doesNotMatch(docText(f, "agreement.txt"), /normalisation|530,000/);
  assert.doesNotMatch(docText(f, "waiver-request-letter.txt"), /normalisation|530,000/);
});

test("F3's certificate reads as a confident clean pass at 1.31", () => {
  const t = docText(byId("F3"), "compliance-certificate-2026-06-30.txt");
  assert.match(t, /Reported Debt Service Coverage Ratio: 1\.31 to 1\.00\./);
  assert.match(t, /Required Debt Service Coverage Ratio under Section 7\.11: not less than 1\.25 to 1\.00\./);
  assert.match(t, /Compliance status: IN COMPLIANCE/);
  assert.match(t, /Add-back applied — owner compensation normalisation: 530,000/);
  assert.match(t, /test period ended June 30, 2026/);
});

test("certificates report each borrower's own figure and add-backs", () => {
  const f1 = docText(byId("F1"), "compliance-certificate-2026-06-30.txt");
  assert.match(f1, /Reported Debt Service Coverage Ratio: 1\.12 to 1\.00\./);
  assert.match(f1, /NOT IN COMPLIANCE/);
  assert.match(f1, /No add-back was applied/);

  const f5q1 = docText(byId("F5"), "compliance-certificate-2026-03-31.txt");
  assert.match(f5q1, /Reported Debt Service Coverage Ratio: 1\.38 to 1\.00\./);
  assert.match(f5q1, /Add-back applied — dry-dock and vessel overhaul charges: 900,000/);

  const f5q2 = docText(byId("F5"), "compliance-certificate-2026-06-30.txt");
  assert.match(f5q2, /fuel hedging mark-to-market losses: 800,000/);
});

test("F3's waiver letter is an unmistakable request: dated 2026-08-12, un-countersigned by the lender", () => {
  const t = docText(byId("F3"), "waiver-request-letter.txt");
  const l = lines(t);
  assert.ok(l.includes("August 12, 2026"));
  assert.match(t, /respectfully requests that the Lender waive compliance with Section 7\.11/);
  assert.match(t, /test period ended June 30, 2026/);
  assert.match(t, /This letter is a request only/);

  const ack = l.indexOf("ACKNOWLEDGED AND AGREED:");
  assert.notEqual(ack, -1);
  const lenderBlock = l.slice(ack).join("\n");
  assert.match(lenderBlock, /By: _{10,}/);
  assert.match(lenderBlock, /Name: _{10,}/);
  assert.match(lenderBlock, /Date: _{10,}/);
  assert.doesNotMatch(lenderBlock, /\/s\//, "no lender signature anywhere");
});

// -------------------------------------------------------------- provenance

test("every source_citations quote appears verbatim under the section its citation names", () => {
  for (const f of FACILITIES) {
    for (const v of f.terms_versions) {
      for (const c of v.source_citations) {
        const section = sectionText(docText(f, c.file), c.citation);
        assert.ok(section.includes(c.quote), `${f.id} v${v.version} ${c.field}: quote not under ${c.citation} in ${c.file}`);
      }
    }
  }
});

test("verifyTermsProvenance accepts every terms version against its generated documents", () => {
  for (const f of FACILITIES) {
    for (const v of f.terms_versions) {
      const chunks = v.source_citations.map((c) => ({
        citation: c.citation,
        content: sectionText(docText(f, c.file), c.citation),
      }));
      const r = verifyTermsProvenance(termsFor(v, f.quarters[0]), v.source_citations, chunks);
      assert.deepEqual(r.violations, [], `${f.id} v${v.version}`);
      assert.equal(r.valid, true);
    }
  }
});

test("provenance would fail if a cap were cited to a document that does not contain it", () => {
  // F1's cap is in Amendment No. 2 only. Pointing the same quote at the agreement must not verify.
  const f = byId("F1");
  const v2 = f.terms_versions[1];
  const cap = v2.source_citations.find((c) => c.field === "numerator.addbacks[0].cap");
  const wrongChunk = [{ citation: cap.citation, content: sectionText(docText(f, "agreement.txt"), "CA §7.11") }];
  const r = verifyTermsProvenance(termsFor(v2, f.quarters[0]), v2.source_citations, wrongChunk);
  assert.equal(r.valid, false);
  assert.ok(r.violations.some((x) => x.field === "numerator.addbacks[0].cap"));
});

// --------------------------------------------------------------------- CSV

function parseCsv(text) {
  const rows = [];
  for (const raw of text.trim().split("\n")) {
    const cells = [];
    let cur = "";
    let quoted = false;
    for (const ch of raw) {
      if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) {
        cells.push(cur);
        cur = "";
      } else cur += ch;
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

test("CSV has the specified columns and one row per quarterly test, in order", () => {
  const [header, ...rows] = parseCsv(renderCsv());
  assert.deepEqual(header, CSV_COLUMNS);
  assert.deepEqual(header, [
    "case_id", "facility", "borrower", "test_period_end", "threshold", "terms_version_boarded",
    "ebitda", "addbacks", "unfinanced_capex", "cash_taxes", "scheduled_principal", "cash_interest",
    "reported_dscr", "expected_dscr_as_tested", "expected_dscr_remapped",
    "expected_outcome", "expected_tag", "owner_signed_off",
  ]);
  assert.deepEqual(rows.map((r) => [r[1], r[3]]), [
    ["F1", "2026-06-30"],
    ["F3", "2026-06-30"],
    ["F5", "2025-12-31"],
    ["F5", "2026-03-31"],
    ["F5", "2026-06-30"],
  ]);
  for (const r of rows) assert.equal(r.length, header.length);
});

test("CSV leaves the owner's columns empty or n/a and signs nothing off", () => {
  const [header, ...rows] = parseCsv(renderCsv());
  const col = (name) => header.indexOf(name);
  for (const r of rows) {
    assert.equal(r[col("expected_dscr_as_tested")], "");
    assert.equal(r[col("owner_signed_off")], "NO");
  }
  // Empty where an unboarded amendment is in force (owner computes it); n/a elsewhere.
  assert.deepEqual(rows.map((r) => r[col("expected_dscr_remapped")]), ["", "n/a", "n/a", "n/a", ""]);
});

test("CSV carries the inputs, outcomes and tags from the fixture", () => {
  const [header, ...rows] = parseCsv(renderCsv());
  const col = (name) => header.indexOf(name);
  assert.deepEqual(rows.map((r) => r[col("expected_outcome")]), [
    "resolve",
    "escalate",
    "compliant_no_action",
    "variance_logged_no_investigation",
    "resolve",
  ]);
  assert.deepEqual(rows.map((r) => r[col("expected_tag")]), [
    "amendment_addback", "true_breach", "n/a", "n/a", "amendment_addback",
  ]);
  assert.deepEqual(rows.map((r) => r[col("reported_dscr")]), ["1.12", "1.31", "1.41", "1.38", "1.30"]);
  assert.deepEqual(rows.map((r) => r[col("ebitda")]), ["4020000", "2884000", "6720000", "6028000", "5313000"]);
  assert.deepEqual(rows.map((r) => r[col("terms_version_boarded")]), ["1", "1", "1", "1", "1"]);
});

test("CSV addbacks column shows what binds, and which cap exists only in an unboarded version", () => {
  const [header, ...rows] = parseCsv(renderCsv());
  const addbacks = rows.map((r) => r[header.indexOf("addbacks")]);
  assert.equal(addbacks[0], "restructuring charges=620000 (cap 500000 under unboarded v2 only)");
  assert.equal(addbacks[1], "owner compensation normalisation=530000 (no clause permits this)");
  assert.equal(addbacks[2], "dry-dock and vessel overhaul charges=300000 (cap 500000)");
  assert.equal(addbacks[3], "dry-dock and vessel overhaul charges=900000 (cap 500000)");
  assert.equal(
    addbacks[4],
    "dry-dock and vessel overhaul charges=520000 (cap 500000); fuel hedging mark-to-market losses=950000 (cap 800000 under unboarded v2 only)",
  );
});

test("CSV contains no DSCR this code computed: the only ratios in a row are the threshold and the borrower's reported figure", () => {
  const text = renderCsv();
  const [header, ...rows] = parseCsv(text);
  for (const r of rows) {
    const ratios = r.map((c, i) => [header[i], c]).filter(([, c]) => /^\d+\.\d+$/.test(c));
    assert.deepEqual(ratios.map(([h]) => h), ["threshold", "reported_dscr"], `${r[0]}`);
  }
  // And no computed or remapped result appears in a row unless it happens to equal the reported figure.
  const flat = FACILITIES.flatMap((f) => f.quarters.map((q) => ({ f, q })));
  flat.forEach(({ q }, i) => {
    for (const v of [q.expected.computed_dscr, q.expected.remapped_dscr]) {
      if (v === null || v === q.reported_dscr) continue;
      assert.ok(!rows[i].includes(v.toFixed(2)), `row ${rows[i][0]} leaks ${v.toFixed(2)}`);
    }
  });
});

// --------------------------------------------------------- on disk / drift

test("generate() writes the file layout: 4 for F1, 4 for F3, 8 for F5, plus the CSV", () => {
  const dir = mkdtempSync(join(tmpdir(), "creditscout-gen-"));
  const r = generate({ outDir: join(dir, "facilities"), csvPath: join(dir, "template.csv") });
  assert.deepEqual(r, { documents: 16, facilities: 3, csvRows: 5 });
  for (const [id, n] of [["F1", 4], ["F3", 4], ["F5", 8]]) {
    assert.equal(readdirSync(join(dir, "facilities", id)).length, n, id);
  }
  assert.equal(readFileSync(join(dir, "template.csv"), "utf8"), renderCsv());
});

test("the committed documents and CSV are exactly what the generator produces from the fixture", () => {
  for (const d of renderAll()) {
    assert.equal(readFileSync(join(DATA_DIR, "facilities", d.facility, d.file), "utf8"), d.text, `${d.facility}/${d.file} is stale: run npm run generate:data`);
  }
  assert.equal(readFileSync(join(DATA_DIR, "expected-values-template.csv"), "utf8"), renderCsv());
});
