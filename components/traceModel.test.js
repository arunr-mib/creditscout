import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildLiveTrace,
  pollDecision,
  toSyncState,
  traceStepKind,
  isCalculatorStep,
  stepRole,
  investigationArc,
  LIVE_STATUS,
  ACTOR_LABEL,
  STALLED_NOTICE,
  STALL_AFTER_MS,
  investigationStalled,
  activityAttribution,
  activityTitle,
  ACTIVITY_STATE_LABEL,
  activityResult,
  activityState,
  activitySummary,
  calcNeedsInput,
  CONNECTION_INTERRUPTED,
  evidenceGathered,
  evidenceLinks,
  exceptionFacts,
  freshnessLabel,
  investigationIssue,
  missingInputLabel,
  PRIOR_CASES_NOTE,
  searchCitations,
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

// -------------------------------------------- orchestration framing (arc + decisions)

// A realistic Harbor-shaped run: two searches, a failing baseline, a specialist
// delegation, then a recomputation.
const HARBOR_TRACE = [
  { tool: "search_documents", input_summary: "DSCR covenant definition", output_summary: "1 chunk: CA §7.11", ts: "" },
  { tool: "search_documents", input_summary: "financial figures", output_summary: "3 chunks", ts: "" },
  { tool: "dscr_calculator", input_summary: "threshold 1.25 · add-backs: none", output_summary: "DSCR 1.12 vs 1.25 — fail (calc_id a)", ts: "" },
  { tool: "definition_agent", input_summary: "{}", output_summary: "returned corrected terms with an add-back", ts: "" },
  { tool: "dscr_calculator", input_summary: "add-backs: restructuring charges", output_summary: "DSCR 1.30 vs 1.25 — pass (calc_id b)", ts: "" },
];

test("investigationArc summarises the run as a plan", () => {
  const { steps } = buildLiveTrace(HARBOR_TRACE);
  const arc = investigationArc(steps);
  assert.deepEqual({ searches: arc.searches, calculations: arc.calculations, delegations: arc.delegations }, { searches: 2, calculations: 2, delegations: 1 });
  assert.equal(arc.summary, "2 evidence searches · 2 calculations · 1 specialist delegation");
});

test("investigationArc has no summary before any step", () => {
  assert.equal(investigationArc([]).summary, null);
});

test("decisions mark the two turning points, and nothing else", () => {
  const { steps } = buildLiveTrace(HARBOR_TRACE);
  assert.equal(steps[0].decision, null); // first search
  assert.equal(steps[2].decision, null); // baseline calc itself
  assert.match(steps[3].decision, /delegated to reinterpret/); // specialist after failing baseline
  assert.match(steps[4].decision, /Recomputed on the corrected terms/); // recompute after specialist
});

test("a delegation after a PASSING calculation is not framed as a rescue", () => {
  const trace = [
    { tool: "dscr_calculator", input_summary: "x", output_summary: "DSCR 1.40 vs 1.25 — pass (calc_id a)", ts: "" },
    { tool: "research_agent", input_summary: "{}", output_summary: "context", ts: "" },
  ];
  const { steps } = buildLiveTrace(trace);
  assert.equal(steps[1].decision, null);
});

// ------------------------------------- what the step DID, as an activity title

test("activityTitle: a step reads as an activity, not as a function name", () => {
  // The trace led with `search_documents` / `dscr_calculator`, which reads as a
  // developer log rather than an investigation.
  assert.equal(activityTitle("search_documents"), "Retrieved covenant and financial evidence");
  assert.equal(activityTitle("dscr_calculator"), "Calculated the ratio");
  assert.equal(activityTitle("definition_agent"), "Asked a specialist to re-read the covenant definition");
});

test("activityTitle: an unknown tool keeps its identifier rather than being given an invented title", () => {
  assert.equal(activityTitle("some_new_tool"), "some_new_tool");
});

test("every tool and specialist the trace can show has an activity title", () => {
  for (const name of ["search_documents", "dscr_calculator", "search_past_cases", "document_agent", "definition_agent", "research_agent"]) {
    assert.notEqual(activityTitle(name), name, `${name} still shows its identifier`);
  }
});

test("ACTOR_LABEL separates who RAN a step from who chose it", () => {
  // "code" on a retrieval step must not be read as "no model was involved".
  assert.equal(ACTOR_LABEL.model, "Specialist model");
  assert.equal(ACTOR_LABEL.code, "Deterministic code");
  assert.equal(ACTOR_LABEL.marker, null, "an app marker has no actor");
});

test("activityAttribution: states that the agent chose every step, delegation or not", () => {
  // A column of identical CODE badges implied no reasoning happened. The
  // attribution says the true thing once, instead.
  const allCode = [{ kind: "code" }, { kind: "code" }];
  assert.match(activityAttribution(allCode), /chose each of these steps/);
  assert.match(activityAttribution(allCode), /without delegating/);

  const withOne = [{ kind: "code" }, { kind: "model" }];
  assert.match(activityAttribution(withOne), /1 was a delegation to a specialist model/);

  const withTwo = [{ kind: "model" }, { kind: "model" }];
  assert.match(activityAttribution(withTwo), /2 were delegations/);
});

test("activityAttribution never claims to show the agent's reasoning", () => {
  // Foundry does not expose it. Saying otherwise would be fabrication.
  for (const steps of [[{ kind: "code" }], [{ kind: "model" }]]) {
    const s = activityAttribution(steps);
    assert.doesNotMatch(s, /because|reasoned that|decided that/i);
  }
});

// ------------------------------------------------------- a stalled run

test("investigationStalled: a frozen run is PAUSED, and the UI must stop claiming progress", () => {
  // The defect: a run whose driver went away showed "Watch live" and a
  // live-looking trace indefinitely. Vercel caps a function at 60s and an
  // investigation needs 60-90s across several slices, so nothing on the server
  // resumes it — the browser is the driver.
  const old = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  assert.equal(investigationStalled({ status: "investigating", last_step_at: old }), true);
});

test("investigationStalled: a run that stepped recently is still running", () => {
  const recent = new Date(Date.now() - 10 * 1000).toISOString();
  assert.equal(investigationStalled({ status: "investigating", last_step_at: recent }), false);
});

test("investigationStalled: the threshold clears the slowest observed step", () => {
  // A specialist delegation took 38s on a live run. A threshold under that
  // would call a working investigation paused.
  assert.ok(STALL_AFTER_MS > 60 * 1000, "must exceed a slow delegation plus margin");
  const at40s = new Date(Date.now() - 40 * 1000).toISOString();
  assert.equal(investigationStalled({ status: "investigating", last_step_at: at40s }), false);
});

test("investigationStalled: falls back to created_at before the first step lands", () => {
  // A run that never produced a step at all still has to be nameable.
  const old = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  assert.equal(investigationStalled({ status: "investigating", last_step_at: null, created_at: old }), true);
  const fresh = new Date().toISOString();
  assert.equal(investigationStalled({ status: "investigating", last_step_at: null, created_at: fresh }), false);
});

test("investigationStalled: only an investigating casefile can be stalled", () => {
  // A finished casefile is not "paused" however old it is.
  const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  for (const status of ["pending_review", "approved", "superseded", "failed"]) {
    assert.equal(investigationStalled({ status, last_step_at: old }), false, status);
  }
});

test("investigationStalled: an unreadable timestamp does not invent a stall", () => {
  assert.equal(investigationStalled({ status: "investigating", last_step_at: "not a date" }), false);
  assert.equal(investigationStalled({ status: "investigating" }), false);
});

test("STALLED_NOTICE says the work is intact, not lost", () => {
  // It is not a crash. Telling an analyst their investigation failed when it
  // merely paused would be worse than the silence it replaces.
  assert.match(STALLED_NOTICE, /paused/i);
  assert.match(STALLED_NOTICE, /nothing is lost/i);
  assert.match(STALLED_NOTICE, /resumes/i);
});

// ------------------------------------------------- an attempt is not a calculation

const step = (over = {}) => ({
  n: 1,
  tool: "search_documents",
  kind: "code",
  input: "",
  output: "",
  ts: "",
  calculator: false,
  role: null,
  decision: null,
  ...over,
});

const refused = (error) => step({ tool: "dscr_calculator", calculator: true, output: `no calculation: ${error}` });

test("calcNeedsInput: the calculator's refusal is not a result", () => {
  // `trace.ts` writes "no calculation: <error>" precisely so this is decidable
  // without re-parsing the tool's JSON.
  assert.equal(calcNeedsInput(refused('missing input: financials.ebitda')), true);
  assert.equal(
    calcNeedsInput(step({ tool: "dscr_calculator", calculator: true, output: "DSCR 1.31 vs 1.25 — pass (calc_id 8f2a1b0c)" })),
    false,
  );
});

test("activityState: a refused calculation reads Needs input, never Completed", () => {
  // THE RULE: do not describe a calculation attempt as a completed calculation.
  assert.equal(activityState(refused('missing input: financials.addback_amounts["dry_dock"]')), "needs_input");
  assert.equal(ACTIVITY_STATE_LABEL[activityState(refused("missing input: financials.ebitda"))], "Needs input");
});

test("activityState: only the last step of a live run can be in progress", () => {
  // Every recorded step is one Foundry already called `completed`, so claiming
  // a middle row is still running would be a fabrication.
  const blank = step({ output: "" });
  assert.equal(activityState(blank, { last: true, running: true }), "in_progress");
  assert.equal(activityState(blank, { last: false, running: true }), "completed");
  assert.equal(activityState(blank, { last: true, running: false }), "completed");
});

test("missingInputLabel: the path becomes the thing it names", () => {
  assert.equal(
    missingInputLabel('missing input: financials.addback_amounts["dry_dock_and_vessel_overhaul"]'),
    "the dry dock and vessel overhaul add-back amount",
  );
  assert.equal(missingInputLabel("missing input: financials.ebitda"), "the ebitda figure");
});

test("missingInputLabel: an unfamiliar path is passed through, not invented", () => {
  assert.equal(missingInputLabel("missing input: terms.threshold.min_dscr"), "terms.threshold.min_dscr");
  assert.equal(missingInputLabel("duplicate add-back in terms: \"x\""), null);
});

// ----------------------------------------------------- the three recovery cases

test("investigationIssue: an omitted calculator input does not ask for documents", () => {
  // THE DEFECT: one amber message for every stall, which told the analyst to
  // upload a document when the agent already held the evidence and had simply
  // not passed it. Different cause, different action.
  const issue = investigationIssue([refused('missing input: financials.addback_amounts["dry_dock_and_vessel_overhaul"]')]);
  assert.equal(issue.kind, "calculator_input");
  assert.match(issue.detail, /dry dock and vessel overhaul add-back amount/);
  assert.match(issue.detail, /No revised DSCR is available yet/);
  assert.match(issue.next, /No documents are needed from you/);
});

test("investigationIssue: a search of a document that was never filed IS an upload request", () => {
  const s = step({ tool: "search_documents", input: '"dry dock add-back" in amendment', output: "no matching text" });
  const issue = investigationIssue([s], ["agreement", "financials"]);
  assert.equal(issue.kind, "document_missing");
  assert.match(issue.detail, /No amendment has been uploaded/);
});

test("investigationIssue: a filed document that lacks the passage is neither of those", () => {
  const s = step({ tool: "search_documents", input: '"dry dock add-back" in agreement', output: "no matching text" });
  const issue = investigationIssue([s], ["agreement"]);
  assert.equal(issue.kind, "evidence_absent");
  assert.match(issue.next, /abstains rather than guesses/);
});

test("investigationIssue: a working investigation has no issue to report", () => {
  // Amber is reserved for the calculation issue. A successful search must not
  // wear it.
  assert.equal(investigationIssue([step({ output: "3 chunks: §4.01, §4.02" })]), null);
  assert.equal(investigationIssue([]), null);
});

test("investigationIssue: the calculator outranks a stale empty search", () => {
  const s = step({ tool: "search_documents", input: '"x" in amendment', output: "no matching text" });
  assert.equal(investigationIssue([s, refused("missing input: financials.ebitda")]).kind, "calculator_input");
});

// ----------------------------------------------------------- the progress line

test("activitySummary: counts an attempt as an attempt", () => {
  const steps = [
    step({ output: "3 chunks: §4.01" }),
    step({ tool: "search_documents", output: "2 chunks: §1.01" }),
    refused("missing input: financials.ebitda"),
  ];
  assert.equal(activitySummary(steps), "2 evidence searches completed · 1 calculation attempt needs input");
});

test("activitySummary: a real calculation is reported as completed", () => {
  const steps = [step({ tool: "dscr_calculator", calculator: true, output: "DSCR 1.31 vs 1.25 — pass (calc_id abc12345)" })];
  assert.equal(activitySummary(steps), "1 calculation completed");
});

test("activitySummary: nothing yet says nothing", () => {
  assert.equal(activitySummary([]), null);
});

test("freshnessLabel: a measurement, in words", () => {
  assert.equal(freshnessLabel(0), "Updated just now");
  assert.equal(freshnessLabel(9), "Updated just now");
  assert.equal(freshnessLabel(12), "Updated 12s ago");
  assert.equal(freshnessLabel(75), "Updated 1m ago");
});

test("connection health is stated as unknown status, never as a stopped run", () => {
  // Losing the updates neither stops the investigation nor proves it is alive.
  assert.match(CONNECTION_INTERRUPTED, /temporarily unavailable/);
  assert.doesNotMatch(CONNECTION_INTERRUPTED, /failed|stopped/i);
  assert.match(PRIOR_CASES_NOTE, /approved terms govern/);
});

test("evidenceGathered: only passages a search actually returned", () => {
  const steps = [
    step({ output: "3 chunks: §4.01, §4.02" }),
    step({ tool: "search_documents", output: "1 chunk: §4.01" }),
    step({ tool: "search_documents", output: "no matching text" }),
    step({ tool: "search_past_cases", output: "2 lessons: addback_cap" }),
  ];
  assert.deepEqual(evidenceGathered(steps), ["§4.01", "§4.02"], "deduplicated, in first-seen order, searches only");
});

// --------------------------------------------------------- the exception's facts

test("exceptionFacts: the shortfall is exact, not floating point", () => {
  // 1.25 - 1.12 in binary floating point is 0.13000000000000012. Printing that
  // on a covenant screen loses the analyst.
  assert.equal(exceptionFacts({ computed: 1.12, required: 1.25 }).shortfall, 0.13);
  assert.equal(exceptionFacts({ computed: 1.31, required: 1.25 }).shortfall, -0.06);
});

test("exceptionFacts: an unknown figure yields no shortfall rather than a zero", () => {
  assert.equal(exceptionFacts({ computed: null, required: 1.25 }).shortfall, null);
  assert.equal(exceptionFacts({ computed: 1.12, required: null }).shortfall, null);
  assert.equal(exceptionFacts({}).termsVersion, null);
});

test("evidenceLinks: a citation with no stored document is shown without a link", () => {
  // It WAS retrieved — dropping it would hide evidence. Linking it anywhere
  // would be worse: the link would land on the wrong filing or nothing.
  const chunks = [{ citation: "CA §7.11", doc_title: "Credit Agreement", section: "§7.11" }];
  const links = evidenceLinks(["CA §7.11", "AM2 §3"], chunks, { "Credit Agreement": "doc-1" });
  assert.deepEqual(links, [
    { citation: "CA §7.11", docTitle: "Credit Agreement", href: "/documents/doc-1#section-§7.11" },
    { citation: "AM2 §3", docTitle: null, href: null },
  ]);
});

test("activityResult: the row says what happened; the raw refusal stays in the details", () => {
  const refusal = refused('missing input: financials.addback_amounts["dry_dock_and_vessel_overhaul"]');
  assert.equal(
    activityResult(refusal),
    "The dry dock and vessel overhaul add-back amount was not supplied to the calculator. No new ratio was calculated.",
  );
  // A real result is passed through untouched — it already carries its calc_id.
  const done = step({ tool: "dscr_calculator", calculator: true, output: "DSCR 1.31 vs 1.25 — pass (calc_id abc12345)" });
  assert.equal(activityResult(done), done.output);
});

test("searchCitations: a passage hit becomes links; anything else keeps its sentence", () => {
  assert.deepEqual(searchCitations("3 chunks: CA §7.11, AM2 §3, CA §7.11"), { count: 3, citations: ["CA §7.11", "AM2 §3"] });
  assert.equal(searchCitations("no matching text"), null);
  assert.equal(searchCitations("search failed: timeout"), null);
});
