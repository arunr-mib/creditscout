import type { SupabaseClient } from "@supabase/supabase-js";
import { buildExceptionProfile, topLessons } from "../memory.ts";
import { DEFAULT_RUN_ID } from "../retrieval.ts";
import { termsInForce } from "../terms.ts";
import { TOOL_KEY_HEADER } from "./auth.ts";
import {
  cancelRun,
  getRun,
  getRunSteps,
  isTerminal,
  latestAssistantText,
  orchestratorAgentId,
  startRun,
  submitToolOutputs,
  type FoundryDeps,
  type Run,
  type ToolOutput,
} from "./foundry.ts";
import { DEFAULT_BASE_URL } from "./openapi.ts";
import { buildInvestigationPrompt, SPECIALIST_NAMES, type SpecialistName } from "./prompt.ts";
import { SPECIALIST_RUNNERS, type SpecialistRunner } from "./specialists.ts";
import { mapRunStepsToTrace, type TraceEntry } from "./trace.ts";

/**
 * The investigation loop: start a Foundry run against an exception, then drive
 * it, mirroring every completed step into `casefiles.trace` as it happens.
 *
 * Three things this file will not do, each for a stated reason.
 *
 * IT DOES NOT REACH `pending_review`. That transition is the guardrail's act
 * (stage 8b). Making it here would let a casefile reach a reviewable state
 * unpoliced, which is the one thing the architecture exists to prevent. A
 * terminal run leaves the raw output on the casefile and the status
 * `investigating`.
 *
 * IT DOES NOT WRITE TO `tests` OR `covenant_terms`. The agent recomputes on
 * re-mapped terms mid-investigation; the `tests` row records what the APPROVED
 * terms produced, and that is the audit fact. Re-boarding is an analyst's act.
 *
 * IT DOES NOT PRESENT A FAILURE AS A RESULT. A failed, cancelled or stalled run
 * leaves `casefiles.status = 'failed'` with the message and nothing that reads
 * as a recommendation, because an analyst cannot tell a half-formed answer from
 * a whole one.
 */

type Db = Pick<SupabaseClient, "from">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Postgres unique_violation: here, another request claimed this exception first. */
const UNIQUE_VIOLATION = "23505";

/** How long one sync call will drive a run before handing back. Well under any serverless ceiling. */
export const DEFAULT_DEADLINE_MS = 25_000;
export const DEFAULT_POLL_INTERVAL_MS = 1_500;
/** A run that has produced no new step for this long is not thinking, it is stuck. */
export const STALL_AFTER_MS = 10 * 60_000;
/** Our own tool routes, by the operationId the agent calls them with. */
export const TOOL_ROUTES: Record<string, string> = {
  dscr_calculator: "/api/tools/dscr-calculator",
  search_documents: "/api/tools/search-documents",
  search_past_cases: "/api/tools/search-past-cases",
};
const TOOL_TIMEOUT_MS = 60_000;

/** An error that maps straight onto an HTTP status. */
export class InvestigationError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface OrchestratorDeps {
  /** A service-role client. Defaults to `supabaseAdmin()`, loaded lazily so tests never import the server-only module. */
  client?: Db;
  foundry?: FoundryDeps;
  /** Calls one of our own tool routes over HTTP. Injected only by tests. */
  callTool?: (name: string, args: unknown, ctx: ToolContext) => Promise<string>;
  /** The memory lookup. Injected so a unit test never reaches the embedding service. */
  lessons?: typeof topLessons;
  /** Individual specialist runners, injected so a test can pin what context they are handed. */
  specialists?: Partial<Record<SpecialistName, SpecialistRunner>>;
  /** The HTTP call to one of our own tool routes. Injected only by tests. */
  callRoute?: (name: string, args: unknown, ctx: ToolContext) => Promise<string>;
  agentId?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  deadlineMs?: number;
  pollIntervalMs?: number;
}

async function defaultClient(): Promise<Db> {
  const { supabaseAdmin } = await import("../supabase/server.ts");
  return supabaseAdmin();
}

const check = <T>(res: { data?: T | null; error: { message: string } | null }, what: string): T | null => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data ?? null;
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One sync at a time per casefile (review finding I-2).
 *
 * Stage 9 polls every second and a sync runs for up to 25, so overlapping syncs
 * are the normal case, not a race to shrug at. Two of them service the SAME
 * tool call: the calculator runs twice, leaving duplicate `calc_log` rows on
 * the casefile, and the loser's `submit_tool_outputs` is rejected. The
 * duplicates are the real damage — the guardrail verifies every figure in an
 * explanation against that log, so noise in it weakens the one record that has
 * to be exact.
 *
 * In-process, which fully serialises one server. Two Vercel instances could
 * still overlap; closing that needs a database lease, and it is recorded as
 * open rather than papered over.
 */
const inFlight = new Map<string, Promise<SyncResult>>();

/**
 * The step cap, read fresh on every sync. It is the Risk Officer's live lever,
 * so it is never a constant in this file and never cached across calls.
 *
 * A missing or malformed value refuses the sync rather than assuming one. The
 * failure of an absent cap is an agent loop that runs until Foundry stops it,
 * and that is the expensive direction to be wrong in.
 */
export async function readMaxSteps(client: Db): Promise<number> {
  const row = check(await client.from("policy").select("value").eq("key", "max_steps").maybeSingle(), "read policy") as
    | { value?: unknown }
    | null;
  const value = row?.value;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error("policy.max_steps is missing or not a positive integer");
  }
  return value;
}

// ------------------------------------------------------------------- start

export interface StartResult {
  casefileId: string;
  /** Our status, not Foundry's. `failed` here means the run never started. */
  status: string;
  /** True when an investigation was already under way and this call started nothing. */
  reused: boolean;
}

interface CasefileRow {
  id: string;
  exception_id: string;
  status: string;
  steps_count: number;
  guardrail_notes: unknown;
  agent_output: string | null;
  run_id: string;
  foundry_thread_id: string | null;
  foundry_run_id: string | null;
  last_step_at: string | null;
  created_at: string;
}

// `agent_output` is in this list because `driveRun` READS it: a capped casefile
// reports the answer it managed to produce before the run was stopped. Left out,
// every repeat sync said "its answer was captured" and returned nothing.
const CASEFILE_COLUMNS =
  "id, exception_id, status, steps_count, guardrail_notes, agent_output, run_id, foundry_thread_id, foundry_run_id, last_step_at, created_at";

/**
 * Only these may be driven forward. A casefile an analyst has already acted on
 * is not ours to rewrite (review finding I-3): without this guard, a sync on an
 * `approved` casefile whose Foundry run still reads `completed` would overwrite
 * the output under a decision a human has already signed.
 */
export const DRIVABLE_STATUSES = ["investigating"];

/** The newest casefile for this exception, whatever its status. */
async function latestCasefile(client: Db, exceptionId: string): Promise<CasefileRow | null> {
  return check(
    await client
      .from("casefiles")
      .select(CASEFILE_COLUMNS)
      .eq("exception_id", exceptionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "read casefiles",
  ) as CasefileRow | null;
}

/**
 * Begin investigating one exception, and return as soon as the run is started.
 *
 * The casefile row is created BEFORE the prompt is assembled, because the
 * prompt carries `casefile_id` and every calculation the agent asks for is
 * logged against it. A calculation that cannot be traced to a casefile is a
 * number the guardrail cannot vouch for.
 *
 * An exception already under investigation returns its existing casefile and
 * starts nothing. A `failed` casefile is not reused: that is the retry.
 */
export async function startInvestigation(exceptionId: string, deps: OrchestratorDeps = {}): Promise<StartResult> {
  if (typeof exceptionId !== "string" || !UUID.test(exceptionId)) {
    throw new InvestigationError(400, "exception_id must be a UUID");
  }
  const client = deps.client ?? (await defaultClient());
  const now = deps.now ?? Date.now;

  const bundle = await buildExceptionProfile(exceptionId, { client });

  const existing = await latestCasefile(client, exceptionId);
  if (existing && existing.status !== "failed") {
    return { casefileId: existing.id, status: existing.status, reused: true };
  }

  // The version in force for the period, which is the version our figure was
  // computed on. The agent has to know what it was tested against before it can
  // notice that it is out of date.
  const terms = await termsInForce(client, bundle.facility.id, bundle.exception.test_period_end);
  if (!terms) {
    throw new InvestigationError(
      409,
      `No approved covenant terms are in force for ${bundle.exception.test_period_end}. There is nothing to investigate against.`,
    );
  }

  const maxSteps = await readMaxSteps(client);

  // THE CLAIM, before anything slow. Everything above is a cheap read; the
  // lesson search below embeds a string over the network and takes well over a
  // second, and two POSTs arriving in that window would each read no casefile
  // and each start a Foundry run — two traces and two recommendations for one
  // question, both billed. Claiming first narrows the window to the round trip
  // of this insert; migration 0009's partial unique index closes it.
  const claimed = await client
    .from("casefiles")
    .insert({ exception_id: exceptionId, status: "investigating", run_id: DEFAULT_RUN_ID, trace: [] })
    .select("id")
    .single();
  if (claimed.error) {
    // 0009 applied, and someone else claimed this exception first. Their
    // casefile is the answer; this is not an error the analyst should see.
    if (claimed.error.code === UNIQUE_VIOLATION) {
      const theirs = await latestCasefile(client, exceptionId);
      if (theirs) return { casefileId: theirs.id, status: theirs.status, reused: true };
    }
    throw new Error(`write casefiles: ${claimed.error.message}`);
  }
  const casefile = claimed.data as { id: string };

  const lessons = await (deps.lessons ?? topLessons)(bundle.facility.id, bundle.profile, 3, {}, DEFAULT_RUN_ID);

  const prompt = buildInvestigationPrompt({
    casefileId: casefile.id,
    facility: bundle.facility,
    exception: bundle.exception,
    terms: { version: terms.version, status: terms.status, effective_from: terms.effective_from, terms: terms.terms },
    documents: bundle.documents,
    lessons,
    maxSteps,
  });

  let run: Run;
  try {
    const agentId = deps.agentId ?? orchestratorAgentId();
    run = await startRun(agentId, prompt, deps.foundry);
  } catch (err) {
    // The casefile stays, holding the reason. An exception whose investigation
    // never started must not look as though one is under way.
    const message = err instanceof Error ? err.message : String(err);
    await client.from("casefiles").update({ status: "failed", summary: `The investigation could not be started: ${message}` }).eq("id", casefile.id);
    return { casefileId: casefile.id, status: "failed", reused: false };
  }

  check(
    await client
      .from("casefiles")
      .update({ foundry_thread_id: run.thread_id, foundry_run_id: run.id, last_step_at: new Date(now()).toISOString() })
      .eq("id", casefile.id),
    "update casefiles",
  );
  check(await client.from("exceptions").update({ status: "investigating" }).eq("id", exceptionId), "update exceptions");

  return { casefileId: casefile.id, status: "investigating", reused: false };
}

// -------------------------------------------------------------- tool calls

export interface ToolContext {
  casefileId: string;
  facilityId: string;
  runId: string;
  /** The test period, so a specialist can be told which quarter it is reading for. */
  periodEnd: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The body we actually send, with the fields the model is not allowed to choose
 * overwritten.
 *
 * `facility_id` is forced because a model that named another borrower's id
 * would read a confidential agreement into this casefile, which is the worst
 * bug available in this system. `casefile_id` is forced so every calculation
 * lands in `calc_log` against this investigation whatever the model sent.
 */
export function toolRequestBody(name: string, args: unknown, ctx: ToolContext): Record<string, unknown> {
  const base = isObj(args) ? { ...args } : {};
  if (name === "dscr_calculator") return { ...base, casefile_id: ctx.casefileId };
  if (name === "search_documents") return { ...base, facility_id: ctx.facilityId };
  if (name === "search_past_cases") return { ...base, facility_id: ctx.facilityId, run_id: ctx.runId };
  return base;
}

/**
 * Calls our own HTTP route, with the tool key.
 *
 * Deliberately HTTP and not a library import. The route is where the fail-closed
 * auth check lives and where the `calc_log` write happens; importing the
 * function would skip both and prove less than it appears to. It is also
 * exactly the path Foundry itself will take once the app is deployed.
 */
async function callToolRoute(name: string, args: unknown, ctx: ToolContext): Promise<string> {
  const path = TOOL_ROUTES[name];
  if (!path) return JSON.stringify({ error: `${name} is not a tool this agent has.` });
  const base = (process.env.PUBLIC_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [TOOL_KEY_HEADER]: process.env.CREDITSCOUT_TOOL_KEY ?? "",
      },
      body: JSON.stringify(toolRequestBody(name, args, ctx)),
      signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
    });
    const text = await res.text();
    // A 4xx body is evidence the agent should reason about ("that field is
    // malformed"), not an outage to hide. It goes back verbatim.
    return text === "" ? JSON.stringify({ error: `${name} returned ${res.status} with no body` }) : text;
  } catch (err) {
    return JSON.stringify({ error: `${name} could not be reached: ${err instanceof Error ? err.message : String(err)}` });
  }
}

/**
 * The model's tool arguments, parsed strictly but tolerant of trailing noise.
 *
 * Live runs showed gpt-4.1-mini emitting a complete JSON object followed by a
 * stray `}` — three calculator calls in one run died on it. Discarding
 * characters AFTER a complete value infers nothing: every field still comes
 * from the model, and the route's shape validation is untouched.
 *
 * A TRUNCATED object is a different thing and is refused. A half-finished
 * object is missing fields, and accepting one would be the calculator reading a
 * missing value as absent-by-choice — the exact silent gap-filling the design
 * forbids.
 */
export function parseToolArguments(raw: unknown): { args: unknown } | { error: string } {
  const text = typeof raw === "string" && raw.trim() !== "" ? raw : "{}";
  try {
    return { args: JSON.parse(text) };
  } catch {
    // Fall through: find the end of the first complete value, if there is one.
  }
  const end = endOfFirstValue(text);
  if (end === null) {
    return { error: "your arguments were cut off mid-way and are not valid JSON; send ONE complete JSON object" };
  }
  try {
    return { args: JSON.parse(text.slice(0, end)) };
  } catch {
    return { error: "your arguments were not valid JSON; send ONE complete JSON object with no trailing characters" };
  }
}

/** The index just past the first balanced object or array, or null if it never closes. */
function endOfFirstValue(text: string): number | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return i + 1;
      if (depth < 0) return null;
    }
  }
  return null;
}

const isSpecialist = (name: string): name is SpecialistName => (SPECIALIST_NAMES as readonly string[]).includes(name);

/**
 * One tool call, serviced.
 *
 * The three OpenAPI-documented tools go over HTTP to our own routes, so the
 * real route, the real fail-closed auth and the real `calc_log` write are all
 * exercised — and it is the path Foundry itself takes once deployed. The three
 * specialists are serviced in-process: they have no route, because
 * `lib/agent/openapi.ts` is stage 10's and stays untouched.
 */
export async function callAnyTool(name: string, args: unknown, ctx: ToolContext, deps: OrchestratorDeps = {}): Promise<string> {
  if (isSpecialist(name)) {
    const runner = deps.specialists?.[name] ?? SPECIALIST_RUNNERS[name];
    try {
      // The facility and the period come from the CASEFILE, never from `args`.
      // A model naming another borrower's facility would read a confidential
      // agreement into this casefile, which is the worst bug available here, so
      // `args` is not consulted and is not merged in.
      return await runner(args, { facilityId: ctx.facilityId, periodEnd: ctx.periodEnd });
    } catch (err) {
      // A specialist that could not answer is missing evidence, not an outage
      // to crash on. The orchestrator reasons about it and moves on.
      return JSON.stringify({ error: `${name} could not answer: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
  return (deps.callRoute ?? callToolRoute)(name, args, ctx);
}

/** Service every tool call Foundry is waiting on. One bad call never fails the others. */
async function serviceToolCalls(run: Run, ctx: ToolContext, deps: OrchestratorDeps): Promise<ToolOutput[]> {
  const calls = run.required_action?.submit_tool_outputs?.tool_calls ?? [];
  const call = deps.callTool ?? ((name, args, ctx) => callAnyTool(name, args, ctx, deps));
  const outputs: ToolOutput[] = [];
  for (const toolCall of calls) {
    const name = toolCall.function?.name ?? "";
    const parsed = parseToolArguments(toolCall.function?.arguments);
    if ("error" in parsed) {
      outputs.push({ tool_call_id: toolCall.id, output: JSON.stringify({ error: parsed.error }) });
      continue;
    }
    outputs.push({ tool_call_id: toolCall.id, output: await call(name, parsed.args, ctx) });
  }
  return outputs;
}

// -------------------------------------------------------------------- sync

export type StopReason = "step_cap" | "stalled" | null;

export interface SyncResult {
  casefile_id: string;
  /** Foundry's status for the run. */
  run_status: string;
  /** Ours. `investigating` after a clean finish: the transition to review is the guardrail's (8b). */
  casefile_status: string;
  steps: number;
  max_steps: number;
  stopped: StopReason;
  /** The agent's raw final output. Present only on a clean finish; never parsed here. */
  output: string | null;
  error: string | null;
}

function describeFailure(run: Run): string {
  const detail = run.last_error?.message || (run.incomplete_details ? JSON.stringify(run.incomplete_details) : "");
  return detail ? `The Foundry run ${run.status}: ${detail}` : `The Foundry run ${run.status}.`;
}

/**
 * Poll the run, mirror its steps, service what it is waiting on, and record how
 * it ended.
 *
 * One call drives the run for at most `deadlineMs` and then hands back, so no
 * request stays open while the agent thinks. The caller polls. That is what
 * makes this fit a serverless runtime at all.
 */
export async function syncRun(casefileId: string, deps: OrchestratorDeps = {}): Promise<SyncResult> {
  if (typeof casefileId !== "string" || !UUID.test(casefileId)) {
    throw new InvestigationError(400, "casefile_id must be a UUID");
  }
  // Join the sync already running for this casefile rather than starting a
  // second one against the same Foundry run (I-2).
  const running = inFlight.get(casefileId);
  if (running) return running;
  const started = driveRun(casefileId, deps).finally(() => inFlight.delete(casefileId));
  inFlight.set(casefileId, started);
  return started;
}

async function driveRun(casefileId: string, deps: OrchestratorDeps): Promise<SyncResult> {
  const client = deps.client ?? (await defaultClient());
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? wait;
  const deadline = now() + (deps.deadlineMs ?? DEFAULT_DEADLINE_MS);

  const casefile = check(
    await client.from("casefiles").select(CASEFILE_COLUMNS).eq("id", casefileId).maybeSingle(),
    "read casefiles",
  ) as CasefileRow | null;
  if (!casefile) throw new InvestigationError(404, `No casefile ${casefileId}`);

  // The step cap is read here, on every sync, and never cached.
  const maxSteps = await readMaxSteps(client);

  const result = (over: Partial<SyncResult>): SyncResult => ({
    casefile_id: casefileId,
    run_status: "unknown",
    casefile_status: casefile.status,
    steps: casefile.steps_count,
    max_steps: maxSteps,
    stopped: null,
    output: null,
    error: null,
    ...over,
  });

  // A failed casefile is terminal for us. Retrying means a new investigation,
  // which startInvestigation will create because it does not reuse a failure.
  // A casefile an analyst has acted on, or one that already failed, is not ours
  // to drive or to rewrite (I-3).
  if (!DRIVABLE_STATUSES.includes(casefile.status)) {
    return result({ error: `this casefile is ${casefile.status} and is no longer being driven` });
  }
  // Reaching the cap ends the RUN, and it is a policy outcome rather than a
  // failure. Said once, it stays said — and whatever the agent managed to
  // conclude before the cap is reported with it, never thrown away.
  if (stoppedAtCap(casefile.guardrail_notes)) {
    // Tested for CONTENT, not for `!== null`. An absent column reads as
    // undefined, and that must not be reported as an answer that was captured —
    // claiming an answer exists when none does is the failure mode this whole
    // branch is here to avoid.
    const captured = typeof casefile.agent_output === "string" && casefile.agent_output !== "" ? casefile.agent_output : null;
    return result({
      stopped: "step_cap",
      output: captured,
      error:
        captured === null
          ? `The investigation reached the step cap of ${maxSteps} and was stopped. No recommendation was produced.`
          : `The investigation reached the step cap of ${maxSteps}. Its answer was captured before the run was stopped.`,
    });
  }
  if (!casefile.foundry_thread_id || !casefile.foundry_run_id) {
    const message = "The casefile carries no Foundry run; the investigation never started.";
    await markFailed(client, casefile, message, now);
    return result({ casefile_status: "failed", error: message });
  }

  const exception = check(
    await client.from("exceptions").select("facility_id, test_period_end").eq("id", casefile.exception_id).maybeSingle(),
    "read exceptions",
  ) as { facility_id: string; test_period_end: string } | null;
  if (!exception) throw new InvestigationError(404, `Casefile ${casefileId} names no live exception`);

  const ctx: ToolContext = {
    casefileId,
    facilityId: exception.facility_id,
    runId: casefile.run_id,
    periodEnd: exception.test_period_end,
  };
  const threadId = casefile.foundry_thread_id;
  const runId = casefile.foundry_run_id;
  let stepsSeen = casefile.steps_count;
  let run: Run;
  let trace: TraceEntry[] = [];
  let atCap = false;

  for (;;) {
    run = await getRun(threadId, runId, deps.foundry);
    trace = mapRunStepsToTrace(await getRunSteps(threadId, runId, deps.foundry));
    stepsSeen = await mirror(client, casefileId, trace, stepsSeen, now);

    // The cap limits TOOL CALLS. It does not take away the right to conclude.
    //
    // Cancelling the moment the count is reached threw away the answer of a run
    // that had finished investigating and was writing it up (review finding
    // I-5) — and `policy.js` accepts an `escalate` or a `request` at the cap, so
    // that discarded answer was one the policy engine would have kept. An agent
    // that has reached a conclusion gets to record it.
    atCap = trace.length >= maxSteps;
    if (atCap && !isTerminal(run.status)) {
      if (run.status === "requires_action") {
        // It wants ANOTHER tool. That is what the cap refuses. Stop the run,
        // then keep whatever it had already said.
        await cancelRun(threadId, runId, deps.foundry).catch(() => undefined);
        const salvaged = await latestAssistantText(threadId, runId, deps.foundry).catch(() => "");
        if (salvaged !== "") await writeAgentOutput(client, casefileId, salvaged, trace.length, now);
        await noteStepCap(client, casefileId, trace.length, maxSteps);
        return result({
          run_status: run.status,
          casefile_status: "investigating",
          steps: trace.length,
          stopped: "step_cap",
          output: salvaged === "" ? null : salvaged,
          error:
            salvaged === ""
              ? `The investigation reached the step cap of ${maxSteps} and was stopped. No recommendation was produced.`
              : `The investigation reached the step cap of ${maxSteps}. Its answer was captured before the run was stopped.`,
        });
      }
      // Queued or in progress at the cap: it is writing its answer. Let it
      // land. No cap note is written yet, because the note is what marks the
      // cap FINAL — writing it here would make the next sync return early and
      // lose the very answer this branch exists to wait for.
      if (now() >= deadline) return result({ run_status: run.status, casefile_status: casefile.status, steps: trace.length });
      await sleep(deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
      continue;
    }

    if (isTerminal(run.status)) break;

    if (run.status === "requires_action") {
      const calls = run.required_action?.submit_tool_outputs?.tool_calls ?? [];
      if (calls.length === 0) {
        const message = `The run is waiting on an action we cannot service: ${JSON.stringify(run.required_action ?? null).slice(0, 300)}`;
        await markFailed(client, casefile, message, now);
        return result({ run_status: run.status, casefile_status: "failed", steps: trace.length, error: message });
      }
      await submitToolOutputs(threadId, runId, await serviceToolCalls(run, ctx, deps), deps.foundry);
      continue;
    }

    // Queued or in progress. A run that has produced no new step for a long
    // time is stuck, not thinking: the inner run of a connected agent can park
    // somewhere we cannot see and never come back.
    const since = Date.parse(casefile.last_step_at ?? casefile.created_at);
    if (Number.isFinite(since) && now() - since > STALL_AFTER_MS && trace.length <= casefile.steps_count) {
      await cancelRun(threadId, runId, deps.foundry).catch(() => undefined);
      const message = `The Foundry run produced no step for over ${Math.round(STALL_AFTER_MS / 60_000)} minutes and was stopped as stalled.`;
      await markFailed(client, casefile, message, now);
      return result({ run_status: run.status, casefile_status: "failed", steps: trace.length, error: message });
    }

    if (now() >= deadline) {
      return result({ run_status: run.status, casefile_status: casefile.status, steps: trace.length });
    }
    await sleep(deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  }

  if (run.status !== "completed") {
    const message = describeFailure(run);
    await markFailed(client, casefile, message, now);
    return result({ run_status: run.status, casefile_status: "failed", steps: trace.length, error: message });
  }

  const output = await latestAssistantText(threadId, runId, deps.foundry);
  if (output === "") {
    const message = "The Foundry run completed without producing an answer.";
    await markFailed(client, casefile, message, now);
    return result({ run_status: run.status, casefile_status: "failed", steps: trace.length, error: message });
  }

  // The raw output is stored and NOT parsed. Status stays `investigating`:
  // reaching `pending_review` is the guardrail's act (8b), and a casefile that
  // reached a reviewable state before the guardrail existed would be unpoliced.
  await writeAgentOutput(client, casefileId, output, trace.length, now);
  // A run that concluded ON the cap still reached the cap, and the policy
  // engine has to know: `policy.js` downgrades a `resolve` at the cap.
  if (atCap) await noteStepCap(client, casefileId, trace.length, maxSteps);
  return result({
    run_status: run.status,
    casefile_status: "investigating",
    steps: trace.length,
    stopped: atCap ? "step_cap" : null,
    output,
  });
}

// ------------------------------------------------------------------ writes

/**
 * Overwrite `casefiles.trace` with the full mapping.
 *
 * Overwriting rather than appending is what makes a sync idempotent: the trace
 * is a pure function of the run's steps, so two syncs racing produce the same
 * array rather than a doubled one.
 *
 * `last_step_at` moves only when the trace actually grew — it is the clock the
 * stall check reads, and refreshing it on every poll would mean no run is ever
 * stalled.
 */
async function mirror(client: Db, casefileId: string, trace: TraceEntry[], seen: number, now: () => number): Promise<number> {
  // A completed step's summaries never change once mapped, so an unchanged
  // length means an unchanged trace and there is nothing to write. Without this
  // a poll loop rewrites the same array every second and-a-half.
  if (trace.length === seen) return seen;
  check(
    await client
      .from("casefiles")
      .update({ trace, steps_count: trace.length, last_step_at: new Date(now()).toISOString() })
      .eq("id", casefileId),
    "mirror trace",
  );
  return trace.length;
}

export const STEP_CAP_CHECK = "max_steps";

/**
 * Was this investigation already stopped by the cap?
 *
 * It has to be asked, because the cap CANCELS the Foundry run — so the next
 * sync sees `cancelled` and, with no way to tell our own cancel from a platform
 * failure, would rewrite a policy decision as an outage and lose the note that
 * recorded it.
 */
export function stoppedAtCap(guardrailNotes: unknown): boolean {
  return (
    Array.isArray(guardrailNotes) &&
    guardrailNotes.some((n) => isObj(n) && n.layer === "policy" && n.check === STEP_CAP_CHECK && n.action === "end_run")
  );
}

/**
 * Store the agent's raw, unparsed answer.
 *
 * It goes in `agent_output`, NOT in `summary`. `summary` is the memory surface:
 * `match_lessons` returns it as `case_summary` and `buildInvestigationPrompt`
 * prints that under "LESSONS FROM PAST ANALYST REVIEWS", so once a casefile had
 * been reviewed, a later investigation's prompt could receive a block of raw
 * agent JSON presented to it as a lesson the lender had learned (I-3).
 *
 * There is no fallback. There was one, while migration 0009 was unapplied, and
 * it wrote to `summary` — a dead path still aimed at the memory surface is how
 * that leak comes back.
 */
async function writeAgentOutput(
  client: Db,
  casefileId: string,
  output: string,
  steps: number,
  now: () => number,
): Promise<void> {
  check(
    await client
      .from("casefiles")
      .update({ agent_output: output, steps_count: steps, last_step_at: new Date(now()).toISOString() })
      .eq("id", casefileId),
    "write agent output",
  );
}

/**
 * The cap is a policy act, so it is recorded as one, in the same
 * `{layer, check, action, detail}` shape the policy engine uses. 8b appends its
 * own notes; this one is never the whole story, only the first entry.
 */
async function noteStepCap(client: Db, casefileId: string, steps: number, maxSteps: number): Promise<void> {
  const note = {
    layer: "policy",
    check: STEP_CAP_CHECK,
    action: "end_run",
    detail: `the investigation reached the step cap of ${maxSteps} after ${steps} steps and was stopped`,
  };
  check(await client.from("casefiles").update({ guardrail_notes: [note] }).eq("id", casefileId), "note step cap");
}

/**
 * A failure, recorded as a failure.
 *
 * The reason goes in `guardrail_notes`, not in `summary`: a failure message is
 * no more a case summary than raw agent JSON is, and `summary` is read by
 * memory (see `writeAgentOutput`). Nothing recommendation-shaped is written
 * either way. The exception goes back to `new` so it returns to the queue and
 * can be retried; a failed investigation must not leave an exception looking as
 * though one is under way.
 */
async function markFailed(client: Db, casefile: CasefileRow, message: string, now: () => number): Promise<void> {
  const note = { layer: "run", check: "foundry_run", action: "failed", detail: message };
  const existing = Array.isArray(casefile.guardrail_notes) ? casefile.guardrail_notes : [];
  check(
    await client
      .from("casefiles")
      .update({ status: "failed", guardrail_notes: [...existing, note], last_step_at: new Date(now()).toISOString() })
      .eq("id", casefile.id),
    "fail casefile",
  );
  check(
    await client.from("exceptions").update({ status: "new" }).eq("id", casefile.exception_id).eq("status", "investigating"),
    "reopen exception",
  );
}
