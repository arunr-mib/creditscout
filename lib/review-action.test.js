import { test } from "node:test";
import assert from "node:assert/strict";

import { casefilePath, decideReview } from "./review-action.ts";
import { submitReview } from "./review.ts";

const CASEFILE_ID = "11111111-1111-4111-8111-111111111111";
const EXCEPTION_ID = "24486e45-9897-4591-8ca0-86f766372ae1";
const REASON = "  The Amendment No. 2 add-back (uncapped) lifts it over 1.25x.\n\nWe booked the old terms.  ";

/** A stand-in for `submitReview` that records what it was handed. */
function stub(result) {
  const calls = [];
  const submit = async (input, deps) => {
    calls.push({ input, deps });
    return typeof result === "function" ? result(input) : result;
  };
  return { submit, calls };
}

const harness = (result, extra = {}) => {
  const revalidated = [];
  const s = stub(result);
  return { ...s, revalidated, deps: { revalidate: (p) => revalidated.push(p), submit: s.submit, ...extra } };
};

const DECIDED = { status: 200, body: { review_id: "r-1", casefile_id: CASEFILE_ID, decision: "approve", casefile_status: "approved", exception_status: "closed" } };

test("approve calls submitReview('approve') and revalidates the casefile path", async () => {
  const h = harness(DECIDED);
  const out = await decideReview({ casefileId: CASEFILE_ID, decision: "approve" }, h.deps);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].input.decision, "approve");
  assert.equal(h.calls[0].input.casefileId, CASEFILE_ID);
  assert.deepEqual(h.revalidated, [`/casefiles/${CASEFILE_ID}`]);
  assert.equal(casefilePath(CASEFILE_ID), `/casefiles/${CASEFILE_ID}`);
  assert.deepEqual(out, { kind: "decided", decision: "approve", reviewId: "r-1", casefileStatus: "approved" });
});

test("the override reason reaches submitReview verbatim: not trimmed, not reworded", async () => {
  const h = harness({ status: 200, body: { ...DECIDED.body, decision: "override", casefile_status: "overridden" } });
  await decideReview(
    { casefileId: CASEFILE_ID, decision: "override", reason: REASON, correctedOutcome: "resolve", confirmedTag: "amendment_addback" },
    h.deps,
  );
  assert.equal(h.calls[0].input.reason, REASON, "the reason was altered on the way");
  assert.equal(h.calls[0].input.correctedOutcome, "resolve");
  assert.equal(h.calls[0].input.confirmedTag, "amendment_addback");
});

test("a 409 lands the read-only view: an outcome, not an error, and the page is re-read", async () => {
  const h = harness({ status: 409, body: { error: "This casefile is already approved; a review is read-only once made.", casefile_status: "approved" } });
  const out = await decideReview({ casefileId: CASEFILE_ID, decision: "approve" }, h.deps);
  assert.equal(out.kind, "already_reviewed");
  assert.equal(out.casefileStatus, "approved");
  assert.match(out.message, /already approved/);
  assert.deepEqual(h.revalidated, [`/casefiles/${CASEFILE_ID}`], "without a revalidate the analyst stays on the stale active view");
});

test("a bare 200 is NOT a decision: only a review_id says one landed", async () => {
  // F9a's repair path: 200, no review_id, no decision, for a casefile that was already decided.
  const h = harness({ status: 200, body: { casefile_id: CASEFILE_ID, casefile_status: "approved", exception_status: "closed", repaired: true, note: "This casefile was already approved; its exception is now closed. No new review was recorded." } });
  const out = await decideReview({ casefileId: CASEFILE_ID, decision: "approve" }, h.deps);
  assert.equal(out.kind, "already_reviewed");
  assert.notEqual(out.kind, "decided");
  assert.match(out.message, /No new review was recorded/);
  assert.equal(h.revalidated.length, 1);

  const odd = harness({ status: 200, body: {} });
  assert.equal((await decideReview({ casefileId: CASEFILE_ID, decision: "approve" }, odd.deps)).kind, "failed", "a 200 with nothing in it is not success");
});

test("a recorded review whose exception close failed still counts as a decision, with the warning", async () => {
  const h = harness({ status: 500, body: { error: "The review was recorded, but the exception could not be closed. Check the server log.", review_id: "r-9", casefile_status: "approved" } });
  const out = await decideReview({ casefileId: CASEFILE_ID, decision: "approve" }, h.deps);
  assert.equal(out.kind, "decided");
  assert.equal(out.reviewId, "r-9");
  assert.match(out.warning, /exception could not be closed/);
  assert.equal(h.revalidated.length, 1);
});

test("a 400 is a refusal naming what is missing, nothing is revalidated", async () => {
  const h = harness({ status: 400, body: { error: "An override requires reason.", missing: ["reason"] } });
  const out = await decideReview({ casefileId: CASEFILE_ID, decision: "override", reason: "", correctedOutcome: "resolve", confirmedTag: "other" }, h.deps);
  assert.deepEqual(out, { kind: "refused", message: "An override requires reason.", missing: ["reason"] });
  assert.deepEqual(h.revalidated, []);
});

test("a 404 and a thrown error are reported, never swallowed into success", async () => {
  const notFound = harness({ status: 404, body: { error: "No casefile with that id." } });
  assert.equal((await decideReview({ casefileId: CASEFILE_ID, decision: "approve" }, notFound.deps)).kind, "not_found");

  const logged = [];
  const original = console.error;
  console.error = (...a) => logged.push(a.join(" "));
  try {
    const boom = harness(() => { throw new Error("pgvector is down"); });
    const out = await decideReview({ casefileId: CASEFILE_ID, decision: "approve" }, boom.deps);
    assert.equal(out.kind, "failed");
    assert.doesNotMatch(out.message, /pgvector/, "an internal error message is not shown to the analyst");
    assert.deepEqual(boom.revalidated, []);
  } finally {
    console.error = original;
  }
  assert.ok(logged.some((l) => /review failed/.test(l)));
});

test("a request that is not a review is refused before submitReview is reached", async () => {
  for (const bad of [null, undefined, "approve", [], {}, { casefileId: 7, decision: "approve" }, { casefileId: CASEFILE_ID, decision: "delete" }]) {
    const h = harness(DECIDED);
    const out = await decideReview(bad, h.deps);
    assert.equal(out.kind, "refused", JSON.stringify(bad));
    assert.equal(h.calls.length, 0, JSON.stringify(bad));
  }
});

test("end to end through the real submitReview: a late submit on a decided casefile is the read-only view", async () => {
  // Only the reads submitReview does before it refuses.
  const rows = {
    casefiles: [{ id: CASEFILE_ID, status: "overridden", exception_id: EXCEPTION_ID, suggested_tag: "other", recommendation: "escalate", summary: "s" }],
    exceptions: [{ id: EXCEPTION_ID, status: "closed" }],
  };
  const client = {
    from(table) {
      const filters = [];
      const b = {
        select: () => b,
        eq(c, v) { filters.push([c, v]); return b; },
        maybeSingle: async () => ({ data: (rows[table] ?? []).find((r) => filters.every(([c, v]) => r[c] === v)) ?? null, error: null }),
      };
      return b;
    },
  };
  const revalidated = [];
  const out = await decideReview(
    { casefileId: CASEFILE_ID, decision: "approve" },
    { revalidate: (p) => revalidated.push(p), submit: submitReview, review: { client } },
  );
  assert.equal(out.kind, "already_reviewed");
  assert.equal(out.casefileStatus, "overridden");
  assert.deepEqual(revalidated, [`/casefiles/${CASEFILE_ID}`]);
});
