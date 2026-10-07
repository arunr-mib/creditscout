import { test } from "node:test";
import assert from "node:assert/strict";
import { currentCasefileId } from "./casefile-current.ts";
import { fakeDb } from "./agent/fakes.js";

const EX = "11111111-1111-4111-8111-111111111111";
const row = (id, status, t, ex = EX) => ({ id, exception_id: ex, status, created_at: new Date(t).toISOString() });

test("the current casefile is the newest one that is not superseded", async () => {
  const db = fakeDb({ casefiles: [row("a", "superseded", 1), row("b", "superseded", 2), row("c", "pending_review", 3), row("z", "approved", 9, "other")] });
  assert.equal(await currentCasefileId(db, EX), "c");
});

test("a failed newest casefile is still current (only superseded is skipped)", async () => {
  const db = fakeDb({ casefiles: [row("a", "superseded", 1), row("b", "failed", 2)] });
  assert.equal(await currentCasefileId(db, EX), "b");
});

test("an exception with only superseded casefiles has no current one", async () => {
  const db = fakeDb({ casefiles: [row("a", "superseded", 1)] });
  assert.equal(await currentCasefileId(db, EX), null);
});
