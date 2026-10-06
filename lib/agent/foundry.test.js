import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AGENTS_FILE,
  DEFAULT_API_VERSION,
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
  specialistDefinitions,
  startRun,
  submitToolOutputs,
  toJsonSchema,
} from "./foundry.ts";
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

test("the three specialists run on the specialist model and carry NO tools", () => {
  // A connected agent's inner run is executed inside Foundry and we never see
  // it, so a function tool on one parks that inner run at requires_action where
  // nothing can service it and the PARENT run hangs for ever. Verified live.
  const specialists = specialistDefinitions(ENV);
  assert.deepEqual(specialists.map((s) => s.name), [...SPECIALIST_NAMES]);
  for (const s of specialists) {
    assert.equal(s.model, "gpt-5-mini");
    assert.equal(s.tools, undefined);
    assert.ok(s.instructions.length > 200, `${s.name} has no instructions`);
  }
});

test("the orchestrator runs on gpt-4.1-mini, which the platform forces", () => {
  // gpt-5-mini is rejected at agent-creation time for connected_agent tools.
  // Confirmed live. This is not an upgrade waiting to happen.
  const ids = { document_agent: "asst_1", definition_agent: "asst_2", research_agent: "asst_3" };
  assert.equal(orchestratorDefinition(ids, ENV).model, "gpt-4.1-mini");
});

test("the orchestrator carries three connected agents and three function tools", () => {
  const ids = { document_agent: "asst_1", definition_agent: "asst_2", research_agent: "asst_3" };
  const tools = orchestratorDefinition(ids, ENV).tools;
  const connected = tools.filter((t) => t.type === "connected_agent");
  assert.deepEqual(connected.map((t) => t.connected_agent.name), [...SPECIALIST_NAMES]);
  assert.deepEqual(connected.map((t) => t.connected_agent.id), ["asst_1", "asst_2", "asst_3"]);
  assert.equal(tools.filter((t) => t.type === "function").length, 3);
});

test("the orchestrator cannot be defined with a specialist id missing, and says which", () => {
  assert.throws(() => orchestratorDefinition({ document_agent: "asst_1" }, ENV), /needs the agent id for definition_agent/);
});

// ------------------------------------------------------------- the ids file

test("the committed ids file is read from the repo root and yields the orchestrator id", () => {
  const dir = mkdtempSync(join(tmpdir(), "creditscout-agents-"));
  const nested = join(dir, "lib", "agent");
  writeFileSync(join(dir, "package.json"), "{}");
  mkdirSync(nested, { recursive: true });
  writeFileSync(
    join(dir, AGENTS_FILE),
    JSON.stringify({ api_version: "2025-05-01", agents: { [ORCHESTRATOR_NAME]: "asst_live", document_agent: "asst_doc" } }),
  );
  assert.equal(readAgentsFile(dir).agents.document_agent, "asst_doc");
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
