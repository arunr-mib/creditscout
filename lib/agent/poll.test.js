import { test } from "node:test";
import assert from "node:assert/strict";

import { syncInvestigation } from "./poll.ts";

const TOOL_KEY = "test-tool-key-0123456789abcdef0123456789abcdef";

test("the drive runs in process — no HTTP, so there is no self-call to fail", async () => {
  // The regression this guards: syncInvestigation used to POST its own
  // /api/investigate/sync. On Vercel that fetch failed, every drive returned
  // "could not be reached", and the run sat at zero steps while Foundry waited.
  const original = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = async () => {
    fetched += 1;
    throw new Error("no HTTP should happen here");
  };
  try {
    const seen = [];
    const state = await syncInvestigation("cf-1", {
      syncImpl: async (id) => {
        seen.push(id);
        return { casefile_status: "investigating", run_status: "in_progress", steps: 1, max_steps: 12 };
      },
    });
    assert.equal(fetched, 0, "the drive must not reach for the network");
    assert.deepEqual(seen, ["cf-1"]);
    assert.equal(state.casefileStatus, "investigating");
    assert.equal(state.steps, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("nothing secret reaches the client: only the sanitised SyncState comes back", async () => {
  const state = await syncInvestigation("cf-1", {
    syncImpl: async () => ({
      casefile_status: "pending_review",
      run_status: "completed",
      steps: 4,
      max_steps: 12,
      // The orchestrator's raw reply may carry internals; none may survive.
      tool_key: TOOL_KEY,
      foundry_run_id: "run_secret",
    }),
  });

  assert.equal(JSON.stringify(state).includes(TOOL_KEY), false);
  assert.equal(JSON.stringify(state).includes("run_secret"), false);
  assert.equal(state.casefileStatus, "pending_review");
});

test("a thrown drive is reported as still investigating, not as a failure", async () => {
  const state = await syncInvestigation("cf-1", {
    syncImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
  });
  assert.equal(state.casefileStatus, "investigating", "a blip must not read as a failed investigation");
  assert.match(state.error, /could not be advanced/);
  assert.match(state.error, /ECONNREFUSED/);
});

test("the real reason is unwrapped from `cause`, not swallowed as 'fetch failed'", async () => {
  // Node reports network faults as a bare "fetch failed" with the reason on
  // `cause`. Losing it is what made the first production failure undiagnosable.
  const state = await syncInvestigation("cf-1", {
    syncImpl: async () => {
      throw new Error("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND app.example") });
    },
  });
  assert.match(state.error, /fetch failed/);
  assert.match(state.error, /ENOTFOUND app\.example/, "the cause must survive into the message");
});

test("a cause that repeats the message is not printed twice", async () => {
  const state = await syncInvestigation("cf-1", {
    syncImpl: async () => {
      throw new Error("boom", { cause: new Error("boom") });
    },
  });
  assert.equal(state.error, "the investigation could not be advanced: boom");
});
