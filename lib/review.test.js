import { test } from "node:test";
import assert from "node:assert/strict";

import { runReview, submitReview } from "./review.ts";

// No network and no database: an in-memory stand-in for the three tables a
// review touches, and an embedder spy.

const CASEFILE_ID = "11111111-1111-4111-8111-111111111111";
const EXCEPTION_ID = "24486e45-9897-4591-8ca0-86f766372ae1";
const FACILITY_ID = "b0c54d3f-aa3d-4c02-af90-cbaff0490f60";

const REASON = "The Amendment No. 2 add-back (uncapped) lifts it over 1.25x — we booked the old terms.";

function seed(overrides = {}) {
  return {
    casefiles: [
      {
        id: CASEFILE_ID,
        exception_id: EXCEPTION_ID,
        status: "pending_review",
        suggested_tag: "amendment_addback",
        recommendation: "escalate",
        summary: null,
        ...overrides,
      },
    ],
    exceptions: [
      { id: EXCEPTION_ID, facility_id: FACILITY_ID, test_period_end: "2026-06-30", computed_dscr: "1.1200", reported_dscr: "1.3100", required_dscr: "1.2500", status: "pending_review" },
    ],
    facilities: [{ id: FACILITY_ID, borrower_name: "Harbor Logistics" }],
    reviews: [],
  };
}

/** select/eq/maybeSingle/single, update().eq().select(), insert().select().single(), with per-table write failures. */
function fakeDb(tables, failures = {}) {
  // `failures` is read at call time, so a test can switch a failure off between calls.
  const writes = [];
  let nextId = 1;
  return {
    tables,
    writes,
    failures,
    from(name) {
      const filters = [];
      let op = "select";
      let payload;
      let wantRows = false;
      let mode = "many";
      const b = {
        select() { if (op !== "select") wantRows = true; return b; },
        eq(col, val) { filters.push([col, val]); return b; },
        maybeSingle() { mode = "maybe"; return b; },
        single() { mode = "single"; return b; },
        update(p) { op = "update"; payload = p; return b; },
        insert(p) { op = "insert"; payload = p; return b; },
        then(resolve, reject) {
          const rows = (tables[name] ??= []);
          const match = rows.filter((r) => filters.every(([c, v]) => r[c] === v));
          // Reads hand back COPIES, as a database does; a caller holding a row must not see later writes.
          const copies = match.map((r) => ({ ...r }));
          let out;
          if (op === "update") {
            if (failures.failUpdate === name) out = { data: null, error: { message: `forced ${name} update failure` } };
            else {
              writes.push({ op, table: name, payload, filters: [...filters] });
              for (const r of match) Object.assign(r, payload);
              out = { data: wantRows ? match.map((r) => ({ id: r.id })) : null, error: null };
            }
          } else if (op === "insert") {
            if (failures.failInsert === name) out = { data: null, error: { message: `forced ${name} insert failure` } };
            else {
              const row = { id: `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`, ...payload };
              rows.push(row);
              writes.push({ op, table: name, payload });
              out = { data: mode === "single" ? { id: row.id } : [{ id: row.id }], error: null };
            }
          } else {
            out = mode === "many" ? { data: copies, error: null } : { data: copies[0] ?? null, error: null };
          }
          return Promise.resolve(out).then(resolve, reject);
        },
      };
      return b;
    },
  };
}

const vector = () => Array.from({ length: 1536 }, (_, i) => i / 1536);
function embedSpy(impl = async (texts) => texts.map(vector)) {
  const calls = [];
  const fn = async (texts) => { calls.push(texts); return impl(texts); };
  fn.calls = calls;
  return fn;
}

const quiet = async (fn) => {
  const orig = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = orig; }
};

// ------------------------------------------------------------------ approve

test("approve: casefile approved, one review row with lesson text and a 1536-dim vector, tag from the casefile, exception closed", async () => {
  const db = fakeDb(seed());
  const embed = embedSpy();
  const out = await submitReview({ casefileId: CASEFILE_ID, decision: "approve" }, { client: db, embed });

  assert.equal(out.status, 200);
  assert.equal(out.body.casefile_status, "approved");
  assert.equal(db.tables.casefiles[0].status, "approved");
  assert.equal(db.tables.reviews.length, 1);
  const review = db.tables.reviews[0];
  assert.equal(out.body.review_id, review.id);
  assert.equal(review.decision, "approve");
  assert.equal(review.pattern_tag, "amendment_addback");
  assert.equal(review.reason, null);
  assert.equal(review.corrected_outcome, null);
  assert.equal(typeof review.lesson_text, "string");
  assert.equal(review.lesson_embedding.length, 1536);
  assert.equal(db.tables.exceptions[0].status, "closed");
  assert.deepEqual(embed.calls, [[review.lesson_text]]);
});

test("approve: the lesson is the casefile's one-line summary, which the review writes because nothing else does", async () => {
  const db = fakeDb(seed());
  await submitReview({ casefileId: CASEFILE_ID, decision: "approve" }, { client: db, embed: embedSpy() });
  const { summary } = db.tables.casefiles[0];
  assert.equal(db.tables.reviews[0].lesson_text, summary);
  // Calculator columns, not model prose; one line.
  assert.match(summary, /Harbor Logistics/);
  assert.match(summary, /computed DSCR 1\.12 against a required 1\.25/);
  assert.match(summary, /borrower reported 1\.31/);
  assert.match(summary, /escalate \(amendment_addback\)/);
  assert.doesNotMatch(summary, /\n/);
});

test("approve: a summary already on the casefile is used as it stands and not overwritten", async () => {
  const db = fakeDb(seed({ summary: "Already summarised." }));
  await submitReview({ casefileId: CASEFILE_ID, decision: "approve" }, { client: db, embed: embedSpy() });
  assert.equal(db.tables.reviews[0].lesson_text, "Already summarised.");
  assert.equal(db.tables.casefiles[0].summary, "Already summarised.");
});

test("approve: a missing figure is said to be unknown, never rendered as zero", async () => {
  const t = seed();
  t.exceptions[0].reported_dscr = null;
  t.exceptions[0].computed_dscr = null;
  const db = fakeDb(t);
  await submitReview({ casefileId: CASEFILE_ID, decision: "approve" }, { client: db, embed: embedSpy() });
  const text = db.tables.reviews[0].lesson_text;
  assert.match(text, /computed DSCR unknown/);
  assert.match(text, /borrower reported none/);
  assert.doesNotMatch(text, /\b0\b/);
});

// ----------------------------------------------------------------- override

test("override: each missing field is a 400 that names it, and nothing is written or embedded", async () => {
  const full = { casefileId: CASEFILE_ID, decision: "override", reason: REASON, correctedOutcome: "resolve", confirmedTag: "amendment_addback" };
  const cases = [
    ["reason", { reason: undefined }],
    ["corrected_outcome", { correctedOutcome: undefined }],
    ["confirmed_tag", { confirmedTag: undefined }],
  ];
  for (const [name, patch] of cases) {
    const db = fakeDb(seed());
    const embed = embedSpy();
    const out = await submitReview({ ...full, ...patch }, { client: db, embed });
    assert.equal(out.status, 400, name);
    assert.match(String(out.body.error), new RegExp(name), name);
    assert.deepEqual(out.body.missing, [name]);
    assert.equal(db.tables.reviews.length, 0);
    assert.equal(db.tables.casefiles[0].status, "pending_review");
    assert.equal(embed.calls.length, 0);
  }
});

test("override: a blank or whitespace-only reason is rejected, as are blank outcome and tag", async () => {
  for (const patch of [{ reason: "" }, { reason: "   \n\t " }, { correctedOutcome: "  " }, { confirmedTag: "" }]) {
    const db = fakeDb(seed());
    const out = await submitReview(
      { casefileId: CASEFILE_ID, decision: "override", reason: REASON, correctedOutcome: "resolve", confirmedTag: "amendment_addback", ...patch },
      { client: db, embed: embedSpy() },
    );
    assert.equal(out.status, 400);
    assert.equal(db.tables.reviews.length, 0);
  }
});

test("override: a tag that is not one of the pattern tags is a 400", async () => {
  const db = fakeDb(seed());
  const out = await submitReview(
    { casefileId: CASEFILE_ID, decision: "override", reason: REASON, correctedOutcome: "resolve", confirmedTag: "made_up" },
    { client: db, embed: embedSpy() },
  );
  assert.equal(out.status, 400);
  assert.match(String(out.body.error), /confirmed_tag/);
});

test("override: the reason is stored VERBATIM and is the literal prefix of the lesson; casefile overridden; exception closed", async () => {
  const messy = "  The Amendment No. 2 add-back is UNCAPPED — see §3.1(b).  Don't trim me!  ";
  const db = fakeDb(seed());
  const embed = embedSpy();
  const out = await submitReview(
    { casefileId: CASEFILE_ID, decision: "override", reason: messy, correctedOutcome: "resolve", confirmedTag: "amendment_addback" },
    { client: db, embed },
  );
  assert.equal(out.status, 200);
  assert.equal(out.body.casefile_status, "overridden");
  const review = db.tables.reviews[0];
  assert.equal(review.reason, messy);
  assert.equal(review.corrected_outcome, "resolve");
  assert.equal(review.pattern_tag, "amendment_addback");
  assert.ok(review.lesson_text.startsWith(messy));
  assert.equal(review.lesson_text, `${messy} · amendment_addback · ${db.tables.casefiles[0].summary}`);
  assert.deepEqual(embed.calls, [[review.lesson_text]]);
  assert.equal(db.tables.casefiles[0].status, "overridden");
  assert.equal(db.tables.exceptions[0].status, "closed");
});

test("override: the analyst's confirmed tag, not the model's suggestion, is what is stored", async () => {
  const db = fakeDb(seed({ suggested_tag: "true_breach" }));
  await submitReview(
    { casefileId: CASEFILE_ID, decision: "override", reason: REASON, correctedOutcome: "resolve", confirmedTag: "amendment_addback" },
    { client: db, embed: embedSpy() },
  );
  assert.equal(db.tables.reviews[0].pattern_tag, "amendment_addback");
});

// ------------------------------------------------------------- request_docs

test("request_docs: awaiting_docs, a review row with no lesson, no embed call, exception left as it was", async () => {
  const db = fakeDb(seed());
  const embed = embedSpy();
  const out = await submitReview({ casefileId: CASEFILE_ID, decision: "request_docs" }, { client: db, embed });
  assert.equal(out.status, 200);
  assert.equal(db.tables.casefiles[0].status, "awaiting_docs");
  assert.equal(db.tables.reviews.length, 1);
  assert.equal(db.tables.reviews[0].decision, "request_docs");
  assert.equal(db.tables.reviews[0].lesson_text, null);
  assert.equal(db.tables.reviews[0].lesson_embedding, null);
  assert.equal(embed.calls.length, 0);
  assert.equal(db.tables.exceptions[0].status, "pending_review");
  assert.equal(db.tables.casefiles[0].summary, null, "no lesson, so no summary is written to the memory surface");
});

// ------------------------------------------------------------ preconditions

test("a casefile already approved, overridden or awaiting docs is a 409 naming its status: no second review, no change", async () => {
  for (const status of ["approved", "overridden", "awaiting_docs"]) {
    for (const decision of ["approve", "request_docs"]) {
      // A fully consistent decided casefile: approved/overridden ones have their exception closed
      // (an open one is repaired, see below); awaiting_docs correctly keeps its exception open.
      const t = seed({ status });
      const exceptionStatus = status === "awaiting_docs" ? "pending_review" : "closed";
      t.exceptions[0].status = exceptionStatus;
      const db = fakeDb(t);
      const embed = embedSpy();
      const out = await submitReview({ casefileId: CASEFILE_ID, decision }, { client: db, embed });
      assert.equal(out.status, 409, `${status}/${decision}`);
      assert.match(String(out.body.error), new RegExp(status));
      assert.equal(out.body.casefile_status, status);
      assert.equal(db.tables.reviews.length, 0);
      assert.equal(db.tables.casefiles[0].status, status);
      assert.equal(db.tables.exceptions[0].status, exceptionStatus);
      assert.equal(db.writes.length, 0);
      assert.equal(embed.calls.length, 0);
    }
  }
});

test("a casefile still investigating, or failed, is a 409: it has no recommendation to review", async () => {
  for (const status of ["investigating", "failed"]) {
    const db = fakeDb(seed({ status }));
    const out = await submitReview({ casefileId: CASEFILE_ID, decision: "approve" }, { client: db, embed: embedSpy() });
    assert.equal(out.status, 409, status);
    assert.match(String(out.body.error), new RegExp(status));
    assert.equal(db.tables.reviews.length, 0);
  }
});

test("a casefile that does not exist is a 404", async () => {
  const db = fakeDb(seed());
  const out = await submitReview({ casefileId: "00000000-0000-4000-8000-000000000000", decision: "approve" }, { client: db, embed: embedSpy() });
  assert.equal(out.status, 404);
  assert.equal(db.writes.length, 0);
});

test("a malformed casefile id or an unknown decision is a 400, not a database round trip", async () => {
  const db = fakeDb(seed());
  assert.equal((await submitReview({ casefileId: "nope", decision: "approve" }, { client: db })).status, 400);
  assert.equal((await submitReview({ casefileId: CASEFILE_ID, decision: "shrug" }, { client: db })).status, 400);
});

test("two analysts racing: the guarded update lets one win and the other gets a 409 with no review row", async () => {
  const db = fakeDb(seed());
  // The casefile is read as pending, then someone else decides it before our update lands.
  const realFrom = db.from.bind(db);
  let raced = false;
  db.from = (name) => {
    if (name === "casefiles" && !raced) {
      const b = realFrom(name);
      const origThen = b.then.bind(b);
      b.then = (res, rej) => {
        const done = origThen(res, rej);
        raced = true;
        db.tables.casefiles[0].status = "overridden";
        return done;
      };
      return b;
    }
    return realFrom(name);
  };
  const out = await submitReview({ casefileId: CASEFILE_ID, decision: "approve" }, { client: db, embed: embedSpy() });
  assert.equal(out.status, 409);
  assert.equal(out.body.casefile_status, "overridden");
  assert.equal(db.tables.reviews.length, 0);
});

// --------------------------------------------------------- atomic in effect

test("embed throwing on approve or override is a 500 with NO review row and NO status change", async () => {
  for (const body of [
    { decision: "approve" },
    { decision: "override", reason: REASON, correctedOutcome: "resolve", confirmedTag: "amendment_addback" },
  ]) {
    const db = fakeDb(seed());
    const embed = embedSpy(async () => { throw new Error("Embedding request failed (503)"); });
    const out = await quiet(() => submitReview({ casefileId: CASEFILE_ID, ...body }, { client: db, embed }));
    assert.equal(out.status, 500, body.decision);
    assert.equal(db.tables.reviews.length, 0);
    assert.equal(db.tables.casefiles[0].status, "pending_review");
    assert.equal(db.tables.casefiles[0].summary, null);
    assert.equal(db.tables.exceptions[0].status, "pending_review");
    assert.equal(db.writes.length, 0);
    assert.doesNotMatch(JSON.stringify(out.body), /503/, "the upstream message is logged, not returned");
  }
});

test("an embedder that returns the wrong size is refused like an outage; no placeholder vector is stored", async () => {
  const db = fakeDb(seed());
  const embed = embedSpy(async () => [[0.1, 0.2]]);
  const out = await quiet(() => submitReview({ casefileId: CASEFILE_ID, decision: "approve" }, { client: db, embed }));
  assert.equal(out.status, 500);
  assert.equal(db.tables.reviews.length, 0);
  assert.equal(db.tables.casefiles[0].status, "pending_review");
});

test("a review row that cannot be written puts the casefile back to pending_review and raises", async () => {
  const db = fakeDb(seed(), { failInsert: "reviews" });
  await quiet(async () => {
    await assert.rejects(() => submitReview({ casefileId: CASEFILE_ID, decision: "approve" }, { client: db, embed: embedSpy() }), /insert reviews/);
  });
  assert.equal(db.tables.casefiles[0].status, "pending_review");
  assert.equal(db.tables.casefiles[0].summary, null);
  assert.equal(db.tables.exceptions[0].status, "pending_review");
});

test("if only the exception close fails the review stands and the response says so, never a plain success", async () => {
  const db = fakeDb(seed(), { failUpdate: "exceptions" });
  const out = await quiet(() => submitReview({ casefileId: CASEFILE_ID, decision: "approve" }, { client: db, embed: embedSpy() }));
  assert.equal(out.status, 500);
  assert.equal(out.body.review_id, db.tables.reviews[0].id);
  assert.equal(out.body.casefile_status, "approved");
  assert.equal(db.tables.casefiles[0].status, "approved");
  assert.equal(db.tables.exceptions[0].status, "pending_review");
});

test("a retry after a failed exception close repairs the exception: closed, 200, and no second review row", async () => {
  for (const body of [
    { decision: "approve" },
    { decision: "override", reason: REASON, correctedOutcome: "resolve", confirmedTag: "amendment_addback" },
  ]) {
    const db = fakeDb(seed());
    const embed = embedSpy();
    // First call: the casefile commits, the exception update fails.
    db.failures.failUpdate = "exceptions";
    const first = await quiet(() => submitReview({ casefileId: CASEFILE_ID, ...body }, { client: db, embed }));
    assert.equal(first.status, 500, body.decision);
    assert.equal(db.tables.exceptions[0].status, "pending_review");
    const decided = db.tables.casefiles[0].status;

    db.failures.failUpdate = null;
    const second = await submitReview({ casefileId: CASEFILE_ID, ...body }, { client: db, embed });
    assert.equal(second.status, 200, body.decision);
    assert.equal(second.body.repaired, true);
    assert.equal(second.body.casefile_status, decided);
    assert.equal(db.tables.exceptions[0].status, "closed");
    assert.equal(db.tables.reviews.length, 1, "no duplicate review");
    assert.equal(embed.calls.length, 1, "no second embedding");

    // And a third call, now fully consistent, is the ordinary read-only 409.
    const third = await submitReview({ casefileId: CASEFILE_ID, ...body }, { client: db, embed });
    assert.equal(third.status, 409);
    assert.equal(db.tables.reviews.length, 1);
  }
});

test("a stale review on an approved casefile whose exception was REOPENED to new is a 409: the live breach is not closed", async () => {
  for (const reopened of ["new", "investigating", "needs_filing"]) {
    const t = seed({ status: "approved" });
    t.exceptions[0].status = reopened;
    const db = fakeDb(t);
    const embed = embedSpy();
    const out = await submitReview({ casefileId: CASEFILE_ID, decision: "approve" }, { client: db, embed });
    assert.equal(out.status, 409, reopened);
    assert.equal(db.tables.exceptions[0].status, reopened, "the reopened breach is left alone");
    assert.equal(db.writes.length, 0);
    assert.equal(db.tables.reviews.length, 0);
    assert.equal(embed.calls.length, 0);
  }
});

test("the repair write is conditional on pending_review, so a read/write interleave cannot close a reopened breach", async () => {
  const db = fakeDb(seed({ status: "approved" }));
  // The exception is read as pending_review, then F7 reopens it before our update lands.
  const realFrom = db.from.bind(db);
  let reads = 0;
  db.from = (name) => {
    const b = realFrom(name);
    if (name !== "exceptions") return b;
    const origThen = b.then.bind(b);
    b.then = (res, rej) => {
      const done = origThen(res, rej);
      if (++reads === 1) db.tables.exceptions[0].status = "new";
      return done;
    };
    return b;
  };
  const out = await submitReview({ casefileId: CASEFILE_ID, decision: "approve" }, { client: db, embed: embedSpy() });
  assert.equal(out.status, 409);
  assert.equal(db.tables.exceptions[0].status, "new");
});

test("an already-closed or missing exception on a decided casefile is not repaired: the ordinary read-only 409", async () => {
  const closed = seed({ status: "overridden" });
  closed.exceptions[0].status = "closed";
  const missing = seed({ status: "approved" });
  missing.exceptions = [];
  for (const t of [closed, missing]) {
    const db = fakeDb(t);
    const embed = embedSpy();
    const out = await submitReview({ casefileId: CASEFILE_ID, decision: "approve" }, { client: db, embed });
    assert.equal(out.status, 409);
    assert.notEqual(out.body.repaired, true);
    assert.equal(db.writes.length, 0);
    assert.equal(db.tables.reviews.length, 0);
    assert.equal(embed.calls.length, 0);
  }
});

test("repair never touches awaiting_docs: its exception correctly stays open", async () => {
  const db = fakeDb(seed({ status: "awaiting_docs" }));
  const out = await submitReview({ casefileId: CASEFILE_ID, decision: "approve" }, { client: db, embed: embedSpy() });
  assert.equal(out.status, 409);
  assert.equal(db.tables.exceptions[0].status, "pending_review");
  assert.equal(db.writes.length, 0);
});

// ----------------------------------------- the match_lessons contract (I-7)

test("approve and override rows carry BOTH lesson_text and lesson_embedding, which match_lessons requires", async () => {
  for (const body of [
    { decision: "approve" },
    { decision: "override", reason: REASON, correctedOutcome: "resolve", confirmedTag: "amendment_addback" },
  ]) {
    const db = fakeDb(seed());
    await submitReview({ casefileId: CASEFILE_ID, ...body }, { client: db, embed: embedSpy() });
    const row = db.tables.reviews[0];
    assert.ok(row.lesson_text && row.lesson_text.length > 0, body.decision);
    assert.equal(row.lesson_embedding?.length, 1536, body.decision);
    // and match_lessons serves casefiles.summary as case_summary, so it must be real text too
    assert.ok(db.tables.casefiles[0].summary, body.decision);
  }
});

// ------------------------------------------------------------------- the wire

test("runReview maps the snake_case wire body onto submitReview", async () => {
  const db = fakeDb(seed());
  const out = await runReview(
    { casefile_id: CASEFILE_ID, decision: "override", reason: REASON, corrected_outcome: "resolve", confirmed_tag: "amendment_addback" },
    { client: db, embed: embedSpy() },
  );
  assert.equal(out.status, 200);
  assert.equal(db.tables.reviews[0].corrected_outcome, "resolve");
  assert.equal(db.tables.reviews[0].pattern_tag, "amendment_addback");
});

test("runReview: a body that is not a JSON object is a 400", async () => {
  assert.equal((await runReview(undefined)).status, 400);
  assert.equal((await runReview([1])).status, 400);
  assert.equal((await runReview("x")).status, 400);
});
