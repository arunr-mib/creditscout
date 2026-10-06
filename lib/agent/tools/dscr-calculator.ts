import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeDscr } from "../../../calc/dscr.js";
import { extractFigures } from "../../../guardrails/guardrail.js";
import { resolveCitation } from "../../chunk.ts";
import { loadFacilityChunks, type FacilityChunk } from "../evidence.ts";

/**
 * The wrapper around the pure calculator, and the ONLY place a `calc_id` is
 * minted. The model asks for a calculation; it cannot perform one, and it
 * cannot invent the id either. The guardrail later checks every figure in an
 * explanation against the `calc_log` row this function writes, so a number
 * without a row here is a number nothing can vouch for.
 *
 * Nothing in this file computes, rounds or adjusts a figure. It validates the
 * SHAPE of the request, verifies where every financial input came from, calls
 * `computeDscr`, and logs what came back.
 *
 * INPUT PROVENANCE (spec §4.2). Each financial figure the agent passes "must be
 * quoted verbatim from a cited chunk ... a figure the agent cannot cite is
 * missing evidence". So every figure arrives with a citation naming the
 * FINANCIALS chunk it was read from, and before anything is calculated the
 * figure is checked against that chunk's text, for the facility the casefile
 * names. Without this the model can hand the calculator a number it produced
 * itself — every live F1 run passed 500,000, the cap applied by the model, where
 * the financials state 620,000 — and the calculation gets a calc_id the
 * guardrail trusts. The cap is the calculator's job; the model's only correct
 * move is to pass what the document says.
 */

export interface ToolResult {
  status: number;
  body: Record<string, unknown>;
}

export interface CalculatorDeps {
  /** A service-role client. Defaults to `supabaseAdmin()`, loaded lazily so tests never import the server-only module. */
  client?: Pick<SupabaseClient, "from">;
  /** Where the calc_id comes from. Defaults to `crypto.randomUUID()`; tests inject a fixed one. */
  newId?: () => string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FINANCIAL_FIELDS = ["ebitda", "unfinanced_capex", "cash_taxes", "scheduled_principal", "cash_interest"];
/** The only kind of document a financial input may be read from. */
export const FINANCIALS_DOC_TYPE = "financials";

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const bad = (error: string): ToolResult => ({ status: 400, body: { error } });
const own = (o: Record<string, unknown>, key: string): unknown => (Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined);

/**
 * Shape checks, returning the first field that is malformed or null.
 *
 * What is checked here is what the calculator would otherwise ACCEPT SILENTLY:
 * it reads `addbacks`, `deductions` and `components` with
 * `Array.isArray(x) ? x : []`, so `addbacks: {...}` (an object where a list
 * belongs), or a list left out altogether, would be treated as "no add-backs"
 * and return a confident, wrong ratio. A figure that is present but not a
 * number is likewise rejected rather than coerced. A missing FINANCIAL figure
 * is not checked: the calculator reports it as `{error}`, which the agent
 * reasons about as evidence.
 */
function malformedField(terms: unknown, financials: unknown): string | null {
  if (!isObject(terms)) return "terms must be an object";
  if (!isObject(financials)) return "financials must be an object";

  if (terms.threshold !== undefined && !isObject(terms.threshold)) return "terms.threshold must be an object";
  const minDscr = isObject(terms.threshold) ? terms.threshold.min_dscr : undefined;
  if (minDscr !== undefined && minDscr !== null && !isNumber(minDscr)) {
    return "terms.threshold.min_dscr must be a number";
  }

  // numerator, addbacks and deductions are REQUIRED, not merely type-checked:
  // the calculator reads an absent list as an empty one, so omitting
  // `deductions` yields a confident ratio with capex and cash taxes never
  // deducted, and that wrong number gets a calc_id the guardrail would trust.
  // "No add-backs" is stated as `addbacks: []`, never by leaving the field out.
  if (!isObject(terms.numerator)) return "terms.numerator is required and must be an object";
  if (!Array.isArray(terms.numerator.addbacks)) return "terms.numerator.addbacks is required and must be an array";
  if (!Array.isArray(terms.numerator.deductions)) return "terms.numerator.deductions is required and must be an array";

  if (terms.denominator !== undefined && !isObject(terms.denominator)) return "terms.denominator must be an object";
  if (isObject(terms.denominator) && terms.denominator.components !== undefined) {
    if (!Array.isArray(terms.denominator.components)) return "terms.denominator.components must be an array";
  }

  for (const field of FINANCIAL_FIELDS) {
    const v = financials[field];
    if (v !== undefined && v !== null && !isNumber(v)) return `financials.${field} must be a number`;
  }
  const amounts = financials.addback_amounts;
  if (amounts !== undefined && amounts !== null) {
    if (!isObject(amounts)) return "financials.addback_amounts must be an object";
    for (const [name, v] of Object.entries(amounts)) {
      if (v !== null && !isNumber(v)) return `financials.addback_amounts["${name}"] must be a number`;
    }
  }
  return null;
}

/**
 * Shape checks on `financial_citations`, which mirrors `financials`: one
 * citation string per figure, and `addback_amounts` keyed by add-back name.
 *
 * Required as a whole, because without it no figure can be verified. A
 * citation that is absent, null or blank is NOT malformed: it is a figure with
 * no source, and that is reported per figure (HTTP 200) as missing evidence. A
 * citation that is present but is not a string is malformed, and refused here.
 */
function malformedCitations(citations: unknown): string | null {
  if (!isObject(citations)) return "financial_citations is required and must be an object";
  for (const field of FINANCIAL_FIELDS) {
    const c = own(citations, field);
    if (c !== undefined && c !== null && typeof c !== "string") return `financial_citations.${field} must be a string`;
  }
  const cited = own(citations, "addback_amounts");
  if (cited !== undefined && cited !== null) {
    if (!isObject(cited)) return "financial_citations.addback_amounts must be an object";
    for (const [name, c] of Object.entries(cited)) {
      if (c !== null && typeof c !== "string") return `financial_citations.addback_amounts["${name}"] must be a string`;
    }
  }
  return null;
}

/** One financial figure the agent sent, and the citation it named for it. */
interface FinancialInput {
  /** As error messages name it: `financials.ebitda`, `financials.addback_amounts["restructuring charges"]`. */
  field: string;
  /** The key it sits under: a financials field, or the add-back's name. */
  key: string;
  addback: boolean;
  value: number;
  /** Trimmed; "" when none was given. */
  citation: string;
}

/**
 * Every figure present in `financials`, in a fixed order: the five fields, then
 * each add-back. An absent or null figure is not here — it needs no citation,
 * and the calculator reports it as missing if the terms need it.
 *
 * EVERY add-back sent is here, including one the terms do not name and the
 * calculator will therefore ignore: it is still a figure the agent put in front
 * of the calculator, and it goes into the log.
 */
function financialInputs(financials: Record<string, unknown>, citations: Record<string, unknown>): FinancialInput[] {
  const cite = (c: unknown): string => (typeof c === "string" ? c.trim() : "");
  const out: FinancialInput[] = [];
  for (const field of FINANCIAL_FIELDS) {
    const v = own(financials, field);
    if (isNumber(v)) out.push({ field: `financials.${field}`, key: field, addback: false, value: v, citation: cite(own(citations, field)) });
  }
  const amounts = own(financials, "addback_amounts");
  const cited = own(citations, "addback_amounts");
  if (isObject(amounts)) {
    for (const [name, v] of Object.entries(amounts)) {
      if (!isNumber(v)) continue;
      const c = isObject(cited) ? own(cited, name) : undefined;
      out.push({ field: `financials.addback_amounts["${name}"]`, key: name, addback: true, value: v, citation: cite(c) });
    }
  }
  return out;
}

/**
 * The same figure, to the cent. The calculator works in integer cents, so two
 * figures that round to the same cent produce the same calculation and two that
 * do not, do not. This is stricter than the guardrail's relative tolerance on
 * purpose: on 4,020,000 a one-in-a-million tolerance would let 4,020,003 through.
 */
const sameCents = (a: number, b: number): boolean => Math.round(a * 100) === Math.round(b * 100);

/**
 * THE PROVENANCE CHECK. For each input, in order: the citation must be given,
 * must name a section on file for THIS facility, that section must be a
 * financials chunk, and the figure must be stated in it. Numbers are compared
 * after normalisation (`extractFigures`, the guardrail's own reader), never as
 * text: the chunk prints "4,020,000" and the figure is 4020000.
 *
 * Returns every problem, joined, so one more step can fix them all; null when
 * every figure is verified.
 *
 * WHY THE DOCUMENT TYPE IS CHECKED, and not only the figure: the cap a model
 * pre-applies is stated too — in the amendment ("not to exceed $500,000"). A
 * figure check alone would accept the pre-capped 500,000 cited to `Amd 2 §3`,
 * which is exactly the error this exists to stop. The borrower's compliance
 * certificate states figures as well, and the borrower's figure is evidence to
 * reconcile against, never the source of ours.
 */
function provenanceProblems(inputs: FinancialInput[], chunks: readonly FacilityChunk[]): string | null {
  const problems: string[] = [];
  for (const { field, value, citation } of inputs) {
    if (citation === "") {
      problems.push(`${field}: no citation`);
      continue;
    }
    const ref = resolveCitation(citation);
    const parts = ref.doc_title && ref.section ? chunks.filter((c) => c.doc_title === ref.doc_title && c.section === ref.section) : [];
    if (parts.length === 0) {
      problems.push(`${field}: ${citation} names no section on file for this facility`);
      continue;
    }
    const other = parts.find((c) => c.doc_type !== FINANCIALS_DOC_TYPE);
    if (other) {
      problems.push(`${field}: ${citation} is not a financials chunk (it is ${other.doc_type ?? "of no known type"})`);
      continue;
    }
    const stated = extractFigures(parts.map((c) => c.content).join("\n")) as number[];
    if (!stated.some((n) => sameCents(n, value))) problems.push(`${field}: ${value} is not stated in ${citation}`);
  }
  return problems.length > 0 ? problems.join("; ") : null;
}

/** The citations of the verified figures, shaped like `financials`, for the log: one per figure, nothing else. */
function verifiedCitations(financials: Record<string, unknown>, inputs: FinancialInput[]): Record<string, unknown> {
  const out: Record<string, unknown> = Object.fromEntries(inputs.filter((i) => !i.addback).map((i) => [i.key, i.citation]));
  if (isObject(own(financials, "addback_amounts"))) {
    out.addback_amounts = Object.fromEntries(inputs.filter((i) => i.addback).map((i) => [i.key, i.citation]));
  }
  return out;
}

async function defaultClient(): Promise<Pick<SupabaseClient, "from">> {
  const { supabaseAdmin } = await import("../../supabase/server.ts");
  return supabaseAdmin();
}

/** Postgres foreign_key_violation: here, a casefile_id that names no casefile. */
const FOREIGN_KEY_VIOLATION = "23503";

/**
 * `facility_id` names whose financials the citations are read against. The
 * MODEL never supplies it: the orchestrator's `toolRequestBody` overwrites it
 * from the casefile's exception, so a model cannot point the check at another
 * borrower's documents to make its figures verify.
 */
export async function runDscrCalculator(body: unknown, deps: CalculatorDeps = {}): Promise<ToolResult> {
  if (!isObject(body)) return bad("request body must be a JSON object");
  const { terms, financials, financial_citations, facility_id, casefile_id } = body;

  if (typeof facility_id !== "string" || !UUID.test(facility_id)) return bad("facility_id is required and must be a UUID");

  const problem = malformedField(terms, financials) ?? malformedCitations(financial_citations);
  if (problem) return bad(problem);

  if (casefile_id !== undefined && casefile_id !== null) {
    if (typeof casefile_id !== "string" || !UUID.test(casefile_id)) return bad("casefile_id must be a UUID");
  }

  const client = deps.client ?? (await defaultClient());

  // Provenance BEFORE any calculation. A refused figure is missing evidence the
  // agent reasons about (200), and nothing is calculated, minted or logged:
  // there is no number to trace.
  const inputs = financialInputs(financials as Record<string, unknown>, financial_citations as Record<string, unknown>);
  let chunks: FacilityChunk[] = [];
  if (inputs.some((i) => i.citation !== "")) {
    try {
      chunks = await loadFacilityChunks(client, facility_id);
    } catch (err) {
      console.error("dscr-calculator could not read the cited documents", err instanceof Error ? err.message : err);
      return { status: 500, body: { error: "the cited documents could not be read" } };
    }
  }
  const unverified = provenanceProblems(inputs, chunks);
  if (unverified) return { status: 200, body: { error: unverified } };

  // The id is minted here, before the call, and handed in. The pure function
  // never generates one, so its tests stay deterministic.
  const calcId = (deps.newId ?? randomUUID)();
  const result = computeDscr(terms as object, financials as object, { calcId }) as Record<string, unknown>;

  // A calculator error is evidence ("this input is missing"), not an outage:
  // 200, and no calc_log row, because there is no number to trace.
  if ("error" in result) return { status: 200, body: { error: result.error } };

  const { error } = await client.from("calc_log").insert({
    calc_id: calcId,
    casefile_id: casefile_id ?? null,
    // The citations sit beside the figures, so the provenance of every input
    // survives into the log the guardrail reads.
    inputs: {
      terms,
      financials,
      financial_citations: verifiedCitations(financials as Record<string, unknown>, inputs),
      facility_id,
    },
    outputs: result,
    calculator_version: result.calculator_version,
  });
  if (error) {
    // Never return a number that was not logged: the guardrail could not vouch for it.
    if (error.code === FOREIGN_KEY_VIOLATION) return bad("casefile_id does not match any casefile");
    console.error("calc_log insert failed", error.message);
    return { status: 500, body: { error: "calculation could not be logged" } };
  }
  return { status: 200, body: result };
}
