import type { SupabaseClient } from "@supabase/supabase-js";
import { validateCasefileOutput } from "../../guardrails/casefile-schema.js";
import { applyGuardrail } from "../../guardrails/guardrail.js";
import { applyPolicy } from "../../guardrails/policy.js";
import { applyTermsDrift, compareTermsToApproved } from "../../guardrails/terms-drift.js";
import { termsInForce } from "../terms.ts";
import { quarterLabel } from "../tests/extract-financials.ts";
import {
  calcIdNotes,
  calcLogForCasefile,
  chunksForCalcProvenance,
  chunksForClaims,
  chunksForTermsCitations,
  loadFacilityChunks,
  type CalcRow,
} from "./evidence.ts";
import {
  cancelRun,
  createRunOnThread,
  getRun,
  isTerminal,
  latestAssistantText,
  orchestratorAgentId,
  type FoundryDeps,
} from "./foundry.ts";
import { appendNotes, stoppedAtCap, type Note } from "./notes.ts";

/**
 * The casefile guardrail and the Risk Officer policy, wired: the ONE path by
 * which a casefile reaches `pending_review` (stage 8b, spec 6.1–6.3).
 *
 * A terminal run leaves the agent's raw answer in `agent_output`. This file
 * parses it, verifies every figure and quote in code, applies the lender's
 * policy and only then writes `pending_review`. Every forced change is recorded
 * in `guardrail_notes`. Nothing model-produced reaches an analyst unpoliced.
 *
 * The order is spec 6.1's and it is kept:
 *
 *   1. parse        strip a markdown fence if the model wrapped its JSON
 *   2. validate     `validateCasefileOutput`; on failure ONE retry on the same
 *                   thread, then `abstain` — an abstain is a result an analyst
 *                   sees, a failure is not
 *   3. evidence     `calcLogForCasefile` (E-1) and the claims' chunks (E-4),
 *                   gathered by code, scoped to the exception's own facility
 *   4. terms drift  `compareTermsToApproved` on the governing calculation (A-1)
 *   5. guardrail    `applyGuardrail`
 *   6. policy       `applyPolicy`, the policy read live, `steps_count` always
 *                   present (E-7)
 *   6b. on file     `requestedDocumentsOnFile`: a `missing_evidence` entry
 *                   naming a document the facility already has is FLAGGED
 *   7. write        the surviving claims, `calc_ids` from the queried rows
 *                   (E-3), notes APPENDED, `pending_review`
 *
 * PURE ORCHESTRATION. Every check lives in `guardrails/`, with ONE exception
 * stated here: 6b needs the facility's document inventory and the quarterly
 * test's period vocabulary, and the import-free guardrail files may neither
 * fetch nor import. It is still a pure function, handed its evidence like every
 * other check. Otherwise this file decides what each check is handed and in
 * what order, and nothing else. Three things
 * it will never do: take a `facility_id` from anything but
 * `exceptions.facility_id`; treat the model's `calculations` array as
 * authoritative; write `summary` (the memory surface, a human review's to
 * write), `tests` or `covenant_terms`.
 */

type Db = Pick<SupabaseClient, "from">;

/** How long the single retry may take before it is treated as not having answered. */
export const RETRY_TIMEOUT_MS = 60_000;
export const RETRY_POLL_INTERVAL_MS = 1_500;

export interface EnforceDeps {
  /** A service-role client. Defaults to `supabaseAdmin()`, loaded lazily so tests never import the server-only module. */
  client?: Db;
  foundry?: FoundryDeps;
  agentId?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  retryTimeoutMs?: number;
  pollIntervalMs?: number;
}

export interface EnforceResult {
  casefile_id: string;
  /** `pending_review` when this call wrote it; otherwise the status it found and left alone. */
  status: string;
  recommendation: string | null;
  /** The notes THIS call appended, in pipeline order. */
  notes: Note[];
  retried: boolean;
}

async function defaultClient(): Promise<Db> {
  const { supabaseAdmin } = await import("../supabase/server.ts");
  return supabaseAdmin();
}

const check = <T>(res: { data?: T | null; error: { message: string } | null }, what: string): T | null => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data ?? null;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The orchestrator's output contract (spec 6.1), after `validateCasefileOutput` has passed it. */
export interface CasefileOutput {
  recommendation: "resolve" | "request" | "escalate" | "abstain";
  confidence_basis: string;
  explanation: string;
  claims: { text: string; citation: string; quote: string }[];
  calculations: { calc_id: string }[];
  missing_evidence: string[];
  suggested_tag: string;
  [k: string]: unknown;
}

interface CasefileRow {
  id: string;
  exception_id: string;
  status: string;
  steps_count: number;
  guardrail_notes: unknown;
  agent_output: string | null;
  terms: unknown;
  foundry_thread_id: string | null;
}

const ROW_COLUMNS = "id, exception_id, status, steps_count, guardrail_notes, agent_output, terms, foundry_thread_id";

// ---------------------------------------------------------- 1–2. the answer

/**
 * The agent's answer as a value. A fenced block is unwrapped, because the model
 * is told not to fence and sometimes does; anything else that is not one JSON
 * value is malformed. No heroic parsing: a half-recovered answer is a guess.
 */
export function parseAgentOutput(text: unknown): { value: unknown } | { error: string } {
  if (typeof text !== "string" || text.trim() === "") return { error: "the agent produced no answer" };
  let s = text.trim();
  const fence = /^```[A-Za-z0-9_-]*[^\S\n]*\n?([\s\S]*?)\n?\s*```$/.exec(s);
  if (fence) s = fence[1].trim();
  try {
    return { value: JSON.parse(s) };
  } catch (err) {
    return { error: `the answer is not valid JSON (${err instanceof Error ? err.message : String(err)})` };
  }
}

/** Parse, then check the shape. `errors` is what the retry message tells the agent. */
export function readAnswer(text: unknown): { casefile: CasefileOutput } | { errors: string[] } {
  const parsed = parseAgentOutput(text);
  if ("error" in parsed) return { errors: [parsed.error] };
  const shape = validateCasefileOutput(parsed.value) as { valid: boolean; errors: string[] };
  return shape.valid ? { casefile: parsed.value as CasefileOutput } : { errors: shape.errors };
}

const SCHEMA_RETRY = { layer: "guardrail", check: "schema", action: "retry" } as const;

function alreadyRetried(notes: unknown): boolean {
  return Array.isArray(notes) && notes.some((n) => isObj(n) && n.layer === SCHEMA_RETRY.layer && n.check === SCHEMA_RETRY.check && n.action === SCHEMA_RETRY.action);
}

/** The one message the retry sends. It asks for the answer again, and for nothing else. */
export function retryMessage(errors: readonly string[]): string {
  const listed = errors.slice(0, 5).join("; ");
  return `Your final answer did not match the required output shape: ${listed}. Reply again with ONE JSON object in exactly the shape your instructions give under HOW YOU FINISH, restating the answer you reached, with no markdown fence and no other text. Do not call any tool.`;
}

/**
 * The single retry: one message to the SAME thread, one run that may not call a
 * tool, polled to an end. Returns the new answer, or why there is none. It never
 * loops: the caller records the retry before calling this, so even a crash
 * after it cannot buy a second one.
 */
async function retryOnce(row: CasefileRow, errors: readonly string[], deps: EnforceDeps): Promise<{ text: string } | { error: string }> {
  const threadId = row.foundry_thread_id;
  if (!threadId) return { error: "the casefile carries no Foundry thread to ask again on" };
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? wait;
  try {
    const agentId = deps.agentId ?? orchestratorAgentId();
    const started = await createRunOnThread(threadId, agentId, retryMessage(errors), deps.foundry);
    const deadline = now() + (deps.retryTimeoutMs ?? RETRY_TIMEOUT_MS);
    let run = started;
    while (!isTerminal(run.status)) {
      if (run.status === "requires_action") {
        await cancelRun(threadId, started.id, deps.foundry).catch(() => undefined);
        return { error: "the retry asked for a tool instead of answering" };
      }
      if (now() >= deadline) {
        await cancelRun(threadId, started.id, deps.foundry).catch(() => undefined);
        return { error: `the retry had not answered after ${Math.round((deps.retryTimeoutMs ?? RETRY_TIMEOUT_MS) / 1000)} seconds` };
      }
      await sleep(deps.pollIntervalMs ?? RETRY_POLL_INTERVAL_MS);
      run = await getRun(threadId, started.id, deps.foundry);
    }
    if (run.status !== "completed") return { error: `the retry run ${run.status}` };
    const text = await latestAssistantText(threadId, started.id, deps.foundry);
    return text === "" ? { error: "the retry produced no answer" } : { text };
  } catch (err) {
    return { error: `the retry could not be made: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * The answer code writes when the agent's own cannot be used. It carries no
 * figure (an explanation code writes must not trip the traceability rule it is
 * about to be checked by) and goes through the same guardrail and policy as any
 * other: there is one path to `pending_review`, not one per outcome.
 */
function codeAbstain(explanation: string): CasefileOutput {
  return {
    recommendation: "abstain",
    confidence_basis: "No verifiable answer was produced.",
    explanation,
    claims: [],
    calculations: [],
    missing_evidence: [],
    suggested_tag: "other",
  };
}

const MALFORMED_EXPLANATION =
  "The agent's answer did not match the required shape, even after one retry, so nothing in it can be verified. Review the trace to see what was investigated.";
const CAP_EXPLANATION =
  "The investigation reached its step cap before the agent produced an answer, so it is incomplete. Review the trace to see what was investigated.";
const CAP_MALFORMED_EXPLANATION =
  "The investigation reached its step cap, and the answer it had written by then did not match the required shape, so nothing in it can be verified. Review the trace to see what was investigated.";

// --------------------------------------------------------- 5–6. the checks

declare const POLICED: unique symbol;
/** Only `police` makes one, and only a `Policed` can be written. That is the single path, enforced by the type checker. */
type Policed = { readonly casefile: CasefileOutput; readonly notes: Note[]; readonly [POLICED]: true };

/**
 * The guardrail, then the policy, in that order. `steps_count` is ALWAYS the
 * casefile row's (E-7): `applyPolicy` records `not_checked` when it is absent,
 * and nothing downstream can tell "a safety check did not run" from "it ran and
 * found nothing". The model's own object never carries it, and if it tried to,
 * it is overwritten here.
 */
function police(
  casefile: CasefileOutput,
  calcs: readonly CalcRow[],
  citedChunks: { citation: string; content: string }[],
  policy: Record<string, unknown>,
  stepsCount: number,
): Policed {
  const g = applyGuardrail(casefile, [...calcs], citedChunks) as { casefile: CasefileOutput; notes: Note[] };
  const p = applyPolicy({ ...g.casefile, steps_count: stepsCount }, policy, [...calcs]) as { casefile: CasefileOutput; notes: Note[] };
  const { steps_count: _counted, ...out } = p.casefile;
  return { casefile: out as CasefileOutput, notes: [...g.notes, ...p.notes] } as Policed;
}

/** Every policy row, read live: the Risk Officer's levers are database rows, never constants here. */
async function readPolicy(client: Db): Promise<Record<string, unknown>> {
  const rows = (check(await client.from("policy").select("key, value"), "read policy") ?? []) as { key: string; value: unknown }[];
  const out: Record<string, unknown> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

/** The definition agent's citations, as captured on the casefile when its call was serviced. */
function capturedCitations(terms: unknown): unknown[] {
  return isObj(terms) && Array.isArray(terms.source_citations) ? terms.source_citations : [];
}

// ------------------------------------------------- 6b. a request for what is on file

/** A row of the facility's document inventory. */
export interface DocumentOnFile {
  doc_type: string;
  title: string;
  effective_date: string | null;
}

/**
 * Words that may stand before the document an entry asks for without making it
 * a different document. Anything else there — "restated", "revised", "signed",
 * "executed", "lender confirmation accepting" — and the entry asks for
 * something that is NOT the document on file, so it is not flagged.
 */
const LEAD = String.raw`^\s*(?:(?:the|a|an|any|one|copy|copies|of|borrower['’]s|lender['’]s|its|their)\s+)*(?:(?:Q[1-4]\s+\d{4}|\d{4}-\d{2}-\d{2})\s+)?`;

/**
 * The kinds of document an entry can ask for, each by the identity that names
 * exactly one document: a quarterly document by its type AND period, an
 * amendment by its number, the agreement, and the waiver REQUEST letter by
 * name. "A waiver" is not the request letter — a granted waiver is the thing
 * F3 does not have — so only "waiver request" matches it. A plural
 * ("compliance certificates for the prior four quarters") matches nothing.
 */
const KINDS: { head: RegExp; matches: (doc: DocumentOnFile, m: RegExpExecArray, periods: string[]) => boolean }[] = [
  {
    head: new RegExp(`${LEAD}(?:compliance\\s+certificate\\b|CC(?=\\s+Q[1-4]\\s+\\d{4}))`, "i"),
    matches: (d, _m, periods) => d.doc_type === "compliance_certificate" && d.effective_date !== null && periods.includes(quarterLabel(d.effective_date)),
  },
  {
    head: new RegExp(`${LEAD}(?:financial\\s+statements?\\b|financials\\b|Fin(?=\\s+Q[1-4]\\s+\\d{4}))`, "i"),
    matches: (d, _m, periods) => d.doc_type === "financials" && d.effective_date !== null && periods.includes(quarterLabel(d.effective_date)),
  },
  { head: new RegExp(`${LEAD}amendment\\s+no\\.?\\s*(\\d+)\\b`, "i"), matches: (d, m) => d.doc_type === "amendment" && d.title === `Amendment No. ${m[1]}` },
  { head: new RegExp(`${LEAD}credit\\s+agreement\\b`, "i"), matches: (d) => d.doc_type === "agreement" },
  { head: new RegExp(`${LEAD}waiver\\s+request\\b`, "i"), matches: (d) => d.doc_type === "waiver" && /request/i.test(d.title) },
];

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/**
 * The periods an entry names, as quarter labels ("Q2 2026"): a quarter label,
 * an ISO date, or a long-form date. None named — "the compliance certificate",
 * "… for the test period" — means the investigation's own period, which is what
 * the words mean inside it.
 */
function periodsNamed(entry: string, testPeriodEnd: string): string[] {
  const out = new Set<string>();
  for (const m of entry.matchAll(/\bQ([1-4])\s+(\d{4})\b/gi)) out.add(`Q${m[1]} ${m[2]}`);
  for (const m of entry.matchAll(/\b(\d{4})-(\d{2})-\d{2}\b/g)) out.add(quarterLabel(`${m[1]}-${m[2]}-01`));
  for (const m of entry.matchAll(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+(\d{4})\b/gi)) {
    out.add(quarterLabel(`${m[2]}-${String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, "0")}-01`));
  }
  return out.size > 0 ? [...out] : [quarterLabel(testPeriodEnd)];
}

/**
 * THE ON-FILE CHECK (8c fix round 2). `missing_evidence` is "what is not on file
 * that would change the answer". An entry that asks for a document the facility
 * already holds — the live verify-8c run asked for the Q2 2026 compliance
 * certificate, which F1 has — sends an analyst after something they have, and
 * shows the agent did not read its own inventory.
 *
 * FLAG, never downgrade: a `request` is already the conservative answer, and the
 * note tells the analyst exactly what the model missed. It runs on every
 * recommendation, because the field means the same thing on all of them.
 *
 * REFUSES (flags): an entry that LEADS with a document the inventory has —
 * "Compliance Certificate Q2 2026 or …", "The Q2 2026 financial statements",
 * "Amendment No. 2 to the Credit Agreement".
 * KEEPS ALLOWING (no note): anything genuinely absent — a signed or executed
 * waiver, an executed amendment, a restated certificate, another period's
 * document the facility does not have — and an entry that only MENTIONS a
 * document while asking for something else ("lender confirmation accepting the
 * Compliance Certificate"). Narrow on purpose: a flag that fires on context is
 * noise an analyst learns to ignore.
 */
export function requestedDocumentsOnFile(missingEvidence: unknown, documents: readonly DocumentOnFile[], testPeriodEnd: string): Note[] {
  const notes: Note[] = [];
  for (const entry of Array.isArray(missingEvidence) ? missingEvidence : []) {
    if (typeof entry !== "string" || entry.trim() === "") continue;
    const periods = periodsNamed(entry, testPeriodEnd);
    for (const kind of KINDS) {
      const m = kind.head.exec(entry);
      if (!m) continue;
      const held = documents.filter((d) => kind.matches(d, m, periods));
      if (held.length > 0) {
        const where = held.map((d) => `${d.title}, effective ${d.effective_date ?? "undated"}`).join("; ");
        notes.push({ layer: "guardrail", check: "requested_document_on_file", action: "flag", detail: `${entry} — on file as ${where}` });
      }
      break;
    }
  }
  return notes;
}

/** The facility's inventory: filtered by the query AND again in memory, as every evidence gather is. */
async function loadDocuments(client: Db, facilityId: string): Promise<DocumentOnFile[]> {
  const rows = (check(
    await client.from("documents").select("facility_id, doc_type, title, effective_date").eq("facility_id", facilityId),
    "read documents",
  ) ?? []) as (DocumentOnFile & { facility_id: string })[];
  return rows.filter((r) => r.facility_id === facilityId).map(({ doc_type, title, effective_date }) => ({ doc_type, title, effective_date }));
}

// ------------------------------------------------------------- 7. the write

/**
 * THE write to `pending_review`. There is no other in the codebase, and it
 * takes a `Policed`, which only `police` produces.
 *
 * Guarded on `status = investigating`, so a casefile someone else already
 * enforced, or an analyst already acted on, is never rewritten. Notes are
 * appended to what is there NOW, read fresh, so the cap note and the retry note
 * survive (E-6).
 */
async function writeEnforced(
  client: Db,
  row: CasefileRow,
  policed: Policed,
  calcs: readonly CalcRow[],
  notes: readonly Note[],
  agentOutput: string | null,
): Promise<boolean> {
  const fresh = check(await client.from("casefiles").select("guardrail_notes").eq("id", row.id).maybeSingle(), "read guardrail_notes") as
    | { guardrail_notes?: unknown }
    | null;
  const existing = Array.isArray(fresh?.guardrail_notes) ? fresh.guardrail_notes : [];
  const governing = calcs.length > 0 ? calcs[calcs.length - 1] : null;
  const c = policed.casefile;
  const updated = check(
    await client
      .from("casefiles")
      .update({
        recommendation: c.recommendation,
        confidence_basis: c.confidence_basis,
        explanation: c.explanation,
        claims: c.claims,
        missing_evidence: c.missing_evidence,
        suggested_tag: c.suggested_tag,
        // From the rows the figures were verified against, never the model's array (E-3).
        calc_ids: calcs.map((r) => r.calc_id),
        // The governing calculation's terms, with the definition agent's
        // captured citations kept beside them for the analyst.
        terms: { ...(isObj(row.terms) ? row.terms : {}), terms: governing?.inputs?.terms ?? null, calc_id: governing?.calc_id ?? null },
        guardrail_notes: [...existing, ...notes],
        ...(agentOutput !== null ? { agent_output: agentOutput } : {}),
        status: "pending_review",
      })
      .eq("id", row.id)
      .eq("status", "investigating")
      .select("id"),
    "write the enforced casefile",
  ) as { id: string }[] | null;
  if (!updated || updated.length === 0) return false;
  check(
    await client.from("exceptions").update({ status: "pending_review" }).eq("id", row.exception_id).in("status", ["new", "investigating"]),
    "move the exception to review",
  );
  return true;
}

// -------------------------------------------------------------- the pipeline

/**
 * Enforce one casefile. Idempotent: a casefile that is not `investigating` is
 * returned untouched, so a repeat call, or a call racing another, writes once.
 */
export async function enforceCasefile(casefileId: string, deps: EnforceDeps = {}): Promise<EnforceResult> {
  const client = deps.client ?? (await defaultClient());
  const row = check(await client.from("casefiles").select(ROW_COLUMNS).eq("id", casefileId).maybeSingle(), "read casefile") as CasefileRow | null;
  if (!row) throw new Error(`No casefile ${casefileId}`);
  const untouched = (status: string): EnforceResult => ({ casefile_id: casefileId, status, recommendation: null, notes: [], retried: false });
  if (row.status !== "investigating") return untouched(row.status);

  // The facility and the test come from the EXCEPTION row. Never from the
  // model's answer, a citation, or a claim.
  const exception = check(
    await client.from("exceptions").select("id, facility_id, test_id, test_period_end").eq("id", row.exception_id).maybeSingle(),
    "read exception",
  ) as { id: string; facility_id: string; test_id: string | null; test_period_end: string } | null;
  if (!exception) throw new Error(`Casefile ${casefileId} names no live exception`);

  const capped = stoppedAtCap(row.guardrail_notes);
  const notes: Note[] = [];
  const recorded: Note[] = [];
  let retried = false;
  let replaced: string | null = null;
  let casefile: CasefileOutput;

  // ---- 1–2. parse and validate, with one retry -----------------------------
  const first = readAnswer(row.agent_output);
  if ("casefile" in first) {
    casefile = first.casefile;
  } else if (capped) {
    // The cap bounds what an investigation may spend. A retry is another turn
    // past it, so a capped run gets none: what it managed to say is judged as
    // it stands, and nothing said is an incomplete investigation.
    const empty = typeof row.agent_output !== "string" || row.agent_output.trim() === "";
    notes.push(
      empty
        ? { layer: "policy", check: "step_cap", action: "abstain", detail: "the investigation reached the step cap before the agent produced an answer — investigation incomplete" }
        : { layer: "guardrail", check: "schema", action: "abstain", detail: `malformed output, not retried because the investigation had reached the step cap: ${first.errors.slice(0, 3).join("; ")}` },
    );
    casefile = codeAbstain(empty ? CAP_EXPLANATION : CAP_MALFORMED_EXPLANATION);
  } else if (alreadyRetried(row.guardrail_notes)) {
    // An earlier pass asked once already and did not finish. Asking again would
    // be the loop the spec forbids.
    notes.push({ layer: "guardrail", check: "schema", action: "abstain", detail: "malformed output after one retry" });
    casefile = codeAbstain(MALFORMED_EXPLANATION);
  } else {
    // Recorded BEFORE the call, so no crash after it can buy a second retry.
    const asked: Note = { ...SCHEMA_RETRY, detail: `the answer did not match the required shape (${first.errors.slice(0, 3).join("; ")}); asked once more on the same thread` };
    await appendNotes(client, casefileId, [asked]);
    recorded.push(asked);
    retried = true;
    const again = await retryOnce(row, first.errors, deps);
    const second = "text" in again ? readAnswer(again.text) : null;
    if (second && "casefile" in second && "text" in again) {
      casefile = second.casefile;
      // The answer that is enforced is the one stored; the retry note says the first was not.
      replaced = again.text;
    } else {
      if ("error" in again) notes.push({ layer: "guardrail", check: "schema", action: "retry_failed", detail: again.error });
      else if (second && "errors" in second) notes.push({ layer: "guardrail", check: "schema", action: "retry_failed", detail: `the second answer did not match either: ${second.errors.slice(0, 3).join("; ")}` });
      notes.push({ layer: "guardrail", check: "schema", action: "abstain", detail: "malformed output after one retry" });
      casefile = codeAbstain(MALFORMED_EXPLANATION);
    }
  }

  // ---- 3. evidence, gathered by code ---------------------------------------
  const calcs = await calcLogForCasefile(client, casefileId, exception.test_id);
  const governing = calcs.length > 0 ? calcs[calcs.length - 1] : null;
  const chunks = await loadFacilityChunks(client, exception.facility_id);
  // The claims' own chunks, PLUS the documents the calculations were verified
  // against. The second half is not decoration: the brief hands the agent the
  // borrower's reported ratio, so the certificate that sourced it must be in
  // evidence or a correct answer abstains on a figure we ourselves supplied.
  // Claims' chunks go LAST so they win the citation map — a claim is always
  // checked against its full section, never a one-line provenance quote.
  const citedChunks = [
    ...chunksForCalcProvenance(calcs, chunks, exception.facility_id),
    ...chunksForClaims(casefile.claims, chunks, exception.facility_id),
  ];
  notes.push(...(calcIdNotes(casefile.calculations, calcs) as Note[]));

  // ---- 4. terms drift on the governing calculation -------------------------
  if (governing) {
    const approved = await termsInForce(client, exception.facility_id, exception.test_period_end);
    const captured = capturedCitations(row.terms);
    const drift = compareTermsToApproved(
      governing.inputs?.terms,
      approved ? approved.terms : null,
      captured,
      chunksForTermsCitations(captured, chunks, exception.facility_id),
    );
    const applied = applyTermsDrift(casefile, drift) as { casefile: CasefileOutput; notes: Note[] };
    casefile = applied.casefile;
    notes.push(...applied.notes);
  }

  // ---- 5–6. guardrail, then policy -----------------------------------------
  const policed = police(casefile, calcs, citedChunks, await readPolicy(client), row.steps_count);
  notes.push(...policed.notes);

  // ---- 6b. a request for a document already on file: flagged, never downgraded
  const documents = await loadDocuments(client, exception.facility_id);
  notes.push(...requestedDocumentsOnFile(policed.casefile.missing_evidence, documents, exception.test_period_end));

  // ---- 7. write ------------------------------------------------------------
  const wrote = await writeEnforced(client, row, policed, calcs, notes, replaced);
  if (!wrote) {
    const now = check(await client.from("casefiles").select("status").eq("id", casefileId).maybeSingle(), "read casefile") as { status: string } | null;
    return { ...untouched(now?.status ?? row.status), notes: recorded, retried };
  }
  return { casefile_id: casefileId, status: "pending_review", recommendation: policed.casefile.recommendation, notes: [...recorded, ...notes], retried };
}
