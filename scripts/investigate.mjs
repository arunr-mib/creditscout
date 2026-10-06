#!/usr/bin/env node
/**
 * Drive one investigation from the command line, the way stage 9's screen will.
 *
 *   npm run dev                                          (in another terminal)
 *   node --env-file=.env scripts/investigate.mjs <exception_id>
 *
 *   1. POST /api/investigate, with the tool key. Starts the investigation, or
 *      returns the casefile already under way for that exception (a casefile
 *      already in review is returned too, and nothing is started).
 *   2. POST /api/investigate/sync until the casefile is no longer
 *      `investigating`, printing each trace step as it lands. Each sync drives
 *      the Foundry run for a bounded time and hands back; this is the poll.
 *   3. Print the enforced casefile: the recommendation, the notes grouped by
 *      layer, the claims that survived and the ones the guardrail removed, the
 *      calc_ids, and the governing terms' drift note.
 *
 * Nothing here decides or writes anything. Every write is the routes'; the
 * casefile is READ with the service-role key, server-side, as the routes read
 * it. That is also the contract stage 9 inherits: the browser cannot call the
 * investigate routes (the key stays on the server), so its Investigate button
 * goes through a Server Action that does what steps 1 and 2 do here.
 *
 * Options:
 *   --max-minutes N   give up after N minutes (default 15)
 *   --quiet           do not print a heartbeat between steps
 */

import { createClient } from "@supabase/supabase-js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOOL_KEY_HEADER = "x-creditscout-tool-key";
const POLL_GAP_MS = 1_000;
const MAX_CONSECUTIVE_ERRORS = 3;

const args = process.argv.slice(2);
const exceptionId = args.find((a) => !a.startsWith("--"));
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : fallback;
};

function die(message, code = 1) {
  console.error(`investigate: ${message}`);
  process.exit(code);
}

if (!exceptionId || !UUID.test(exceptionId)) die("usage: node --env-file=.env scripts/investigate.mjs <exception_id> [--max-minutes N] [--quiet]");
const key = process.env.CREDITSCOUT_TOOL_KEY;
if (!key) die("CREDITSCOUT_TOOL_KEY is not set (run with --env-file=.env)");
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) die("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");

const base = (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deadline = Date.now() + option("--max-minutes", 15) * 60_000;

async function post(path, body) {
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", [TOOL_KEY_HEADER]: key },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { status: 0, json: { error: `${base} could not be reached (${err.message}). Is "npm run dev" running?` } };
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { error: text.slice(0, 300) };
  }
  return { status: res.status, json };
}

async function read(table, columns, column, value) {
  const { data, error } = await db.from(table).select(columns).eq(column, value);
  if (error) die(`read ${table}: ${error.message}`);
  return data ?? [];
}

// ---------------------------------------------------------------- 1. start

const started = await post("/api/investigate", { exception_id: exceptionId });
if (started.status !== 200) die(`POST /api/investigate -> ${started.status}: ${started.json.error ?? JSON.stringify(started.json)}`);
const casefileId = started.json.casefile_id;
console.log(`casefile ${casefileId}  (${started.json.reused ? `reused, ${started.json.status}` : "new investigation started"})`);
console.log("");

// ----------------------------------------------------------------- 2. poll

let printed = 0;
let errors = 0;
let last = started.json.status === "investigating" ? null : { casefile_status: started.json.status };

async function printNewSteps() {
  const [row] = await read("casefiles", "trace", "id", casefileId);
  const trace = Array.isArray(row?.trace) ? row.trace : [];
  for (const step of trace.slice(printed)) {
    console.log(`  ${String(step.n).padStart(2)}. ${String(step.tool).padEnd(18)} ${step.input_summary ?? ""}`);
    console.log(`      ${" ".repeat(18)} -> ${step.output_summary ?? ""}`);
  }
  printed = Math.max(printed, trace.length);
}

while (last === null || last.casefile_status === "investigating") {
  if (Date.now() > deadline) die(`still investigating after ${option("--max-minutes", 15)} minutes; casefile ${casefileId} is left as it is`);
  const synced = await post("/api/investigate/sync", { casefile_id: casefileId });
  if (synced.status !== 200) {
    errors += 1;
    console.error(`  sync -> ${synced.status}: ${synced.json.error ?? JSON.stringify(synced.json)}`);
    if (errors >= MAX_CONSECUTIVE_ERRORS) die(`${errors} sync failures in a row; casefile ${casefileId} is left as it is`);
    await sleep(POLL_GAP_MS * 2);
    continue;
  }
  errors = 0;
  last = synced.json;
  await printNewSteps();
  if (last.casefile_status === "investigating" && !flag("--quiet")) {
    console.log(`      ... run ${last.run_status}, ${last.steps}/${last.max_steps} steps`);
  }
  if (last.casefile_status === "investigating") await sleep(POLL_GAP_MS);
}
await printNewSteps();

// --------------------------------------------------------- 3. the casefile

const [cf] = await read(
  "casefiles",
  "id, exception_id, status, recommendation, suggested_tag, confidence_basis, explanation, claims, calc_ids, missing_evidence, guardrail_notes, terms, agent_output, steps_count",
  "id",
  casefileId,
);
const [exception] = await read("exceptions", "status", "id", cf.exception_id);
console.log("");
console.log(`run ended: ${last.run_status ?? "-"}${last.stopped ? ` (stopped: ${last.stopped})` : ""}${last.error ? ` — ${last.error}` : ""}`);
console.log(`casefile status   ${cf.status}        exception status   ${exception?.status}`);
if (cf.status === "failed") {
  for (const n of cf.guardrail_notes ?? []) console.log(`  [${n.layer}] ${n.check}/${n.action}: ${n.detail}`);
  process.exit(2);
}
console.log(`recommendation    ${String(cf.recommendation).toUpperCase()}        suggested tag   ${cf.suggested_tag}        steps   ${cf.steps_count}`);
console.log("");
console.log(`confidence basis  ${cf.confidence_basis}`);
console.log(`explanation       ${cf.explanation}`);

console.log("");
console.log("guardrail notes, by layer:");
const notes = Array.isArray(cf.guardrail_notes) ? cf.guardrail_notes : [];
if (notes.length === 0) console.log("  (none — nothing was forced, removed or flagged)");
for (const layer of [...new Set(notes.map((n) => n.layer))]) {
  console.log(`  ${layer}`);
  for (const n of notes.filter((x) => x.layer === layer)) console.log(`    ${n.check} / ${n.action}: ${n.detail}`);
}

const survived = Array.isArray(cf.claims) ? cf.claims : [];
let said = [];
try {
  const raw = String(cf.agent_output ?? "").trim();
  const fenced = /^```[A-Za-z0-9_-]*[^\S\n]*\n?([\s\S]*?)\n?\s*```$/.exec(raw);
  said = JSON.parse(fenced ? fenced[1] : raw).claims ?? [];
} catch {
  said = [];
}
const same = (a, b) => a.citation === b.citation && a.quote === b.quote && a.text === b.text;
const removed = said.filter((c) => !survived.some((s) => same(c, s)));
console.log("");
console.log(`claims that survived (${survived.length}):`);
for (const c of survived) console.log(`  [${c.citation}] ${c.text}`);
console.log(`claims the guardrail removed (${removed.length}):`);
for (const c of removed) console.log(`  [${c.citation}] ${c.text}`);

console.log("");
console.log("calc_ids (from the log, oldest first; the last governs):");
const calcs = cf.calc_ids?.length ? (await db.from("calc_log").select("calc_id, casefile_id, test_id, outputs").in("calc_id", cf.calc_ids)).data ?? [] : [];
for (const id of cf.calc_ids ?? []) {
  const r = calcs.find((x) => x.calc_id === id);
  const origin = r?.test_id ? "originating test" : r?.casefile_id ? "this investigation" : "?";
  console.log(`  ${id}  ${origin.padEnd(18)} DSCR ${r?.outputs?.dscr} vs ${r?.outputs?.threshold} — ${r?.outputs?.pass ? "pass" : "fail"}`);
}

console.log("");
const drift = notes.find((n) => n.check === "terms_differ_from_approved" || n.check === "terms_unverified");
console.log(`governing terms: ${drift ? `${drift.check} / ${drift.action}` : "no drift note — the governing calculation ran on the approved terms"}`);
if (drift) console.log(`  ${drift.detail}`);
if (cf.terms?.source_citations?.length) console.log(`  definition_agent citations captured: ${cf.terms.source_citations.map((c) => c.citation).join(", ")}`);
process.exit(cf.status === "pending_review" ? 0 : 1);
