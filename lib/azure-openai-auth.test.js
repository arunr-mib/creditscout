import { test } from "node:test";
import assert from "node:assert/strict";

import { azureOpenAiAuthHeaders, clearAzureOpenAiTokenCache } from "./azure-openai-auth.ts";

const ENV_KEYS = ["AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AZURE_TENANT_ID", "AZURE_OPENAI_API_KEY"];

async function withEnv(values, fn) {
  const prior = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  try {
    for (const k of ENV_KEYS) delete process.env[k];
    for (const [k, v] of Object.entries(values)) process.env[k] = v;
    return await fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (prior[k] === undefined) delete process.env[k];
      else process.env[k] = prior[k];
    }
    clearAzureOpenAiTokenCache();
  }
}

test("with only an api-key, the headers carry the api-key (local dev)", async () => {
  await withEnv({ AZURE_OPENAI_API_KEY: "local-key-123" }, async () => {
    const h = await azureOpenAiAuthHeaders();
    assert.deepEqual(h, { "api-key": "local-key-123" });
  });
});

test("with a service principal configured, the headers carry an Entra Bearer token (deploy)", async () => {
  const realFetch = globalThis.fetch;
  let scopeSeen = "";
  try {
    globalThis.fetch = async (_url, init) => {
      scopeSeen = String(init.body);
      return new Response(JSON.stringify({ access_token: "entra-tok", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    await withEnv(
      { AZURE_CLIENT_ID: "cid", AZURE_CLIENT_SECRET: "sec", AZURE_TENANT_ID: "tid", AZURE_OPENAI_API_KEY: "ignored-when-sp-present" },
      async () => {
        const h = await azureOpenAiAuthHeaders(() => 0);
        assert.deepEqual(h, { authorization: "Bearer entra-tok" });
        // The data-plane scope for Azure OpenAI, not Foundry's ai.azure.com.
        assert.match(scopeSeen, /scope=https%3A%2F%2Fcognitiveservices\.azure\.com%2F\.default/);
      },
    );
  } finally {
    globalThis.fetch = realFetch;
    clearAzureOpenAiTokenCache();
  }
});

test("with neither an api-key nor a service principal, it throws rather than sending an empty credential", async () => {
  await withEnv({}, async () => {
    await assert.rejects(() => azureOpenAiAuthHeaders(), /not configured/);
  });
});
