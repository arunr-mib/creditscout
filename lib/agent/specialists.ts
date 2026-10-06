import { searchDocuments, type DocumentHit } from "../retrieval.ts";
import { proposeTerms } from "./tools/definition-agent.ts";
import { SPECIALIST_INSTRUCTIONS, type SpecialistName } from "./prompt.ts";

/**
 * The three specialists, as tools the ORCHESTRATOR calls and WE service.
 *
 * They were connected agents until the owner took the documented fallback
 * (spec §12). The reason is not that Connected Agents failed — it behaved
 * exactly as the spike showed — but that a connected agent's inner run executes
 * inside Foundry, so it cannot carry a function tool, so it cannot retrieve.
 * A specialist that cannot retrieve can only be handed text the orchestrator
 * already holds, which made every delegation a step spent buying an opinion on
 * something already read. Across eleven live runs that cost two to four of
 * eight steps per investigation, because the orchestrator kept forgetting to
 * paste the text at all.
 *
 * Serviced here, each specialist does its OWN retrieval. The orchestrator asks
 * a question; it never pastes anything. That removes the failure mode rather
 * than instructing around it.
 *
 * `facility_id` is never a parameter. It comes from the casefile, so a model
 * cannot point a specialist at another borrower's documents.
 */

const API_VERSION = "2025-04-01-preview";
const MAX_COMPLETION_TOKENS = 8000;
const TIMEOUT_MS = 180_000;
/** Enough clauses to answer a covenant question; beyond this the model is skimming a table. */
export const SPECIALIST_K = 8;
export const MAX_QUESTION_LENGTH = 2000;

export interface SpecialistContext {
  facilityId: string;
  /** The period under investigation, so a specialist can be told which quarter it is reading for. */
  periodEnd: string;
}

export interface SpecialistDeps {
  search?: typeof searchDocuments;
  /** Returns the model's reply text. Defaults to Azure OpenAI chat completions. */
  chat?: (system: string, user: string) => Promise<string>;
  propose?: typeof proposeTerms;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A tool output is always a string, and an error in it is evidence rather than an outage. */
const fail = (error: string): string => JSON.stringify({ error });

function question(args: unknown, field: string): string | null {
  if (!isObj(args)) return null;
  const v = args[field];
  if (typeof v !== "string" || v.trim() === "") return null;
  return v.trim().slice(0, MAX_QUESTION_LENGTH);
}

function docTypes(args: unknown): string[] | undefined {
  if (!isObj(args) || !Array.isArray(args.doc_types) || args.doc_types.length === 0) return undefined;
  return args.doc_types.filter((t): t is string => typeof t === "string");
}

/** The labelled excerpt block every specialist reads. One chunk, one label. */
function excerptsFrom(hits: DocumentHit[]): string {
  return hits.map((h) => `[${h.citation}] ${h.doc_title ?? ""}\n${h.content}`).join("\n\n---\n\n");
}

async function azureChat(system: string, user: string): Promise<string> {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const key = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.FOUNDRY_SPECIALIST_MODEL;
  if (!endpoint || !key || !deployment) {
    throw new Error("AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY and FOUNDRY_SPECIALIST_MODEL must be set");
  }
  const url = `${endpoint.replace(/\/+$/, "")}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${API_VERSION}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "api-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: MAX_COMPLETION_TOKENS,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    // Status and Azure's message only; never the key or the request body.
    throw new Error(`specialist request failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}`);
  }
  const body = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
  const text = body.choices?.[0]?.message?.content;
  if (typeof text !== "string" || text.trim() === "") throw new Error("the specialist returned an empty reply");
  return text.trim();
}

/** Retrieve, then read. No retrieval, no model call — and no tokens spent finding that out. */
async function readAndAnswer(
  name: SpecialistName,
  query: string,
  args: unknown,
  ctx: SpecialistContext,
  deps: SpecialistDeps,
  framing: (q: string) => string,
): Promise<string> {
  const hits = await (deps.search ?? searchDocuments)({
    facilityId: ctx.facilityId,
    query,
    docTypes: docTypes(args),
    k: SPECIALIST_K,
  });
  if (hits.length === 0) return fail("no document text matched that question; nothing was read and nothing is claimed");
  return (deps.chat ?? azureChat)(
    SPECIALIST_INSTRUCTIONS[name].instructions,
    `EXCERPTS\n\n${excerptsFrom(hits)}\n\n${framing(query)}`,
  );
}

export async function runDocumentAgent(args: unknown, ctx: SpecialistContext, deps: SpecialistDeps = {}): Promise<string> {
  const q = question(args, "question");
  if (q === null) return fail('send {"question": "<what you want quoted>"}');
  return readAndAnswer("document_agent", q, args, ctx, deps, (text) => `QUESTION\n${text}`);
}

export async function runResearchAgent(args: unknown, ctx: SpecialistContext, deps: SpecialistDeps = {}): Promise<string> {
  const q = question(args, "gap");
  if (q === null) return fail('send {"gap": "<the figures and what you have found so far>"}');
  return readAndAnswer(
    "research_agent",
    q,
    args,
    ctx,
    deps,
    (text) => `THE GAP (test period ended ${ctx.periodEnd})\n${text}`,
  );
}

/**
 * Maps the covenant from the agreement and EVERY amendment on file.
 *
 * It reuses `proposeTerms`, which is the same code path the analyst-facing
 * covenant setup screen uses: it runs its own five targeted queries, refuses to
 * propose a threshold it cannot verify in a retrieved chunk, and validates the
 * shape before returning. Taking no arguments is deliberate — there is nothing
 * for the orchestrator to get wrong, and nothing it can steer.
 */
export async function runDefinitionAgent(_args: unknown, ctx: SpecialistContext, deps: SpecialistDeps = {}): Promise<string> {
  const result = await (deps.propose ?? proposeTerms)(ctx.facilityId);
  if (!result.found) return fail(result.reason);
  // `excerpts` is the whole retrieved corpus and would swamp the orchestrator's
  // context; the citations carry the provenance it actually needs.
  return JSON.stringify({ terms: result.terms, source_citations: result.source_citations });
}

export type SpecialistRunner = (args: unknown, ctx: SpecialistContext, deps?: SpecialistDeps) => Promise<string>;

export const SPECIALIST_RUNNERS: Record<SpecialistName, SpecialistRunner> = {
  document_agent: runDocumentAgent,
  definition_agent: runDefinitionAgent,
  research_agent: runResearchAgent,
};
