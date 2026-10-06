#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { AGENTS_FILE, createAgents, foundryConfig, orchestratorDefinition } from "../lib/agent/foundry.ts";

/**
 * Create or update the Foundry agent and write its id to AGENTS_FILE.
 *
 * There is ONE agent. The three specialists are plain function tools on it,
 * serviced in-process, not connected agents — see `specialistTools` in
 * lib/agent/foundry.ts for the ruling.
 *
 * Spec §8.3 requires the agent definitions to be committed after every change.
 * The definitions themselves live in `lib/agent/prompt.ts` (instructions) and
 * `lib/agent/openapi.ts` (tool contracts), both in version control; this file
 * writes the ids that tie them to the live project, so a rebuild is
 * reproducible and the trace history in the Foundry portal stays attached to
 * the same agent objects.
 *
 *   node --env-file=.env scripts/foundry-agents.mjs
 *   node --env-file=.env scripts/foundry-agents.mjs --dry-run
 *
 * `--dry-run` prints what would be sent, makes no network call and writes
 * nothing, which makes it the cheap way to review a prompt change. It still
 * needs --env-file=.env for the endpoint and the model names.
 */

const dryRun = process.argv.includes("--dry-run");
const config = foundryConfig();

if (dryRun) {
  const def = orchestratorDefinition();
  console.log(`\n=== ${def.name} (${def.model}) ===`);
  console.log(def.instructions);
  console.log("\ntools:", def.tools.map((t) => `function:${t.function.name}`).join(", "));
  console.log("\n--dry-run: nothing was created or written.");
  process.exit(0);
}

console.log(`project: ${config.endpoint}`);
console.log(`orchestrator model: ${config.orchestratorModel}  specialists (serviced in-process): ${config.specialistModel}`);

const agents = await createAgents();

const payload = {
  api_version: config.apiVersion,
  orchestrator_model: config.orchestratorModel,
  specialist_model: config.specialistModel,
  updated_at: new Date().toISOString(),
  agents,
};
const path = join(process.cwd(), AGENTS_FILE);
writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);

for (const [name, id] of Object.entries(agents)) console.log(`  ${name.padEnd(26)} ${id}`);
console.log(`\nwrote ${AGENTS_FILE} — commit it.`);
