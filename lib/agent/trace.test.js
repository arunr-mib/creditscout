import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CALCULATOR_TOOL,
  LOCAL_TRACE_TOOLS,
  MEMORY_LOADED_STEP,
  MEMORY_UNAVAILABLE_STEP,
  SUMMARY_MAX,
  lessonsLoaded,
  localEntries,
  mapRunStepsToTrace,
  memoryLoadedEntry,
  memoryUnavailableEntry,
  mergeTrace,
  ranWithoutMemory,
  truncate,
} from "./trace.ts";

// The trace is the demo's centrepiece and the only place the teal/amber
// alternation is decided, so everything here is pinned against REAL Foundry
// step shapes, captured live from this project before the loop was written.

const AT = 1791295000;

const step = (over = {}) => ({
  id: "step_x",
  object: "thread.run.step",
  created_at: AT,
  completed_at: AT + 2,
  status: "completed",
  type: "tool_calls",
  step_details: { type: "tool_calls", tool_calls: [] },
  ...over,
});

const functionCall = (name, args, output) => ({
  id: `call_${name}`,
  type: "function",
  function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args), output },
});

const connectedCall = (name, args, output) => ({
  id: `call_${name}`,
  type: "connected_agent",
  connected_agent: {
    name,
    arguments: typeof args === "string" ? args : JSON.stringify(args),
    output,
    run_id: "run_inner",
    thread_id: "thread_inner",
    assistant_id: "asst_inner",
  },
});

const toolStep = (calls, over = {}) => step({ step_details: { type: "tool_calls", tool_calls: calls }, ...over });

const messageStep = (over = {}) =>
  step({ type: "message_creation", step_details: { type: "message_creation", message_creation: { message_id: "msg_1" } }, ...over });

// ------------------------------------------------------ which steps count

test("a connected_agent step is named after the SPECIALIST, not after the step type", () => {
  const [entry] = mapRunStepsToTrace([toolStep([connectedCall("document_agent", { query: "threshold?" }, "CA §7.11 requires 1.25.")])]);
  // This is the whole teal/amber mechanism: the UI colours from `tool` alone
  // and never infers which layer did the work.
  assert.equal(entry.tool, "document_agent");
  assert.notEqual(entry.tool, "connected_agent");
});

test("each specialist keeps its own name, so three delegations are three distinguishable steps", () => {
  const trace = mapRunStepsToTrace([
    toolStep([connectedCall("document_agent", { q: "a" }, "a")], { created_at: AT }),
    toolStep([connectedCall("definition_agent", { q: "b" }, "b")], { created_at: AT + 1 }),
    toolStep([connectedCall("research_agent", { q: "c" }, "c")], { created_at: AT + 2 }),
  ]);
  assert.deepEqual(trace.map((e) => e.tool), ["document_agent", "definition_agent", "research_agent"]);
});

test("a function step is named after the tool", () => {
  const [entry] = mapRunStepsToTrace([toolStep([functionCall(CALCULATOR_TOOL, { terms: {}, financials: {} }, "{}")])]);
  assert.equal(entry.tool, CALCULATOR_TOOL);
});

test("message_creation steps are not trace entries", () => {
  // Spec §4.2 counts TOOL CALLS as steps and the cap is measured in them. A
  // transcript of the model narrating itself would also make steps_count
  // disagree with the list the analyst is looking at.
  const trace = mapRunStepsToTrace([
    messageStep({ created_at: AT }),
    toolStep([functionCall("search_documents", { query: "x" }, "[]")], { created_at: AT + 1 }),
    messageStep({ created_at: AT + 2 }),
  ]);
  assert.equal(trace.length, 1);
  assert.equal(trace[0].tool, "search_documents");
});

test("a step still in progress is not shown as a finished one", () => {
  // Live shape: Foundry reports an in-flight tool_calls step with an EMPTY
  // tool_calls array, so an unfiltered mapper would show a step with no input
  // and no output as though the work were done.
  const trace = mapRunStepsToTrace([
    toolStep([], { status: "in_progress", completed_at: null }),
    toolStep([functionCall("search_documents", { query: "x" }, "[]")], { created_at: AT + 1 }),
  ]);
  assert.deepEqual(trace.map((e) => e.tool), ["search_documents"]);
});

test("a cancelled or failed step is not a trace entry", () => {
  for (const status of ["cancelled", "failed", "expired"]) {
    const trace = mapRunStepsToTrace([toolStep([functionCall("search_documents", { query: "x" }, "[]")], { status })]);
    assert.deepEqual(trace, [], `${status} step should not appear`);
  }
});

test("a tool call of an unknown type still earns a visible step", () => {
  // Work the analyst cannot see is worse than work labelled oddly.
  const [entry] = mapRunStepsToTrace([toolStep([{ id: "c", type: "file_search", file_search: { ranking: "default" } }])]);
  assert.equal(entry.tool, "file_search");
});

test("a non-array argument, an empty run and a step with no details all give an empty trace", () => {
  assert.deepEqual(mapRunStepsToTrace(undefined), []);
  assert.deepEqual(mapRunStepsToTrace(null), []);
  assert.deepEqual(mapRunStepsToTrace({}), []);
  assert.deepEqual(mapRunStepsToTrace([]), []);
  assert.deepEqual(mapRunStepsToTrace([step({ step_details: undefined })]), []);
});

// ------------------------------------------------------------- the ordering

test("steps are ordered oldest first even when handed over newest first", () => {
  // Foundry's /steps returns newest first by DEFAULT. Reversed, the trace shows
  // the calculator being consulted before the document it was consulted about.
  const newestFirst = [
    toolStep([functionCall(CALCULATOR_TOOL, { terms: {}, financials: {} }, '{"dscr":1.28,"threshold":1.25,"pass":true,"calc_id":"abcdef12-0000-0000-0000-000000000000"}')], { created_at: AT + 20 }),
    toolStep([connectedCall("definition_agent", { q: "re-map" }, "terms")], { created_at: AT + 10 }),
    toolStep([functionCall("search_documents", { query: "amendment" }, "[]")], { created_at: AT }),
  ];
  const trace = mapRunStepsToTrace(newestFirst);
  assert.deepEqual(trace.map((e) => e.tool), ["search_documents", "definition_agent", CALCULATOR_TOOL]);
  assert.deepEqual(trace.map((e) => e.n), [1, 2, 3]);
});

test("steps created in the same second keep the order they arrived in", () => {
  const trace = mapRunStepsToTrace([
    toolStep([functionCall("search_documents", { query: "first" }, "[]")]),
    toolStep([functionCall("search_past_cases", { exception_profile: "second" }, "[]")]),
  ]);
  assert.deepEqual(trace.map((e) => e.tool), ["search_documents", "search_past_cases"]);
});

test("n is 1-based and contiguous across steps that hold several calls each", () => {
  const trace = mapRunStepsToTrace([
    toolStep([functionCall("search_documents", { query: "a" }, "[]"), functionCall("search_documents", { query: "b" }, "[]")], { created_at: AT }),
    toolStep([connectedCall("document_agent", { q: "c" }, "c")], { created_at: AT + 1 }),
  ]);
  assert.deepEqual(trace.map((e) => e.n), [1, 2, 3]);
});

test("parallel calls in one step share that step's timestamp", () => {
  const trace = mapRunStepsToTrace([
    toolStep([functionCall("search_documents", { query: "a" }, "[]"), functionCall("search_documents", { query: "b" }, "[]")]),
  ]);
  assert.equal(trace[0].ts, trace[1].ts);
});

test("ts comes from completed_at, falling back to created_at", () => {
  const [done] = mapRunStepsToTrace([toolStep([functionCall("search_documents", { query: "a" }, "[]")], { created_at: AT, completed_at: AT + 9 })]);
  assert.equal(done.ts, new Date((AT + 9) * 1000).toISOString());
  const [noEnd] = mapRunStepsToTrace([toolStep([functionCall("search_documents", { query: "a" }, "[]")], { created_at: AT, completed_at: null })]);
  assert.equal(noEnd.ts, new Date(AT * 1000).toISOString());
});

// ------------------------------------------------------------ the summaries

const calcOf = (args, output) => mapRunStepsToTrace([toolStep([functionCall(CALCULATOR_TOOL, args, output)])])[0];

test("a calculator result reads as the figure, the threshold, the verdict and the calc_id", () => {
  const entry = calcOf(
    { terms: { threshold: { min_dscr: 1.25 }, numerator: { addbacks: [], deductions: [] } }, financials: { ebitda: 4020000 } },
    '{"dscr":1.12,"threshold":1.25,"pass":false,"calc_id":"7f3a9c21-1111-2222-3333-444455556666"}',
  );
  assert.match(entry.output_summary, /DSCR 1\.12 vs 1\.25/);
  assert.match(entry.output_summary, /fail/);
  assert.match(entry.output_summary, /calc_id 7f3a9c21/);
});

test("a calculator ERROR does not read as a figure, and claims no calc_id", () => {
  // The error is evidence that evidence is missing. Rendered as a number it
  // would be the exact failure the whole design exists to prevent.
  const entry = calcOf({ terms: {}, financials: {} }, '{"error":"missing input: cash_interest"}');
  assert.equal(entry.output_summary, "no calculation: missing input: cash_interest");
  assert.doesNotMatch(entry.output_summary, /calc_id/);
  assert.doesNotMatch(entry.output_summary, /DSCR/);
});

test("an add-back with cap null, or no cap field at all, reads UNCAPPED and never as a cap of 0", () => {
  // The documented trap. Read as zero, F1 flips from a correct resolve to a
  // false escalation, and a summary that printed "cap 0" would make the correct
  // calculation look like the wrong one.
  for (const addback of [{ name: "restructuring charges", cap: null }, { name: "restructuring charges" }]) {
    const entry = calcOf(
      { terms: { threshold: { min_dscr: 1.25 }, numerator: { addbacks: [addback], deductions: [] } }, financials: { ebitda: 1 } },
      "{}",
    );
    assert.match(entry.input_summary, /restructuring charges \(uncapped\)/);
    assert.doesNotMatch(entry.input_summary, /cap 0/);
  }
});

test("a capped add-back shows its cap, grouped, and 'none' when there are none", () => {
  const capped = calcOf(
    { terms: { threshold: { min_dscr: 1.25 }, numerator: { addbacks: [{ name: "restructuring charges", cap: 500000 }], deductions: [] } }, financials: { ebitda: 4020000 } },
    "{}",
  );
  assert.match(capped.input_summary, /threshold 1\.25/);
  assert.match(capped.input_summary, /EBITDA 4,020,000/);
  assert.match(capped.input_summary, /restructuring charges \(cap 500,000\)/);

  const bare = calcOf({ terms: { threshold: { min_dscr: 1.25 }, numerator: { addbacks: [], deductions: [] } }, financials: {} }, "{}");
  assert.match(bare.input_summary, /add-backs: none/);
  assert.match(bare.input_summary, /EBITDA \?/);
});

test("a document search shows the query and the citations it returned, deduplicated", () => {
  const [entry] = mapRunStepsToTrace([
    toolStep([
      functionCall(
        "search_documents",
        { query: "restructuring add-back cap", doc_types: ["agreement", "amendment"] },
        JSON.stringify([
          { citation: "CA §7.11", content: "..." },
          { citation: "Amd 2 §3", content: "..." },
          { citation: "CA §7.11", content: "..." },
        ]),
      ),
    ]),
  ]);
  assert.match(entry.input_summary, /"restructuring add-back cap" in agreement, amendment/);
  assert.equal(entry.output_summary, "3 chunks: CA §7.11, Amd 2 §3");
});

test("an empty document search says so rather than showing an empty bracket", () => {
  const [entry] = mapRunStepsToTrace([toolStep([functionCall("search_documents", { query: "x" }, "[]")])]);
  assert.equal(entry.output_summary, "no matching text");
});

test("memory with nothing in it says 'no lessons on file', which is today's truth", () => {
  const [empty] = mapRunStepsToTrace([toolStep([functionCall("search_past_cases", { exception_profile: "DSCR breach" }, "[]")])]);
  assert.equal(empty.input_summary, "DSCR breach");
  assert.equal(empty.output_summary, "no lessons on file");

  const [warm] = mapRunStepsToTrace([
    toolStep([functionCall("search_past_cases", { exception_profile: "p" }, JSON.stringify([{ pattern_tag: "amendment_addback" }, {}]))]),
  ]);
  assert.equal(warm.output_summary, "2 lessons: amendment_addback, untagged");
});

test("a delegation shows the text the specialist was given, not its JSON wrapper", () => {
  const [entry] = mapRunStepsToTrace([
    toolStep([connectedCall("research_agent", { query: "Why is the reported figure higher?" }, '{"mechanism":"unsupported_addback"}')]),
  ]);
  assert.equal(entry.input_summary, "Why is the reported figure higher?");
  assert.match(entry.output_summary, /unsupported_addback/);
});

test("a tool error from one of our routes is surfaced, not swallowed", () => {
  const [docs] = mapRunStepsToTrace([toolStep([functionCall("search_documents", { query: "x" }, '{"error":"unauthorized"}')])]);
  assert.equal(docs.output_summary, "search failed: unauthorized");
});

test("summaries are whitespace-collapsed and never longer than SUMMARY_MAX", () => {
  const long = "x".repeat(SUMMARY_MAX * 3);
  const [entry] = mapRunStepsToTrace([toolStep([connectedCall("document_agent", `line one\n\n   line  two`, long)])]);
  assert.equal(entry.input_summary, "line one line two");
  assert.equal(entry.output_summary.length, SUMMARY_MAX);
  assert.ok(entry.output_summary.endsWith("…"));
});

test("truncate counts the ellipsis toward the limit and leaves short text alone", () => {
  assert.equal(truncate("short", 10), "short");
  assert.equal(truncate("abcdefghij", 5), "abcd…");
});

test("arguments that are not JSON still produce a readable summary", () => {
  const [entry] = mapRunStepsToTrace([toolStep([functionCall(CALCULATOR_TOOL, "not json at all", "also not json")])]);
  assert.equal(entry.input_summary, "not json at all");
  assert.equal(entry.output_summary, "also not json");
});

test("every entry carries all five fields, so no consumer has to guess a default", () => {
  const trace = mapRunStepsToTrace([toolStep([functionCall("search_documents", { query: "x" }, "[]")])]);
  assert.deepEqual(Object.keys(trace[0]).sort(), ["input_summary", "n", "output_summary", "tool", "ts"].sort());
});

// ------------------------------------------- locally recorded steps

const MARKER = memoryUnavailableEntry("pgvector is down", new Date(AT * 1000));

test("the memory marker has a STABLE tool name, because the eval has to filter on it", () => {
  // A warm run whose memory search failed is not a warm run. Stage 10 matches
  // this constant rather than guessing at prose, so the name is the contract.
  assert.equal(MEMORY_UNAVAILABLE_STEP, "memory_unavailable");
  assert.equal(MARKER.tool, MEMORY_UNAVAILABLE_STEP);
  assert.deepEqual(Object.keys(MARKER).sort(), ["input_summary", "n", "output_summary", "tool", "ts"].sort());
  assert.equal(MARKER.ts, new Date(AT * 1000).toISOString());
  assert.match(MARKER.output_summary, /memory search failed: pgvector is down/);
  assert.match(MARKER.output_summary, /ran with no past lessons/);
  assert.ok(MARKER.output_summary.length <= SUMMARY_MAX);
});

test("a long failure message is truncated like any other summary", () => {
  const long = memoryUnavailableEntry("x".repeat(SUMMARY_MAX * 2), new Date(AT * 1000));
  assert.equal(long.output_summary.length, SUMMARY_MAX);
});

test("ranWithoutMemory answers the question stage 10 asks, and survives junk", () => {
  assert.equal(ranWithoutMemory([MARKER]), true);
  assert.equal(ranWithoutMemory([{ n: 1, tool: "search_documents" }, MARKER]), true);
  assert.equal(ranWithoutMemory([{ n: 1, tool: "search_documents" }]), false);
  for (const junk of [null, undefined, [], {}, "memory_unavailable", [null], [{}]]) {
    assert.equal(ranWithoutMemory(junk), false, JSON.stringify(junk));
  }
});

test("localEntries keeps only the entries we wrote, and only well-formed ones", () => {
  const runStep = { n: 2, tool: "search_documents", input_summary: "q", output_summary: "8 chunks", ts: MARKER.ts };
  assert.deepEqual(localEntries([MARKER, runStep]), [MARKER]);
  assert.deepEqual(localEntries([runStep]), []);
  // Malformed rows are not resurrected as local entries.
  assert.deepEqual(localEntries([{ tool: MEMORY_UNAVAILABLE_STEP }]), []);
  assert.deepEqual(localEntries([{ tool: MEMORY_UNAVAILABLE_STEP, input_summary: "a", output_summary: 7 }]), []);
  for (const junk of [null, undefined, {}, "x"]) assert.deepEqual(localEntries(junk), []);
});

test("every local tool name is one mapRunStepsToTrace would never produce", () => {
  // If a mapped run step could carry a local name, a mirror would mistake it
  // for something we wrote and preserve it forever.
  assert.deepEqual([...LOCAL_TRACE_TOOLS], [MEMORY_UNAVAILABLE_STEP, MEMORY_LOADED_STEP]);
  const mapped = mapRunStepsToTrace([toolStep([functionCall("search_documents", { query: "x" }, "[]")])]);
  for (const entry of mapped) assert.ok(!LOCAL_TRACE_TOOLS.includes(entry.tool));
});

test("mergeTrace puts what we recorded first and renumbers the whole thing", () => {
  const mapped = mapRunStepsToTrace([
    toolStep([functionCall("search_documents", { query: "a" }, "[]")], { created_at: AT }),
    toolStep([functionCall(CALCULATOR_TOOL, { terms: {}, financials: {} }, "{}")], { created_at: AT + 2 }),
  ]);
  const merged = mergeTrace([MARKER], mapped);
  assert.deepEqual(merged.map((e) => [e.n, e.tool]), [
    [1, MEMORY_UNAVAILABLE_STEP],
    [2, "search_documents"],
    [3, CALCULATOR_TOOL],
  ]);
});

test("mergeTrace is idempotent, which is what lets two syncs race harmlessly", () => {
  const mapped = mapRunStepsToTrace([toolStep([functionCall("search_documents", { query: "a" }, "[]")])]);
  assert.deepEqual(mergeTrace([MARKER], mapped), mergeTrace([MARKER], mapped));
  assert.deepEqual(mergeTrace([], mapped), mapped);
  assert.deepEqual(mergeTrace([], []), []);
});

// ------------------------------------------- the positive memory entry

test("a memory_loaded entry carries the lesson count as a field and survives mirroring", () => {
  assert.equal(MEMORY_LOADED_STEP, "memory_loaded");
  assert.ok(LOCAL_TRACE_TOOLS.includes(MEMORY_LOADED_STEP), "mirroring would erase it");
  const entry = memoryLoadedEntry(2, new Date(AT * 1000));
  assert.equal(entry.tool, MEMORY_LOADED_STEP);
  assert.equal(entry.count, 2);
  assert.equal(entry.output_summary, "memory loaded: 2 lessons");
  assert.equal(memoryLoadedEntry(1, new Date(AT * 1000)).output_summary, "memory loaded: 1 lesson");
  assert.deepEqual(localEntries([entry]), [entry]);
  assert.equal(mergeTrace(localEntries([entry]), [])[0].count, 2, "the count is lost when the trace is rebuilt");
});

test("'0 lessons' is not an entry: cold is not an event", () => {
  for (const bad of [0, -1, 1.5, NaN, undefined, "2"]) {
    assert.throws(() => memoryLoadedEntry(bad, new Date(AT * 1000)), /at least one lesson/, String(bad));
  }
});

test("lessonsLoaded reads the count, and is 0 for cold, unavailable and junk", () => {
  assert.equal(lessonsLoaded([memoryLoadedEntry(3, new Date(AT * 1000))]), 3);
  assert.equal(lessonsLoaded([{ n: 1, tool: "search_documents" }, memoryLoadedEntry(2, new Date(AT * 1000))]), 2);
  assert.equal(lessonsLoaded([]), 0, "cold");
  assert.equal(lessonsLoaded([MARKER]), 0, "memory unavailable");
  // ranWithoutMemory is exactly as it was: the new entry is not an outage.
  assert.equal(ranWithoutMemory([memoryLoadedEntry(2, new Date(AT * 1000))]), false);
  assert.equal(ranWithoutMemory([MARKER]), true);
  for (const junk of [null, undefined, {}, "memory_loaded", [null], [{}], [{ tool: MEMORY_LOADED_STEP }], [{ tool: MEMORY_LOADED_STEP, count: 0 }], [{ tool: MEMORY_LOADED_STEP, count: "2" }], [{ tool: MEMORY_LOADED_STEP, count: -2 }], [{ tool: MEMORY_LOADED_STEP, count: 1.5 }]]) {
    assert.equal(lessonsLoaded(junk), 0, JSON.stringify(junk));
  }
});
