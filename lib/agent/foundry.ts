import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { DOC_TYPES } from "../retrieval.ts";
import { buildOpenApi } from "./openapi.ts";
import { ORCHESTRATOR_INSTRUCTIONS, ORCHESTRATOR_NAME, SPECIALIST_INSTRUCTIONS } from "./prompt.ts";

/**
 * The Azure AI Foundry Agent Service client, and the four agent definitions.
 *
 * Two things here are rulings rather than preferences.
 *
 * FUNCTION TOOLS, NOT OPENAPI TOOLS. Foundry is cloud; PUBLIC_BASE_URL is
 * localhost until stage 10 deploys, and a cloud service cannot reach a laptop.
 * A function tool parks the run at `requires_action` and we submit the output,
 * so the loop works today. The declarations below are DERIVED from
 * `openapi.ts`, which is the same document Foundry will register directly at
 * stage 10 — so the switch changes which of these two readers of one spec is
 * used, and cannot change the tool contract itself.
 *
 * THE ORCHESTRATOR IS gpt-4.1-mini AND THAT IS NOT A CHOICE. gpt-5-mini is
 * rejected at agent-creation time for `connected_agent` tools. Confirmed live.
 */

const exec = promisify(execFile);

export const DEFAULT_API_VERSION = "2025-05-01";
export const TOKEN_RESOURCE = "https://ai.azure.com";
/** Ids written by scripts/foundry-agents.mjs. Committed: spec 8.3. */
export const AGENTS_FILE = "lib/agent/agents.json";
export const CREATE_AGENTS_HINT = `Run "node --env-file=.env scripts/foundry-agents.mjs" to create the agents and write ${AGENTS_FILE}.`;

/** Terminal in Foundry's vocabulary. `incomplete` is terminal too: it means the model stopped short. */
export const TERMINAL_RUN_STATUSES = ["completed", "failed", "cancelled", "expired", "incomplete"] as const;
export type RunStatus = string;
export const isTerminal = (status: RunStatus): boolean => (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);

export interface FoundryConfig {
  endpoint: string;
  apiVersion: string;
  orchestratorModel: string;
  specialistModel: string;
}

export function foundryConfig(env: Record<string, string | undefined> = process.env): FoundryConfig {
  const endpoint = env.AZURE_AI_PROJECT_ENDPOINT;
  const orchestratorModel = env.FOUNDRY_ORCHESTRATOR_MODEL;
  const specialistModel = env.FOUNDRY_SPECIALIST_MODEL;
  if (!endpoint || !orchestratorModel || !specialistModel) {
    throw new Error(
      "AZURE_AI_PROJECT_ENDPOINT, FOUNDRY_ORCHESTRATOR_MODEL and FOUNDRY_SPECIALIST_MODEL must be set",
    );
  }
  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    apiVersion: env.FOUNDRY_API_VERSION || DEFAULT_API_VERSION,
    orchestratorModel,
    specialistModel,
  };
}

// --------------------------------------------------------------------- auth

interface CachedToken {
  token: string;
  /** Epoch ms. */
  expiresAt: number;
}
let cached: CachedToken | null = null;
/** Refresh this far ahead of expiry, so a long sync cannot have a token die mid-run. */
const TOKEN_SKEW_MS = 5 * 60_000;

/** Foundry rejected the credential. Re-running `az login` is the fix, not a retry. */
export class FoundryAuthError extends Error {}

/**
 * A bearer token for Foundry, from a service principal when one is configured
 * (deployment), otherwise the Azure CLI (local dev). Cached until shortly before
 * it expires.
 *
 * On Vercel there is no `az` CLI, so the CLI path fails and investigations can't
 * start. When `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and `AZURE_TENANT_ID` are
 * set, we take a client-credentials token instead — the deploy seam this
 * function was always meant to grow. Locally those are unset and the CLI
 * credential the owner already has keeps working, with no secrets in `.env`.
 */
async function servicePrincipalToken(now: () => number): Promise<CachedToken | null> {
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  const tenantId = process.env.AZURE_TENANT_ID;
  if (!clientId || !clientSecret || !tenantId) return null; // no SP configured → use the CLI

  const url = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: `${TOKEN_RESOURCE}/.default`,
  });
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  } catch (err) {
    throw new FoundryAuthError(`the service-principal token request could not be sent: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    // AAD's error body names the cause (bad secret, wrong tenant, missing role); never log the secret itself.
    throw new FoundryAuthError(`the service-principal token request failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}`);
  }
  const parsed = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!parsed.access_token) throw new FoundryAuthError("the service-principal token response carried no access_token");
  return { token: parsed.access_token, expiresAt: now() + (Number(parsed.expires_in) || 3600) * 1000 };
}

export async function accessToken(now: () => number = Date.now): Promise<string> {
  if (cached && cached.expiresAt - TOKEN_SKEW_MS > now()) return cached.token;

  const sp = await servicePrincipalToken(now);
  if (sp) {
    cached = sp;
    return sp.token;
  }

  let stdout: string;
  try {
    ({ stdout } = await exec("az", ["account", "get-access-token", "--resource", TOKEN_RESOURCE, "-o", "json"], {
      maxBuffer: 4 * 1024 * 1024,
    }));
  } catch (err) {
    throw new FoundryAuthError(
      `Could not get an Azure access token for ${TOKEN_RESOURCE}. Run "az login". (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  const parsed = JSON.parse(stdout) as { accessToken?: string; expires_on?: number; expiresOn?: string };
  if (!parsed.accessToken) throw new FoundryAuthError("az returned no accessToken");
  const expiresAt =
    typeof parsed.expires_on === "number"
      ? parsed.expires_on * 1000
      : parsed.expiresOn
        ? new Date(parsed.expiresOn).getTime()
        : now() + 30 * 60_000;
  cached = { token: parsed.accessToken, expiresAt };
  return parsed.accessToken;
}

/** Only for tests and for a process that has just re-logged in. */
export function clearTokenCache(): void {
  cached = null;
}

// ---------------------------------------------------------------- the wire

export interface FoundryDeps {
  config?: FoundryConfig;
  token?: () => Promise<string>;
  fetchImpl?: typeof fetch;
}

/** Foundry answered, and said no. `status` and `body` are both worth logging. */
export class FoundryError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, what: string) {
    super(`${what} failed (${status}): ${body.slice(0, 600)}`);
    this.status = status;
    this.body = body;
  }
}

async function api<T>(method: string, path: string, body: unknown, deps: FoundryDeps = {}): Promise<T> {
  const config = deps.config ?? foundryConfig();
  const token = await (deps.token ?? accessToken)();
  const url = `${config.endpoint}${path}${path.includes("?") ? "&" : "?"}api-version=${config.apiVersion}`;
  const res = await (deps.fetchImpl ?? fetch)(url, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) throw new FoundryError(res.status, raw, `${method} ${path}`);
  return (raw === "" ? {} : JSON.parse(raw)) as T;
}

// ------------------------------------------------------- tool declarations

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * OpenAPI 3.0 keywords that are not JSON Schema and that Foundry's function
 * parameter validator has no use for. `nullable` is the interesting one: in
 * JSON Schema it means nothing at all, so leaving it in would read as a
 * guarantee it is not making.
 */
const OPENAPI_ONLY = new Set(["nullable", "format", "example", "examples", "xml", "discriminator", "deprecated"]);

/** Recursively strip the OpenAPI-only keywords, so one document can describe both tool styles. */
export function toJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toJsonSchema);
  if (!isObj(schema)) return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (OPENAPI_ONLY.has(key)) continue;
    out[key] = toJsonSchema(value);
  }
  return out;
}

export interface FunctionTool {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

/**
 * The three function tools, read off the OpenAPI document rather than written
 * out again here. Two hand-maintained copies of a tool contract drift, and the
 * drift shows up as the model sending a field the route rejects — at run time,
 * inside a paid orchestration, which is the worst place to find it.
 */
export function functionTools(env: Record<string, string | undefined> = process.env): FunctionTool[] {
  const doc = buildOpenApi(env);
  const tools: FunctionTool[] = [];
  for (const operation of Object.values(doc.paths)) {
    const post = operation.post;
    const schema = post.requestBody.content["application/json"].schema;
    tools.push({
      type: "function",
      function: {
        name: post.operationId,
        description: `${post.summary}. ${post.description}`,
        parameters: toJsonSchema(schema),
      },
    });
  }
  return tools;
}

export interface AgentDefinition {
  name: string;
  model: string;
  instructions: string;
  description?: string;
  tools?: unknown[];
}

/** What the orchestrator may narrow a specialist's reading to. Mirrors `DOC_TYPES`. */
const docTypesParam = {
  type: "array",
  description: "Optional. Restrict which documents are read. Omit to read across all of them.",
  items: { type: "string", enum: [...DOC_TYPES] },
};

/**
 * The three specialists, declared as plain function tools.
 *
 * They were `connected_agent` tools until the owner took the documented
 * fallback (spec §12). The ruling is not that Connected Agents failed — it
 * behaved exactly as the spike showed — but that a connected agent's inner run
 * executes inside Foundry and therefore cannot carry a function tool. A
 * specialist that cannot retrieve can only be handed text the orchestrator
 * already holds, so every delegation was a step spent buying an opinion on
 * something already read, and across eleven live runs the orchestrator spent
 * two to four of its eight steps failing to paste that text at all.
 *
 * Serviced by us (`lib/agent/specialists.ts`), each specialist retrieves for
 * itself. Note what is NOT a parameter: `facility_id`. It comes from the
 * casefile, so a model cannot point a specialist at another borrower.
 */
export function specialistTools(): FunctionTool[] {
  return [
    {
      type: "function",
      function: {
        name: "definition_agent",
        description: SPECIALIST_INSTRUCTIONS.definition_agent.description,
        // No parameters at all: there is nothing here for the orchestrator to
        // get wrong, and nothing it can steer the mapping with.
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "research_agent",
        description: SPECIALIST_INSTRUCTIONS.research_agent.description,
        parameters: {
          type: "object",
          required: ["gap"],
          properties: {
            gap: {
              type: "string",
              description: "Our figure, the borrower's, the required minimum, and what you have found so far.",
              maxLength: 2000,
            },
            doc_types: docTypesParam,
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "document_agent",
        description: SPECIALIST_INSTRUCTIONS.document_agent.description,
        parameters: {
          type: "object",
          required: ["question"],
          properties: {
            question: { type: "string", description: "What you want quoted from the documents.", maxLength: 2000 },
            doc_types: docTypesParam,
          },
        },
      },
    },
  ];
}

/**
 * The orchestrator, and now the ONLY agent object in the project.
 *
 * Six function tools: three that reach our own HTTP routes (derived from the
 * OpenAPI document) and three specialists we service in-process. No
 * `connected_agent` entry, and no specialist agents to create — see
 * `specialistTools` for why.
 */
export function orchestratorDefinition(env: Record<string, string | undefined> = process.env): AgentDefinition {
  const config = foundryConfig(env);
  return {
    name: ORCHESTRATOR_NAME,
    model: config.orchestratorModel,
    description: "Investigates a DSCR covenant exception and recommends; a human analyst decides.",
    instructions: ORCHESTRATOR_INSTRUCTIONS,
    tools: [...specialistTools(), ...functionTools(env)],
  };
}

// ------------------------------------------------------------------ agents

interface Agent {
  id: string;
  name: string | null;
}

export async function listAgents(deps: FoundryDeps = {}): Promise<Agent[]> {
  const page = await api<{ data?: Agent[] }>("GET", "/assistants?limit=100", undefined, deps);
  return page.data ?? [];
}

/** Create, or update in place if an agent of that name already exists, so ids survive a redefinition. */
export async function upsertAgent(def: AgentDefinition, existing: Agent[], deps: FoundryDeps = {}): Promise<string> {
  const match = existing.find((a) => a.name === def.name);
  const body = { model: def.model, name: def.name, description: def.description, instructions: def.instructions, tools: def.tools ?? [] };
  if (match) {
    await api("POST", `/assistants/${encodeURIComponent(match.id)}`, body, deps);
    return match.id;
  }
  const created = await api<{ id: string }>("POST", "/assistants", body, deps);
  return created.id;
}

/**
 * Create or update the orchestrator and return its id by name.
 *
 * Keeping an existing id on an update matters: the committed ids file, the
 * Foundry portal's trace history and any thread already in flight all name the
 * agent by id, and recreating it would orphan all three.
 */
export async function createAgents(
  deps: FoundryDeps = {},
  env: Record<string, string | undefined> = process.env,
): Promise<Record<string, string>> {
  const existing = await listAgents(deps);
  const orchestrator = orchestratorDefinition(env);
  return { [orchestrator.name]: await upsertAgent(orchestrator, existing, deps) };
}

export interface AgentsFile {
  api_version: string;
  orchestrator_model: string;
  specialist_model: string;
  updated_at: string;
  agents: Record<string, string>;
}

/** Reads the committed ids file. Relative to cwd, which is the repo root for `npm run dev` and for the scripts. */
export function readAgentsFile(cwd: string = process.cwd()): AgentsFile {
  let raw: string;
  try {
    raw = readFileSync(join(cwd, AGENTS_FILE), "utf8");
  } catch {
    throw new Error(`${AGENTS_FILE} is missing. ${CREATE_AGENTS_HINT}`);
  }
  const parsed = JSON.parse(raw) as AgentsFile;
  if (!isObj(parsed.agents)) throw new Error(`${AGENTS_FILE} has no "agents" object. ${CREATE_AGENTS_HINT}`);
  return parsed;
}

export function orchestratorAgentId(cwd: string = process.cwd()): string {
  const id = readAgentsFile(cwd).agents[ORCHESTRATOR_NAME];
  if (typeof id !== "string" || id === "") {
    throw new Error(`${AGENTS_FILE} carries no id for ${ORCHESTRATOR_NAME}. ${CREATE_AGENTS_HINT}`);
  }
  return id;
}

// -------------------------------------------------------------------- runs

export interface Run {
  id: string;
  thread_id: string;
  status: RunStatus;
  last_error?: { code?: string; message?: string } | null;
  incomplete_details?: unknown;
  required_action?: {
    type?: string;
    submit_tool_outputs?: { tool_calls?: { id: string; type?: string; function?: { name?: string; arguments?: string } }[] };
  } | null;
}

/** One thread, one run, one call. The thread is created with the brief already in it. */
export async function startRun(agentId: string, userMessage: string, deps: FoundryDeps = {}): Promise<Run> {
  return api<Run>(
    "POST",
    "/threads/runs",
    { assistant_id: agentId, thread: { messages: [{ role: "user", content: userMessage }] } },
    deps,
  );
}

/**
 * A further run on a thread that already exists, opened by one user message.
 *
 * Used for exactly one thing: the casefile guardrail's single retry when the
 * agent's final answer does not match the output schema (spec 6.1). The
 * message goes in as `additional_messages`, so the request and the run are one
 * call and there is no window in which the thread holds a question nobody is
 * answering.
 *
 * `tool_choice: "none"` is what keeps the retry to ONE turn. The agent is being
 * asked to restate what it already concluded, not to investigate again; a tool
 * call here would be a step past the cap nobody counted.
 */
export async function createRunOnThread(
  threadId: string,
  agentId: string,
  userMessage: string,
  deps: FoundryDeps = {},
): Promise<Run> {
  return api<Run>(
    "POST",
    `/threads/${encodeURIComponent(threadId)}/runs`,
    { assistant_id: agentId, additional_messages: [{ role: "user", content: userMessage }], tool_choice: "none" },
    deps,
  );
}

export async function getRun(threadId: string, runId: string, deps: FoundryDeps = {}): Promise<Run> {
  return api<Run>("GET", `/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}`, undefined, deps);
}

/**
 * The run's steps, oldest first.
 *
 * `order=asc` is requested AND `mapRunStepsToTrace` sorts again. Foundry
 * defaults to newest-first, and a trace in reverse shows the calculator being
 * consulted before the document it was consulted about — cheap to ask for
 * twice, and the mapper's own ordering is what the unit tests pin.
 */
export const STEP_PAGE_SIZE = 100;

export async function getRunSteps(threadId: string, runId: string, deps: FoundryDeps = {}): Promise<unknown[]> {
  const base = `/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/steps?order=asc&limit=${STEP_PAGE_SIZE}`;
  const out: unknown[] = [];
  let after: string | undefined;
  // Paginated rather than capped at one page: a policy max_steps above the page
  // size would otherwise look like a cap that is never reached, which is a
  // safety limit failing silently.
  for (;;) {
    const page = await api<{ data?: unknown[]; has_more?: boolean; last_id?: string | null }>(
      "GET",
      after ? `${base}&after=${encodeURIComponent(after)}` : base,
      undefined,
      deps,
    );
    const rows = page.data ?? [];
    out.push(...rows);
    if (!page.has_more || !page.last_id || rows.length === 0) return out;
    after = page.last_id;
  }
}

export interface ToolOutput {
  tool_call_id: string;
  output: string;
}

export async function submitToolOutputs(
  threadId: string,
  runId: string,
  outputs: ToolOutput[],
  deps: FoundryDeps = {},
): Promise<Run> {
  return api<Run>(
    "POST",
    `/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/submit_tool_outputs`,
    { tool_outputs: outputs },
    deps,
  );
}

export async function cancelRun(threadId: string, runId: string, deps: FoundryDeps = {}): Promise<Run> {
  return api<Run>(
    "POST",
    `/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/cancel`,
    {},
    deps,
  );
}

interface Message {
  role: string;
  run_id?: string | null;
  content?: { type?: string; text?: { value?: string } }[];
}

/** The agent's final answer, as text. Empty string when it produced none — which is itself a failure, not an answer. */
export async function latestAssistantText(threadId: string, runId: string, deps: FoundryDeps = {}): Promise<string> {
  const page = await api<{ data?: Message[] }>(
    "GET",
    `/threads/${encodeURIComponent(threadId)}/messages?order=desc&limit=20`,
    undefined,
    deps,
  );
  for (const message of page.data ?? []) {
    if (message.role !== "assistant" || message.run_id !== runId) continue;
    const text = (message.content ?? [])
      .map((part) => part.text?.value ?? "")
      .join("\n")
      .trim();
    if (text !== "") return text;
  }
  return "";
}
