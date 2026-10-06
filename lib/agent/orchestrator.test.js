import { test } from "node:test";
import assert from "node:assert/strict";

import { SPECIALIST_NAMES } from "./prompt.ts";
import { CALCULATOR_TOOL as CALCULATOR_TOOL_NAME, MEMORY_UNAVAILABLE_STEP, ranWithoutMemory } from "./trace.ts";
import {
  DRIVABLE_STATUSES,
  callAnyTool,
  CLAIM_GRACE_MS,
  STALL_AFTER_MS,
  STEP_CAP_CHECK,
  TOOL_ROUTES,
  parseToolArguments,
  readMaxSteps,
  startInvestigation,
  stoppedAtCap,
  syncRun,
  toolRequestBody,
} from "./orchestrator.ts";
import {
  AT,
  CASEFILE_ID,
  EXCEPTION_ID,
  FACILITY_ID,
  OTHER_FACILITY,
  casefileRow,
  fakeDb,
  fakeFoundry,
  message,
  requiresAction,
  toolStep,
} from "./fakes.js";

// No network and no database. Foundry is a scripted `fetchImpl`, the tool
// routes are a stub, and the tables are in memory (`./fakes.js`, shared with
// the casefile guardrail's tests so both are held to one model of PostgREST).

const AGENT_OUTPUT = '{"recommendation":"resolve","confidence_basis":"two logged calculations","explanation":"...","claims":[],"calculations":[],"missing_evidence":[],"suggested_tag":"amendment_addback"}';

// ------------------------------------------------------------ the step cap

test("the step cap is read from policy on every sync and is never a constant here", async () => {
  const db = fakeDb({ casefiles: [casefileRow()] });
  const foundry = fakeFoundry({ states: [{ id: "run_1", thread_id: "thread_1", status: "in_progress" }], steps: [[]] });
  const first = await syncRun(CASEFILE_ID, { client: db, foundry, deadlineMs: 0, now: () => AT * 1000 });
  assert.equal(first.max_steps, 8);

  // The Risk Officer moves the lever mid-flight; the next sync must see it.
  db.tables.policy[0].value = 3;
  const second = await syncRun(CASEFILE_ID, { client: db, foundry, deadlineMs: 0, now: () => AT * 1000 });
  assert.equal(second.max_steps, 3);
});

test("a missing or malformed max_steps refuses the sync rather than assuming one", async () => {
  for (const value of [undefined, 0, -1, 2.5, "8", null]) {
    const policy = value === undefined ? [] : [{ key: "max_steps", value }];
    await assert.rejects(
      () => readMaxSteps(fakeDb({ policy })),
      /policy\.max_steps is missing or not a positive integer/,
      `max_steps ${JSON.stringify(value)} was accepted`,
    );
  }
});

test("a run that wants ANOTHER tool at the cap is stopped, noted, and enforced as an abstain — never a guess", async () => {
  const db = fakeDb({ casefiles: [casefileRow()], policy: [{ key: "max_steps", value: 2 }] });
  const foundry = fakeFoundry({
    states: [requiresAction("dscr_calculator")],
    steps: [[toolStep("search_documents", { query: "a" }, "[]", AT), toolStep("dscr_calculator", { terms: {}, financials: {} }, "{}", AT + 2)]],
    messages: [],
  });
  const result = await syncRun(CASEFILE_ID, { client: db, foundry, now: () => AT * 1000 });

  assert.equal(result.stopped, "step_cap");
  assert.equal(result.steps, 2);
  assert.match(result.error, /step cap of 2/);
  assert.ok(foundry.fetchImpl.seen.some((c) => c.url.includes("/cancel")), "the run was not cancelled");

  const casefile = db.tables.casefiles[0];
  // Spec 6.1: step cap reached -> abstain ("investigation incomplete"). The
  // abstain and the move to review are the casefile guardrail's, and both
  // happened: this sync handed the capped casefile to enforcement.
  assert.equal(result.casefile_status, "pending_review");
  assert.equal(casefile.status, "pending_review");
  assert.equal(casefile.recommendation, "abstain");
  // The cap note is FIRST and intact: enforcement appended after it (E-6).
  assert.deepEqual(casefile.guardrail_notes[0], {
    layer: "policy", check: "max_steps", action: "end_run", detail: "the investigation reached the step cap of 2 after 2 steps and was stopped",
  });
  assert.ok(casefile.guardrail_notes.some((n) => n.check === "step_cap" && n.action === "abstain" && /investigation incomplete/.test(n.detail)));
  assert.ok(!casefile.guardrail_notes.some((n) => n.action === "not_checked"), "the step-cap check did not run");
  assert.equal(casefile.summary, undefined);
});

test("the cap is checked before any tool call is serviced, so reaching it buys no extra step", async () => {
  const db = fakeDb({ casefiles: [casefileRow()], policy: [{ key: "max_steps", value: 1 }] });
  const calls = [];
  const foundry = fakeFoundry({
    states: [{
      id: "run_1",
      thread_id: "thread_1",
      status: "requires_action",
      required_action: { type: "submit_tool_outputs", submit_tool_outputs: { tool_calls: [{ id: "call_1", type: "function", function: { name: "dscr_calculator", arguments: "{}" } }] } },
    }],
    steps: [[toolStep("search_documents", { query: "a" }, "[]")]],
  });
  const result = await syncRun(CASEFILE_ID, { client: db, foundry, now: () => AT * 1000, callTool: async (n, a) => { calls.push(n); return "{}"; } });
  assert.equal(result.stopped, "step_cap");
  assert.deepEqual(calls, [], "a tool was called after the cap was already reached");
});

test("a capped investigation stays capped: a later sync does not rewrite it as a failure", async () => {
  // The cap CANCELS the Foundry run, so the next sync sees `cancelled`. Without
  // this guard it cannot tell our own cancel from a platform outage, and it
  // rewrites a policy decision as a failure — losing the note that recorded it.
  const capNote = { layer: "policy", check: STEP_CAP_CHECK, action: "end_run", detail: "stopped at 2" };
  const db = fakeDb({ casefiles: [casefileRow({ steps_count: 2, guardrail_notes: [capNote] })] });
  const foundry = fakeFoundry({ states: [{ id: "run_1", thread_id: "thread_1", status: "cancelled" }], steps: [[]] });
  const result = await syncRun(CASEFILE_ID, { client: db, foundry, now: () => AT * 1000 });

  assert.equal(result.stopped, "step_cap");
  // Not failed. A capped casefile not yet enforced is enforced now — an
  // abstain an analyst sees, which is a result, where a failure is not.
  assert.equal(result.casefile_status, "pending_review");
  assert.equal(db.tables.casefiles[0].status, "pending_review");
  assert.equal(db.tables.casefiles[0].recommendation, "abstain");
  assert.equal(db.tables.casefiles[0].summary, undefined);
  assert.deepEqual(db.tables.casefiles[0].guardrail_notes[0], capNote, "the cap note was overwritten");
  // Nothing was asked of Foundry at all: no run to drive, and no retry past the cap.
  assert.deepEqual(foundry.fetchImpl.seen, []);
});

test("stoppedAtCap recognises only the policy note that ended a run", () => {
  assert.equal(stoppedAtCap([{ layer: "policy", check: STEP_CAP_CHECK, action: "end_run", detail: "x" }]), true);
  assert.equal(stoppedAtCap([{ layer: "policy", check: STEP_CAP_CHECK, action: "abstain", detail: "x" }]), false);
  assert.equal(stoppedAtCap([{ layer: "guardrail", check: "quote_verified", action: "end_run" }]), false);
  for (const notes of [null, undefined, [], "max_steps", {}]) assert.equal(stoppedAtCap(notes), false, String(notes));
});

test("a run still CONCLUDING at the cap is left alone, and its answer is kept", async () => {
  // I-5: cancelling the moment the count is reached threw away the answer of a
  // run that had finished investigating and was writing it up — and policy.js
  // accepts an escalate or a request at the cap, so that was an answer the
  // policy engine would have kept.
  const db = fakeDb({ casefiles: [casefileRow()], policy: [{ key: "max_steps", value: 1 }] });
  const foundry = fakeFoundry({
    states: [
      { id: "run_1", thread_id: "thread_1", status: "in_progress" },
      { id: "run_1", thread_id: "thread_1", status: "completed" },
    ],
    steps: [[toolStep("search_documents", { query: "a" }, "[]")], [toolStep("search_documents", { query: "a" }, "[]")]],
    messages: [message(AGENT_OUTPUT)],
    // The run finishes writing up under its own steam, with no tool call to
    // service — which is the case this test exists for.
    advanceOnPoll: true,
  });
  const result = await syncRun(CASEFILE_ID, { client: db, foundry, now: () => AT * 1000, sleep: async () => {} });

  assert.equal(result.run_status, "completed");
  assert.equal(result.output, AGENT_OUTPUT);
  assert.equal(result.stopped, "step_cap", "the cap must still be reported: policy.js downgrades a resolve at the cap");
  assert.equal(db.tables.casefiles[0].agent_output, AGENT_OUTPUT);
  assert.ok(stoppedAtCap(db.tables.casefiles[0].guardrail_notes));
  // It was never cancelled: the cap limits TOOL CALLS, not the right to conclude.
  assert.equal(foundry.fetchImpl.seen.filter((c) => c.url.includes("/cancel")).length, 0);
});

test("an answer already written when the cap stops the run is salvaged, not discarded", async () => {
  const db = fakeDb({ casefiles: [casefileRow()], policy: [{ key: "max_steps", value: 1 }] });
  const foundry = fakeFoundry({
    states: [requiresAction("dscr_calculator")],
    steps: [[toolStep("search_documents", { query: "a" }, "[]")]],
    messages: [message(AGENT_OUTPUT)],
  });
  const result = await syncRun(CASEFILE_ID, { client: db, foundry, now: () => AT * 1000 });
  assert.equal(result.stopped, "step_cap");
  assert.equal(result.output, AGENT_OUTPUT);
  assert.match(result.error, /Its answer was captured before the run was stopped/);
  assert.equal(db.tables.casefiles[0].agent_output, AGENT_OUTPUT);
  assert.ok(foundry.fetchImpl.seen.some((c) => c.url.includes("/cancel")));
});

test("a capped run with nothing said is reported as incomplete, with no invented answer", async () => {
  const db = fakeDb({ casefiles: [casefileRow()], policy: [{ key: "max_steps", value: 1 }] });
  const foundry = fakeFoundry({
    states: [requiresAction("dscr_calculator")],
    steps: [[toolStep("search_documents", { query: "a" }, "[]")]],
    messages: [],
  });
  const result = await syncRun(CASEFILE_ID, { client: db, foundry, now: () => AT * 1000 });
  assert.equal(result.output, null);
  assert.match(result.error, /No recommendation was produced/);
  assert.equal(db.tables.casefiles[0].agent_output, null, "an answer was invented");
});

test("while a run is still concluding at the cap, no cap note is written, so the next sync waits too", async () => {
  // The note is what marks the cap FINAL. Writing it early would make the next
  // sync return straight away and lose the answer still on its way.
  const db = fakeDb({ casefiles: [casefileRow()], policy: [{ key: "max_steps", value: 1 }] });
  const foundry = fakeFoundry({
    states: [{ id: "run_1", thread_id: "thread_1", status: "in_progress" }],
    steps: [[toolStep("search_documents", { query: "a" }, "[]")]],
  });
  const result = await syncRun(CASEFILE_ID, { client: db, foundry, deadlineMs: 0, now: () => AT * 1000 });
  assert.equal(result.stopped, null);
  assert.equal(db.tables.casefiles[0].guardrail_notes, undefined);
});

// -------------------------------------------------- one sync per casefile

test("three concurrent syncs become one: the same tool call is serviced exactly once", async () => {
  // I-2: stage 9 polls every second and a sync runs for up to 25, so
  // overlapping syncs are the normal case. Two of them service the SAME tool
  // call: the calculator runs twice, leaving duplicate calc_log rows on the
  // casefile — noise in the one record the guardrail checks every figure
  // against — and the loser's submit_tool_outputs is rejected.
  //
  // The first version of this test passed with the lock DELETED, because the
  // old fake advanced its run state on every GET, so two syncs could never both
  // see `requires_action` (finding N-3). `fakeFoundry` now only advances when
  // the run is actually advanced, so without the lock these three syncs really
  // do service the calculator three times.
  const db = fakeDb({ casefiles: [casefileRow()] });
  const calls = [];
  const foundry = fakeFoundry({
    states: [requiresAction("dscr_calculator"), { id: "run_1", thread_id: "thread_1", status: "completed" }],
    steps: [[], [toolStep("dscr_calculator", { terms: {}, financials: {} }, "{}")]],
    messages: [message(AGENT_OUTPUT)],
  });
  const deps = {
    client: db,
    foundry,
    now: () => AT * 1000,
    // An await inside the tool call is what gives the other syncs a chance to
    // interleave, which is exactly what happens over a real HTTP call.
    callTool: async (n) => { await Promise.resolve(); calls.push(n); return "{}"; },
  };
  const results = await Promise.all([syncRun(CASEFILE_ID, deps), syncRun(CASEFILE_ID, deps), syncRun(CASEFILE_ID, deps)]);

  assert.deepEqual(calls, ["dscr_calculator"], `the calculator ran ${calls.length} times for one tool call`);
  assert.equal(foundry.fetchImpl.seen.filter((c) => c.url.includes("submit_tool_outputs")).length, 1);
  // All three callers get the same answer, so none of them sees a partial run.
  for (const r of results) assert.deepEqual(r, results[0]);
  assert.equal(results[0].run_status, "completed");
});

test("a sync that has finished releases the casefile, so the next poll drives it", async () => {
  const db = fakeDb({ casefiles: [casefileRow()] });
  const script = () =>
    fakeFoundry({
      states: [{ id: "run_1", thread_id: "thread_1", status: "in_progress" }],
      steps: [[toolStep("search_documents", { query: "a" }, "[]")]],
    });
  const first = await syncRun(CASEFILE_ID, { client: db, foundry: script(), deadlineMs: 0, now: () => AT * 1000 });
  const second = fakeFoundry({ states: [{ id: "run_1", thread_id: "thread_1", status: "in_progress" }], steps: [[]] });
  await syncRun(CASEFILE_ID, { client: db, foundry: second, deadlineMs: 0, now: () => AT * 1000 });
  assert.equal(first.run_status, "in_progress");
  assert.ok(second.fetchImpl.seen.length > 0, "the lock was never released");
});

test("a repeat sync on a capped casefile returns the answer it captured, not an empty promise", async () => {
  // N-1: `agent_output` was read here but never in the select list, so every
  // repeat sync said "its answer was captured" and returned nothing. `fakeDb`
  // honours the select list now, which is what makes this catchable at all.
  const capNote = { layer: "policy", check: STEP_CAP_CHECK, action: "end_run", detail: "stopped at 2" };
  const db = fakeDb({ casefiles: [casefileRow({ steps_count: 2, guardrail_notes: [capNote], agent_output: AGENT_OUTPUT })] });
  const foundry = fakeFoundry({ states: [{ id: "run_1", thread_id: "thread_1", status: "cancelled" }], steps: [[]] });
  const result = await syncRun(CASEFILE_ID, { client: db, foundry, now: () => AT * 1000 });

  assert.equal(result.stopped, "step_cap");
  assert.equal(result.output, AGENT_OUTPUT, "the captured answer was not returned");
  assert.match(result.error, /Its answer was captured/);
  assert.deepEqual(foundry.fetchImpl.seen, []);
});

test("a capped casefile that captured nothing says so, and promises no answer", async () => {
  // Null, empty and absent all mean "nothing was said". Reporting any of them
  // as an answer that was captured would claim an answer that does not exist.
  const capNote = { layer: "policy", check: STEP_CAP_CHECK, action: "end_run", detail: "stopped at 2" };
  for (const agent_output of [null, "", undefined]) {
    const db = fakeDb({ casefiles: [casefileRow({ steps_count: 2, guardrail_notes: [capNote], agent_output })] });
    const result = await syncRun(CASEFILE_ID, { client: db, now: () => AT * 1000 });
    assert.equal(result.output, null, String(agent_output));
    assert.match(result.error, /No recommendation was produced/, String(agent_output));
  }
});

// ----------------------------------------------------- mirroring the trace

test("a clean finish mirrors the whole trace, stores the raw output, and only enforcement moves it to review", async () => {
  const db = fakeDb({ casefiles: [casefileRow()] });
  const foundry = fakeFoundry({
    states: [{ id: "run_1", thread_id: "thread_1", status: "completed" }],
    steps: [[
      toolStep("search_documents", { query: "amendment" }, "[]", AT),
      toolStep("definition_agent", { query: "re-map" }, "terms", AT + 2, "connected"),
      toolStep("dscr_calculator", { terms: {}, financials: {} }, '{"dscr":1.28,"threshold":1.25,"pass":true,"calc_id":"abcdef12-0000-0000-0000-000000000000"}', AT + 4),
    ]],
    messages: [message(AGENT_OUTPUT)],
  });
  const result = await syncRun(CASEFILE_ID, { client: db, foundry, now: () => AT * 1000 });

  assert.equal(result.run_status, "completed");
  assert.equal(result.casefile_status, "pending_review");
  assert.equal(result.steps, 3);
  assert.equal(result.output, AGENT_OUTPUT);

  const casefile = db.tables.casefiles[0];
  assert.deepEqual(casefile.trace.map((e) => [e.n, e.tool]), [[1, "search_documents"], [2, "definition_agent"], [3, "dscr_calculator"]]);
  assert.equal(casefile.steps_count, 3);
  assert.equal(casefile.agent_output, AGENT_OUTPUT);
  // NOT `summary`: that is the memory surface and would leak raw agent JSON
  // into a later investigation's brief as if it were a lesson (I-3).
  assert.equal(casefile.summary, undefined);
  // The answer reached review POLICED: it said resolve with no calculation
  // logged, and the guardrail downgraded it. The agent's word is not the record.
  assert.equal(casefile.status, "pending_review");
  assert.equal(casefile.recommendation, "escalate");
  assert.ok(casefile.guardrail_notes.some((n) => n.check === "resolve_requires_evidence"));
  assert.equal(db.tables.exceptions[0].status, "pending_review");
});

test("nothing in a sync writes to tests or covenant_terms", async () => {
  // A recomputation mid-investigation never amends the originating test: that
  // row records what the APPROVED terms produced, which is the audit fact.
  const db = fakeDb({ casefiles: [casefileRow()] });
  const foundry = fakeFoundry({
    states: [{ id: "run_1", thread_id: "thread_1", status: "completed" }],
    steps: [[toolStep("dscr_calculator", { terms: {}, financials: {} }, "{}")]],
    messages: [message(AGENT_OUTPUT)],
  });
  await syncRun(CASEFILE_ID, { client: db, foundry, now: () => AT * 1000 });
  const touched = db.writes.filter((w) => w.table === "tests" || w.table === "covenant_terms");
  assert.deepEqual(touched, []);
});

test("syncing twice produces the same trace rather than a doubled one", async () => {
  const db = fakeDb({ casefiles: [casefileRow()] });
  const script = () =>
    fakeFoundry({
      states: [{ id: "run_1", thread_id: "thread_1", status: "completed" }],
      steps: [[toolStep("search_documents", { query: "a" }, "[]")]],
      messages: [message(AGENT_OUTPUT)],
    });
  await syncRun(CASEFILE_ID, { client: db, foundry: script(), now: () => AT * 1000 });
  const first = db.tables.casefiles[0].trace;
  await syncRun(CASEFILE_ID, { client: db, foundry: script(), now: () => AT * 1000 });
  assert.deepEqual(db.tables.casefiles[0].trace, first);
});

// -------------------------------------------------------- servicing a tool

test("an unchanged trace is not rewritten on every poll", async () => {
  // A completed step's summaries never change once mapped, so an unchanged
  // length means an unchanged trace. Without the skip, a poll loop rewrites the
  // same array every second and-a-half for the life of the run.
  const db = fakeDb({ casefiles: [casefileRow({ steps_count: 1 })] });
  const foundry = fakeFoundry({
    states: [{ id: "run_1", thread_id: "thread_1", status: "in_progress" }],
    steps: [[toolStep("search_documents", { query: "a" }, "[]")]],
  });
  await syncRun(CASEFILE_ID, { client: db, foundry, deadlineMs: 0, now: () => AT * 1000 });
  assert.deepEqual(db.writes.filter((w) => w.table === "casefiles"), []);
});

test("a trace that grew IS written, with the step clock moved on", async () => {
  const db = fakeDb({ casefiles: [casefileRow({ steps_count: 0 })] });
  const foundry = fakeFoundry({
    states: [{ id: "run_1", thread_id: "thread_1", status: "in_progress" }],
    steps: [[toolStep("search_documents", { query: "a" }, "[]")]],
  });
  await syncRun(CASEFILE_ID, { client: db, foundry, deadlineMs: 0, now: () => AT * 1000 });
  const write = db.writes.find((w) => w.table === "casefiles");
  assert.equal(write.payload.steps_count, 1);
  assert.equal(write.payload.trace.length, 1);
  assert.equal(write.payload.last_step_at, new Date(AT * 1000).toISOString());
});

test("requires_action is serviced by calling our own routes, then the outputs are submitted", async () => {
  const db = fakeDb({ casefiles: [casefileRow()] });
  const asked = [];
  const foundry = fakeFoundry({
    states: [
      {
        id: "run_1",
        thread_id: "thread_1",
        status: "requires_action",
        required_action: {
          type: "submit_tool_outputs",
          submit_tool_outputs: { tool_calls: [{ id: "call_1", type: "function", function: { name: "search_documents", arguments: '{"query":"amendment"}' } }] },
        },
      },
      { id: "run_1", thread_id: "thread_1", status: "completed" },
    ],
    steps: [[], [toolStep("search_documents", { query: "amendment" }, "[]")]],
    messages: [message(AGENT_OUTPUT)],
  });
  const result = await syncRun(CASEFILE_ID, {
    client: db,
    foundry,
    now: () => AT * 1000,
    callTool: async (name, args, ctx) => { asked.push({ name, args, ctx }); return "[]"; },
  });
  assert.equal(result.run_status, "completed");
  assert.equal(asked.length, 1);
  assert.equal(asked[0].name, "search_documents");
  assert.deepEqual(asked[0].ctx, { casefileId: CASEFILE_ID, facilityId: FACILITY_ID, runId: "demo", periodEnd: "2026-06-30" });
  const submit = foundry.fetchImpl.seen.find((c) => c.url.includes("submit_tool_outputs"));
  assert.deepEqual(submit.body.tool_outputs, [{ tool_call_id: "call_1", output: "[]" }]);
});

// ------------------------------------------------- parsing the model's args

test("well-formed arguments parse, and empty arguments mean an empty object", () => {
  assert.deepEqual(parseToolArguments('{"query":"amendment"}'), { args: { query: "amendment" } });
  assert.deepEqual(parseToolArguments(""), { args: {} });
  assert.deepEqual(parseToolArguments(undefined), { args: {} });
});

test("a complete object followed by a stray brace is recovered, because that is what the model emits", () => {
  // Observed live: three calculator calls in one run carried a complete JSON
  // object plus a trailing "}". Discarding characters AFTER a complete value
  // infers nothing — every field still comes from the model.
  assert.deepEqual(parseToolArguments('{"terms":{"a":1}} }'), { args: { terms: { a: 1 } } });
  assert.deepEqual(parseToolArguments('{"a":1}}'), { args: { a: 1 } });
  assert.deepEqual(parseToolArguments('{"a":1} {"b":2}'), { args: { a: 1 } });
});

test("a brace inside a string is not a brace", () => {
  assert.deepEqual(parseToolArguments('{"q":"a } b"} }'), { args: { q: "a } b" } });
  assert.deepEqual(parseToolArguments('{"q":"he said \\"}\\" loudly"}'), { args: { q: 'he said "}" loudly' } });
});

test("TRUNCATED arguments are refused, because a half-finished object is missing fields", () => {
  // Accepting one would be the calculator reading a missing value as
  // absent-by-choice, which is the silent gap-filling the design forbids.
  const cut = '{"terms":{"threshold":{"min_dscr":1.25},"numerator":{"addbacks":[{"name":"Owner compensation';
  const refused = parseToolArguments(cut);
  assert.ok("error" in refused);
  assert.match(refused.error, /cut off mid-way/);
  assert.ok("error" in parseToolArguments("not json at all"));
});

test("arguments that are not valid JSON go back to the model as an error, not a crash", async () => {
  const db = fakeDb({ casefiles: [casefileRow()] });
  const foundry = fakeFoundry({
    states: [
      {
        id: "run_1",
        thread_id: "thread_1",
        status: "requires_action",
        required_action: { type: "submit_tool_outputs", submit_tool_outputs: { tool_calls: [{ id: "call_1", type: "function", function: { name: "dscr_calculator", arguments: "{not json" } }] } },
      },
      { id: "run_1", thread_id: "thread_1", status: "completed" },
    ],
    steps: [[], []],
    messages: [message(AGENT_OUTPUT)],
  });
  await syncRun(CASEFILE_ID, { client: db, foundry, now: () => AT * 1000, callTool: async () => "{}" });
  const submit = foundry.fetchImpl.seen.find((c) => c.url.includes("submit_tool_outputs"));
  assert.match(submit.body.tool_outputs[0].output, /cut off mid-way|not valid JSON/);
});

test("a requires_action we cannot service fails the casefile instead of hanging", async () => {
  const db = fakeDb({ casefiles: [casefileRow()] });
  const foundry = fakeFoundry({
    states: [{ id: "run_1", thread_id: "thread_1", status: "requires_action", required_action: { type: "something_new" } }],
    steps: [[]],
  });
  const result = await syncRun(CASEFILE_ID, { client: db, foundry, now: () => AT * 1000 });
  assert.equal(result.casefile_status, "failed");
  assert.match(result.error, /waiting on an action we cannot service/);
});

// -------------------------------------------------- forcing the tool fields

test("facility_id is forced, so the model cannot read another borrower's documents into this casefile", () => {
  const ctx = { casefileId: CASEFILE_ID, facilityId: FACILITY_ID, runId: "demo", periodEnd: "2026-06-30" };
  const body = toolRequestBody("search_documents", { facility_id: OTHER_FACILITY, query: "threshold" }, ctx);
  assert.equal(body.facility_id, FACILITY_ID);
  assert.equal(body.query, "threshold");
});

test("casefile_id is forced, so every calculation lands in calc_log against this investigation", () => {
  const ctx = { casefileId: CASEFILE_ID, facilityId: FACILITY_ID, runId: "demo", periodEnd: "2026-06-30" };
  const body = toolRequestBody("dscr_calculator", { terms: {}, financials: {}, casefile_id: "11111111-1111-1111-1111-111111111111" }, ctx);
  assert.equal(body.casefile_id, CASEFILE_ID);
});

test("the calculator's facility_id comes from the CONTEXT, never the model: its figures are verified against this borrower's financials", () => {
  // The calculator checks each figure against the financials chunk the model
  // cited, and facility_id decides whose financials. A model naming another
  // borrower could make its figures verify against that borrower's documents.
  const ctx = { casefileId: CASEFILE_ID, facilityId: FACILITY_ID, runId: "demo", periodEnd: "2026-06-30" };
  const args = { terms: {}, financials: { ebitda: 1 }, financial_citations: { ebitda: "Fin Q2 2026 §1" } };
  // the model names another facility: the context wins
  assert.equal(toolRequestBody("dscr_calculator", { ...args, facility_id: OTHER_FACILITY }, ctx).facility_id, FACILITY_ID);
  // the model names none: the context supplies it, so the route's 400 never fires on our own call
  assert.equal(toolRequestBody("dscr_calculator", args, ctx).facility_id, FACILITY_ID);
  // nothing else the model sent is touched
  const body = toolRequestBody("dscr_calculator", { ...args, facility_id: OTHER_FACILITY }, ctx);
  assert.deepEqual(body, { ...args, casefile_id: CASEFILE_ID, facility_id: FACILITY_ID, period_end: "2026-06-30" });
});

test("the calculator's period_end comes from the CONTEXT, never the model: another quarter's financials cannot become evidence", () => {
  // The period decides which financials document the citations must name. A
  // model choosing it could pass a prior quarter's passing figures as this one's.
  const ctx = { casefileId: CASEFILE_ID, facilityId: FACILITY_ID, runId: "demo", periodEnd: "2026-06-30" };
  const args = { terms: {}, financials: {}, financial_citations: {} };
  assert.equal(toolRequestBody("dscr_calculator", { ...args, period_end: "2025-12-31" }, ctx).period_end, "2026-06-30");
  assert.equal(toolRequestBody("dscr_calculator", args, ctx).period_end, "2026-06-30");
  // the other tools are not given one
  assert.equal(toolRequestBody("search_documents", { query: "q" }, ctx).period_end, undefined);
});

test("a specialist reads the CASEFILE's facility, never the one the model named", async () => {
  // The glue in `callAnyTool` had no test at all: making it prefer the model's
  // `facility_id` over the exception's still passed every agent test. Nothing
  // stopped a later edit from making the model's claim authoritative, and
  // cross-facility retrieval is the worst bug available in this system.
  const handed = [];
  const spy = async (args, specialistCtx) => { handed.push(specialistCtx); return "{}"; };
  const ctx = { casefileId: CASEFILE_ID, facilityId: FACILITY_ID, runId: "demo", periodEnd: "2026-06-30" };

  for (const name of SPECIALIST_NAMES) {
    await callAnyTool(
      name,
      // Every shape a model might use to try to steer it.
      { question: "q", gap: "g", facility_id: OTHER_FACILITY, facilityId: OTHER_FACILITY, periodEnd: "2020-01-01" },
      ctx,
      { specialists: { [name]: spy } },
    );
  }
  assert.equal(handed.length, SPECIALIST_NAMES.length);
  for (const given of handed) {
    assert.equal(given.facilityId, FACILITY_ID, "a specialist was pointed at another borrower");
    assert.equal(given.periodEnd, "2026-06-30");
  }
});

test("end to end, the facility a specialist reads comes from the exception row", async () => {
  // The strongest version: no callTool injection, so the real dispatch runs and
  // the context it builds is the one under test.
  const db = fakeDb({ casefiles: [casefileRow()] });
  const handed = [];
  const foundry = fakeFoundry({
    states: [
      requiresAction("document_agent", JSON.stringify({ question: "q", facility_id: OTHER_FACILITY })),
      { id: "run_1", thread_id: "thread_1", status: "completed" },
    ],
    steps: [[], [toolStep("document_agent", { question: "q" }, '{"facts":[]}')]],
    messages: [message(AGENT_OUTPUT)],
  });
  await syncRun(CASEFILE_ID, {
    client: db,
    foundry,
    now: () => AT * 1000,
    specialists: { document_agent: async (args, c) => { handed.push(c); return '{"facts":[]}'; } },
  });
  assert.deepEqual(handed, [{ facilityId: FACILITY_ID, periodEnd: "2026-06-30" }]);
});

test("a route tool's facility_id is forced too, through the same dispatch", async () => {
  const sent = [];
  const ctx = { casefileId: CASEFILE_ID, facilityId: FACILITY_ID, runId: "demo", periodEnd: "2026-06-30" };
  await callAnyTool("search_documents", { query: "q", facility_id: OTHER_FACILITY }, ctx, {
    callRoute: async (name, args, c) => { sent.push({ name, args, c }); return "[]"; },
  });
  assert.equal(sent[0].c.facilityId, FACILITY_ID);
  assert.equal(toolRequestBody("search_documents", sent[0].args, sent[0].c).facility_id, FACILITY_ID);
});

test("a past-case search carries this run's run_id, so a cold pass cannot see warm lessons", () => {
  const ctx = { casefileId: CASEFILE_ID, facilityId: OTHER_FACILITY, runId: "cold-pass", periodEnd: "2026-06-30" };
  const body = toolRequestBody("search_past_cases", { exception_profile: "p", run_id: "warm" }, ctx);
  assert.equal(body.run_id, "cold-pass");
  assert.equal(body.facility_id, OTHER_FACILITY);
});

test("the three OpenAPI tools have routes; the three specialists deliberately do not", () => {
  // The specialists are serviced in-process because lib/agent/openapi.ts is
  // stage 10's and stays untouched, so there is no route to document them in.
  assert.deepEqual(Object.keys(TOOL_ROUTES).sort(), ["dscr_calculator", "search_documents", "search_past_cases"]);
  for (const name of SPECIALIST_NAMES) assert.equal(TOOL_ROUTES[name], undefined, name);
});

test("a specialist tool call is dispatched to its runner, with the facility and period from the casefile", async () => {
  const db = fakeDb({ casefiles: [casefileRow()] });
  const foundry = fakeFoundry({
    states: [requiresAction("definition_agent", "{}"), { id: "run_1", thread_id: "thread_1", status: "completed" }],
    steps: [[], [toolStep("definition_agent", {}, '{"terms":{}}', AT, "connected")]],
    messages: [message(AGENT_OUTPUT)],
  });
  const asked = [];
  await syncRun(CASEFILE_ID, {
    client: db,
    foundry,
    now: () => AT * 1000,
    callTool: async (name, args, ctx) => { asked.push({ name, ctx }); return '{"terms":{}}'; },
  });
  assert.equal(asked[0].name, "definition_agent");
  assert.equal(asked[0].ctx.facilityId, FACILITY_ID);
  assert.equal(asked[0].ctx.periodEnd, "2026-06-30");
});

// -------------------------------------------------- failure is not a result

test("a failed run leaves the casefile failed with the reason, and nothing that reads as a recommendation", async () => {
  const db = fakeDb({ casefiles: [casefileRow()] });
  db.tables.exceptions[0].status = "investigating";
  const foundry = fakeFoundry({
    states: [{ id: "run_1", thread_id: "thread_1", status: "failed", last_error: { code: "server_error", message: "the model deployment was throttled" } }],
    steps: [[toolStep("search_documents", { query: "a" }, "[]")]],
  });
  const result = await syncRun(CASEFILE_ID, { client: db, foundry, now: () => AT * 1000 });

  assert.equal(result.casefile_status, "failed");
  assert.match(result.error, /the model deployment was throttled/);
  assert.equal(result.output, null);

  const casefile = db.tables.casefiles[0];
  assert.equal(casefile.status, "failed");
  assert.match(JSON.stringify(casefile.guardrail_notes), /throttled/);
  assert.equal(casefile.summary, undefined);
  assert.equal(casefile.recommendation, undefined);
  assert.equal(casefile.explanation, undefined);
  // The exception returns to the queue so it can be retried.
  assert.equal(db.tables.exceptions[0].status, "new");
  // The steps that did happen are still mirrored: the trace is the audit trail.
  assert.equal(casefile.trace.length, 1);
});

test("cancelled and expired runs fail the casefile too", async () => {
  for (const status of ["cancelled", "expired", "incomplete"]) {
    const db = fakeDb({ casefiles: [casefileRow()] });
    const foundry = fakeFoundry({ states: [{ id: "run_1", thread_id: "thread_1", status }], steps: [[]] });
    const result = await syncRun(CASEFILE_ID, { client: db, foundry, now: () => AT * 1000 });
    assert.equal(result.casefile_status, "failed", status);
    assert.match(JSON.stringify(db.tables.casefiles[0].guardrail_notes), new RegExp(status));
  }
});

test("a run that completes without an answer is a failure, not an empty recommendation", async () => {
  const db = fakeDb({ casefiles: [casefileRow()] });
  const foundry = fakeFoundry({ states: [{ id: "run_1", thread_id: "thread_1", status: "completed" }], steps: [[]], messages: [] });
  const result = await syncRun(CASEFILE_ID, { client: db, foundry, now: () => AT * 1000 });
  assert.equal(result.casefile_status, "failed");
  assert.match(result.error, /completed without producing an answer/);
});

test("a casefile with no Foundry run on it, past the claim window, fails rather than looking as though work is under way", async () => {
  const db = fakeDb({ casefiles: [casefileRow({ foundry_thread_id: null, foundry_run_id: null })] });
  const result = await syncRun(CASEFILE_ID, { client: db, now: () => AT * 1000 + CLAIM_GRACE_MS + 1 });
  assert.equal(result.casefile_status, "failed");
  assert.match(result.error, /never started/);
});

test("O-1: a sync landing between the claim and the run start is 'in progress', not 'never started'", async () => {
  // REFUSES the old reading: failing it here sent the exception back to the
  // queue while the original call went on to start a run nobody would drive.
  const db = fakeDb({ casefiles: [casefileRow({ foundry_thread_id: null, foundry_run_id: null })] });
  db.tables.exceptions[0].status = "investigating";
  for (const elapsed of [0, 1_500, CLAIM_GRACE_MS - 1]) {
    const result = await syncRun(CASEFILE_ID, { client: db, now: () => AT * 1000 + elapsed });
    assert.equal(result.casefile_status, "investigating", `failed ${elapsed}ms after the claim`);
    assert.equal(result.run_status, "starting");
    assert.equal(result.error, null);
  }
  assert.equal(db.tables.casefiles[0].status, "investigating");
  assert.equal(db.tables.exceptions[0].status, "investigating");
  assert.deepEqual(db.writes, [], "a sync inside the window wrote something");
});

test("O-1, end to end: a sync racing startInvestigation's slow lesson search leaves the casefile to be started", async () => {
  // The real interleaving: the claim is written, the lesson search is in
  // flight, and a poll arrives for the casefile it can already see.
  const db = fakeDb();
  const foundry = fakeFoundry({ states: [{ id: "run_1", thread_id: "thread_1", status: "queued" }], steps: [[]] });
  let polled = null;
  const result = await startInvestigation(EXCEPTION_ID, {
    ...startDeps(db, foundry),
    lessons: async () => {
      const claimed = db.tables.casefiles[0];
      polled = await syncRun(claimed.id, { client: db, foundry, now: () => Date.parse(claimed.created_at) + 2_000 });
      return [];
    },
  });
  assert.equal(polled.casefile_status, "investigating");
  assert.equal(result.status, "investigating");
  assert.equal(db.tables.casefiles[0].status, "investigating");
  assert.equal(db.tables.casefiles[0].foundry_run_id, "run_1", "the run the original call started is recorded and will be driven");
});

test("only an `investigating` casefile is driven: a decided one is not ours to rewrite", async () => {
  // Without this guard a sync on an `approved` casefile whose Foundry run still
  // reads `completed` would overwrite the output under a decision a human has
  // already signed (I-3).
  assert.deepEqual(DRIVABLE_STATUSES, ["investigating"]);
  for (const status of ["failed", "pending_review", "approved", "overridden", "awaiting_docs"]) {
    const db = fakeDb({ casefiles: [casefileRow({ status })] });
    const foundry = fakeFoundry({
      states: [{ id: "run_1", thread_id: "thread_1", status: "completed" }],
      steps: [[toolStep("search_documents", { query: "a" }, "[]")]],
      messages: [message(AGENT_OUTPUT)],
    });
    const result = await syncRun(CASEFILE_ID, { client: db, foundry, now: () => AT * 1000 });
    assert.match(result.error, new RegExp(`is ${status} and is no longer being driven`), status);
    assert.equal(db.tables.casefiles[0].agent_output, null, status);
    assert.deepEqual(foundry.fetchImpl.seen, [], `${status}: Foundry was called anyway`);
  }
});

test("a run that has produced no step for a long time is stopped as stalled", async () => {
  // A connected agent's inner run can park where we cannot see it and never
  // come back, leaving the parent in_progress indefinitely.
  const db = fakeDb({ casefiles: [casefileRow()] });
  const foundry = fakeFoundry({ states: [{ id: "run_1", thread_id: "thread_1", status: "in_progress" }], steps: [[]] });
  const result = await syncRun(CASEFILE_ID, { client: db, foundry, now: () => AT * 1000 + STALL_AFTER_MS + 1000 });
  assert.equal(result.stopped, null);
  assert.equal(result.casefile_status, "failed");
  assert.match(result.error, /stalled/);
  assert.ok(foundry.fetchImpl.seen.some((c) => c.url.includes("/cancel")));
});

test("a run still working within the stall window is handed back, not failed", async () => {
  const db = fakeDb({ casefiles: [casefileRow()] });
  const foundry = fakeFoundry({ states: [{ id: "run_1", thread_id: "thread_1", status: "in_progress" }], steps: [[]] });
  const result = await syncRun(CASEFILE_ID, { client: db, foundry, deadlineMs: 0, now: () => AT * 1000 + 5_000 });
  assert.equal(result.run_status, "in_progress");
  assert.equal(result.casefile_status, "investigating");
  assert.equal(db.tables.casefiles[0].status, "investigating");
});

test("an unknown casefile is a 404", async () => {
  await assert.rejects(() => syncRun("00000000-0000-0000-0000-000000000000", { client: fakeDb() }), (e) => e.status === 404);
  await assert.rejects(() => syncRun("not-a-uuid", { client: fakeDb() }), (e) => e.status === 400);
});

// ----------------------------------------------------------- starting a run

const startDeps = (db, foundry) => ({ client: db, foundry, agentId: "asst_live", lessons: async () => [], now: () => AT * 1000 });

test("starting an investigation creates the casefile, stores the run and marks the exception", async () => {
  const db = fakeDb();
  const foundry = fakeFoundry({ states: [{ id: "run_1", thread_id: "thread_1", status: "queued" }], steps: [[]] });
  const result = await startInvestigation(EXCEPTION_ID, startDeps(db, foundry));

  assert.equal(result.reused, false);
  assert.equal(result.status, "investigating");
  const casefile = db.tables.casefiles[0];
  assert.equal(casefile.id, result.casefileId);
  assert.equal(casefile.foundry_thread_id, "thread_1");
  assert.equal(casefile.foundry_run_id, "run_1");
  assert.equal(db.tables.exceptions[0].status, "investigating");
});

test("the casefile exists BEFORE the prompt, so every calculation can be logged against it", async () => {
  const db = fakeDb();
  const foundry = fakeFoundry({ states: [{ id: "run_1", thread_id: "thread_1", status: "queued" }], steps: [[]] });
  const result = await startInvestigation(EXCEPTION_ID, startDeps(db, foundry));
  const start = foundry.fetchImpl.seen.find((c) => c.url.includes("/threads/runs"));
  assert.match(start.body.thread.messages[0].content, new RegExp(`casefile_id: ${result.casefileId}`));
});

test("the brief Foundry receives carries the document inventory, including the unboarded amendment", async () => {
  // Without it F1's path is unreachable and the dead end reads as model failure.
  const db = fakeDb();
  const foundry = fakeFoundry({ states: [{ id: "run_1", thread_id: "thread_1", status: "queued" }], steps: [[]] });
  await startInvestigation(EXCEPTION_ID, startDeps(db, foundry));
  const brief = foundry.fetchImpl.seen.find((c) => c.url.includes("/threads/runs")).body.thread.messages[0].content;
  assert.match(brief, /amendment \| Amendment No\. 2 \| effective 2026-04-01/);
  assert.match(brief, /version 1, approved, effective from 2024-03-15/);
  assert.match(brief, /OUR computed DSCR: 1\.12/);
  assert.match(brief, /at most 8 tool calls/);
});

test("investigating the same exception twice returns the SAME casefile and starts nothing", async () => {
  const db = fakeDb();
  const first = fakeFoundry({ states: [{ id: "run_1", thread_id: "thread_1", status: "queued" }], steps: [[]] });
  const a = await startInvestigation(EXCEPTION_ID, startDeps(db, first));
  const second = fakeFoundry({ states: [{ id: "run_2", thread_id: "thread_2", status: "queued" }], steps: [[]] });
  const b = await startInvestigation(EXCEPTION_ID, startDeps(db, second));

  assert.equal(b.casefileId, a.casefileId);
  assert.equal(b.reused, true);
  assert.equal(db.tables.casefiles.length, 1);
  assert.deepEqual(second.fetchImpl.seen.filter((c) => c.url.includes("/threads/runs")), []);
});

test("a FAILED casefile is not reused: that is the retry", async () => {
  const db = fakeDb();
  const foundry = fakeFoundry({ states: [{ id: "run_1", thread_id: "thread_1", status: "queued" }], steps: [[]] });
  const a = await startInvestigation(EXCEPTION_ID, startDeps(db, foundry));
  db.tables.casefiles[0].status = "failed";
  const b = await startInvestigation(EXCEPTION_ID, startDeps(db, foundry));
  assert.notEqual(b.casefileId, a.casefileId);
  assert.equal(db.tables.casefiles.length, 2);
});

test("no approved terms in force refuses the investigation with a 409", async () => {
  const db = fakeDb({ covenant_terms: [] });
  await assert.rejects(
    () => startInvestigation(EXCEPTION_ID, startDeps(db, fakeFoundry({ states: [{}], steps: [[]] }))),
    (e) => e.status === 409 && /No approved covenant terms/.test(e.message),
  );
  assert.deepEqual(db.tables.casefiles, []);
});

test("a proposed terms row never governs an investigation", async () => {
  const db = fakeDb();
  db.tables.covenant_terms[0].status = "proposed";
  await assert.rejects(
    () => startInvestigation(EXCEPTION_ID, startDeps(db, fakeFoundry({ states: [{}], steps: [[]] }))),
    (e) => e.status === 409,
  );
});

test("a run that will not start leaves the casefile failed and the exception untouched", async () => {
  const db = fakeDb();
  const foundry = { token: async () => "t", config: { endpoint: "https://e", apiVersion: "2025-05-01", orchestratorModel: "m", specialistModel: "m" }, fetchImpl: async () => new Response('{"error":"model not supported"}', { status: 400 }) };
  const result = await startInvestigation(EXCEPTION_ID, startDeps(db, foundry));
  assert.equal(result.status, "failed");
  assert.equal(db.tables.casefiles[0].status, "failed");
  // D-6: the reason is a note, like every other failure. NOT `summary`, which is
  // the memory surface a human's review writes and later investigations read.
  assert.equal(db.tables.casefiles[0].summary, undefined);
  assert.deepEqual(db.tables.casefiles[0].guardrail_notes.map((n) => [n.layer, n.check, n.action]), [["run", "foundry_run", "failed"]]);
  assert.match(db.tables.casefiles[0].guardrail_notes[0].detail, /could not be started/);
  // An exception whose investigation never started must not look as though one is under way.
  assert.equal(db.tables.exceptions[0].status, "new");
});

test("R2-4: a memory marker that cannot be written costs a log line, not the investigation", async () => {
  // Throwing after the claim left a casefile `investigating` with no run that
  // nothing would drive — the same orphan as O-1.
  const db = fakeDb();
  const foundry = fakeFoundry({ states: [{ id: "run_1", thread_id: "thread_1", status: "queued" }], steps: [[]] });
  db.failOnce = { table: "casefiles", op: "update", error: { message: "connection reset" } };
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.map(String).join(" "));
  let result;
  try {
    result = await startInvestigation(EXCEPTION_ID, { ...startDeps(db, foundry), lessons: async () => { throw new Error("pgvector is down"); } });
  } finally {
    console.error = original;
  }
  assert.equal(result.status, "investigating");
  assert.equal(db.tables.casefiles[0].foundry_run_id, "run_1", "the run was not started or not recorded");
  assert.equal(db.tables.exceptions[0].status, "investigating");
  assert.ok(logged.some((l) => /marker could not be written/.test(l)), "the lost marker was swallowed silently");
});

test("the casefile is claimed BEFORE the slow work, in that order", async () => {
  // I-1: the lesson search embeds a string over the network. Two POSTs arriving
  // in that window each read no casefile and each start a Foundry run — two
  // traces and two recommendations for one question, both billed.
  //
  // This asserts the ORDER, not merely that both happened. The first version of
  // this test checked `order == ["lessons"]` and the insert's existence
  // separately, and so passed against the unfixed code too (finding N-2).
  const db = fakeDb();
  const foundry = fakeFoundry({ states: [{ id: "run_1", thread_id: "thread_1", status: "queued" }], steps: [[]] });
  await startInvestigation(EXCEPTION_ID, {
    ...startDeps(db, foundry),
    lessons: async () => { db.timeline.push("lessons"); return []; },
  });
  const claimedAt = db.timeline.indexOf("casefiles.insert");
  const lessonsAt = db.timeline.indexOf("lessons");
  assert.ok(claimedAt >= 0, `no casefile was claimed: ${db.timeline.join(" -> ")}`);
  assert.ok(lessonsAt >= 0, `the lesson search never ran: ${db.timeline.join(" -> ")}`);
  assert.ok(
    claimedAt < lessonsAt,
    `the claim must precede the lesson search, got ${db.timeline.join(" -> ")}`,
  );
});

test("the Foundry run is started only AFTER the claim, so losing the race costs no tokens", async () => {
  const db = fakeDb();
  const foundry = fakeFoundry({ states: [{ id: "run_1", thread_id: "thread_1", status: "queued" }], steps: [[]] });
  // Put Foundry's calls on the SAME timeline as the database's, so the two
  // orderings can be compared rather than inspected separately.
  const bare = foundry.fetchImpl;
  foundry.fetchImpl = async (url, init) => {
    if (url.includes("/threads/runs")) db.timeline.push("foundry.start_run");
    return bare(url, init);
  };
  foundry.fetchImpl.seen = bare.seen;
  await startInvestigation(EXCEPTION_ID, {
    ...startDeps(db, foundry),
    lessons: async () => { db.timeline.push("lessons"); return []; },
  });
  assert.deepEqual(
    db.timeline.filter((e) => ["casefiles.insert", "lessons", "foundry.start_run"].includes(e)),
    ["casefiles.insert", "lessons", "foundry.start_run"],
  );
});

test("a failed lesson search runs the investigation cold AND says so in the trace", async () => {
  // The ruling: a memory outage must not kill an investigation, and must not be
  // silent either. The memory effect is one of the success criteria, so a run
  // that quietly fell back to cold would still be MEASURED as warm.
  const db = fakeDb();
  const foundry = fakeFoundry({ states: [{ id: "run_1", thread_id: "thread_1", status: "queued" }], steps: [[]] });
  const result = await startInvestigation(EXCEPTION_ID, {
    ...startDeps(db, foundry),
    lessons: async () => { throw new Error("pgvector is down"); },
  });

  // Cold, not dead: the run still started.
  assert.equal(result.status, "investigating");
  assert.equal(foundry.fetchImpl.seen.filter((c) => c.url.includes("/threads/runs")).length, 1);

  const trace = db.tables.casefiles[0].trace;
  assert.equal(trace.length, 1, "the degradation was not recorded in the trace");
  assert.equal(trace[0].tool, MEMORY_UNAVAILABLE_STEP);
  assert.equal(trace[0].n, 1);
  assert.match(trace[0].output_summary, /pgvector is down/);
  assert.ok(ranWithoutMemory(trace), "stage 10 cannot tell this was not a warm run");
  // The brief still goes out, with the honest "no lessons" wording.
  const brief = foundry.fetchImpl.seen.find((c) => c.url.includes("/threads/runs")).body.thread.messages[0].content;
  assert.match(brief, /None\. No analyst review has produced a lesson yet/);
});

test("a lesson search that simply finds nothing leaves no marker: cold is not a degradation", async () => {
  // The distinction the swallow destroyed. `reviews` is empty today, so every
  // investigation legitimately runs cold; only a FAILURE is a degradation.
  const db = fakeDb();
  const foundry = fakeFoundry({ states: [{ id: "run_1", thread_id: "thread_1", status: "queued" }], steps: [[]] });
  await startInvestigation(EXCEPTION_ID, { ...startDeps(db, foundry), lessons: async () => [] });
  assert.deepEqual(db.tables.casefiles[0].trace, []);
  assert.equal(ranWithoutMemory(db.tables.casefiles[0].trace), false);
});

test("the marker survives mirroring, and is never counted as an agent step", async () => {
  // `mapRunStepsToTrace` is a pure function of the run's steps, so mirroring
  // overwrites the whole array — the marker has to be merged back in or the
  // first sync erases it. And it must not inflate `steps_count`, or a facility
  // whose memory was down would silently get one fewer agent step.
  const marker = { n: 1, tool: MEMORY_UNAVAILABLE_STEP, input_summary: "top 3 lessons for this facility", output_summary: "memory search failed: pgvector is down", ts: new Date(AT * 1000).toISOString() };
  const db = fakeDb({ casefiles: [casefileRow({ trace: [marker], steps_count: 0 })] });
  const foundry = fakeFoundry({
    states: [{ id: "run_1", thread_id: "thread_1", status: "completed" }],
    steps: [[toolStep("search_documents", { query: "a" }, "[]", AT), toolStep("dscr_calculator", { terms: {}, financials: {} }, "{}", AT + 2)]],
    messages: [message(AGENT_OUTPUT)],
  });
  const result = await syncRun(CASEFILE_ID, { client: db, foundry, now: () => AT * 1000 });

  const trace = db.tables.casefiles[0].trace;
  assert.deepEqual(trace.map((e) => [e.n, e.tool]), [
    [1, MEMORY_UNAVAILABLE_STEP],
    [2, "search_documents"],
    [3, "dscr_calculator"],
  ]);
  assert.ok(ranWithoutMemory(trace), "the marker was erased by mirroring");
  // Two agent steps, three trace rows.
  assert.equal(db.tables.casefiles[0].steps_count, 2);
  assert.equal(result.steps, 2);
});

test("mid-run, steps_count counts agent steps while the trace carries the marker too", async () => {
  // Asserted DURING the run, not after. The terminal write sets steps_count
  // from the agent-step count itself, so a mirror that counted the marker was
  // masked by it on any completed run — which is how counting it against the
  // cap passed every test.
  const marker = { n: 1, tool: MEMORY_UNAVAILABLE_STEP, input_summary: "x", output_summary: "y", ts: new Date(AT * 1000).toISOString() };
  const db = fakeDb({ casefiles: [casefileRow({ trace: [marker], steps_count: 0 })] });
  const foundry = fakeFoundry({
    states: [{ id: "run_1", thread_id: "thread_1", status: "in_progress" }],
    steps: [[toolStep("search_documents", { query: "a" }, "[]", AT), toolStep(CALCULATOR_TOOL_NAME, { terms: {}, financials: {} }, "{}", AT + 2)]],
  });
  const result = await syncRun(CASEFILE_ID, { client: db, foundry, deadlineMs: 0, now: () => AT * 1000 });

  const row = db.tables.casefiles[0];
  assert.equal(row.trace.length, 3, "the marker was dropped");
  assert.equal(row.steps_count, 2, "the marker was counted as an agent step");
  assert.equal(result.steps, 2);
  assert.ok(ranWithoutMemory(row.trace));
});

test("the marker does not consume the agent's step budget", async () => {
  const marker = { n: 1, tool: MEMORY_UNAVAILABLE_STEP, input_summary: "x", output_summary: "y", ts: new Date(AT * 1000).toISOString() };
  const db = fakeDb({ casefiles: [casefileRow({ trace: [marker], steps_count: 0 })], policy: [{ key: "max_steps", value: 2 }] });
  const foundry = fakeFoundry({
    states: [requiresAction("dscr_calculator"), { id: "run_1", thread_id: "thread_1", status: "completed" }],
    steps: [[toolStep("search_documents", { query: "a" }, "[]", AT)], [toolStep("search_documents", { query: "a" }, "[]", AT)]],
    messages: [message(AGENT_OUTPUT)],
  });
  // One agent step against a cap of 2: the run must NOT be stopped, even though
  // the trace already carries two rows.
  const result = await syncRun(CASEFILE_ID, { client: db, foundry, now: () => AT * 1000, callTool: async () => "{}" });
  assert.equal(result.stopped, null, "the marker was counted against the cap");
  assert.equal(result.run_status, "completed");
  assert.equal(db.tables.casefiles[0].trace.length, 2);
  assert.equal(db.tables.casefiles[0].steps_count, 1);
});

test("losing the claim to a concurrent POST returns THEIR casefile, not an error", async () => {
  // What migration 0009's partial unique index makes happen. A 23505 here means
  // someone else claimed this exception first; their casefile is the answer.
  const db = fakeDb();
  const foundry = fakeFoundry({ states: [{ id: "run_1", thread_id: "thread_1", status: "queued" }], steps: [[]] });
  db.tables.casefiles.push({ id: "theirs", exception_id: EXCEPTION_ID, status: "investigating", steps_count: 0, created_at: new Date(0).toISOString() });
  db.failOnce = { table: "casefiles", op: "insert", error: { code: "23505", message: "duplicate key value violates unique constraint" } };
  // The pre-insert read also finds it, which is the common path; force the race
  // by hiding it from that read and revealing it only after the failed insert.
  const hidden = db.tables.casefiles.pop();
  db.revealAfterInsert = hidden;
  const result = await startInvestigation(EXCEPTION_ID, startDeps(db, foundry));
  assert.equal(result.casefileId, "theirs");
  assert.equal(result.reused, true);
  assert.deepEqual(foundry.fetchImpl.seen, [], "a Foundry run was started after losing the claim");
});

test("an exception id that is not a uuid is a 400", async () => {
  await assert.rejects(() => startInvestigation("nope", { client: fakeDb() }), (e) => e.status === 400);
});

// ----------------------------------------------- E-6: one array, everyone appends

test("E-6: the step-cap note is APPENDED to notes already there, never written over them", async () => {
  const earlier = { layer: "guardrail", check: "schema", action: "retry", detail: "an earlier note" };
  const db = fakeDb({ casefiles: [casefileRow({ guardrail_notes: [earlier] })], policy: [{ key: "max_steps", value: 1 }] });
  const foundry = fakeFoundry({ states: [requiresAction("dscr_calculator")], steps: [[toolStep("search_documents", { query: "a" }, "[]")]], messages: [] });
  await syncRun(CASEFILE_ID, { client: db, foundry, now: () => AT * 1000 });
  const notes = db.tables.casefiles[0].guardrail_notes;
  assert.deepEqual(notes[0], earlier, "the cap note overwrote what was there");
  assert.equal(notes[1].check, STEP_CAP_CHECK);
  assert.ok(stoppedAtCap(notes));
});

test("E-6: a failure is appended to the notes as they are NOW, not as the sync first read them", async () => {
  const db = fakeDb({ casefiles: [casefileRow()] });
  const foundry = fakeFoundry({ states: [{ id: "run_1", thread_id: "thread_1", status: "failed", last_error: { message: "boom" } }], steps: [[]] });
  // A note lands after the sync read the row and before it fails the casefile.
  const late = { layer: "policy", check: "x", action: "noted", detail: "landed mid-sync" };
  const bare = foundry.fetchImpl;
  foundry.fetchImpl = async (url, init) => {
    if (!db.tables.casefiles[0].guardrail_notes) db.tables.casefiles[0].guardrail_notes = [late];
    return bare(url, init);
  };
  foundry.fetchImpl.seen = bare.seen;
  await syncRun(CASEFILE_ID, { client: db, foundry, now: () => AT * 1000 });
  assert.deepEqual(db.tables.casefiles[0].guardrail_notes.map((n) => n.check), ["x", "foundry_run"]);
});

// ------------------------------------------- capturing definition_agent's evidence

const CAPTURE_CTX = { casefileId: CASEFILE_ID, facilityId: FACILITY_ID, runId: "demo", periodEnd: "2026-06-30" };
const DEFINITION = {
  terms: { threshold: { min_dscr: 1.25 }, numerator: { addbacks: [{ name: "restructuring charges", cap: 500000 }], deductions: [] }, denominator: { components: ["cash_interest"] } },
  source_citations: [{ field: "numerator.addbacks[0].cap", citation: "Amd 2 §3(a)", quote: "not to exceed $500,000" }],
};

test("definition_agent's terms and citations are captured on the casefile, and the agent gets the output unchanged", async () => {
  const db = fakeDb({ casefiles: [casefileRow()] });
  const output = JSON.stringify(DEFINITION);
  const got = await callAnyTool("definition_agent", {}, CAPTURE_CTX, { client: db, specialists: { definition_agent: async () => output } });
  assert.equal(got, output);
  assert.deepEqual(db.tables.casefiles[0].terms, { proposed_terms: DEFINITION.terms, source_citations: DEFINITION.source_citations });
});

test("captures accumulate across calls without duplicates, and keep only {field, citation, quote}", async () => {
  const db = fakeDb({ casefiles: [casefileRow()] });
  const date = { field: "effective_amendments[0].effective", citation: "Amd 2 §1", quote: "effective as of April 1, 2026" };
  const floor = { field: "threshold.min_dscr", citation: "CA §7.11(a)", quote: "to be less than 1.25 to 1.00." };
  const replies = [
    DEFINITION,
    { ...DEFINITION, source_citations: [...DEFINITION.source_citations, { ...date, extra: "dropped" }, { field: 1 }] },
    { ...DEFINITION, source_citations: [floor] },
  ];
  for (const out of replies) {
    await callAnyTool("definition_agent", {}, CAPTURE_CTX, { client: db, specialists: { definition_agent: async () => JSON.stringify(out) } });
  }
  // A later call never erases an earlier call's evidence, and repeats are kept once.
  assert.deepEqual(db.tables.casefiles[0].terms.source_citations, [DEFINITION.source_citations[0], date, floor]);
});

test("only definition_agent is captured, and only a real {terms, source_citations} reply", async () => {
  const db = fakeDb({ casefiles: [casefileRow()] });
  await callAnyTool("document_agent", { question: "q" }, CAPTURE_CTX, { client: db, specialists: { document_agent: async () => JSON.stringify(DEFINITION) } });
  for (const reply of ['{"error":"no covenant found"}', "not json", '{"terms":{}}']) {
    await callAnyTool("definition_agent", {}, CAPTURE_CTX, { client: db, specialists: { definition_agent: async () => reply } });
  }
  await callAnyTool("definition_agent", {}, CAPTURE_CTX, { client: db, specialists: { definition_agent: async () => { throw new Error("down"); } } });
  assert.equal(db.tables.casefiles[0].terms, undefined);
  assert.deepEqual(db.writes, []);
});

test("a capture that cannot be written fails the call rather than losing the evidence silently", async () => {
  const db = fakeDb({ casefiles: [casefileRow()] });
  db.failOnce = { table: "casefiles", op: "update", error: { message: "connection reset" } };
  await assert.rejects(
    () => callAnyTool("definition_agent", {}, CAPTURE_CTX, { client: db, specialists: { definition_agent: async () => JSON.stringify(DEFINITION) } }),
    /capture the definition agent's citations: connection reset/,
  );
});
