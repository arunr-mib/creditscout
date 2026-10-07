import { test } from "node:test";
import assert from "node:assert/strict";

import { syncInvestigation } from "./poll.ts";
import { TOOL_KEY_HEADER } from "./auth.ts";

const TOOL_KEY = "test-tool-key-0123456789abcdef0123456789abcdef";

function captureFetch(response) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return response;
  };
  return { calls, fetchImpl };
}

const ok = (body) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

test("the Server Action passes the tool key server-side, in the gated route's header", async () => {
  const { calls, fetchImpl } = captureFetch(ok({ casefile_status: "investigating", run_status: "in_progress", steps: 1, max_steps: 12 }));
  await syncInvestigation("cf-1", { fetchImpl, toolKey: TOOL_KEY, baseUrl: "https://app.example" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://app.example/api/investigate/sync");
  assert.equal(calls[0].init.headers[TOOL_KEY_HEADER], TOOL_KEY);
  assert.match(calls[0].init.body, /cf-1/);
});

test("the tool key is NEVER in what the Server Action returns to the client", async () => {
  const { fetchImpl } = captureFetch(ok({ casefile_status: "pending_review", run_status: "completed", steps: 4, max_steps: 12 }));
  const state = await syncInvestigation("cf-1", { fetchImpl, toolKey: TOOL_KEY, baseUrl: "https://app.example" });

  assert.equal(JSON.stringify(state).includes(TOOL_KEY), false);
  assert.equal(Object.prototype.hasOwnProperty.call(state, "toolKey"), false);
  assert.equal(state.casefileStatus, "pending_review");
});

test("an unreachable sync is reported as still investigating, not as a failure", async () => {
  const fetchImpl = async () => {
    throw new Error("ECONNREFUSED");
  };
  const state = await syncInvestigation("cf-1", { fetchImpl, toolKey: TOOL_KEY, baseUrl: "https://app.example" });
  assert.equal(state.casefileStatus, "investigating");
  assert.match(state.error, /could not be reached/);
});

test("a non-2xx surfaces an error but does not itself conclude the casefile", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({}), { status: 500, headers: { "content-type": "application/json" } });
  const state = await syncInvestigation("cf-1", { fetchImpl, toolKey: TOOL_KEY, baseUrl: "https://app.example" });
  assert.equal(state.casefileStatus, "investigating");
  assert.match(state.error, /returned 500/);
});
