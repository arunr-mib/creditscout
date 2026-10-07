import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildLiveTrace,
  pollDecision,
  toSyncState,
  traceStepKind,
  isCalculatorStep,
  stepRole,
  LIVE_STATUS,
} from "./traceModel.ts";
import { SPECIALIST_NAMES } from "../lib/agent/prompt.ts";
import { CALCULATOR_TOOL, MEMORY_LOADED_STEP, MEMORY_UNAVAILABLE_STEP, memoryLoadedEntry } from "../lib/agent/trace.ts";

// ------------------------------------------------------ the teal/amber classifier

test("every specialist name is a model step (teal), from the tool alone", () => {
  for (const name of SPECIALIST_NAMES) {
    assert.equal(traceStepKind(name), "model", name);
  }
});

test("every tool name is a code step (amber), from the tool alone", () => {
  for (const name of [CALCULATOR_TOOL, "search_documents", "search_past_cases"]) {
    assert.equal(traceStepKind(name), "code", name);
  }
});

test("the two memory markers are neither a plain model nor a plain code step", () => {
  assert.equal(traceStepKind(MEMORY_LOADED_STEP), "marker");
  assert.equal(traceStepKind(MEMORY_UNAVAILABLE_STEP), "marker");
});

test("an unknown tool is never coloured amber — amber is reserved for code output", () => {
  assert.equal(traceStepKind("some_future_tool"), "unknown");
  assert.equal(traceStepKind(""), "unknown");
  assert.equal(traceStepKind(undefined), "unknown");
});

test("every known specialist and tool has a plain-language role; nothing else does", () => {
  for (const name of SPECIALIST_NAMES) {
    assert.equal(typeof stepRole(name), "string", name);
  }
  for (const name of [CALCULATOR_TOOL, "search_documents", "search_past_cases"]) {
    assert.equal(typeof stepRole(name), "string", name);
  }
  // An unattributable step gets no line rather than a guessed one.
  assert.equal(stepRole("some_future_tool"), null);
  assert.equal(stepRole(""), null);
  assert.equal(stepRole(undefined), null);
});

test("buildLiveTrace carries the role through onto each step", () => {
  const trace = [
    { tool: CALCULATOR_TOOL, input_summary: "terms", output_summary: "1.08x calc_x", ts: "" },
    { tool: "some_future_tool", input_summary: "a", output_summary: "b", ts: "" },
  ];
  const { steps } = buildLiveTrace(trace);
  assert.equal(typeof steps[0].role, "string");
  assert.equal(steps[1].role, null);
});

test("only the calculator earns weight", () => {
  assert.equal(isCalculatorStep(CALCULATOR_TOOL), true);
  assert.equal(isCalculatorStep("research_agent"), false);
});

// --------------------------------------------------------- the seen-similar count

test("lessons come from the memory_loaded entry's count; markers are not drawn as steps", () => {
  const loaded = memoryLoadedEntry(2, new Date("2026-10-06T10:00:00Z"));
  const trace = [
    loaded,
    { n: 2, tool: "definition_agent", input_summary: "map DSCR", output_summary: "mapped CA §1.01", ts: "2026-10-06T10:00:01Z" },
    { n: 3, tool: CALCULATOR_TOOL, input_summary: "threshold 1.25", output_summary: "DSCR 1.12 vs 1.25 — fail", ts: "2026-10-06T10:00:02Z" },
  ];
  const view = buildLiveTrace(trace);
  assert.equal(view.lessons, 2);
  assert.equal(view.ranWithoutMemory, false);
  // The marker is pulled out of the step list; only the two agent steps remain.
  assert.equal(view.steps.length, 2);
  assert.deepEqual(view.steps.map((s) => s.n), [1, 2]);
  assert.equal(view.steps[0].kind, "model");
  assert.equal(view.steps[1].kind, "code");
  assert.equal(view.steps[1].calculator, true);
});

test("no memory_loaded entry means no count (no badge) and nothing read as warm", () => {
  const view = buildLiveTrace([
    { n: 1, tool: "research_agent", input_summary: "find amendment", output_summary: "found Amd 2 §3", ts: "2026-10-06T10:00:00Z" },
  ]);
  assert.equal(view.lessons, 0);
  assert.equal(view.ranWithoutMemory, false);
  assert.equal(view.steps.length, 1);
});

test("a memory_unavailable marker surfaces as ran-cold, not as a step", () => {
  const view = buildLiveTrace([
    { n: 1, tool: MEMORY_UNAVAILABLE_STEP, input_summary: "top 3 lessons", output_summary: "memory search failed: boom", ts: "2026-10-06T10:00:00Z" },
  ]);
  assert.equal(view.lessons, 0);
  assert.equal(view.ranWithoutMemory, true);
  assert.match(view.memoryNote, /memory search failed/);
  assert.equal(view.steps.length, 0);
});

test("a non-array trace is an empty live view, never a throw", () => {
  const view = buildLiveTrace(null);
  assert.equal(view.lessons, 0);
  assert.equal(view.steps.length, 0);
});

// ------------------------------------------------------------ the poll reducer

test("investigating keeps polling", () => {
  assert.deepEqual(pollDecision({ casefileStatus: LIVE_STATUS, runStatus: "in_progress" }), {
    action: "poll",
    phase: "running",
    status: LIVE_STATUS,
  });
});

test("the 1-3s 'no run yet' window reads as still starting, not failed", () => {
  assert.deepEqual(pollDecision({ casefileStatus: LIVE_STATUS, runStatus: "starting" }), {
    action: "poll",
    phase: "starting",
    status: LIVE_STATUS,
  });
});

test("every terminal status stops the poll and hands off to the concluded view", () => {
  for (const status of ["pending_review", "awaiting_docs", "approved", "overridden", "failed"]) {
    assert.deepEqual(pollDecision({ casefileStatus: status, runStatus: "completed" }), { action: "stop", status }, status);
  }
});

// ------------------------------------------------------------- the sync shape

test("toSyncState reads the route body into a client-safe shape and defaults to investigating", () => {
  const s = toSyncState("cf-1", { casefile_status: "pending_review", run_status: "completed", steps: 4, max_steps: 12, stopped: null, error: null });
  assert.equal(s.casefileStatus, "pending_review");
  assert.equal(s.steps, 4);
  const empty = toSyncState("cf-1", {});
  assert.equal(empty.casefileStatus, LIVE_STATUS);
});
