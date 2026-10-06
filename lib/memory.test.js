import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_LESSON_COUNT, ExceptionNotFound, buildExceptionProfile, exceptionProfileText, topLessons } from "./memory.ts";

// No network and no database. The profile builder is pure; the loader is tested
// against an in-memory stand-in for the three tables it reads.

const EXCEPTION_ID = "24486e45-9897-4591-8ca0-86f766372ae1";
const FACILITY_ID = "b0c54d3f-aa3d-4c02-af90-cbaff0490f60";

/** Just enough of the supabase-js builder for buildExceptionProfile: select + eq + order + maybeSingle. */
function fakeDb(tables, failOn = null) {
  const reads = [];
  return {
    reads,
    from(name) {
      const filters = [];
      const b = {
        select() { return b; },
        eq(col, val) { filters.push([col, val]); return b; },
        order() { return b; },
        maybeSingle() { b._mode = "maybe"; return b; },
        then(resolve, reject) {
          reads.push(name);
          if (failOn === name) return Promise.resolve({ data: null, error: { message: `forced ${name} failure` } }).then(resolve, reject);
          const rows = (tables[name] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
          const out = b._mode === "maybe" ? { data: rows[0] ?? null, error: null } : { data: rows, error: null };
          return Promise.resolve(out).then(resolve, reject);
        },
      };
      return b;
    },
  };
}

const LIVE = {
  exceptions: [
    {
      id: EXCEPTION_ID,
      facility_id: FACILITY_ID,
      test_period_end: "2026-06-30",
      // Postgres `numeric` arrives as a STRING over the wire.
      computed_dscr: "1.1200",
      reported_dscr: "1.1200",
      required_dscr: "1.2500",
      status: "new",
    },
  ],
  facilities: [{ id: FACILITY_ID, borrower_name: "Harbor Logistics", industry: "Freight and logistics" }],
  documents: [
    { facility_id: FACILITY_ID, doc_type: "agreement", title: "Credit Agreement", effective_date: "2024-03-15" },
    { facility_id: FACILITY_ID, doc_type: "amendment", title: "Amendment No. 2", effective_date: "2026-04-01" },
    { facility_id: FACILITY_ID, doc_type: "financials", title: "Financials — Q2 2026", effective_date: "2026-06-30" },
  ],
};

// ------------------------------------------------------------- the profile

test("the profile states computed, required and reported, which is what spec §4.2 asks for", () => {
  const text = exceptionProfileText({
    industry: "Freight and logistics",
    computed_dscr: 1.12,
    reported_dscr: 1.31,
    required_dscr: 1.25,
    docTypes: ["agreement", "financials"],
  });
  assert.match(text, /computed 1\.12/);
  assert.match(text, /required minimum of 1\.25/);
  assert.match(text, /borrower reported 1\.31/);
  assert.match(text, /Industry: Freight and logistics\./);
});

test("the direction the borrower is wrong in is said in words, because it is the strongest match signal", () => {
  const over = exceptionProfileText({ industry: null, computed_dscr: 1.08, reported_dscr: 1.31, required_dscr: 1.25, docTypes: [] });
  assert.match(over, /higher than ours/);
  const under = exceptionProfileText({ industry: null, computed_dscr: 1.3, reported_dscr: 1.1, required_dscr: 1.25, docTypes: [] });
  assert.match(under, /lower than ours/);
  const same = exceptionProfileText({ industry: null, computed_dscr: 1.12, reported_dscr: 1.12, required_dscr: 1.25, docTypes: [] });
  assert.match(same, /agrees with ours/);
});

test("document types are deduplicated and sorted, so two identical facilities embed identically", () => {
  const text = exceptionProfileText({
    industry: null,
    computed_dscr: 1,
    reported_dscr: null,
    required_dscr: 1.25,
    docTypes: ["financials", "agreement", "financials", "amendment"],
  });
  assert.match(text, /Documents on file: agreement, amendment, financials\./);
});

test("nothing missing is ever rendered as a figure", () => {
  const text = exceptionProfileText({ industry: null, computed_dscr: null, reported_dscr: null, required_dscr: null, docTypes: [] });
  assert.match(text, /computed unknown/);
  assert.match(text, /borrower reported none/);
  assert.match(text, /No documents are on file\./);
  assert.doesNotMatch(text, /\b0\b/);
});

test("an industry we do not know is left out rather than embedded as an empty label", () => {
  const text = exceptionProfileText({ industry: null, computed_dscr: 1, reported_dscr: 1, required_dscr: 1.25, docTypes: [] });
  assert.doesNotMatch(text, /Industry/);
});

// -------------------------------------------------------------- the loader

test("the loader returns the rows it read as well as the profile, so the brief and the profile cannot disagree", () => {
  return buildExceptionProfile(EXCEPTION_ID, { client: fakeDb(LIVE) }).then((bundle) => {
    assert.equal(bundle.facility.borrower_name, "Harbor Logistics");
    assert.equal(bundle.documents.length, 3);
    assert.match(bundle.profile, /computed 1\.12/);
  });
});

test("numeric columns arriving as strings become numbers, so no prompt ever carries a quoted DSCR", () => {
  return buildExceptionProfile(EXCEPTION_ID, { client: fakeDb(LIVE) }).then((bundle) => {
    assert.equal(bundle.exception.computed_dscr, 1.12);
    assert.equal(bundle.exception.required_dscr, 1.25);
    assert.equal(typeof bundle.exception.computed_dscr, "number");
  });
});

test("the loader reads exceptions, facilities and documents — the inventory is not optional", () => {
  // The document inventory is the one item F1's whole path depends on; a loader
  // that quietly stopped reading it would leave the model looking stupid.
  const db = fakeDb(LIVE);
  return buildExceptionProfile(EXCEPTION_ID, { client: db }).then(() => {
    assert.deepEqual(db.reads, ["exceptions", "facilities", "documents"]);
  });
});

test("an exception id that is not a uuid is a 404, not a database round trip", async () => {
  const db = fakeDb(LIVE);
  await assert.rejects(() => buildExceptionProfile("not-a-uuid", { client: db }), (e) => e instanceof ExceptionNotFound && e.status === 404);
  assert.deepEqual(db.reads, []);
});

test("an exception that does not exist is a 404", async () => {
  await assert.rejects(
    () => buildExceptionProfile("00000000-0000-0000-0000-000000000000", { client: fakeDb(LIVE) }),
    (e) => e instanceof ExceptionNotFound && /No exception/.test(e.message),
  );
});

test("an exception naming a facility that does not exist is a 404, not a prompt with a blank borrower", async () => {
  const orphan = { ...LIVE, facilities: [] };
  await assert.rejects(
    () => buildExceptionProfile(EXCEPTION_ID, { client: fakeDb(orphan) }),
    (e) => e instanceof ExceptionNotFound && /which does not exist/.test(e.message),
  );
});

test("a database error is raised, never silently treated as 'no documents'", async () => {
  await assert.rejects(
    () => buildExceptionProfile(EXCEPTION_ID, { client: fakeDb(LIVE, "documents") }),
    (e) => /read documents: forced documents failure/.test(e.message),
  );
});

// ------------------------------------------------------------- the lessons

test("topLessons passes the profile and the run_id straight through to the lesson search", () => {
  const calls = [];
  const search = async (input) => { calls.push(input); return []; };
  return topLessons(FACILITY_ID, "a profile", 3, { search }, "cold-pass").then((out) => {
    assert.deepEqual(out, []);
    assert.deepEqual(calls, [{ facilityId: FACILITY_ID, exceptionProfile: "a profile", k: 3, runId: "cold-pass" }]);
  });
});

test("the default is three lessons, as spec §4.2 step 2 says", () => {
  assert.equal(DEFAULT_LESSON_COUNT, 3);
  const calls = [];
  return topLessons(FACILITY_ID, "p", undefined, { search: async (i) => { calls.push(i); return []; } }).then(() => {
    assert.equal(calls[0].k, 3);
  });
});

test("an empty result is the honest answer today, and is not an error", () => {
  // `reviews` is empty until stage 9, so every investigation runs cold. That is
  // the baseline the warm comparison is measured against.
  return topLessons(FACILITY_ID, "p", 3, { search: async () => [] }).then((out) => assert.deepEqual(out, []));
});

test("a memory outage THROWS rather than returning an empty list", async () => {
  // It used to swallow and return []. That is indistinguishable from "no
  // lessons on file", and the memory effect is a reported metric: a warm run
  // that silently fell back to cold would still be measured as warm.
  //
  // Deciding what to do about it belongs to the caller, which is the one
  // holding a casefile to record the degradation on — see the orchestrator test
  // "a failed lesson search runs the investigation cold AND says so in the trace".
  await assert.rejects(
    () => topLessons(FACILITY_ID, "p", 3, { search: async () => { throw new Error("pgvector is down"); } }),
    /pgvector is down/,
  );
});

test("lessons that are found come back in the order the search returned them", async () => {
  const hits = [
    { lesson_text: "first", pattern_tag: "amendment_addback", case_summary: null, similarity: 0.9 },
    { lesson_text: "second", pattern_tag: "missing_waiver", case_summary: null, similarity: 0.7 },
  ];
  assert.deepEqual(await topLessons(FACILITY_ID, "p", 3, { search: async () => hits }), hits);
});
