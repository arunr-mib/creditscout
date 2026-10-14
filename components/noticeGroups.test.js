import { test } from "node:test";
import assert from "node:assert/strict";

import { COVERAGE_NOTE, consequenceOf, coverageLine, noticeHeadline, splitFieldPath } from "./noticeGroups.ts";

test("consequenceOf: only the check that DID NOT RUN needs an acknowledgment", () => {
  // Promoting every notice to a blocker is how a checklist becomes a thing
  // analysts click past.
  assert.equal(consequenceOf("definition_not_located"), "acknowledge");
  for (const code of ["clause_amended", "amendment_not_cited", "addback_not_in_terms", "definition_conflict"]) {
    assert.equal(consequenceOf(code), "information", code);
  }
});

test("splitFieldPath: the finding leads; the path is kept for the details", () => {
  const { path, rest } = splitFieldPath(
    'numerator.addbacks[0].cap cites CA §7.11(b)(i), but Amd 2 §3 amends §7.11(b). Check the original clause still reads as quoted.',
  );
  assert.equal(path, "numerator.addbacks[0].cap");
  assert.match(rest, /^Cites CA §7\.11/);
});

test("splitFieldPath: a message with no path is left exactly as it came", () => {
  const msg = "The definition of the ratio was not located in the documents on file.";
  assert.deepEqual(splitFieldPath(msg), { path: null, rest: msg });
});

test("noticeHeadline: an amended clause says WHICH term to check", () => {
  assert.equal(
    noticeHeadline({ code: "clause_amended", message: "numerator.addbacks[0].cap cites CA §7.11(b)(i), but Amd 2 §3 amends §7.11(b)." }),
    "Check the amended add-back cap",
  );
  assert.equal(
    noticeHeadline({ code: "clause_amended", message: "threshold.min_dscr cites CA §7.11(a), but Amd 2 §1 amends §7.11." }),
    "Check the amended clause",
  );
});

test("noticeHeadline: an unknown code gets a safe instruction, not an invented finding", () => {
  assert.equal(noticeHeadline({ code: "something_new", message: "x" }), "Check this term against its source");
});

test("coverageLine: a count, said as a count — and never as completeness", () => {
  assert.equal(coverageLine(3, ["CA §7.11"]), "3 source paragraphs are not linked to proposed terms, in CA §7.11");
  assert.equal(coverageLine(1, []), "1 source paragraph is not linked to proposed terms");
  assert.equal(coverageLine(0, ["CA §7.11"]), null);
  assert.match(COVERAGE_NOTE, /does not establish completeness/);
});
