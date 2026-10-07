/**
 * Azure OpenAI embeddings. The schema's `vector(1536)` columns depend on the
 * dimension, so it is asserted on every response: a silent mismatch would
 * surface much later as an unexplainable retrieval failure.
 */
import { azureOpenAiAuthHeaders } from "./azure-openai-auth.ts";

export const EMBEDDING_DIMENSIONS = 1536;

/** Texts per request. Well under the API's input-array limit, and a facility's whole corpus is ~50 chunks. */
const BATCH_SIZE = 16;
const API_VERSION = "2024-10-21";

function config() {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const deployment = process.env.AZURE_EMBEDDING_DEPLOYMENT;
  if (!endpoint || !deployment) {
    throw new Error("AZURE_OPENAI_ENDPOINT and AZURE_EMBEDDING_DEPLOYMENT must be set");
  }
  const url = `${endpoint.replace(/\/+$/, "")}/openai/deployments/${encodeURIComponent(deployment)}/embeddings?api-version=${API_VERSION}`;
  return { url };
}

async function embedBatch(texts: string[], url: string): Promise<number[][]> {
  const res = await fetch(url, {
    method: "POST",
    headers: { ...(await azureOpenAiAuthHeaders()), "content-type": "application/json" },
    body: JSON.stringify({ input: texts }),
  });
  if (!res.ok) {
    // Status and Azure's message only; never the key or the request body.
    const detail = await res.text().catch(() => "");
    throw new Error(`Embedding request failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const body = (await res.json()) as { data?: { index: number; embedding: number[] }[] };
  const rows = [...(body.data ?? [])].sort((a, b) => a.index - b.index);
  if (rows.length !== texts.length) {
    throw new Error(`Embedding response had ${rows.length} vectors for ${texts.length} inputs`);
  }
  for (const row of rows) {
    if (row.embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding has ${row.embedding.length} dimensions; the schema requires ${EMBEDDING_DIMENSIONS}`,
      );
    }
  }
  return rows.map((r) => r.embedding);
}

/** One 1536-dimension vector per input text, in input order. Throws; never returns a partial result. */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { url } = config();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    out.push(...(await embedBatch(texts.slice(i, i + BATCH_SIZE), url)));
  }
  return out;
}
