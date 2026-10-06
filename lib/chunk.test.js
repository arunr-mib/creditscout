import { test } from "node:test";
import assert from "node:assert/strict";

import { FACILITIES, MARKER } from "../data/facilities.js";
import { renderAll, renderDocument } from "../data/generate.mjs";
import { PREAMBLE_SECTION, chunkBySection, normaliseSection } from "./chunk.ts";

const META = { facility_id: "fac-1", document_id: "doc-1", doc_type: "agreement", doc_title: "Credit Agreement" };
const chunk = (text, meta = META) => chunkBySection(text, meta);
const flat = (s) => s.replace(/\s+/g, " ").trim();
const sections = (chunks) => chunks.map((c) => c.metadata.section);

const f1 = FACILITIES.find((f) => f.id === "F1");
const f1Agreement = renderDocument(f1, f1.documents.find((d) => d.doc_type === "agreement"));

// ------------------------------------------------------------ normaliseSection

test("normaliseSection reduces a citation to its section id", () => {
  assert.equal(normaliseSection("§7.11(b)(i)"), "§7.11");
  assert.equal(normaliseSection("CA §7.11(b)(i)"), "§7.11");
  assert.equal(normaliseSection("Amd 2 §3(a)"), "§3");
  assert.equal(normaliseSection("Section 7.11"), "§7.11");
  assert.equal(normaliseSection("Section 7.11(b) of the Credit Agreement"), "§7.11");
  assert.equal(normaliseSection("§ 1.01 Defined Terms."), "§1.01");
  assert.equal(normaliseSection("ARTICLE VII — FINANCIAL COVENANTS"), "ARTICLE VII");
  assert.equal(normaliseSection("Article IV"), "ARTICLE IV");
});

test("normaliseSection takes the first reference, and returns null for none", () => {
  assert.equal(normaliseSection("§3 Amendment to Section 7.11."), "§3");
  assert.equal(normaliseSection("Compliance status"), null);
  assert.equal(normaliseSection(""), null);
  assert.equal(normaliseSection("Article Civil"), null, "a word made of roman letters is not a numeral");
});

// -------------------------------------------------------------- the real corpus

test("the F1 agreement splits into one chunk per article and section, in order", () => {
  assert.deepEqual(sections(chunk(f1Agreement)), [
    PREAMBLE_SECTION,
    "ARTICLE I", "§1.01", "§1.02",
    "ARTICLE VI", "§6.01",
    "ARTICLE VII", "§7.10", "§7.11",
    "ARTICLE VIII", "§8.01", "§8.02",
    "ARTICLE IX", "§9.01", "§9.02",
  ]);
});

test("§7.11 is its own chunk: the heading, the 1.25 threshold, and nothing from its neighbours", () => {
  const c = chunk(f1Agreement).find((x) => x.metadata.section === "§7.11");
  assert.equal(c.metadata.heading, "§7.11 Debt Service Coverage Ratio.");
  assert.ok(c.content.startsWith("§7.11 Debt Service Coverage Ratio."));
  assert.match(c.content, /less than 1\.25 to 1\.00/);
  assert.match(c.content, /\(c\) Verification\./);
  assert.doesNotMatch(c.content, /Limitation on Liens/, "§7.10 must not leak in");
  assert.doesNotMatch(c.content, /Events of Default/, "ARTICLE VIII must not leak in");
});

test("every chunk carries exactly the metadata keys match_doc_chunks reads, plus heading", () => {
  for (const c of chunk(f1Agreement)) {
    assert.deepEqual(
      Object.keys(c.metadata).sort(),
      ["doc_title", "doc_type", "document_id", "facility_id", "heading", "section"],
    );
    assert.equal(c.metadata.facility_id, "fac-1");
    assert.equal(c.metadata.doc_type, "agreement");
    assert.equal(c.metadata.doc_title, "Credit Agreement");
    assert.equal(c.metadata.document_id, "doc-1");
  }
});

test("the synthetic marker survives into chunk text", () => {
  const first = chunk(f1Agreement)[0];
  assert.equal(first.metadata.section, PREAMBLE_SECTION);
  assert.ok(first.content.startsWith(MARKER));
  assert.equal(first.metadata.heading, "CREDIT AGREEMENT");
});

test("across all 16 fixtures: no text is lost, no chunk is degraded, section ids are real", () => {
  for (const d of renderAll()) {
    const chunks = chunk(d.text);
    assert.equal(
      flat(chunks.map((c) => c.content).join("\n")),
      flat(d.text),
      `${d.facility}/${d.file}: chunk text must reassemble to the document`,
    );
    for (const c of chunks) {
      assert.equal("degraded" in c.metadata, false, `${d.facility}/${d.file}`);
      assert.notEqual(c.metadata.section, null);
      assert.match(c.metadata.section, /^(PREAMBLE|§\d+(\.\d+)?|ARTICLE [IVXLCDM]+)$/);
    }
  }
});

test("every covenant-term citation resolves to a chunk that contains its verbatim quote (finding M1)", () => {
  const byFile = new Map(renderAll().map((d) => [`${d.facility}/${d.file}`, chunk(d.text)]));
  let checked = 0;
  for (const f of FACILITIES) {
    for (const v of f.terms_versions) {
      for (const cite of v.source_citations) {
        const chunks = byFile.get(`${f.id}/${cite.file}`);
        const section = normaliseSection(cite.citation);
        const hit = chunks.find((c) => c.metadata.section === section);
        assert.ok(hit, `${f.id} "${cite.citation}" -> ${section}: no such chunk in ${cite.file}`);
        assert.ok(
          flat(hit.content).includes(flat(cite.quote)),
          `${f.id} "${cite.citation}": quote not in chunk ${section} of ${cite.file}`,
        );
        checked += 1;
      }
    }
  }
  assert.ok(checked >= 10, `expected to check many citations, checked ${checked}`);
});

// ------------------------------------------------------------ heading detection

test("a Section N.NN heading splits; a sentence that mentions a section does not", () => {
  const text = [
    "Section 2.01 Definitions.",
    "Terms are defined here.",
    "Section 7.11(b) of the Credit Agreement is amended as follows.",
    "Section 7.11 and the amount of any add-back applied are reported quarterly.",
    "Section 7.11 Debt Service Coverage Ratio.",
    "The ratio shall be at least 1.25.",
  ].join("\n");
  const chunks = chunk(text);
  assert.deepEqual(sections(chunks), ["§2.01", "§7.11"]);
  assert.match(chunks[0].content, /amended as follows/);
  assert.match(chunks[0].content, /reported quarterly/);
});

test("a long line that starts like a heading is body text", () => {
  const long = `§9.99 ${"Word ".repeat(40)}`;
  assert.deepEqual(sections(chunk(`§1 Real Heading\nbody\n${long}\nmore`)), ["§1"]);
});

test("a heading with no title, and CRLF line endings, still split", () => {
  const chunks = chunk("§1\r\nfirst\r\n§2.\r\nsecond\r\n");
  assert.deepEqual(sections(chunks), ["§1", "§2"]);
  assert.equal(chunks[1].content, "§2.\nsecond");
});

test("an article heading with no body is still its own chunk", () => {
  const chunks = chunk("ARTICLE VII — FINANCIAL COVENANTS\n\n§7.10 Liens.\nNone.");
  assert.deepEqual(sections(chunks), ["ARTICLE VII", "§7.10"]);
  assert.equal(chunks[0].content, "ARTICLE VII — FINANCIAL COVENANTS");
});

// ------------------------------------------------------------------ degraded

test("a document with no recognisable headings is one flagged chunk with a null section", () => {
  const text = `${MARKER}\n\nJust a letter.\nNo numbered clauses at all.\n`;
  const chunks = chunk(text);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].metadata.section, null);
  assert.equal(chunks[0].metadata.heading, null);
  assert.equal(chunks[0].metadata.degraded, "no_section_headings");
  assert.ok(chunks[0].content.startsWith(MARKER), "marker kept in the degraded chunk");
  assert.match(chunks[0].content, /No numbered clauses/);
});

test("empty or whitespace-only text produces no chunks", () => {
  assert.deepEqual(chunk(""), []);
  assert.deepEqual(chunk("  \n\n \t\n"), []);
});

test("chunking is pure: the same input gives the same output and the input meta is not mutated", () => {
  const meta = { ...META };
  const a = chunk(f1Agreement, meta);
  const b = chunk(f1Agreement, meta);
  assert.deepEqual(a, b);
  assert.deepEqual(meta, META);
});

test("a wrapped line that begins 'Section 7.11.' is the tail of a sentence, not a heading", () => {
  // PDF text is word-wrapped, so a citation can land at the start of a line.
  const text = "§1 Request\nThe Lender may waive compliance with\nSection 7.11.\nSection 7.11 of the Agreement applies.\n§2 Status\nx";
  assert.deepEqual(sections(chunk(text)), ["§1", "§2"]);
});
