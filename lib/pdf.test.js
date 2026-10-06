import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";

import { MARKER } from "../data/facilities.js";
import { renderAll, renderPdf } from "../data/generate.mjs";
import { chunkBySection } from "./chunk.ts";
import { DocumentError, extractText } from "./pdf.ts";

const META = { facility_id: "f", document_id: "d", doc_type: "agreement", doc_title: "t" };
const sectionsOf = (text) => chunkBySection(text, META).map((c) => c.metadata.section);
const f1Agreement = renderAll().find((d) => d.facility === "F1" && d.file === "agreement.txt");

test("round trip: a generated PDF reads back with the marker, §7.11 and the 1.25 threshold", async () => {
  const text = await extractText(await renderPdf(f1Agreement.text), "agreement.pdf");
  assert.ok(text.includes(MARKER));
  assert.ok(text.includes("§7.11"));
  assert.match(text, /1\.25 to 1\.00/);
});

test("round trip: all 16 PDFs chunk into the same sections as their .txt source", async () => {
  for (const d of renderAll()) {
    const fromPdf = await extractText(await renderPdf(d.text), d.file);
    assert.deepEqual(sectionsOf(fromPdf), sectionsOf(d.text), `${d.facility}/${d.file}`);
  }
});

test("round trip: wrapped lines change the line breaks only, never the words", async () => {
  const flat = (s) => s.replace(/\s+/g, " ").trim();
  const fromPdf = await extractText(await renderPdf(f1Agreement.text), "agreement.pdf");
  assert.equal(flat(fromPdf), flat(f1Agreement.text));
});

test("text bytes pass through unchanged", async () => {
  const bytes = new TextEncoder().encode(f1Agreement.text);
  assert.equal(await extractText(bytes, "agreement.txt"), f1Agreement.text);
  assert.equal(await extractText(Buffer.from(f1Agreement.text), "agreement.txt"), f1Agreement.text);
});

test("extraction leaves the caller's buffer intact", async () => {
  const bytes = await renderPdf(f1Agreement.text);
  const before = bytes.length;
  await extractText(bytes, "a.pdf");
  assert.equal(bytes.length, before);
  await extractText(bytes, "a.pdf");
});

test("an image-only PDF is rejected, naming the file, not OCR'd", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  page.drawRectangle({ x: 50, y: 50, width: 400, height: 600 }); // marks on the page, no text
  const bytes = await pdf.save();
  await assert.rejects(extractText(bytes, "scan-001.pdf"), (err) => {
    assert.ok(err instanceof DocumentError);
    assert.equal(err.status, 422);
    assert.match(err.message, /scan-001\.pdf/);
    assert.match(err.message, /scanned or image-only/);
    return true;
  });
});

test("a corrupt PDF is a readable DocumentError naming the file", async () => {
  await assert.rejects(extractText(new TextEncoder().encode("%PDF-1.7 not really"), "broken.pdf"), (err) => {
    assert.ok(err instanceof DocumentError);
    assert.match(err.message, /broken\.pdf/);
    return true;
  });
});

test("binary that is neither PDF nor text is rejected", async () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
  await assert.rejects(extractText(png, "logo.png"), (err) => {
    assert.ok(err instanceof DocumentError);
    assert.match(err.message, /logo\.png/);
    return true;
  });
});
