import { test } from "node:test";
import assert from "node:assert/strict";

import { SPECIALIST_NAMES } from "./prompt.ts";
import {
  DRIVABLE_STATUSES,
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

// No network and no database. Foundry is a scripted `fetchImpl`, the tool
// routes are a stub, and the three tables are in memory.

const EXCEPTION_ID = "24486e45-9897-4591-8ca0-86f766372ae1";
const FACILITY_ID = "b0c54d3f-aa3d-4c02-af90-cbaff0490f60";
const OTHER_FACILITY = "bddbabec-8625-4a05-8a55-4d02955c7b8d";
const CASEFILE_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

// --------------------------------------------------------------- the fakes

/** Enough of the supabase-js builder for this file: select/insert/update with eq, in, lte, order, limit, single, maybeSingle. */
function fakeDb(seed = {}) {
  const tables = {
    exceptions: [
      { id: EXCEPTION_ID, facility_id: FACILITY_ID, test_period_end: "2026-06-30", computed_dscr: "1.1200", reported_dscr: "1.1200", required_dscr: "1.2500", status: "new" },
    ],
    facilities: [{ id: FACILITY_ID, borrower_name: "Harbor Logistics", industry: "Freight and logistics" }],
    documents: [
      { facility_id: FACILITY_ID, doc_type: "agreement", title: "Credit Agreement", effective_date: "2024-03-15" },
      { facility_id: FACILITY_ID, doc_type: "amendment", title: "Amendment No. 2", effective_date: "2026-04-01" },
    ],
    covenant_terms: [
      {
        id: "terms-v1",
        facility_id: FACILITY_ID,
        version: 1,
        effective_from: "2024-03-15",
        effective_to: null,
        status: "approved",
        terms: { threshold: { min_dscr: 1.25 }, numerator: { addbacks: [], deductions: ["unfinanced_capex", "cash_taxes"] }, denominator: { components: ["scheduled_principal", "cash_interest"] }, effective_amendments: [] },
      },
    ],
    policy: [{ key: "max_steps", value: 8 }],
    casefiles: [],
    ...seed,
  };
  let counter = 0;
  const writes = [];
  function from(name) {
    const st = { op: "select", filters: [], ins: null, lte: null, payload: null, mode: "many", returning: false };
    const b = {
      select() { if (st.op !== "select") st.returning = true; return b; },
      insert(p) { st.op = "insert"; st.payload = p; return b; },
      update(p) { st.op = "update"; st.payload = p; return b; },
      eq(c, v) { st.filters.push([c, v]); return b; },
      in(c, v) { st.ins = [c, v]; return b; },
      lte(c, v) { st.lte = [c, v]; return b; },
      order() { return b; },
      limit() { return b; },
      single() { st.mode = "single"; return b; },
      maybeSingle() { st.mode = "maybe"; return b; },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };
    const match = (r) =>
      st.filters.every(([c, v]) => r[c] === v) &&
      (st.ins === null || st.ins[1].includes(r[st.ins[0]])) &&
      (st.lte === null || r[st.lte[0]] <= st.lte[1]);
    const shape = (rows) => {
      if (st.mode === "many") return { data: rows, error: null };
      if (st.mode === "maybe") return { data: rows[0] ?? null, error: null };
      return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: `expected one row, got ${rows.length}` } };
    };
    function run() {
      const rows = tables[name] ?? [];
      if (st.op === "select") return shape(rows.filter(match).map((r) => ({ ...r })));
      if (st.op === "insert") {
        writes.push({ table: name, op: "insert", payload: st.payload });
        const forced = db.failOnce;
        if (forced && forced.table === name && forced.op === "insert") {
          db.failOnce = null;
          if (db.revealAfterInsert) { rows.push(db.revealAfterInsert); db.revealAfterInsert = null; }
          return { data: null, error: forced.error };
        }
        const row = { id: `${name}-${++counter}`, steps_count: 0, status: "investigating", created_at: new Date(0).toISOString(), ...st.payload };
        rows.push(row);
        return st.returning ? shape([{ ...row }]) : { data: null, error: null };
      }
      if (st.op === "update") {
        const hit = rows.filter(match);
        hit.forEach((r) => Object.assign(r, st.payload));
        writes.push({ table: name, op: "update", payload: st.payload, rows: hit.length });
        return { data: null, error: null };
      }
      throw new Error(`fakeDb: ${st.op}`);
    }
    return b;
  }
  const db = { tables, writes, from, failOnce: null, revealAfterInsert: null };
  return db;
}

/**
 * A scripted Foundry. `states` is the sequence of run objects successive GETs
 * return; `steps` is the matching sequence of run-step arrays.
 */
function fakeFoundry({ states, steps, messages = [] }) {
  const seen = [];
  let i = -1;
  const impl = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    seen.push({ url, method: init.method, body });
    const reply = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/steps")) return reply({ data: steps[Math.max(i, 0)] ?? [] });
    if (url.includes("/messages")) return reply({ data: messages });
    if (url.includes("/submit_tool_outputs")) return reply(states[Math.min(i + 1, states.length - 1)]);
    if (url.includes("/cancel")) return reply({ ...states[i], status: "cancelled" });
    if (url.includes("/threads/runs")) return reply({ id: "run_1", thread_id: "thread_1", status: "queued" });
    i = Math.min(i + 1, states.length - 1);
    return reply(states[i]);
  };
  impl.seen = seen;
  return { fetchImpl: impl, token: async () => "fake-token", config: { endpoint: "https://e", apiVersion: "2025-05-01", orchestratorModel: "gpt-4.1-mini", specialistModel: "gpt-5-mini" } };
}

const AT = 1791295000;
const toolStep = (name, args, output, at = AT, kind = "function") => ({
  id: `step_${name}_${at}`,
  created_at: at,
  completed_at: at + 1,
  status: "completed",
  type: "tool_calls",
  step_details: {
    type: "tool_calls",
    tool_calls: [
      kind === "function"
        ? { id: `call_${name}`, type: "function", function: { name, arguments: JSON.stringify(args), output } }
        : { id: `call_${name}`, type: "connected_agent", connected_agent: { name, arguments: JSON.stringify(args), output } },
    ],
  },
});

const message = (text) => ({ role: "assistant", run_id: "run_1", content: [{ type: "text", text: { value: text } }] });

const requiresAction = (tool, args = "{}") => ({
  id: "run_1",
  thread_id: "thread_1",
  status: "requires_action",
  required_action: {
    type: "submit_tool_outputs",
    submit_tool_outputs: { tool_calls: [{ id: `call_${tool}`, type: "function", function: { name: tool, arguments: args } }] },
  },
});

const AGENT_OUTPUT = '{"recommendation":"resolve","confidence_basis":"two logged calculations","explanation":"...","claims":[],"calculations":[],"missing_evidence":[],"suggested_tag":"amendment_addback"}';

const casefileRow = (over = {}) => ({
  id: CASEFILE_ID,
  exception_id: EXCEPTION_ID,
  status: "investigating",
  steps_count: 0,
  run_id: "demo",
  foundry_thread_id: "thread_1",
  foundry_run_id: "run_1",
  last_step_at: new Date(AT * 1000).toISOString(),
  created_at: new Date(AT * 1000).toISOString(),
  ...over,
});

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

test("a run that wants ANOTHER tool at the cap is stopped, noted, and produces no recommendation", async () => {
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
  // Still `investigating`: 8b owns both the abstain and the transition to review.
  assert.equal(casefile.status, "investigating");
  assert.equal(casefile.recommendation, undefined);
  assert.deepEqual(casefile.guardrail_notes, [
    { layer: "policy", check: "max_steps", action: "end_run", detail: "the investigation reached the step cap of 2 after 2 steps and was stopped" },
  ]);
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
  assert.equal(result.casefile_status, "investigating");
  assert.equal(db.tables.casefiles[0].status, "investigating");
  assert.equal(db.tables.casefiles[0].summary, undefined);
  assert.deepEqual(db.tables.casefiles[0].guardrail_notes, [capNote]);
  // Nothing was asked of Foundry at all.
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
  assert.equal(db.tables.casefiles[0].agent_output, undefined);
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

test("two concurrent syncs become one: the same tool is never serviced twice", async () => {
  // I-2: stage 9 polls every second and a sync runs for up to 25, so
  // overlapping syncs are the normal case. Two of them service the same tool
  // call, leaving duplicate calc_log rows on the casefile — noise in the one
  // record the guardrail checks every figure against.
  const db = fakeDb({ casefiles: [casefileRow()] });
  const calls = [];
  const foundry = fakeFoundry({
    states: [requiresAction("dscr_calculator"), { id: "run_1", thread_id: "thread_1", status: "completed" }],
    steps: [[], [toolStep("dscr_calculator", { terms: {}, financials: {} }, "{}")]],
    messages: [message(AGENT_OUTPUT)],
  });
  const deps = { client: db, foundry, now: () => AT * 1000, callTool: async (n) => { calls.push(n); return "{}"; } };
  const [a, b] = await Promise.all([syncRun(CASEFILE_ID, deps), syncRun(CASEFILE_ID, deps)]);

  assert.deepEqual(calls, ["dscr_calculator"], "the calculator ran more than once for one tool call");
  assert.deepEqual(a, b, "the second caller got a different result from the first");
  assert.equal(foundry.fetchImpl.seen.filter((c) => c.url.includes("submit_tool_outputs")).length, 1);
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

// ----------------------------------------------------- mirroring the trace

test("a clean finish mirrors the whole trace in order and stores the raw output, still investigating", async () => {
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
  assert.equal(result.casefile_status, "investigating");
  assert.equal(result.steps, 3);
  assert.equal(result.output, AGENT_OUTPUT);

  const casefile = db.tables.casefiles[0];
  assert.deepEqual(casefile.trace.map((e) => [e.n, e.tool]), [[1, "search_documents"], [2, "definition_agent"], [3, "dscr_calculator"]]);
  assert.equal(casefile.steps_count, 3);
  assert.equal(casefile.agent_output, AGENT_OUTPUT);
  // NOT `summary`: that is the memory surface and would leak raw agent JSON
  // into a later investigation's brief as if it were a lesson (I-3).
  assert.equal(casefile.summary, undefined);
  // 8a must NOT reach a reviewable state: that transition is the guardrail's.
  assert.equal(casefile.status, "investigating");
  assert.equal(casefile.recommendation, undefined);
  assert.equal(casefile.explanation, undefined);
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

test("a casefile with no Foundry run on it fails rather than looking as though work is under way", async () => {
  const db = fakeDb({ casefiles: [casefileRow({ foundry_thread_id: null, foundry_run_id: null })] });
  const result = await syncRun(CASEFILE_ID, { client: db, now: () => AT * 1000 });
  assert.equal(result.casefile_status, "failed");
  assert.match(result.error, /never started/);
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
    assert.equal(db.tables.casefiles[0].agent_output, undefined, status);
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
  assert.match(db.tables.casefiles[0].summary, /could not be started/);
  // An exception whose investigation never started must not look as though one is under way.
  assert.equal(db.tables.exceptions[0].status, "new");
});

test("the casefile is claimed BEFORE the slow work, so a second POST cannot start a second run", async () => {
  // I-1: the lesson search embeds a string over the network. Two POSTs arriving
  // in that window would each read no casefile and each start a Foundry run —
  // two traces and two recommendations for one question, both billed.
  const db = fakeDb();
  const order = [];
  const foundry = fakeFoundry({ states: [{ id: "run_1", thread_id: "thread_1", status: "queued" }], steps: [[]] });
  await startInvestigation(EXCEPTION_ID, {
    ...startDeps(db, foundry),
    lessons: async () => { order.push("lessons"); return []; },
  });
  const insertAt = db.writes.findIndex((w) => w.table === "casefiles" && w.op === "insert");
  assert.ok(insertAt >= 0, "no casefile was inserted");
  assert.deepEqual(order, ["lessons"]);
  // The insert is recorded before the lesson search ran, which is the point.
  assert.equal(db.tables.casefiles.length, 1);
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
