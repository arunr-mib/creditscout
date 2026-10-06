import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AGENTS_FILE,
  DEFAULT_API_VERSION,
  createRunOnThread,
  STEP_PAGE_SIZE,
  TERMINAL_RUN_STATUSES,
  foundryConfig,
  functionTools,
  getRunSteps,
  isTerminal,
  latestAssistantText,
  orchestratorAgentId,
  orchestratorDefinition,
  readAgentsFile,
  specialistTools,
  startRun,
  submitToolOutputs,
  toJsonSchema,
} from "./foundry.ts";
import { DOC_TYPES } from "../retrieval.ts";
import { ORCHESTRATOR_NAME, SPECIALIST_NAMES } from "./prompt.ts";

// No network: every HTTP test injects `fetchImpl` and a fixed token.

const ENV = {
  AZURE_AI_PROJECT_ENDPOINT: "https://example.services.ai.azure.com/api/projects/creditscout/",
  FOUNDRY_ORCHESTRATOR_MODEL: "gpt-4.1-mini",
  FOUNDRY_SPECIALIST_MODEL: "gpt-5-mini",
  FOUNDRY_API_VERSION: "2025-05-01",
};

const config = () => foundryConfig(ENV);

/** Records every request and answers with the queued bodies. */
function fakeFetch(bodies) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
    const body = bodies.shift() ?? {};
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  impl.calls = calls;
  return impl;
}

const deps = (fetchImpl) => ({ config: config(), token: async () => "fake-token", fetchImpl });

// ------------------------------------------------------------------ config

test("the endpoint loses its trailing slash, so no request ever has a double slash in it", () => {
  assert.equal(config().endpoint, "https://example.services.ai.azure.com/api/projects/creditscout");
});

test("the api version falls back to the version this loop was built against", () => {
  assert.equal(foundryConfig({ ...ENV, FOUNDRY_API_VERSION: undefined }).apiVersion, DEFAULT_API_VERSION);
});

test("a missing endpoint or model is refused by name, not defaulted", () => {
  for (const key of ["AZURE_AI_PROJECT_ENDPOINT", "FOUNDRY_ORCHESTRATOR_MODEL", "FOUNDRY_SPECIALIST_MODEL"]) {
    assert.throws(() => foundryConfig({ ...ENV, [key]: undefined }), /must be set/, `${key} was defaulted`);
  }
});

test("completed, failed, cancelled, expired and incomplete are all terminal; queued and in_progress are not", () => {
  for (const status of TERMINAL_RUN_STATUSES) assert.ok(isTerminal(status), status);
  for (const status of ["queued", "in_progress", "requires_action"]) assert.equal(isTerminal(status), false, status);
});

// ----------------------------------------------------- tool declarations

test("the three function tools are read off the OpenAPI document, by operationId", () => {
  // One document describes both tool styles. Two hand-written copies of a tool
  // contract drift, and the drift surfaces as the model sending a field the
  // route rejects — at run time, inside a paid orchestration.
  const names = functionTools(ENV).map((t) => t.function.name);
  assert.deepEqual(names.sort(), ["dscr_calculator", "search_documents", "search_past_cases"]);
  for (const tool of functionTools(ENV)) {
    assert.equal(tool.type, "function");
    assert.ok(tool.function.description.length > 20, `${tool.function.name} has no useful description`);
    assert.equal(tool.function.parameters.type, "object");
  }
});

test("the calculator tool still requires terms and financials, and still accepts casefile_id", () => {
  const calc = functionTools(ENV).find((t) => t.function.name === "dscr_calculator");
  assert.deepEqual(calc.function.parameters.required, ["terms", "financials"]);
  assert.ok("casefile_id" in calc.function.parameters.properties);
  // A mandatory financial field would invite the model to send 0 for a figure
  // it does not have, which is a fabricated number that looks real.
  assert.equal(calc.function.parameters.properties.financials.required, undefined);
});

test("OpenAPI-only keywords are stripped, recursively, because JSON Schema does not mean them", () => {
  const cleaned = toJsonSchema({
    type: "object",
    properties: {
      a: { type: "string", format: "uuid", nullable: true, description: "keep me" },
      b: { type: "array", items: { type: "object", properties: { c: { type: "number", nullable: true } } } },
    },
    required: ["a"],
  });
  assert.deepEqual(cleaned, {
    type: "object",
    properties: {
      a: { type: "string", description: "keep me" },
      b: { type: "array", items: { type: "object", properties: { c: { type: "number" } } } },
    },
    required: ["a"],
  });
});

test("no tool parameter schema anywhere still carries nullable or format", () => {
  const text = JSON.stringify(functionTools(ENV));
  assert.doesNotMatch(text, /"nullable"/);
  assert.doesNotMatch(text, /"format"/);
});

// --------------------------------------------------------------- the agents

test("the three specialists are plain FUNCTION tools, not connected agents", () => {
  // The owner took the documented fallback (spec §12). Not because
  // connected_agent failed — it behaved exactly as the spike showed — but
  // because a connected agent's inner run executes inside Foundry and so cannot
  // carry a function tool. A specialist that cannot retrieve can only be handed
  // text the orchestrator already holds, which made every delegation a wasted
  // step.
  const tools = orchestratorDefinition(ENV).tools;
  assert.equal(tools.filter((t) => t.type === "connected_agent").length, 0);
  assert.ok(tools.every((t) => t.type === "function"));
  const names = tools.map((t) => t.function.name);
  for (const name of SPECIALIST_NAMES) assert.ok(names.includes(name), `${name} is not a tool`);
});

test("no specialist takes a facility_id: a model cannot point one at another borrower", () => {
  for (const tool of specialistTools()) {
    const props = Object.keys(tool.function.parameters.properties ?? {});
    assert.ok(!props.includes("facility_id"), `${tool.function.name} exposes facility_id`);
  }
});

test("definition_agent takes no arguments at all, so there is nothing to steer it with", () => {
  const def = specialistTools().find((t) => t.function.name === "definition_agent");
  assert.deepEqual(def.function.parameters, { type: "object", properties: {} });
});

test("document_agent and research_agent each require their question, and may narrow doc_types", () => {
  const byName = Object.fromEntries(specialistTools().map((t) => [t.function.name, t.function.parameters]));
  assert.deepEqual(byName.document_agent.required, ["question"]);
  assert.deepEqual(byName.research_agent.required, ["gap"]);
  for (const name of ["document_agent", "research_agent"]) {
    assert.deepEqual(byName[name].properties.doc_types.items.enum, [...DOC_TYPES], name);
  }
});

test("the orchestrator carries six tools and is the only agent object", () => {
  const tools = orchestratorDefinition(ENV).tools;
  assert.equal(tools.length, 6);
  assert.deepEqual(
    tools.map((t) => t.function.name).sort(),
    ["definition_agent", "document_agent", "dscr_calculator", "research_agent", "search_documents", "search_past_cases"],
  );
});

// ------------------------------------------------------------- the ids file

test("the committed ids file is read from the repo root and yields the orchestrator id", () => {
  const dir = mkdtempSync(join(tmpdir(), "creditscout-agents-"));
  const nested = join(dir, "lib", "agent");
  writeFileSync(join(dir, "package.json"), "{}");
  mkdirSync(nested, { recursive: true });
  writeFileSync(
    join(dir, AGENTS_FILE),
    JSON.stringify({ api_version: "2025-05-01", agents: { [ORCHESTRATOR_NAME]: "asst_live" } }),
  );
  assert.equal(readAgentsFile(dir).api_version, "2025-05-01");
  assert.equal(orchestratorAgentId(dir), "asst_live");
});

test("a missing or empty ids file says how to create it rather than failing obscurely", () => {
  const dir = mkdtempSync(join(tmpdir(), "creditscout-agents-"));
  assert.throws(() => orchestratorAgentId(dir), /is missing\. Run "node --env-file=\.env scripts\/foundry-agents\.mjs"/);

  const other = mkdtempSync(join(tmpdir(), "creditscout-agents-"));
  mkdirSync(join(other, "lib", "agent"), { recursive: true });
  writeFileSync(join(other, AGENTS_FILE), JSON.stringify({ agents: {} }));
  assert.throws(() => orchestratorAgentId(other), /carries no id for creditscout_orchestrator/);
});

// ---------------------------------------------------------------- the wire

test("a run is started as one call that creates the thread with the brief already in it", () => {
  const impl = fakeFetch([{ id: "run_1", thread_id: "thread_1", status: "queued" }]);
  return startRun("asst_live", "INVESTIGATION BRIEF", deps(impl)).then((run) => {
    assert.equal(run.thread_id, "thread_1");
    const [call] = impl.calls;
    assert.equal(call.method, "POST");
    assert.match(call.url, /\/threads\/runs\?api-version=2025-05-01$/);
    assert.equal(call.body.assistant_id, "asst_live");
    assert.deepEqual(call.body.thread.messages, [{ role: "user", content: "INVESTIGATION BRIEF" }]);
    assert.equal(call.headers.authorization, "Bearer fake-token");
  });
});

test("the guardrail's one retry is a run on the SAME thread, carrying its message, and barred from tools", () => {
  // tool_choice "none" is what keeps the retry to one turn: it restates an
  // answer, it does not investigate again past a cap nobody would count.
  const impl = fakeFetch([{ id: "run_2", thread_id: "thread_1", status: "queued" }]);
  return createRunOnThread("thread_1", "asst_live", "Reply again with ONE JSON object.", deps(impl)).then((run) => {
    assert.equal(run.id, "run_2");
    const [call] = impl.calls;
    assert.equal(call.method, "POST");
    assert.match(call.url, /\/threads\/thread_1\/runs\?api-version=2025-05-01$/);
    assert.deepEqual(call.body, {
      assistant_id: "asst_live",
      additional_messages: [{ role: "user", content: "Reply again with ONE JSON object." }],
      tool_choice: "none",
    });
  });
});

test("run steps are requested oldest-first and paginated to the end", () => {
  // A policy max_steps above one page would otherwise read as a cap that is
  // never reached — a safety limit failing silently.
  const impl = fakeFetch([
    { data: [{ id: "step_1" }], has_more: true, last_id: "step_1" },
    { data: [{ id: "step_2" }], has_more: false, last_id: "step_2" },
  ]);
  return getRunSteps("thread_1", "run_1", deps(impl)).then((steps) => {
    assert.deepEqual(steps.map((s) => s.id), ["step_1", "step_2"]);
    assert.match(impl.calls[0].url, new RegExp(`order=asc&limit=${STEP_PAGE_SIZE}`));
    assert.doesNotMatch(impl.calls[0].url, /after=/);
    assert.match(impl.calls[1].url, /after=step_1/);
  });
});

test("a single page is one request, not two", () => {
  const impl = fakeFetch([{ data: [{ id: "step_1" }], has_more: false, last_id: "step_1" }]);
  return getRunSteps("thread_1", "run_1", deps(impl)).then(() => assert.equal(impl.calls.length, 1));
});

test("tool outputs are submitted against the run that asked for them", () => {
  const impl = fakeFetch([{ id: "run_1", thread_id: "thread_1", status: "queued" }]);
  return submitToolOutputs("thread_1", "run_1", [{ tool_call_id: "call_1", output: "{}" }], deps(impl)).then(() => {
    assert.match(impl.calls[0].url, /\/threads\/thread_1\/runs\/run_1\/submit_tool_outputs/);
    assert.deepEqual(impl.calls[0].body.tool_outputs, [{ tool_call_id: "call_1", output: "{}" }]);
  });
});

test("the agent's answer is taken from THIS run's assistant message, not the newest message in the thread", () => {
  const impl = fakeFetch([
    {
      data: [
        { role: "assistant", run_id: "run_OTHER", content: [{ type: "text", text: { value: "a later run's answer" } }] },
        { role: "assistant", run_id: "run_1", content: [{ type: "text", text: { value: '{"recommendation":"resolve"}' } }] },
        { role: "user", run_id: null, content: [{ type: "text", text: { value: "the brief" } }] },
      ],
    },
  ]);
  return latestAssistantText("thread_1", "run_1", deps(impl)).then((text) => {
    assert.equal(text, '{"recommendation":"resolve"}');
  });
});

test("a run that produced no assistant message returns an empty string, never a fabricated answer", () => {
  const impl = fakeFetch([{ data: [{ role: "user", run_id: null, content: [{ type: "text", text: { value: "the brief" } }] }] }]);
  return latestAssistantText("thread_1", "run_1", deps(impl)).then((text) => assert.equal(text, ""));
});

test("a non-2xx from Foundry is an error carrying the status and the body", async () => {
  const impl = async () => new Response('{"error":{"message":"model not supported"}}', { status: 400 });
  await assert.rejects(
    () => startRun("asst_live", "brief", deps(impl)),
    (e) => e.status === 400 && /model not supported/.test(e.message),
  );
});
