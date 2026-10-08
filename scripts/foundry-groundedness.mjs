#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Upload an eval pass's foundry-<mode>.jsonl to Azure AI Foundry as a dataset
 * and run the Groundedness evaluator over it.
 *
 * Groundedness is the ONE metric CreditScout lets a model judge. Everything on
 * the Harmless and Helpful pillars is graded by deterministic code against the
 * owner-signed oracle (evals/grade.mjs), because a safety number a model
 * scored is not evidence. Groundedness is different in kind: the question is
 * whether the explanation's claims are supported by the retrieved context, and
 * that is a reading task.
 *
 *   node --env-file=.env scripts/foundry-groundedness.mjs            # cold + warm
 *   node --env-file=.env scripts/foundry-groundedness.mjs --mode cold
 *   node --env-file=.env scripts/foundry-groundedness.mjs --dry-run
 *
 * BILLABLE: one judge call per row per pass (3 rows each today). --dry-run
 * makes no network call and is the cheap way to see what would be sent.
 *
 * Inputs come from `npm run eval -- --live`, which writes
 * evals/out/foundry-{cold,warm}.jsonl. Each row is {query, response, context,
 * ground_truth}; the judge reads response against context.
 */

// Two api-versions on purpose: the datasets plane is GA at 2025-05-01, while
// evaluations/runs is preview-only and rejects it outright
// ("UnsupportedApiVersionValue"). Keeping them separate beats pinning both to a
// preview that may move.
const DATA_API = "2025-05-01";
const EVAL_API = "2025-11-15-preview";
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const modeArg = args.includes("--mode") ? args[args.indexOf("--mode") + 1] : null;
const modes = modeArg ? [modeArg] : ["cold", "warm"];

const endpoint = (process.env.AZURE_AI_PROJECT_ENDPOINT || "").replace(/\/+$/, "");
const judge = process.env.AZURE_JUDGE_DEPLOYMENT;
const aoai = process.env.AZURE_OPENAI_ENDPOINT;
if (!endpoint) throw new Error("AZURE_AI_PROJECT_ENDPOINT is not set");
if (!judge) throw new Error("AZURE_JUDGE_DEPLOYMENT is not set");
if (!aoai) throw new Error("AZURE_OPENAI_ENDPOINT is not set (the judge's model_config needs it)");

const OUT = path.join(process.cwd(), "evals", "out");
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

/** The local `az` CLI credential — the same auth the eval harness uses. */
async function token() {
  const { execFileSync } = await import("node:child_process");
  return execFileSync("az", ["account", "get-access-token", "--resource", "https://ai.azure.com", "--query", "accessToken", "-o", "tsv"], {
    encoding: "utf8",
  }).trim();
}

async function api(tok, method, pathAndQuery, body, apiVersion = DATA_API) {
  const sep = pathAndQuery.includes("?") ? "&" : "?";
  const res = await fetch(`${endpoint}/${pathAndQuery}${sep}api-version=${apiVersion}`, {
    method,
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${pathAndQuery} -> ${res.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

/** Upload one file as dataset `name:version` and return its id for an eval run. */
async function uploadDataset(tok, name, version, body) {
  const pending = await api(tok, "POST", `datasets/${name}/versions/${version}/startPendingUpload`, {
    pendingUploadType: "TemporaryBlobReference",
  });
  // The SAS is scoped to a CONTAINER (sr=c), so the blob name goes in the path
  // ahead of the query string.
  const sas = new URL(pending.blobReference.credential.sasUri);
  const blobName = `${name}-${version}.jsonl`;
  const put = await fetch(`${sas.origin}${sas.pathname}/${blobName}${sas.search}`, {
    method: "PUT",
    headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": "application/jsonl" },
    body,
  });
  if (!put.ok) throw new Error(`blob upload -> ${put.status} ${(await put.text()).slice(0, 300)}`);

  const consumed = pending.blobReferenceForConsumption.blobUri.replace(":443", "");
  const ds = await api(tok, "PUT", `datasets/${name}/versions/${version}`, {
    type: "uri_file",
    dataUri: `${consumed}/${blobName}`,
  });
  return ds.id ?? `azureai://accounts/x/projects/x/data/${name}/versions/${version}`;
}

const rowsOf = (mode) => {
  const file = path.join(OUT, `foundry-${mode}.jsonl`);
  const text = readFileSync(file, "utf8").trim();
  if (!text) throw new Error(`${file} is empty — run \`npm run eval -- --live\` first`);
  return { text: `${text}\n`, rows: text.split("\n").map((l) => JSON.parse(l)) };
};

if (dryRun) {
  for (const mode of modes) {
    const { rows } = rowsOf(mode);
    console.log(`\n=== ${mode}: ${rows.length} rows, judge ${judge} ===`);
    for (const r of rows) {
      const ctx = (() => {
        try {
          return JSON.parse(r.context).length;
        } catch {
          return "unparsed";
        }
      })();
      console.log(`  - ${r.query.slice(0, 72)}…`);
      console.log(`    response ${r.response.length} chars, ${ctx} context chunk(s)`);
      if (ctx === 0) console.log("    ** no context: groundedness on this row is degenerate, not a real score **");
    }
  }
  console.log("\n--dry-run: nothing uploaded, nothing billed.");
  process.exit(0);
}

const tok = await token();
console.log(`project: ${endpoint}\njudge:   ${judge}\n`);

for (const mode of modes) {
  const { text, rows } = rowsOf(mode);
  const name = `creditscout-eval-${mode}`;
  console.log(`${mode}: uploading ${rows.length} rows as ${name}:${stamp}`);
  const datasetId = await uploadDataset(tok, name, stamp, text);
  console.log(`  dataset ${datasetId}`);

  // The create action is `runs:run`, not a POST to the collection — a plain
  // POST to `evaluations/runs` 404s on every api-version.
  const run = await api(tok, "POST", "evaluations/runs:run", {
    displayName: `creditscout-groundedness-${mode}-${stamp}`,
    description: `Groundedness over the ${mode} live eval pass (${rows.length} investigated cases).`,
    // `data` takes the bare {id}. Sending {type:"dataset", id} is accepted by
    // the request and then SILENTLY STORED AS NULL, so the run starts, finds no
    // rows and fails with an empty metrics object and no error message. Cost a
    // debugging round; don't reintroduce the type field.
    data: { id: datasetId },
    evaluators: {
      groundedness: {
        id: "azureai://built-in/evaluators/groundedness",
        // The judge wants a full model_config. `deploymentName` is ignored
        // (the run fails); `deployment_name` half-works — it completed but
        // scored fewer rows than it was given, which is worse than failing.
        initParams: { model_config: { azure_endpoint: aoai, azure_deployment: judge } },
        dataMapping: { query: "${data.query}", response: "${data.response}", context: "${data.context}" },
      },
    },
  }, EVAL_API);
  console.log(`  run ${run.name ?? run.id} — status ${run.status}`);
  console.log(`  portal: ${endpoint.replace("/api/projects/", "/projects/")}/evaluations\n`);
}

console.log("Submitted. Results land in the Foundry portal under Evaluations.");
console.log("Groundedness is reported there, not written back to eval_runs — copy it into the scoreboard by hand.");
