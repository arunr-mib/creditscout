import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DATED_TYPES,
  MAX_UPLOAD_BYTES,
  UPLOAD_STATUS_LABEL,
  oversizeNames,
  uploadSummary,
  DOC_TYPE_VALUES,
  duplicateNames,
  readiness,
  stageFile,
  stagingBlockers,
  suggestDate,
  suggestDocType,
} from "./uploadModel.ts";

// ------------------------------------------------------- the classification

test("suggestDocType: the real package filenames each land on their own type", () => {
  // THE BUG: one dropdown applied to every file in a batch, so dragging a whole
  // package in one gesture stored all four as `financials`. doc_type scopes the
  // agent's retrieval, so a misfiled agreement is invisible to extraction.
  assert.equal(suggestDocType("agreement.txt"), "agreement");
  assert.equal(suggestDocType("amendment-no-2.txt"), "amendment");
  assert.equal(suggestDocType("financials-2026-06-30.pdf"), "financials");
  assert.equal(suggestDocType("compliance-certificate-2026-06-30.pdf"), "compliance_certificate");
  assert.equal(suggestDocType("waiver-request-letter.txt"), "waiver");
});

test("suggestDocType: an amendment to an agreement reads as an amendment", () => {
  // Routinely named for both. The more specific reading is the right one, and
  // getting it backwards files the amendment where nothing will look for it.
  assert.equal(suggestDocType("Amendment No. 2 to Credit Agreement.pdf"), "amendment");
  assert.equal(suggestDocType("credit-agreement-amendment-1.pdf"), "amendment");
});

test("suggestDocType: no guess beats a confident wrong default", () => {
  // An unlabelled row the analyst must set is safer than silently filing a
  // document as whatever the dropdown last showed.
  assert.equal(suggestDocType("scan001.pdf"), null);
  assert.equal(suggestDocType("document.pdf"), null);
});

test("every suggestion is a type the uploader actually offers", () => {
  for (const name of ["agreement.txt", "amendment-1.pdf", "financials-2026-06-30.txt", "compliance-certificate.pdf", "waiver.txt"]) {
    const t = suggestDocType(name);
    assert.ok(DOC_TYPE_VALUES.includes(t), `${name} -> ${t}`);
  }
});

test("suggestDate: an ISO date in the name is offered, nonsense is not", () => {
  assert.equal(suggestDate("financials-2026-06-30.pdf"), "2026-06-30");
  assert.equal(suggestDate("agreement.txt"), null);
  assert.equal(suggestDate("report-2026-13-45.pdf"), null, "month 13 / day 45 is not a date");
});

// ------------------------------------------------------------- the staging

test("stageFile: marks whether the type was guessed, so the UI can say so", () => {
  const guessed = stageFile({ name: "amendment-no-2.txt", size: 10 });
  assert.equal(guessed.docType, "amendment");
  assert.equal(guessed.suggested, true);

  const unknown = stageFile({ name: "scan001.pdf", size: 10 });
  assert.equal(unknown.docType, "");
  assert.equal(unknown.suggested, false, "an unrecognised file must not claim a suggestion");
});

test("stageFile: keys are unique even for identically named files", () => {
  const a = stageFile({ name: "same.pdf", size: 1 });
  const b = stageFile({ name: "same.pdf", size: 1 });
  assert.notEqual(a.key, b.key);
});

// ------------------------------------------------------------- the blockers

const staged = (over = {}) => ({ key: "k", name: "f.pdf", size: 1, docType: "financials", date: "", suggested: true, ...over });

test("stagingBlockers: an agreement with no effective date cannot be stored", () => {
  // Terms cannot be extracted without it, so it is refused rather than stored
  // unusable.
  const b = stagingBlockers([staged({ docType: "agreement", name: "agreement.txt" })], true);
  assert.equal(b.length, 1);
  assert.match(b[0], /effective date for agreement\.txt/);
  assert.match(b[0], /terms cannot be extracted/);
});

test("stagingBlockers: financials need no effective date", () => {
  assert.deepEqual(stagingBlockers([staged({ docType: "financials" })], true), []);
});

test("stagingBlockers: an unclassified file blocks the batch, named", () => {
  const b = stagingBlockers([staged({ docType: "", name: "scan001.pdf" })], true);
  assert.match(b[0], /document type for scan001\.pdf/);
});

test("stagingBlockers: several of a kind are counted rather than listed one by one", () => {
  const files = [staged({ key: "1", docType: "" }), staged({ key: "2", docType: "" })];
  assert.match(stagingBlockers(files, true)[0], /2 files/);
});

test("stagingBlockers: no borrower is the first thing said, even with no files", () => {
  assert.deepEqual(stagingBlockers([], false), ["Choose a borrower."]);
});

test("duplicateNames: the same file twice in one batch is surfaced", () => {
  const dupes = duplicateNames([staged({ key: "1", name: "a.pdf" }), staged({ key: "2", name: "a.pdf" }), staged({ key: "3", name: "b.pdf" })]);
  assert.deepEqual(dupes, ["a.pdf"]);
});

// ------------------------------------------------------------ the readiness

test("readiness: terms review and covenant testing are different states", () => {
  // A borrower reaches the first with an agreement alone; testing also needs
  // the period's financials. Conflating them told analysts to wait for
  // documents they did not yet need.
  assert.deepEqual(readiness([staged({ docType: "agreement" })]), { termsReview: true, covenantTests: false });
  assert.deepEqual(readiness([staged({ docType: "financials" })]), { termsReview: false, covenantTests: true });
  assert.deepEqual(
    readiness([staged({ key: "1", docType: "agreement" }), staged({ key: "2", docType: "financials" })]),
    { termsReview: true, covenantTests: true },
  );
});

test("DATED_TYPES is exactly the set whose terms are extracted", () => {
  assert.deepEqual([...DATED_TYPES], ["agreement", "amendment"]);
});

// ------------------------------------------------ what happened to each file

test("the stated size limit is the one the server actually enforces", async () => {
  // A limit written twice is a limit that drifts. If `lib/ingest` changes this,
  // this test fails rather than the analyst meeting a 413.
  const { MAX_BYTES } = await import("../lib/ingest.ts");
  assert.equal(MAX_UPLOAD_BYTES, MAX_BYTES);
});

test("an oversized file is named before anything is sent", () => {
  const big = { name: "scan.pdf", size: MAX_UPLOAD_BYTES + 1 };
  assert.deepEqual(oversizeNames([big, { name: "ok.pdf", size: 10 }]), ["scan.pdf"]);
  const b = stagingBlockers([{ ...stageFile(big), docType: "financials" }], true);
  assert.match(b[0], /larger than 10 MB/);
});

test("uploadSummary counts what happened, and a staged file has not happened", () => {
  assert.equal(uploadSummary([{ status: "ready" }, { status: "failed" }, { status: "staged" }]), "1 ready · 1 failed");
  assert.equal(uploadSummary([{ status: "uploading" }, { status: "uploading" }]), "2 in progress");
  assert.equal(uploadSummary([{ status: "staged" }]), null);
});

test("the in-flight state is named for everything it covers", () => {
  // Extraction, chunking and embedding happen inside the same call, with no
  // signal at the boundary. A "Processing" state switched on a timer would be
  // an animation pretending to be a measurement.
  assert.equal(UPLOAD_STATUS_LABEL.uploading, "Uploading and indexing");
  assert.equal(UPLOAD_STATUS_LABEL.ready, "Ready");
});
